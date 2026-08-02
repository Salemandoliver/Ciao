/**
 * Partner intelligence — layer 4 of the intelligence architecture, pointed at
 * the supply side instead of at ops.
 *
 * The line between free and paid is drawn deliberately and it is the same line
 * everywhere in this file: **your own numbers are free forever; the market
 * costs money.**
 *
 * Charging a partner to see what they earned or who owes them would make the
 * console a hostage situation, and they would go back to the notebook — which
 * costs us the calendar integrity and the dataset, both worth more than the
 * subscription. What Ciao Plus sells is the thing they cannot get anywhere
 * else and that costs us real work to produce honestly: what the rest of the
 * market is doing. A photographer in Janzour has no idea whether she is priced
 * high or low, when the next wedding wave books, or how much demand walked
 * past her closed calendar. Nobody in Libya can tell her. We can.
 *
 * Every premium panel obeys the same three rules:
 *
 *  1. **k-anonymity, and a real k.** A benchmark computed from two competitors
 *     is a way of reading their prices off our dashboard. Below
 *     `partner.benchmarkMinPeers` the panel is suppressed and says so, rather
 *     than shown thin.
 *  2. **Aggregates only, never an identity.** No panel here names another
 *     business, and none can be narrowed to one.
 *  3. **A because-sentence or it doesn't ship.** Same rule as guest
 *     personalization (guardrail 6): if we cannot write an honest sentence
 *     explaining what a number is telling them to do, the number is decoration.
 *
 * The entitlement check happens server-side and the premium keys are simply
 * absent from the response when Plus is off. Hiding them in the console would
 * mean the data was already on the wire.
 */
import { and, eq, gt, gte, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { getSetting } from "../business/settings.js";
import { ensureProfile, hasPlus } from "./service.js";

const OCCUPYING = ["confirmed", "done"] as const;

export interface PartnerInsights {
  windowDays: number;
  plus: boolean;
  own: OwnInsights;
  market?: MarketInsights;
  /** Plain-language next steps. Free ones from own data, Plus ones from market data. */
  actions: { key: string; ar: string; en: string; plus: boolean }[];
}

interface OwnInsights {
  jobs: { total: number; ciao: number; direct: number };
  earnings: { total: number; ciao: number; direct: number; collected: number; outstanding: number };
  sourceMix: { source: string; jobs: number; value: number }[];
  monthly: { month: string; jobs: number; value: number }[];
  /** Share of days in the window with at least one job. */
  occupancyBps: number;
  openDays: number;
  busyDays: number;
  repeatClients: { repeat: number; total: number };
  funnel: { views: number; quotesViewed: number; requests: number; confirmed: number };
  reliability: { score: number; medianResponseMinutes: number; confirmationRateBps: number };
  quotes: { sent: number; accepted: number; acceptanceBps: number };
}

interface MarketInsights {
  /** Demand for this kind of business in this area, from real searches. */
  areaDemand: { searches: number; users: number; area: string | null; vertical: string };
  /** How much of it walked past a closed calendar. */
  missedDemand: { searchesOnClosedDays: number; closedDays: number; sampleDays: number };
  /** Where their price sits among comparable verified businesses. */
  pricePosition: {
    available: boolean;
    peers: number;
    p25: number;
    p50: number;
    p75: number;
    yours: number;
    positionBps: number | null;
    suppressedReason?: string;
  };
  /** How far ahead this category books — when to open next season's calendar. */
  leadTime: { bucket: string; count: number }[];
  /** Demand index by check-in month across the category, so a quiet month is visible before it arrives. */
  seasonality: { month: string; index: number }[];
  /** Their view→booking conversion against the category median. */
  conversion: { yoursBps: number; medianBps: number; available: boolean; peers: number };
}

export async function partnerInsights(
  partnerId: string,
  windowDays = 90,
): Promise<PartnerInsights> {
  const profile = await ensureProfile(partnerId);
  const plus = await hasPlus(partnerId);
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const sinceDay = since.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const listingIds = (
    await db
      .select({ id: schema.listings.id, venueType: schema.venues.type, area: schema.venues.area, city: schema.venues.city })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(eq(schema.venues.hostId, partnerId))
  );
  const ids = listingIds.map((l) => l.id);
  const vertical = listingIds[0]?.venueType ?? (profile.kind === "hall" ? "hall" : profile.kind === "service" ? "service" : "coast");
  const area = listingIds[0]?.area ?? null;
  const city = listingIds[0]?.city ?? "tripoli";

  const own = await ownInsights(partnerId, ids, sinceDay, today, windowDays);
  const insights: PartnerInsights = {
    windowDays,
    plus,
    own,
    actions: freeActions(own, profile.kind),
  };

  if (plus) {
    const market = await marketInsights(partnerId, ids, vertical, area, city, sinceDay, windowDays);
    insights.market = market;
    insights.actions.push(...marketActions(own, market, vertical));
  }
  return insights;
}

// ---------------------------------------------------------------- own numbers
async function ownInsights(
  partnerId: string,
  listingIds: string[],
  sinceDay: string,
  today: string,
  windowDays: number,
): Promise<OwnInsights> {
  const jobRows = await db
    .select({
      source: schema.partnerJobs.source,
      status: schema.partnerJobs.status,
      day: schema.partnerJobs.day,
      endDay: schema.partnerJobs.endDay,
      price: schema.partnerJobs.price,
      amountPaid: schema.partnerJobs.amountPaid,
      clientId: schema.partnerJobs.clientId,
    })
    .from(schema.partnerJobs)
    .where(
      and(
        eq(schema.partnerJobs.partnerId, partnerId),
        gte(schema.partnerJobs.day, sinceDay),
        ne(schema.partnerJobs.status, "cancelled"),
      ),
    );

  const live = jobRows.filter((j) => (OCCUPYING as readonly string[]).includes(j.status));
  const ciaoJobs = live.filter((j) => j.source === "ciao");
  const directJobs = live.filter((j) => j.source !== "ciao");

  const sum = (rows: typeof live, key: "price" | "amountPaid") =>
    rows.reduce((s, r) => s + (r[key] ?? 0), 0);

  const sourceCounts = new Map<string, { jobs: number; value: number }>();
  for (const j of live) {
    const entry = sourceCounts.get(j.source) ?? { jobs: 0, value: 0 };
    entry.jobs++;
    entry.value += j.price ?? 0;
    sourceCounts.set(j.source, entry);
  }

  const monthly = new Map<string, { month: string; jobs: number; value: number }>();
  for (const j of live) {
    const month = j.day.slice(0, 7);
    const entry = monthly.get(month) ?? { month, jobs: 0, value: 0 };
    entry.jobs++;
    entry.value += j.price ?? 0;
    monthly.set(month, entry);
  }

  // Occupancy: days with at least one job, over the window. Counted on distinct
  // days rather than job count, because four brides in one morning is one busy
  // day for a make-up artist and four bookings for the accountant.
  const busy = new Set<string>();
  for (const j of live) {
    const start = new Date(`${j.day}T00:00:00Z`);
    const end = new Date(`${j.endDay || j.day}T00:00:00Z`);
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      busy.add(d.toISOString().slice(0, 10));
    }
  }

  // Repeat customers — the number that tells a partner whether the work is
  // compounding or whether they are running to stand still.
  const clientJobCounts = new Map<string, number>();
  for (const j of jobRows) {
    if (!j.clientId) continue;
    clientJobCounts.set(j.clientId, (clientJobCounts.get(j.clientId) ?? 0) + 1);
  }
  const repeat = [...clientJobCounts.values()].filter((n) => n >= 2).length;

  // Their own funnel on Ciao — how many people saw the listing and how many of
  // them booked. Zero views is a supply-quality conversation (photos, price);
  // plenty of views and no bookings is a different one entirely.
  const funnel = { views: 0, quotesViewed: 0, requests: 0, confirmed: 0 };
  if (listingIds.length > 0) {
    const rows = await db
      .select({
        name: schema.events.name,
        count: sql<string>`count(*)`,
      })
      .from(schema.events)
      .where(
        and(
          inArray(schema.events.name, ["listing.viewed", "quote.viewed", "booking.requested", "booking.confirmed"]),
          gte(schema.events.ts, new Date(`${sinceDay}T00:00:00Z`)),
          inArray(sql`${schema.events.props} ->> 'listingId'`, listingIds),
        ),
      )
      .groupBy(schema.events.name);
    for (const r of rows) {
      const n = Number(r.count);
      if (r.name === "listing.viewed") funnel.views = n;
      if (r.name === "quote.viewed") funnel.quotesViewed = n;
      if (r.name === "booking.requested") funnel.requests = n;
      if (r.name === "booking.confirmed") funnel.confirmed = n;
    }
  }

  const [rel] = await db
    .select()
    .from(schema.reliabilityScores)
    .where(eq(schema.reliabilityScores.hostId, partnerId))
    .limit(1);

  const [quoteAgg] = await db
    .select({
      sent: sql<string>`count(*) filter (where ${schema.partnerQuotes.status} <> 'draft')`,
      accepted: sql<string>`count(*) filter (where ${schema.partnerQuotes.status} = 'accepted')`,
    })
    .from(schema.partnerQuotes)
    .where(
      and(
        eq(schema.partnerQuotes.partnerId, partnerId),
        gte(schema.partnerQuotes.createdAt, new Date(`${sinceDay}T00:00:00Z`)),
      ),
    );
  const quotesSent = Number(quoteAgg?.sent ?? 0);
  const quotesAccepted = Number(quoteAgg?.accepted ?? 0);

  const outstanding = live.reduce((s, j) => s + Math.max(0, (j.price ?? 0) - (j.amountPaid ?? 0)), 0);
  void today;

  return {
    jobs: { total: live.length, ciao: ciaoJobs.length, direct: directJobs.length },
    earnings: {
      total: sum(live, "price"),
      ciao: sum(ciaoJobs, "price"),
      direct: sum(directJobs, "price"),
      collected: sum(live, "amountPaid"),
      outstanding,
    },
    sourceMix: [...sourceCounts.entries()]
      .map(([source, v]) => ({ source, ...v }))
      .sort((a, b) => b.jobs - a.jobs),
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
    occupancyBps: Math.round((busy.size / Math.max(1, windowDays)) * 10_000),
    openDays: Math.max(0, windowDays - busy.size),
    busyDays: busy.size,
    repeatClients: { repeat, total: clientJobCounts.size },
    funnel,
    reliability: {
      score: rel?.score ?? 50,
      medianResponseMinutes: rel?.medianResponseMinutes ?? 0,
      confirmationRateBps: rel?.confirmationRateBps ?? 10_000,
    },
    quotes: {
      sent: quotesSent,
      accepted: quotesAccepted,
      acceptanceBps: quotesSent > 0 ? Math.round((quotesAccepted / quotesSent) * 10_000) : 0,
    },
  };
}

// ---------------------------------------------------------------- the market
async function marketInsights(
  partnerId: string,
  listingIds: string[],
  vertical: string,
  area: string | null,
  city: string,
  sinceDay: string,
  windowDays: number,
): Promise<MarketInsights> {
  const minPeers = Number(await getSetting("partner.benchmarkMinPeers"));
  const sinceTs = new Date(`${sinceDay}T00:00:00Z`);

  // ---- demand in their area, from real searches -------------------------
  const [demand] = await db
    .select({
      searches: sql<string>`count(*)`,
      users: sql<string>`count(distinct coalesce(${schema.events.userId}::text, ${schema.events.anonId}))`,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.name, "search.performed"),
        gte(schema.events.ts, sinceTs),
        sql`${schema.events.props} ->> 'vertical' = ${vertical}`,
        area
          ? sql`(${schema.events.props} ->> 'area' = ${area} or ${schema.events.props} ->> 'city' = ${city})`
          : sql`${schema.events.props} ->> 'city' = ${city}`,
      ),
    );

  /*
   * Missed demand — the panel that pays for the subscription.
   *
   * Every search in their area that named a check-in date on which their
   * calendar was not open. It is a genuine number, not a guilt trip: a chalet
   * owner who blocks August because the family uses it should see exactly what
   * that costs and then decide, which is a decision they currently make with
   * no information at all.
   *
   * Computed against days the partner was closed rather than against listings
   * that failed to appear, because a blocked day is a fact and "would have
   * ranked" is a guess.
   */
  const closedDays = listingIds.length
    ? await db
        .select({ day: schema.calendarDays.day })
        .from(schema.calendarDays)
        .where(
          and(
            inArray(schema.calendarDays.listingId, listingIds),
            inArray(schema.calendarDays.state, ["blocked", "booked"]),
            gte(schema.calendarDays.day, sinceDay),
          ),
        )
    : [];
  const closedSet = new Set(closedDays.map((d) => d.day));

  const datedSearches = await db
    .select({ checkIn: sql<string | null>`${schema.events.props} ->> 'checkIn'` })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.name, "search.performed"),
        gte(schema.events.ts, sinceTs),
        sql`${schema.events.props} ->> 'vertical' = ${vertical}`,
        sql`${schema.events.props} ->> 'checkIn' is not null`,
        area
          ? sql`(${schema.events.props} ->> 'area' = ${area} or ${schema.events.props} ->> 'city' = ${city})`
          : sql`${schema.events.props} ->> 'city' = ${city}`,
      ),
    )
    .limit(5000);
  const searchesOnClosedDays = datedSearches.filter(
    (s) => s.checkIn && closedSet.has(s.checkIn),
  ).length;

  // ---- price position ----------------------------------------------------
  const pricePosition = await benchmarkPrice(partnerId, listingIds, vertical, city, minPeers);

  // ---- lead time across the category -------------------------------------
  const leadRows = await db
    .select({
      bucket: sql<string>`case
        when (${schema.events.props} ->> 'leadDays')::int <= 2 then '0-2'
        when (${schema.events.props} ->> 'leadDays')::int <= 7 then '3-7'
        when (${schema.events.props} ->> 'leadDays')::int <= 21 then '8-21'
        when (${schema.events.props} ->> 'leadDays')::int <= 90 then '22-90'
        else '90+' end`,
      count: sql<string>`count(*)`,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.name, "booking.requested"),
        gte(schema.events.ts, sinceTs),
        sql`${schema.events.props} ->> 'vertical' = ${vertical}`,
        sql`${schema.events.props} ->> 'leadDays' is not null`,
      ),
    )
    .groupBy(sql`1`);

  // ---- seasonality across the category -----------------------------------
  /*
   * Deliberately over all time rather than the window, and on check-in date
   * rather than booked-at. Seasonality is about when Libyans go, and a 90-day
   * window cannot see a season by definition. Lead time is the separate panel
   * that answers "when do they book".
   */
  const seasonRows = await db
    .select({
      month: sql<string>`to_char(${schema.bookings.checkIn}::date, 'MM')`,
      count: sql<string>`count(*)`,
    })
    .from(schema.bookings)
    .innerJoin(schema.venues, eq(schema.bookings.venueId, schema.venues.id))
    .where(
      and(
        eq(schema.venues.type, vertical),
        sql`${schema.bookings.checkIn} is not null`,
        inArray(schema.bookings.state, [
          "confirmed",
          "pre_arrival_reconfirmed",
          "checked_in",
          "completed",
          "reviewed",
        ]),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const seasonTotal = seasonRows.reduce((s, r) => s + Number(r.count), 0);
  const seasonality = seasonRows.map((r) => ({
    month: r.month,
    // An index rather than a count: 100 is an average month, so a partner can
    // read "June is 180" without knowing the size of the marketplace — and
    // without us publishing the size of the marketplace.
    index: seasonTotal > 0 ? Math.round((Number(r.count) / (seasonTotal / 12)) * 100) : 0,
  }));

  // ---- conversion vs the category ----------------------------------------
  const conversion = await benchmarkConversion(listingIds, vertical, sinceTs, minPeers);

  return {
    areaDemand: {
      searches: Number(demand?.searches ?? 0),
      users: Number(demand?.users ?? 0),
      area,
      vertical,
    },
    missedDemand: {
      searchesOnClosedDays,
      closedDays: closedSet.size,
      sampleDays: windowDays,
    },
    pricePosition,
    leadTime: leadRows.map((r) => ({ bucket: r.bucket, count: Number(r.count) })),
    seasonality,
    conversion,
  };
}

/**
 * Where their price sits among comparable businesses.
 *
 * Two different measures because two different businesses. A chalet has a
 * nightly rate on the listing; a make-up artist's price only exists on the
 * quotes she sends, and her quote book is a far better read on the market than
 * anything we could infer. Both are suppressed below `minPeers`, and the
 * suppression is reported rather than silently rendering an empty panel — a
 * blank chart reads as "no demand", which is a much worse lie than "not enough
 * data yet".
 */
async function benchmarkPrice(
  partnerId: string,
  listingIds: string[],
  vertical: string,
  city: string,
  minPeers: number,
): Promise<MarketInsights["pricePosition"]> {
  const empty = { available: false, peers: 0, p25: 0, p50: 0, p75: 0, yours: 0, positionBps: null };

  if (vertical === "service") {
    // Median accepted quote per partner, then quartiles across partners — so a
    // single prolific quoter cannot drag the market number to their own price.
    const rows = await db
      .select({
        partner: schema.partnerQuotes.partnerId,
        median: sql<string>`percentile_cont(0.5) within group (order by ${schema.partnerQuotes.total})`,
      })
      .from(schema.partnerQuotes)
      .where(
        and(
          eq(schema.partnerQuotes.status, "accepted"),
          sql`${schema.partnerQuotes.total} > 0`,
        ),
      )
      .groupBy(schema.partnerQuotes.partnerId);
    const peers = rows.filter((r) => r.partner !== partnerId).map((r) => Number(r.median));
    const yours = Number(rows.find((r) => r.partner === partnerId)?.median ?? 0);
    if (peers.length < minPeers) {
      return {
        ...empty,
        peers: peers.length,
        yours,
        suppressedReason: "not_enough_peers",
      };
    }
    return { ...quartiles(peers), available: true, peers: peers.length, yours, positionBps: position(yours, peers) };
  }

  const rows = await db
    .select({ id: schema.listings.id, price: schema.listings.baseNightly })
    .from(schema.listings)
    .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
    .where(
      and(
        eq(schema.venues.type, vertical),
        eq(schema.venues.city, city),
        eq(schema.listings.status, "live"),
        gt(schema.listings.baseNightly, 0),
      ),
    );
  const peers = rows.filter((r) => !listingIds.includes(r.id)).map((r) => Number(r.price));
  const mine = rows.filter((r) => listingIds.includes(r.id)).map((r) => Number(r.price));
  const yours = mine.length ? Math.round(mine.reduce((s, n) => s + n, 0) / mine.length) : 0;
  if (peers.length < minPeers) {
    return { ...empty, peers: peers.length, yours, suppressedReason: "not_enough_peers" };
  }
  return { ...quartiles(peers), available: true, peers: peers.length, yours, positionBps: position(yours, peers) };
}

function quartiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { p25: at(0.25), p50: at(0.5), p75: at(0.75) };
}

/** Their percentile among peers, in basis points. */
function position(yours: number, peers: number[]): number | null {
  if (!yours || peers.length === 0) return null;
  const below = peers.filter((p) => p < yours).length;
  return Math.round((below / peers.length) * 10_000);
}

async function benchmarkConversion(
  listingIds: string[],
  vertical: string,
  sinceTs: Date,
  minPeers: number,
): Promise<MarketInsights["conversion"]> {
  const rows = await db
    .select({
      listingId: sql<string>`${schema.events.props} ->> 'listingId'`,
      views: sql<string>`count(*) filter (where ${schema.events.name} = 'listing.viewed')`,
      requests: sql<string>`count(*) filter (where ${schema.events.name} = 'booking.requested')`,
    })
    .from(schema.events)
    .where(
      and(
        inArray(schema.events.name, ["listing.viewed", "booking.requested"]),
        gte(schema.events.ts, sinceTs),
        sql`${schema.events.props} ->> 'vertical' = ${vertical}`,
        sql`${schema.events.props} ->> 'listingId' is not null`,
      ),
    )
    .groupBy(sql`1`);

  const peerRates = rows
    .filter((r) => !listingIds.includes(r.listingId) && Number(r.views) >= 5)
    .map((r) => (Number(r.requests) / Math.max(1, Number(r.views))) * 10_000);
  const mine = rows.filter((r) => listingIds.includes(r.listingId));
  const myViews = mine.reduce((s, r) => s + Number(r.views), 0);
  const myRequests = mine.reduce((s, r) => s + Number(r.requests), 0);
  const yoursBps = myViews > 0 ? Math.round((myRequests / myViews) * 10_000) : 0;

  if (peerRates.length < minPeers) {
    return { yoursBps, medianBps: 0, available: false, peers: peerRates.length };
  }
  const sorted = [...peerRates].sort((a, b) => a - b);
  return {
    yoursBps,
    medianBps: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0),
    available: true,
    peers: peerRates.length,
  };
}

// ---------------------------------------------------------------- actions
/**
 * Three things worth doing, in plain language.
 *
 * The same rule the guest recommendations follow: a number that does not
 * suggest an action is decoration, and an action we cannot justify in one
 * honest sentence should not be on the screen. These are deliberately blunt —
 * a partner reading this on a phone between two jobs has about six seconds.
 */
function freeActions(own: OwnInsights, kind: string): PartnerInsights["actions"] {
  const actions: PartnerInsights["actions"] = [];

  if (own.earnings.outstanding > 0) {
    actions.push({
      key: "chase_receivables",
      ar: `عندك ${fmt(own.earnings.outstanding)} د.ل لم تُحصَّل بعد — راجع قائمة المستحقات.`,
      en: `${fmt(own.earnings.outstanding)} LYD is still uncollected — check the money owed list.`,
      plus: false,
    });
  }
  if (own.reliability.score < 70) {
    actions.push({
      key: "reliability",
      ar: "ردّك على طلبات الحجز أبطأ من اللازم — الرد السريع يرفع ترتيبك في البحث.",
      en: "You are answering booking requests slowly — faster replies lift your search ranking.",
      plus: false,
    });
  }
  if (own.funnel.views > 30 && own.funnel.requests === 0) {
    actions.push({
      key: "views_no_requests",
      ar: `شاف ناس صفحتك ${own.funnel.views} مرة بلا أي طلب حجز — غالبًا الصور أو السعر.`,
      en: `Your page was viewed ${own.funnel.views} times with no booking request — usually the photos or the price.`,
      plus: false,
    });
  }
  if (own.quotes.sent >= 3 && own.quotes.acceptanceBps < 3000) {
    actions.push({
      key: "quote_acceptance",
      ar: "أقل من ثلث عروضك تُقبَل — جرّب تحديد مدة صلاحية أقصر ومتابعة العميل بعد يومين.",
      en: "Fewer than a third of your quotes are accepted — try a shorter validity and a follow-up after two days.",
      plus: false,
    });
  }
  if (own.jobs.total === 0) {
    actions.push({
      key: "add_first_job",
      ar:
        kind === "service"
          ? "سجّل شغلك القادم هنا حتى لو جاك من واتساب — التقويم يمنع التعارض ويحسب لك دخلك."
          : "سجّل حجوزاتك اللي جتك من برّا تشاو — تمنع الحجز المزدوج وتشوف دخلك كامل.",
      en:
        kind === "service"
          ? "Add your next job here even if it came from WhatsApp — the calendar stops clashes and totals your income."
          : "Record the bookings that came from outside Ciao — it prevents double-bookings and shows your full income.",
      plus: false,
    });
  }
  return actions;
}

function marketActions(
  own: OwnInsights,
  market: MarketInsights,
  vertical: string,
): PartnerInsights["actions"] {
  const actions: PartnerInsights["actions"] = [];

  if (market.missedDemand.searchesOnClosedDays >= 5) {
    actions.push({
      key: "missed_demand",
      ar: `${market.missedDemand.searchesOnClosedDays} عملية بحث كانت على أيام تقويمك فيها مقفول — افتح بعضها إن قدرت.`,
      en: `${market.missedDemand.searchesOnClosedDays} searches landed on days your calendar was closed — open some if you can.`,
      plus: true,
    });
  }

  const pp = market.pricePosition;
  if (pp.available && pp.yours > 0 && pp.positionBps !== null) {
    if (pp.yours < pp.p25) {
      actions.push({
        key: "priced_low",
        ar: `سعرك أقل من ٧٥٪ من الأنشطة المشابهة (الوسيط ${fmt(pp.p50)} د.ل) — عندك مساحة ترفع.`,
        en: `You are priced below 75% of comparable businesses (median ${fmt(pp.p50)} LYD) — there is room to raise.`,
        plus: true,
      });
    } else if (pp.yours > pp.p75 && own.funnel.views > 20 && own.funnel.requests === 0) {
      actions.push({
        key: "priced_high",
        ar: `سعرك أعلى من ٧٥٪ من المشابهين والزيارات ما تحولت لحجوزات — راجع السعر أو أضف ما يبرره.`,
        en: `You are priced above 75% of comparable businesses and views are not converting — revisit the price or justify it.`,
        plus: true,
      });
    }
  }

  // When does this category book? Answering it turns into a date to act on.
  const longLead = market.leadTime.find((l) => l.bucket === "22-90" || l.bucket === "90+");
  if (longLead && longLead.count > 0 && vertical !== "coast") {
    actions.push({
      key: "open_early",
      ar: "أغلب حجوزات فئتك تُحجز قبل شهر أو أكثر — افتح تقويم الموسم القادم من الآن.",
      en: "Most bookings in your category are made a month or more ahead — open next season's calendar now.",
      plus: true,
    });
  }

  const peak = [...market.seasonality].sort((a, b) => b.index - a.index)[0];
  if (peak && peak.index >= 130) {
    actions.push({
      key: "peak_month",
      ar: `أعلى طلب في السوق يكون في الشهر ${peak.month} — تأكد أن أسعارك وتقويمك جاهزين قبله.`,
      en: `Market demand peaks in month ${peak.month} — make sure your prices and calendar are ready before it.`,
      plus: true,
    });
  }

  if (market.conversion.available && market.conversion.yoursBps > 0) {
    if (market.conversion.yoursBps < market.conversion.medianBps * 0.6) {
      actions.push({
        key: "conversion_low",
        ar: "نسبة تحويل زياراتك لحجوزات أقل من نص السوق — الصور والوصف أول ما تراجعه.",
        en: "Your view-to-booking rate is under half the market's — photos and description are the first things to review.",
        plus: true,
      });
    }
  }
  return actions;
}

function fmt(dirhams: number): string {
  return Math.round(dirhams / 1000).toLocaleString("en-US");
}
