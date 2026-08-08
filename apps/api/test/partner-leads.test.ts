/**
 * Partner interest — the public form and the ops queue.
 *
 * The public route is unauthenticated by necessity, so most of what is worth
 * testing here is what it refuses: a lead without a verified phone, a lead
 * that reveals whether a number is already on the list, and a second agent
 * claiming a row the first one already took.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { signAccessToken } from "../src/lib/auth.js";

let app: FastifyInstance;
const run = Date.now().toString().slice(-8);
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

/**
 * A ten-digit Libyan number nobody else in the suite will touch: `09`, a
 * two-digit tag for the case, and six digits off the clock. Anything shorter
 * is rejected by `isValidPhoneInput` before the route is even reached, which
 * makes for a confusing 400 that looks nothing like the thing under test.
 */
const phoneFor = (n: string) => `09${n}${run.slice(-6)}`;

async function tokenFor(role: string, suffix: string) {
  const phone = `+21895${suffix}${run.slice(-5)}`;
  const [user] = await db
    .insert(schema.users)
    .values({ phone, role, displayName: `Agent ${suffix}` })
    .returning();
  const token = await signAccessToken({ sub: user!.id, role: role as never, phone }, "biz");
  return { token, id: user!.id };
}

/*
 * Each code request arrives from its own address.
 *
 * `/v1/auth/otp/request` allows 5 per 10 minutes per IP and that cap is
 * deliberately NOT relaxed under test — it is one of the limits worth having.
 * So this file does what the suite's convention says: it presents as distinct
 * clients rather than exempting itself. `error-handler.test.ts` proves the
 * limiter still bites, from a single address, and that test would stop meaning
 * anything if this one had turned the cap off.
 */
let client = 0;
const nextClient = () => `10.0.${Math.floor(client / 250) % 250}.${(client++ % 250) + 1}`;

/**
 * Submitting is capped too (10 per 10 minutes per IP), and for the same reason
 * as the code request: this is the route that protects the ops queue. So every
 * submission in this file also arrives from its own address.
 */
function submitLead(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/partner-leads",
    payload,
    remoteAddress: nextClient(),
  });
}

/** Pull the code out of the dev echo, the way the login screen does. */
async function requestCode(phone: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/request",
    payload: { phone },
    remoteAddress: nextClient(),
  });
  expect(res.statusCode).toBe(200);
  const code = res.json().devCode;
  expect(typeof code).toBe("string");
  return code as string;
}

let opsToken = "";
let ops2Token = "";
let finToken = "";

beforeAll(async () => {
  app = await buildApp();
  opsToken = (await tokenFor("ops", "71")).token;
  ops2Token = (await tokenFor("ops", "72")).token;
  finToken = (await tokenFor("finance", "73")).token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("POST /v1/partner-leads", () => {
  it("records a lead once the phone is confirmed by code", async () => {
    const phone = phoneFor("11");
    const code = await requestCode(phone);
    const res = await submitLead({ name: "Haj Mustafa", phone, code, surface: "home", locale: "ar" });
    expect(res.statusCode).toBe(201);

    const [row] = await db
      .select()
      .from(schema.partnerLeads)
      .where(eq(schema.partnerLeads.phone, `+218${phone.slice(1)}`));
    expect(row?.name).toBe("Haj Mustafa");
    expect(row?.status).toBe("new");
    expect(row?.surface).toBe("home");
  });

  it("refuses a lead whose phone was never confirmed", async () => {
    const phone = phoneFor("12");
    const res = await submitLead({ name: "No Code", phone, code: "000000", surface: "home", locale: "ar" });
    expect(res.statusCode).toBe(401);
    const rows = await db
      .select()
      .from(schema.partnerLeads)
      .where(eq(schema.partnerLeads.phone, `+218${phone.slice(1)}`));
    expect(rows).toHaveLength(0);
  });

  it("refuses a code issued for a different number", async () => {
    const mine = phoneFor("13");
    const theirs = phoneFor("14");
    const code = await requestCode(theirs);
    const res = await submitLead({ name: "Wrong Number", phone: mine, code, surface: "home", locale: "ar" });
    expect(res.statusCode).toBe(401);
  });

  it("burns the code, so one confirmation cannot seed two leads", async () => {
    const phone = phoneFor("15");
    const code = await requestCode(phone);
    const first = await submitLead({ name: "Once", phone, code });
    expect(first.statusCode).toBe(201);
    const second = await submitLead({ name: "Twice", phone, code });
    expect(second.statusCode).toBe(401);
  });

  it("answers a repeat submission exactly as a first one, and does not duplicate the row", async () => {
    const phone = phoneFor("16");
    const e164 = `+218${phone.slice(1)}`;

    const a = await submitLead({ name: "First Name", phone, code: await requestCode(phone) });
    const b = await submitLead({ name: "Second Name", phone, code: await requestCode(phone) });

    // Byte-identical shape: this endpoint must not become a way to ask
    // whether a number is already on the list.
    expect(b.statusCode).toBe(a.statusCode);
    expect(Object.keys(b.json()).sort()).toEqual(Object.keys(a.json()).sort());

    const rows = await db
      .select()
      .from(schema.partnerLeads)
      .where(eq(schema.partnerLeads.phone, e164));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Second Name");
    expect(rows[0]?.lastSeenAt).not.toBeNull();
  });

  it("never creates a user account or issues a session", async () => {
    const phone = phoneFor("17");
    const e164 = `+218${phone.slice(1)}`;
    const res = await submitLead({ name: "Not A Member", phone, code: await requestCode(phone) });
    expect(res.statusCode).toBe(201);
    // The whole payload, checked: no token of any kind rides this response.
    expect(JSON.stringify(res.json())).not.toMatch(/token/i);
    const users = await db.select().from(schema.users).where(eq(schema.users.phone, e164));
    expect(users).toHaveLength(0);
  });

  it("keeps the lead's name and number out of the events table", async () => {
    const phone = phoneFor("18");
    await submitLead({ name: "Private Person", phone, code: await requestCode(phone), surface: "about" });
    // track() is fire-and-forget, so give it a tick to land.
    await new Promise((r) => setTimeout(r, 250));
    const [ev] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.name, "lead.submitted"))
      .orderBy(desc(schema.events.ts))
      .limit(1);
    const props = JSON.stringify(ev?.props ?? {});
    expect(props).not.toMatch(/Private Person/);
    expect(props).not.toMatch(/\d{7}/);
  });
});

describe("the console queue", () => {
  async function seedLead(suffix: string, name: string) {
    const phone = phoneFor(suffix);
    await submitLead({ name, phone, code: await requestCode(phone) });
    const [row] = await db
      .select()
      .from(schema.partnerLeads)
      .where(eq(schema.partnerLeads.phone, `+218${phone.slice(1)}`));
    return row!;
  }

  it("shows ops the queue with per-status counts", async () => {
    await seedLead("21", "Queue One");
    const res = await app.inject({ method: "GET", url: "/v1/biz/leads", headers: auth(opsToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.counts.new).toBeGreaterThan(0);
  });

  it("refuses finance — the queue is a list of names and phone numbers", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/biz/leads", headers: auth(finToken) });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a marketplace session outright", async () => {
    const guest = await signAccessToken({
      sub: crypto.randomUUID(),
      role: "guest",
      phone: "+218910000000",
    });
    const res = await app.inject({ method: "GET", url: "/v1/biz/leads", headers: auth(guest) });
    expect(res.statusCode).toBe(403);
  });

  it("moves a lead along and audits the change", async () => {
    const lead = await seedLead("22", "Move Me");
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/biz/leads/${lead.id}`,
      headers: auth(opsToken),
      payload: { status: "contacted", note: "Rang Tuesday, visit Thursday" },
    });
    expect(res.statusCode).toBe(200);

    const [after] = await db
      .select()
      .from(schema.partnerLeads)
      .where(eq(schema.partnerLeads.id, lead.id));
    expect(after?.status).toBe("contacted");
    expect(after?.note).toContain("Thursday");

    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, "lead.updated"), eq(schema.auditLog.targetId, lead.id)),
      );
    expect(audits.length).toBeGreaterThan(0);
  });

  it("settles a contested claim first-write-wins and tells the loser", async () => {
    const lead = await seedLead("23", "Contested");
    const first = await app.inject({
      method: "PATCH",
      url: `/v1/biz/leads/${lead.id}`,
      headers: auth(opsToken),
      payload: { claim: true },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "PATCH",
      url: `/v1/biz/leads/${lead.id}`,
      headers: auth(ops2Token),
      payload: { claim: true },
    });
    expect(second.statusCode).toBe(400);
    expect(JSON.stringify(second.json())).toContain("lead_already_claimed");

    // And the first agent still holds it.
    const [after] = await db
      .select()
      .from(schema.partnerLeads)
      .where(eq(schema.partnerLeads.id, lead.id));
    expect(after?.claimedById).not.toBeNull();
  });

  it("lets a claim be handed back without an admin", async () => {
    const lead = await seedLead("24", "Handback");
    await app.inject({
      method: "PATCH",
      url: `/v1/biz/leads/${lead.id}`,
      headers: auth(opsToken),
      payload: { claim: true },
    });
    await app.inject({
      method: "PATCH",
      url: `/v1/biz/leads/${lead.id}`,
      headers: auth(opsToken),
      payload: { claim: false },
    });
    const [after] = await db
      .select()
      .from(schema.partnerLeads)
      .where(eq(schema.partnerLeads.id, lead.id));
    expect(after?.claimedById).toBeNull();
  });
});
