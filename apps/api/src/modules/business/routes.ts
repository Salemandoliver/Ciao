/**
 * Ciao Business — the internal control system behind the public marketplace.
 *
 * Everything an operator needs to run the company: the supply catalogue and
 * how businesses get onboarded, the money (ledger-backed, never re-derived
 * from bookings), the people and their roles, the imagery, the platform
 * settings that steer the public app, and the audit trail that says who
 * changed what.
 *
 * Design rules for this module:
 *  1. **Read from the ledger, not from bookings.** Revenue questions are
 *     answered by double-entry postings so the console and the accountant
 *     never disagree. Booking tables answer volume questions only.
 *  2. **Every mutation audits.** `audit()` on the way out, always, with the
 *     before-state where it exists. A console that changes prices without a
 *     trail is a liability.
 *  3. **Ops can operate; only admin can change money and roles.** Onboarding
 *     a chalet is daily work; changing the commission rate is not.
 *  4. **Nothing here bypasses the state machine or the ledger.** The console
 *     is a better set of hands on the same machine, not a side door.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { normalizePhone } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { authenticate, requireRole } from "../../lib/guards.js";
import {
  SETTING_KEYS,
  getAllSettings,
  publicSettings,
  resetSettings,
  setSettings,
  settingRow,
  validateCoherence,
  validateSetting,
} from "./settings.js";

/**
 * Bookings that represent committed demand: the guest's money has actually
 * been captured. Anything earlier is intent, and counting intent as revenue is
 * how a marketplace lies to itself.
 */
const COMMITTED_STATES = [
  "payment_held",
  "host_confirmed",
  "confirmed",
  "pre_arrival_reconfirmed",
  "checked_in",
  "completed",
  "reviewed",
  "no_show",
  "disputed",
  "resolved",
];
/**
 * Stays/services that actually happened — the denominator the public trust
 * record is measured against. Same list as the trust surface uses (§11.6);
 * they must never drift apart or the two pages would disagree in public.
 */
const DELIVERED_STATES = [
  "checked_in",
  "completed",
  "reviewed",
  "no_show",
  "disputed",
  "resolved",
];

/** Same list, for the raw SQL sub-selects below. */
const COMMITTED_SQL = `array[${COMMITTED_STATES.map((s) => `'${s}'`).join(",")}]`;

const MEDIA_ITEM = z.object({
  url: z.string().min(1).max(500),
  kind: z.enum(["photo", "video"]).default("photo"),
  alt: z.string().max(200).optional(),
  watermark: z.boolean().optional(),
});

export async function businessRoutes(app: FastifyInstance) {
  async function audit(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    detail?: object,
  ) {
    await db.insert(schema.auditLog).values({ actorId, action, targetType, targetId, detail });
  }

  /** Ops-and-above for everything in this module unless stated otherwise. */
  async function opsGuard(req: Parameters<typeof authenticate>[0]) {
    const claims = await authenticate(req);
    requireRole(claims, "ops");
    return claims;
  }
  async function adminGuard(req: Parameters<typeof authenticate>[0]) {
    const claims = await authenticate(req);
    requireRole(claims, "admin");
    return claims;
  }

  // ============================================================= public config
  /**
   * The only unauthenticated route here: the slice of the control plane the
   * public web app needs (hero images, feature flags, announcement). Cached
   * hard at the edge — it changes when an operator changes it, not per request.
   */
  app.get("/v1/settings/public", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60, stale-while-revalidate=600");
    return reply.send(await publicSettings());
  });

  /**
   * Public proof — the numbers behind the claims on the About page.
   *
   * Every marketplace's about page says "trusted" and "verified". Ours says
   * how many places we actually walked into, how many photographs we took
   * ourselves, how many complaints were opened against how many delivered
   * stays, and how fast we closed them. An adjective anyone can write; a
   * denominator has to be earned.
   *
   * Same boundary as the trust surface (§11.6): counts and outcomes are
   * public, statements and identities never are.
   */
  app.get("/v1/stats/public", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=300, stale-while-revalidate=3600");

    const [venues] = await db
      .select({
        total: sql<string>`count(*)`,
        verified: sql<string>`count(*) filter (where ${schema.venues.verifiedAt} is not null and not ${schema.venues.badgeRevoked})`,
        cities: sql<string>`count(distinct ${schema.venues.city})`,
        areas: sql<string>`count(distinct ${schema.venues.area})`,
        firstVerifiedAt: sql<string>`min(${schema.venues.verifiedAt})`,
      })
      .from(schema.venues);

    // Only live listings count — a draft is not a promise we've made anyone.
    const byVertical = await db
      .select({
        vertical: sql<string>`case when ${schema.listings.serviceCategory} is not null
                                   then 'service' else ${schema.venues.type} end`,
        n: sql<string>`count(*)`,
        photos: sql<string>`coalesce(sum(jsonb_array_length(${schema.listings.media})), 0)`,
      })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(eq(schema.listings.status, "live"))
      .groupBy(sql`1`);

    const [reviews] = await db
      .select({ n: sql<string>`count(*)` })
      .from(schema.reviews)
      .where(and(eq(schema.reviews.authorRole, "guest"), isNotNull(schema.reviews.publishedAt)));

    const [delivered] = await db
      .select({ n: sql<string>`count(*)` })
      .from(schema.bookings)
      .where(inArray(schema.bookings.state, DELIVERED_STATES));

    const disputeRows = await db
      .select({
        status: schema.disputes.status,
        createdAt: schema.disputes.createdAt,
        resolvedAt: schema.disputes.resolvedAt,
        dueAt: schema.disputes.dueAt,
      })
      .from(schema.disputes);
    const resolved = disputeRows.filter((d) => d.status === "resolved" && d.resolvedAt);
    const hours = resolved
      .map((d) => (d.resolvedAt!.getTime() - d.createdAt.getTime()) / 3600_000)
      .sort((a, b) => a - b);

    const settings = await getAllSettings();

    return reply.send({
      venues: {
        verified: Number(venues?.verified ?? 0),
        total: Number(venues?.total ?? 0),
        cities: Number(venues?.cities ?? 0),
        areas: Number(venues?.areas ?? 0),
        verifyingSince: venues?.firstVerifiedAt ?? null,
      },
      listings: Object.fromEntries(byVertical.map((r) => [r.vertical, Number(r.n)])),
      photos: byVertical.reduce((s, r) => s + Number(r.photos ?? 0), 0),
      reviews: Number(reviews?.n ?? 0),
      trust: {
        deliveredBookings: Number(delivered?.n ?? 0),
        disputesOpened: disputeRows.length,
        disputesResolved: resolved.length,
        resolvedWithinSla: resolved.filter((d) => d.resolvedAt! <= d.dueAt).length,
        medianHours: hours.length ? Math.round(hours[Math.floor(hours.length / 2)]!) : null,
        slaHours: Number(settings["trust.disputeSlaHours"]),
      },
    });
  });

  // =============================================================== 1. overview
  /**
   * The one screen a founder opens in the morning: money in, demand, supply
   * health, and what needs a human today.
   */
  app.get("/v1/biz/overview", async (req, reply) => {
    await opsGuard(req);
    const { days } = z
      .object({ days: z.coerce.number().min(1).max(365).default(30) })
      .parse(req.query);
    const since = new Date(Date.now() - days * 86400_000);

    // ---- money, from the ledger (rule 1)
    const ledger = await db
      .select({
        account: schema.ledgerEntries.account,
        debit: sql<string>`sum(${schema.ledgerEntries.debit})`,
        credit: sql<string>`sum(${schema.ledgerEntries.credit})`,
      })
      .from(schema.ledgerEntries)
      .where(gte(schema.ledgerEntries.createdAt, since))
      .groupBy(schema.ledgerEntries.account);

    // Net is credit − debit: positive means the account holds value for us.
    const net: Record<string, number> = {};
    for (const r of ledger) net[r.account] = Number(r.credit ?? 0) - Number(r.debit ?? 0);

    // ---- demand
    const [bookingAgg] = await db
      .select({
        n: sql<string>`count(*)`,
        gmv: sql<string>`coalesce(sum(${schema.bookings.totalAmount}), 0)`,
        deposits: sql<string>`coalesce(sum(${schema.bookings.depositAmount}), 0)`,
      })
      .from(schema.bookings)
      .where(
        and(
          gte(schema.bookings.createdAt, since),
          inArray(schema.bookings.state, COMMITTED_STATES),
        ),
      );

    const byState = await db
      .select({ state: schema.bookings.state, n: sql<string>`count(*)` })
      .from(schema.bookings)
      .where(gte(schema.bookings.createdAt, since))
      .groupBy(schema.bookings.state);

    // ---- supply
    const listingsByStatus = await db
      .select({ status: schema.listings.status, n: sql<string>`count(*)` })
      .from(schema.listings)
      .groupBy(schema.listings.status);

    const [supply] = await db
      .select({
        venues: sql<string>`count(*)`,
        verified: sql<string>`count(*) filter (where ${schema.venues.verifiedAt} is not null and not ${schema.venues.badgeRevoked})`,
        expiring: sql<string>`count(*) filter (where ${schema.venues.verificationExpiresAt} < now() + interval '30 days')`,
      })
      .from(schema.venues);

    // ---- what needs a human today
    const [pendingVerifications] = await db
      .select({ n: sql<string>`count(*)` })
      .from(schema.verifications)
      .where(eq(schema.verifications.outcome, "pending"));

    const openDisputes = await db
      .select({
        id: schema.disputes.id,
        bookingId: schema.disputes.bookingId,
        category: schema.disputes.category,
        dueAt: schema.disputes.dueAt,
        overdue: sql<boolean>`${schema.disputes.dueAt} < now()`,
      })
      .from(schema.disputes)
      .where(sql`${schema.disputes.status} <> 'resolved'`)
      .orderBy(schema.disputes.dueAt)
      .limit(20);

    const [awaitingHost] = await db
      .select({ n: sql<string>`count(*)` })
      .from(schema.bookings)
      .where(eq(schema.bookings.state, "payment_held"));

    const rails = await db.select().from(schema.railHealth);

    const settings = await getAllSettings();

    return reply.send({
      windowDays: days,
      money: {
        // Account names per the ledger contract in payments/ledger.ts.
        // Income and liabilities are credit-normal, so a positive net is what
        // we earned / what we owe. Guest credit is keyed per user, so it sums.
        revenue: net["platform_revenue"] ?? 0,
        depositsHeld: net["guest_deposits_held"] ?? 0,
        hostPayables: net["host_payables"] ?? 0,
        // Asset account (debit-normal): flip the sign so "money sitting at the
        // PSP" reads as a positive balance rather than a negative liability.
        railSettlementPending: -Object.entries(net)
          .filter(([a]) => a.startsWith("rail_settlement_pending:"))
          .reduce((s, [, v]) => s + v, 0),
        guestCredit: Object.entries(net)
          .filter(([a]) => a.startsWith("guest_credit:"))
          .reduce((s, [, v]) => s + v, 0),
        accounts: net,
      },
      demand: {
        committedBookings: Number(bookingAgg?.n ?? 0),
        gmv: Number(bookingAgg?.gmv ?? 0),
        depositsCollected: Number(bookingAgg?.deposits ?? 0),
        byState: Object.fromEntries(byState.map((r) => [r.state, Number(r.n)])),
      },
      supply: {
        venues: Number(supply?.venues ?? 0),
        verified: Number(supply?.verified ?? 0),
        verificationExpiringSoon: Number(supply?.expiring ?? 0),
        listingsByStatus: Object.fromEntries(
          listingsByStatus.map((r) => [r.status, Number(r.n)]),
        ),
      },
      needsAttention: {
        pendingVerifications: Number(pendingVerifications?.n ?? 0),
        bookingsAwaitingHost: Number(awaitingHost?.n ?? 0),
        openDisputes: openDisputes.length,
        overdueDisputes: openDisputes.filter((d) => d.overdue).length,
        disputes: openDisputes,
        degradedRails: rails.filter((r) => !r.healthy).map((r) => r.rail),
      },
      posture: {
        demoMode: settings["ops.demoMode"],
        acceptingBookings: settings["ops.acceptingBookings"],
        announcementAr: settings["ops.announcementAr"],
      },
    });
  });

  // ============================================================ 2. the catalogue
  /**
   * Every business on the platform with the numbers that decide whether we
   * invest in them: what they've earned us, how reliable they are, whether
   * their verification is about to lapse.
   */
  app.get("/v1/biz/businesses", async (req, reply) => {
    await opsGuard(req);
    const q = z
      .object({
        type: z.enum(["coast", "hall", "service", "all"]).default("all"),
        status: z.enum(["draft", "live", "paused", "delisted", "all"]).default("all"),
        search: z.string().optional(),
        limit: z.coerce.number().min(1).max(200).default(100),
      })
      .parse(req.query);

    const conditions = [];
    if (q.type !== "all") {
      conditions.push(
        q.type === "service"
          ? sql`${schema.listings.serviceCategory} is not null`
          : and(
              eq(schema.venues.type, q.type),
              sql`${schema.listings.serviceCategory} is null`,
            )!,
      );
    }
    if (q.status !== "all") conditions.push(eq(schema.listings.status, q.status));
    if (q.search) {
      const like = `%${q.search}%`;
      conditions.push(
        sql`(${schema.listings.titleAr} ilike ${like} or ${schema.venues.nameAr} ilike ${like} or ${schema.listings.slug} ilike ${like})`,
      );
    }

    const rows = await db
      .select({
        listing: schema.listings,
        venue: schema.venues,
        host: {
          id: schema.users.id,
          phone: schema.users.phone,
          displayName: schema.users.displayName,
        },
        reliability: schema.reliabilityScores.score,
        bookings: sql<string>`(select count(*) from bookings b
           where b.listing_id = ${schema.listings.id}
             and b.state = any(${sql.raw(COMMITTED_SQL)}))`,
        gmv: sql<string>`(select coalesce(sum(b.total_amount),0) from bookings b
           where b.listing_id = ${schema.listings.id}
             and b.state = any(${sql.raw(COMMITTED_SQL)}))`,
        reviewCount: sql<string>`(select count(*) from reviews r
           where r.listing_id = ${schema.listings.id} and r.author_role = 'guest' and r.published_at is not null)`,
        disputeCount: sql<string>`(select count(*) from disputes d
           join bookings b on b.id = d.booking_id where b.listing_id = ${schema.listings.id})`,
      })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .leftJoin(schema.users, eq(schema.venues.hostId, schema.users.id))
      .leftJoin(schema.reliabilityScores, eq(schema.reliabilityScores.hostId, schema.venues.hostId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.listings.updatedAt))
      .limit(q.limit);

    return reply.send({
      items: rows.map((r) => ({
        listingId: r.listing.id,
        slug: r.listing.slug,
        titleAr: r.listing.titleAr,
        status: r.listing.status,
        vertical: r.listing.serviceCategory ? "service" : r.venue.type,
        serviceCategory: r.listing.serviceCategory,
        venueId: r.venue.id,
        venueNameAr: r.venue.nameAr,
        city: r.venue.city,
        area: r.venue.area,
        verified: Boolean(r.venue.verifiedAt) && !r.venue.badgeRevoked,
        verificationExpiresAt: r.venue.verificationExpiresAt,
        host: r.host?.id
          ? { id: r.host.id, phone: r.host.phone, name: r.host.displayName }
          : null,
        reliability: r.reliability,
        baseNightly: r.listing.baseNightly,
        mediaCount: (r.listing.media as unknown[]).length,
        bookings: Number(r.bookings ?? 0),
        gmv: Number(r.gmv ?? 0),
        reviewCount: Number(r.reviewCount ?? 0),
        disputeCount: Number(r.disputeCount ?? 0),
      })),
    });
  });

  /**
   * Onboard a business end-to-end in one call: host account, venue, listing.
   * This is the daily job of the supply team, and doing it as three separate
   * requests is how you end up with orphan venues and hosts who can't log in.
   * The listing lands in `draft` — publishing is a separate, deliberate act
   * that should follow a field visit (§11.2).
   */
  app.post("/v1/biz/businesses", async (req, reply) => {
    const claims = await opsGuard(req);
    const body = z
      .object({
        vertical: z.enum(["coast", "hall", "service"]),
        serviceCategory: z
          .enum(["catering", "photography", "makeup", "hair", "cakes", "gym"])
          .optional(),
        hostPhone: z.string().min(9),
        hostName: z.string().min(2).max(80),
        venueNameAr: z.string().min(2).max(120),
        city: z.string().min(2).max(40),
        area: z.string().max(60).optional(),
        addressAr: z.string().max(300).optional(),
        approxLat: z.string().optional(),
        approxLng: z.string().optional(),
        slug: z
          .string()
          .min(3)
          .max(80)
          .regex(/^[a-z0-9-]+$/, "slug must be lowercase-kebab"),
        titleAr: z.string().min(3).max(200),
        descriptionAr: z.string().max(3000).optional(),
        baseNightly: z.number().int().min(0).default(0),
        maxGuests: z.number().int().min(1).optional(),
        bedrooms: z.number().int().min(0).optional(),
        capacityWomens: z.number().int().min(0).optional(),
        familyOnly: z.boolean().default(false),
        cancellationTier: z.enum(["flexible", "moderate", "strict"]).default("moderate"),
      })
      .parse(req.body);

    if (body.vertical === "service" && !body.serviceCategory)
      throw new CiaoError("VALIDATION", "service_category_required");

    const [dupe] = await db
      .select({ id: schema.listings.id })
      .from(schema.listings)
      .where(eq(schema.listings.slug, body.slug))
      .limit(1);
    if (dupe) throw new CiaoError("VALIDATION", "slug_taken");

    const phone = normalizePhone(body.hostPhone);
    let [host] = await db.select().from(schema.users).where(eq(schema.users.phone, phone)).limit(1);
    if (!host) {
      [host] = await db
        .insert(schema.users)
        .values({ phone, role: "host", displayName: body.hostName })
        .returning();
    } else if (host.role === "guest") {
      // Promote — a guest who lists a chalet is now a host. Never demote here.
      await db.update(schema.users).set({ role: "host" }).where(eq(schema.users.id, host.id));
    }

    const [venue] = await db
      .insert(schema.venues)
      .values({
        // Services live on a coast-typed venue row; the listing's
        // serviceCategory is what makes it a service (one venue model, §8.2).
        type: body.vertical === "hall" ? "hall" : "coast",
        nameAr: body.venueNameAr,
        city: body.city,
        area: body.area,
        hostId: host!.id,
        addressAr: body.addressAr,
        approxLat: body.approxLat,
        approxLng: body.approxLng,
        capacityWomens: body.capacityWomens,
      })
      .returning();

    const [listing] = await db
      .insert(schema.listings)
      .values({
        venueId: venue!.id,
        slug: body.slug,
        status: "draft",
        titleAr: body.titleAr,
        descriptionAr: body.descriptionAr,
        serviceCategory: body.vertical === "service" ? body.serviceCategory : null,
        bookingTypes: body.vertical === "hall" ? ["hall_event"] : ["stay"],
        baseNightly: body.baseNightly,
        maxGuests: body.maxGuests,
        bedrooms: body.bedrooms,
        familyOnly: body.familyOnly,
        cancellationTier: body.cancellationTier,
      })
      .returning();

    await db
      .insert(schema.reliabilityScores)
      .values({ hostId: host!.id })
      .onConflictDoNothing();

    await audit(claims.sub, "business.onboard", "listing", listing!.id, {
      slug: body.slug,
      vertical: body.vertical,
      hostPhone: phone,
    });

    return reply.status(201).send({
      hostId: host!.id,
      venueId: venue!.id,
      listingId: listing!.id,
      slug: listing!.slug,
      status: listing!.status,
      next: "أضف الصور ثم أرسل فريق المعاينة قبل النشر",
    });
  });

  /** Full business record for the detail screen. */
  app.get("/v1/biz/businesses/:listingId", async (req, reply) => {
    await opsGuard(req);
    const { listingId } = z.object({ listingId: z.string().uuid() }).parse(req.params);

    const [row] = await db
      .select({ listing: schema.listings, venue: schema.venues })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(eq(schema.listings.id, listingId))
      .limit(1);
    if (!row) throw new CiaoError("BOOKING_NOT_FOUND");

    const [host] = row.venue.hostId
      ? await db.select().from(schema.users).where(eq(schema.users.id, row.venue.hostId)).limit(1)
      : [];

    const bookings = await db
      .select({
        id: schema.bookings.id,
        code: schema.bookings.code,
        state: schema.bookings.state,
        total: schema.bookings.totalAmount,
        checkIn: schema.bookings.checkIn,
        createdAt: schema.bookings.createdAt,
      })
      .from(schema.bookings)
      .where(eq(schema.bookings.listingId, listingId))
      .orderBy(desc(schema.bookings.createdAt))
      .limit(25);

    const verifications = await db
      .select()
      .from(schema.verifications)
      .where(eq(schema.verifications.venueId, row.venue.id))
      .orderBy(desc(schema.verifications.createdAt))
      .limit(5);

    return reply.send({
      listing: row.listing,
      venue: row.venue,
      host: host
        ? { id: host.id, phone: host.phone, name: host.displayName, role: host.role }
        : null,
      bookings,
      verifications,
    });
  });

  /** Edit the commercial and descriptive fields of a listing. */
  app.patch("/v1/biz/listings/:id", async (req, reply) => {
    const claims = await opsGuard(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        titleAr: z.string().min(3).max(200).optional(),
        descriptionAr: z.string().max(3000).optional(),
        houseRulesAr: z.string().max(3000).optional(),
        baseNightly: z.number().int().min(0).optional(),
        dayUsePrice: z.number().int().min(0).nullable().optional(),
        maxGuests: z.number().int().min(1).optional(),
        bedrooms: z.number().int().min(0).optional(),
        familyOnly: z.boolean().optional(),
        cancellationTier: z.enum(["flexible", "moderate", "strict"]).optional(),
        status: z.enum(["draft", "live", "paused", "delisted"]).optional(),
      })
      .parse(req.body);

    const [before] = await db
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.id, id))
      .limit(1);
    if (!before) throw new CiaoError("BOOKING_NOT_FOUND");

    // §11.2 — an unverified venue must not reach the public marketplace.
    if (body.status === "live") {
      const [venue] = await db
        .select()
        .from(schema.venues)
        .where(eq(schema.venues.id, before.venueId))
        .limit(1);
      if (!venue?.verifiedAt || venue.badgeRevoked)
        throw new CiaoError("VALIDATION", "cannot_publish_unverified_venue");
      if ((before.media as unknown[]).length === 0)
        throw new CiaoError("VALIDATION", "cannot_publish_without_media");
    }

    await db
      .update(schema.listings)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.listings.id, id));

    const changed = Object.fromEntries(
      Object.entries(body).filter(
        ([k, v]) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify(v),
      ),
    );
    await audit(claims.sub, "listing.update", "listing", id, { changed });
    return reply.send({ ok: true, changed: Object.keys(changed) });
  });

  // ================================================================ 3. media
  /**
   * Image management for a listing: add, remove, reorder, set the cover.
   *
   * The first item in the array IS the cover — one ordering concept, no
   * separate `isCover` flag to fall out of sync. The whole array is replaced
   * on save, which makes reorder and delete the same operation and means the
   * console never has to reason about partial state.
   */
  app.get("/v1/biz/listings/:id/media", async (req, reply) => {
    await opsGuard(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [listing] = await db
      .select({ media: schema.listings.media, slug: schema.listings.slug })
      .from(schema.listings)
      .where(eq(schema.listings.id, id))
      .limit(1);
    if (!listing) throw new CiaoError("BOOKING_NOT_FOUND");
    return reply.send({ slug: listing.slug, media: listing.media });
  });

  app.put("/v1/biz/listings/:id/media", async (req, reply) => {
    const claims = await opsGuard(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ media: z.array(MEDIA_ITEM).max(24) }).parse(req.body);

    const [before] = await db
      .select({ media: schema.listings.media, status: schema.listings.status })
      .from(schema.listings)
      .where(eq(schema.listings.id, id))
      .limit(1);
    if (!before) throw new CiaoError("BOOKING_NOT_FOUND");

    // A live listing with no photos is worse than no listing (§8.3: what you
    // see is what exists). Pause it rather than publishing an empty card.
    if (before.status === "live" && body.media.length === 0)
      throw new CiaoError("VALIDATION", "live_listing_needs_media");

    const media = body.media.map((m, i) => ({ ...m, order: i }));
    await db
      .update(schema.listings)
      .set({ media, updatedAt: new Date() })
      .where(eq(schema.listings.id, id));

    await audit(claims.sub, "listing.media", "listing", id, {
      from: (before.media as unknown[]).length,
      to: media.length,
    });
    return reply.send({ ok: true, media });
  });

  /**
   * The image library: every media path already known to the platform, so an
   * operator adding a photo picks from what exists instead of typing a URL
   * from memory. (Direct upload lands with the CDN — launch gate 4.)
   */
  app.get("/v1/biz/media/library", async (req, reply) => {
    await opsGuard(req);
    const rows = await db
      .select({ slug: schema.listings.slug, media: schema.listings.media })
      .from(schema.listings);
    const settings = await getAllSettings();
    const hero = (settings["home.hero"] as { images: { src: string; alt: string }[] }).images;
    return reply.send({
      listings: rows.map((r) => ({
        slug: r.slug,
        urls: (r.media as { url: string }[]).map((m) => m.url),
      })),
      hero: hero.map((h) => h.src),
    });
  });

  // ============================================================== 4. finance
  /**
   * The money screen. Every figure is a sum of ledger postings, grouped the
   * way an accountant would ask for it, plus the balance check that proves
   * the books are square.
   */
  app.get("/v1/biz/finance", async (req, reply) => {
    await opsGuard(req);
    const { days } = z
      .object({ days: z.coerce.number().min(1).max(730).default(90) })
      .parse(req.query);
    const since = new Date(Date.now() - days * 86400_000);

    const byAccount = await db
      .select({
        account: schema.ledgerEntries.account,
        debit: sql<string>`sum(${schema.ledgerEntries.debit})`,
        credit: sql<string>`sum(${schema.ledgerEntries.credit})`,
        n: sql<string>`count(*)`,
      })
      .from(schema.ledgerEntries)
      .where(gte(schema.ledgerEntries.createdAt, since))
      .groupBy(schema.ledgerEntries.account);

    const accounts: Record<string, { debit: number; credit: number; net: number; n: number }> = {};
    for (const r of byAccount) {
      // guest_credit:<userId> is one account per guest — thousands of rows at
      // scale. Roll them into one line; the per-guest balance belongs on the
      // guest's own record, not on the company's trial balance.
      const key = r.account.startsWith("guest_credit:") ? "guest_credit" : r.account;
      const a = (accounts[key] ??= { debit: 0, credit: 0, net: 0, n: 0 });
      a.debit += Number(r.debit ?? 0);
      a.credit += Number(r.credit ?? 0);
      a.net = a.credit - a.debit;
      a.n += Number(r.n ?? 0);
    }

    // The invariant: debits equal credits, or the ledger is broken.
    const totalDebit = Object.values(accounts).reduce((s, a) => s + a.debit, 0);
    const totalCredit = Object.values(accounts).reduce((s, a) => s + a.credit, 0);

    // Monthly revenue trend from committed bookings (volume) + commission
    // (earned), so a founder can see take-rate drift, not just growth.
    const monthly = await db
      .select({
        month: sql<string>`to_char(${schema.bookings.createdAt}, 'YYYY-MM')`,
        bookings: sql<string>`count(*)`,
        gmv: sql<string>`coalesce(sum(${schema.bookings.totalAmount}),0)`,
        commission: sql<string>`coalesce(sum(${schema.bookings.commissionAmount}),0)`,
        deposits: sql<string>`coalesce(sum(${schema.bookings.depositAmount}),0)`,
      })
      .from(schema.bookings)
      .where(
        and(
          gte(schema.bookings.createdAt, since),
          inArray(schema.bookings.state, COMMITTED_STATES),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    // Where the money comes from, by vertical.
    const byVertical = await db
      .select({
        vertical: sql<string>`case when ${schema.listings.serviceCategory} is not null
                                   then 'service' else ${schema.venues.type} end`,
        bookings: sql<string>`count(*)`,
        gmv: sql<string>`coalesce(sum(${schema.bookings.totalAmount}),0)`,
        commission: sql<string>`coalesce(sum(${schema.bookings.commissionAmount}),0)`,
      })
      .from(schema.bookings)
      .innerJoin(schema.listings, eq(schema.bookings.listingId, schema.listings.id))
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(
        and(
          gte(schema.bookings.createdAt, since),
          inArray(schema.bookings.state, COMMITTED_STATES),
        ),
      )
      .groupBy(sql`1`);

    // Payouts owed vs released — the host-trust number.
    const payouts = await db
      .select({ status: schema.payouts.status, total: sql<string>`sum(${schema.payouts.amount})`, n: sql<string>`count(*)` })
      .from(schema.payouts)
      .groupBy(schema.payouts.status);

    const refunds = await db
      .select({ status: schema.refunds.status, total: sql<string>`sum(${schema.refunds.amount})`, n: sql<string>`count(*)` })
      .from(schema.refunds)
      .groupBy(schema.refunds.status);

    const gmv = monthly.reduce((s, m) => s + Number(m.gmv), 0);
    const commission = monthly.reduce((s, m) => s + Number(m.commission), 0);

    return reply.send({
      windowDays: days,
      headline: {
        gmv,
        commission,
        takeRateBps: gmv > 0 ? Math.round((commission / gmv) * 10000) : 0,
        depositsCollected: monthly.reduce((s, m) => s + Number(m.deposits), 0),
      },
      ledger: {
        accounts,
        totalDebit,
        totalCredit,
        balanced: totalDebit === totalCredit,
        drift: totalCredit - totalDebit,
      },
      monthly: monthly.map((m) => ({
        month: m.month,
        bookings: Number(m.bookings),
        gmv: Number(m.gmv),
        commission: Number(m.commission),
        deposits: Number(m.deposits),
        takeRateBps: Number(m.gmv) > 0 ? Math.round((Number(m.commission) / Number(m.gmv)) * 10000) : 0,
      })),
      byVertical: byVertical.map((v) => ({
        vertical: v.vertical,
        bookings: Number(v.bookings),
        gmv: Number(v.gmv),
        commission: Number(v.commission),
      })),
      payouts: payouts.map((p) => ({ status: p.status, total: Number(p.total ?? 0), n: Number(p.n) })),
      refunds: refunds.map((r) => ({ status: r.status, total: Number(r.total ?? 0), n: Number(r.n) })),
    });
  });

  /** Per-business earnings — who to keep, who to coach, who to drop. */
  app.get("/v1/biz/finance/by-business", async (req, reply) => {
    await opsGuard(req);
    const { days } = z
      .object({ days: z.coerce.number().min(1).max(730).default(90) })
      .parse(req.query);
    const since = new Date(Date.now() - days * 86400_000);

    const rows = await db
      .select({
        listingId: schema.listings.id,
        titleAr: schema.listings.titleAr,
        slug: schema.listings.slug,
        vertical: sql<string>`case when ${schema.listings.serviceCategory} is not null
                                   then 'service' else ${schema.venues.type} end`,
        hostName: schema.users.displayName,
        bookings: sql<string>`count(${schema.bookings.id})`,
        gmv: sql<string>`coalesce(sum(${schema.bookings.totalAmount}),0)`,
        commission: sql<string>`coalesce(sum(${schema.bookings.commissionAmount}),0)`,
      })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .leftJoin(schema.users, eq(schema.venues.hostId, schema.users.id))
      .leftJoin(
        schema.bookings,
        and(
          eq(schema.bookings.listingId, schema.listings.id),
          gte(schema.bookings.createdAt, since),
          inArray(schema.bookings.state, COMMITTED_STATES),
        ),
      )
      .groupBy(
        schema.listings.id,
        schema.listings.titleAr,
        schema.listings.slug,
        schema.listings.serviceCategory,
        schema.venues.type,
        schema.users.displayName,
      )
      .orderBy(desc(sql`coalesce(sum(${schema.bookings.totalAmount}),0)`))
      .limit(100);

    return reply.send({
      items: rows.map((r) => ({
        listingId: r.listingId,
        slug: r.slug,
        titleAr: r.titleAr,
        vertical: r.vertical,
        hostName: r.hostName,
        bookings: Number(r.bookings),
        gmv: Number(r.gmv),
        commission: Number(r.commission),
      })),
    });
  });

  // ================================================================ 5. people
  app.get("/v1/biz/users", async (req, reply) => {
    await opsGuard(req);
    const q = z
      .object({
        role: z.enum(["guest", "host", "agent", "ops", "admin", "all"]).default("all"),
        search: z.string().optional(),
        limit: z.coerce.number().min(1).max(200).default(50),
      })
      .parse(req.query);

    const conditions = [];
    if (q.role !== "all") conditions.push(eq(schema.users.role, q.role));
    if (q.search) conditions.push(sql`(${schema.users.phone} ilike ${`%${q.search}%`}
        or ${schema.users.displayName} ilike ${`%${q.search}%`})`);

    const rows = await db
      .select({
        user: schema.users,
        bookings: sql<string>`(select count(*) from bookings b where b.guest_id = ${schema.users.id})`,
        gmv: sql<string>`(select coalesce(sum(b.total_amount),0) from bookings b
          where b.guest_id = ${schema.users.id}
            and b.state = any(${sql.raw(COMMITTED_SQL)}))`,
      })
      .from(schema.users)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.users.createdAt))
      .limit(q.limit);

    const [total] = await db.select({ n: count() }).from(schema.users);

    return reply.send({
      total: total?.n ?? 0,
      items: rows.map((r) => ({
        id: r.user.id,
        phone: r.user.phone,
        displayName: r.user.displayName,
        publicName: r.user.publicName,
        role: r.user.role,
        createdAt: r.user.createdAt,
        bookings: Number(r.bookings),
        gmv: Number(r.gmv),
      })),
    });
  });

  /**
   * Role changes are admin-only and audited. Granting `ops` hands someone the
   * ability to move money; that decision needs a name attached to it forever.
   */
  app.patch("/v1/biz/users/:id/role", async (req, reply) => {
    const claims = await adminGuard(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { role } = z
      .object({ role: z.enum(["guest", "host", "agent", "ops", "admin"]) })
      .parse(req.body);

    const [before] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!before) throw new CiaoError("AUTH_FORBIDDEN");
    if (before.id === claims.sub && role !== "admin")
      throw new CiaoError("VALIDATION", "cannot_demote_yourself");

    await db.update(schema.users).set({ role }).where(eq(schema.users.id, id));
    await audit(claims.sub, "user.role", "user", id, { from: before.role, to: role });
    return reply.send({ ok: true, from: before.role, to: role });
  });

  // ============================================================== 6. settings
  app.get("/v1/biz/settings", async (req, reply) => {
    await opsGuard(req);
    const rows = await Promise.all(SETTING_KEYS.map((k) => settingRow(k)));
    return reply.send({ settings: rows });
  });

  /**
   * Writing settings is admin-only: these values change what guests are
   * charged. Validation runs per key and then across keys, because a deposit
   * below the commission is individually legal and jointly ruinous.
   */
  app.put("/v1/biz/settings", async (req, reply) => {
    const claims = await adminGuard(req);
    const body = z.object({ patch: z.record(z.string(), z.unknown()) }).parse(req.body);

    for (const [key, value] of Object.entries(body.patch)) {
      if (!(SETTING_KEYS as string[]).includes(key))
        throw new CiaoError("VALIDATION", `unknown_setting:${key}`);
      const err = validateSetting(key, value);
      if (err) throw new CiaoError("VALIDATION", err);
    }
    const coherence = await validateCoherence(body.patch);
    if (coherence) throw new CiaoError("VALIDATION", coherence);

    const changed = await setSettings(body.patch, claims.sub);
    return reply.send({ ok: true, changed });
  });

  app.post("/v1/biz/settings/reset", async (req, reply) => {
    const claims = await adminGuard(req);
    const { keys } = z.object({ keys: z.array(z.string()).min(1) }).parse(req.body);
    return reply.send({ ok: true, reset: await resetSettings(keys, claims.sub) });
  });

  // ═══════════════════════════════════════ 6b. loyalty economy management
  /**
   * The programme at a glance: what it currently promises, what it has cost,
   * and what it still owes. An operator changing earn rates should see the
   * outstanding liability on the same screen — points are a promise, and a
   * promise you cannot size is a risk.
   */
  app.get("/v1/biz/loyalty", async (req, reply) => {
    await opsGuard(req);

    const [outstanding] = await db
      .select({ total: sql<string>`coalesce(sum(${schema.loyaltyLedger.delta}), 0)` })
      .from(schema.loyaltyLedger);

    const byReason = await db
      .select({
        reason: schema.loyaltyLedger.reason,
        total: sql<string>`sum(${schema.loyaltyLedger.delta})`,
        n: sql<string>`count(*)`,
      })
      .from(schema.loyaltyLedger)
      .groupBy(schema.loyaltyLedger.reason);

    const [lapsing] = await db
      .select({ total: sql<string>`coalesce(sum(${schema.loyaltyLedger.delta}), 0)` })
      .from(schema.loyaltyLedger)
      .where(
        and(
          sql`${schema.loyaltyLedger.delta} > 0`,
          isNull(schema.loyaltyLedger.expiredAt),
          sql`${schema.loyaltyLedger.expiresAt} < now() + interval '30 days'`,
        ),
      );

    const [members] = await db
      .select({ n: sql<string>`count(*)` })
      .from(schema.users)
      .where(sql`${schema.users.pointsBalance} > 0`);

    const settings = await getAllSettings();
    const pointToDirham = Number(settings["loyalty.pointToDirham"]);

    return reply.send({
      config: {
        enabled: settings["loyalty.enabled"],
        earnRules: settings["loyalty.earnRules"],
        pointToDirham,
        minRedeem: settings["loyalty.minRedeem"],
        expiryMonths: settings["loyalty.expiryMonths"],
        partnersEnabled: settings["loyalty.partnersEnabled"],
        voucherMinutes: settings["loyalty.voucherMinutes"],
      },
      liability: {
        outstandingPoints: Number(outstanding?.total ?? 0),
        // What those points would cost us if every member redeemed tomorrow.
        outstandingDirhams: Number(outstanding?.total ?? 0) * pointToDirham,
        membersHoldingPoints: Number(members?.n ?? 0),
        lapsingWithin30Days: Number(lapsing?.total ?? 0),
      },
      byReason: byReason.map((r) => ({
        reason: r.reason,
        points: Number(r.total ?? 0),
        entries: Number(r.n ?? 0),
      })),
    });
  });

  // ---------------- partners
  app.get("/v1/biz/partners", async (req, reply) => {
    await opsGuard(req);
    const rows = await db
      .select({
        partner: schema.partners,
        venueNameAr: schema.venues.nameAr,
        staffPhone: schema.users.phone,
        issued: sql<string>`(select count(*) from partner_redemptions r where r.partner_id = ${schema.partners.id})`,
        redeemed: sql<string>`(select count(*) from partner_redemptions r
          where r.partner_id = ${schema.partners.id} and r.status = 'redeemed')`,
        owed: sql<string>`(select coalesce(sum(r.value),0) from partner_redemptions r
          where r.partner_id = ${schema.partners.id} and r.status = 'redeemed' and r.settled_at is null)`,
      })
      .from(schema.partners)
      .leftJoin(schema.venues, eq(schema.partners.venueId, schema.venues.id))
      .leftJoin(schema.users, eq(schema.partners.staffUserId, schema.users.id))
      .orderBy(desc(schema.partners.createdAt));

    return reply.send({
      items: rows.map((r) => ({
        ...r.partner,
        venueNameAr: r.venueNameAr,
        staffPhone: r.staffPhone,
        issued: Number(r.issued ?? 0),
        redeemed: Number(r.redeemed ?? 0),
        owed: Number(r.owed ?? 0),
      })),
    });
  });

  app.post("/v1/biz/partners", async (req, reply) => {
    const claims = await opsGuard(req);
    const body = z
      .object({
        nameAr: z.string().min(2).max(120),
        category: z.enum(["cafe", "restaurant", "bakery", "spa", "activity", "shop"]),
        venueId: z.string().uuid().nullable().optional(),
        city: z.string().max(40).optional(),
        area: z.string().max(60).optional(),
        contactPhone: z.string().max(20).optional(),
        /** Phone of whoever will redeem at the till. */
        staffPhone: z.string().min(9).max(20).optional(),
        descriptionAr: z.string().max(1000).optional(),
        minValue: z.number().int().min(1000).default(5000),
        maxValue: z.number().int().min(1000).default(100000),
      })
      .parse(req.body);

    if (body.maxValue < body.minValue) throw new CiaoError("VALIDATION", "max_below_min");

    // The till account is a normal user, created if new — the cafe manager
    // signs in with the phone they already use.
    let staffUserId: string | null = null;
    if (body.staffPhone) {
      const phone = normalizePhone(body.staffPhone);
      const [existing] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.phone, phone))
        .limit(1);
      staffUserId =
        existing?.id ??
        (
          await db
            .insert(schema.users)
            .values({ phone, role: "guest", displayName: body.nameAr })
            .returning()
        )[0]!.id;
    }

    const { staffPhone: _staffPhone, ...rest } = body;
    const [partner] = await db
      .insert(schema.partners)
      .values({ ...rest, venueId: rest.venueId ?? null, staffUserId })
      .returning();
    await audit(claims.sub, "partner.create", "partner", partner!.id, { nameAr: body.nameAr });
    return reply.status(201).send({ id: partner!.id });
  });

  app.patch("/v1/biz/partners/:id", async (req, reply) => {
    const claims = await opsGuard(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        active: z.boolean().optional(),
        minValue: z.number().int().min(1000).optional(),
        maxValue: z.number().int().min(1000).optional(),
        descriptionAr: z.string().max(1000).optional(),
        contactPhone: z.string().max(20).optional(),
      })
      .parse(req.body);
    await db.update(schema.partners).set(body).where(eq(schema.partners.id, id));
    await audit(claims.sub, "partner.update", "partner", id, body);
    return reply.send({ ok: true });
  });

  /** Mark what we owe a partner as paid. Admin-only: it is money leaving. */
  app.post("/v1/biz/partners/:id/settle", async (req, reply) => {
    const claims = await adminGuard(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await db
      .update(schema.partnerRedemptions)
      .set({ settledAt: new Date() })
      .where(
        and(
          eq(schema.partnerRedemptions.partnerId, id),
          eq(schema.partnerRedemptions.status, "redeemed"),
          isNull(schema.partnerRedemptions.settledAt),
        ),
      )
      .returning({ value: schema.partnerRedemptions.value });
    const total = rows.reduce((s, r) => s + r.value, 0);
    if (total > 0) {
      const ledgerMod = await import("../payments/ledger.js");
      await ledgerMod.post(db, null, [
        { account: `partner_payable:${id}`, debit: total, memo: "partner settlement" },
        { account: "rail_settlement_pending:payout", credit: total, memo: "partner settlement" },
      ]);
    }
    await audit(claims.sub, "partner.settle", "partner", id, { total, vouchers: rows.length });
    return reply.send({ ok: true, settled: rows.length, total });
  });

  // ---------------- promo codes
  app.get("/v1/biz/promos", async (req, reply) => {
    await opsGuard(req);
    const rows = await db
      .select({
        promo: schema.promoCodes,
        discountGiven: sql<string>`(select coalesce(sum(pr.discount),0) from promo_redemptions pr
          where pr.promo_id = ${schema.promoCodes.id})`,
      })
      .from(schema.promoCodes)
      .orderBy(desc(schema.promoCodes.createdAt))
      .limit(200);
    return reply.send({
      items: rows.map((r) => ({ ...r.promo, discountGiven: Number(r.discountGiven ?? 0) })),
    });
  });

  /**
   * Creating a promo is admin-only: it spends margin, which is the same class
   * of decision as changing the commission rate.
   */
  app.post("/v1/biz/promos", async (req, reply) => {
    const claims = await adminGuard(req);
    const body = z
      .object({
        code: z.string().min(3).max(24).regex(/^[A-Za-z0-9_-]+$/),
        kind: z.enum(["percent", "fixed", "points"]),
        value: z.number().int().min(1),
        descriptionAr: z.string().max(200).optional(),
        vertical: z.enum(["coast", "hall", "service"]).nullable().optional(),
        city: z.string().max(40).nullable().optional(),
        minSpend: z.number().int().min(0).default(0),
        maxDiscount: z.number().int().min(0).nullable().optional(),
        startsAt: z.string().datetime().nullable().optional(),
        endsAt: z.string().datetime().nullable().optional(),
        maxRedemptions: z.number().int().min(1).nullable().optional(),
        perUserLimit: z.number().int().min(1).max(50).default(1),
      })
      .parse(req.body);

    if (body.kind === "percent" && body.value > 10000)
      throw new CiaoError("VALIDATION", "percent_above_100");

    const code = body.code.trim().toUpperCase();
    const [dupe] = await db
      .select({ id: schema.promoCodes.id })
      .from(schema.promoCodes)
      .where(eq(schema.promoCodes.code, code))
      .limit(1);
    if (dupe) throw new CiaoError("VALIDATION", "code_exists");

    const [promo] = await db
      .insert(schema.promoCodes)
      .values({
        ...body,
        code,
        vertical: body.vertical ?? null,
        city: body.city ?? null,
        maxDiscount: body.maxDiscount ?? null,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        maxRedemptions: body.maxRedemptions ?? null,
        createdById: claims.sub,
      })
      .returning();
    await audit(claims.sub, "promo.create", "promo", promo!.id, { code, kind: body.kind });
    return reply.status(201).send({ id: promo!.id, code });
  });

  app.patch("/v1/biz/promos/:id", async (req, reply) => {
    const claims = await adminGuard(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        active: z.boolean().optional(),
        endsAt: z.string().datetime().nullable().optional(),
        maxRedemptions: z.number().int().min(1).nullable().optional(),
      })
      .parse(req.body);
    await db
      .update(schema.promoCodes)
      .set({
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.endsAt !== undefined ? { endsAt: body.endsAt ? new Date(body.endsAt) : null } : {}),
        ...(body.maxRedemptions !== undefined ? { maxRedemptions: body.maxRedemptions } : {}),
      })
      .where(eq(schema.promoCodes.id, id));
    await audit(claims.sub, "promo.update", "promo", id, body);
    return reply.send({ ok: true });
  });

  // ================================================================ 7. audit
  app.get("/v1/biz/audit", async (req, reply) => {
    await opsGuard(req);
    const q = z
      .object({
        action: z.string().optional(),
        targetId: z.string().optional(),
        limit: z.coerce.number().min(1).max(200).default(60),
      })
      .parse(req.query);

    const conditions = [];
    if (q.action) conditions.push(sql`${schema.auditLog.action} like ${`${q.action}%`}`);
    if (q.targetId) conditions.push(eq(schema.auditLog.targetId, q.targetId));

    const rows = await db
      .select({
        log: schema.auditLog,
        actor: { phone: schema.users.phone, displayName: schema.users.displayName },
      })
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.auditLog.actorId, schema.users.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(q.limit);

    return reply.send({
      items: rows.map((r) => ({
        id: r.log.id,
        action: r.log.action,
        targetType: r.log.targetType,
        targetId: r.log.targetId,
        detail: r.log.detail,
        at: r.log.createdAt,
        actor: r.actor?.displayName ?? r.actor?.phone ?? "—",
      })),
    });
  });
}
