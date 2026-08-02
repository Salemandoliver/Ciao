/**
 * Partner domain — the supply side's own vocabulary.
 *
 * Kept in `shared` rather than in the API module because the web console makes
 * the same judgements the server does: which statuses are live, whether a role
 * may see money, whether a job occupies a day. Two copies of "can this person
 * see the payout screen" is exactly the kind of drift that becomes a security
 * bug rather than a cosmetic one.
 */

/** What shape of business the console is being drawn for. */
export type PartnerKind = "venue" | "hall" | "service";

/**
 * Where the work came from.
 *
 * `ciao` is the only value the platform sets. Everything else is the partner
 * telling us how their own customer found them, and it is the most valuable
 * single field in the console for both sides: they learn which of their
 * channels actually produces work, and we learn — honestly, from their own
 * hand — how much of the market Ciao is winning.
 */
export const JOB_SOURCES = [
  "ciao",
  "whatsapp",
  "phone",
  "walk_in",
  "instagram",
  "facebook",
  "repeat",
  "direct",
  "other",
] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export const JOB_KINDS = [
  "stay",
  "day_use",
  "event",
  "session",
  "appointment",
  "visit",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = [
  "enquiry",
  "quoted",
  "confirmed",
  "done",
  "cancelled",
  "no_show",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * A job in one of these states is really happening, so it holds the day
 * against anything else being sold into it. An enquiry does not: a partner
 * jotting down "someone asked about the 14th" must not lose the 14th, or they
 * will stop jotting things down.
 */
export const OCCUPYING_JOB_STATUSES: JobStatus[] = ["confirmed", "done"];

export function jobOccupies(status: string): boolean {
  return (OCCUPYING_JOB_STATUSES as string[]).includes(status);
}

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

// ---------------------------------------------------------------- team roles
export type PartnerRole = "owner" | "manager" | "staff";

/**
 * The permission model, written once.
 *
 * Deliberately coarse — three roles, five capabilities. A permission system
 * with twenty checkboxes is one nobody configures correctly, and the failure
 * mode of a misconfigured permission is that a member of staff can move money.
 *
 *  - `diary`   — see and edit jobs, the calendar and quotes.
 *  - `clients` — the customer book as a whole (staff still see the contact
 *                details of the job in front of them; that is the job).
 *  - `money`   — earnings, payouts, what is owed.
 *  - `settings`— pricing, availability rules, the business profile.
 *  - `admin`   — the team, the payout destination, the subscription. Owner
 *                only, always: these three are how an account gets taken over.
 */
export type PartnerCapability = "diary" | "clients" | "money" | "settings" | "admin";

const CAPABILITIES: Record<PartnerRole, PartnerCapability[]> = {
  owner: ["diary", "clients", "money", "settings", "admin"],
  manager: ["diary", "clients", "money", "settings"],
  staff: ["diary"],
};

export function partnerCan(role: PartnerRole, capability: PartnerCapability): boolean {
  return CAPABILITIES[role]?.includes(capability) ?? false;
}

export function capabilitiesFor(role: PartnerRole): PartnerCapability[] {
  return CAPABILITIES[role] ?? [];
}

// ---------------------------------------------------------------- Ciao Plus
export type PartnerPlan = "free" | "plus";
export type SubscriptionStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled";

/**
 * Whether the market intelligence is unlocked right now.
 *
 * `past_due` still reads as entitled on purpose. The fee is netted from
 * payouts, so "past due" here means we have not yet had a payout to net it
 * from — which happens to precisely the partner having a quiet month, and
 * switching off their market data at the moment demand dropped is both cruel
 * and stupid. Collection is a separate problem from entitlement.
 */
export function plusActive(sub: {
  plan?: string | null;
  status?: string | null;
  trialEndsAt?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
} | null | undefined): boolean {
  if (!sub || sub.plan !== "plus") return false;
  const now = Date.now();
  if (sub.status === "trialing") {
    const ends = sub.trialEndsAt ? new Date(sub.trialEndsAt).getTime() : 0;
    return ends > now;
  }
  if (sub.status === "active" || sub.status === "past_due") {
    // No period end recorded yet (just started) counts as entitled.
    if (!sub.currentPeriodEnd) return true;
    return new Date(sub.currentPeriodEnd).getTime() > now;
  }
  return false;
}

// ---------------------------------------------------------------- job dates
/**
 * The days a job occupies, inclusive of `endDay`.
 *
 * Note the difference from `datesBetween` on the booking side, which is
 * check-in..check-out *exclusive* because a stay's last night is the night
 * before check-out. A job is described the way a partner describes it — "the
 * wedding is on the 14th", "I have them from the 3rd to the 5th" — and the 5th
 * is a day they are working. Getting this wrong in either direction produces
 * an off-by-one in the calendar, which is the one bug a booking system may
 * never have.
 */
export function jobDays(day: string, endDay?: string | null): string[] {
  const days: string[] = [];
  const start = new Date(`${day}T00:00:00Z`);
  const end = new Date(`${endDay || day}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [day];
  if (end < start) return [day];
  const cursor = new Date(start);
  // A runaway range would write thousands of calendar rows; a year is already
  // far past anything real.
  for (let i = 0; cursor <= end && i < 366; i++) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** What a partner is still owed on a job. Never negative — an overpayment is a credit conversation, not a negative balance. */
export function balanceDue(price: number, amountPaid: number): number {
  return Math.max(0, price - amountPaid);
}
