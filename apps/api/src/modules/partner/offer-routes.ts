/**
 * The Facebook kit: a permanent storefront link, and a flash offer to announce
 * on it.
 *
 * This module exists because of an observation about how this market actually
 * sells, not because of a feature request. Every venue worth signing already
 * runs on a Facebook page and a WhatsApp number. The price list is a photograph
 * of a poster in a post. Availability is a reply. A booking is a phone call
 * between eleven and five, to an office that may be in a different building
 * from the property. Lancaster Al Salam has forty-four thousand followers and
 * no way to convert one of them at midnight.
 *
 * So the pitch to a partner is not "list with us and we'll find you customers"
 * — they have customers. It is: *here is a link, put it on the page you already
 * run, and everything that used to be a phone call now happens by itself.* And
 * once a fortnight, *here is a code you can announce, live for twenty-four
 * hours, that will tell you exactly what that page is worth.*
 *
 * Two rules hold the money straight.
 *
 * **A partner's offer is the partner's money.** Ciao-funded promo codes come
 * out of our commission and are capped there (§9.2). A flash offer is the
 * venue's own price coming down, so it reduces the booking total — and our
 * commission, being a percentage of that total, comes down proportionally with
 * it. Neither side subsidises the other, and it fits in one sentence a partner
 * will believe: a ten per cent offer costs you ten per cent of your revenue and
 * costs us ten per cent of ours.
 *
 * **It expires by construction.** `endsAt` is required and bounded. The whole
 * mechanism of a flash offer is that it ends — "٢٤ ساعة فقط" is the reason
 * anybody clicks today rather than thinking about it — and a code that quietly
 * runs forever is a permanent discount the partner did not agree to.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, gt, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { partnerContext } from "./guards.js";
import { track } from "../intelligence/events.js";
import { config } from "../../config.js";

/** The shortest useful life, and the longest a "flash" can honestly claim. */
const MIN_OFFER_HOURS = 1;
const MAX_OFFER_HOURS = 14 * 24;
/** A partner discounting more than this is a mistake, not a campaign. */
const MAX_OFFER_BPS = 4000; // 40%

/**
 * Codes people retype off a phone screen held by somebody else.
 *
 * No `0/O`, no `1/I`: the alphabet is chosen for a guest squinting at a
 * Facebook post on a cracked screen, not for entropy. Six characters over this
 * alphabet is 1.2 billion combinations, which is ample for a code that lives a
 * day and belongs to one venue.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function offerCode(seed: string): string {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `${seed}${out}`.slice(0, 12).toUpperCase();
}

/** Venues this partner may act for. */
async function venuesFor(partnerId: string) {
  return db
    .select({
      id: schema.venues.id,
      slug: schema.venues.slug,
      nameAr: schema.venues.nameAr,
      nameEn: schema.venues.nameEn,
      type: schema.venues.type,
      city: schema.venues.city,
    })
    .from(schema.venues)
    .where(eq(schema.venues.hostId, partnerId));
}

export async function flashOfferRoutes(app: FastifyInstance) {
  /**
   * The kit itself: the link to pin, and the offers running behind it.
   *
   * `diary`-capable rather than `money`, deliberately. The person who posts to
   * the Facebook page at a Libyan resort is very often the receptionist, not
   * the owner — and the link is public information the moment it is pinned, so
   * gating it behind the money screens would stop the right person doing the
   * one thing we most want done. Creating an offer is a different matter and
   * takes `money`, below.
   */
  app.get("/v1/partner/storefront", async (req, reply) => {
    const ctx = await partnerContext(req);
    ctx.require("diary");
    const venues = await venuesFor(ctx.partnerId);

    const now = new Date();
    const offers = venues.length
      ? await db
          .select()
          .from(schema.promoCodes)
          .where(
            and(
              inArray(
                schema.promoCodes.venueId,
                venues.map((v) => v.id),
              ),
              eq(schema.promoCodes.fundedBy, "partner"),
            ),
          )
          .orderBy(desc(schema.promoCodes.createdAt))
          .limit(50)
      : [];

    /*
     * Arrivals and bookings attributed to each source, so the answer to "is my
     * Facebook page worth anything" is a number rather than a feeling. Counts
     * only — this never becomes a list of who visited.
     */
    const attribution = venues.length
      ? await db
          .select({
            venueId: schema.bookings.venueId,
            source: schema.bookings.source,
            bookings: sql<number>`count(*)::int`,
            value: sql<number>`coalesce(sum(${schema.bookings.totalAmount}), 0)::bigint`,
          })
          .from(schema.bookings)
          .where(
            and(
              inArray(
                schema.bookings.venueId,
                venues.map((v) => v.id),
              ),
              isNotNull(schema.bookings.source),
            ),
          )
          .groupBy(schema.bookings.venueId, schema.bookings.source)
      : [];

    return reply.send({
      /** Where a link should point. The web app builds the rest of the URL. */
      webBaseUrl: config.webBaseUrl,
      venues: venues.map((v) => ({
        ...v,
        /** Null until ops assigns a slug; the UI says so rather than 404ing. */
        storefrontPath: v.slug ? `/v/${v.slug}` : null,
      })),
      offers: offers.map((o) => ({
        id: o.id,
        code: o.code,
        venueId: o.venueId,
        kind: o.kind,
        value: o.value,
        descriptionAr: o.descriptionAr,
        startsAt: o.startsAt,
        endsAt: o.endsAt,
        maxRedemptions: o.maxRedemptions,
        timesUsed: o.timesUsed,
        active: o.active,
        live: Boolean(
          o.active && (!o.startsAt || o.startsAt <= now) && (!o.endsAt || o.endsAt > now),
        ),
      })),
      attribution: attribution.map((a) => ({ ...a, value: Number(a.value) })),
    });
  });

  /**
   * Announce an offer.
   *
   * `money`-capable: this is the partner's margin. Staff can post the link;
   * only an owner or manager can decide what it costs.
   */
  app.post("/v1/partner/offers", {
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
    handler: async (req, reply) => {
      const ctx = await partnerContext(req);
      ctx.require("money");
      const body = z
        .object({
          venueId: z.string().uuid(),
          /** Percent off, in basis points. 1000 = 10%. */
          valueBps: z.number().int().min(100).max(MAX_OFFER_BPS),
          hours: z.number().int().min(MIN_OFFER_HOURS).max(MAX_OFFER_HOURS).default(24),
          descriptionAr: z.string().max(160).optional(),
          maxRedemptions: z.number().int().min(1).max(500).optional(),
          minSpend: z.number().int().min(0).optional(),
        })
        .parse(req.body);

      const venues = await venuesFor(ctx.partnerId);
      const venue = venues.find((v) => v.id === body.venueId);
      if (!venue) throw new CiaoError("AUTH_FORBIDDEN");

      /*
       * One live offer per venue.
       *
       * Two overlapping codes for the same property is a race the guest wins
       * and the partner loses, and it makes "what is my discount right now" a
       * question nobody can answer at the counter. Superseding is explicit:
       * the older one is switched off, and the audit trail keeps it.
       */
      const now = new Date();
      await db
        .update(schema.promoCodes)
        .set({ active: false })
        .where(
          and(
            eq(schema.promoCodes.venueId, venue.id),
            eq(schema.promoCodes.fundedBy, "partner"),
            eq(schema.promoCodes.active, true),
          ),
        );

      const endsAt = new Date(now.getTime() + body.hours * 3600 * 1000);
      const seed = (venue.nameEn ?? venue.nameAr).replace(/[^A-Za-z]/g, "").slice(0, 4) || "CIAO";

      /* Retry on the unique index rather than trusting one draw. */
      let created: typeof schema.promoCodes.$inferSelect | undefined;
      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        try {
          [created] = await db
            .insert(schema.promoCodes)
            .values({
              code: offerCode(seed),
              kind: "percent",
              value: body.valueBps,
              descriptionAr: body.descriptionAr ?? null,
              venueId: venue.id,
              vertical: venue.type,
              city: venue.city,
              minSpend: body.minSpend ?? 0,
              startsAt: now,
              endsAt,
              maxRedemptions: body.maxRedemptions ?? null,
              perUserLimit: 1,
              active: true,
              fundedBy: "partner",
              createdByPartnerId: ctx.partnerId,
              createdById: ctx.actorId,
            })
            .returning();
        } catch (e) {
          if (attempt === 4) throw e;
        }
      }

      track(
        "partner.offer_created",
        { valueBps: body.valueBps, hours: body.hours, vertical: venue.type },
        { source: "api" },
      );

      return reply.status(201).send({
        id: created!.id,
        code: created!.code,
        endsAt: created!.endsAt,
        storefrontPath: venue.slug ? `/v/${venue.slug}` : null,
      });
    },
  });

  /** Pull an offer early. Ending a discount is always allowed. */
  app.post("/v1/partner/offers/:id/stop", async (req, reply) => {
    const ctx = await partnerContext(req);
    ctx.require("money");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const venues = await venuesFor(ctx.partnerId);
    const [offer] = await db
      .select()
      .from(schema.promoCodes)
      .where(eq(schema.promoCodes.id, id))
      .limit(1);
    if (!offer || !venues.some((v) => v.id === offer.venueId))
      throw new CiaoError("AUTH_FORBIDDEN");

    await db
      .update(schema.promoCodes)
      .set({ active: false, endsAt: new Date() })
      .where(eq(schema.promoCodes.id, id));
    track("partner.offer_stopped", { timesUsed: offer.timesUsed }, { source: "api" });
    return reply.send({ ok: true });
  });
}
