/**
 * Wishlist — the heart. High-intent behavioral signal (weight 4 in folding)
 * and a retention surface ("your saved places" nudges later).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { authenticate } from "../../lib/guards.js";
import { CiaoError } from "../../lib/errors.js";
import { track } from "../intelligence/events.js";

export async function wishlistRoutes(app: FastifyInstance) {
  /** Toggle a heart. Returns the new state. */
  app.post("/v1/wishlist/:listingId", async (req, reply) => {
    const claims = await authenticate(req);
    const { listingId } = z.object({ listingId: z.string().uuid() }).parse(req.params);

    const [listing] = await db
      .select({ listing: schema.listings, venue: schema.venues })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(eq(schema.listings.id, listingId))
      .limit(1);
    if (!listing) throw new CiaoError("BOOKING_NOT_FOUND");

    const [existing] = await db
      .select()
      .from(schema.wishlists)
      .where(
        and(
          eq(schema.wishlists.userId, claims.sub),
          eq(schema.wishlists.listingId, listingId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .delete(schema.wishlists)
        .where(
          and(
            eq(schema.wishlists.userId, claims.sub),
            eq(schema.wishlists.listingId, listingId),
          ),
        );
      track("listing.unsaved", { listingId }, { userId: claims.sub });
      return reply.send({ saved: false });
    }

    await db
      .insert(schema.wishlists)
      .values({ userId: claims.sub, listingId })
      .onConflictDoNothing();
    track(
      "listing.saved",
      {
        listingId,
        vertical: listing.venue.type,
        city: listing.venue.city,
        area: listing.venue.area,
        priceNightly: listing.listing.baseNightly,
      },
      { userId: claims.sub },
    );
    return reply.send({ saved: true });
  });

  /** The user's saved listings (public card shape). */
  app.get("/v1/wishlist", async (req, reply) => {
    const claims = await authenticate(req);
    const rows = await db
      .select({ listing: schema.listings, venue: schema.venues })
      .from(schema.wishlists)
      .innerJoin(schema.listings, eq(schema.wishlists.listingId, schema.listings.id))
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(eq(schema.wishlists.userId, claims.sub))
      .orderBy(desc(schema.wishlists.createdAt));
    return reply.send({
      items: rows.map(({ listing, venue }) => ({
        id: listing.id,
        slug: listing.slug,
        titleAr: listing.titleAr,
        titleEn: listing.titleEn,
        city: venue.city,
        area: venue.area,
        baseNightly: listing.baseNightly,
        media: listing.media,
        verified: Boolean(venue.verifiedAt) && !venue.badgeRevoked,
      })),
    });
  });

  /** Just the ids — cheap hydration of heart states across pages. */
  app.get("/v1/wishlist/ids", async (req, reply) => {
    const claims = await authenticate(req);
    const rows = await db
      .select({ listingId: schema.wishlists.listingId })
      .from(schema.wishlists)
      .where(eq(schema.wishlists.userId, claims.sub));
    return reply.send({ ids: rows.map((r) => r.listingId) });
  });
}
