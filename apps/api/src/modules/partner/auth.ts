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
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { normalizePhone } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { hashToken, signAccessToken } from "../../lib/auth.js";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

/**
 * scrypt parameters.
 *
 * N=16384 costs roughly 100ms and 16MB per hash on the class of machine this
 * runs on — slow enough to make offline grinding expensive, fast enough that a
 * partner on a bad connection is not waiting on us. Stored in the hash string
 * so these can be raised later without invalidating everyone's password.
 */
const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 64 };
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash!, "base64url");
  const derived = await scrypt(password, Buffer.from(salt!, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  // Constant-time: a comparison that returns early leaks the hash a byte at a
  // time to anyone who can measure the response.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * What a password has to be.
 *
 * Deliberately not a complexity ritual. Requiring a capital, a digit and a
 * symbol produces `Password1!` and a sticky note; length is the property that
 * actually costs an attacker anything. Ten characters, and a short list of the
 * passwords people in this market genuinely pick first.
 */
const COMMON = new Set([
  "password", "password1", "12345678", "123456789", "1234567890", "qwertyui",
  "qwerty123", "iloveyou", "libya123", "tripoli1", "ciao1234", "admin123",
  "11111111", "00000000", "abcd1234", "welcome1",
]);

export function passwordProblem(password: string, phone?: string): string | null {
  if (password.length < 10) return "short";
  if (password.length > 200) return "long";
  /*
   * Compare with the decoration stripped. `Password1!` is `password1` wearing
   * a hat, and it is one of the most-chosen passwords on earth precisely
   * because complexity rules push people to it — a list that misses it would
   * catch only the people who were not trying.
   */
  const plain = password.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (COMMON.has(password.toLowerCase()) || COMMON.has(plain)) return "common";
  // Their own phone number is the first thing an attacker tries, and it is the
  // one string we know they know.
  if (phone && password.replace(/\D/g, "").length >= 6) {
    const digits = phone.replace(/\D/g, "");
    if (digits && password.replace(/\D/g, "").includes(digits.slice(-8))) return "phone";
  }
  return null;
}

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
    throw new CiaoError("AUTH_OTP_INVALID");
  }

  if (row.cred.lockedUntil && row.cred.lockedUntil > new Date()) {
    throw new CiaoError("AUTH_OTP_THROTTLED", {
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
    throw new CiaoError("AUTH_OTP_INVALID");
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
/**
 * A coarse device name.
 *
 * Enough for a partner to recognise "the phone I lost last week" in their
 * session list, and no more. Storing the full user-agent would put a
 * fingerprint next to a login time for no gain to the person reading it.
 */
export function deviceLabel(userAgent = ""): string {
  const ua = userAgent.toLowerCase();
  const os = ua.includes("android")
    ? "Android"
    : /iphone|ipad|ios/.test(ua)
      ? "iPhone"
      : ua.includes("windows")
        ? "Windows"
        : ua.includes("mac os")
          ? "Mac"
          : ua.includes("linux")
            ? "Linux"
            : "";
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("chrome")
      ? "Chrome"
      : ua.includes("firefox")
        ? "Firefox"
        : ua.includes("safari")
          ? "Safari"
          : "";
  return [browser, os].filter(Boolean).join(" on ") || "جهاز";
}

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
