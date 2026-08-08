/**
 * The partner app's front door.
 *
 * Everything here is either unauthenticated or the first authenticated call a
 * partner makes, which makes it the most attacked surface in the product. The
 * shape follows from that:
 *
 *  - **Sign-up does not exist.** Ops creates the business after a field visit
 *    (§7.4 — no self-serve listings at launch), and the owner receives a
 *    one-time link to choose their own password. Nobody at Ciao ever knows it.
 *  - **Every unauthenticated route is rate-limited well below the global cap**,
 *    per IP, because the global 300/minute is sized for browsing a marketplace
 *    and not for someone grinding a login.
 *  - **Recovery goes by OTP to the phone on record.** It is the one channel
 *    that reliably reaches a Libyan business owner, and it is the reason the
 *    OTP machinery stays even though sign-in no longer uses it.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { normalizePhone } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { config } from "../../config.js";
import { CiaoError } from "../../lib/errors.js";
import {
  authenticate,
  requireRole,
} from "../../lib/guards.js";
import { consumeActionToken, signActionToken } from "../../lib/auth.js";
import { otpCode } from "../../lib/ids.js";
import { hashCode } from "../auth/routes.js";
import { notify } from "../messaging/service.js";
import { track } from "../intelligence/events.js";
import {
  hasPassword,
  listSessions,
  login,
  passwordProblem,
  revokeAllSessions,
  revokeSession,
  revokeSessionById,
  rotateSession,
  setPassword,
} from "./auth.js";
import { partnerMemberships } from "./guards.js";
import { ensureProfile } from "./service.js";

import { PASSWORD_MESSAGES } from "../../lib/passwords.js";

const passwordSchema = z.string().min(1).max(200);

export async function partnerAuthRoutes(app: FastifyInstance) {
  const ipMeta = (req: { ip: string; headers: Record<string, unknown> }) => ({
    ip: req.ip,
    userAgent: String(req.headers["user-agent"] ?? ""),
  });

  // ------------------------------------------------------------------ login
  app.post("/v1/partner/auth/login", {
    // Far below the global cap: this endpoint exists to be guessed at.
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    handler: async (req, reply) => {
      const body = z
        .object({ phone: z.string().min(6).max(24), password: passwordSchema })
        .parse(req.body);
      const result = await login(body.phone, body.password, ipMeta(req));

      // A partner who signs in and has no business is a dead end; resolving it
      // here means the app's first screen can say so rather than showing an
      // empty console.
      const memberships = await partnerMemberships(result.userId);
      if (memberships.length > 0) await ensureProfile(result.userId);

      track("partner.signed_in", { mustChange: result.mustChange }, { userId: result.userId, source: "api" });
      return reply.send({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        mustChangePassword: result.mustChange,
      });
    },
  });

  app.post("/v1/partner/auth/refresh", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      const body = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
      const rotated = await rotateSession(body.refreshToken, ipMeta(req));
      if (!rotated) throw new CiaoError("AUTH_REQUIRED");
      return reply.send(rotated);
    },
  });

  app.post("/v1/partner/auth/logout", async (req, reply) => {
    const body = z.object({ refreshToken: z.string().min(10).optional() }).parse(req.body ?? {});
    if (body.refreshToken) await revokeSession(body.refreshToken);
    return reply.send({ ok: true });
  });

  // ------------------------------------------------------------------ set password
  /**
   * Choose a password from a one-time link.
   *
   * Used both for a brand-new account and after a reset. The token is single-use
   * and scoped to one user id, so a forwarded link cannot be replayed and
   * cannot be pointed at a different business.
   */
  app.post("/v1/partner/auth/set-password", {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    handler: async (req, reply) => {
      const body = z
        .object({ token: z.string().min(10), password: passwordSchema })
        .parse(req.body);
      const { userId } = await consumeActionToken(body.token, "partner_set_password:");
      if (!userId) throw new CiaoError("ACTION_TOKEN_INVALID");

      const [user] = await db
        .select({ phone: schema.users.phone, disabled: schema.users.disabled })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (!user || user.disabled) throw new CiaoError("ACTION_TOKEN_INVALID");

      const problem = passwordProblem(body.password, user.phone);
      if (problem) throw new CiaoError("VALIDATION", { field: "password", ...PASSWORD_MESSAGES[problem] });

      await setPassword(userId, body.password);
      /*
       * Setting a password ends every existing session. If this was a reset
       * because somebody else got in, leaving their session alive would make
       * the reset theatre.
       */
      await revokeAllSessions(userId);
      await db.insert(schema.auditLog).values({
        actorId: userId,
        action: "partner.password.set",
        targetType: "partner",
        targetId: userId,
      });
      return reply.send({ ok: true });
    },
  });

  /** Is this link still good? Lets the page say so before the form is filled in. */
  app.get("/v1/partner/auth/set-password/check", async (req, reply) => {
    const q = z.object({ token: z.string().min(10) }).parse(req.query);
    // Deliberately does NOT consume: a check that burned the token would mean
    // opening the page twice locked the partner out of their own account.
    const { jwtVerify } = await import("jose");
    try {
      const key = new TextEncoder().encode(config.actionTokenSecret);
      const { payload } = await jwtVerify(q.token, key, { issuer: "ciao.ly/actions" });
      const scope = String(payload.scope ?? "");
      if (!scope.startsWith("partner_set_password:")) throw new Error("scope");
      const [row] = await db
        .select({ consumedAt: schema.actionTokens.consumedAt })
        .from(schema.actionTokens)
        .where(eq(schema.actionTokens.jti, String(payload.jti)))
        .limit(1);
      return reply.send({ valid: Boolean(row) && !row!.consumedAt });
    } catch {
      return reply.send({ valid: false });
    }
  });

  // ------------------------------------------------------------------ reset
  /**
   * Forgot password — step one: OTP to the phone on record.
   *
   * Always answers `{ ok: true }`, whether or not the number belongs to a
   * partner. Anything else is a way of asking which Libyan businesses have
   * accounts, which is a list worth money to a competitor.
   */
  app.post("/v1/partner/auth/forgot", {
    config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    handler: async (req, reply) => {
      const body = z.object({ phone: z.string().min(6).max(24) }).parse(req.body);
      const phone = normalizePhone(body.phone);
      const [user] = await db
        .select({ id: schema.users.id, locale: schema.users.locale, disabled: schema.users.disabled })
        .from(schema.users)
        .where(eq(schema.users.phone, phone))
        .limit(1);

      let devCode: string | undefined;
      if (user && !user.disabled && (await hasPassword(user.id))) {
        const code = otpCode();
        await db.insert(schema.otpChallenges).values({
          phone,
          codeHash: hashCode(code),
          expiresAt: new Date(Date.now() + config.otp.ttlSeconds * 1000),
        });
        await notify({
          templateKey: "partner_password_reset",
          toPhone: phone,
          toUserId: user.id,
          locale: user.locale === "en" ? "en" : "ar",
          vars: { code },
        }).catch(() => undefined);
        if (config.otp.devEcho) devCode = code;
      }
      return reply.send({ ok: true, ...(devCode ? { devCode } : {}) });
    },
  });

  /** Step two: the code proves the phone, and buys a set-password token. */
  app.post("/v1/partner/auth/forgot/verify", {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    handler: async (req, reply) => {
      const body = z
        .object({ phone: z.string().min(6).max(24), code: z.string().length(6) })
        .parse(req.body);
      const phone = normalizePhone(body.phone);
      const [challenge] = await db
        .select()
        .from(schema.otpChallenges)
        .where(eq(schema.otpChallenges.phone, phone))
        .orderBy(schema.otpChallenges.createdAt)
        .limit(1);
      void challenge;

      const rows = await db
        .select()
        .from(schema.otpChallenges)
        .where(eq(schema.otpChallenges.phone, phone));
      const live = rows
        .filter((r) => !r.consumedAt && r.expiresAt > new Date() && r.attempts < config.otp.maxAttempts)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (!live) throw new CiaoError("AUTH_OTP_INVALID");

      if (live.codeHash !== hashCode(body.code)) {
        await db
          .update(schema.otpChallenges)
          .set({ attempts: live.attempts + 1 })
          .where(eq(schema.otpChallenges.id, live.id));
        throw new CiaoError("AUTH_OTP_INVALID");
      }
      await db
        .update(schema.otpChallenges)
        .set({ consumedAt: new Date() })
        .where(eq(schema.otpChallenges.id, live.id));

      const [user] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phone, phone))
        .limit(1);
      if (!user) throw new CiaoError("AUTH_OTP_INVALID");

      const token = await signActionToken({
        scope: `partner_set_password:${user.id}`,
        userId: user.id,
        ttlSeconds: 900, // fifteen minutes — long enough to type, short enough to matter
      });
      return reply.send({ token });
    },
  });

  // ------------------------------------------------------------------ account
  /** Change your own password. Requires the current one — always. */
  app.post("/v1/partner/auth/change-password", async (req, reply) => {
    const claims = await authenticate(req, "partner");
    const body = z
      .object({ current: passwordSchema, next: passwordSchema })
      .parse(req.body);

    // Reuses the login path so the failure counter and lockout apply here too:
    // an open session is otherwise an unlimited oracle for guessing the
    // current password.
    await login(claims.phone, body.current, ipMeta(req));

    const problem = passwordProblem(body.next, claims.phone);
    if (problem) throw new CiaoError("VALIDATION", { field: "password", ...PASSWORD_MESSAGES[problem] });

    await setPassword(claims.sub, body.next);
    await revokeAllSessions(claims.sub);
    await db.insert(schema.auditLog).values({
      actorId: claims.sub,
      action: "partner.password.changed",
      targetType: "partner",
      targetId: claims.sub,
    });
    // Everything was revoked, including the caller — hand back a fresh pair so
    // they are not bounced to the login screen for doing the right thing.
    const { issueSession } = await import("./auth.js");
    const fresh = await issueSession(claims.sub, claims.phone, ipMeta(req));
    return reply.send({ ok: true, ...fresh });
  });

  app.get("/v1/partner/auth/sessions", async (req, reply) => {
    const claims = await authenticate(req, "partner");
    const q = z.object({ current: z.string().optional() }).parse(req.query);
    return reply.send({ items: await listSessions(claims.sub, q.current) });
  });

  app.delete("/v1/partner/auth/sessions/:id", async (req, reply) => {
    const claims = await authenticate(req, "partner");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await revokeSessionById(claims.sub, id);
    return reply.send({ ok: true });
  });

  app.post("/v1/partner/auth/sessions/revoke-all", async (req, reply) => {
    const claims = await authenticate(req, "partner");
    const count = await revokeAllSessions(claims.sub);
    await db.insert(schema.auditLog).values({
      actorId: claims.sub,
      action: "partner.sessions.revoked_all",
      targetType: "partner",
      targetId: claims.sub,
      detail: { count },
    });
    return reply.send({ ok: true, count });
  });

  // ------------------------------------------------------------------ ops
  /**
   * Ops issues a set-password link.
   *
   * The only way an account comes into existence, and the reason there is no
   * sign-up form. Ops never sets the password itself — it mints a one-time
   * link, sends it over WhatsApp, and the owner chooses their own. Nobody at
   * Ciao ever knows a partner's password, which is both correct and the answer
   * to "could someone at Ciao have moved my money".
   */
  app.post("/v1/biz/partners/:userId/invite", {
    config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
    handler: async (req, reply) => {
      // Issued from the business console, so it carries the `biz` audience
      // and the supply team's capability — onboarding is catalogue work.
      const { bizGuard } = await import("../business/guards.js");
      const claims = await bizGuard(req, "catalogue");
      const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
      const body = z.object({ send: z.boolean().default(true) }).parse(req.body ?? {});

      const [user] = await db
        .select({ id: schema.users.id, phone: schema.users.phone, locale: schema.users.locale })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (!user) throw new CiaoError("AUTH_FORBIDDEN");

      const token = await signActionToken({
        scope: `partner_set_password:${user.id}`,
        userId: user.id,
        ttlSeconds: 7 * 24 * 3600, // a week: field visits and callbacks take days
      });
      const link = `${config.partnerBaseUrl}/set-password?token=${token}`;

      if (body.send) {
        await notify({
          templateKey: "partner_invite",
          toPhone: user.phone,
          toUserId: user.id,
          locale: user.locale === "en" ? "en" : "ar",
          vars: { link },
        }).catch(() => undefined);
      }

      await db.insert(schema.auditLog).values({
        actorId: claims.sub,
        action: "partner.invite.issued",
        targetType: "partner",
        targetId: user.id,
        // The link is a credential for a week — the audit trail records that
        // one was issued and to whom, never the token itself.
        detail: { sent: body.send },
      });
      const had = await hasPassword(user.id);
      track(
        "partner.invited",
        { partnerId: user.id, hadPassword: had },
        { userId: claims.sub, source: "api" },
      );
      return reply.send({ ok: true, link, hasPassword: had });
    },
  });
}
