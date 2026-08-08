/**
 * Booking orchestration — §6.1 happy path + §6.4 failure journeys.
 */
import { eq } from "drizzle-orm";
import {
  CONFIRMATION_WINDOW_MINUTES,
  FEES,
  lyd,
  quoteStay,
  refundFraction,
  type CancellationTier,
} from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { effectiveFees, getSetting } from "../business/settings.js";
import { bookingCode, invoiceNo } from "../../lib/ids.js";
import { signActionToken } from "../../lib/auth.js";
import { config } from "../../config.js";
import { transition, scheduleJob, type BookingRow } from "./machine.js";
import * as calendar from "../calendar/service.js";
import * as ledger from "../payments/ledger.js";
import { getProvider, railIsHealthy } from "../payments/registry.js";
import { notify } from "../messaging/service.js";
import type { PaymentRail } from "@ciao/shared";
import { track } from "../intelligence/events.js";
import { priceExtras } from "./extras.js";
import { loadPricingConfig } from "../listings/pricing-config.js";
import { confirmationDeadline, parseOfficeHours } from "./office-hours.js";

// ------------------------------------------------------------------ request
export interface CreateStayRequestInput {
  listingId: string;
  guestId: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string;
  guestCount?: number;
  /** Who is coming. Ages, because the ages decide the price. */
  adults?: number;
  childAges?: number[];
  extraBeds?: number;
  /** Requirement keys the guest ticked before paying. */
  acceptedRequirements?: string[];
  /** Where they came from: fb | wa | ig | qr | direct. */
  source?: string;
  rail: PaymentRail;
  sadad?: { mobile: string; birthYear: string };
  concierge?: boolean;
  /** Optional promo code, validated and capped at our commission. */
  promoCode?: string;
  /**
   * The partner's own catalogue, layered on top of the stay.
   *
   * Extras are the half of a Libyan booking that is currently negotiated over
   * WhatsApp and forgotten by the time anyone invoices: the barbecue, the
   * extra mattress, late checkout. Their money, not ours — see the pricing
   * block below for why the two discounts never get netted into one number.
   */
  addons?: { addonId: string; qty: number }[];
  /** Answers to the partner's own intake questions, snapshotted onto the booking. */
  intake?: { questionId: string; answer: string }[];
  /** A code from the partner's own offers — distinct from `promoCode`. */
  partnerPromoCode?: string;
}

export async function createStayRequest(input: CreateStayRequestInput) {
  // Operator kill switch. Turning bookings off keeps the marketplace browsable
  // — a guest can still look, wishlist, and read reviews — while stopping us
  // from taking money we can't currently service (rail outage, holiday, a
  // supply problem). Concierge bookings still go through, because that path is
  // a human on the phone who already knows the situation.
  if (!input.concierge && !(await getSetting("ops.acceptingBookings")))
    throw new CiaoError("VALIDATION", "bookings_paused");

  const [listing] = await db
    .select()
    .from(schema.listings)
    .where(eq(schema.listings.id, input.listingId))
    .limit(1);
  if (!listing || listing.status !== "live") throw new CiaoError("BOOKING_NOT_FOUND");
  const [venue] = await db
    .select()
    .from(schema.venues)
    .where(eq(schema.venues.id, listing.venueId))
    .limit(1);
  if (!venue) throw new CiaoError("BOOKING_NOT_FOUND");

  // Commercial terms come from the control plane, so a rate change in the
  // business console applies to the next booking — not the next deploy.
  const fees = await effectiveFees();

  /*
   * The party, defaulted from `guestCount` for callers that predate it.
   *
   * Concierge bookings taken over the phone still arrive with a head count and
   * no ages, and refusing those would break the one booking path that works
   * today. A head count with no ages prices as adults, which is the
   * conservative reading and the one the operator on the phone can correct.
   */
  const party =
    input.adults != null
      ? {
          adults: input.adults,
          childAges: input.childAges ?? [],
          extraBeds: input.extraBeds ?? 0,
        }
      : input.guestCount
        ? { adults: input.guestCount, childAges: [], extraBeds: input.extraBeds ?? 0 }
        : undefined;

  const heads = party ? party.adults + (party.childAges?.length ?? 0) : (input.guestCount ?? 0);
  /*
   * Capacity, enforced. It never was: `maxGuests` was a search filter and a
   * line on the listing page, and `createStayRequest` never compared anything
   * to it. A nine-person booking of a six-person villa is a family turned away
   * at the gate — the failure this whole release is about.
   */
  if (listing.maxGuests && heads > listing.maxGuests)
    throw new CiaoError("VALIDATION", "over_capacity");

  const quote = quoteStay(
    await loadPricingConfig(listing, input.checkIn, input.checkOut),
    new Date(`${input.checkIn}T00:00:00Z`),
    new Date(`${input.checkOut}T00:00:00Z`),
    { party, foundingHost: venue.foundingHost, fees },
  );
  if (quote.nights.length === 0) throw new CiaoError("VALIDATION", "empty stay");
  if (quote.nights.length < quote.requiredMinNights)
    throw new CiaoError("VALIDATION", `min_nights_${quote.requiredMinNights}`);

  /*
   * Conditions of entry, checked before money moves.
   *
   * `mustAcknowledge` requirements are the ones where not knowing costs the
   * guest a wasted journey — proof of family status at a Sabratha gate is the
   * case that prompted this. The server checks rather than trusting the form,
   * because the form is the thing an off-platform integration will skip.
   */
  const required = (listing.requirements as { key: string; mustAcknowledge?: boolean }[] | null) ?? [];
  const mustTick = required.filter((r) => r.mustAcknowledge).map((r) => r.key);
  const ticked = new Set(input.acceptedRequirements ?? []);
  const missing = mustTick.filter((k) => !ticked.has(k));
  if (missing.length > 0 && !input.concierge)
    throw new CiaoError("VALIDATION", `requirements_not_accepted:${missing.join(",")}`);

  /**
   * Promo codes come out of our commission, never the host's share. The
   * discount reduces what the guest pays and what we earn; the host's money is
   * untouched, because it was promised to them and a marketing decision is not
   * their problem. `evaluatePromo` does the capping; here we just apply it.
   */
  let discount = 0;
  let appliedPromo: Awaited<ReturnType<typeof import("../accounts/promos.js").evaluatePromo>> | null =
    null;
  if (input.promoCode) {
    const promos = await import("../accounts/promos.js");
    try {
      appliedPromo = await promos.evaluatePromo(input.promoCode, {
        userId: input.guestId,
        total: quote.total,
        commission: quote.commission,
        vertical: venue.type,
        city: venue.city,
        listingId: listing.id,
        venueId: venue.id,
      });
      discount = appliedPromo.discount;
    } catch (e) {
      // A bad code must fail the request loudly rather than silently charging
      // full price — the guest typed it for a reason.
      throw e instanceof CiaoError ? e : new CiaoError("VALIDATION", "promo_invalid");
    }
  }
  /*
   * ───────────── The partner's own extras, offers and questions ─────────────
   *
   * Two discounts exist on this booking and they must never be netted into
   * one, because they come out of different pockets. Ciao's promo code is
   * marketing spend and is capped at our commission (above); the partner's own
   * offer is their revenue and reduces what they receive. Adding them together
   * would produce a payout arithmetic that cannot be explained to the person
   * it is being explained to.
   *
   * Everything here is priced server-side against the live catalogue. The
   * client sends a selection, never a total.
   */
  const extras = await priceExtras({
    hostId: venue.hostId,
    guestId: input.guestId,
    listingId: listing.id,
    addons: input.addons ?? [],
    intake: input.intake ?? [],
    partnerPromoCode: input.partnerPromoCode,
    subtotal: quote.total,
    day: input.checkIn,
    guests: input.guestCount ?? 1,
    nights: quote.nights.length,
  });

  /*
   * ─────────────────── What each of the four numbers is ───────────────────
   *
   * These are computed in a fixed order, and the order is the correctness
   * argument. Each line may only use lines above it, so there is exactly one
   * place a new pricing rule can be inserted and exactly one thing to check
   * when it is: that the deposit still cannot exceed the total.
   *
   * ── 1. The stay, after Ciao's code ──
   *
   * `stayTotal` is the accommodation and nothing else, and it is the base
   * every figure below is a function of. Add-ons are deliberately not in it:
   * the barbecue is the host's own trade, settled with them in cash on arrival
   * the way everything else in this market is, and folding it into the base
   * would quietly start charging Ciao commission on it.
   *
   * ── 2 and 3. Commission and deposit, which depend on who funded the code ──
   *
   * A Ciao-funded code is a cut of our own commission, so the host's money is
   * untouched: the guest pays less, we earn less, the host is paid what they
   * were promised, because a marketing decision of ours is not their problem.
   *
   * A partner-funded flash offer is the venue's own price coming down. The
   * total falls, and our commission is recomputed as its normal percentage of
   * the *new* total rather than being reduced by the whole discount — which
   * would have handed the partner a discount funded by us on top of their own.
   * The deposit then floors at that commission, because a deposit that does
   * not cover what we are owed leaves us collecting from the host later.
   *
   * ── 4. The host's own offer, capped at what is actually settled with them ──
   *
   * Their offer comes out of their revenue, and their revenue arrives on
   * arrival — the deposit is Ciao's hold on the date and already carries our
   * commission. So the cap is the money still outstanding once the deposit is
   * taken, which is why it cannot be computed until the deposit is known.
   *
   * Capping it against `quote.balanceOnArrival` instead — the balance of a
   * stay nobody is being charged for any more — is wrong in exactly the case
   * where both discounts land at once: a partner-funded code on a cheap stay
   * cut the total to 28 while the cap was still measured against 40, and a
   * 50-dinar host offer then wrote a total of −4 and a balance of −6.8. The
   * `money` column is an unconstrained bigint, so it persisted, and a payout
   * run would have transferred a negative sum to a real chalet owner.
   */
  const partnerFunded = appliedPromo?.fundedBy === "partner";
  const stayTotal = quote.total - discount;
  const payableCommission = partnerFunded
    ? Math.round(
        (stayTotal *
          (venue.foundingHost ? fees.coastFoundingHostBps : fees.coastCommissionBps)) /
          10000,
      )
    : Math.max(0, quote.commission - discount);
  const payableDeposit = Math.max(
    0,
    partnerFunded
      ? Math.min(stayTotal, Math.max(quote.deposit - discount, payableCommission))
      : Math.min(stayTotal, quote.deposit - discount),
  );

  /* Everything the guest owes before the host's own offer comes off. */
  const grossTotal = stayTotal + extras.addonsTotal;
  const settledOnArrival = Math.max(0, grossTotal - payableDeposit);
  const partnerDiscount = Math.min(extras.discount, settledOnArrival);

  const payableTotal = grossTotal - partnerDiscount;
  /*
   * Derived, never asserted.
   *
   * The invoice shows three numbers and a guest adds up two of them. Writing
   * the balance independently is how they stop agreeing: a partner-funded code
   * moves the deposit to the commission floor without moving `quote`'s idea of
   * the balance, so the stored trio summed to more than the total. Subtracting
   * makes the arithmetic true by construction rather than by coincidence — and
   * because `partnerDiscount` is capped at `grossTotal - payableDeposit`, this
   * is non-negative for the same reason, not as a separate piece of luck.
   */
  const payableBalance = payableTotal - payableDeposit;

  const days = calendar.datesBetween(input.checkIn, input.checkOut);
  const code = bookingCode();
  // Hold inventory while payment completes: 30 min hold, extended on payment.
  const holdExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const booking = await db.transaction(async (tx) => {
    const [b] = await tx
      .insert(schema.bookings)
      .values({
        code,
        listingId: listing.id,
        venueId: venue.id,
        guestId: input.guestId,
        hostId: venue.hostId,
        type: "stay",
        state: "draft",
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        session: "night",
        guestCount: heads || input.guestCount,
        adults: party?.adults ?? null,
        childAges: party?.childAges ?? [],
        extraBeds: party?.extraBeds ?? 0,
        requirementsAccepted: mustTick.filter((k) => ticked.has(k)),
        requirementsAcceptedAt: mustTick.length > 0 ? new Date() : null,
        source: input.source ?? null,
        totalAmount: payableTotal,
        depositAmount: payableDeposit,
        // Extras and the partner's discount land on arrival, not on the
        // deposit: the deposit is Ciao's hold on the date and is calculated
        // from the stay, while the barbecue is settled with the host in cash
        // the way everything else in this market is.
        balanceOnArrival: payableBalance,
        commissionAmount: payableCommission,
        discountAmount: discount,
        promoCode: appliedPromo?.code ?? null,
        cancellationTier: listing.cancellationTier as CancellationTier,
        addons: extras.lines,
        intakeAnswers: extras.answers,
        partnerPromotionId: extras.promotionId,
        partnerDiscountAmount: partnerDiscount,
        concierge: input.concierge ?? false,
      })
      .returning();
    await calendar.holdDays(tx, listing.id, days, "night", b!.id, holdExpiresAt);
    await scheduleJob(tx, "hold_expiry", b!.id, holdExpiresAt);
    return b!;
  });

  if (appliedPromo) {
    const promos = await import("../accounts/promos.js");
    await promos.applyPromo(appliedPromo, input.guestId, booking.id);
  }
  if (extras.promotionId) {
    const cat = await import("../partner/catalogue.js");
    await cat.recordRedemption(extras.promotionId);
  }

  await transition({
    bookingId: booking.id,
    to: "requested",
    actor: "guest",
    actorId: input.guestId,
    idempotencyKey: `request:${booking.id}`,
  });

  track("booking.requested", {
    bookingId: booking.id,
    listingId: listing.id,
    vertical: venue.type,
    city: venue.city,
    area: venue.area,
    nights: quote.nights.length,
    total: payableTotal,
    deposit: payableDeposit,
    discount,
    guests: input.guestCount,
    rail: input.rail,
    checkIn: input.checkIn,
    leadDays: Math.max(0, Math.round(
      (new Date(`${input.checkIn}T00:00:00Z`).getTime() - Date.now()) / 86400000,
    )),
    concierge: input.concierge ?? false,
  }, { userId: input.guestId });

  // Payment intent
  const intent = await createDepositIntent(booking, input.rail, input.sadad);
  return { booking: { ...booking, state: "payment_pending" }, quote, intent };
}

export async function createDepositIntent(
  booking: BookingRow,
  rail: PaymentRail,
  sadad?: { mobile: string; birthYear: string },
) {
  if (!(await railIsHealthy(rail))) {
    // §10.8: rail down → pending-payment reservation held 6h with pay-by-link.
    await transition({
      bookingId: booking.id,
      to: "payment_pending",
      actor: "system",
      reason: "rail_down_hold",
      idempotencyKey: `paypending:${booking.id}`,
    });
    await scheduleJob(db, "hold_expiry", booking.id, new Date(Date.now() + 6 * 3600 * 1000));
    throw new CiaoError("PAYMENT_RAIL_DOWN");
  }

  const [guest] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, booking.guestId))
    .limit(1);

  const provider = getProvider();
  const attempts = await db
    .select({ id: schema.paymentIntents.id })
    .from(schema.paymentIntents)
    .where(eq(schema.paymentIntents.bookingId, booking.id));
  const inv = invoiceNo(booking.code, attempts.length + 1);

  const [intent] = await db
    .insert(schema.paymentIntents)
    .values({
      bookingId: booking.id,
      purpose: "deposit",
      amount: booking.depositAmount,
      rail,
      provider: provider.name,
      invoiceNo: inv,
      status: "created",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    })
    .returning();

  await transition({
    bookingId: booking.id,
    to: "payment_pending",
    actor: "guest",
    idempotencyKey: `paypending:${booking.id}:${inv}`,
  });

  try {
    const init = await provider.initiate({
      invoiceNo: inv,
      amount: booking.depositAmount,
      rail,
      customerPhone: guest?.phone ?? "",
      returnUrl: `${config.webBaseUrl}/booking/${booking.code}`,
      sadad,
    });
    await db
      .update(schema.paymentIntents)
      .set({ providerRef: init.providerRef, status: "pending", updatedAt: new Date() })
      .where(eq(schema.paymentIntents.id, intent!.id));
    track("payment.initiated", { bookingId: booking.id, rail, amount: booking.depositAmount }, { userId: booking.guestId });
    return { intentId: intent!.id, invoiceNo: inv, ...init };
  } catch {
    await db
      .update(schema.paymentIntents)
      .set({ status: "failed", failureCode: "INITIATE_ERROR", updatedAt: new Date() })
      .where(eq(schema.paymentIntents.id, intent!.id));
    throw new CiaoError("PAYMENT_RAIL_DOWN");
  }
}

// ------------------------------------------------------------------ payment captured
/**
 * Called from webhook/OTP-confirm when the deposit charge succeeds.
 * Local rails have no true auth-and-capture (§10.3): the charge is real; a
 * host decline is honoured through the refund ladder as our ledger obligation.
 */
export async function onDepositCaptured(intentId: string): Promise<void> {
  const [intent] = await db
    .select()
    .from(schema.paymentIntents)
    .where(eq(schema.paymentIntents.id, intentId))
    .limit(1);
  if (!intent) return;
  // Not every captured payment is a deposit any more — Ciao Plus is sold for a
  // year through the same rails and the same webhook. Returning quietly is
  // right rather than throwing: the payments service routes by purpose, and a
  // stray call here means somebody wired a new money path to the wrong
  // handler, which should be inert, not an error the customer sees.
  if (!intent.bookingId) return;

  const [booking] = await db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.id, intent.bookingId))
    .limit(1);
  if (!booking) return;

  const sameDay = isSameDay(booking.checkIn);
  const windowMinutes = sameDay
    ? CONFIRMATION_WINDOW_MINUTES.same_day
    : booking.type === "event_date"
      ? CONFIRMATION_WINDOW_MINUTES.wedding_date
      : CONFIRMATION_WINDOW_MINUTES.standard;

  /*
   * The countdown only runs while somebody could answer it.
   *
   * A resort desk that works 11:00–17:00 used to get the same flat two hours
   * as a chalet owner with a phone in his pocket, so an eight-o'clock booking
   * auto-declined at ten, refunded the guest, told them the venue had ignored
   * them, and docked the venue's reliability for being closed. Three parties
   * lost and the platform generated the failure itself. Venues with no hours
   * set — every venue that existed before this — behave exactly as before.
   */
  const [deadlineVenue] = await db
    .select({ officeHours: schema.venues.officeHours })
    .from(schema.venues)
    .where(eq(schema.venues.id, booking.venueId!))
    .limit(1);
  const hours = parseOfficeHours(deadlineVenue?.officeHours);
  const deadline = sameDay
    ? new Date(Date.now() + windowMinutes * 60 * 1000)
    : confirmationDeadline(hours, windowMinutes);

  const { applied } = await transition({
    bookingId: booking.id,
    to: "payment_held",
    actor: "system",
    reason: "deposit_captured",
    idempotencyKey: `captured:${intent.id}`,
    sideEffects: async (tx) => {
      await tx
        .update(schema.paymentIntents)
        .set({ status: "held", updatedAt: new Date() })
        .where(eq(schema.paymentIntents.id, intent.id));
      await tx.insert(schema.payments).values({
        intentId: intent.id,
        bookingId: booking.id,
        amount: intent.amount,
        rail: intent.rail,
        provider: intent.provider,
        providerRef: intent.providerRef,
      });
      await ledger.post(
        tx,
        booking.id,
        ledger.depositCapturedLines({
          provider: intent.provider,
          amount: intent.amount,
          commission: booking.commissionAmount,
        }),
      );
      await tx
        .update(schema.bookings)
        .set({ confirmationDeadline: deadline })
        .where(eq(schema.bookings.id, booking.id));
      // Extend calendar hold to cover the confirmation window.
      await tx
        .update(schema.calendarDays)
        .set({ holdExpiresAt: new Date(deadline.getTime() + 10 * 60 * 1000) })
        .where(eq(schema.calendarDays.bookingId, booking.id));
      await scheduleJob(tx, "host_confirmation_timeout", booking.id, deadline);
    },
  });
  if (!applied) return;

  track("payment.captured", { bookingId: booking.id, rail: intent.rail, amount: intent.amount }, { userId: booking.guestId });
  await pingHost(booking, windowMinutes);
}

async function pingHost(booking: BookingRow, windowMinutes: number) {
  if (!booking.hostId) return;
  const [host] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, booking.hostId))
    .limit(1);
  if (!host) return;
  const token = await signActionToken({
    scope: `host_confirm:${booking.id}`,
    userId: host.id,
    ttlSeconds: windowMinutes * 60,
  });
  const link = `${config.webBaseUrl}/h/confirm?token=${token}`;
  await notify({
    templateKey: "booking_request_host",
    toPhone: host.phone,
    toUserId: host.id,
    bookingId: booking.id,
    vars: {
      code: booking.code,
      nights: String(
        booking.checkIn && booking.checkOut
          ? calendar.datesBetween(booking.checkIn, booking.checkOut).length
          : 1,
      ),
      dates: `${booking.checkIn} → ${booking.checkOut}`,
      deposit: lyd(booking.depositAmount),
      window: windowMinutes >= 60 ? `${windowMinutes / 60} س` : `${windowMinutes} د`,
      link,
    },
  });
}

// ------------------------------------------------------------------ host confirm / decline / timeout
export async function hostConfirm(bookingId: string, actorId?: string) {
  const result = await transition({
    bookingId,
    to: "host_confirmed",
    actor: "host",
    actorId,
    expectedFrom: ["payment_held"],
    idempotencyKey: `hostconfirm:${bookingId}`,
  });
  if (!result.applied) {
    const state = result.booking.state;
    if (state === "host_confirmed" || state === "confirmed") return result.booking;
    throw new CiaoError("CONFIRMATION_WINDOW_CLOSED");
  }

  // Deposit "capture" (ledger allocation) + booked calendar + voucher.
  const { booking } = await transition({
    bookingId,
    to: "confirmed",
    actor: "system",
    reason: "deposit_allocated",
    idempotencyKey: `confirm:${bookingId}`,
    sideEffects: async (tx, b) => {
      await ledger.post(
        tx,
        b.id,
        ledger.depositAllocationLines({
          amount: b.depositAmount,
          commission: b.commissionAmount,
        }),
      );
      await calendar.settleDays(tx, b.id, "booked");
      await tx
        .update(schema.bookings)
        .set({ contactRevealed: true, voucherIssuedAt: new Date() })
        .where(eq(schema.bookings.id, b.id));
      // Payout queue: host share releases T+1 after CHECK-IN day (§10.3);
      // T+3 for card-funded bookings (§10.7 chargeback holdback).
      const [pay] = await tx
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.bookingId, b.id))
        .limit(1);
      const holdbackDays = pay?.rail === "mpgs" ? 3 : 1;
      const checkInDate = b.checkIn ? new Date(`${b.checkIn}T12:00:00Z`) : new Date();
      const releaseAfter = new Date(
        checkInDate.getTime() + holdbackDays * 24 * 3600 * 1000,
      );
      if (b.hostId) {
        await tx.insert(schema.payouts).values({
          hostId: b.hostId,
          bookingId: b.id,
          amount: b.depositAmount - b.commissionAmount,
          status: "queued",
          releaseAfter,
        });
      }
      // Pre-arrival reminder T-48h (§6.1 step 6).
      if (b.checkIn) {
        const reminder = new Date(
          new Date(`${b.checkIn}T10:00:00Z`).getTime() - 48 * 3600 * 1000,
        );
        if (reminder > new Date()) {
          await scheduleJob(tx, "pre_arrival_reminder", b.id, reminder);
        }
      }
    },
  });

  track("booking.confirmed", {
    bookingId: booking.id,
    listingId: booking.listingId,
    total: booking.totalAmount,
    minutesToConfirm: booking.confirmationDeadline
      ? Math.max(0, Math.round((booking.confirmationDeadline.getTime() - Date.now()) / 60000))
      : null,
  }, { userId: booking.guestId });
  track("host.response", { bookingId: booking.id, decision: "confirm" }, { userId: booking.hostId ?? undefined });

  const [guest] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, booking.guestId))
    .limit(1);
  const [venue] = await db
    .select()
    .from(schema.venues)
    .where(eq(schema.venues.id, booking.venueId))
    .limit(1);
  if (guest) {
    await notify({
      templateKey: "booking_confirmed_guest",
      toPhone: guest.phone,
      toUserId: guest.id,
      bookingId: booking.id,
      locale: guest.locale === "en" ? "en" : "ar",
      vars: {
        code: booking.code,
        venue: venue?.nameAr ?? "",
        balance: lyd(booking.balanceOnArrival),
        link: `${config.webBaseUrl}/booking/${booking.code}`,
      },
    });
  }
  return booking;
}

export async function hostDecline(bookingId: string, actorId?: string, reason?: string) {
  const { booking, applied } = await transition({
    bookingId,
    to: "host_declined",
    actor: "host",
    actorId,
    reason,
    expectedFrom: ["payment_held"],
    idempotencyKey: `hostdecline:${bookingId}`,
    sideEffects: async (tx, b) => {
      await calendar.settleDays(tx, b.id, "open");
    },
  });
  if (applied) {
    track("booking.declined", { bookingId }, { userId: booking.guestId });
    track("host.response", { bookingId, decision: "decline" }, { userId: booking.hostId ?? undefined });
    await refundDeposit(booking, "host_declined", 1);
  }
  return booking;
}

/** Worker: confirmation window elapsed with no host response (§6.4). */
export async function hostTimeout(bookingId: string) {
  const { booking, applied } = await transition({
    bookingId,
    to: "host_timeout",
    actor: "system",
    reason: "confirmation_window_elapsed",
    expectedFrom: ["payment_held"],
    idempotencyKey: `hosttimeout:${bookingId}`,
    sideEffects: async (tx, b) => {
      await calendar.settleDays(tx, b.id, "open");
    },
  });
  if (!applied) return; // host already answered — normal race, not an error

  track("booking.timeout", { bookingId }, { userId: booking.guestId });
  await refundDeposit(booking, "host_timeout", 1);
  // 5% next-deposit credit (§6.4) — goodwill funded by platform.
  const credit = Math.round((booking.depositAmount * 500) / 10000);
  await issueCredit(booking.guestId, credit, booking.id, "host_timeout_goodwill");

  const [guest] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, booking.guestId))
    .limit(1);
  if (guest) {
    await notify({
      templateKey: "host_timeout_guest",
      toPhone: guest.phone,
      toUserId: guest.id,
      bookingId: booking.id,
      vars: {
        code: booking.code,
        link: `${config.webBaseUrl}/search?similar=${booking.listingId}`,
      },
    });
  }
  // Reliability: silent host loses score (§11.4).
  if (booking.hostId) await bumpReliability(booking.hostId, { silentTimeout: true });
}

// ------------------------------------------------------------------ cancellations
export async function guestCancel(bookingId: string, guestId: string) {
  const [b] = await db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.id, bookingId))
    .limit(1);
  if (!b || b.guestId !== guestId) throw new CiaoError("BOOKING_NOT_FOUND");

  const hoursBefore = b.checkIn
    ? (new Date(`${b.checkIn}T14:00:00Z`).getTime() - Date.now()) / 3600_000
    : 0;
  const fraction = refundFraction(b.cancellationTier as CancellationTier, hoursBefore);

  const { booking, applied } = await transition({
    bookingId,
    to: "cancelled_by_guest",
    actor: "guest",
    actorId: guestId,
    reason: `refund_fraction:${fraction}`,
    idempotencyKey: `guestcancel:${bookingId}`,
    sideEffects: async (tx, bk) => {
      await calendar.settleDays(tx, bk.id, "open");
      await reverseAllocationIfNeeded(tx, bk);
    },
  });
  if (applied) {
    track("booking.cancelled", {
      bookingId,
      by: "guest",
      refundFraction: fraction,
      daysBeforeCheckIn: Math.round(hoursBefore / 24),
    }, { userId: guestId });
  }
  if (applied && wasPaid(b.state)) {
    if (fraction > 0) await refundDeposit(booking, "guest_cancel", fraction);
    if (fraction < 1) {
      // Forfeited part flows to host minus commission share at payout time.
      const forfeit = Math.round(booking.depositAmount * (1 - fraction));
      const platformShare = Math.round((forfeit * FEES.noShowPlatformShareBps) / 10000);
      await db.transaction(async (tx) => {
        await ledger.post(tx, booking.id, ledger.noShowForfeitLines({
          amount: forfeit,
          platformShare,
        }));
        if (booking.hostId) {
          await tx.insert(schema.payouts).values({
            hostId: booking.hostId,
            bookingId: booking.id,
            amount: forfeit - platformShare,
            status: "queued",
            releaseAfter: new Date(Date.now() + 24 * 3600 * 1000),
          });
        }
      });
    }
  }
  return { booking, refundFraction: fraction };
}

export async function hostCancel(bookingId: string, actorId?: string, reason?: string) {
  const { booking, applied } = await transition({
    bookingId,
    to: "cancelled_by_host",
    actor: "host",
    actorId,
    reason,
    idempotencyKey: `hostcancel:${bookingId}`,
    sideEffects: async (tx, b) => {
      await calendar.settleDays(tx, b.id, "open");
      await reverseAllocationIfNeeded(tx, b);
    },
  });
  if (applied) {
    track("booking.cancelled", { bookingId, by: "host" }, { userId: booking.guestId });
    // Full refund + credit + reliability strike (§9.7).
    await refundDeposit(booking, "host_cancel", 1);
    const credit = Math.round((booking.depositAmount * 500) / 10000);
    await issueCredit(booking.guestId, credit, booking.id, "host_cancel_goodwill");
    if (booking.hostId) await bumpReliability(booking.hostId, { cancellationStrike: true });
  }
  return booking;
}

// ------------------------------------------------------------------ arrival & completion
export async function checkIn(bookingId: string, actor: "host" | "ops", actorId?: string) {
  return transition({
    bookingId,
    to: "checked_in",
    actor,
    actorId,
    expectedFrom: ["confirmed", "pre_arrival_reconfirmed"],
    idempotencyKey: `checkin:${bookingId}`,
    sideEffects: async (tx, b) => {
      // Completion sweep after checkout day; review window opens then.
      const end = b.checkOut
        ? new Date(`${b.checkOut}T12:00:00Z`)
        : new Date(Date.now() + 24 * 3600 * 1000);
      await scheduleJob(tx, "complete_stay", b.id, end);
    },
  });
}

export async function markNoShow(bookingId: string, actorId?: string) {
  // Host attests no-show at T+24h after missed check-in (§10.6);
  // false attestation discoverable via dispute.
  const { booking, applied } = await transition({
    bookingId,
    to: "no_show",
    actor: "host",
    actorId,
    expectedFrom: ["confirmed", "pre_arrival_reconfirmed"],
    idempotencyKey: `noshow:${bookingId}`,
    sideEffects: async (tx, b) => {
      await calendar.settleDays(tx, b.id, "open");
    },
  });
  if (applied) {
    track("booking.no_show", { bookingId }, { userId: booking.guestId });
    // deposit already allocated at confirmation; nothing further to move —
    // host payout stands (that IS the no-show bond, §6.4).
    const [guest] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, booking.guestId))
      .limit(1);
    if (guest) {
      await db
        .update(schema.users)
        .set({ noShowCount: guest.noShowCount + 1 })
        .where(eq(schema.users.id, guest.id));
    }
  }
  return booking;
}

export async function completeStay(bookingId: string) {
  const { booking, applied } = await transition({
    bookingId,
    to: "completed",
    actor: "system",
    expectedFrom: ["checked_in"],
    idempotencyKey: `complete:${bookingId}`,
    sideEffects: async (tx, b) => {
      await scheduleJob(
        tx,
        "review_window_close",
        b.id,
        new Date(Date.now() + 14 * 24 * 3600 * 1000),
      );
    },
  });
  if (!applied) return;
  track("booking.completed", { bookingId, total: booking.totalAmount }, { userId: booking.guestId });
  const [guest] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, booking.guestId))
    .limit(1);
  const [venue] = await db
    .select()
    .from(schema.venues)
    .where(eq(schema.venues.id, booking.venueId))
    .limit(1);
  if (guest) {
    await db
      .update(schema.users)
      .set({ completedStays: guest.completedStays + 1 })
      .where(eq(schema.users.id, guest.id));
    // Membership rewards attach to the behaviour we actually want — a stay
    // that happened — not to a signup. Both calls are idempotent, so a
    // replayed completion cannot mint points twice.
    const loyalty = await import("../accounts/loyalty.js");
    await loyalty.awardPoints(guest.id, "stay_completed", booking.id, "booking");
    await loyalty.qualifyReferral(guest.id, booking.id);
    await notify({
      templateKey: "review_prompt",
      toPhone: guest.phone,
      toUserId: guest.id,
      bookingId: booking.id,
      vars: {
        venue: venue?.nameAr ?? "",
        link: `${config.webBaseUrl}/booking/${booking.code}/review`,
      },
    });
  }
}

// ------------------------------------------------------------------ refunds & credit
/**
 * Credit-first refund ladder (§10.6):
 * 1) instant platform credit +5% bonus; 2) rail refund where supported;
 * 3) manual bank-transfer queue, 7-working-day SLA.
 * Guest chooses at cancellation time in v2; v1 defaults to credit for speed,
 * rail/bank only via ops console.
 */
export async function refundDeposit(
  booking: BookingRow,
  reason: string,
  fraction: number,
  method: "credit" | "rail_refund" | "bank_transfer" = "credit",
) {
  const amount = Math.round(booking.depositAmount * fraction);
  if (amount <= 0) return;
  const bonus =
    method === "credit" ? Math.round((amount * FEES.refundCreditBonusBps) / 10000) : 0;

  await db.transaction(async (tx) => {
    await tx.insert(schema.refunds).values({
      bookingId: booking.id,
      amount,
      method,
      status: method === "credit" ? "completed" : "pending",
      bonusCredit: bonus,
      slaDueAt:
        method === "bank_transfer"
          ? new Date(Date.now() + 7 * 24 * 3600 * 1000)
          : undefined,
      completedAt: method === "credit" ? new Date() : undefined,
    });
    if (method === "credit") {
      await ledger.post(
        tx,
        booking.id,
        ledger.refundToCreditLines({ userId: booking.guestId, amount, bonus }),
      );
      const [guest] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, booking.guestId))
        .limit(1);
      if (guest) {
        await tx
          .update(schema.users)
          .set({ creditBalance: guest.creditBalance + amount + bonus })
          .where(eq(schema.users.id, guest.id));
      }
    }
  });

  const [guest] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, booking.guestId))
    .limit(1);
  if (guest) {
    await notify({
      templateKey: "refund_issued",
      toPhone: guest.phone,
      toUserId: guest.id,
      bookingId: booking.id,
      vars: {
        amount: lyd(amount + bonus),
        code: booking.code,
        method: method === "credit" ? "رصيد فوري في المنصة" : "تحويل بنكي",
        link: `${config.webBaseUrl}/booking/${booking.code}`,
      },
    });
  }
}

export async function issueCredit(
  userId: string,
  amount: number,
  bookingId: string | null,
  memo: string,
) {
  if (amount <= 0) return;
  await db.transaction(async (tx) => {
    await ledger.post(tx, bookingId, [
      { account: "platform_revenue", debit: amount, memo },
      { account: `guest_credit:${userId}`, credit: amount, memo },
    ]);
    const [user] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (user) {
      await tx
        .update(schema.users)
        .set({ creditBalance: user.creditBalance + amount })
        .where(eq(schema.users.id, userId));
    }
  });
}

// ------------------------------------------------------------------ reliability
export async function bumpReliability(
  hostId: string,
  event: { silentTimeout?: boolean; cancellationStrike?: boolean; doubleBooking?: boolean },
) {
  const [row] = await db
    .select()
    .from(schema.reliabilityScores)
    .where(eq(schema.reliabilityScores.hostId, hostId))
    .limit(1);
  const current = row ?? {
    hostId,
    score: 50,
    confirmationRateBps: 10000,
    medianResponseMinutes: 0,
    attestationStreakWeeks: 0,
    doubleBookingIncidents: 0,
    cancellationStrikes: 0,
  };
  const next = {
    ...current,
    score: Math.max(
      0,
      current.score -
        (event.silentTimeout ? 8 : 0) -
        (event.cancellationStrike ? 15 : 0) -
        (event.doubleBooking ? 20 : 0),
    ),
    doubleBookingIncidents:
      current.doubleBookingIncidents + (event.doubleBooking ? 1 : 0),
    cancellationStrikes: current.cancellationStrikes + (event.cancellationStrike ? 1 : 0),
    updatedAt: new Date(),
  };
  await db
    .insert(schema.reliabilityScores)
    .values(next)
    .onConflictDoUpdate({ target: schema.reliabilityScores.hostId, set: next });
}

// ------------------------------------------------------------------ helpers
type TxLike = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * If the deposit was already allocated (host_payables + platform_revenue at
 * confirmation), reverse the allocation back into guest_deposits_held and
 * cancel the queued payout, so the refund ladder draws from a funded account.
 */
async function reverseAllocationIfNeeded(tx: TxLike, b: BookingRow): Promise<void> {
  const queued = await tx
    .select()
    .from(schema.payouts)
    .where(eq(schema.payouts.bookingId, b.id))
    .for("update");
  const openPayouts = queued.filter((p) => p.status === "queued");
  if (openPayouts.length === 0) return;
  for (const p of openPayouts) {
    await tx
      .update(schema.payouts)
      .set({ status: "held" })
      .where(eq(schema.payouts.id, p.id));
  }
  await ledger.post(tx, b.id, [
    {
      account: "host_payables",
      debit: b.depositAmount - b.commissionAmount,
      memo: "allocation reversed on cancellation",
    },
    {
      account: "platform_revenue",
      debit: b.commissionAmount,
      memo: "commission reversed on cancellation",
    },
    {
      account: "guest_deposits_held",
      credit: b.depositAmount,
      memo: "deposit re-held for refund ladder",
    },
  ]);
}

function isSameDay(checkIn: string | null): boolean {
  if (!checkIn) return false;
  return checkIn === new Date().toISOString().slice(0, 10);
}

function wasPaid(state: string): boolean {
  return !["draft", "requested", "payment_pending", "payment_failed", "expired"].includes(
    state,
  );
}
