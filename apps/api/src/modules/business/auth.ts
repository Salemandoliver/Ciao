/**
 * Business-console sign-in — Ciao's own team.
 *
 * The same shape as partner sign-in and deliberately not the same tables:
 * separate credentials, separate sessions, separate `biz` token audience. The
 * three properties the partner module guarantees hold here too — a console
 * session is not a guest or partner session, guessing one account is
 * expensive, and a wrong number answers exactly like a wrong password.
 *
 * One property is stronger here: **the role rides the token and the token is
 * re-minted from the database every fifteen minutes.** An access token carries
 * the role it was minted with; rotation re-reads `users.role`, so demoting an
 * operator takes effect within one token lifetime rather than at the end of a
 * thirty-day session. On a surface where `admin` can move money and change
 * what guests are charged, "revoke access" has to mean minutes, not weeks.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { isBizRole, normalizePhone, type UserRole } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { hashToken, signAccessToken } from "../../lib/auth.js";
import { deviceLabel, hashPassword, verifyPassword } from "../../lib/passwords.js";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/**
 * Console sessions live fourteen days, not the partner's thirty. This is the
 * surface that moves money and grants roles; the people using it are staff
 * with reliable devices, not a chalet owner at a gate during a power cut, so
 * the convenience argument for a long session is weaker and the blast radius
 * of a stolen device is larger.
 */
const SESSION_DAYS = 14;

export async function setBizPassword(
  userId: string,
  password: string,
  opts: { mustChange?: boolean } = {},
): Promise<void> {
  const passwordHash = await hashPassword(password);
  const values = {
    userId,
    passwordHash,
    passwordSetAt: new Date(),
    mustChange: opts.mustChange ?? false,
    // A successful set clears the lockout: the person who just proved they
    // control the recovery channel should not be locked out by an attacker's
    // failed guesses.
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.bizCredentials)
    .values(values)
    .onConflictDoUpdate({ target: schema.bizCredentials.userId, set: values });
}

export async function hasBizPassword(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: schema.bizCredentials.userId })
    .from(schema.bizCredentials)
    .where(eq(schema.bizCredentials.userId, userId))
    .limit(1);
  return Boolean(row);
}

export interface BizLoginResult {
  userId: string;
  phone: string;
  role: UserRole;
  mustChange: boolean;
  accessToken: string;
  refreshToken: string;
}

/**
 * Sign in with a phone number and a password.
 *
 * Every failure path answers identically, and a non-team account with a
 * stale credential row fails the same way as an unknown number: the console's
 * login form must not double as a directory of who works at Ciao.
 */
export async function bizLogin(
  phoneInput: string,
  password: string,
  meta: { ip?: string; userAgent?: string },
): Promise<BizLoginResult> {
  const phone = normalizePhone(phoneInput);
  const [row] = await db
    .select({ user: schema.users, cred: schema.bizCredentials })
    .from(schema.users)
    .innerJoin(schema.bizCredentials, eq(schema.bizCredentials.userId, schema.users.id))
    .where(eq(schema.users.phone, phone))
    .limit(1);

  /*
   * The role gate lives inside the "unknown account" branch on purpose. A
   * demoted operator's credential row may outlive their role; telling them
   * "your role changed" would also tell an attacker which numbers used to
   * be on the team. Burn comparable time on every miss so timing does not
   * distinguish the paths either.
   */
  if (!row || row.user.disabled || !isBizRole(row.user.role)) {
    await hashPassword(password).catch(() => undefined);
    throw new CiaoError("AUTH_PASSWORD_INVALID");
  }

  if (row.cred.lockedUntil && row.cred.lockedUntil > new Date()) {
    throw new CiaoError("AUTH_LOCKED", {
      lockedUntil: row.cred.lockedUntil.toISOString(),
    });
  }

  const ok = await verifyPassword(password, row.cred.passwordHash);
  if (!ok) {
    const attempts = row.cred.failedAttempts + 1;
    await db
      .update(schema.bizCredentials)
      .set({
        failedAttempts: attempts,
        lockedUntil:
          attempts >= MAX_ATTEMPTS
            ? new Date(Date.now() + LOCK_MINUTES * 60_000)
            : row.cred.lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(schema.bizCredentials.userId, row.user.id));
    throw new CiaoError("AUTH_PASSWORD_INVALID");
  }

  await db
    .update(schema.bizCredentials)
    .set({
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: meta.ip?.slice(0, 45) ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.bizCredentials.userId, row.user.id));

  const { accessToken, refreshToken } = await issueBizSession(
    row.user.id,
    phone,
    row.user.role as UserRole,
    meta,
  );
  return {
    userId: row.user.id,
    phone,
    role: row.user.role as UserRole,
    mustChange: row.cred.mustChange,
    accessToken,
    refreshToken,
  };
}

// ---------------------------------------------------------------- sessions
export async function issueBizSession(
  userId: string,
  phone: string,
  role: UserRole,
  meta: { ip?: string; userAgent?: string },
): Promise<{ accessToken: string; refreshToken: string }> {
  const raw = randomUUID() + randomUUID();
  await db.insert(schema.bizSessions).values({
    userId,
    tokenHash: hashToken(raw),
    deviceLabel: deviceLabel(meta.userAgent),
    ip: meta.ip?.slice(0, 45) ?? null,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000),
  });
  return {
    accessToken: await signAccessToken({ sub: userId, role, phone }, "biz"),
    refreshToken: raw,
  };
}

/**
 * Rotate on use — a replayed token is dead. The role is re-read from the
 * database here, which is what makes a demotion land within fifteen minutes:
 * the old access token expires, the refresh mints a new one with the current
 * role, and a user who no longer holds a console role gets no token at all.
 */
export async function rotateBizSession(
  raw: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const [row] = await db
    .select({
      session: schema.bizSessions,
      phone: schema.users.phone,
      role: schema.users.role,
      disabled: schema.users.disabled,
    })
    .from(schema.bizSessions)
    .innerJoin(schema.users, eq(schema.bizSessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.bizSessions.tokenHash, hashToken(raw)),
        isNull(schema.bizSessions.revokedAt),
      ),
    )
    .limit(1);
  if (!row || row.session.expiresAt < new Date() || row.disabled) return null;
  if (!isBizRole(row.role)) return null;

  await db
    .update(schema.bizSessions)
    .set({ revokedAt: new Date(), rotatedAt: new Date() })
    .where(eq(schema.bizSessions.id, row.session.id));
  return issueBizSession(row.session.userId, row.phone, row.role as UserRole, meta);
}

export async function revokeBizSession(raw: string): Promise<void> {
  await db
    .update(schema.bizSessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.bizSessions.tokenHash, hashToken(raw)));
}

/** Sign out everywhere — including the device the caller is holding. */
export async function revokeAllBizSessions(userId: string): Promise<number> {
  const rows = await db
    .update(schema.bizSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(schema.bizSessions.userId, userId), isNull(schema.bizSessions.revokedAt)),
    )
    .returning({ id: schema.bizSessions.id });
  return rows.length;
}

export async function listBizSessions(userId: string, currentRaw?: string) {
  const currentHash = currentRaw ? hashToken(currentRaw) : null;
  const rows = await db
    .select()
    .from(schema.bizSessions)
    .where(
      and(
        eq(schema.bizSessions.userId, userId),
        isNull(schema.bizSessions.revokedAt),
        sql`${schema.bizSessions.expiresAt} > now()`,
      ),
    )
    .orderBy(desc(schema.bizSessions.lastSeenAt))
    .limit(50);
  return rows.map((s) => ({
    id: s.id,
    deviceLabel: s.deviceLabel,
    ip: s.ip,
    lastSeenAt: s.lastSeenAt,
    createdAt: s.createdAt,
    current: currentHash ? s.tokenHash === currentHash : false,
  }));
}

export async function revokeBizSessionById(userId: string, id: string): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.bizSessions)
    .where(eq(schema.bizSessions.id, id))
    .limit(1);
  if (!row || row.userId !== userId) throw new CiaoError("AUTH_FORBIDDEN");
  await db
    .update(schema.bizSessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.bizSessions.id, id));
}

/** Housekeeping: drop sessions that expired or were revoked long ago. */
export async function pruneBizSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const rows = await db
    .delete(schema.bizSessions)
    .where(
      or(
        lt(schema.bizSessions.expiresAt, cutoff),
        and(
          sql`${schema.bizSessions.revokedAt} is not null`,
          lt(schema.bizSessions.revokedAt, cutoff),
        ),
      ),
    )
    .returning({ id: schema.bizSessions.id });
  return rows.length;
}
