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

const phoneSchema = z
  .string()
  .regex(/^\+?[0-9]{9,15}$/)
  .transform((p) => (p.startsWith("+") ? p : `+${p}`));

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
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
      if (config.otp.devEcho) {
        app.log.info({ phone: body.phone, code }, "DEV OTP");
      }
      await notify({
        templateKey: "otp",
        toPhone: body.phone,
        vars: { code },
      });
      return reply.send({
        ok: true,
        ttlSeconds: config.otp.ttlSeconds,
        ...(config.otp.devEcho ? { devCode: code } : {}),
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

      const [challenge] = await db
        .select()
        .from(schema.otpChallenges)
        .where(
          and(
            eq(schema.otpChallenges.phone, body.phone),
            isNull(schema.otpChallenges.consumedAt),
            gt(schema.otpChallenges.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(schema.otpChallenges.createdAt))
        .limit(1);

      if (!challenge) throw new CiaoError("AUTH_OTP_INVALID");
      if (challenge.attempts >= config.otp.maxAttempts)
        throw new CiaoError("AUTH_OTP_THROTTLED");

      if (challenge.codeHash !== hashCode(body.code)) {
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
