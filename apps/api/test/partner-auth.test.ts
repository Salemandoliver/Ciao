/**
 * Partner sign-in — the contract for the most attacked surface in the product.
 *
 * Ordered by what each failure would cost:
 *
 *  - a marketplace token that works on the control panel, or the reverse:
 *    every guest who hosts a venue would be able to drive their own business's
 *    money screens from a session they got by typing an SMS code;
 *  - a login form that answers differently for an unknown number and a wrong
 *    password, which turns it into a directory of Libyan businesses;
 *  - unlimited guesses at one account, since the payout destination behind it
 *    is worth the effort;
 *  - a set-password link that can be replayed, or pointed at somebody else;
 *  - a password change that leaves the attacker's session alive.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { signAccessToken, signActionToken, verifyAccessToken } from "../src/lib/auth.js";
import {
  deviceLabel,
  hashPassword,
  passwordProblem,
  setPassword,
  verifyPassword,
} from "../src/modules/partner/auth.js";

let app: FastifyInstance;
const run = Date.now().toString().slice(-7);
const phone = `+2189480${run.slice(-5)}`;
const localPhone = `0${phone.slice(4)}`;
const GOOD = "janzour-chalet-2026";

let userId = "";
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

/**
 * Log in over HTTP as a distinct client.
 *
 * The login route is capped at 10 attempts per IP per 10 minutes, which is a
 * real control and not something to switch off for the suite. Each of these
 * calls represents a different person on a different phone, so each gets its
 * own address — which is what the limiter is measuring.
 */
let client = 0;
function asNewClient(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  client += 1;
  return {
    method: "POST" as const,
    url: "/v1/partner/auth/login",
    remoteAddress: `10.9.${Math.floor(client / 250)}.${client % 250}`,
    headers,
    payload,
  };
}

beforeAll(async () => {
  app = await buildApp();
  const [user] = await db
    .insert(schema.users)
    .values({ phone, role: "host", displayName: "auth-test" })
    .returning();
  userId = user!.id;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

// ------------------------------------------------------------------ hashing
describe("password storage", () => {
  it("never stores the password, and verifies what it did store", async () => {
    const hash = await hashPassword(GOOD);
    expect(hash).not.toContain(GOOD);
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword(GOOD, hash)).toBe(true);
    expect(await verifyPassword(GOOD + "x", hash)).toBe(false);
  });

  it("salts, so two identical passwords do not share a hash", async () => {
    // Without this, one cracked password cracks every account that chose it.
    expect(await hashPassword(GOOD)).not.toBe(await hashPassword(GOOD));
  });

  it("refuses a garbled hash rather than throwing", async () => {
    expect(await verifyPassword(GOOD, "not-a-hash")).toBe(false);
    expect(await verifyPassword(GOOD, "scrypt$1$2$3$4")).toBe(false);
  });

  it("judges passwords on length, and knows the two everyone tries", () => {
    expect(passwordProblem("short")).toBe("short");
    expect(passwordProblem("password1")).toBe("short");
    expect(passwordProblem("11111111111")).toBe(null);
    expect(passwordProblem("Password1!")).toBe("common"); // decoration stripped
    // Their own number is the first guess anyone makes.
    expect(passwordProblem(`my${localPhone}pass`, phone)).toBe("phone");
    expect(passwordProblem(GOOD, phone)).toBe(null);
  });

  it("labels a device without keeping a fingerprint", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 13) Chrome/120")).toBe("Chrome on Android");
    expect(deviceLabel("")).toBe("جهاز");
  });
});

// ------------------------------------------------------------------ audiences
describe("the two products cannot borrow each other's sessions", () => {
  it("refuses a marketplace token on a partner route", async () => {
    const guestToken = await signAccessToken({ sub: userId, role: "host", phone });
    const res = await app.inject({
      method: "GET",
      url: "/v1/partner/me",
      headers: auth(guestToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a partner token on a marketplace route", async () => {
    const partnerToken = await signAccessToken({ sub: userId, role: "host", phone }, "partner");
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: auth(partnerToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("still accepts a legacy token with no audience as a marketplace one", async () => {
    // Access tokens issued before the partner app existed carry no `aud`.
    // Rejecting them would have signed out every guest at the moment of
    // deploy; reading them as `app` is safe, reading them as `partner` would
    // not be.
    const legacy = await signAccessToken({ sub: userId, role: "host", phone });
    const claims = await verifyAccessToken(legacy, "app");
    expect(claims.sub).toBe(userId);
    await expect(verifyAccessToken(legacy, "partner")).rejects.toThrow();
  });
});

// ------------------------------------------------------------------ set password
describe("choosing a password", () => {
  it("works once from an invite link, and never again", async () => {
    const token = await signActionToken({
      scope: `partner_set_password:${userId}`,
      userId,
      ttlSeconds: 600,
    });

    const check = await app.inject({
      method: "GET",
      url: `/v1/partner/auth/set-password/check?token=${encodeURIComponent(token)}`,
    });
    expect(check.json().valid).toBe(true);
    // Checking must not consume: opening the page twice would otherwise lock a
    // partner out of their own account.
    const again = await app.inject({
      method: "GET",
      url: `/v1/partner/auth/set-password/check?token=${encodeURIComponent(token)}`,
    });
    expect(again.json().valid).toBe(true);

    const set = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/set-password",
      payload: { token, password: GOOD },
    });
    expect(set.statusCode).toBe(200);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/set-password",
      payload: { token, password: "another-long-password" },
    });
    expect(replay.statusCode).toBe(401);
  });

  it("refuses a weak password, and says why in both languages", async () => {
    const [other] = await db
      .insert(schema.users)
      .values({ phone: `+2189481${run.slice(-5)}`, role: "host" })
      .returning();
    const token = await signActionToken({
      scope: `partner_set_password:${other!.id}`,
      userId: other!.id,
      ttlSeconds: 600,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/set-password",
      payload: { token, password: "short" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.detail.ar).toBeTruthy();
    expect(res.json().error.detail.en).toBeTruthy();
  });

  it("refuses a token minted for a different scope", async () => {
    // A booking-confirmation token is also signed with the action key. Without
    // the scope check it would set somebody's password.
    const wrong = await signActionToken({
      scope: `host_confirm:${userId}`,
      userId,
      ttlSeconds: 600,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/set-password",
      payload: { token: wrong, password: GOOD },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ------------------------------------------------------------------ login
describe("signing in", () => {
  it("signs in and hands back a partner-audience token", async () => {
    const res = await app.inject(asNewClient({ phone: localPhone, password: GOOD }));
    expect(res.statusCode).toBe(200);
    const claims = await verifyAccessToken(res.json().accessToken, "partner");
    expect(claims.sub).toBe(userId);
    expect(res.json().refreshToken).toBeTruthy();
  });

  it("answers identically for a wrong password and an unknown number", async () => {
    const wrongPassword = await app.inject(asNewClient({ phone: localPhone, password: "definitely-not-it" }));
    const unknownNumber = await app.inject(asNewClient({ phone: "0915550000", password: "definitely-not-it" }));
    // Same status, same code, same message — anything else is a way of asking
    // which Libyan businesses have accounts.
    expect(wrongPassword.statusCode).toBe(unknownNumber.statusCode);
    expect(wrongPassword.json().error.code).toBe(unknownNumber.json().error.code);
    expect(wrongPassword.json().error.message).toBe(unknownNumber.json().error.message);
  });

  it("locks the account after repeated guesses, then refuses the right password too", async () => {
    const [victim] = await db
      .insert(schema.users)
      .values({ phone: `+2189482${run.slice(-5)}`, role: "host" })
      .returning();
    await setPassword(victim!.id, GOOD);
    const victimPhone = `0${victim!.phone.slice(4)}`;

    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/v1/partner/auth/login",
        payload: { phone: victimPhone, password: `guess-${i}` },
      });
    }
    const [cred] = await db
      .select()
      .from(schema.partnerCredentials)
      .where(eq(schema.partnerCredentials.userId, victim!.id));
    expect(cred!.failedAttempts).toBeGreaterThanOrEqual(5);
    expect(cred!.lockedUntil).toBeTruthy();

    // The correct password is refused while locked — otherwise the lockout
    // only inconveniences the person who already knows it.
    const res = await app.inject(asNewClient({ phone: victimPhone, password: GOOD }));
    expect(res.statusCode).toBe(429);

    // And a successful reset clears it, so the real owner is not locked out by
    // someone else's failed guesses.
    await setPassword(victim!.id, "a-brand-new-long-password");
    const after = await app.inject(asNewClient({ phone: victimPhone, password: "a-brand-new-long-password" }));
    expect(after.statusCode).toBe(200);
  });

  it("refuses a disabled account", async () => {
    const [banned] = await db
      .insert(schema.users)
      .values({ phone: `+2189483${run.slice(-5)}`, role: "host", disabled: true })
      .returning();
    await setPassword(banned!.id, GOOD);
    const res = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/login",
      payload: { phone: `0${banned!.phone.slice(4)}`, password: GOOD },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ------------------------------------------------------------------ sessions
describe("sessions", () => {
  it("rotates on refresh, and a replayed token is dead", async () => {
    const login = await app.inject(asNewClient({ phone: localPhone, password: GOOD }));
    const first = login.json().refreshToken;

    const rotated = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/refresh",
      payload: { refreshToken: first },
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().refreshToken).not.toBe(first);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/refresh",
      payload: { refreshToken: first },
    });
    expect(replay.statusCode).toBe(401);
  });

  it("lists devices, and signing out one leaves the others alone", async () => {
    const a = await app.inject(asNewClient({ phone: localPhone, password: GOOD }, { "user-agent": "Mozilla/5.0 (Linux; Android 13) Chrome/120" }));
    const b = await app.inject(asNewClient({ phone: localPhone, password: GOOD }, { "user-agent": "Mozilla/5.0 (iPhone) Safari/17" }));

    const list = await app.inject({
      method: "GET",
      url: `/v1/partner/auth/sessions?current=${encodeURIComponent(a.json().refreshToken)}`,
      headers: auth(a.json().accessToken),
    });
    const items = list.json().items as { id: string; current: boolean; deviceLabel: string }[];
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.some((s) => s.current)).toBe(true);
    expect(items.some((s) => s.deviceLabel === "Safari on iPhone")).toBe(true);

    const other = items.find((s) => !s.current)!;
    const killed = await app.inject({
      method: "DELETE",
      url: `/v1/partner/auth/sessions/${other.id}`,
      headers: auth(a.json().accessToken),
    });
    expect(killed.statusCode).toBe(200);

    // The one we were holding still works.
    const stillAlive = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/refresh",
      payload: { refreshToken: a.json().refreshToken },
    });
    expect(stillAlive.statusCode).toBe(200);
    void b;
  });

  it("cannot revoke somebody else's session", async () => {
    const [stranger] = await db
      .insert(schema.users)
      .values({ phone: `+2189484${run.slice(-5)}`, role: "host" })
      .returning();
    await setPassword(stranger!.id, GOOD);
    const theirs = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/login",
      payload: { phone: `0${stranger!.phone.slice(4)}`, password: GOOD },
    });
    const theirSessions = await app.inject({
      method: "GET",
      url: "/v1/partner/auth/sessions",
      headers: auth(theirs.json().accessToken),
    });
    const theirId = theirSessions.json().items[0].id;

    const mine = await app.inject(asNewClient({ phone: localPhone, password: GOOD }));
    const attempt = await app.inject({
      method: "DELETE",
      url: `/v1/partner/auth/sessions/${theirId}`,
      headers: auth(mine.json().accessToken),
    });
    expect(attempt.statusCode).toBe(403);
  });

  it("changing the password kills every other session", async () => {
    // If it did not, a reset prompted by "someone else is in my account" would
    // be theatre — the attacker's session would outlive it.
    const stale = await app.inject(asNewClient({ phone: localPhone, password: GOOD }));
    const active = await app.inject(asNewClient({ phone: localPhone, password: GOOD }));

    const changed = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/change-password",
      headers: auth(active.json().accessToken),
      payload: { current: GOOD, next: "a-completely-different-one" },
    });
    expect(changed.statusCode).toBe(200);
    // The caller is handed a fresh pair rather than being bounced to login for
    // doing the right thing.
    expect(changed.json().refreshToken).toBeTruthy();

    const dead = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/refresh",
      payload: { refreshToken: stale.json().refreshToken },
    });
    expect(dead.statusCode).toBe(401);

    // Put it back for any test that runs after this one.
    await setPassword(userId, GOOD);
  });

  it("refuses a password change without the current password", async () => {
    const session = await app.inject(asNewClient({ phone: localPhone, password: GOOD }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/change-password",
      headers: auth(session.json().accessToken),
      payload: { current: "not-the-current-one", next: "a-perfectly-fine-password" },
    });
    // An open session must not be an unlimited oracle for guessing the
    // current password.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

// ------------------------------------------------------------------ recovery
describe("recovery", () => {
  it("never reveals whether a number has an account", async () => {
    const known = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/forgot",
      payload: { phone: localPhone },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/forgot",
      payload: { phone: "0915559999" },
    });
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(known.json().ok).toBe(true);
    expect(unknown.json().ok).toBe(true);
  });

  it("turns a valid code into a set-password token", async () => {
    const asked = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/forgot",
      payload: { phone: localPhone },
    });
    const code = asked.json().devCode as string;
    expect(code).toBeTruthy(); // demo mode echoes it

    const wrong = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/forgot/verify",
      payload: { phone: localPhone, code: "000000" },
    });
    expect(wrong.statusCode).toBe(401);

    const right = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/forgot/verify",
      payload: { phone: localPhone, code },
    });
    expect(right.statusCode).toBe(200);
    expect(right.json().token).toBeTruthy();

    // And the code is spent.
    const reuse = await app.inject({
      method: "POST",
      url: "/v1/partner/auth/forgot/verify",
      payload: { phone: localPhone, code },
    });
    expect(reuse.statusCode).toBe(401);
  });
});

// ------------------------------------------------------------------ invites
describe("ops invites", () => {
  it("issues a set-password link and is closed to non-ops", async () => {
    const [admin] = await db
      .insert(schema.users)
      .values({ phone: `+2189485${run.slice(-5)}`, role: "admin" })
      .returning();
    const adminToken = await signAccessToken({
      sub: admin!.id,
      role: "admin",
      phone: admin!.phone,
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/biz/partners/${userId}/invite`,
      headers: auth(adminToken),
      payload: { send: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().link).toContain("/set-password?token=");

    // A partner cannot mint invites — that would be a way to attach a password
    // to somebody else's business.
    const partnerToken = await signAccessToken(
      { sub: userId, role: "host", phone },
      "partner",
    );
    const denied = await app.inject({
      method: "POST",
      url: `/v1/biz/partners/${userId}/invite`,
      headers: auth(partnerToken),
      payload: { send: false },
    });
    expect(denied.statusCode).toBe(403);
  });
});
