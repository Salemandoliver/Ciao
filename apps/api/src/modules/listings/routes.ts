import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, gte, sql, desc } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import * as calendar from "../calendar/service.js";
import { quoteStay } from "@ciao/shared";
import { effectiveFees } from "../business/settings.js";
import { track } from "../intelligence/events.js";
import { verifyAccessToken } from "../../lib/auth.js";
import { publicLocation } from "./location.js";
import { normaliseNeighbours } from "./neighbours.js";
import {
  parseBoundingBox,
  parsePolygon,
  pointInPolygon,
  polygonBounds,
  type BoundingBox,
} from "./geo.js";

/**
 * Public listing/search endpoints.
 * Ranking (§8.4): verification + host reliability + freshness — no star-sort at launch.
 * Cultural filters are first-class: satar/privacy, generator, family-only, women's capacity.
 */
export async function listingRoutes(app: FastifyInstance) {
  app.get("/v1/listings", async (req, reply) => {
    const q = z
      .object({
        type: z.enum(["coast", "hall", "service"]).default("coast"),
        serviceCategory: z.string().max(20).optional(),
        city: z.string().optional(),
        area: z.string().optional(),
        minPrivacy: z.coerce.number().optional(), // satar score 0–100
        generator: z.coerce.boolean().optional(),
        familyOnly: z.coerce.boolean().optional(),
        minBedrooms: z.coerce.number().optional(),
        maxGuests: z.coerce.number().optional(),
        womensCapacity: z.coerce.number().optional(),
        maxNightly: z.coerce.number().optional(), // dirhams
        checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        /*
         * Search by a shape the guest drew, rather than a city they picked
         * from a list. `poly` is the drawn outline; `bbox` is the simpler
         * "what's on screen right now" case. Both match against the published
         * approximate point — see geo.ts for why that is safe and why it is
         * what makes area-only providers searchable without being locatable.
         */
        bbox: z.string().max(120).optional(),
        poly: z.string().max(1600).optional(),
        limit: z.coerce.number().max(50).default(20),
        offset: z.coerce.number().default(0),
      })
      .parse(req.query);

    const polygon = parsePolygon(q.poly);
    const box: BoundingBox | null = polygon ? polygonBounds(polygon) : parseBoundingBox(q.bbox);

    const conditions = [
      eq(schema.listings.status, "live"),
      eq(schema.venues.type, q.type),
    ];
    if (q.city) conditions.push(eq(schema.venues.city, q.city));
    if (q.serviceCategory)
      conditions.push(eq(schema.listings.serviceCategory, q.serviceCategory));
    if (q.area) conditions.push(eq(schema.venues.area, q.area));
    if (q.familyOnly) conditions.push(eq(schema.listings.familyOnly, true));
    if (q.minBedrooms) conditions.push(gte(schema.listings.bedrooms, q.minBedrooms));
    if (q.maxGuests) conditions.push(gte(schema.listings.maxGuests, q.maxGuests));
    if (q.womensCapacity)
      conditions.push(gte(schema.venues.capacityWomens, q.womensCapacity));
    if (q.maxNightly)
      conditions.push(sql`${schema.listings.baseNightly} <= ${q.maxNightly}`);
    if (q.minPrivacy)
      conditions.push(
        sql`coalesce((${schema.venues.privacy} ->> 'score')::int, 0) >= ${q.minPrivacy}`,
      );
    if (q.generator)
      conditions.push(
        sql`exists (select 1 from jsonb_array_elements(${schema.venues.amenities}) a
             where a ->> 'key' = 'generator' and (a ->> 'present')::boolean)`,
      );
    /*
     * Geo filter, in two stages: the bounding box narrows in SQL (indexable,
     * cheap), and the exact point-in-polygon test runs in JS over what
     * survives. A venue with no recorded coordinates simply cannot match a
     * drawn area — which is a real gap in the catalogue today, not a bug here:
     * most venues have no pin yet, and the verification flow is where that
     * gets fixed.
     */
    if (box) {
      conditions.push(
        sql`${schema.venues.approxLat} is not null and ${schema.venues.approxLng} is not null
            and (${schema.venues.approxLat})::numeric between ${box.south} and ${box.north}
            and (${schema.venues.approxLng})::numeric between ${box.west} and ${box.east}`,
      );
    }
    // Date availability: exclude listings with any blocked/booked/live-held day
    // in the requested range (missing calendar rows = open).
    if (q.checkIn && q.checkOut && q.checkOut > q.checkIn)
      conditions.push(
        sql`not exists (select 1 from calendar_days cd
             where cd.listing_id = ${schema.listings.id}
               and cd.session = 'night'
               and cd.day >= ${q.checkIn}::date and cd.day < ${q.checkOut}::date
               and (cd.state in ('booked','blocked')
                    or (cd.state = 'held' and cd.hold_expires_at > now())))`,
      );

    const rows = await db
      .select({
        listing: schema.listings,
        venue: schema.venues,
        reliability: schema.reliabilityScores.score,
        reviewCount: sql<string>`(select count(*) from reviews r
            where r.listing_id = ${schema.listings.id}
              and r.author_role = 'guest' and r.published_at is not null)`,
        // Mean of each review's own dimension-average (§8.8) — the guest
        // aggregate takes over from the Ciao inspection score at >= 3 reviews.
        guestRating: sql<string | null>`(select avg(m) from (
            select (select avg(value::numeric) from jsonb_each_text(r.scores)) as m
            from reviews r
            where r.listing_id = ${schema.listings.id}
              and r.author_role = 'guest' and r.published_at is not null) t)`,
      })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .leftJoin(
        schema.reliabilityScores,
        eq(schema.reliabilityScores.hostId, schema.venues.hostId),
      )
      .where(and(...conditions))
      // Ranking §8.4: verified first, then reliability, then calendar freshness.
      .orderBy(
        sql`case when ${schema.venues.verifiedAt} is not null and not ${schema.venues.badgeRevoked} then 0 else 1 end`,
        desc(sql`coalesce(${schema.reliabilityScores.score}, 50)`),
        desc(schema.listings.updatedAt),
      )
      .limit(q.limit)
      .offset(q.offset);

    const items = rows
      /*
       * Second stage of the geo filter: the drawn outline itself. The SQL box
       * has already thrown away everything obviously outside, so this runs
       * over a handful of rows.
       */
      .filter(({ venue }) => {
        if (!polygon) return true;
        const lat = Number(venue.approxLat);
        const lng = Number(venue.approxLng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
        return pointInPolygon({ lat, lng }, polygon);
      })
      .map(({ listing, venue, reliability, reviewCount, guestRating }) => {
        const count = Number(reviewCount ?? 0);
        const base = publicListing(listing, venue, reliability, count);
        if (count >= 3 && guestRating != null) {
          base.rating = Number(Number(guestRating).toFixed(1));
          base.ratingSource = "guests";
        }
        return base;
      });

    /*
     * The `search.area_drawn` event is emitted from the client, not here.
     *
     * Discovery events are client-emitted throughout (`search.performed` is
     * the neighbouring case), and for a good reason: the tracker attaches the
     * anon/user identity that makes an event foldable into a profile, which a
     * server emit inside a public unauthenticated GET does not have. Emitting
     * from both places would have double-counted every drawn search in the
     * funnel while only half of them attributed to anybody.
     */

    return reply.send({ items });
  });

  app.get("/v1/listings/:slug", async (req, reply) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const [row] = await db
      .select({ listing: schema.listings, venue: schema.venues })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(eq(schema.listings.slug, slug))
      .limit(1);
    if (!row || row.listing.status !== "live") throw new CiaoError("BOOKING_NOT_FOUND");

    const packages = await db
      .select()
      .from(schema.packages)
      .where(
        and(eq(schema.packages.listingId, row.listing.id), eq(schema.packages.active, true)),
      );

    const reviews = await db
      .select()
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.listingId, row.listing.id),
          sql`${schema.reviews.publishedAt} is not null`,
          eq(schema.reviews.authorRole, "guest"),
        ),
      )
      .orderBy(desc(schema.reviews.createdAt))
      .limit(20);

    // Aggregate score only after ≥3 reviews (§8.8).
    const aggregate =
      reviews.length >= 3
        ? Number(
            (
              reviews.reduce((s, r) => {
                const scores = r.scores as Record<string, number>;
                const vals = Object.values(scores);
                return s + vals.reduce((a, b) => a + b, 0) / vals.length;
              }, 0) / reviews.length
            ).toFixed(1),
          )
        : null;

    // Ratings breakdown (Airbnb-style): per-dimension averages + histogram,
    // only once the aggregate is real (>=3 reviews, §8.8).
    let dimensionAverages: Record<string, number> | null = null;
    let ratingHistogram: Record<string, number> | null = null;
    if (reviews.length >= 3) {
      const sums: Record<string, { s: number; n: number }> = {};
      ratingHistogram = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
      for (const r of reviews) {
        const scores = r.scores as Record<string, number>;
        const vals = Object.values(scores);
        const overall = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
        ratingHistogram[String(Math.min(5, Math.max(1, overall)))]!++;
        for (const [k, v] of Object.entries(scores)) {
          sums[k] = { s: (sums[k]?.s ?? 0) + v, n: (sums[k]?.n ?? 0) + 1 };
        }
      }
      dimensionAverages = Object.fromEntries(
        Object.entries(sums).map(([k, { s: sum, n }]) => [k, Number((sum / n).toFixed(1))]),
      );
    }

    // "More nearby" strip: same vertical + city, verified-first.
    const similarRows = await db
      .select({ listing: schema.listings, venue: schema.venues })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(
        and(
          eq(schema.listings.status, "live"),
          eq(schema.venues.type, row.venue.type),
          eq(schema.venues.city, row.venue.city),
          sql`${schema.listings.id} <> ${row.listing.id}`,
        ),
      )
      .orderBy(
        sql`case when ${schema.venues.verifiedAt} is not null then 0 else 1 end`,
        desc(schema.listings.updatedAt),
      )
      .limit(4);

    const base = publicListing(row.listing, row.venue, null, reviews.length);
    // Guest aggregate replaces the Ciao rating once real (§8.8: ≥3 reviews).
    if (aggregate != null) {
      base.rating = aggregate;
      base.ratingSource = "guests";
    }
    return reply.send({
      ...base,
      packages,
      reviews: reviews.map((r) => ({
        scores: r.scores,
        text: r.text,
        hostReply: r.hostReply,
        createdAt: r.createdAt,
      })),
      aggregateScore: aggregate,
      reviewCount: reviews.length,
      dimensionAverages,
      ratingHistogram,
      similar: similarRows.map(({ listing: sl, venue: sv }) => ({
        id: sl.id,
        slug: sl.slug,
        titleAr: sl.titleAr,
        titleEn: sl.titleEn,
        area: sv.area,
        baseNightly: sl.baseNightly,
        media: sl.media,
        verified: Boolean(sv.verifiedAt) && !sv.badgeRevoked,
        serviceCategory: sl.serviceCategory,
      })),
    });
  });

  app.get("/v1/listings/:id/availability", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = z
      .object({
        month: z.string().regex(/^\d{4}-\d{2}$/),
        session: z.string().default("night"),
      })
      .parse(req.query);
    const days = await calendar.monthAvailability(id, q.month, q.session);
    return reply.send({ month: q.month, days });
  });

  // Price quote (no auth — quote before OTP, §6.1 step 3).
  app.get("/v1/listings/:id/quote", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = z
      .object({
        checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(req.query);
    const [listing] = await db
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.id, id))
      .limit(1);
    if (!listing) throw new CiaoError("BOOKING_NOT_FOUND");
    const [venue] = await db
      .select()
      .from(schema.venues)
      .where(eq(schema.venues.id, listing.venueId))
      .limit(1);
    const quote = quoteStay(
      {
        baseNightly: listing.baseNightly,
        weekendMultiplierBps: listing.weekendMultiplierBps,
        thursdayMultiplierBps: listing.thursdayMultiplierBps,
        seasonMultiplierBps: listing.seasonMultiplierBps,
      },
      new Date(`${q.checkIn}T00:00:00Z`),
      new Date(`${q.checkOut}T00:00:00Z`),
      { foundingHost: venue?.foundingHost, fees: await effectiveFees() },
    );
    // Intelligence: quote views are the strongest pre-money intent signal.
    let quoteUserId: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try { quoteUserId = (await verifyAccessToken(authHeader.slice(7))).sub; } catch { /* anon */ }
    }
    track("quote.viewed", {
      listingId: listing.id,
      vertical: venue?.type,
      city: venue?.city,
      area: venue?.area,
      checkIn: q.checkIn,
      nights: quote.nights.length,
      total: quote.total,
      deposit: quote.deposit,
      leadDays: Math.max(0, Math.round((new Date(`${q.checkIn}T00:00:00Z`).getTime() - Date.now()) / 86400000)),
    }, {
      userId: quoteUserId,
      anonId: typeof req.headers["x-ciao-anon"] === "string" ? req.headers["x-ciao-anon"] : undefined,
      source: "web",
    });

    // Guest-facing quote: never expose commission split (§9.1 — invisible fee).
    return reply.send({
      nights: quote.nights,
      total: quote.total,
      deposit: quote.deposit,
      balanceOnArrival: quote.balanceOnArrival,
    });
  });
}

/**
 * Ciao rating — a star score from our own field inspection (verification,
 * satar, amenities, host reliability). Shown on every listing so guests see
 * a familiar quality signal before the review corpus matures (§8.4: no pure
 * review-star sort at launch). Replaced by the guest aggregate at ≥3 reviews.
 */
function ciaoRating(
  listing: typeof schema.listings.$inferSelect,
  venue: typeof schema.venues.$inferSelect,
  reliability: number | null,
): number {
  let r = 3.6;
  if (venue.verifiedAt && !venue.badgeRevoked) r += 0.6;
  const privacy = (venue.privacy as { score?: number } | null)?.score ?? 0;
  if (privacy >= 80) r += 0.3;
  else if (privacy >= 50) r += 0.15;
  const amenities = venue.amenities as { key: string; present: boolean }[];
  if (amenities.some((a) => a.present && a.key === "generator")) r += 0.2;
  const rel = reliability ?? 50;
  if (rel >= 70) r += 0.3;
  else if (rel >= 50) r += 0.1;
  return Math.min(5, Math.round(r * 10) / 10);
}

function publicListing(
  listing: typeof schema.listings.$inferSelect,
  venue: typeof schema.venues.$inferSelect,
  reliability: number | null,
  reviewCount = 0,
) {
  return {
    id: listing.id,
    slug: listing.slug,
    titleAr: listing.titleAr,
    titleEn: listing.titleEn,
    descriptionAr: listing.descriptionAr,
    descriptionEn: listing.descriptionEn,
    type: venue.type,
    city: venue.city,
    area: venue.area,
    // §7.1: approximate location only pre-deposit
    /*
     * One module decides what a caller may see (location.ts). Inlining the
     * rule here is how a serializer eventually forgets it.
     */
    ...(() => {
      const loc = publicLocation(venue);
      return {
        approxLocation: loc.approx,
        exactLocation: loc.exact,
        locationAreaOnly: loc.areaOnly,
      };
    })(),
    neighbours: normaliseNeighbours(venue.neighbours),
    verified: Boolean(venue.verifiedAt) && !venue.badgeRevoked,
    verifiedAt: venue.verifiedAt,
    verificationGrade: venue.verifiedAt ? "verified" : "unverified", // internal grade stays internal (§11.2)
    amenities: venue.amenities,
    privacy: venue.privacy,
    capacityWomens: venue.capacityWomens,
    capacityMens: venue.capacityMens,
    baseNightly: listing.baseNightly,
    dayUsePrice: listing.dayUsePrice,
    maxGuests: listing.maxGuests,
    bedrooms: listing.bedrooms,
    familyOnly: listing.familyOnly,
    cancellationTier: listing.cancellationTier,
    media: listing.media,
    bookingTypes: listing.bookingTypes,
    serviceCategory: listing.serviceCategory,
    houseRulesAr: listing.houseRulesAr,
    hostReliability: reliability,
    rating: ciaoRating(listing, venue, reliability),
    ratingSource: "ciao" as "ciao" | "guests",
    reviewCount,
  };
}
