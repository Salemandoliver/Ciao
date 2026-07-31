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
  "listing.gallery_swiped": "listingId, photoIndex",
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
  // engagement (client + server)
  "rail.selected": "rail",
  "share.clicked": "listingId, channel",
  "filter.toggled": "key, value, vertical",
  "listing.saved": "listingId, vertical, city, area, priceNightly",
  "listing.unsaved": "listingId",
  "map.opened": "vertical, city, resultCount",
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
