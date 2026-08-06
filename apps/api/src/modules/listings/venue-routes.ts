/**
 * The venue storefront — `ciao.ly/v/<slug>`.
 *
 * Two problems solved by one page.
 *
 * **A resort is not three listings.** Lancaster sells chalets, villas and a
 * VVIP duplex from one gate, sharing one beach, one generator, one set of
 * fifteen facilities and one reputation. The database could always hang
 * several listings off a venue; nothing above it could. Search returned each
 * as an unrelated card, and the "similar places" block on a listing page
 * explicitly excluded the same venue — so a guest looking at the chalet could
 * not discover the villa. This route is the property: its facilities once, its
 * units as a picker, its cheapest live price as the headline.
 *
 * **The market runs on Facebook, and Facebook needs a link.** Every venue in
 * this market sells through a page and a WhatsApp number: the price list is a
 * photo in a post, availability is a reply, and booking is a phone call
 * between eleven and five. They are not short of an audience — Lancaster has
 * 44,000 followers — they are short of somewhere to send it. A permanent,
 * memorable URL they can pin to their page is the single most useful object
 * this platform can hand them, and every arrival through it carries a `src`
 * so the partner can finally see what their page is worth.
 *
 * Which is also why this route is deliberately open: no session, no wall, no
 * "sign in to see prices". A link that asks something of a visitor before it
 * shows them anything is a link nobody pins.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq, gt, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { track } from "../intelligence/events.js";
import { publicLocation } from "./location.js";
import { normaliseNeighbours } from "./neighbours.js";
import { loadPricingConfig } from "./pricing-config.js";
import { quoteStay, type Party } from "@ciao/shared";
import { effectiveFees } from "../business/settings.js";

/** Where a visitor came from. Short, because it rides in a URL people retype. */
export const LEAD_SOURCES = ["fb", "wa", "ig", "qr", "tt", "direct"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export function normaliseSource(raw: unknown): LeadSource {
  const s = String(raw ?? "").toLowerCase();
  return (LEAD_SOURCES as readonly string[]).includes(s) ? (s as LeadSource) : "direct";
}

export async function venueRoutes(app: FastifyInstance) {
  /**
   * The storefront. Open, cacheable, and cheap enough to survive a post going
   * around a family WhatsApp group on a Thursday night.
   */
  app.get("/v1/venues/:slug", async (req, reply) => {
    const { slug } = z.object({ slug: z.string().min(1).max(80) }).parse(req.params);
    const q = z
      .object({
        checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        adults: z.coerce.number().int().min(1).max(40).optional(),
        childAges: z.string().max(120).optional(),
        src: z.string().max(12).optional(),
      })
      .parse(req.query ?? {});

    const [venue] = await db
      .select()
      .from(schema.venues)
      .where(eq(schema.venues.slug, slug))
      .limit(1);
    if (!venue) throw new CiaoError("VALIDATION", "venue_not_found");

    const units = await db
      .select()
      .from(schema.listings)
      .where(
        and(eq(schema.listings.venueId, venue.id), eq(schema.listings.status, "live")),
      )
      .orderBy(asc(schema.listings.baseNightly));

    const party: Party | undefined = q.adults
      ? {
          adults: q.adults,
          childAges: (q.childAges ?? "")
            .split(",")
            .map((a) => Number(a.trim()))
            .filter((a) => Number.isFinite(a) && a >= 0 && a < 25),
        }
      : undefined;

    /*
     * Which units are taken for the requested dates.
     *
     * One query for the whole property rather than one per unit: a resort with
     * a dozen units on a 3G connection cannot afford a dozen round trips, and
     * the answer is the same shape either way.
     */
    let takenIds = new Set<string>();
    /*
     * With no dates, "sold out" still has to mean something.
     *
     * A visitor arriving from a Facebook post has not picked dates yet, and
     * the honest reading of "is this available" for them is the season rather
     * than a specific night. So an undated view marks a unit sold out when the
     * next 30 nights are entirely gone — which is exactly the state Lancaster
     * describes when they print "Sold out" beside the VVIP duplex on a price
     * list that names no dates either.
     */
    if (!q.checkIn && units.length > 0) {
      const horizon = 30;
      const today = new Date().toISOString().slice(0, 10);
      const blocked = await db
        .select({
          listingId: schema.calendarDays.listingId,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.calendarDays)
        .where(
          and(
            inArray(
              schema.calendarDays.listingId,
              units.map((u) => u.id),
            ),
            gte(schema.calendarDays.day, today),
            lte(schema.calendarDays.day, addDays(today, horizon - 1)),
            inArray(schema.calendarDays.state, ["booked", "blocked"]),
          ),
        )
        .groupBy(schema.calendarDays.listingId);
      takenIds = new Set(blocked.filter((b) => b.n >= horizon).map((b) => b.listingId));
    }
    if (q.checkIn && q.checkOut && units.length > 0) {
      const clashes = await db
        .select({ listingId: schema.calendarDays.listingId })
        .from(schema.calendarDays)
        .where(
          and(
            inArray(
              schema.calendarDays.listingId,
              units.map((u) => u.id),
            ),
            gte(schema.calendarDays.day, q.checkIn),
            // check-out day is not a night, so it is excluded
            lte(schema.calendarDays.day, addDays(q.checkOut, -1)),
            or(
              inArray(schema.calendarDays.state, ["booked", "blocked"]),
              and(
                eq(schema.calendarDays.state, "held"),
                gt(schema.calendarDays.holdExpiresAt, new Date()),
              ),
            ),
          ),
        );
      takenIds = new Set(clashes.map((c) => c.listingId));
    }

    const fees = await effectiveFees();
    const priced = await Promise.all(
      units.map(async (u) => {
        let from = u.baseNightly;
        let quote: ReturnType<typeof quoteStay> | null = null;
        if (q.checkIn && q.checkOut) {
          quote = quoteStay(
            await loadPricingConfig(u, q.checkIn, q.checkOut),
            new Date(`${q.checkIn}T00:00:00Z`),
            new Date(`${q.checkOut}T00:00:00Z`),
            { party, foundingHost: venue.foundingHost, fees },
          );
          from = quote.nights[0]?.price ?? u.baseNightly;
        }
        return {
          id: u.id,
          slug: u.slug,
          titleAr: u.titleAr,
          titleEn: u.titleEn,
          unitKind: u.unitKind,
          maxGuests: u.maxGuests,
          includedGuests: u.includedGuests,
          bedrooms: u.bedrooms,
          bathrooms: u.bathrooms,
          boardBasis: u.boardBasis,
          minNights: u.minNights,
          media: (u.media as unknown[] | null)?.slice(0, 3) ?? [],
          fromNightly: from,
          /*
           * Sold out is a *state*, not an absence. Lancaster prints its VVIP
           * duplex with "Sold out" beside it and leaves it on the sheet,
           * because scarcity is the best argument for the units still
           * available. Hiding it, which is all Ciao could do until now, threw
           * away both that argument and the clearest demand signal a
           * marketplace ever gets.
           */
          soldOut: takenIds.has(u.id),
          ...(quote
            ? {
                stayTotal: quote.total,
                stayDeposit: quote.deposit,
                depositCapped: quote.depositCapped,
                requiredMinNights: quote.requiredMinNights,
              }
            : {}),
        };
      }),
    );

    const available = priced.filter((u) => !u.soldOut);
    const loc = publicLocation(venue);

    /* A live offer the venue is running — the thing announced on Facebook. */
    const now = new Date();
    const [offer] = await db
      .select({
        code: schema.promoCodes.code,
        kind: schema.promoCodes.kind,
        value: schema.promoCodes.value,
        descriptionAr: schema.promoCodes.descriptionAr,
        endsAt: schema.promoCodes.endsAt,
      })
      .from(schema.promoCodes)
      .where(
        and(
          eq(schema.promoCodes.venueId, venue.id),
          eq(schema.promoCodes.active, true),
          or(sql`${schema.promoCodes.startsAt} is null`, lte(schema.promoCodes.startsAt, now)),
          or(sql`${schema.promoCodes.endsAt} is null`, gt(schema.promoCodes.endsAt, now)),
        ),
      )
      .limit(1);

    track(
      "venue.viewed",
      {
        venueId: venue.id,
        vertical: venue.type,
        city: venue.city,
        src: normaliseSource(q.src),
        units: units.length,
        soldOutUnits: priced.length - available.length,
        hasOffer: Boolean(offer),
      },
      { source: "api" },
    );

    return reply.send({
      id: venue.id,
      slug: venue.slug,
      type: venue.type,
      nameAr: venue.nameAr,
      nameEn: venue.nameEn,
      city: venue.city,
      area: venue.area,
      approxLocation: loc.approx,
      locationAreaOnly: loc.areaOnly,
      neighbours: normaliseNeighbours(venue.neighbours),
      amenities: venue.amenities,
      privacy: venue.privacy,
      verified: Boolean(venue.verifiedAt) && !venue.badgeRevoked,
      verifiedAt: venue.verifiedAt,
      officeHours: venue.officeHours,
      capacityWomens: venue.capacityWomens,
      capacityMens: venue.capacityMens,
      units: priced,
      /** The headline. Null when every unit is taken, which is itself a fact. */
      fromNightly: available.length ? Math.min(...available.map((u) => u.fromNightly)) : null,
      allSoldOut: units.length > 0 && available.length === 0,
      offer: offer ?? null,
    });
  });

  /**
   * Other units at the same property.
   *
   * The listing page's existing "similar places" block is same-city,
   * different-venue by construction — it explicitly excludes this venue — so
   * without this a guest reading about the chalet has no way to discover that
   * the villa next to it sleeps six.
   */
  app.get("/v1/listings/:id/siblings", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [listing] = await db
      .select({ venueId: schema.listings.venueId })
      .from(schema.listings)
      .where(eq(schema.listings.id, id))
      .limit(1);
    if (!listing) throw new CiaoError("VALIDATION", "listing_not_found");

    const rows = await db
      .select({
        id: schema.listings.id,
        slug: schema.listings.slug,
        titleAr: schema.listings.titleAr,
        titleEn: schema.listings.titleEn,
        unitKind: schema.listings.unitKind,
        maxGuests: schema.listings.maxGuests,
        includedGuests: schema.listings.includedGuests,
        boardBasis: schema.listings.boardBasis,
        baseNightly: schema.listings.baseNightly,
        media: schema.listings.media,
      })
      .from(schema.listings)
      .where(
        and(
          eq(schema.listings.venueId, listing.venueId),
          eq(schema.listings.status, "live"),
          sql`${schema.listings.id} <> ${id}`,
        ),
      )
      .orderBy(asc(schema.listings.baseNightly))
      .limit(12);

    const [venue] = await db
      .select({
        slug: schema.venues.slug,
        nameAr: schema.venues.nameAr,
        nameEn: schema.venues.nameEn,
      })
      .from(schema.venues)
      .where(eq(schema.venues.id, listing.venueId))
      .limit(1);

    return reply.send({ venue: venue ?? null, items: rows });
  });
}

/** Date arithmetic on ISO strings, because that is what the calendar stores. */
export function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
