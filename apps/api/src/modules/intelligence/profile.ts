/**
 * Profile folding — turns the event stream into per-user Traits, and Traits
 * into personalized ranking. Profiles are DERIVED STATE: rebuildable from
 * events at any time (delete profile + refold = same result).
 *
 * Traits v1 (extend by bumping FOLD_VERSION and adding fields — never rename):
 *  - areaAffinity:   decayed counters per area from searches/views/bookings
 *  - priceExposure:  running stats of nightly prices the user engaged with
 *  - groupSize:      typical guests from searches/bookings
 *  - verticalAffinity: coast vs hall engagement
 *  - privacyAffinity / familyAffinity / generatorAffinity: filter usage
 *  - leadDaysMedianish, weekendShare, monthCounts: timing behavior
 *  - rfm: recency (last event), frequency (bookings), monetary (GMV dirhams)
 */
import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";

export const FOLD_VERSION = 3;

export interface Traits {
  v: number;
  areaAffinity: Record<string, number>;
  cityAffinity: Record<string, number>;
  priceSum: number;
  priceCount: number;
  groupSizeSum: number;
  groupSizeCount: number;
  vertical: { coast: number; hall: number };
  privacyAffinity: number;
  familyAffinity: number;
  generatorAffinity: number;
  leadDays: number[]; // last 10 observations
  weekendCheckins: number;
  weekdayCheckins: number;
  monthCounts: Record<string, number>;
  rfm: { lastEventAt: string | null; bookings: number; gmv: number };
  /**
   * Declared traits — what the member told us, kept apart from what we
   * inferred. The separation is the point: everything above this line is a
   * guess we made from behaviour and can be wrong about politely; everything
   * below it is a statement they made on purpose, and it outranks the guess.
   *
   * Nothing here is finer-grained than the member would expect. `ageBand` is a
   * band, never a birth date. `declaredParty` is two counts and a set of
   * coarse bands, never a family. If a member asked to see their profile, this
   * is printable without apology — which is the test guardrail 3 sets.
   */
  declared: {
    ageBand: string | null;
    birthMonth: number | null;
    party: { adults: number; children: number; bands: string[] } | null;
    occasionMonths: number[];
    plannedEventKind: string | null;
  };
  /**
   * What the party actually looked like at checkout, and what it fed on.
   *
   * `observedParty` is a *behavioural* counterpart to `declared.party`: the
   * declared one is what a member typed into a preferences screen, this one is
   * what they filled into a booking, and the second is a far better predictor
   * than the first because nobody lies to a price. It is two running counts,
   * exactly the granularity a receptionist writes on a card — not a family
   * register (guardrail 3): "usually travels with two adults and two children
   * under ten" is behaviour, and a recommendation can honestly say so.
   *
   * `boardAffinity` matters because it is the strongest unstated preference in
   * this market. A family that has twice booked full board is not shopping on
   * nightly rate at all; showing them a cheaper room-only chalet reads as us
   * not having understood the question.
   */
  observedParty: { adultsSum: number; childrenSum: number; count: number };
  boardAffinity: Record<string, number>;
  /**
   * Where they keep arriving from. This is first-party — our own link, our own
   * `src` — never anything bought or scraped (guardrail 1). It exists so a
   * partner can be told what their Facebook page earns them, and so a member
   * who only ever arrives through a venue's post is not pestered with search
   * emails they have never used.
   */
  sourceCounts: Record<string, number>;
}

export function emptyTraits(): Traits {
  return {
    v: FOLD_VERSION,
    observedParty: { adultsSum: 0, childrenSum: 0, count: 0 },
    boardAffinity: {},
    sourceCounts: {},
    areaAffinity: {},
    cityAffinity: {},
    priceSum: 0,
    priceCount: 0,
    groupSizeSum: 0,
    groupSizeCount: 0,
    vertical: { coast: 0, hall: 0 },
    privacyAffinity: 0,
    familyAffinity: 0,
    generatorAffinity: 0,
    leadDays: [],
    weekendCheckins: 0,
    weekdayCheckins: 0,
    monthCounts: {},
    rfm: { lastEventAt: null, bookings: 0, gmv: 0 },
    declared: {
      ageBand: null,
      birthMonth: null,
      party: null,
      occasionMonths: [],
      plannedEventKind: null,
    },
  };
}

/** Event weights: money speaks louder than clicks. */
const WEIGHTS: Record<string, number> = {
  "search.performed": 1,
  "listing.viewed": 2,
  "quote.viewed": 3,
  "listing.saved": 4, // a heart is deliberate — stronger than a view
  "booking.requested": 5,
  "booking.confirmed": 10,
  "booking.completed": 12,
  /*
   * A venue storefront view is worth more than a search and less than a quote.
   *
   * Somebody who tapped a venue's own Facebook link and read its page has
   * shown more intent than a browser scrolling results, and less than one who
   * asked what specific dates would cost. Weighting it at 2 also stops a viral
   * post from swamping every other signal in a member's profile — one evening
   * of traffic should not redefine what we think somebody likes.
   */
  "venue.viewed": 2,
  "waitlist.joined": 6, // wanted it, could not have it: unmet intent is strong
};

type EventRow = typeof schema.events.$inferSelect;

/** Fold one event into traits (pure — unit-testable). */
export function foldEvent(t: Traits, e: EventRow): Traits {
  const p = e.props as Record<string, unknown>;
  const w = WEIGHTS[e.name] ?? 0;
  const num = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : Number(p[k]));

  if (w > 0) {
    const area = typeof p.area === "string" ? p.area : undefined;
    const city = typeof p.city === "string" ? p.city : undefined;
    if (area) t.areaAffinity[area] = (t.areaAffinity[area] ?? 0) + w;
    if (city) t.cityAffinity[city] = (t.cityAffinity[city] ?? 0) + w;
    const vertical = p.vertical === "hall" ? "hall" : p.vertical === "coast" ? "coast" : null;
    if (vertical) t.vertical[vertical] += w;
  }

  /*
   * Where they arrived from, folded for every event that carries it.
   *
   * Out here rather than in a case arm because `src` rides on the storefront
   * view, the booking and anything we add later — and a member who only ever
   * reaches us through one venue's Facebook page is telling us something about
   * how to reach them that no single event type owns.
   */
  if (typeof p.src === "string" && p.src) {
    t.sourceCounts[p.src] = (t.sourceCounts[p.src] ?? 0) + 1;
  }

  switch (e.name) {
    /*
     * The party as it was actually filled in at checkout.
     *
     * Two running counts and nothing else: enough to say "usually two adults
     * and two young children" and therefore enough to stop offering a family
     * of six a unit that sleeps four. Deliberately not enough to describe
     * anybody's household (guardrail 3).
     */
    case "quote.party_set": {
      const adults = num("adults");
      const children = num("children");
      if (Number.isFinite(adults) && adults > 0) {
        t.observedParty.adultsSum += adults;
        t.observedParty.childrenSum += Number.isFinite(children) ? children : 0;
        t.observedParty.count++;
        // The group-size signal already exists and drives capacity fit; keep
        // feeding it so one definition of "how many people" survives.
        t.groupSizeSum += adults + (Number.isFinite(children) ? children : 0);
        t.groupSizeCount++;
      }
      break;
    }
    /*
     * Board basis — the strongest unstated preference in resort supply. A
     * family that keeps choosing full board is not comparing nightly rates at
     * all, and ranking them a cheaper room-only chalet reads as us having
     * misunderstood the question.
     */
    case "quote.board_seen": {
      const board = typeof p.board === "string" ? p.board : null;
      if (board && board !== "room_only") {
        t.boardAffinity[board] = (t.boardAffinity[board] ?? 0) + 1;
      }
      break;
    }
    case "waitlist.joined": {
      // Unmet demand is intent that produced no booking, so nothing else in
      // the fold would ever see it. Lead time still teaches us seasonality.
      const lead = num("leadDays");
      if (Number.isFinite(lead) && lead >= 0) {
        t.leadDays.push(lead);
        if (t.leadDays.length > 10) t.leadDays.shift();
      }
      break;
    }
    case "search.performed": {
      const filters = Array.isArray(p.filters) ? (p.filters as string[]) : [];
      if (filters.includes("minPrivacy")) t.privacyAffinity++;
      if (filters.includes("familyOnly")) t.familyAffinity++;
      if (filters.includes("generator")) t.generatorAffinity++;
      const g = num("guests");
      if (Number.isFinite(g) && g > 0) {
        t.groupSizeSum += g;
        t.groupSizeCount++;
      }
      break;
    }
    /*
     * Declared profile events. These fold like any other event so the one
     * direction of data flow holds — nothing reads user_preferences directly
     * to personalize, or two consumers would end up with two definitions of
     * "what we know about this member".
     */
    case "profile.birth_date_added": {
      t.declared.ageBand = typeof p.ageBand === "string" ? p.ageBand : null;
      const bm = num("birthMonth");
      t.declared.birthMonth = Number.isFinite(bm) && bm >= 1 && bm <= 12 ? bm : null;
      break;
    }
    case "profile.party_added": {
      const adults = num("adults");
      const children = num("children");
      if (Number.isFinite(adults) && adults > 0) {
        t.declared.party = {
          adults,
          children: Number.isFinite(children) && children > 0 ? children : 0,
          bands: Array.isArray(p.bands) ? (p.bands as string[]) : [],
        };
      }
      break;
    }
    case "profile.occasions_added": {
      const months = Array.isArray(p.months) ? (p.months as unknown[]) : [];
      t.declared.occasionMonths = [
        ...new Set(months.map(Number).filter((m) => Number.isFinite(m) && m >= 1 && m <= 12)),
      ];
      break;
    }
    case "profile.planned_event_added": {
      t.declared.plannedEventKind = typeof p.kind === "string" ? p.kind : null;
      break;
    }
    case "listing.viewed":
    case "listing.saved": {
      const price = num("priceNightly");
      if (Number.isFinite(price) && price > 0) {
        t.priceSum += price;
        t.priceCount++;
      }
      break;
    }
    case "quote.viewed":
    case "booking.requested": {
      const lead = num("leadDays");
      if (Number.isFinite(lead) && lead >= 0) {
        t.leadDays = [...t.leadDays.slice(-9), lead];
      }
      const g = num("guests");
      if (Number.isFinite(g) && g > 0) {
        t.groupSizeSum += g;
        t.groupSizeCount++;
      }
      if (e.name === "booking.requested") {
        const checkIn = typeof p.checkIn === "string" ? p.checkIn : undefined;
        if (checkIn) {
          const d = new Date(`${checkIn}T00:00:00Z`);
          const dow = d.getUTCDay();
          if (dow === 4 || dow === 5 || dow === 6) t.weekendCheckins++;
          else t.weekdayCheckins++;
          const m = checkIn.slice(5, 7);
          t.monthCounts[m] = (t.monthCounts[m] ?? 0) + 1;
        }
      }
      break;
    }
    case "booking.confirmed": {
      t.rfm.bookings++;
      const total = num("total");
      if (Number.isFinite(total)) t.rfm.gmv += total;
      break;
    }
  }
  t.rfm.lastEventAt = (e.ts ?? new Date()).toISOString();
  return t;
}

/** Incremental fold for one user: process events after the cursor. */
export async function foldUser(userId: string): Promise<Traits> {
  const [existing] = await db
    .select()
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .limit(1);
  let traits: Traits =
    existing && (existing.traits as Traits).v === FOLD_VERSION
      ? (existing.traits as Traits)
      : emptyTraits();
  const cursor = existing?.lastEventTs ?? new Date(0);

  const rows = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.userId, userId), gt(schema.events.ts, cursor)))
    .orderBy(asc(schema.events.ts))
    .limit(2000);
  if (rows.length === 0 && existing) return traits;

  for (const e of rows) traits = foldEvent(traits, e);
  const lastTs = rows.length > 0 ? rows[rows.length - 1]!.ts : cursor;

  await db
    .insert(schema.userProfiles)
    .values({ userId, traits, lastEventTs: lastTs, foldVersion: FOLD_VERSION, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.userProfiles.userId,
      set: { traits, lastEventTs: lastTs, foldVersion: FOLD_VERSION, updatedAt: new Date() },
    });
  return traits;
}

/** Fold every user with fresh events (worker sweep). */
export async function foldAllDirty(): Promise<number> {
  const dirty = await db
    .selectDistinct({ userId: schema.events.userId })
    .from(schema.events)
    .leftJoin(schema.userProfiles, eq(schema.userProfiles.userId, schema.events.userId))
    .where(
      and(
        isNotNull(schema.events.userId),
        sql`(${schema.userProfiles.lastEventTs} is null or ${schema.events.ts} > ${schema.userProfiles.lastEventTs})`,
      ),
    )
    .limit(200);
  for (const d of dirty) {
    if (d.userId) await foldUser(d.userId);
  }
  return dirty.length;
}

// ---------------------------------------------------------------- scoring
type Listing = typeof schema.listings.$inferSelect;
type Venue = typeof schema.venues.$inferSelect;

/**
 * Personalized listing score. Weights are heuristic v1 — when volume exists,
 * replace with learned weights WITHOUT changing this signature.
 * Returns a transparent Arabic "because" for the top contributing signal.
 */
export function scoreListing(
  traits: Traits | null,
  listing: Listing,
  venue: Venue,
  reliability: number | null,
  popularity14d: number,
): { score: number; because: string } {
  // Base: quality + freshness signals everyone shares.
  let score = 0;
  const because: [number, string][] = [];
  if (venue.verifiedAt && !venue.badgeRevoked) score += 10;
  score += ((reliability ?? 50) / 100) * 5;
  score += Math.min(10, popularity14d * 0.5);
  if (popularity14d >= 6) because.push([Math.min(10, popularity14d * 0.5), "رائج هذا الأسبوع"]);

  if (traits) {
    // Area affinity.
    const areaScore = venue.area ? (traits.areaAffinity[venue.area] ?? 0) : 0;
    if (areaScore > 0) {
      const s = Math.min(20, areaScore);
      score += s;
      because.push([s, `لأنك تبحث كثيرًا في ${venue.area}`]);
    }
    const cityScore = traits.cityAffinity[venue.city] ?? 0;
    score += Math.min(8, cityScore * 0.5);

    // Price fit: within ±30% of the user's typical engaged price.
    if (traits.priceCount >= 3 && listing.baseNightly > 0) {
      const typical = traits.priceSum / traits.priceCount;
      const ratio = listing.baseNightly / typical;
      if (ratio >= 0.7 && ratio <= 1.3) {
        score += 12;
        because.push([12, "سعره في نطاقك المعتاد"]);
      } else if (ratio < 0.7) {
        score += 6; // cheaper than usual is still attractive
      }
    }

    /*
     * Group-size fit.
     *
     * A declared party outranks an inferred one, and outranks it decisively:
     * a member who typed "8 adults, 3 children" has told us the answer, while
     * an average over past searches is a guess that a few browsing sessions
     * for a couples' weekend can drag off. Stating it also earns a stronger
     * penalty when a place cannot hold them — showing a family of eleven a
     * four-person chalet after they told us there are eleven of them is worse
     * than never having asked.
     *
     * Note what child bands are NOT used for here. They size and screen the
     * property; they never rank *at* a child.
     */
    /*
     * Board fit — the preference nobody states and everybody has.
     *
     * A family that has twice chosen full board is not shopping on nightly
     * rate: they are buying a week where nobody cooks. Ranking them a cheaper
     * room-only chalet is not a bargain, it is us having misread the question.
     * Two observations minimum, per the ranker's own rule that one is
     * curiosity and not a preference.
     */
    const boardObservations = Object.values(traits.boardAffinity).reduce((a, b) => a + b, 0);
    if (boardObservations >= 2 && listing.boardBasis && listing.boardBasis !== "room_only") {
      const s2 = Math.min(10, (traits.boardAffinity[listing.boardBasis] ?? 0) * 4);
      if (s2 > 0) {
        score += s2;
        because.push([s2, "إقامة كاملة — زي اللي تختاره عادة"]);
      }
    }

    const declaredHeads = traits.declared.party
      ? traits.declared.party.adults + traits.declared.party.children
      : null;
    const typicalGroup =
      declaredHeads ??
      (traits.groupSizeCount > 0 ? traits.groupSizeSum / traits.groupSizeCount : null);
    if (typicalGroup != null && listing.maxGuests) {
      const stated = declaredHeads != null;
      if (listing.maxGuests >= typicalGroup) {
        score += stated ? 9 : 5;
        if (typicalGroup >= 8 || stated) {
          because.push([
            stated ? 9 : 5,
            stated ? `يتسع لمجموعتكم (${Math.round(typicalGroup)} أشخاص)` : "يتسع لمجموعتك",
          ]);
        }
      } else {
        score -= stated ? 14 : 8; // too small for the party they told us about
      }
    }

    // Cultural filter affinities.
    const privacyScore = (venue.privacy as { score?: number } | null)?.score ?? 0;
    if (traits.privacyAffinity >= 2 && privacyScore >= 80) {
      score += 8;
      because.push([8, "ستر عالي كما تفضّل"]);
    }
    if (traits.familyAffinity >= 2 && listing.familyOnly) score += 5;
    const hasGen = (venue.amenities as { key: string; present: boolean }[]).some(
      (a) => a.present && a.key === "generator",
    );
    if (traits.generatorAffinity >= 2 && hasGen) score += 4;

    // Vertical affinity.
    const vt = venue.type === "hall" ? traits.vertical.hall : traits.vertical.coast;
    score += Math.min(6, vt * 0.2);
  }

  because.sort((a, b) => b[0] - a[0]);
  return {
    score,
    because: because[0]?.[1] ?? (venue.verifiedAt ? "موثّق من تشاو" : "جديد على تشاو"),
  };
}
