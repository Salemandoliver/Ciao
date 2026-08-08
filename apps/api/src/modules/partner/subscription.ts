/**
 * Ciao Plus — sold by the year, because that is what this market can pay.
 *
 * The line between free and paid is unchanged and deliberate: **your own
 * numbers are always free; the market costs money.** A partner never pays to
 * see what they earned or who owes them — charging for that would make the
 * console a hostage situation and send them back to the notebook. What Plus
 * sells is the thing they cannot get anywhere else: what everyone *else* is
 * charging, when demand actually peaks, and how their prices compare.
 *
 * The commercial shape is set by a fact about Libya rather than by convention.
 * There is no direct debit and recurring card billing does not meaningfully
 * exist, so a monthly subscription is a monthly collections problem — twelve
 * chances a year to lose a customer to a failed charge nobody could have
 * fixed. So there are exactly two ways to pay:
 *
 *  - **Netted from payouts.** Works for a partner with steady Ciao volume, and
 *    needs no payment rail at all.
 *  - **A year, up front, once.** Ten months' price for twelve. This is the one
 *    that reaches the partner whose book is mostly direct work — who is
 *    precisely the partner market data is worth most to, and who has almost no
 *    payouts to net against.
 *
 * Entitlement and collection are kept separate throughout. `past_due` still
 * reads as entitled (see `plusActive`), and an annual term that lapses degrades
 * to free rather than locking anyone out of their own diary.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  ANNUAL_MONTHS_CHARGED,
  RENEWAL_NOTICE_DAYS,
  annualPrice,
  annualSavings,
  daysRemaining,
  plusActive,
  type SubscriptionTerm,
} from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { getSetting } from "../business/settings.js";
import { getProvider } from "../payments/registry.js";
import { config } from "../../config.js";
import { track } from "../intelligence/events.js";
import { notify } from "../messaging/service.js";

const DAY_MS = 86_400_000;

export interface PlanOffer {
  enabled: boolean;
  monthlyDirhams: number;
  annualDirhams: number;
  savingsDirhams: number;
  monthsCharged: number;
  trialDays: number;
}

/** What Plus costs today, read from the control plane rather than the code. */
export async function planOffer(): Promise<PlanOffer> {
  const [enabled, monthly, trialDays] = await Promise.all([
    getSetting("partner.plusEnabled"),
    getSetting("partner.plusPriceDirhams"),
    getSetting("partner.plusTrialDays"),
  ]);
  const monthlyDirhams = Number(monthly) || 0;
  return {
    enabled: Boolean(enabled),
    monthlyDirhams,
    annualDirhams: annualPrice(monthlyDirhams),
    savingsDirhams: annualSavings(monthlyDirhams),
    monthsCharged: ANNUAL_MONTHS_CHARGED,
    trialDays: Number(trialDays) || 0,
  };
}

export async function getSubscription(partnerId: string) {
  const [row] = await db
    .select()
    .from(schema.partnerSubscriptions)
    .where(eq(schema.partnerSubscriptions.partnerId, partnerId))
    .limit(1);
  return row ?? null;
}

export interface SubscriptionView {
  plan: string;
  status: string;
  term: string;
  settlement: string;
  active: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  daysLeft: number | null;
  /** True in the last month of an annual term — the console starts nudging. */
  renewingSoon: boolean;
  priceDirhams: number;
  offer: PlanOffer;
}

export async function subscriptionView(partnerId: string): Promise<SubscriptionView> {
  const [sub, offer] = await Promise.all([getSubscription(partnerId), planOffer()]);
  const active = plusActive(sub);
  const end = sub?.status === "trialing" ? sub.trialEndsAt : (sub?.currentPeriodEnd ?? null);
  const daysLeft = daysRemaining(end);
  return {
    plan: sub?.plan ?? "free",
    status: sub?.status ?? "none",
    term: sub?.term ?? "monthly",
    settlement: sub?.settlement ?? "payout_netting",
    active,
    trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    daysLeft,
    renewingSoon: active && daysLeft !== null && daysLeft <= 30,
    priceDirhams: sub?.priceDirhams ?? 0,
    offer,
  };
}

/**
 * Start the free season.
 *
 * Once per partner, ever — `trialEndsAt` being already set is the guard, not a
 * separate flag, because a partner who cancels and re-subscribes must not get
 * another six months. Deliberately idempotent: a double-tap on "start" is a
 * bad connection, not a request for two trials.
 */
export async function startTrial(partnerId: string) {
  const offer = await planOffer();
  if (!offer.enabled) throw new CiaoError("VALIDATION", { field: "plus", reason: "disabled" });
  const existing = await getSubscription(partnerId);
  if (existing?.trialEndsAt) return existing;

  const trialEndsAt = new Date(Date.now() + offer.trialDays * DAY_MS);
  const values = {
    partnerId,
    plan: "plus",
    status: "trialing",
    term: "monthly" as const,
    trialEndsAt,
    priceDirhams: offer.monthlyDirhams,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(schema.partnerSubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: schema.partnerSubscriptions.partnerId, set: values })
    .returning();
  void track("partner.plus_started", { trial: true, priceDirhams: offer.monthlyDirhams });
  return row!;
}

// ═══════════════════════════ buying a year, up front ════════════════════════

export interface CheckoutResult {
  intentId: string;
  invoiceNo: string;
  amount: number;
  rail: string;
  kind: "redirect" | "otp_confirm" | "instant";
  redirectUrl?: string;
  otpRequestId?: string;
}

/**
 * Take payment for a year of Plus.
 *
 * Reuses the booking payment pipeline wholesale — same providers, same
 * `payment_intents` table, same webhook, same replay protection. A second
 * payment path would be a second place to look when money goes missing and a
 * second chance to get idempotency subtly wrong, and this is a market where
 * rails fail often enough that the difference matters.
 *
 * The intent carries `purpose: "subscription"` and no booking. Everything
 * downstream routes on that.
 */
export async function startAnnualCheckout(
  partnerId: string,
  opts: { rail: string; phone: string; returnUrl?: string },
): Promise<CheckoutResult> {
  const offer = await planOffer();
  if (!offer.enabled) throw new CiaoError("VALIDATION", { field: "plus", reason: "disabled" });
  if (offer.annualDirhams <= 0)
    throw new CiaoError("VALIDATION", { field: "plus", reason: "no_price" });

  /*
   * Refuse to sell a year to somebody who already has most of one.
   *
   * Not a technical limit — the money would take fine, and it would be the
   * kind of "technically they clicked it" revenue that produces a refund
   * request and a story about how Ciao charged twice. Renewal inside the last
   * month is allowed and extends from the existing end date.
   */
  const current = await getSubscription(partnerId);
  if (plusActive(current) && current?.term === "annual") {
    const left = daysRemaining(current.currentPeriodEnd) ?? 0;
    if (left > 31) throw new CiaoError("VALIDATION", { field: "plus", reason: "already_active" });
  }

  const invoiceNo = `PLUS-${partnerId.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
  const provider = getProvider(config.paymentProvider);
  const [intent] = await db
    .insert(schema.paymentIntents)
    .values({
      bookingId: null,
      subjectId: partnerId,
      purpose: "subscription",
      amount: offer.annualDirhams,
      rail: opts.rail,
      provider: provider.name,
      invoiceNo,
      status: "created",
    })
    .returning();

  const result = await provider.initiate({
    invoiceNo,
    amount: offer.annualDirhams,
    rail: opts.rail as never,
    customerPhone: opts.phone,
    returnUrl: opts.returnUrl ?? `${config.partnerBaseUrl}/?tab=plus&paid=1`,
    metadata: { purpose: "subscription", partnerId },
  });

  await db
    .update(schema.paymentIntents)
    .set({ status: "pending", providerRef: result.providerRef, updatedAt: new Date() })
    .where(eq(schema.paymentIntents.id, intent!.id));

  void track("partner.plus_checkout_started", {
    term: "annual",
    priceDirhams: offer.annualDirhams,
  });

  return {
    intentId: intent!.id,
    invoiceNo,
    amount: offer.annualDirhams,
    rail: opts.rail,
    kind: result.kind,
    redirectUrl: result.redirectUrl,
    otpRequestId: result.otpRequestId,
  };
}

/**
 * The money arrived. Grant the year.
 *
 * Called from the payments webhook, so it must be idempotent against replays —
 * the guard is the intent's own status, which the caller has already moved to
 * `captured` exactly once thanks to the webhook journal.
 *
 * A renewal extends from the *existing* end date rather than from today. A
 * partner who pays a week early must not lose that week; getting this backwards
 * is a small theft that a customer notices and never forgets.
 */
export async function grantAnnualTerm(intentId: string): Promise<void> {
  const [intent] = await db
    .select()
    .from(schema.paymentIntents)
    .where(eq(schema.paymentIntents.id, intentId))
    .limit(1);
  if (!intent?.subjectId || intent.purpose !== "subscription") return;

  /*
   * Grant once per payment, whatever the rail does.
   *
   * The webhook journal stops a byte-identical replay, but it keys on the
   * provider's event id — a re-delivery under a new id, or a retry that also
   * reaches the OTP-confirm path, would arrive here twice. Since a renewal
   * deliberately extends from `currentPeriodEnd` rather than from today, a
   * second grant would silently hand out a second year for one payment.
   *
   * The subscription's own `paymentId` is the guard: it records which payment
   * bought the current term, so seeing our own id there means this work is
   * already done.
   */
  const existing = await getSubscription(intent.subjectId);
  if (existing?.paymentId === intent.id) return;

  const partnerId = intent.subjectId;
  const current = await getSubscription(partnerId);
  const now = new Date();
  const base =
    current?.currentPeriodEnd && current.currentPeriodEnd > now ? current.currentPeriodEnd : now;
  const end = new Date(base);
  end.setUTCFullYear(end.getUTCFullYear() + 1);

  const values = {
    partnerId,
    plan: "plus",
    status: "active",
    term: "annual",
    settlement: "annual_upfront",
    currentPeriodStart: now,
    currentPeriodEnd: end,
    priceDirhams: intent.amount,
    paymentId: intent.id,
    // A fresh period gets a fresh reminder slate, or the partner who renews
    // early is told "your subscription expires in 7 days" about a year hence.
    renewalNoticesSent: [],
    cancelledAt: null,
    updatedAt: now,
  };
  await db
    .insert(schema.partnerSubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: schema.partnerSubscriptions.partnerId, set: values });

  void track("partner.plus_purchased", {
    term: "annual",
    priceDirhams: intent.amount,
    rail: intent.rail,
  });

  const [owner] = await db
    .select({ phone: schema.users.phone, locale: schema.users.locale })
    .from(schema.users)
    .where(eq(schema.users.id, partnerId))
    .limit(1);
  if (owner) {
    await notify({
      templateKey: "partner_plus_activated",
      toPhone: owner.phone,
      toUserId: partnerId,
      locale: owner.locale === "en" ? "en" : "ar",
      vars: { until: end.toISOString().slice(0, 10) },
    }).catch(() => undefined);
  }
}

export async function cancelSubscription(partnerId: string) {
  const sub = await getSubscription(partnerId);
  if (!sub) return null;
  const daysActive = sub.currentPeriodStart
    ? Math.round((Date.now() - sub.currentPeriodStart.getTime()) / DAY_MS)
    : 0;
  /*
   * Cancelling stops the *renewal*, it does not claw back the term. Somebody
   * who paid for a year and changes their mind in month three keeps months
   * four to twelve — anything else is taking money for a service withdrawn,
   * and the word for that gets around a market this size in a week.
   */
  const [row] = await db
    .update(schema.partnerSubscriptions)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.partnerSubscriptions.partnerId, partnerId))
    .returning();
  void track("partner.plus_cancelled", { daysActive });
  return row ?? null;
}

// ══════════════════════════════ renewal reminders ═══════════════════════════

/**
 * Nudge partners whose year is running out.
 *
 * Run daily by the worker. Three notices — thirty days, seven, one — recorded
 * per period so a re-run cannot send the same one twice. Thirty days because
 * arranging a payment here can mean a trip to an office; nothing after expiry,
 * because chasing somebody who has decided not to renew is how a product gets
 * muted, and a lapsed partner still has their whole diary.
 */
export async function sendRenewalNotices(): Promise<{ sent: number }> {
  const rows = await db
    .select()
    .from(schema.partnerSubscriptions)
    .where(
      and(
        eq(schema.partnerSubscriptions.term, "annual"),
        eq(schema.partnerSubscriptions.status, "active"),
        eq(schema.partnerSubscriptions.renewalRemindersOff, false),
        sql`${schema.partnerSubscriptions.currentPeriodEnd} > now()`,
        sql`${schema.partnerSubscriptions.currentPeriodEnd} < now() + interval '31 days'`,
      ),
    );

  let sent = 0;
  for (const sub of rows) {
    const left = daysRemaining(sub.currentPeriodEnd);
    if (left === null) continue;
    const due = RENEWAL_NOTICE_DAYS.find((d) => left <= d);
    if (due === undefined) continue;
    const already = (sub.renewalNoticesSent as string[]) ?? [];
    if (already.includes(String(due))) continue;

    const [owner] = await db
      .select({ phone: schema.users.phone, locale: schema.users.locale })
      .from(schema.users)
      .where(eq(schema.users.id, sub.partnerId))
      .limit(1);
    if (!owner) continue;
    await notify({
      templateKey: "partner_plus_renewal",
      toPhone: owner.phone,
      toUserId: sub.partnerId,
      locale: owner.locale === "en" ? "en" : "ar",
      vars: { days: String(left), until: sub.currentPeriodEnd!.toISOString().slice(0, 10) },
    }).catch(() => undefined);

    await db
      .update(schema.partnerSubscriptions)
      .set({ renewalNoticesSent: [...already, String(due)], updatedAt: new Date() })
      .where(eq(schema.partnerSubscriptions.partnerId, sub.partnerId));
    void track("partner.plus_renewal_notice", { daysLeft: left });
    sent++;
  }
  return { sent };
}

/**
 * Expire terms that have run out.
 *
 * Sets `status` rather than deleting, so the console can say "your year ended
 * on the 3rd of March" instead of silently hiding the market panels and
 * leaving the partner to wonder what broke. A silent downgrade is the version
 * that generates a support call.
 */
export async function expireLapsedSubscriptions(): Promise<{ expired: number }> {
  const rows = await db
    .update(schema.partnerSubscriptions)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(
      and(
        eq(schema.partnerSubscriptions.status, "active"),
        sql`${schema.partnerSubscriptions.currentPeriodEnd} is not null`,
        sql`${schema.partnerSubscriptions.currentPeriodEnd} < now()`,
      ),
    )
    .returning({ partnerId: schema.partnerSubscriptions.partnerId });
  return { expired: rows.length };
}
