/**
 * The business console's front door.
 *
 * The same contract as the partner app's, because the threat model is worse,
 * not better: behind this door sit the payout controls, the fee schedule and
 * the role grants for the whole platform.
 *
 *  - **Sign-up does not exist.** An admin invites a team member with a
 *    one-time set-password link, exactly as ops invites a partner. Nobody at
 *    Ciao ever sets or sees anyone's password — including here, where the
 *    people are our own.
 *  - **Every unauthenticated route is rate-limited well below the global cap.**
 *  - **Recovery goes by OTP to the phone on record**, and the request endpoint
 *    always claims success: the login form must not double as a directory of
 *    who works at Ciao.
 *  - **The first account cannot come from an endpoint.** Bootstrapping is the
 *    CLI (`src/db/set-biz-password.mts`) run by someone who already has shell
 *    access to the database — a chicken-and-egg resolved on the side that is
 *    already trusted with everything.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { BIZ_ROLES, isBizRole, normalizePhone } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { config } from "../../config.js";
import { CiaoError } from "../../lib/errors.js";
import { consumeActionToken, signActionToken } from "../../lib/auth.js";
import { otpCode } from "../../lib/ids.js";
import { hashCode } from "../auth/routes.js";
import { notify } from "../messaging/service.js";
import { track } from "../intelligence/events.js";
import { PASSWORD_MESSAGES, passwordProblem } from "../../lib/passwords.js";
import {
  bizLogin,
  hasBizPassword,
  issueBizSession,
  listBizSessions,
  revokeAllBizSessions,
  revokeBizSession,
  revokeBizSessionById,
  rotateBizSession,
  setBizPassword,
} from "./auth.js";
import { bizGuard } from "./guards.js";

const passwordSchema = z.string().min(1).max(200);

export async function bizAuthRoutes(app: FastifyInstance) {
  const ipMeta = (req: { ip: string; headers: Record<string, unknown> }) => ({
    ip: req.ip,
    userAgent: String(req.headers["user-agent"] ?? ""),
  });

  // ------------------------------------------------------------------ login
  app.post("/v1/biz/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    handler: async (req, reply) => {
      const body = z
        .object({ phone: z.string().min(6).max(24), password: passwordSchema })
        .parse(req.body);
      const result = await bizLogin(body.phone, body.password, ipMeta(req));
      track(
        "console.signed_in",
        { role: result.role, mustChange: result.mustChange },
        { userId: result.userId, source: "api" },
      );
      return reply.send({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        role: result.role,
        mustChangePassword: result.mustChange,
      });
    },
  });

  app.post("/v1/biz/auth/refresh", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      const body = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
      const rotated = await rotateBizSession(body.refreshToken, ipMeta(req));
      if (!rotated) throw new CiaoError("AUTH_REQUIRED");
      return reply.send(rotated);
    },
  });

  app.post("/v1/biz/auth/logout", async (req, reply) => {
    const body = z.object({ refreshToken: z.string().min(10).optional() }).parse(req.body ?? {});
    if (body.refreshToken) await revokeBizSession(body.refreshToken);
    return reply.send({ ok: true });
  });

  // ------------------------------------------------------------ set password
  /**
   * Choose a password from a one-time link — a new account or a reset. The
   * token is single-use and scoped to one user id; the role is re-checked at
   * consumption, because a link issued to an operator who has since been
   * removed from the team must be worth nothing.
   */
  app.post("/v1/biz/auth/set-password", {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    handler: async (req, reply) => {
      const body = z
        .object({ token: z.string().min(10), password: passwordSchema })
        .parse(req.body);
      const { userId } = await consumeActionToken(body.token, "biz_set_password:");
      if (!userId) throw new CiaoError("ACTION_TOKEN_INVALID");

      const [user] = await db
        .select({
          phone: schema.users.phone,
          role: schema.users.role,
          disabled: schema.users.disabled,
        })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (!user || user.disabled || !isBizRole(user.role))
        throw new CiaoError("ACTION_TOKEN_INVALID");

      const problem = passwordProblem(body.password, user.phone);
      if (problem)
        throw new CiaoError("VALIDATION", { field: "password", ...PASSWORD_MESSAGES[problem] });

      await setBizPassword(userId, body.password);
      // Setting a password ends every existing session — otherwise a reset
      // prompted by "someone else is in my account" would be theatre.
      await revokeAllBizSessions(userId);
      await db.insert(schema.auditLog).values({
        actorId: userId,
        action: "biz.password.set",
        targetType: "biz_user",
        targetId: userId,
      });
      return reply.send({ ok: true });
    },
  });

  /** Is this link still good? Lets the page say so before the form is filled in. */
  app.get("/v1/biz/auth/set-password/check", async (req, reply) => {
    const q = z.object({ token: z.string().min(10) }).parse(req.query);
    // Deliberately does NOT consume: opening the page twice must not lock the
    // person out of their own invitation.
    const { jwtVerify } = await import("jose");
    try {
      const key = new TextEncoder().encode(config.actionTokenSecret);
      const { payload } = await jwtVerify(q.token, key, { issuer: "ciao.ly/actions" });
      const scope = String(payload.scope ?? "");
      if (!scope.startsWith("biz_set_password:")) throw new Error("scope");
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
  /** Forgot password — step one: OTP to the phone on record. Always `{ ok: true }`. */
  app.post("/v1/biz/auth/forgot", {
    config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    handler: async (req, reply) => {
      const body = z.object({ phone: z.string().min(6).max(24) }).parse(req.body);
      const phone = normalizePhone(body.phone);
      const [user] = await db
        .select({
          id: schema.users.id,
          locale: schema.users.locale,
          role: schema.users.role,
          disabled: schema.users.disabled,
        })
        .from(schema.users)
        .where(eq(schema.users.phone, phone))
        .limit(1);

      let devCode: string | undefined;
      if (user && !user.disabled && isBizRole(user.role) && (await hasBizPassword(user.id))) {
        const code = otpCode();
        await db.insert(schema.otpChallenges).values({
          phone,
          codeHash: hashCode(code),
          expiresAt: new Date(Date.now() + config.otp.ttlSeconds * 1000),
        });
        await notify({
          templateKey: "biz_password_reset",
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
  app.post("/v1/biz/auth/forgot/verify", {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    handler: async (req, reply) => {
      const body = z
        .object({ phone: z.string().min(6).max(24), code: z.string().length(6) })
        .parse(req.body);
      const phone = normalizePhone(body.phone);

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
        .select({ id: schema.users.id, role: schema.users.role })
        .from(schema.users)
        .where(eq(schema.users.phone, phone))
        .limit(1);
      if (!user || !isBizRole(user.role)) throw new CiaoError("AUTH_OTP_INVALID");

      const token = await signActionToken({
        scope: `biz_set_password:${user.id}`,
        userId: user.id,
        ttlSeconds: 900,
      });
      return reply.send({ token });
    },
  });

  // ------------------------------------------------------------------ account
  /** Change your own password. Requires the current one — always. */
  app.post("/v1/biz/auth/change-password", async (req, reply) => {
    const ctx = await bizGuard(req, "overview");
    const body = z
      .object({ current: passwordSchema, next: passwordSchema })
      .parse(req.body);

    // Reuses the login path so the failure counter and lockout apply here too.
    await bizLogin(ctx.claims.phone, body.current, ipMeta(req));

    const problem = passwordProblem(body.next, ctx.claims.phone);
    if (problem)
      throw new CiaoError("VALIDATION", { field: "password", ...PASSWORD_MESSAGES[problem] });

    await setBizPassword(ctx.actorId, body.next);
    await revokeAllBizSessions(ctx.actorId);
    await db.insert(schema.auditLog).values({
      actorId: ctx.actorId,
      action: "biz.password.changed",
      targetType: "biz_user",
      targetId: ctx.actorId,
    });
    // Everything was revoked, including the caller — hand back a fresh pair.
    const fresh = await issueBizSession(ctx.actorId, ctx.claims.phone, ctx.role, ipMeta(req));
    return reply.send({ ok: true, ...fresh });
  });

  app.get("/v1/biz/auth/sessions", async (req, reply) => {
    const ctx = await bizGuard(req, "overview");
    const q = z.object({ current: z.string().optional() }).parse(req.query);
    return reply.send({ items: await listBizSessions(ctx.actorId, q.current) });
  });

  app.delete("/v1/biz/auth/sessions/:id", async (req, reply) => {
    const ctx = await bizGuard(req, "overview");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await revokeBizSessionById(ctx.actorId, id);
    return reply.send({ ok: true });
  });

  app.post("/v1/biz/auth/sessions/revoke-all", async (req, reply) => {
    const ctx = await bizGuard(req, "overview");
    const count = await revokeAllBizSessions(ctx.actorId);
    await db.insert(schema.auditLog).values({
      actorId: ctx.actorId,
      action: "biz.sessions.revoked_all",
      targetType: "biz_user",
      targetId: ctx.actorId,
      detail: { count },
    });
    return reply.send({ ok: true, count });
  });

  // ------------------------------------------------------------------ team
  /**
   * The console team: everyone holding a console role, with the state of
   * their credential — has a password, last signed in, locked out, invited but
   * never arrived. Visible to anyone with `people` (it is the roster, not a
   * power); changing it is `govern`.
   */
  app.get("/v1/biz/team", async (req, reply) => {
    await bizGuard(req, "people");
    const rows = await db
      .select({
        user: schema.users,
        cred: schema.bizCredentials,
      })
      .from(schema.users)
      .leftJoin(schema.bizCredentials, eq(schema.bizCredentials.userId, schema.users.id))
      .where(inArray(schema.users.role, BIZ_ROLES))
      .orderBy(desc(schema.users.createdAt));

    const invites = await db
      .select({ scope: schema.actionTokens.scope, expiresAt: schema.actionTokens.expiresAt })
      .from(schema.actionTokens)
      .where(
        and(
          isNull(schema.actionTokens.consumedAt),
          sql`${schema.actionTokens.scope} like 'biz_set_password:%'`,
        ),
      );
    const pendingInvite = new Set(
      invites
        .filter((i) => i.expiresAt > new Date())
        .map((i) => i.scope.slice("biz_set_password:".length)),
    );

    return reply.send({
      items: rows.map((r) => ({
        id: r.user.id,
        phone: r.user.phone,
        displayName: r.user.displayName,
        role: r.user.role,
        disabled: r.user.disabled,
        hasPassword: Boolean(r.cred),
        mustChange: r.cred?.mustChange ?? false,
        lastLoginAt: r.cred?.lastLoginAt ?? null,
        lockedUntil:
          r.cred?.lockedUntil && r.cred.lockedUntil > new Date() ? r.cred.lockedUntil : null,
        inviteOutstanding: pendingInvite.has(r.user.id),
      })),
    });
  });

  /**
   * Invite a team member: mint a one-time set-password link. `govern`-only —
   * the same tier as granting the role, because the link IS the account.
   * The target must already hold a console role; inviting a guest is refused
   * rather than quietly granting them one, so the power to add a person to
   * the team never hides inside a different button.
   */
  app.post("/v1/biz/team/:userId/invite", {
    config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
    handler: async (req, reply) => {
      const ctx = await bizGuard(req, "govern");
      const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
      const body = z.object({ send: z.boolean().default(true) }).parse(req.body ?? {});

      const [user] = await db
        .select({
          id: schema.users.id,
          phone: schema.users.phone,
          locale: schema.users.locale,
          role: schema.users.role,
          disabled: schema.users.disabled,
        })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (!user || user.disabled || !isBizRole(user.role))
        throw new CiaoError("AUTH_FORBIDDEN");

      const token = await signActionToken({
        scope: `biz_set_password:${user.id}`,
        userId: user.id,
        ttlSeconds: 7 * 24 * 3600,
      });
      const link = `${config.consoleBaseUrl}/set-password?token=${token}`;

      if (body.send) {
        await notify({
          templateKey: "biz_invite",
          toPhone: user.phone,
          toUserId: user.id,
          locale: user.locale === "en" ? "en" : "ar",
          vars: { link },
        }).catch(() => undefined);
      }

      await db.insert(schema.auditLog).values({
        actorId: ctx.actorId,
        action: "biz.invite.issued",
        targetType: "biz_user",
        targetId: user.id,
        // The link is a credential for a week — the audit trail records that
        // one was issued and to whom, never the token itself.
        detail: { sent: body.send, role: user.role },
      });
      return reply.send({ ok: true, link, hasPassword: await hasBizPassword(user.id) });
    },
  });
}
