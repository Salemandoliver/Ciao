/**
 * Partner sign-in.
 *
 * The consumer app has no passwords and should not have any. This one does,
 * and the reasons are specific to who uses it: a business has staff who each
 * need their own login, an owner opens their diary several times a day and
 * cannot depend on an SMS arriving each time, and a password survives the
 * changed SIM that a phone-only identity does not.
 *
 * Three properties this file exists to guarantee:
 *
 *  1. **A partner session is not a guest session.** Separate table, separate
 *     JWT audience. A token minted here cannot be presented to the consumer
 *     API and a guest's token cannot be presented here — structurally, not by
 *     remembering to check.
 *  2. **Guessing one account is expensive.** Per-account lockout on top of
 *     per-IP rate limiting, because throttling by IP alone does nothing
 *     against a distributed guess at one business whose payouts can be
 *     redirected.
 *  3. **The answer to a wrong phone and a wrong password is identical.**
 *     Anything else turns the login form into a directory of which Libyan
 *     businesses are on Ciao.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { normalizePhone } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { hashToken, signAccessToken } from "../../lib/auth.js";
import { deviceLabel, hashPassword, verifyPassword } from "../../lib/passwords.js";

/*
 * The primitives — hashing, verifying, strength rules, device labels — moved
 * to `lib/passwords.ts` when the business console became the second password
 * product. Re-exported here so existing imports (and the tests that pin the
 * behaviour) keep working from the partner module.
 */
export {
  deviceLabel,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "../../lib/passwords.js";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// ---------------------------------------------------------------- credentials
export async function setPassword(
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
    .insert(schema.partnerCredentials)
    .values(values)
    .onConflictDoUpdate({ target: schema.partnerCredentials.userId, set: values });
}

export async function hasPassword(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: schema.partnerCredentials.userId })
    .from(schema.partnerCredentials)
    .where(eq(schema.partnerCredentials.userId, userId))
    .limit(1);
  return Boolean(row);
}

export interface LoginResult {
  userId: string;
  phone: string;
  mustChange: boolean;
  accessToken: string;
  refreshToken: string;
}

/**
 * Sign in with a phone number and a password.
 *
 * Every failure path returns the same error. A "no such account" that differs
 * from "wrong password" turns this form into a way of asking which Libyan
 * businesses are on Ciao, and in a market this small that list is worth
 * something to a competitor.
 *
 * The one exception is the lockout, which says so plainly — a partner who
 * cannot get in needs to know whether to keep trying or to go and reset.
 */
export async function login(
  phoneInput: string,
  password: string,
  meta: { ip?: string; userAgent?: string },
): Promise<LoginResult> {
  const phone = normalizePhone(phoneInput);
  const [row] = await db
    .select({ user: schema.users, cred: schema.partnerCredentials })
    .from(schema.users)
    .innerJoin(
      schema.partnerCredentials,
      eq(schema.partnerCredentials.userId, schema.users.id),
    )
    .where(eq(schema.users.phone, phone))
    .limit(1);

  if (!row || row.user.disabled) {
    /*
     * Burn comparable time on a miss. Without this, "unknown number" returns
     * in a millisecond and "wrong password" takes a hundred, and the
     * difference is a perfectly good account-enumeration oracle regardless of
     * what the error message says.
     */
    await hashPassword(password).catch(() => undefined);
    throw new CiaoError("AUTH_PASSWORD_INVALID");
  }

  /*
   * The lockout speaks its own language (CIAO-1006), not the OTP limiter's
   * "wait a minute" — this is a fifteen-minute lock on a password product,
   * and a partner told to wait sixty seconds will retry into the lock five
   * more times and then phone support.
   */
  if (row.cred.lockedUntil && row.cred.lockedUntil > new Date()) {
    throw new CiaoError("AUTH_LOCKED", {
      lockedUntil: row.cred.lockedUntil.toISOString(),
    });
  }

  const ok = await verifyPassword(password, row.cred.passwordHash);
  if (!ok) {
    const attempts = row.cred.failedAttempts + 1;
    await db
      .update(schema.partnerCredentials)
      .set({
        failedAttempts: attempts,
        lockedUntil:
          attempts >= MAX_ATTEMPTS
            ? new Date(Date.now() + LOCK_MINUTES * 60_000)
            : row.cred.lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(schema.partnerCredentials.userId, row.user.id));
    /*
     * Same code and sentence as the unknown-number path above — the two must
     * stay indistinguishable, and that property has its own test.
     */
    throw new CiaoError("AUTH_PASSWORD_INVALID");
  }

  await db
    .update(schema.partnerCredentials)
    .set({
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: meta.ip?.slice(0, 45) ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.partnerCredentials.userId, row.user.id));

  const { accessToken, refreshToken } = await issueSession(row.user.id, phone, meta);
  return {
    userId: row.user.id,
    phone,
    mustChange: row.cred.mustChange,
    accessToken,
    refreshToken,
  };
}

// ---------------------------------------------------------------- sessions
export async function issueSession(
  userId: string,
  phone: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ accessToken: string; refreshToken: string }> {
  const raw = randomUUID() + randomUUID();
  await db.insert(schema.partnerSessions).values({
    userId,
    tokenHash: hashToken(raw),
    deviceLabel: deviceLabel(meta.userAgent),
    ip: meta.ip?.slice(0, 45) ?? null,
    // Thirty days. A business tool people open daily should not ask for a
    // password every week; the session list and "sign out everywhere" are what
    // make a long session safe rather than a short expiry nobody notices.
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
  });
  return {
    accessToken: await signAccessToken({ sub: userId, role: "host", phone }, "partner"),
    refreshToken: raw,
  };
}

/** Rotate on use, exactly like the consumer refresh — a replayed token is dead. */
export async function rotateSession(
  raw: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const [row] = await db
    .select({ session: schema.partnerSessions, phone: schema.users.phone, disabled: schema.users.disabled })
    .from(schema.partnerSessions)
    .innerJoin(schema.users, eq(schema.partnerSessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.partnerSessions.tokenHash, hashToken(raw)),
        isNull(schema.partnerSessions.revokedAt),
      ),
    )
    .limit(1);
  if (!row || row.session.expiresAt < new Date() || row.disabled) return null;

  await db
    .update(schema.partnerSessions)
    .set({ revokedAt: new Date(), rotatedAt: new Date() })
    .where(eq(schema.partnerSessions.id, row.session.id));
  return issueSession(row.session.userId, row.phone, meta);
}

export async function revokeSession(raw: string): Promise<void> {
  await db
    .update(schema.partnerSessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.partnerSessions.tokenHash, hashToken(raw)));
}

/**
 * Sign out everywhere.
 *
 * The single most useful control after "I think someone has my password", and
 * the reason it takes the current session's token: signing the person out of
 * the device they are holding, along with the one they are worried about, is
 * the behaviour they expect and the safe default.
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const rows = await db
    .update(schema.partnerSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.partnerSessions.userId, userId),
        isNull(schema.partnerSessions.revokedAt),
      ),
    )
    .returning({ id: schema.partnerSessions.id });
  return rows.length;
}

export async function listSessions(userId: string, currentRaw?: string) {
  const currentHash = currentRaw ? hashToken(currentRaw) : null;
  const rows = await db
    .select()
    .from(schema.partnerSessions)
    .where(
      and(
        eq(schema.partnerSessions.userId, userId),
        isNull(schema.partnerSessions.revokedAt),
        sql`${schema.partnerSessions.expiresAt} > now()`,
      ),
    )
    .orderBy(desc(schema.partnerSessions.lastSeenAt))
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

export async function revokeSessionById(userId: string, id: string): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.partnerSessions)
    .where(eq(schema.partnerSessions.id, id))
    .limit(1);
  if (!row || row.userId !== userId) throw new CiaoError("AUTH_FORBIDDEN");
  await db
    .update(schema.partnerSessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.partnerSessions.id, id));
}

/** Housekeeping: drop sessions that expired or were revoked long ago. */
export async function pruneSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const rows = await db
    .delete(schema.partnerSessions)
    .where(
      or(
        lt(schema.partnerSessions.expiresAt, cutoff),
        and(
          sql`${schema.partnerSessions.revokedAt} is not null`,
          lt(schema.partnerSessions.revokedAt, cutoff),
        ),
      ),
    )
    .returning({ id: schema.partnerSessions.id });
  return rows.length;
}
