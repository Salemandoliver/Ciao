import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, gte, sql, desc } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import * as calendar from "../calendar/service.js";
import { quoteStay } from "@ciao/shared";

/**
 * Public listing/search endpoints.
 * Ranking (§8.4): verification + host reliability + freshness — no star-sort at launch.
 * Cultural filters are first-class: satar/privacy, generator, family-only, women's capacity.
 */
export async function listingRoutes(app: FastifyInstance) {
  app.get("/v1/listings", async (req, reply) => {
    const q = z
      .object({
        type: z.enum(["coast", "hall"]).default("coast"),
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
        limit: z.coerce.number().max(50).default(20),
        offset: z.coerce.number().default(0),
      })
      .parse(req.query);

    const conditions = [
      eq(schema.listings.status, "live"),
      eq(schema.venues.type, q.type),
    ];
    if (q.city) conditions.push(eq(schema.venues.city, q.city));
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

    return reply.send({
      items: rows.map(({ listing, venue, reliability }) =>
        publicListing(listing, venue, reliability),
      ),
    });
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

    return reply.send({
      ...publicListing(row.listing, row.venue, null),
      packages,
      reviews: reviews.map((r) => ({
        scores: r.scores,
        text: r.text,
        hostReply: r.hostReply,
        createdAt: r.createdAt,
      })),
      aggregateScore: aggregate,
      reviewCount: reviews.length,
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
      { foundingHost: venue?.foundingHost },
    );
    // Guest-facing quote: never expose commission split (§9.1 — invisible fee).
    return reply.send({
      nights: quote.nights,
      total: quote.total,
      deposit: quote.deposit,
      balanceOnArrival: quote.balanceOnArrival,
    });
  });
}

function publicListing(
  listing: typeof schema.listings.$inferSelect,
  venue: typeof schema.venues.$inferSelect,
  reliability: number | null,
) {
  return {
    id: listing.id,
    slug: listing.slug,
    titleAr: listing.titleAr,
    titleEn: listing.titleEn,
    descriptionAr: listing.descriptionAr,
    type: venue.type,
    city: venue.city,
    area: venue.area,
    // §7.1: approximate location only pre-deposit
    approxLocation:
      venue.approxLat && venue.approxLng
        ? { lat: venue.approxLat, lng: venue.approxLng, radiusM: 500 }
        : null,
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
    hostReliability: reliability,
  };
}
