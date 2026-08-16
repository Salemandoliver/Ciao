import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { otpCode } from "../../lib/ids.js";
import {
  issueRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from "../../lib/auth.js";
import { authenticate } from "../../lib/guards.js";
import { config } from "../../config.js";
import { notify } from "../messaging/service.js";
import { track } from "../intelligence/events.js";
import { getSetting } from "../business/settings.js";

import { isValidPhoneInput, normalizePhone } from "@ciao/shared";

const phoneSchema = z
  .string()
  .refine(isValidPhoneInput, "invalid phone")
  .transform(normalizePhone);

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Whether the guest login may hand the code back in its own response.
 *
 * There is no live SMS or WhatsApp rail yet — `MESSAGING_PROVIDER` is `console`
 * until the BSP onboarding lands, which journals the message and delivers
 * nothing. With the echo off as well, the code exists only in the API's stdout
 * and NOBODY CAN SIGN IN. That is the state this shipped in, and it is worse
 * than the risk below for a product with no real users yet.
 *
 * So the control plane decides it. `ops.demoMode` is already the operator's
 * switch for exactly this phase — mock payments, seeded data, a demo banner —
 * and it lives in the console where turning it off is one click on the day real
 * guests arrive. `OTP_DEV_ECHO=true` still forces it on; `=false` still forces
 * it off, and that override is the emergency brake.
 *
 * ## Read this before leaving it on
 *
 * WHILE THIS IS TRUE, ANYONE WHO KNOWS A PHONE NUMBER CAN SIGN IN AS ITS OWNER.
 * They ask for a code, the response contains it, they type it back. There is no
 * second factor to stop them.
 *
 * That is acceptable against seeded demo accounts and unacceptable the moment a
 * real person has a booking and a wallet balance. Turning `ops.demoMode` off is
 * the whole of the fix, and the login screen labels the code "demo mode" so the
 * state is visible to anyone looking at it.
 *
 * Staff and partner logins deliberately do NOT get this: those are the console
 * and the payout screens, and the blast radius is not a guest's wishlist.
 */
async function otpEchoEnabled(): Promise<boolean> {
  if (process.env.OTP_DEV_ECHO === "false") return false; // emergency brake
  if (config.otp.devEcho) return true;
  try {
    return (await getSetting("ops.demoMode")) === true;
  } catch {
    // A settings outage must not silently start echoing codes.
    return false;
  }
}

/**
 * Check a one-time code and burn it. Nothing else.
 *
 * This block was written out longhand in four places — sign-in here, the
 * partner and business password resets, and now the partner-interest form —
 * because each of them wants a *different* thing on the far side of a correct
 * code: a session, an action token, or a database row. Only the check is
 * common, so only the check is shared, and it deliberately returns nothing:
 * a helper that also decided what a verified phone entitles you to is how the
 * lead form would end up quietly minting sessions.
 *
 * Throws `AUTH_OTP_INVALID` for no live challenge, a wrong code, or an expired
 * one — all three answer identically on purpose, so the endpoint cannot be used
 * to ask whether a given number has a code outstanding. A wrong code costs an
 * attempt; running out of attempts is `AUTH_OTP_THROTTLED`.
 */
export async function consumeOtp(phone: string, code: string): Promise<void> {
  const [challenge] = await db
    .select()
    .from(schema.otpChallenges)
    .where(
      and(
        eq(schema.otpChallenges.phone, phone),
        isNull(schema.otpChallenges.consumedAt),
        gt(schema.otpChallenges.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.otpChallenges.createdAt))
    .limit(1);

  if (!challenge) throw new CiaoError("AUTH_OTP_INVALID");
  if (challenge.attempts >= config.otp.maxAttempts)
    throw new CiaoError("AUTH_OTP_THROTTLED");

  if (challenge.codeHash !== hashCode(code)) {
    await db
      .update(schema.otpChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(schema.otpChallenges.id, challenge.id));
    throw new CiaoError("AUTH_OTP_INVALID");
  }

  await db
    .update(schema.otpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(schema.otpChallenges.id, challenge.id));
}

export async function authRoutes(app: FastifyInstance) {
  // Request OTP — phone-first identity (§13.8); no account creation before checkout (§6.1).
  app.post("/v1/auth/otp/request", {
    config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    handler: async (req, reply) => {
      const body = z.object({ phone: phoneSchema }).parse(req.body);
      const code = otpCode();
      await db.insert(schema.otpChallenges).values({
        phone: body.phone,
        codeHash: hashCode(code),
        expiresAt: new Date(Date.now() + config.otp.ttlSeconds * 1000),
      });
      const echo = await otpEchoEnabled();
      if (echo) {
        /*
         * Loud on purpose, and at `warn`. While this is on, anybody who knows a
         * phone number can ask for its code and be handed it — that is an
         * account takeover with one request, and it should be impossible to
         * find it switched on by accident six months from now.
         */
        app.log.warn({ phone: body.phone, code }, "OTP ECHOED TO CLIENT (demo mode)");
      }
      await notify({
        templateKey: "otp",
        toPhone: body.phone,
        vars: { code },
      });
      track("auth.otp_requested", {}, { source: "api" });
      return reply.send({
        ok: true,
        ttlSeconds: config.otp.ttlSeconds,
        ...(echo ? { devCode: code } : {}),
      });
    },
  });

  app.post("/v1/auth/otp/verify", {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    handler: async (req, reply) => {
      const body = z
        .object({
          phone: phoneSchema,
          code: z.string().length(6),
          displayName: z.string().max(80).optional(),
        })
        .parse(req.body);

      await consumeOtp(body.phone, body.code);

      // Find-or-create user.
      let [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.phone, body.phone))
        .limit(1);
      if (!user) {
        [user] = await db
          .insert(schema.users)
          .values({
            phone: body.phone,
            role: "guest",
            displayName: body.displayName,
            // §11.5: public display defaults to initials
            publicName: body.displayName
              ? body.displayName
                  .split(/\s+/)
                  .map((w) => w[0])
                  .join(". ")
              : null,
          })
          .returning();
      }
      if (user!.disabled) throw new CiaoError("AUTH_FORBIDDEN");

      track("auth.verified", { isNewUser: !user!.displayName }, { userId: user!.id });
      const accessToken = await signAccessToken({
        sub: user!.id,
        role: user!.role as never,
        phone: user!.phone,
      });
      const refreshToken = await issueRefreshToken(user!.id);
      return reply.send({
        accessToken,
        refreshToken,
        user: {
          id: user!.id,
          phone: user!.phone,
          role: user!.role,
          displayName: user!.displayName,
          creditBalance: user!.creditBalance,
        },
      });
    },
  });

  app.post("/v1/auth/refresh", async (req, reply) => {
    const body = z.object({ refreshToken: z.string() }).parse(req.body);
    const rotated = await rotateRefreshToken(body.refreshToken);
    if (!rotated) throw new CiaoError("AUTH_REQUIRED");
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, rotated.userId))
      .limit(1);
    if (!user || user.disabled) throw new CiaoError("AUTH_REQUIRED");
    const accessToken = await signAccessToken({
      sub: user.id,
      role: user.role as never,
      phone: user.phone,
    });
    return reply.send({ accessToken, refreshToken: rotated.newToken });
  });

  /**
   * Sign out.
   *
   * Revoking server-side matters more here than in most products. Phones get
   * shared inside a family, and «خروج» that only cleared localStorage would
   * leave a live 30-day refresh token behind for whoever picks the phone up
   * next — on an account holding a wallet balance and a host's address.
   *
   * `everywhere` exists for the same reason: when someone realises another
   * person has been on their account, the honest answer is "sign out on every
   * device", not "clear this browser".
   */
  app.post("/v1/auth/logout", async (req, reply) => {
    const claims = await authenticate(req);
    const body = z
      .object({ refreshToken: z.string().optional(), everywhere: z.boolean().optional() })
      .parse(req.body ?? {});
    const { signOut } = await import("../accounts/profile.js");
    await signOut(claims.sub, body.refreshToken, body.everywhere ?? false);
    return reply.send({ ok: true });
  });

  app.get("/v1/me", async (req, reply) => {
    const claims = await authenticate(req);
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, claims.sub))
      .limit(1);
    if (!user) throw new CiaoError("AUTH_REQUIRED");
    return reply.send({
      id: user.id,
      phone: user.phone,
      role: user.role,
      displayName: user.displayName,
      locale: user.locale,
      creditBalance: user.creditBalance,
      completedStays: user.completedStays,
    });
  });
}
