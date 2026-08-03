/**
 * Intelligence event spine — taxonomy registry + emit helper.
 *
 * PRIVACY GUARDRAILS (non-negotiable, see ciao-intelligence skill):
 *  - First-party behavior only. No third-party identity/social enrichment.
 *  - props never contain phone numbers, free-text messages, or names.
 *  - Profiles are derived and rebuildable; raw events prune after 18 months.
 *  - Personalization is transparent: recs carry a human-readable "because".
 */
import { db, schema } from "../../db/client.js";

/**
 * Event taxonomy v1 — dot-namespaced `domain.action`.
 * Adding an event = add it here with its expected props (documented, not
 * enforced field-by-field; unknown props are allowed but rows are capped).
 */
export const EVENT_TAXONOMY: Record<string, string> = {
  // discovery (client + server)
  "page.view": "path, ref",
  "search.performed": "vertical, city, area, filters[], checkIn, checkOut, guests, resultCount",
  "listing.viewed": "listingId, vertical, city, area, source, priceNightly",
  "listing.gallery_swiped": "listingId, photoIndex, source",
  "quote.viewed": "listingId, checkIn, checkOut, nights, total, deposit, leadDays",
  "package.viewed": "listingId, packageId, totalPrice, guestCountMax",
  // auth funnel (server)
  "auth.otp_requested": "isNewDevice",
  "auth.verified": "isNewUser",
  // booking funnel (server — canonical)
  "booking.requested": "bookingId, listingId, vertical, city, area, nights, total, deposit, leadDays, guests, rail",
  "payment.initiated": "bookingId, rail, amount",
  "payment.captured": "bookingId, rail, amount",
  "payment.failed": "bookingId, rail, reason",
  "booking.confirmed": "bookingId, listingId, minutesToConfirm",
  "booking.declined": "bookingId, byHost",
  "booking.timeout": "bookingId",
  "booking.cancelled": "bookingId, by, refundFraction, daysBeforeCheckIn",
  "booking.checked_in": "bookingId",
  "booking.completed": "bookingId",
  "booking.reviewed": "bookingId, scores",
  "booking.no_show": "bookingId",
  // host behavior (server)
  "host.response": "bookingId, decision, minutes",
  "host.calendar_blocked": "listingId, dayCount",
  /*
   * Partner control panel — the supply side's own behaviour.
   *
   * These feed dashboards, not guest profiles: `foldEvent` builds a picture of
   * a *guest's* taste, and folding a photographer's diary into it would put
   * her business in the same object as her holiday preferences. Events →
   * dashboards is a legitimate path through the four layers; events → the
   * wrong profile is not.
   *
   * `source` on a job is the single most valuable field the marketplace
   * collects. It is the partner telling us, from their own diary, how much of
   * Libya's chalet and wedding business Ciao is actually winning — a question
   * nobody here can answer today, ourselves included. It carries no customer,
   * no price detail and no name.
   */
  "partner.job_created": "source, kind, linked, hasPrice, leadDays",
  "partner.job_completed": "source, kind, linked, paidInFull",
  "partner.calendar_updated": "action, dayCount, via",
  "partner.quote_sent": "total, lines, hasDay",
  "partner.quote_accepted": "total, daysToDecide",
  "partner.insights_viewed": "plus, windowDays",
  "partner.plus_started": "trial, priceDirhams",
  "partner.plus_cancelled": "daysActive",
  "partner.command_received": "command, dayCount, refused",
  "partner.agenda_sent": "jobCount, channel",
  "partner.team_changed": "action, role",
  "partner.signed_in": "mustChange",
  /*
   * The business console's own sign-ins — an internal surface, tracked for
   * the security trail's sake (dashboards, never profiles: folding an
   * operator's working hours into userProfiles would put staff surveillance
   * in the same object as holiday preferences).
   */
  "console.signed_in": "role, mustChange",
  // engagement (client + server)
  "rail.selected": "rail",
  "share.clicked": "listingId, channel",
  "filter.toggled": "key, value, vertical",
  "listing.saved": "listingId, vertical, city, area, priceNightly",
  "listing.unsaved": "listingId",
  "map.opened": "vertical, city, resultCount",
  "map.pin_selected": "listingId, vertical",
  // trust surfaces — reviews & disputes are the product's core promise
  "trust.opened": "listingId, rating, reviewCount, disputeCount",
  "review.started": "listingId, bookingCode",
  "dispute.opened": "bookingId, listingId, category",
  // membership — an account is a declared relationship, so its events are
  // about what the user chose, never about what we inferred about them
  "account.joined": "withReferral",
  "auth.passkey_login": "",
  "passkey.registered": "",
  "prefs.updated": "keys[]",
  "loyalty.earned": "reason, delta",
  "loyalty.redeemed": "points, dirhams",
  "referral.joined": "referrerId",
  "referral.qualified": "referralId, bookingId",
  "wallet.topup_started": "amount, rail",
  "message.sent": "bookingId",
  // loyalty economy — points, partners and promos
  "loyalty.expired": "points",
  "partner.voucher_issued": "partnerId, value, points",
  "partner.voucher_redeemed": "partnerId, value, points",
  "promo.applied": "code, discount, kind",
  /*
   * Declared profile data.
   *
   * These carry the *shape* of what a member told us and never the data
   * itself: an age band, not a date of birth; counts and bands, not a family.
   * That is guardrail 2 (no PII in props) doing real work rather than
   * ceremonial work — the events table is the least protected place this
   * information could sit, and a birth date in it would leak into every
   * downstream aggregate that ever gets exported.
   */
  "profile.birth_date_added": "ageBand, birthMonth",
  "profile.party_added": "adults, children, bands[]",
  "profile.occasions_added": "kinds[], months[]",
  "profile.planned_event_added": "kind, monthsAway",
  "auth.signed_out": "everywhere",
  /*
   * Proactive campaigns. `campaign.sent` is emitted whether or not a message
   * went out, with `messaged` recording which — so the birthday points and the
   * birthday message stay separately attributable, and an opt-out is visible
   * in the funnel instead of looking like a delivery failure.
   */
  "campaign.sent": "campaign, channel, messaged",
  "campaign.converted": "campaign, bookingId, daysSinceSend",
  /*
   * A hand-drawn search area is the strongest demand signal this marketplace
   * can collect — a person outlining the piece of Libya they want to be in.
   * Recorded as the shape's centre (3 decimal places, ~100m) and its size,
   * never the outline: a small enough polygon traced around a single house is
   * a home address, and an events table is the wrong place for one.
   */
  "search.area_drawn": "vertical, shape, centreLat, centreLng, areaKm2, resultCount",
  /*
   * Someone tapped through to directions. `target` is "maps" | "geo" |
   * "neighbour"; `bookingId` is absent for a neighbour link, which is opened
   * from a public listing page by someone who has not booked anything.
   */
  "navigation.opened": "bookingId?, target",
};

export interface EmitOptions {
  userId?: string | null;
  anonId?: string | null;
  sessionId?: string | null;
  source?: "web" | "api" | "worker" | "ops";
  ts?: Date;
  context?: Record<string, unknown>;
}

const MAX_PROPS_BYTES = 2048;

/** Fire-and-forget server-side emit. Never throws — intelligence must never break the product. */
export function track(
  name: string,
  props: Record<string, unknown>,
  opts: EmitOptions = {},
): void {
  void trackAsync(name, props, opts);
}

export async function trackAsync(
  name: string,
  props: Record<string, unknown>,
  opts: EmitOptions = {},
): Promise<void> {
  try {
    if (!(name in EVENT_TAXONOMY)) {
      console.warn(`intelligence: unknown event "${name}" — add it to EVENT_TAXONOMY`);
      return;
    }
    const serialized = JSON.stringify(props ?? {});
    if (serialized.length > MAX_PROPS_BYTES) {
      console.warn(`intelligence: event "${name}" props too large — dropped`);
      return;
    }
    await db.insert(schema.events).values({
      name,
      props: props as object,
      userId: opts.userId ?? null,
      anonId: opts.anonId ?? null,
      sessionId: opts.sessionId ?? null,
      source: opts.source ?? "api",
      ts: opts.ts ?? new Date(),
      context: (opts.context as object) ?? null,
    });
  } catch (e) {
    console.error("intelligence: emit failed (ignored)", e);
  }
}
