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

// ═══════════════════════════════ The catalogue ═══════════════════════════════
/**
 * What a partner sells, and how it is priced.
 *
 * These live in `shared` for the same reason the capability matrix does: the
 * partner console, the marketplace and the API all have to agree on what a
 * price is. Three implementations of "what does two nights plus a barbecue
 * cost" is three different numbers on three different screens, and the one the
 * customer remembers is whichever was lowest.
 */

/**
 * The unit a service is priced in.
 *
 * Six, deliberately, and deliberately not extensible by configuration. Each
 * one changes both the arithmetic and the sentence the customer reads; a
 * seventh added carelessly is a unit the engine cannot multiply and the
 * booking form cannot label.
 */
export const SERVICE_UNITS = ["night", "day", "session", "hour", "person", "item"] as const;
export type ServiceUnit = (typeof SERVICE_UNITS)[number];

/** Whether the customer picks a quantity, or the dates imply it. */
export function unitIsCounted(unit: ServiceUnit): boolean {
  return unit === "hour" || unit === "person" || unit === "item" || unit === "session";
}

/** Whether a head count is meaningful for this unit. */
export function unitUsesGuests(unit: ServiceUnit): boolean {
  return unit === "person";
}

export const ADDON_PRICE_MODELS = ["flat", "per_unit", "per_person", "per_km"] as const;
export type AddonPriceModel = (typeof ADDON_PRICE_MODELS)[number];

export const PRICE_RULE_KINDS = ["season", "weekday", "lead_time", "duration"] as const;
export type PriceRuleKind = (typeof PRICE_RULE_KINDS)[number];

export const PROMOTION_KINDS = ["percent", "fixed", "free_addon"] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export const EXPENSE_CATEGORIES = [
  "staff",
  "supplies",
  "fuel",
  "maintenance",
  "marketing",
  "rent",
  "transport",
  "fees",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const INTAKE_FIELD_TYPES = ["text", "number", "choice", "boolean", "date", "phone"] as const;
export type IntakeFieldType = (typeof INTAKE_FIELD_TYPES)[number];

// ───────────────────────────────── pricing ──────────────────────────────────
export interface PricedService {
  id: string;
  unit: string;
  basePrice: number;
  minUnits: number;
  maxUnits?: number | null;
}

export interface PricedAddonChoice {
  id: string;
  nameAr: string;
  price: number;
  priceModel: string;
  qty: number;
}

export interface PriceRule {
  id: string;
  kind: string;
  labelAr: string;
  fromDay?: string | null;
  toDay?: string | null;
  weekdays?: number[] | null;
  minLeadDays?: number | null;
  maxLeadDays?: number | null;
  minUnits?: number | null;
  adjustBps: number;
  adjustFlat: number;
  priority: number;
  serviceId?: string | null;
}

export interface PriceInput {
  service: PricedService;
  /** How many nights/hours/heads/items. Clamped to the service's bounds. */
  units: number;
  guests?: number;
  /** Distance in km, for a per_km travel add-on. */
  km?: number;
  /** The day the work happens — the day rules are evaluated against. */
  day?: string | null;
  /** Days between now and `day`, for lead-time rules. */
  leadDays?: number | null;
  addons?: PricedAddonChoice[];
  rules?: PriceRule[];
}

export interface PriceLine {
  labelAr: string;
  /** base | rule | addon | discount */
  kind: "base" | "rule" | "addon" | "discount";
  qty?: number;
  amount: number;
}

export interface PriceBreakdown {
  units: number;
  base: number;
  rulesTotal: number;
  addonsTotal: number;
  subtotal: number;
  lines: PriceLine[];
  appliedRuleIds: string[];
}

const isoWeekday = (day: string): number => {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0=Sun
  return d === 0 ? 7 : d;
};

function ruleApplies(rule: PriceRule, input: PriceInput, units: number): boolean {
  if (rule.serviceId && rule.serviceId !== input.service.id) return false;
  switch (rule.kind) {
    case "season": {
      if (!input.day) return false;
      if (rule.fromDay && input.day < rule.fromDay) return false;
      if (rule.toDay && input.day > rule.toDay) return false;
      return Boolean(rule.fromDay || rule.toDay);
    }
    case "weekday": {
      if (!input.day) return false;
      const days = rule.weekdays ?? [];
      return days.length > 0 && days.includes(isoWeekday(input.day));
    }
    case "lead_time": {
      const lead = input.leadDays;
      if (lead === null || lead === undefined) return false;
      if (rule.minLeadDays !== null && rule.minLeadDays !== undefined && lead < rule.minLeadDays)
        return false;
      if (rule.maxLeadDays !== null && rule.maxLeadDays !== undefined && lead > rule.maxLeadDays)
        return false;
      return true;
    }
    case "duration":
      return units >= (rule.minUnits ?? Number.POSITIVE_INFINITY);
    default:
      return false;
  }
}

/**
 * Price a selection, showing its work.
 *
 * Returns lines rather than a number on purpose. A partner quoting 1,450
 * dinars needs to be able to say *why* — "two nights, plus the August rate,
 * plus the barbecue" — because the follow-up question in this market is always
 * "why is it more than last time", and a console that cannot answer it sends
 * them back to arguing on WhatsApp.
 *
 * Rules stack multiplicatively on the base and their flat parts add after, in
 * `priority` order. Multiplicative because that is how the market talks
 * ("August is twenty percent more"), and ordered because two rules that both
 * apply must produce one answer, always the same one.
 */
export function priceSelection(input: PriceInput): PriceBreakdown {
  const { service } = input;
  const min = Math.max(1, service.minUnits || 1);
  const max = service.maxUnits && service.maxUnits > 0 ? service.maxUnits : Number.MAX_SAFE_INTEGER;
  const units = Math.min(Math.max(Math.floor(input.units) || min, min), max);
  const guests = Math.max(1, Math.floor(input.guests ?? 1) || 1);

  const lines: PriceLine[] = [];
  const base = service.basePrice * units;
  lines.push({ labelAr: "الأساس", kind: "base", qty: units, amount: base });

  const rules = [...(input.rules ?? [])]
    .filter((r) => ruleApplies(r, input, units))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  let running = base;
  const appliedRuleIds: string[] = [];
  for (const rule of rules) {
    const before = running;
    // Round once per rule rather than at the end: a partner reading the lines
    // must be able to add them up by hand and reach the total. Fractions
    // hidden between steps are how a receipt stops being checkable.
    running = Math.round((running * (rule.adjustBps || 10000)) / 10000) + (rule.adjustFlat || 0);
    const delta = running - before;
    if (delta !== 0) {
      lines.push({ labelAr: rule.labelAr, kind: "rule", amount: delta });
      appliedRuleIds.push(rule.id);
    }
  }
  const rulesTotal = running - base;

  let addonsTotal = 0;
  for (const a of input.addons ?? []) {
    const qty = Math.max(0, Math.floor(a.qty) || 0);
    if (qty === 0) continue;
    const multiplier =
      a.priceModel === "per_unit"
        ? units
        : a.priceModel === "per_person"
          ? guests
          : a.priceModel === "per_km"
            ? Math.max(0, Math.round(input.km ?? 0))
            : 1;
    const amount = a.price * qty * multiplier;
    if (amount === 0) continue;
    addonsTotal += amount;
    lines.push({ labelAr: a.nameAr, kind: "addon", qty: qty * multiplier, amount });
  }

  return {
    units,
    base,
    rulesTotal,
    addonsTotal,
    subtotal: running + addonsTotal,
    lines,
    appliedRuleIds,
  };
}

// ──────────────────────────────── promotions ────────────────────────────────
export interface Promotion {
  id: string;
  code?: string | null;
  labelAr: string;
  kind: string;
  valueBps: number;
  valueFlat: number;
  maxDiscount?: number | null;
  minSpend: number;
  serviceIds?: string[] | null;
  fromDay?: string | null;
  toDay?: string | null;
  travelFromDay?: string | null;
  travelToDay?: string | null;
  maxRedemptions: number;
  maxPerClient: number;
  redemptions: number;
  firstTimeOnly: boolean;
  active: boolean;
  freeAddonId?: string | null;
}

export interface PromotionContext {
  subtotal: number;
  serviceId?: string | null;
  /** The day the work happens. */
  travelDay?: string | null;
  /** Today, for the redemption window. */
  today: string;
  /** How many times this client has already used this promotion. */
  clientRedemptions?: number;
  /** Whether this is the client's first job with the partner. */
  isFirstTime?: boolean;
  /** Add-ons in the selection, so a free-add-on offer can find its target. */
  addons?: PricedAddonChoice[];
}

export type PromotionRefusal =
  | "inactive"
  | "not_started"
  | "expired"
  | "wrong_dates"
  | "wrong_service"
  | "below_min_spend"
  | "exhausted"
  | "already_used"
  | "not_first_time"
  | "addon_not_selected";

/**
 * Why a promotion did not apply, or how much it takes off.
 *
 * Refusals are named rather than boolean because the partner is the one who
 * has to explain it to a customer standing in front of them. "The code is
 * invalid" starts an argument; "this offer is for stays in September" ends
 * one. Every refusal here maps to a sentence in both languages on the console.
 */
export function evaluatePromotion(
  promo: Promotion,
  ctx: PromotionContext,
): { ok: true; discount: number; freeAddonId?: string | null } | { ok: false; reason: PromotionRefusal } {
  if (!promo.active) return { ok: false, reason: "inactive" };
  if (promo.fromDay && ctx.today < promo.fromDay) return { ok: false, reason: "not_started" };
  if (promo.toDay && ctx.today > promo.toDay) return { ok: false, reason: "expired" };

  if (promo.travelFromDay || promo.travelToDay) {
    const day = ctx.travelDay;
    if (!day) return { ok: false, reason: "wrong_dates" };
    if (promo.travelFromDay && day < promo.travelFromDay) return { ok: false, reason: "wrong_dates" };
    if (promo.travelToDay && day > promo.travelToDay) return { ok: false, reason: "wrong_dates" };
  }

  const scoped = promo.serviceIds ?? [];
  if (scoped.length > 0 && (!ctx.serviceId || !scoped.includes(ctx.serviceId)))
    return { ok: false, reason: "wrong_service" };

  if (ctx.subtotal < promo.minSpend) return { ok: false, reason: "below_min_spend" };
  if (promo.maxRedemptions > 0 && promo.redemptions >= promo.maxRedemptions)
    return { ok: false, reason: "exhausted" };
  if (promo.maxPerClient > 0 && (ctx.clientRedemptions ?? 0) >= promo.maxPerClient)
    return { ok: false, reason: "already_used" };
  if (promo.firstTimeOnly && ctx.isFirstTime === false) return { ok: false, reason: "not_first_time" };

  if (promo.kind === "free_addon") {
    const target = (ctx.addons ?? []).find((a) => a.id === promo.freeAddonId);
    if (!target) return { ok: false, reason: "addon_not_selected" };
    return { ok: true, discount: Math.min(target.price, ctx.subtotal), freeAddonId: promo.freeAddonId };
  }

  const raw =
    promo.kind === "percent"
      ? Math.round((ctx.subtotal * (promo.valueBps || 0)) / 10000)
      : promo.valueFlat || 0;
  const capped = promo.maxDiscount && promo.maxDiscount > 0 ? Math.min(raw, promo.maxDiscount) : raw;
  // Never more than the price. A discount that exceeds the total is a refund
  // the partner did not agree to fund.
  return { ok: true, discount: Math.max(0, Math.min(capped, ctx.subtotal)) };
}

// ───────────────────────────── Ciao Plus, annual ────────────────────────────
export type SubscriptionTerm = "monthly" | "annual";

/**
 * What a year costs.
 *
 * Two months free is not a rounding of twelve — it is the price of asking
 * somebody to part with a year's fee in one payment in a cash economy, and it
 * has to be visible enough to be the obvious choice. The discount is expressed
 * as months rather than a percentage because that is how the offer will be
 * explained out loud: "pay for ten, get twelve".
 */
export const ANNUAL_MONTHS_CHARGED = 10;

export function annualPrice(monthlyDirhams: number): number {
  return monthlyDirhams * ANNUAL_MONTHS_CHARGED;
}

export function annualSavings(monthlyDirhams: number): number {
  return monthlyDirhams * (12 - ANNUAL_MONTHS_CHARGED);
}

/** Days left on a period, floored at zero. Null when there is no period. */
export function daysRemaining(end?: Date | string | null, from: Date = new Date()): number | null {
  if (!end) return null;
  const ms = new Date(end).getTime() - from.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/**
 * When to nudge about renewal.
 *
 * Thirty days is enough to arrange a payment in a country where that can mean
 * a trip to an office; seven and one are the human reminders. Nothing after
 * expiry, because a partner whose year has lapsed gets a different, quieter
 * message — chasing somebody who has decided not to renew is how a product
 * gets muted.
 */
export const RENEWAL_NOTICE_DAYS = [30, 7, 1] as const;
