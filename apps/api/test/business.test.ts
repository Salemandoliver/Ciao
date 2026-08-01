/**
 * Ciao Business — the internal console's contract.
 *
 * These tests care about the things that would actually hurt: settings that
 * silently don't apply, a commission rate that can be set below the deposit,
 * an ops user who can change their own permissions, a listing published with
 * no photos or no field visit, and a money screen that disagrees with the
 * ledger.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { signAccessToken } from "../src/lib/auth.js";
import {
  SETTING_DEFAULTS,
  effectiveFees,
  getSetting,
  invalidateSettingsCache,
  resetSettings,
  setSettings,
  validateCoherence,
  validateSetting,
} from "../src/modules/business/settings.js";

let app: FastifyInstance;
let adminToken: string;
let opsToken: string;
let adminId: string;

/**
 * Mint a session directly rather than walking the OTP flow. The auth flow has
 * its own tests; here it is scaffolding, and six OTP requests from one IP trip
 * the (correct) rate limit.
 */
async function loginAs(phone: string, role: "ops" | "admin" | "guest") {
  const e164 = phone.startsWith("0") ? `+218${phone.slice(1)}` : phone;
  let [user] = await db.select().from(schema.users).where(eq(schema.users.phone, e164)).limit(1);
  if (!user) {
    [user] = await db.insert(schema.users).values({ phone: e164, role }).returning();
  } else {
    await db.update(schema.users).set({ role }).where(eq(schema.users.id, user.id));
    user = { ...user, role };
  }
  const token = await signAccessToken({ sub: user!.id, role, phone: e164 });
  return { token, id: user!.id };
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await buildApp();
  const admin = await loginAs("0946000001", "admin");
  adminToken = admin.token;
  adminId = admin.id;
  opsToken = (await loginAs("0946000002", "ops")).token;
});

afterAll(async () => {
  // Leave the control plane exactly as we found it — these tests write to a
  // table the running app reads from.
  await resetSettings(Object.keys(SETTING_DEFAULTS), adminId);
  await app.close();
  await pool.end();
});

describe("control plane", () => {
  it("falls back to compiled defaults when nothing is stored", async () => {
    await resetSettings(["fees.coastCommissionBps"], adminId);
    expect(await getSetting("fees.coastCommissionBps")).toBe(
      SETTING_DEFAULTS["fees.coastCommissionBps"],
    );
  });

  it("a stored value overrides the default and reaches the fee schedule", async () => {
    await setSettings({ "fees.coastCommissionBps": 800 }, adminId);
    invalidateSettingsCache();
    expect(await getSetting("fees.coastCommissionBps")).toBe(800);
    // The point of the whole module: pricing sees it.
    expect((await effectiveFees()).coastCommissionBps).toBe(800);
    await resetSettings(["fees.coastCommissionBps"], adminId);
    invalidateSettingsCache();
    expect((await effectiveFees()).coastCommissionBps).toBe(
      SETTING_DEFAULTS["fees.coastCommissionBps"],
    );
  });

  it("records every change in the audit log with before and after", async () => {
    await setSettings({ "ops.announcementAr": "اختبار" }, adminId);
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, "ops.announcementAr"));
    expect(rows.length).toBeGreaterThan(0);
    const detail = rows.at(-1)!.detail as { to: string };
    expect(detail.to).toBe("اختبار");
    await resetSettings(["ops.announcementAr"], adminId);
  });

  it("a no-op save writes nothing", async () => {
    const changed = await setSettings(
      { "fees.hallCommissionBps": SETTING_DEFAULTS["fees.hallCommissionBps"] },
      adminId,
    );
    expect(changed).toEqual([]);
  });

  it("rejects a commission outside the sane band", () => {
    expect(validateSetting("fees.coastCommissionBps", 4000)).toBeTruthy();
    expect(validateSetting("fees.coastCommissionBps", 1000)).toBeNull();
  });

  it("rejects a hero with no images — the home page must never be blank", () => {
    expect(validateSetting("home.hero", { images: [] })).toBeTruthy();
    expect(validateSetting("home.hero", { images: [{ src: "/hero", alt: "x" }] })).toBeNull();
  });

  it("rejects a deposit below the commission, which would cost us money per booking", async () => {
    // Individually legal…
    expect(validateSetting("fees.coastDepositBps", 500)).toBeNull();
    // …jointly ruinous: the deposit could no longer carry the 10% commission.
    expect(await validateCoherence({ "fees.coastDepositBps": 500 })).toBeTruthy();
    expect(await validateCoherence({ "fees.coastDepositBps": 2000 })).toBeNull();
  });
});

describe("business console API", () => {
  it("refuses anonymous callers and guests", async () => {
    const anon = await app.inject({ method: "GET", url: "/v1/biz/overview" });
    expect(anon.statusCode).toBe(401);
    const guest = await loginAs("0946000003", "guest");
    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/overview",
      headers: auth(guest.token),
    });
    expect(res.statusCode).toBe(403);
  });

  it("serves the overview to ops with attention counters and a posture", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/overview?days=90",
      headers: auth(opsToken),
    });
    expect(res.statusCode).toBe(200);
    const b = res.json() as {
      money: Record<string, number>;
      needsAttention: { openDisputes: number; overdueDisputes: number };
      posture: { demoMode: boolean };
    };
    expect(typeof b.money.revenue).toBe("number");
    // The denominator discipline from the trust surface applies here too.
    expect(b.needsAttention.overdueDisputes).toBeLessThanOrEqual(b.needsAttention.openDisputes);
    expect(typeof b.posture.demoMode).toBe("boolean");
  });

  it("finance is ledger-derived and reports whether the books balance", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/finance?days=365",
      headers: auth(opsToken),
    });
    expect(res.statusCode).toBe(200);
    const b = res.json() as {
      ledger: { totalDebit: number; totalCredit: number; balanced: boolean; drift: number };
      headline: { gmv: number; commission: number; takeRateBps: number };
    };
    // Double entry: every posting is balanced, so the totals must agree.
    expect(b.ledger.totalDebit).toBe(b.ledger.totalCredit);
    expect(b.ledger.balanced).toBe(true);
    expect(b.ledger.drift).toBe(0);
    // Take rate can't exceed 100% unless we've computed it wrong.
    expect(b.headline.takeRateBps).toBeLessThanOrEqual(10000);
  });

  it("per-guest credit accounts are rolled into one trial-balance line", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/finance?days=730",
      headers: auth(opsToken),
    });
    const accounts = (res.json() as { ledger: { accounts: Record<string, unknown> } }).ledger
      .accounts;
    expect(Object.keys(accounts).some((a) => a.startsWith("guest_credit:"))).toBe(false);
  });

  it("onboards a business as a draft and refuses a duplicate slug", async () => {
    const slug = `test-biz-${Date.now().toString(36)}`;
    const payload = {
      vertical: "coast",
      hostPhone: "0947700077",
      hostName: "مضيف اختبار",
      venueNameAr: "مكان اختبار",
      city: "tripoli",
      area: "janzour",
      slug,
      titleAr: "إعلان اختبار",
      baseNightly: 300_000,
      maxGuests: 8,
    };
    const res = await app.inject({
      method: "POST",
      url: "/v1/biz/businesses",
      headers: auth(opsToken),
      payload,
    });
    expect(res.statusCode).toBe(201);
    const created = res.json() as { listingId: string; status: string; hostId: string };
    // Never live on creation — publishing requires a field visit (§11.2).
    expect(created.status).toBe("draft");

    // The host account exists and is a host, not a guest.
    const [host] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, created.hostId));
    expect(host!.role).toBe("host");

    const dupe = await app.inject({
      method: "POST",
      url: "/v1/biz/businesses",
      headers: auth(opsToken),
      payload,
    });
    expect(dupe.statusCode).toBe(400);

    // ---- publishing guards
    const publishNoVisit = await app.inject({
      method: "PATCH",
      url: `/v1/biz/listings/${created.listingId}`,
      headers: auth(opsToken),
      payload: { status: "live" },
    });
    expect(publishNoVisit.statusCode).toBe(400);
    expect(publishNoVisit.body).toContain("unverified");

    // Mark the venue verified, but still no photos → still refused.
    const [listing] = await db
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.id, created.listingId));
    await db
      .update(schema.venues)
      .set({ verifiedAt: new Date(), verificationGrade: "deed" })
      .where(eq(schema.venues.id, listing!.venueId));

    const publishNoMedia = await app.inject({
      method: "PATCH",
      url: `/v1/biz/listings/${created.listingId}`,
      headers: auth(opsToken),
      payload: { status: "live" },
    });
    expect(publishNoMedia.statusCode).toBe(400);
    expect(publishNoMedia.body).toContain("media");

    // ---- media management: add, reorder, and the cover is index 0
    const put = await app.inject({
      method: "PUT",
      url: `/v1/biz/listings/${created.listingId}/media`,
      headers: auth(opsToken),
      payload: {
        media: [
          { url: "/media/test/a.webp", kind: "photo" },
          { url: "/media/test/b.webp", kind: "photo" },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    const saved = (put.json() as { media: { url: string; order: number }[] }).media;
    expect(saved[0]!.order).toBe(0);
    expect(saved[1]!.order).toBe(1);

    // Now publishing succeeds.
    const publish = await app.inject({
      method: "PATCH",
      url: `/v1/biz/listings/${created.listingId}`,
      headers: auth(opsToken),
      payload: { status: "live" },
    });
    expect(publish.statusCode).toBe(200);

    // …and a live listing cannot be stripped of every photo.
    const strip = await app.inject({
      method: "PUT",
      url: `/v1/biz/listings/${created.listingId}/media`,
      headers: auth(opsToken),
      payload: { media: [] },
    });
    expect(strip.statusCode).toBe(400);

    // Clean up so the fixture never pollutes the public catalogue.
    await db
      .update(schema.listings)
      .set({ status: "delisted" })
      .where(eq(schema.listings.id, created.listingId));
  });

  it("ops cannot change settings or roles — only admin can", async () => {
    const settings = await app.inject({
      method: "PUT",
      url: "/v1/biz/settings",
      headers: auth(opsToken),
      payload: { patch: { "ops.announcementAr": "من العمليات" } },
    });
    expect(settings.statusCode).toBe(403);

    const [victim] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.phone, "+218946000003"));
    const role = await app.inject({
      method: "PATCH",
      url: `/v1/biz/users/${victim!.id}/role`,
      headers: auth(opsToken),
      payload: { role: "admin" },
    });
    expect(role.statusCode).toBe(403);
  });

  it("an admin cannot quietly demote themselves out of the audit trail", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/biz/users/${adminId}/role`,
      headers: auth(adminToken),
      payload: { role: "guest" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("admin settings writes are validated as a set, not field by field", async () => {
    const bad = await app.inject({
      method: "PUT",
      url: "/v1/biz/settings",
      headers: auth(adminToken),
      payload: { patch: { "fees.coastDepositBps": 500 } },
    });
    expect(bad.statusCode).toBe(400);

    const good = await app.inject({
      method: "PUT",
      url: "/v1/biz/settings",
      headers: auth(adminToken),
      payload: { patch: { "fees.coastDepositBps": 2500 } },
    });
    expect(good.statusCode).toBe(200);
    await resetSettings(["fees.coastDepositBps"], adminId);
  });

  it("rejects unknown setting keys rather than storing junk", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/biz/settings",
      headers: auth(adminToken),
      payload: { patch: { "totally.madeup": 1 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("exposes only the public slice unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/settings/public" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.hero).toBeTruthy();
    // Commercial terms are not public.
    expect(JSON.stringify(body)).not.toContain("CommissionBps");
  });

  it("the audit trail shows who did what", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/audit?limit=20",
      headers: auth(opsToken),
    });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: { action: string; actor: string }[] }).items;
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) expect(i.actor).toBeTruthy();
  });
});

describe("operator kill switch", () => {
  it("pausing bookings stops new ones without taking the marketplace down", async () => {
    await setSettings({ "ops.acceptingBookings": false }, adminId);
    invalidateSettingsCache();

    // Browsing still works — that's the whole point of a pause vs an outage.
    const browse = await app.inject({ method: "GET", url: "/v1/listings?type=coast" });
    expect(browse.statusCode).toBe(200);

    const { createStayRequest } = await import("../src/modules/bookings/service.js");
    const { CiaoError } = await import("../src/lib/errors.js");
    // The guard runs before any DB lookup, so obviously-bogus ids still hit it
    // — which is the point: a paused platform refuses at the door.
    const err = await createStayRequest({
      listingId: "00000000-0000-0000-0000-000000000000",
      guestId: "00000000-0000-0000-0000-000000000000",
      checkIn: "2027-01-01",
      checkOut: "2027-01-02",
      rail: "sadad",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CiaoError);
    expect((err as InstanceType<typeof CiaoError>).detail).toBe("bookings_paused");

    await resetSettings(["ops.acceptingBookings"], adminId);
    invalidateSettingsCache();
    expect(await getSetting("ops.acceptingBookings")).toBe(true);
  });
});
