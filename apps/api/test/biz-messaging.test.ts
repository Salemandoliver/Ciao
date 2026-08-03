/**
 * The console's messaging screen — journal, health, switches, test-send.
 *
 * Gating first: the journal holds phone numbers and movement patterns, so
 * finance (books-only) must not see it, and the test-send produces real
 * traffic on the company's sender identity, so it is `govern`-gated.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { signAccessToken } from "../src/lib/auth.js";

let app: FastifyInstance;
const run = Date.now().toString().slice(-7);
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function tokenFor(role: string, suffix: string) {
  const phone = `+21894${suffix}${run.slice(-5)}`;
  const [user] = await db.insert(schema.users).values({ phone, role }).returning();
  return signAccessToken({ sub: user!.id, role: role as never, phone }, "biz");
}

let adminToken = "";
let opsToken = "";
let finToken = "";

beforeAll(async () => {
  app = await buildApp();
  adminToken = await tokenFor("admin", "81");
  opsToken = await tokenFor("ops", "82");
  finToken = await tokenFor("finance", "83");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("GET /v1/biz/messaging", () => {
  it("reports config presence as booleans (never tokens), switches, stats and the journal", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/messaging?days=7",
      headers: auth(opsToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.config.provider).toBe("console");
    expect(typeof body.config.whatsappConfigured).toBe("boolean");
    // No secret may ride this payload, whatever the config holds.
    expect(JSON.stringify(body.config)).not.toMatch(/token|secret|sid/i);
    expect(body.switches.whatsappEnabled).toBe(true);
    expect(Array.isArray(body.journal)).toBe(true);
  });

  it("is closed to finance — the journal is phones and movement, not money", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/messaging",
      headers: auth(finToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/biz/messaging/test", () => {
  it("is govern-gated: ops is refused", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/biz/messaging/test",
      headers: auth(opsToken),
      payload: { phone: "0917000001" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("admin sends one, gets the journaled attempts back, and it lands in the audit trail", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/biz/messaging/test",
      headers: auth(adminToken),
      payload: { phone: "0917000002" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.code).toMatch(/^[A-Z0-9]{6}$/);
    // Console provider in test env: the first rung "delivers".
    expect(body.attempts.length).toBeGreaterThan(0);
    expect(body.attempts[0].deliveryStatus).toBe("sent");

    const journal = await app.inject({
      method: "GET",
      url: "/v1/biz/messaging?days=1",
      headers: auth(adminToken),
    });
    const rows = journal.json().journal as { templateKey: string; toPhone: string }[];
    expect(rows.some((r) => r.templateKey === "test_message" && r.toPhone === "+218917000002")).toBe(
      true,
    );
  });
});

describe("GET /v1/biz/messaging/templates", () => {
  it("lists every template with its Meta name, ready for the submission doc", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/messaging/templates",
      headers: auth(opsToken),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { key: string; waName: string; ar: string }[];
    const otp = items.find((i) => i.key === "otp")!;
    expect(otp.waName).toBe("ciao_otp");
    expect(otp.ar).toContain("{{code}}");
    expect(items.length).toBeGreaterThan(10);
  });
});
