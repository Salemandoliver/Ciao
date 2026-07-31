import { SignJWT, jwtVerify } from "jose";
import { createHash, randomUUID } from "node:crypto";
import { eq, isNull, and } from "drizzle-orm";
import { config } from "../config.js";
import { db, schema } from "../db/client.js";
import { CiaoError } from "./errors.js";
import type { UserRole } from "@ciao/shared";

const jwtKey = new TextEncoder().encode(config.jwtSecret);
const actionKey = new TextEncoder().encode(config.actionTokenSecret);

export interface SessionClaims {
  sub: string; // user id
  role: UserRole;
  phone: string;
}

export async function signAccessToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, phone: claims.phone })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer("ciao.ly")
    .setExpirationTime("15m") // short-lived (§13.8)
    .sign(jwtKey);
}

export async function verifyAccessToken(token: string): Promise<SessionClaims> {
  try {
    const { payload } = await jwtVerify(token, jwtKey, { issuer: "ciao.ly" });
    return {
      sub: payload.sub as string,
      role: payload.role as UserRole,
      phone: payload.phone as string,
    };
  } catch {
    throw new CiaoError("AUTH_REQUIRED");
  }
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
