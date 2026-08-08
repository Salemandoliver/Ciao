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
  FEES,
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

// ══════════════════ the catalogue reaching a real booking ═══════════════════
/**
 * The consumer side.
 *
 * A partner's extras and offers are worth nothing if they stop at the console,
 * so these assert the money that actually lands on a booking: that a required
 * extra is charged, that the partner's discount is recorded apart from ours,
 * that a required question cannot be skipped, and — the one that would be a
 * genuine theft — that add-ons never quietly inflate the deposit Ciao takes.
 */
describe("extras on a real booking", () => {
  let listingId = "";
  let hostId = "";
  let guestToken = "";
  let cleaningId = "";
  let questionId = "";

  beforeAll(async () => {
    const [host] = await db
      .insert(schema.users)
      .values({ phone: `+2189493${run.slice(-5)}`, role: "host" })
      .returning();
    hostId = host!.id;

    const [venue] = await db
      .insert(schema.venues)
      .values({
        type: "coast",
        nameAr: "شاليه الاختبار",
        city: "tripoli",
        area: "janzour",
        hostId,
        addressAr: "عنوان",
      })
      .returning();
    const [listing] = await db
      .insert(schema.listings)
      .values({
        venueId: venue!.id,
        slug: `extras-villa-${run}`,
        titleAr: "شاليه الإضافات",
        baseNightly: 200_000,
        status: "live",
        cancellationTier: "moderate",
        maxGuests: 8,
      })
      .returning();
    listingId = listing!.id;

    const [cleaning] = await db
      .insert(schema.partnerAddons)
      .values({ partnerId: hostId, nameAr: "تنظيف", price: 25_000, required: true })
      .returning();
    cleaningId = cleaning!.id;
    await db
      .insert(schema.partnerAddons)
      .values({ partnerId: hostId, nameAr: "شوّاية", price: 30_000, priceModel: "flat", maxQty: 2 });
    const [q] = await db
      .insert(schema.partnerIntakeQuestions)
      .values({ partnerId: hostId, promptAr: "كم عدد الأطفال؟", fieldType: "number", required: true })
      .returning();
    questionId = q!.id;
    await db.insert(schema.partnerPromotions).values({
      partnerId: hostId,
      labelAr: "خصم المضيف",
      kind: "percent",
      valueBps: 1000,
      publicOnListing: true,
    });

    const otp = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: `0949${run.slice(-6)}` },
    });
    const ver = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone: `0949${run.slice(-6)}`, code: otp.json().devCode },
    });
    guestToken = ver.json().accessToken;
  });

  const future = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  it("refuses a booking that skips a required question", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: `Bearer ${guestToken}` },
      payload: {
        listingId,
        checkIn: future(40),
        checkOut: future(42),
        guestCount: 4,
        rail: "local_card",
      },
    });
    // The partner said they cannot do the job without knowing. A booking taken
    // anyway becomes the phone call the feature exists to prevent.
    expect(res.statusCode).toBe(400);
  });

  it("charges the required extra, applies the host's offer, and leaves our deposit alone", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: `Bearer ${guestToken}` },
      payload: {
        listingId,
        checkIn: future(50),
        checkOut: future(52),
        guestCount: 4,
        rail: "local_card",
        intake: [{ questionId, answer: "2" }],
      },
    });
    expect(res.statusCode).toBe(201);
    const { bookingId } = res.json();

    const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    const stay = 400_000; // 2 nights × 200,000, no multipliers on this listing

    // Cleaning was never requested and is charged anyway, because the partner
    // marked it required — omission must not shave a mandatory fee.
    const lines = b!.addons as { addonId: string; total: number }[];
    expect(lines.find((l) => l.addonId === cleaningId)?.total).toBe(25_000);

    // The host's automatic 10% comes off their revenue and is recorded in its
    // own column — never netted with Ciao's promo discount, which is ours.
    expect(b!.partnerDiscountAmount).toBe(Math.round((stay + 25_000) * 0.1));
    expect(b!.discountAmount).toBe(0);
    expect(b!.totalAmount).toBe(stay + 25_000 - b!.partnerDiscountAmount);

    /*
     * The deposit is Ciao's hold on the date and is computed from the stay
     * alone. If extras inflated it we would be taking money online for a
     * barbecue the guest has not yet decided to light — and refunding it on
     * cancellation out of our own pocket.
     */
    expect(b!.depositAmount).toBe(Math.round(stay * 0.2));
    expect(b!.intakeAnswers).toHaveLength(1);
  });

  it("publishes only what the partner chose to advertise", async () => {
    await db.insert(schema.partnerPromotions).values({
      partnerId: hostId,
      labelAr: "كود خاص",
      code: `PRIV${run.slice(-4)}`,
      kind: "percent",
      valueBps: 2000,
      publicOnListing: false,
    });
    const res = await app.inject({ method: "GET", url: `/v1/listings/extras-villa-${run}` });
    expect(res.statusCode).toBe(200);
    const offers = res.json().catalogue.offers as { labelAr: string }[];
    expect(offers.map((o) => o.labelAr)).toContain("خصم المضيف");
    // A code handed out personally must not be readable by anyone who opens
    // the page — that is the entire reason the switch exists.
    expect(offers.map((o) => o.labelAr)).not.toContain("كود خاص");
  });
});

// ═════════════════════════ what ops can see about it ════════════════════════
describe("the ops partner panel", () => {
  it("reports catalogue adoption and annual terms without exposing a price list", async () => {
    /*
     * A console-audience token. The /v1/biz routes refuse a marketplace
     * session since the business console became a standalone product, and
     * that refusal is a feature worth not routing around in a test.
     */
    const [ops] = await db
      .insert(schema.users)
      .values({ phone: `+2189494${run.slice(-5)}`, role: "admin" })
      .returning();
    const opsToken = await signAccessToken(
      { sub: ops!.id, role: "admin", phone: ops!.phone },
      "biz",
    );

    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/partner-panel",
      headers: { authorization: `Bearer ${opsToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Adoption counts businesses, not prices.
    expect(body.catalogue.withServices).toBeGreaterThanOrEqual(1);
    expect(body.catalogue.withAddons).toBeGreaterThanOrEqual(1);
    expect(body.terms).toHaveProperty("annual");
    /*
     * Nothing here may carry what anybody charges. An ops screen is the wrong
     * place for a competitor's rate card to accumulate, and the counts are
     * what the panel is for.
     */
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("basePrice");
    expect(serialized).not.toContain("nameAr");
  });
});

// ═══════════════ regressions from the adversarial money review ══════════════
/**
 * Five defects an adversarial pass found in the money paths. Each one is here
 * because it produced a number that was wrong rather than a screen that looked
 * wrong, and none of them would have surfaced as an error.
 */
describe("money invariants", () => {
  let hostId = "";
  let listingId = "";
  let guestToken = "";
  let guestId = "";
  const suffix = run.slice(-5);

  beforeAll(async () => {
    const [host] = await db
      .insert(schema.users)
      .values({ phone: `+2189613${suffix}`, role: "host" })
      .returning();
    hostId = host!.id;
    const [venue] = await db
      .insert(schema.venues)
      .values({ type: "coast", nameAr: "رخيص", city: "tripoli", area: "janzour", hostId, addressAr: "x" })
      .returning();
    // A cheap listing, so a flat offer can exceed what is settled on arrival.
    const [listing] = await db
      .insert(schema.listings)
      .values({
        venueId: venue!.id,
        slug: `cheap-${run}`,
        titleAr: "شاليه رخيص",
        baseNightly: 20_000,
        status: "live",
        cancellationTier: "moderate",
        maxGuests: 4,
      })
      .returning();
    listingId = listing!.id;

    const otp = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: `0948${run.slice(-6)}` },
    });
    const ver = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone: `0948${run.slice(-6)}`, code: otp.json().devCode },
    });
    guestToken = ver.json().accessToken;
    const [g] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.phone, `+218948${run.slice(-6)}`))
      .limit(1);
    guestId = g!.id;
  });

  const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

  it("never lets a host's offer push the balance negative or the deposit above the total", async () => {
    /*
     * A 50-dinar flat offer against a 40-dinar stay. Before the cap this wrote
     * total 0, deposit 8,000 and balance −8,000: the guest was charged a
     * deposit larger than the entire booking, and the host owed money for a
     * night somebody stayed in their chalet.
     */
    await db.insert(schema.partnerPromotions).values({
      partnerId: hostId,
      labelAr: "خصم كبير",
      kind: "fixed",
      valueFlat: 50_000,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: `Bearer ${guestToken}` },
      payload: {
        listingId,
        checkIn: future(60),
        checkOut: future(62),
        guestCount: 2,
        rail: "local_card",
      },
    });
    expect(res.statusCode).toBe(201);
    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, res.json().bookingId));

    expect(b!.balanceOnArrival).toBeGreaterThanOrEqual(0);
    expect(b!.totalAmount).toBeGreaterThanOrEqual(0);
    expect(b!.depositAmount).toBeLessThanOrEqual(b!.totalAmount);
    // The identity the whole ledger rests on.
    expect(b!.depositAmount + b!.balanceOnArrival).toBe(b!.totalAmount);
  });

  it("keeps the three numbers adding up when a partner-funded code meets the host's extras", async () => {
    /*
     * The seam this merge created, and the only place two independently-correct
     * pieces of arithmetic could disagree.
     *
     * A partner-funded Ciao code moves the deposit to whichever is larger of
     * the reduced deposit and our recomputed commission — it does not simply
     * subtract. Extras and the host's own offer land on arrival. Each rule was
     * written without knowledge of the other, and while the balance was stored
     * as `quote.balanceOnArrival` the two together wrote a deposit and a
     * balance that summed to more than the total: a guest could add up the
     * invoice and find a dinar that belongs to nobody.
     *
     * The fix was to derive the balance by subtraction, which is what makes
     * this assertion true by construction. It is pinned here because the next
     * pricing rule anyone adds will be written without knowledge of these two.
     */
    const [svc] = await db
      .insert(schema.partnerServices)
      .values({ partnerId: hostId, nameAr: "ليلة", unit: "night", basePrice: 20_000, listingId })
      .returning();
    await db.insert(schema.partnerAddons).values({
      partnerId: hostId,
      serviceId: svc!.id,
      nameAr: "شواء",
      price: 15_000,
      priceModel: "flat",
      required: true,
    });
    const code = `PF${run.slice(-6)}`.toUpperCase();
    await db.insert(schema.promoCodes).values({
      code,
      kind: "fixed",
      value: 12_000,
      fundedBy: "partner",
      venueId: (
        await db.select().from(schema.listings).where(eq(schema.listings.id, listingId)).limit(1)
      )[0]!.venueId,
      active: true,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: `Bearer ${guestToken}` },
      payload: {
        listingId,
        checkIn: future(80),
        checkOut: future(82),
        guestCount: 2,
        rail: "local_card",
        promoCode: code,
      },
    });
    expect(res.statusCode).toBe(201);
    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, res.json().bookingId));

    expect(b!.depositAmount + b!.balanceOnArrival).toBe(b!.totalAmount);
    expect(b!.balanceOnArrival).toBeGreaterThanOrEqual(0);
    expect(b!.depositAmount).toBeLessThanOrEqual(b!.totalAmount);
    /*
     * The barbecue is the host's trade, so it must not be inside the base our
     * commission is a percentage of.
     *
     * Two nights at 20 with a partner-funded 12 off leaves a 28-dinar stay, and
     * `FEES.coastCommissionBps` takes 10% of it. Asserted against the stay
     * rather than against the total on purpose: the total here has also had the
     * host's own offer taken off it, and a commission that tracked the total
     * would fall every time a host ran a promotion — which is the arrangement
     * this whole block exists to prevent.
     */
    expect(b!.commissionAmount).toBe(Math.round((28_000 * FEES.coastCommissionBps) / 10_000));
  });

  it("charges a required extra even when the client sends it as zero", async () => {
    const [svc] = await db
      .insert(schema.partnerServices)
      .values({ partnerId: hostId, nameAr: "خدمة", unit: "item", basePrice: 100_000 })
      .returning();
    const [must] = await db
      .insert(schema.partnerAddons)
      .values({ partnerId: hostId, nameAr: "رسوم", price: 10_000, required: true })
      .returning();

    const token = await signAccessToken(
      { sub: hostId, role: "host", phone: `+2189613${suffix}` },
      "partner",
    );
    const res = await app.inject({
      method: "POST",
      url: "/v1/partner/price",
      headers: { authorization: `Bearer ${token}` },
      // Zero is how a client removes an *optional* extra. Sending it for a
      // required one used to keep the entry and skip the forcing branch, so
      // the mandatory fee priced at nothing.
      payload: { serviceId: svc!.id, units: 1, addons: [{ addonId: must!.id, qty: 0 }] },
    });
    expect(res.json().addonsTotal).toBe(10_000);
    // Subtotal rather than total: this host also carries the flat offer from
    // the test above, and what is being asserted here is that the mandatory
    // fee was charged at all, not what the offer then did to it.
    expect(res.json().subtotal).toBe(110_000);
  });

  it("honours a first-booking-only offer against the host's actual customer book", async () => {
    /*
     * `firstTimeOnly` was a dead letter on the booking path: the context never
     * carried the guest, and an absent `isFirstTime` reads as "not
     * disqualified" — so a first-booking discount was granted to every
     * returning guest, forever.
     */
    const [other] = await db
      .insert(schema.users)
      .values({ phone: `+2189614${suffix}`, role: "host" })
      .returning();
    const [venue2] = await db
      .insert(schema.venues)
      .values({ type: "coast", nameAr: "ثاني", city: "tripoli", area: "janzour", hostId: other!.id, addressAr: "x" })
      .returning();
    const [l2] = await db
      .insert(schema.listings)
      .values({
        venueId: venue2!.id,
        slug: `repeat-${run}`,
        titleAr: "شاليه المكرر",
        baseNightly: 100_000,
        status: "live",
        cancellationTier: "moderate",
        maxGuests: 4,
      })
      .returning();
    await db.insert(schema.partnerPromotions).values({
      partnerId: other!.id,
      labelAr: "أول حجز فقط",
      kind: "percent",
      valueBps: 1000,
      firstTimeOnly: true,
    });
    // A returning customer: already in this host's book with a job behind them.
    await db.insert(schema.partnerClients).values({
      partnerId: other!.id,
      nameAr: "زبون قديم",
      ciaoUserId: guestId,
      jobsCount: 3,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: `Bearer ${guestToken}` },
      payload: {
        listingId: l2!.id,
        checkIn: future(70),
        checkOut: future(72),
        guestCount: 2,
        rail: "local_card",
      },
    });
    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, res.json().bookingId));
    expect(b!.partnerDiscountAmount).toBe(0);
  });

  it("grants a year once per payment, however many times the capture arrives", async () => {
    const subs = await import("../src/modules/partner/subscription.js");
    const [buyer] = await db
      .insert(schema.users)
      .values({ phone: `+2189611${suffix}`, role: "host" })
      .returning();
    const [intent] = await db
      .insert(schema.paymentIntents)
      .values({
        bookingId: null,
        subjectId: buyer!.id,
        purpose: "subscription",
        amount: 2_500_000,
        rail: "local_card",
        provider: "mock",
        invoiceNo: `PLUS-TEST-${run}`,
        status: "captured",
      })
      .returning();

    await subs.grantAnnualTerm(intent!.id);
    const first = await subs.getSubscription(buyer!.id);
    // A re-delivered completion — a new provider event id, or a retry that also
    // reaches the OTP-confirm path — must not buy a second year.
    await subs.grantAnnualTerm(intent!.id);
    const second = await subs.getSubscription(buyer!.id);

    expect(first!.currentPeriodEnd!.toISOString()).toBe(second!.currentPeriodEnd!.toISOString());
  });

  it("extends a renewal from the existing end date, so paying early costs nothing", async () => {
    const subs = await import("../src/modules/partner/subscription.js");
    const [buyer] = await db
      .insert(schema.users)
      .values({ phone: `+2189612${suffix}`, role: "host" })
      .returning();
    const inTenDays = new Date(Date.now() + 10 * 86_400_000);
    await db.insert(schema.partnerSubscriptions).values({
      partnerId: buyer!.id,
      plan: "plus",
      status: "active",
      term: "annual",
      currentPeriodEnd: inTenDays,
    });
    const [intent] = await db
      .insert(schema.paymentIntents)
      .values({
        bookingId: null,
        subjectId: buyer!.id,
        purpose: "subscription",
        amount: 2_500_000,
        rail: "local_card",
        provider: "mock",
        invoiceNo: `PLUS-RENEW-${run}`,
        status: "captured",
      })
      .returning();

    await subs.grantAnnualTerm(intent!.id);
    const sub = await subs.getSubscription(buyer!.id);
    const expected = new Date(inTenDays);
    expected.setUTCFullYear(expected.getUTCFullYear() + 1);
    // Renewing ten days early must add a year to the ten days, not replace
    // them. Getting this backwards is a small theft a customer never forgets.
    expect(sub!.currentPeriodEnd!.toISOString().slice(0, 10)).toBe(
      expected.toISOString().slice(0, 10),
    );
  });
});
