/**
 * The catalogue — pricing, offers, entitlement.
 *
 * Ordered by what each failure would cost:
 *
 *  - a price computed differently on two screens, so a customer is shown one
 *    number and charged another;
 *  - a discount that exceeds the price, or a percentage typed with an extra
 *    zero, either of which gives a chalet away;
 *  - a required add-on a client can omit by not sending it;
 *  - an offer that keeps working after its window, its cap, or its customer;
 *  - a year of Plus that starts from today when it was paid for early, quietly
 *    stealing the days somebody paid for.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { signAccessToken } from "../src/lib/auth.js";
import {
  ANNUAL_MONTHS_CHARGED,
  annualPrice,
  annualSavings,
  evaluatePromotion,
  priceSelection,
  type Promotion,
} from "@ciao/shared";
import { priceRequest } from "../src/modules/partner/catalogue.js";

let app: FastifyInstance;
let partnerId = "";
let token = "";
const run = Date.now().toString().slice(-7);
const auth = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await buildApp();
  const [user] = await db
    .insert(schema.users)
    .values({ phone: `+2189490${run.slice(-5)}`, role: "host", displayName: "catalogue-test" })
    .returning();
  partnerId = user!.id;
  token = await signAccessToken(
    { sub: partnerId, role: "host", phone: user!.phone },
    "partner",
  );
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

// ═══════════════════════════ pure pricing arithmetic ════════════════════════
describe("priceSelection", () => {
  const service = { id: "svc", unit: "night", basePrice: 100_000, minUnits: 1, maxUnits: 30 };

  it("multiplies by units and shows its work", () => {
    const p = priceSelection({ service, units: 3 });
    expect(p.base).toBe(300_000);
    expect(p.subtotal).toBe(300_000);
    // The lines must add up to the total by hand — a receipt a partner cannot
    // check is a receipt that starts arguments.
    expect(p.lines.reduce((s, l) => s + l.amount, 0)).toBe(p.subtotal);
  });

  it("clamps to the service's own bounds rather than trusting the caller", () => {
    // A two-night minimum is a real rule partners set, and a client asking for
    // one night must not get one night at one night's price.
    const twoMin = { ...service, minUnits: 2 };
    expect(priceSelection({ service: twoMin, units: 1 }).units).toBe(2);
    expect(priceSelection({ service, units: 500 }).units).toBe(30);
  });

  it("stacks rules in priority order, deterministically", () => {
    const rules = [
      {
        id: "b",
        kind: "season",
        labelAr: "أغسطس",
        fromDay: "2026-08-01",
        toDay: "2026-08-31",
        adjustBps: 12000,
        adjustFlat: 0,
        priority: 20,
      },
      {
        id: "a",
        kind: "weekday",
        labelAr: "نهاية الأسبوع",
        weekdays: [5],
        adjustBps: 11000,
        adjustFlat: 0,
        priority: 10,
      },
    ];
    // 2026-08-07 is a Friday (ISO 5).
    const p = priceSelection({ service, units: 1, day: "2026-08-07", rules });
    // weekend first (110,000), then August (+20% → 132,000)
    expect(p.subtotal).toBe(132_000);
    expect(p.appliedRuleIds).toEqual(["a", "b"]);

    // Reversing the input order must not change the answer.
    const q = priceSelection({ service, units: 1, day: "2026-08-07", rules: [...rules].reverse() });
    expect(q.subtotal).toBe(p.subtotal);
  });

  it("applies a rule only inside its own window", () => {
    const rules = [
      {
        id: "s",
        kind: "season",
        labelAr: "أغسطس",
        fromDay: "2026-08-01",
        toDay: "2026-08-31",
        adjustBps: 12000,
        adjustFlat: 0,
        priority: 10,
      },
    ];
    expect(priceSelection({ service, units: 1, day: "2026-09-01", rules }).subtotal).toBe(100_000);
    expect(priceSelection({ service, units: 1, day: "2026-08-31", rules }).subtotal).toBe(120_000);
  });

  it("multiplies add-ons by the model the partner chose", () => {
    const p = priceSelection({
      service,
      units: 3,
      guests: 4,
      km: 50,
      addons: [
        { id: "flat", nameAr: "تنظيف", price: 20_000, priceModel: "flat", qty: 1 },
        { id: "unit", nameAr: "خروج متأخر", price: 10_000, priceModel: "per_unit", qty: 1 },
        { id: "head", nameAr: "فطور", price: 5_000, priceModel: "per_person", qty: 1 },
        { id: "km", nameAr: "مواصلات", price: 500, priceModel: "per_km", qty: 1 },
      ],
    });
    // 20,000 + (10,000 × 3) + (5,000 × 4) + (500 × 50)
    expect(p.addonsTotal).toBe(20_000 + 30_000 + 20_000 + 25_000);
  });
});

// ══════════════════════════════ promotion rules ═════════════════════════════
describe("evaluatePromotion", () => {
  const base: Promotion = {
    id: "p1",
    labelAr: "خصم",
    kind: "percent",
    valueBps: 1000,
    valueFlat: 0,
    minSpend: 0,
    maxRedemptions: 0,
    maxPerClient: 0,
    redemptions: 0,
    firstTimeOnly: false,
    active: true,
  };
  const ctx = { subtotal: 100_000, today: "2026-08-10" };

  it("takes a percentage and caps it where the partner asked", () => {
    expect(evaluatePromotion(base, ctx)).toMatchObject({ ok: true, discount: 10_000 });
    expect(
      evaluatePromotion({ ...base, valueBps: 5000, maxDiscount: 15_000 }, ctx),
    ).toMatchObject({ discount: 15_000 });
  });

  it("never discounts more than the price", () => {
    // A fixed 200-dinar offer against a 100-dinar booking is a refund the
    // partner never agreed to fund.
    expect(
      evaluatePromotion({ ...base, kind: "fixed", valueFlat: 200_000 }, ctx),
    ).toMatchObject({ ok: true, discount: 100_000 });
  });

  it("refuses with a reason a partner can read out", () => {
    expect(evaluatePromotion({ ...base, active: false }, ctx)).toMatchObject({
      ok: false,
      reason: "inactive",
    });
    expect(evaluatePromotion({ ...base, toDay: "2026-08-01" }, ctx)).toMatchObject({
      reason: "expired",
    });
    expect(evaluatePromotion({ ...base, minSpend: 200_000 }, ctx)).toMatchObject({
      reason: "below_min_spend",
    });
    expect(
      evaluatePromotion({ ...base, maxRedemptions: 5, redemptions: 5 }, ctx),
    ).toMatchObject({ reason: "exhausted" });
    expect(
      evaluatePromotion({ ...base, maxPerClient: 1 }, { ...ctx, clientRedemptions: 1 }),
    ).toMatchObject({ reason: "already_used" });
    expect(
      evaluatePromotion({ ...base, firstTimeOnly: true }, { ...ctx, isFirstTime: false }),
    ).toMatchObject({ reason: "not_first_time" });
  });

  it("separates when an offer may be booked from when it may be used", () => {
    // "Book in June for September" is a real offer and needs both windows.
    const septemberOffer = {
      ...base,
      fromDay: "2026-06-01",
      toDay: "2026-06-30",
      travelFromDay: "2026-09-01",
      travelToDay: "2026-09-30",
    };
    const inJune = { ...ctx, today: "2026-06-15" };
    expect(
      evaluatePromotion(septemberOffer, { ...inJune, travelDay: "2026-09-10" }),
    ).toMatchObject({ ok: true });
    expect(
      evaluatePromotion(septemberOffer, { ...inJune, travelDay: "2026-10-10" }),
    ).toMatchObject({ reason: "wrong_dates" });
  });

  it("scopes to the services the partner chose", () => {
    const scoped = { ...base, serviceIds: ["a"] };
    expect(evaluatePromotion(scoped, { ...ctx, serviceId: "a" })).toMatchObject({ ok: true });
    expect(evaluatePromotion(scoped, { ...ctx, serviceId: "b" })).toMatchObject({
      reason: "wrong_service",
    });
  });
});

// ═════════════════════════════ the annual offer ═════════════════════════════
describe("Ciao Plus, by the year", () => {
  it("charges ten months for twelve", () => {
    expect(ANNUAL_MONTHS_CHARGED).toBe(10);
    expect(annualPrice(250_000)).toBe(2_500_000);
    expect(annualSavings(250_000)).toBe(500_000);
  });
});

// ════════════════════════════ end to end, over HTTP ═════════════════════════
describe("catalogue over HTTP", () => {
  let serviceId = "";
  let cleaningId = "";

  it("creates a service and prices it against the live catalogue", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/partner/services",
      headers: auth(),
      payload: {
        nameAr: "شاليه عائلي",
        unit: "night",
        basePrice: 100_000,
        minUnits: 2,
        depositBps: 2500,
      },
    });
    expect(created.statusCode).toBe(201);
    serviceId = created.json().id;

    const priced = await app.inject({
      method: "POST",
      url: "/v1/partner/price",
      headers: auth(),
      payload: { serviceId, units: 2, day: "2026-09-10" },
    });
    expect(priced.statusCode).toBe(200);
    const body = priced.json();
    expect(body.subtotal).toBe(200_000);
    expect(body.total).toBe(200_000);
    // The deposit follows the service's own override, not the profile default.
    expect(body.depositBps).toBe(2500);
    expect(body.deposit).toBe(50_000);
  });

  it("adds a required add-on whether or not the client asked for it", async () => {
    const addon = await app.inject({
      method: "POST",
      url: "/v1/partner/addons",
      headers: auth(),
      payload: { nameAr: "تنظيف", price: 15_000, required: true },
    });
    expect(addon.statusCode).toBe(201);
    cleaningId = addon.json().id;

    // Note: no addons sent at all. A caller must not be able to shave a
    // mandatory fee off the total by omission.
    const priced = await app.inject({
      method: "POST",
      url: "/v1/partner/price",
      headers: auth(),
      payload: { serviceId, units: 2 },
    });
    const body = priced.json();
    expect(body.addonsTotal).toBe(15_000);
    expect(body.total).toBe(215_000);
    expect(body.addonLines.map((l: { addonId: string }) => l.addonId)).toContain(cleaningId);
  });

  it("ignores an add-on belonging to somebody else", async () => {
    const [other] = await db
      .insert(schema.users)
      .values({ phone: `+2189491${run.slice(-5)}`, role: "host" })
      .returning();
    const [stranger] = await db
      .insert(schema.partnerAddons)
      .values({ partnerId: other!.id, nameAr: "غريب", price: 999_000 })
      .returning();

    const priced = await app.inject({
      method: "POST",
      url: "/v1/partner/price",
      headers: auth(),
      payload: { serviceId, units: 2, addons: [{ addonId: stranger!.id, qty: 1 }] },
    });
    // Silently dropped, not honoured and not a 500: a stale id from a cached
    // page is a normal thing, and quoting somebody else's price list is not.
    expect(priced.json().total).toBe(215_000);
  });

  it("refuses a percentage that is almost certainly a typo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/partner/promotions",
      headers: auth(),
      payload: { labelAr: "خصم", kind: "percent", valueBps: 9000 },
    });
    // 9000bps means "90% off". Typed by someone who meant "pay 90%".
    expect(res.statusCode).toBe(400);
  });

  it("applies a code, and reports why when it does not", async () => {
    const promo = await app.inject({
      method: "POST",
      url: "/v1/partner/promotions",
      headers: auth(),
      payload: {
        labelAr: "عرض سبتمبر",
        code: "sept10",
        kind: "percent",
        valueBps: 1000,
        minSpend: 100_000,
      },
    });
    expect(promo.statusCode).toBe(201);
    expect(promo.json().code).toBe("SEPT10"); // normalised, so case cannot fail a customer

    const applied = await app.inject({
      method: "POST",
      url: "/v1/partner/price",
      headers: auth(),
      payload: { serviceId, units: 2, promoCode: "sept10" },
    });
    const body = applied.json();
    expect(body.discount).toBe(21_500); // 10% of 215,000
    expect(body.total).toBe(193_500);
    expect(body.promotion.labelAr).toBe("عرض سبتمبر");

    const tooSmall = await app.inject({
      method: "POST",
      url: "/v1/partner/price",
      headers: auth(),
      payload: { serviceId, units: 2, promoCode: "NOPE" },
    });
    // An unknown code is simply no promotion — not an error that blocks a
    // booking. The customer gets the honest price and can try again.
    expect(tooSmall.json().discount).toBe(0);
  });

  it("refuses a second promotion with the same code", async () => {
    const dupe = await app.inject({
      method: "POST",
      url: "/v1/partner/promotions",
      headers: auth(),
      payload: { labelAr: "مكرر", code: "SEPT10", kind: "percent", valueBps: 500 },
    });
    expect(dupe.statusCode).toBe(400);
  });

  it("keeps a retired service resolvable but unsellable", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/partner/services",
      headers: auth(),
      payload: { nameAr: "قديم", unit: "item", basePrice: 50_000, published: true },
    });
    const oldId = created.json().id;
    const gone = await app.inject({
      method: "DELETE",
      url: `/v1/partner/services/${oldId}`,
      headers: auth(),
    });
    expect(gone.statusCode).toBe(200);
    const [row] = await db
      .select()
      .from(schema.partnerServices)
      .where(eq(schema.partnerServices.id, oldId));
    expect(row!.active).toBe(false);
    // Retiring must also unpublish, or the marketplace keeps selling it.
    expect(row!.published).toBe(false);
  });

  it("refuses a stranger's catalogue", async () => {
    const [other] = await db
      .insert(schema.users)
      .values({ phone: `+2189492${run.slice(-5)}`, role: "host" })
      .returning();
    const res = await app.inject({
      method: "GET",
      url: `/v1/partner/catalogue?partnerId=${other!.id}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("prices identically through the service layer and the route", async () => {
    // The two callers that matter — the console preview and the consumer
    // checkout — must agree, or a guest is shown one number and charged
    // another.
    const direct = await priceRequest(partnerId, { serviceId, units: 2, promoCode: "SEPT10" });
    const overHttp = await app.inject({
      method: "POST",
      url: "/v1/partner/price",
      headers: auth(),
      payload: { serviceId, units: 2, promoCode: "SEPT10" },
    });
    expect(overHttp.json().total).toBe(direct.total);
    expect(overHttp.json().deposit).toBe(direct.deposit);
  });
});
