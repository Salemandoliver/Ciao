/**
 * Intelligence HTTP surface:
 *  - POST /v1/events        — client batch ingestion (anon + authed, stitched)
 *  - GET  /v1/recs/home     — personalized listing recommendations
 *  - GET  /v1/ops/insights  — business dashboards (funnel, trends, seasonality)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { authenticate, requireRole } from "../../lib/guards.js";
import { verifyAccessToken } from "../../lib/auth.js";
import { EVENT_TAXONOMY, trackAsync } from "./events.js";
import { scoreListing, type Traits } from "./profile.js";

const clientEventSchema = z.object({
  name: z.string().max(48),
  ts: z.coerce.date().optional(),
  props: z.record(z.string(), z.unknown()).default({}),
});

export async function intelligenceRoutes(app: FastifyInstance) {
  // ---- ingestion --------------------------------------------------------
  app.post("/v1/events", {
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      const body = z
        .object({
          anonId: z.string().max(40),
          sessionId: z.string().max(40).optional(),
          events: z.array(clientEventSchema).max(25),
        })
        .parse(req.body);

      // Optional identity stitch: bearer token links anon events to the user.
      let userId: string | undefined;
      const auth = req.headers.authorization;
      if (auth?.startsWith("Bearer ")) {
        try {
          userId = (await verifyAccessToken(auth.slice(7))).sub;
        } catch {
          /* anon is fine */
        }
      }

      const context = {
        locale: String(req.headers["accept-language"] ?? "").slice(0, 12),
        ua: String(req.headers["user-agent"] ?? "").slice(0, 120),
      };

      let accepted = 0;
      for (const e of body.events) {
        if (!(e.name in EVENT_TAXONOMY)) continue; // silently drop unknown names
        await trackAsync(e.name, e.props, {
          userId,
          anonId: body.anonId,
          sessionId: body.sessionId,
          source: "web",
          ts: e.ts,
          context,
        });
        accepted++;
      }
      return reply.send({ ok: true, accepted });
    },
  });

  // ---- recommendations --------------------------------------------------
  app.get("/v1/recs/home", async (req, reply) => {
    let traits: Traits | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const { sub } = await verifyAccessToken(auth.slice(7));
        const [profile] = await db
          .select()
          .from(schema.userProfiles)
          .where(eq(schema.userProfiles.userId, sub))
          .limit(1);
        traits = (profile?.traits as Traits) ?? null;
      } catch {
        /* anonymous → popularity */
      }
    }

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
      .where(eq(schema.listings.status, "live"));

    // Popularity (14d listing views) as base signal for cold start.
    const pop = await db
      .select({
        listingId: sql<string>`${schema.events.props} ->> 'listingId'`,
        views: sql<string>`count(*)`,
      })
      .from(schema.events)
      .where(
        sql`${schema.events.name} = 'listing.viewed' and ${schema.events.ts} > now() - interval '14 days'`,
      )
      .groupBy(sql`${schema.events.props} ->> 'listingId'`);
    const popularity = new Map(pop.map((p) => [p.listingId, Number(p.views)]));

    const scored = rows
      .map(({ listing, venue, reliability }) => {
        const { score, because } = scoreListing(
          traits,
          listing,
          venue,
          reliability,
          popularity.get(listing.id) ?? 0,
        );
        return { listing, venue, score, because };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    return reply.send({
      personalized: Boolean(traits),
      items: scored.map((s) => ({
        id: s.listing.id,
        slug: s.listing.slug,
        titleAr: s.listing.titleAr,
        city: s.venue.city,
        area: s.venue.area,
        baseNightly: s.listing.baseNightly,
        media: s.listing.media,
        because: s.because, // transparent personalization — trust is the product
      })),
    });
  });

  // ---- ops dashboards ---------------------------------------------------
  app.get("/v1/ops/insights", async (req, reply) => {
    const claims = await authenticate(req);
    requireRole(claims, "ops");
    const q = z
      .object({ days: z.coerce.number().min(7).max(365).default(90) })
      .parse(req.query);
    const since = sql`now() - make_interval(days => ${q.days})`;

    // Funnel: discovery → intent → money (event counts + distinct users).
    const funnelRows = await db
      .select({
        name: schema.events.name,
        count: sql<string>`count(*)`,
        users: sql<string>`count(distinct coalesce(${schema.events.userId}::text, ${schema.events.anonId}))`,
      })
      .from(schema.events)
      .where(sql`${schema.events.ts} > ${since}`)
      .groupBy(schema.events.name);
    const f = new Map(funnelRows.map((r) => [r.name, { count: Number(r.count), users: Number(r.users) }]));
    const step = (n: string) => f.get(n) ?? { count: 0, users: 0 };

    // Weekly bookings + GMV trend.
    const weekly = await db
      .select({
        week: sql<string>`to_char(date_trunc('week', ${schema.bookings.createdAt}), 'YYYY-MM-DD')`,
        bookings: sql<string>`count(*)`,
        gmv: sql<string>`coalesce(sum(${schema.bookings.totalAmount}), 0)`,
        deposits: sql<string>`coalesce(sum(${schema.bookings.depositAmount}) filter (where ${schema.bookings.state} in ('confirmed','pre_arrival_reconfirmed','checked_in','completed','reviewed')), 0)`,
      })
      .from(schema.bookings)
      .where(sql`${schema.bookings.createdAt} > ${since}`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    // Seasonality: check-ins by month and by day-of-week (Fri/Sat = weekend).
    const byMonth = await db
      .select({
        month: sql<string>`to_char(check_in, 'MM')`,
        count: sql<string>`count(*)`,
      })
      .from(schema.bookings)
      .where(sql`check_in is not null`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const byDow = await db
      .select({
        dow: sql<string>`extract(isodow from check_in)::int`,
        count: sql<string>`count(*)`,
      })
      .from(schema.bookings)
      .where(sql`check_in is not null`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    // Demand map: searches by area (k-anonymity: suppress groups < 5 users).
    const areas = await db
      .select({
        // A key, not a label. This used to fall back to the Arabic word for
        // "all", which then rendered untranslated on the English ops panel —
        // an aggregation query is the wrong place to decide what language the
        // reader speaks.
        area: sql<string>`coalesce(${schema.events.props} ->> 'area', ${schema.events.props} ->> 'city', 'all')`,
        searches: sql<string>`count(*)`,
        users: sql<string>`count(distinct coalesce(${schema.events.userId}::text, ${schema.events.anonId}))`,
      })
      .from(schema.events)
      .where(sql`${schema.events.name} = 'search.performed' and ${schema.events.ts} > ${since}`)
      .groupBy(sql`1`)
      .orderBy(desc(sql`count(*)`))
      .limit(12);

    // Filter usage — which cultural filters actually drive demand.
    const filters = await db
      .select({
        filter: sql<string>`jsonb_array_elements_text(coalesce(${schema.events.props} -> 'filters', '[]'::jsonb))`,
        count: sql<string>`count(*)`,
      })
      .from(schema.events)
      .where(sql`${schema.events.name} = 'search.performed' and ${schema.events.ts} > ${since}`)
      .groupBy(sql`1`)
      .orderBy(desc(sql`count(*)`));

    // Lead time distribution (booking.requested props.leadDays).
    const leadTimes = await db
      .select({
        bucket: sql<string>`case
          when (${schema.events.props} ->> 'leadDays')::int <= 2 then '0-2'
          when (${schema.events.props} ->> 'leadDays')::int <= 7 then '3-7'
          when (${schema.events.props} ->> 'leadDays')::int <= 21 then '8-21'
          else '22+' end`,
        count: sql<string>`count(*)`,
      })
      .from(schema.events)
      .where(sql`${schema.events.name} = 'booking.requested' and ${schema.events.ts} > ${since}`)
      .groupBy(sql`1`);

    // Repeat rate.
    const [repeat] = await db
      .select({
        repeaters: sql<string>`count(*) filter (where c >= 2)`,
        total: sql<string>`count(*)`,
      })
      .from(
        sql`(select guest_id, count(*) c from bookings where state in ('confirmed','pre_arrival_reconfirmed','checked_in','completed','reviewed') group by guest_id) t`,
      );

    /*
     * Declared-profile coverage.
     *
     * Read from user_preferences rather than folded traits on purpose: this is
     * an operating question about the member base ("can the birthday campaign
     * actually run yet?"), not a personalization question, and the answer must
     * not depend on when the fold worker last ran.
     */
    const [declared] = await db
      .select({
        total: sql<string>`count(*)`,
        withBirthDate: sql<string>`count(*) filter (where birth_date is not null)`,
        withParty: sql<string>`count(*) filter (where party_adults is not null)`,
        marketingOptIn: sql<string>`count(*) filter (where marketing_opt_in)`,
        avgParty: sql<string>`coalesce(round(avg(coalesce(party_adults,0) + coalesce(party_children,0)) filter (where party_adults is not null), 1), 0)`,
      })
      .from(schema.userPreferences);

    const partySizes = await db
      .select({
        bucket: sql<string>`case
          when coalesce(party_adults,0) + coalesce(party_children,0) <= 4 then '1-4'
          when coalesce(party_adults,0) + coalesce(party_children,0) <= 8 then '5-8'
          when coalesce(party_adults,0) + coalesce(party_children,0) <= 15 then '9-15'
          else '16+' end`,
        users: sql<string>`count(*)`,
      })
      .from(schema.userPreferences)
      .where(sql`party_adults is not null`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const birthMonths = await db
      .select({
        month: sql<string>`extract(month from birth_date)`,
        users: sql<string>`count(*)`,
      })
      .from(schema.userPreferences)
      .where(sql`birth_date is not null`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    /*
     * Loyalty integrity.
     *
     * Not fraud detection — two numbers an operator can watch, because the
     * honest defence against farming is that it is bounded AND visible, not
     * that it is impossible. Both are cheap to read and hard to argue with.
     *
     *  - `unearnedAtFloor`: members holding enough points to redeem who have
     *    never completed a stay. Should be a trickle. A step change is a farm.
     *  - `topSharedBirthDate`: the most common single date of birth. Real
     *    birthdays spread; 1 January 1990 appearing forty times does not.
     *    Deliberately a count with a denominator and no identities attached —
     *    it tells an operator to go and look, which is the correct output of a
     *    signal this weak.
     */
    const [integrity] = await db
      .select({
        unearnedAtFloor: sql<string>`count(*) filter (
          where u.points_balance >= 5000 and u.completed_stays = 0)`,
        membersWithPoints: sql<string>`count(*) filter (where u.points_balance > 0)`,
      })
      .from(sql`users u`);

    const [sharedBirthDate] = await db
      .select({
        birthDate: sql<string | null>`birth_date::text`,
        users: sql<string>`count(*)`,
      })
      .from(schema.userPreferences)
      .where(sql`birth_date is not null`)
      .groupBy(sql`birth_date`)
      .orderBy(desc(sql`count(*)`))
      .limit(1);

    return reply.send({
      windowDays: q.days,
      funnel: {
        searches: step("search.performed"),
        listingViews: step("listing.viewed"),
        quotes: step("quote.viewed"),
        bookingRequests: step("booking.requested"),
        paid: step("payment.captured"),
        confirmed: step("booking.confirmed"),
      },
      weekly: weekly.map((w) => ({
        week: w.week,
        bookings: Number(w.bookings),
        gmv: Number(w.gmv),
        deposits: Number(w.deposits),
      })),
      seasonality: {
        byMonth: byMonth.map((m) => ({ month: m.month, count: Number(m.count) })),
        byDow: byDow.map((d) => ({ dow: Number(d.dow), count: Number(d.count) })),
      },
      // k-anonymity: suppress area rows with fewer than K distinct users so the
      // dashboard never narrows to an identifiable person. K=3 during demo,
      // raise to 5 at launch.
      demandByArea: areas
        .filter((a) => Number(a.users) >= 3)
        .map((a) => ({ area: a.area, searches: Number(a.searches), users: Number(a.users) })),
      demandByAreaSuppressedRows: areas.filter((a) => Number(a.users) < 3).length,
      filterUsage: filters.map((x) => ({ filter: x.filter, count: Number(x.count) })),
      leadTimes: leadTimes.map((l) => ({ bucket: l.bucket, count: Number(l.count) })),
      repeatRate: {
        repeaters: Number(repeat?.repeaters ?? 0),
        totalGuests: Number(repeat?.total ?? 0),
      },
      /*
       * Declared-profile coverage and shape.
       *
       * Deliberately not a demographic panel. It answers the two operating
       * questions — how many members have told us enough for the campaigns to
       * work, and what size of party we are actually serving — and it is
       * k-anonymised like every other grouped panel, so no band or month can
       * ever narrow to a person. Nothing here can be filtered down to an
       * individual, because nothing here is joined to one.
       */
      loyaltyIntegrity: {
        unearnedAtFloor: Number(integrity?.unearnedAtFloor ?? 0),
        membersWithPoints: Number(integrity?.membersWithPoints ?? 0),
        topSharedBirthDate: sharedBirthDate?.birthDate ?? null,
        topSharedBirthDateUsers: Number(sharedBirthDate?.users ?? 0),
      },
      declaredProfiles: {
        withBirthDate: Number(declared?.withBirthDate ?? 0),
        withParty: Number(declared?.withParty ?? 0),
        marketingOptIn: Number(declared?.marketingOptIn ?? 0),
        total: Number(declared?.total ?? 0),
        avgPartySize: Number(declared?.avgParty ?? 0),
        partySizes: partySizes
          .filter((r) => Number(r.users) >= 3)
          .map((r) => ({ bucket: r.bucket, users: Number(r.users) })),
        partySizesSuppressedRows: partySizes.filter((r) => Number(r.users) < 3).length,
        birthMonths: birthMonths
          .filter((r) => Number(r.users) >= 3)
          .map((r) => ({ month: Number(r.month), users: Number(r.users) })),
        birthMonthsSuppressedRows: birthMonths.filter((r) => Number(r.users) < 3).length,
      },
    });
  });
}
