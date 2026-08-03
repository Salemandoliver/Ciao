/**
 * Business-console sign-in — the contract for the surface with the most power.
 *
 * Ordered by what each failure would cost:
 *
 *  - a marketplace or partner token that works on the console, or the reverse:
 *    the console holds the fee schedule, the role grants and the settlement
 *    buttons, so a crossed session here is the whole company;
 *  - a login form that answers differently for an unknown number, a wrong
 *    password, or a demoted operator's stale credential — a directory of who
 *    works at Ciao;
 *  - unlimited guesses at one account;
 *  - a finance role that can quietly do ops work, or an ops role that can
 *    quietly govern;
 *  - an invite that can be replayed, pointed at a non-team account, or minted
 *    by someone below admin;
 *  - a password change or role demotion that leaves the old sessions alive.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { signAccessToken, signActionToken } from "../src/lib/auth.js";
import { setBizPassword } from "../src/modules/business/auth.js";
import { bizCan, bizCapabilitiesFor, isBizRole } from "@ciao/shared";

let app: FastifyInstance;
const run = Date.now().toString().slice(-7);
const GOOD = "gargaresh-console-2026";

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

let adminId = "";
let adminPhone = "";
let opsId = "";
let opsPhone = "";
let finId = "";
let finPhone = "";

/**
 * Log in over HTTP as a distinct client. The login route is capped per IP —
 * a real control, not something to switch off — so each call presents as a
 * different address, which is what the limiter is measuring.
 */
let client = 0;
function asNewClient(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  client += 1;
  return {
    method: "POST" as const,
    url: "/v1/biz/auth/login",
    remoteAddress: `10.11.${Math.floor(client / 250)}.${client % 250}`,
    headers,
    payload,
  };
}

async function makeUser(role: string, suffix: string) {
  const phone = `+21894${suffix}${run.slice(-5)}`;
  const [user] = await db.insert(schema.users).values({ phone, role }).returning();
  return { id: user!.id, phone };
}

beforeAll(async () => {
  app = await buildApp();
  const admin = await makeUser("admin", "60");
  adminId = admin.id;
  adminPhone = admin.phone;
  const ops = await makeUser("ops", "61");
  opsId = ops.id;
  opsPhone = ops.phone;
  const fin = await makeUser("finance", "62");
  finId = fin.id;
  finPhone = fin.phone;
  await setBizPassword(adminId, GOOD);
  await setBizPassword(opsId, GOOD);
  await setBizPassword(finId, GOOD);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

async function loginToken(phone: string): Promise<{ access: string; refresh: string }> {
  const res = await app.inject(asNewClient({ phone, password: GOOD }));
  expect(res.statusCode).toBe(200);
  const body = res.json();
  return { access: body.accessToken, refresh: body.refreshToken };
}

// ---------------------------------------------------------------- audiences
describe("product separation", () => {
  it("refuses a marketplace token on every console route, and a console token on the other products", async () => {
    const appToken = await signAccessToken({ sub: adminId, role: "admin", phone: adminPhone });
    const partnerToken = await signAccessToken(
      { sub: adminId, role: "admin", phone: adminPhone },
      "partner",
    );
    for (const token of [appToken, partnerToken]) {
      const res = await app.inject({
        method: "GET",
        url: "/v1/biz/overview?days=1",
        headers: auth(token),
      });
      expect(res.statusCode).toBe(403);
    }

    const bizToken = await signAccessToken(
      { sub: adminId, role: "admin", phone: adminPhone },
      "biz",
    );
    const onApp = await app.inject({ method: "GET", url: "/v1/me", headers: auth(bizToken) });
    expect(onApp.statusCode).toBe(403);
    const onPartner = await app.inject({
      method: "GET",
      url: "/v1/partner/me",
      headers: auth(bizToken),
    });
    expect(onPartner.statusCode).toBe(403);
  });

  it("never reads a legacy token (no audience) as a console token", async () => {
    // Legacy tokens predate audiences and must keep meaning `app`, only `app`.
    const { SignJWT } = await import("jose");
    const key = new TextEncoder().encode(process.env.JWT_SECRET ?? "dev-jwt-secret-change-me");
    const legacy = await new SignJWT({ role: "admin", phone: adminPhone })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(adminId)
      .setIssuedAt()
      .setIssuer("ciao.ly")
      .setExpirationTime("15m")
      .sign(key);
    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/overview?days=1",
      headers: auth(legacy),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ------------------------------------------------------------------- login
describe("login", () => {
  it("signs a team member in and reports their role", async () => {
    const res = await app.inject(asNewClient({ phone: adminPhone, password: GOOD }));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe("admin");
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });

  it("answers identically for an unknown number, a wrong password, and a non-team account", async () => {
    const unknown = await app.inject(
      asNewClient({ phone: `+2189499${run.slice(-5)}`, password: GOOD }),
    );
    const wrong = await app.inject(asNewClient({ phone: adminPhone, password: "not-the-password" }));

    // A guest with a stale console credential — the row exists, the role is
    // gone — must be indistinguishable from a number we have never seen.
    const ghost = await makeUser("guest", "63");
    await setBizPassword(ghost.id, GOOD);
    const demoted = await app.inject(asNewClient({ phone: ghost.phone, password: GOOD }));

    for (const res of [unknown, wrong, demoted]) {
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("CIAO-1005");
    }
    expect(unknown.json().error.message).toBe(wrong.json().error.message);
    expect(wrong.json().error.message).toBe(demoted.json().error.message);
  });

  it("locks the account after five bad guesses, and refuses the CORRECT password while locked", async () => {
    const victim = await makeUser("ops", "64");
    await setBizPassword(victim.id, GOOD);
    for (let i = 0; i < 5; i++) {
      await app.inject(asNewClient({ phone: victim.phone, password: `guess-${i}-long` }));
    }
    const locked = await app.inject(asNewClient({ phone: victim.phone, password: GOOD }));
    expect(locked.statusCode).toBe(429);
    // The lockout speaks its own language — not the OTP limiter's "wait a minute".
    expect(locked.json().error.code).toBe("CIAO-1006");
  });
});

// ------------------------------------------------------------- capabilities
describe("the capability matrix", () => {
  it("is the shared matrix, exactly", () => {
    expect(isBizRole("finance")).toBe(true);
    expect(isBizRole("host")).toBe(false);
    expect(bizCan("finance", "finance")).toBe(true);
    expect(bizCan("finance", "catalogue")).toBe(false);
    expect(bizCan("ops", "govern")).toBe(false);
    expect(bizCan("admin", "govern")).toBe(true);
    expect(bizCapabilitiesFor("guest")).toEqual([]);
  });

  it("lets finance read the books and nothing else", async () => {
    const { access } = await loginToken(finPhone);
    const money = await app.inject({
      method: "GET",
      url: "/v1/biz/finance?days=30",
      headers: auth(access),
    });
    expect(money.statusCode).toBe(200);

    const catalogue = await app.inject({
      method: "GET",
      url: "/v1/biz/businesses",
      headers: auth(access),
    });
    expect(catalogue.statusCode).toBe(403);

    const people = await app.inject({ method: "GET", url: "/v1/biz/users", headers: auth(access) });
    expect(people.statusCode).toBe(403);

    const settingsWrite = await app.inject({
      method: "PUT",
      url: "/v1/biz/settings",
      headers: auth(access),
      payload: { patch: { "ops.demoMode": true } },
    });
    expect(settingsWrite.statusCode).toBe(403);
  });

  it("lets ops operate but never govern", async () => {
    const { access } = await loginToken(opsPhone);
    const catalogue = await app.inject({
      method: "GET",
      url: "/v1/biz/businesses",
      headers: auth(access),
    });
    expect(catalogue.statusCode).toBe(200);

    const settingsWrite = await app.inject({
      method: "PUT",
      url: "/v1/biz/settings",
      headers: auth(access),
      payload: { patch: { "ops.demoMode": true } },
    });
    expect(settingsWrite.statusCode).toBe(403);

    const roleChange = await app.inject({
      method: "PATCH",
      url: `/v1/biz/users/${finId}/role`,
      headers: auth(access),
      payload: { role: "ops" },
    });
    expect(roleChange.statusCode).toBe(403);
  });
});

// ----------------------------------------------------------------- invites
describe("team invites", () => {
  it("admin invites a team member; ops cannot; a guest target is refused", async () => {
    const target = await makeUser("finance", "65");
    const { access: adminAccess } = await loginToken(adminPhone);
    const res = await app.inject({
      method: "POST",
      url: `/v1/biz/team/${target.id}/invite`,
      headers: auth(adminAccess),
      payload: { send: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().link).toContain("/set-password?token=");

    const { access: opsAccess } = await loginToken(opsPhone);
    const denied = await app.inject({
      method: "POST",
      url: `/v1/biz/team/${target.id}/invite`,
      headers: auth(opsAccess),
      payload: { send: false },
    });
    expect(denied.statusCode).toBe(403);

    // Inviting someone without a console role must refuse, not quietly grant.
    const guest = await makeUser("guest", "66");
    const refused = await app.inject({
      method: "POST",
      url: `/v1/biz/team/${guest.id}/invite`,
      headers: auth(adminAccess),
      payload: { send: false },
    });
    expect(refused.statusCode).toBe(403);
  });

  it("a set-password link works once, refuses weak passwords, and kills existing sessions", async () => {
    const target = await makeUser("ops", "67");
    await setBizPassword(target.id, GOOD);
    const { access: targetAccess } = await loginToken(target.phone);

    const token = await signActionToken({
      scope: `biz_set_password:${target.id}`,
      userId: target.id,
      ttlSeconds: 3600,
    });

    const weak = await app.inject({
      method: "POST",
      url: "/v1/biz/auth/set-password",
      payload: { token, password: "short" },
    });
    expect(weak.statusCode).toBe(400);

    // The weak attempt consumed the token (atomic consume) — mint a fresh one,
    // as the real flow would after a refused password.
    const token2 = await signActionToken({
      scope: `biz_set_password:${target.id}`,
      userId: target.id,
      ttlSeconds: 3600,
    });
    const ok = await app.inject({
      method: "POST",
      url: "/v1/biz/auth/set-password",
      payload: { token: token2, password: "sirt-console-2026" },
    });
    expect(ok.statusCode).toBe(200);

    // Replay is dead.
    const replay = await app.inject({
      method: "POST",
      url: "/v1/biz/auth/set-password",
      payload: { token: token2, password: "another-fine-password" },
    });
    expect(replay.statusCode).toBe(401);

    // The pre-reset session is dead too — a reset that leaves the attacker's
    // session alive is theatre.
    const after = await app.inject({
      method: "GET",
      url: "/v1/biz/auth/sessions",
      headers: auth(targetAccess),
    });
    // The access token itself lives ≤15 min; the session list must not show a
    // live session other than none (all were revoked).
    expect(after.json().items ?? []).toHaveLength(0);
  });

  it("a link scoped to a user who lost their role is worthless", async () => {
    const target = await makeUser("ops", "68");
    const token = await signActionToken({
      scope: `biz_set_password:${target.id}`,
      userId: target.id,
      ttlSeconds: 3600,
    });
    await db.update(schema.users).set({ role: "guest" }).where(eq(schema.users.id, target.id));
    const res = await app.inject({
      method: "POST",
      url: "/v1/biz/auth/set-password",
      payload: { token, password: "misrata-console-2026" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------- sessions
describe("sessions", () => {
  it("rotates the refresh token and kills the replayed one", async () => {
    const { refresh } = await loginToken(opsPhone);
    const first = await app.inject({
      method: "POST",
      url: "/v1/biz/auth/refresh",
      payload: { refreshToken: refresh },
    });
    expect(first.statusCode).toBe(200);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/biz/auth/refresh",
      payload: { refreshToken: refresh },
    });
    expect(replay.statusCode).toBe(401);
  });

  it("stops rotating the moment the role is gone — a demotion lands in minutes, not weeks", async () => {
    const target = await makeUser("ops", "69");
    await setBizPassword(target.id, GOOD);
    const { refresh } = await loginToken(target.phone);
    await db.update(schema.users).set({ role: "guest" }).where(eq(schema.users.id, target.id));
    const res = await app.inject({
      method: "POST",
      url: "/v1/biz/auth/refresh",
      payload: { refreshToken: refresh },
    });
    expect(res.statusCode).toBe(401);
  });

  it("a role change by admin revokes the demoted operator's sessions immediately", async () => {
    const target = await makeUser("ops", "71");
    await setBizPassword(target.id, GOOD);
    const { access: targetAccess } = await loginToken(target.phone);

    const { access: adminAccess } = await loginToken(adminPhone);
    const change = await app.inject({
      method: "PATCH",
      url: `/v1/biz/users/${target.id}/role`,
      headers: auth(adminAccess),
      payload: { role: "host" },
    });
    expect(change.statusCode).toBe(200);

    const sessions = await app.inject({
      method: "GET",
      url: "/v1/biz/auth/sessions",
      headers: auth(targetAccess),
    });
    // The still-live access token (≤15 min) sees its own sessions all revoked.
    expect(sessions.json().items ?? []).toHaveLength(0);
  });

  it("lists devices, revokes one, revokes all — and never someone else's", async () => {
    const a = await loginToken(finPhone);
    const b = await loginToken(finPhone);
    void b;
    const list = await app.inject({
      method: "GET",
      url: `/v1/biz/auth/sessions?current=${a.refresh}`,
      headers: auth(a.access),
    });
    expect(list.statusCode).toBe(200);
    const items = list.json().items as { id: string; current: boolean }[];
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.some((s) => s.current)).toBe(true);

    const other = items.find((s) => !s.current)!;
    const revoke = await app.inject({
      method: "DELETE",
      url: `/v1/biz/auth/sessions/${other.id}`,
      headers: auth(a.access),
    });
    expect(revoke.statusCode).toBe(200);

    // Another user cannot revoke it.
    const { access: opsAccess } = await loginToken(opsPhone);
    const foreign = await app.inject({
      method: "DELETE",
      url: `/v1/biz/auth/sessions/${items.find((s) => s.current)!.id}`,
      headers: auth(opsAccess),
    });
    expect(foreign.statusCode).toBe(403);

    const all = await app.inject({
      method: "POST",
      url: "/v1/biz/auth/sessions/revoke-all",
      headers: auth(a.access),
    });
    expect(all.statusCode).toBe(200);
  });

  it("changing your password revokes everything and hands back a fresh pair", async () => {
    const target = await makeUser("admin", "72");
    await setBizPassword(target.id, GOOD);
    const { access, refresh } = await loginToken(target.phone);
    const res = await app.inject({
      method: "POST",
      url: "/v1/biz/auth/change-password",
      remoteAddress: `10.12.0.${(client += 1) % 250}`,
      headers: auth(access),
      payload: { current: GOOD, next: "benghazi-console-2026" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeTruthy();

    // The old refresh token is dead.
    const dead = await app.inject({
      method: "POST",
      url: "/v1/biz/auth/refresh",
      payload: { refreshToken: refresh },
    });
    expect(dead.statusCode).toBe(401);
  });
});

// ------------------------------------------------------------------ roster
describe("the team roster", () => {
  it("shows credential state to people-capable roles, and is closed to finance", async () => {
    const { access: opsAccess } = await loginToken(opsPhone);
    const res = await app.inject({ method: "GET", url: "/v1/biz/team", headers: auth(opsAccess) });
    expect(res.statusCode).toBe(200);
    const me = (res.json().items as { id: string; hasPassword: boolean }[]).find(
      (i) => i.id === opsId,
    );
    expect(me?.hasPassword).toBe(true);

    const { access: finAccess } = await loginToken(finPhone);
    const denied = await app.inject({
      method: "GET",
      url: "/v1/biz/team",
      headers: auth(finAccess),
    });
    expect(denied.statusCode).toBe(403);
  });
});
