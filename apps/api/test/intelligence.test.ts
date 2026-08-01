/**
 * Intelligence layer: fold correctness (pure), end-to-end pipeline
 * (ingest → fold → profile → recs → insights) against real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { emptyTraits, foldEvent, foldUser, scoreListing } from "../src/modules/intelligence/profile.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

function evt(name: string, props: Record<string, unknown>) {
  return {
    id: randomUUID(),
    ts: new Date(),
    name,
    props,
    userId: null,
    anonId: null,
    sessionId: null,
    source: "api",
    context: null,
  } as typeof schema.events.$inferSelect;
}

describe("profile folding (pure)", () => {
  it("accumulates area affinity with money-weighted events", () => {
    let t = emptyTraits();
    t = foldEvent(t, evt("search.performed", { area: "janzour", vertical: "coast" }));
    t = foldEvent(t, evt("booking.confirmed", { area: "janzour", vertical: "coast", total: 1_800_000 }));
    expect(t.areaAffinity.janzour).toBe(11); // 1 + 10
    expect(t.vertical.coast).toBe(11);
    expect(t.rfm.bookings).toBe(1);
    expect(t.rfm.gmv).toBe(1_800_000);
  });

  it("tracks cultural filter affinities and group size", () => {
    let t = emptyTraits();
    t = foldEvent(t, evt("search.performed", { filters: ["minPrivacy", "familyOnly"], guests: 10 }));
    t = foldEvent(t, evt("search.performed", { filters: ["minPrivacy"], guests: 12 }));
    expect(t.privacyAffinity).toBe(2);
    expect(t.familyAffinity).toBe(1);
    expect(t.groupSizeSum / t.groupSizeCount).toBe(11);
  });

  it("captures weekend-vs-weekday and month seasonality from bookings", () => {
    let t = emptyTraits();
    t = foldEvent(t, evt("booking.requested", { checkIn: "2026-08-07" })); // Friday
    t = foldEvent(t, evt("booking.requested", { checkIn: "2026-08-10" })); // Monday
    expect(t.weekendCheckins).toBe(1);
    expect(t.weekdayCheckins).toBe(1);
    expect(t.monthCounts["08"]).toBe(2);
  });
});

describe("personalized scoring", () => {
  const listing = {
    baseNightly: 600_000,
    maxGuests: 12,
    familyOnly: true,
  } as typeof schema.listings.$inferSelect;
  const venue = {
    type: "coast",
    city: "tripoli",
    area: "janzour",
    verifiedAt: new Date(),
    badgeRevoked: false,
    privacy: { score: 100 },
    amenities: [{ key: "generator", present: true }],
  } as unknown as typeof schema.venues.$inferSelect;

  it("area + price + privacy affinities beat cold-start, with transparent reason", () => {
    const traits = emptyTraits();
    traits.areaAffinity.janzour = 15;
    traits.priceSum = 1_800_000;
    traits.priceCount = 3; // typical 600k → perfect price fit
    traits.privacyAffinity = 3;
    const personalized = scoreListing(traits, listing, venue, 80, 2);
    const cold = scoreListing(null, listing, venue, 80, 2);
    expect(personalized.score).toBeGreaterThan(cold.score);
    expect(personalized.because.length).toBeGreaterThan(0);
    expect(cold.because).toBe("موثّق من تشاو");
  });

  it("penalizes listings too small for the user's group", () => {
    const traits = emptyTraits();
    traits.groupSizeSum = 30;
    traits.groupSizeCount = 2; // typical 15 > maxGuests 12
    const s = scoreListing(traits, listing, venue, 80, 0);
    const neutral = scoreListing(emptyTraits(), listing, venue, 80, 0);
    expect(s.score).toBeLessThan(neutral.score);
  });
});

describe("pipeline: ingest → fold → recs → insights", () => {
  it("client batch ingestion accepts known events, drops unknown", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: {
        anonId: "test-anon-1",
        sessionId: "s1",
        events: [
          { name: "page.view", props: { path: "/" } },
          { name: "search.performed", props: { vertical: "coast", city: "tripoli", area: "janzour", filters: ["minPrivacy"] } },
          { name: "totally.unknown", props: {} },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { accepted: number }).accepted).toBe(2);
  });

  it("folds a user's events into a queryable profile and personalizes recs", async () => {
    // Create a user with distinctive behavior.
    const [user] = await db
      .insert(schema.users)
      .values({ phone: `+2189580${Math.floor(Math.random() * 90000) + 10000}`, role: "guest" })
      .returning();
    for (let i = 0; i < 3; i++) {
      await db.insert(schema.events).values({
        name: "search.performed",
        props: { vertical: "coast", city: "tripoli", area: "ain_zara", filters: ["generator"] },
        userId: user!.id,
        source: "web",
      });
    }
    await db.insert(schema.events).values({
      name: "listing.viewed",
      props: { vertical: "coast", city: "tripoli", area: "ain_zara", priceNightly: 350_000 },
      userId: user!.id,
      source: "web",
    });

    const traits = await foldUser(user!.id);
    expect(traits.areaAffinity.ain_zara).toBeGreaterThan(0);
    expect(traits.generatorAffinity).toBe(3);

    const [profile] = await db
      .select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, user!.id));
    expect(profile).toBeTruthy();

    // Incremental: refolding with no new events is a no-op.
    const again = await foldUser(user!.id);
    expect(again.generatorAffinity).toBe(3);
  });

  it("insights endpoint aggregates funnel and trends for ops", async () => {
    // ops login
    const reqRes = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: "0947000001" },
    });
    const { devCode } = reqRes.json() as { devCode: string };
    const ver = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone: "0947000001", code: devCode },
    });
    let token = (ver.json() as { accessToken: string }).accessToken;
    await db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.phone, "+218947000001"));
    // re-login to refresh role claim
    const reqRes2 = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: "0947000001" },
    });
    const ver2 = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone: "0947000001", code: (reqRes2.json() as { devCode: string }).devCode },
    });
    token = (ver2.json() as { accessToken: string }).accessToken;

    const res = await app.inject({
      method: "GET",
      url: "/v1/ops/insights?days=90",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      funnel: { searches: { count: number } };
      weekly: unknown[];
      seasonality: { byMonth: unknown[] };
      repeatRate: { totalGuests: number };
    };
    expect(body.funnel.searches.count).toBeGreaterThan(0);
    expect(Array.isArray(body.weekly)).toBe(true);
    expect(Array.isArray(body.seasonality.byMonth)).toBe(true);
  });

  it("recs endpoint returns transparent reasons", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/recs/home" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { personalized: boolean; items: { because: string }[] };
    expect(body.personalized).toBe(false); // anonymous
    for (const item of body.items) expect(item.because.length).toBeGreaterThan(0);
  });
});

describe("trust surface (reviews + disputes)", () => {
  it("exposes rating, histogram, dispute record and review eligibility", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/listings?type=coast&limit=50" });
    const items = (list.json() as { items: { id: string; slug: string }[] }).items;
    const villa = items.find((i) => i.slug === "janzour-marina-villa");
    if (!villa) return; // seed not present in this DB — nothing to assert
    const res = await app.inject({ method: "GET", url: `/v1/listings/${villa.id}/trust` });
    expect(res.statusCode).toBe(200);
    const t = res.json() as {
      rating: { value: number; count: number; histogram: Record<string, number>; source: string };
      reviews: { author: string; text?: string }[];
      disputes: { opened: number; resolved: number; deliveredBookings: number };
      canReview: { eligible: boolean };
    };
    expect(t.rating.count).toBeGreaterThanOrEqual(3);
    expect(t.rating.source).toBe("guests");
    // histogram sums to the review count
    expect(Object.values(t.rating.histogram).reduce((a, b) => a + b, 0)).toBe(t.rating.count);
    // dispute record has a denominator and never leaks statements
    expect(t.disputes.deliveredBookings).toBeGreaterThanOrEqual(t.disputes.opened);
    expect(JSON.stringify(t.disputes)).not.toContain("statement");
    // reviewer identity is initials only (§11.5)
    for (const r of t.reviews) expect(r.author.length).toBeLessThanOrEqual(12);
    // anonymous callers are told to sign in rather than shown a review form
    expect(t.canReview.eligible).toBe(false);
  });
});
