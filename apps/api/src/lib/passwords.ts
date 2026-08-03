/**
 * Password primitives shared by the two password products — the partner
 * console and the business console.
 *
 * Extracted from the partner module the day the business console became a
 * standalone app, for the reason shared code always gets extracted here: two
 * copies of a hash routine or a strength rule drift on the day one of them
 * gets a fix, and a drifted password rule is a security property that quietly
 * holds on one product and not the other.
 *
 * Everything in this file is pure or stateless — hashing, verifying, judging
 * strength, labelling a device. Session and lockout state is product-specific
 * (separate tables, separate audiences) and stays in each product's module.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

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

/** One sentence per refusal, in both languages, so the form can explain itself. */
export const PASSWORD_MESSAGES: Record<string, { ar: string; en: string }> = {
  short: {
    ar: "كلمة السر لازم تكون ١٠ حروف أو أكثر — الطول أهم من الرموز.",
    en: "Your password must be at least 10 characters — length matters more than symbols.",
  },
  long: { ar: "كلمة السر طويلة جدًا.", en: "That password is too long." },
  common: {
    ar: "كلمة السر هذي من أكثر الكلمات استعمالًا — اختر غيرها.",
    en: "That's one of the most commonly used passwords — pick another.",
  },
  phone: {
    ar: "لا تستعمل رقم تلفونك في كلمة السر — هو أول شيء يُجرَّب.",
    en: "Don't put your phone number in your password — it's the first thing anyone tries.",
  },
};

/**
 * A coarse device name.
 *
 * Enough for a person to recognise "the phone I lost last week" in their
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
