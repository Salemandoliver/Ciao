import { SignJWT, jwtVerify } from "jose";
import { createHash, randomUUID } from "node:crypto";
import { eq, isNull, and } from "drizzle-orm";
import { config } from "../config.js";
import { db, schema } from "../db/client.js";
import { CiaoError } from "./errors.js";
import type { UserRole } from "@ciao/shared";

const jwtKey = new TextEncoder().encode(config.jwtSecret);
const actionKey = new TextEncoder().encode(config.actionTokenSecret);

/**
 * Which product a token was minted for.
 *
 * `app` is the consumer marketplace; `partner` is the standalone control panel
 * at partners.ciao.ly. They are separate products with separate sign-in
 * mechanisms — a guest proves a phone number with an OTP, a partner signs in
 * with a password — and a token from one must never be accepted by the other.
 *
 * Enforcing that with an audience claim rather than with discipline matters
 * because the failure is silent and severe: without it, any guest who obtained
 * a token could call the partner endpoints and be treated as the owner of
 * whichever business their user id happened to host.
 *
 * `biz` is the business console — Ciao's own control panel, a third product on
 * its own origin with its own password sign-in. The same rule applies in every
 * direction: a marketplace or partner token is refused by every `/v1/biz`
 * route, and a console token buys nothing on the other two.
 */
export type TokenAudience = "app" | "partner" | "biz";

export interface SessionClaims {
  sub: string; // user id
  role: UserRole;
  phone: string;
  aud: TokenAudience;
}

export async function signAccessToken(
  claims: Omit<SessionClaims, "aud">,
  audience: TokenAudience = "app",
): Promise<string> {
  return new SignJWT({ role: claims.role, phone: claims.phone })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer("ciao.ly")
    .setAudience(audience)
    .setExpirationTime("15m") // short-lived (§13.8)
    .sign(jwtKey);
}

/**
 * Verify a token and assert what it was minted for.
 *
 * The audience is checked here rather than passed to `jwtVerify`, for one
 * transitional reason: access tokens issued before the partner app existed
 * carry no `aud` at all, and rejecting them outright would sign out every
 * signed-in guest at the moment of deploy. A missing audience is read as
 * `app`, which is what those tokens were. They live fifteen minutes, so this
 * allowance stops mattering almost immediately — but it must never be widened
 * to `partner` or `biz`, because that would let a legacy token reach a
 * control panel.
 */
export async function verifyAccessToken(
  token: string,
  expected: TokenAudience = "app",
): Promise<SessionClaims> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwtKey, { issuer: "ciao.ly" }));
  } catch {
    throw new CiaoError("AUTH_REQUIRED");
  }
  const aud = (Array.isArray(payload.aud) ? payload.aud[0] : payload.aud) ?? "app";
  if (aud !== expected) throw new CiaoError("AUTH_FORBIDDEN");
  return {
    sub: payload.sub as string,
    role: payload.role as UserRole,
    phone: payload.phone as string,
    aud: aud as TokenAudience,
  };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = randomUUID() + randomUUID();
  await db.insert(schema.refreshTokens).values({
    userId,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
  });
  return raw;
}

/** Refresh rotation (§13.8): old token revoked, new one issued atomically. */
export async function rotateRefreshToken(
  raw: string,
): Promise<{ userId: string; newToken: string } | null> {
  const hash = hashToken(raw);
  const [row] = await db
    .select()
    .from(schema.refreshTokens)
    .where(
      and(
        eq(schema.refreshTokens.tokenHash, hash),
        isNull(schema.refreshTokens.revokedAt),
      ),
    )
    .limit(1);
  if (!row || row.expiresAt < new Date()) return null;
  await db
    .update(schema.refreshTokens)
    .set({ revokedAt: new Date(), rotatedAt: new Date() })
    .where(eq(schema.refreshTokens.id, row.id));
  const newToken = await issueRefreshToken(row.userId);
  return { userId: row.userId, newToken };
}

/**
 * Single-use signed action tokens (§13.3): "confirm booking X as host Y".
 * Confirmable from any device, no login — the blackout-resilient path (§12.4).
 */
export async function signActionToken(opts: {
  scope: string; // e.g. `host_confirm:${bookingId}`
  userId?: string;
  ttlSeconds: number;
}): Promise<string> {
  const jti = randomUUID();
  await db.insert(schema.actionTokens).values({
    jti,
    scope: opts.scope,
    userId: opts.userId,
    expiresAt: new Date(Date.now() + opts.ttlSeconds * 1000),
  });
  return new SignJWT({ scope: opts.scope, userId: opts.userId })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jti)
    .setIssuedAt()
    .setIssuer("ciao.ly/actions")
    .setExpirationTime(`${opts.ttlSeconds}s`)
    .sign(actionKey);
}

/** Verifies + consumes an action token. Second use fails (replay protection). */
export async function consumeActionToken(
  token: string,
  expectedScopePrefix: string,
): Promise<{ scope: string; userId?: string }> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, actionKey, { issuer: "ciao.ly/actions" }));
  } catch {
    throw new CiaoError("ACTION_TOKEN_INVALID");
  }
  const jti = payload.jti as string;
  const scope = payload.scope as string;
  if (!scope.startsWith(expectedScopePrefix)) throw new CiaoError("ACTION_TOKEN_INVALID");
  // Atomic consume: only succeeds if not yet consumed.
  const updated = await db
    .update(schema.actionTokens)
    .set({ consumedAt: new Date() })
    .where(and(eq(schema.actionTokens.jti, jti), isNull(schema.actionTokens.consumedAt)))
    .returning({ jti: schema.actionTokens.jti });
  if (updated.length === 0) throw new CiaoError("ACTION_TOKEN_INVALID");
  return { scope, userId: (payload.userId as string) ?? undefined };
}
