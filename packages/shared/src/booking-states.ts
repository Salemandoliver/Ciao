/**
 * Booking state machine — design doc §9.3.
 * Every transition is server-side, idempotent, journaled.
 * Clients only *request* transitions.
 */

export const BOOKING_STATES = [
  "draft",
  "requested",
  "payment_pending",
  "payment_held",
  "host_confirmed",
  "confirmed", // deposit_captured
  "pre_arrival_reconfirmed",
  "checked_in",
  "completed",
  "reviewed",
  // branches
  "host_declined",
  "host_timeout",
  "payment_failed",
  "cancelled_by_guest",
  "cancelled_by_host",
  "force_majeure_credit",
  "disputed",
  "resolved",
  "exchange_listed",
  "transferred",
  "no_show",
  "expired",
] as const;

export type BookingState = (typeof BOOKING_STATES)[number];

/** Terminal states — no further transitions except dispute opening where noted. */
export const TERMINAL_STATES: BookingState[] = [
  "reviewed",
  "host_declined",
  "host_timeout",
  "payment_failed",
  "cancelled_by_guest",
  "cancelled_by_host",
  "force_majeure_credit",
  "resolved",
  "transferred",
  "expired",
];

/**
 * Legal transitions. Key = from-state, value = allowed to-states.
 * Money movements attach to transitions, never to screens (§9.3).
 */
export const TRANSITIONS: Record<BookingState, BookingState[]> = {
  draft: ["requested", "expired"],
  requested: ["payment_pending", "expired", "cancelled_by_guest"],
  payment_pending: [
    "payment_held",
    "payment_failed",
    "expired",
    "cancelled_by_guest",
  ],
  payment_held: [
    "host_confirmed",
    "host_declined",
    "host_timeout",
    "cancelled_by_guest",
  ],
  host_confirmed: ["confirmed", "payment_failed"],
  confirmed: [
    "pre_arrival_reconfirmed",
    "checked_in",
    "cancelled_by_guest",
    "cancelled_by_host",
    "force_majeure_credit",
    "disputed",
    "exchange_listed",
    "no_show",
  ],
  pre_arrival_reconfirmed: [
    "checked_in",
    "cancelled_by_guest",
    "cancelled_by_host",
    "force_majeure_credit",
    "disputed",
    "exchange_listed",
    "no_show",
  ],
  checked_in: ["completed", "disputed"],
  completed: ["reviewed", "disputed"],
  reviewed: [],
  host_declined: [],
  host_timeout: [],
  payment_failed: ["payment_pending"], // retryable (§9.3)
  cancelled_by_guest: [],
  cancelled_by_host: [],
  force_majeure_credit: [],
  disputed: ["resolved"],
  resolved: [],
  exchange_listed: ["transferred", "confirmed"], // delist returns to confirmed
  transferred: [],
  no_show: ["disputed", "resolved"],
  expired: [],
};

export function canTransition(from: BookingState, to: BookingState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Host confirmation windows — §9.4 (minutes). */
export const CONFIRMATION_WINDOW_MINUTES = {
  standard: 120,
  same_day: 15,
  wedding_date: 24 * 60,
} as const;

export type BookingType = "stay" | "day_use" | "event_date" | "visit";

export type CancellationTier = "flexible" | "moderate" | "strict";

/** §9.7 — refundable fraction of deposit given hours before check-in. */
export function refundFraction(
  tier: CancellationTier,
  hoursBeforeCheckIn: number,
): number {
  switch (tier) {
    case "flexible":
      return hoursBeforeCheckIn >= 48 ? 1 : 0;
    case "moderate":
      if (hoursBeforeCheckIn >= 7 * 24) return 1;
      return hoursBeforeCheckIn > 0 ? 0.5 : 0;
    case "strict":
      return 0; // date-lock fee non-refundable; Exchange is the escape valve
  }
}
