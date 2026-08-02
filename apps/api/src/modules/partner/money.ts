/**
 * The money screens, and the one control that protects them.
 *
 * A partner's money question is not "what is my GMV". It is three questions,
 * in this order:
 *
 *   1. What have I earned — across everything, not just Ciao's slice.
 *   2. What is Ciao about to send me, and when exactly.
 *   3. Who still owes me money.
 *
 * The third one is the sleeper. A photographer with four unpaid balances from
 * March is carrying an interest-free loan she never agreed to make, and she
 * has no list of them anywhere. Building that list is a day's work for us and
 * changes her month.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { getSetting } from "../business/settings.js";
import { notify } from "../messaging/service.js";
import { getSubscription } from "./service.js";

/**
 * Earnings across both books, by month.
 *
 * Ciao earnings come from the booking record (net of commission — the number
 * that actually lands in their account, never the gross the guest paid, which
 * would be a flattering lie). Direct earnings come from the diary at whatever
 * the partner recorded, because on direct work we are a notebook, not a party
 * to the transaction.
 */
export async function earnings(partnerId: string, months = 12) {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - (months - 1), 1);
  since.setUTCHours(0, 0, 0, 0);
  const sinceDay = since.toISOString().slice(0, 10);

  const rows = await db
    .select({
      month: sql<string>`to_char(${schema.partnerJobs.day}::date, 'YYYY-MM')`,
      source: sql<string>`case when ${schema.partnerJobs.source} = 'ciao' then 'ciao' else 'direct' end`,
      jobs: sql<string>`count(*)`,
      gross: sql<string>`coalesce(sum(${schema.partnerJobs.price}), 0)`,
      collected: sql<string>`coalesce(sum(${schema.partnerJobs.amountPaid}), 0)`,
    })
    .from(schema.partnerJobs)
    .where(
      and(
        eq(schema.partnerJobs.partnerId, partnerId),
        inArray(schema.partnerJobs.status, ["confirmed", "done"]),
        gte(schema.partnerJobs.day, sinceDay),
      ),
    )
    .groupBy(sql`1`, sql`2`)
    .orderBy(sql`1`);

  const byMonth = new Map<string, { month: string; ciao: number; direct: number; jobs: number }>();
  for (const r of rows) {
    const entry = byMonth.get(r.month) ?? { month: r.month, ciao: 0, direct: 0, jobs: 0 };
    if (r.source === "ciao") entry.ciao += Number(r.gross);
    else entry.direct += Number(r.gross);
    entry.jobs += Number(r.jobs);
    byMonth.set(r.month, entry);
  }

  const totalCiao = [...byMonth.values()].reduce((s, m) => s + m.ciao, 0);
  const totalDirect = [...byMonth.values()].reduce((s, m) => s + m.direct, 0);

  return {
    months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    totalCiao,
    totalDirect,
    /**
     * The share of their income Ciao is responsible for. This is the honest
     * version of our own sales pitch, computed from their data rather than
     * ours — and it is allowed to be a small number. A partner who can see it
     * is 12% and rising trusts the console; one who is shown a flattering
     * number stops trusting everything on the screen.
     */
    ciaoShareBps:
      totalCiao + totalDirect > 0
        ? Math.round((totalCiao / (totalCiao + totalDirect)) * 10_000)
        : 0,
  };
}

/**
 * What Ciao owes, with the release date explained rather than just printed.
 *
 * The T+1-after-check-in rule (§10.3) is the platform's only real enforcement
 * lever and it is also the thing partners complain about most, so the console
 * states the reason next to the date. A payout that "just appears when it
 * appears" is how a host concludes we are keeping their money.
 */
export async function payouts(partnerId: string) {
  const rows = await db
    .select({ payout: schema.payouts, code: schema.bookings.code })
    .from(schema.payouts)
    .leftJoin(schema.bookings, eq(schema.payouts.bookingId, schema.bookings.id))
    .where(eq(schema.payouts.hostId, partnerId))
    .orderBy(desc(schema.payouts.createdAt))
    .limit(100);

  const queued = rows
    .filter((r) => r.payout.status === "queued")
    .reduce((s, r) => s + r.payout.amount, 0);
  const inFlight = rows
    .filter((r) => r.payout.status === "released")
    .reduce((s, r) => s + r.payout.amount, 0);
  const paid = rows
    .filter((r) => r.payout.status === "paid")
    .reduce((s, r) => s + r.payout.amount, 0);

  return {
    queued,
    inFlight,
    paid,
    items: rows.map((r) => ({
      id: r.payout.id,
      amount: r.payout.amount,
      status: r.payout.status,
      rail: r.payout.rail,
      releaseAfter: r.payout.releaseAfter,
      paidAt: r.payout.paidAt,
      bookingCode: r.code ?? null,
    })),
  };
}

/**
 * Accounts receivable: jobs where the work is done or booked and the customer
 * has not finished paying.
 *
 * Ciao bookings appear here too, as the cash balance due on arrival — because
 * from the partner's side that is money outstanding on a job, and splitting it
 * across two screens by whose booking it was would be filing by our
 * convenience rather than theirs.
 */
export async function receivables(partnerId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      job: schema.partnerJobs,
      clientName: schema.partnerClients.nameAr,
      clientPhone: schema.partnerClients.phone,
      bookingCode: schema.bookings.code,
    })
    .from(schema.partnerJobs)
    .leftJoin(schema.partnerClients, eq(schema.partnerJobs.clientId, schema.partnerClients.id))
    .leftJoin(schema.bookings, eq(schema.partnerJobs.bookingId, schema.bookings.id))
    .where(
      and(
        eq(schema.partnerJobs.partnerId, partnerId),
        inArray(schema.partnerJobs.status, ["confirmed", "done"]),
        sql`${schema.partnerJobs.price} > ${schema.partnerJobs.amountPaid}`,
      ),
    )
    .orderBy(asc(schema.partnerJobs.day));

  const items = rows.map(({ job, clientName, clientPhone, bookingCode }) => ({
    jobId: job.id,
    titleAr: job.titleAr,
    day: job.day,
    source: job.source,
    due: job.price - job.amountPaid,
    clientNameAr: clientName ?? null,
    clientPhone: clientPhone ?? null,
    bookingCode: bookingCode ?? null,
    /** Overdue means the work has happened and the money has not arrived. */
    overdue: job.day < today,
  }));

  return {
    total: items.reduce((s, i) => s + i.due, 0),
    overdueTotal: items.filter((i) => i.overdue).reduce((s, i) => s + i.due, 0),
    items,
  };
}

// ---------------------------------------------------------------- payout account
/**
 * The payout destination, and the cooling-off period that guards it.
 *
 * Redirecting payouts is the highest-value attack against this platform: one
 * compromised phone turns into every future deposit. The control is not a
 * stronger password — there are no passwords — it is time plus a message to
 * the channel the attacker does *not* control.
 *
 * So a change: creates a `pending` row that activates only after the hold,
 * leaves the current destination active until then, and notifies immediately.
 * A partner who did not make the change has a full day and an explicit
 * "wasn't me" link to stop it.
 */
export async function requestPayoutAccountChange(
  partnerId: string,
  actorId: string,
  input: { rail: string; label?: string | null; accountRef: string },
  meta: { ip?: string; locale?: "ar" | "en"; phone?: string | null },
): Promise<typeof schema.partnerPayoutAccounts.$inferSelect> {
  const holdHours = Number(await getSetting("partner.payoutChangeHoldHours"));
  const activatesAt = new Date(Date.now() + holdHours * 3_600_000);

  // Any earlier request that has not activated is superseded — two competing
  // pending destinations is exactly the confusion an attacker would want.
  await db
    .update(schema.partnerPayoutAccounts)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(schema.partnerPayoutAccounts.partnerId, partnerId),
        eq(schema.partnerPayoutAccounts.status, "pending"),
      ),
    );

  const [row] = await db
    .insert(schema.partnerPayoutAccounts)
    .values({
      partnerId,
      rail: input.rail,
      label: input.label ?? null,
      accountRef: input.accountRef,
      status: holdHours === 0 ? "active" : "pending",
      activatesAt: holdHours === 0 ? null : activatesAt,
      activatedAt: holdHours === 0 ? new Date() : null,
      requestedById: actorId,
      requestedIp: meta.ip?.slice(0, 45) ?? null,
    })
    .returning();

  if (holdHours === 0) {
    await db
      .update(schema.partnerPayoutAccounts)
      .set({ status: "replaced" })
      .where(
        and(
          eq(schema.partnerPayoutAccounts.partnerId, partnerId),
          eq(schema.partnerPayoutAccounts.status, "active"),
          ne(schema.partnerPayoutAccounts.id, row!.id),
        ),
      );
  } else {
    await db.insert(schema.scheduledJobs).values({
      kind: "partner_payout_account_activate",
      refId: row!.id,
      runAt: activatesAt,
      payload: { partnerId },
    });
  }

  await db.insert(schema.auditLog).values({
    actorId,
    action: "partner.payout_account.requested",
    targetType: "partner",
    targetId: partnerId,
    // The reference is masked even in our own audit trail: the trail exists to
    // answer "who changed this and when", not to be a second copy of everyone's
    // bank details.
    detail: { rail: input.rail, ref: maskAccountRef(input.accountRef), holdHours },
  });

  /*
   * The alert goes to the number of record *now*, before the change lands. If
   * the account has been taken over, this is the only message that reaches the
   * real owner — which is why it is sent whether or not the caller looks
   * suspicious, and why it is a critical-priority template that ignores quiet
   * hours.
   */
  if (meta.phone) {
    await notify({
      templateKey: "partner_payout_account_changed",
      toPhone: meta.phone,
      toUserId: partnerId,
      locale: meta.locale ?? "ar",
      vars: {
        ref: maskAccountRef(input.accountRef),
        hours: String(holdHours),
      },
    }).catch(() => {
      /* a failed alert must not roll back the audit row that records the attempt */
    });
  }

  return row!;
}

/** Only ever the last four, everywhere: display, audit trail and messages. */
export function maskAccountRef(ref: string): string {
  const clean = ref.replace(/\s/g, "");
  return clean.length <= 4 ? "••••" : `•••• ${clean.slice(-4)}`;
}

export async function payoutAccounts(partnerId: string) {
  const rows = await db
    .select()
    .from(schema.partnerPayoutAccounts)
    .where(
      and(
        eq(schema.partnerPayoutAccounts.partnerId, partnerId),
        inArray(schema.partnerPayoutAccounts.status, ["active", "pending"]),
      ),
    )
    .orderBy(desc(schema.partnerPayoutAccounts.createdAt));
  return rows.map((r) => ({
    id: r.id,
    rail: r.rail,
    label: r.label,
    ref: maskAccountRef(r.accountRef),
    status: r.status,
    activatesAt: r.activatesAt,
  }));
}

/** "That wasn't me" — cancel a pending change before it lands. */
export async function cancelPendingPayoutAccount(
  partnerId: string,
  actorId: string,
  id: string,
): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.partnerPayoutAccounts)
    .where(eq(schema.partnerPayoutAccounts.id, id))
    .limit(1);
  if (!row || row.partnerId !== partnerId) throw new CiaoError("AUTH_FORBIDDEN");
  if (row.status !== "pending") throw new CiaoError("VALIDATION", { field: "status" });
  await db
    .update(schema.partnerPayoutAccounts)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(eq(schema.partnerPayoutAccounts.id, id));
  await db.insert(schema.auditLog).values({
    actorId,
    action: "partner.payout_account.cancelled",
    targetType: "partner",
    targetId: partnerId,
    detail: { accountId: id },
  });
}

/** Worker hook: the hold has elapsed, so the new destination takes over. */
export async function activatePayoutAccount(accountId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(schema.partnerPayoutAccounts)
    .where(eq(schema.partnerPayoutAccounts.id, accountId))
    .limit(1);
  // Cancelled in the meantime — by the owner saying "wasn't me", or superseded.
  if (!row || row.status !== "pending") return false;
  await db
    .update(schema.partnerPayoutAccounts)
    .set({ status: "replaced" })
    .where(
      and(
        eq(schema.partnerPayoutAccounts.partnerId, row.partnerId),
        eq(schema.partnerPayoutAccounts.status, "active"),
      ),
    );
  await db
    .update(schema.partnerPayoutAccounts)
    .set({ status: "active", activatedAt: new Date() })
    .where(eq(schema.partnerPayoutAccounts.id, accountId));
  return true;
}

// ---------------------------------------------------------------- subscription billing
/**
 * The Ciao Plus fee, netted from money we already owe.
 *
 * Recurring card billing does not meaningfully exist in Libya, and invoicing a
 * chalet owner monthly is a collections problem disguised as a revenue model.
 * Taking it out of the next payout is the only mechanism that works here — and
 * it is honest about itself: the partner sees the deduction on the payout
 * statement with the month it covers.
 *
 * `past_due` is not a punishment. It means we have not yet had a payout to net
 * against, which happens precisely to the partner having a quiet month, and
 * `plusActive()` keeps them entitled through it.
 */
export async function chargeDuePlusPeriods(now = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(schema.partnerSubscriptions)
    .where(
      and(
        eq(schema.partnerSubscriptions.plan, "plus"),
        inArray(schema.partnerSubscriptions.status, ["trialing", "active", "past_due"]),
        or(
          isNull(schema.partnerSubscriptions.currentPeriodEnd),
          lte(schema.partnerSubscriptions.currentPeriodEnd, now),
        ),
      ),
    )
    .limit(200);

  let charged = 0;
  for (const sub of due) {
    // A trial that has not run out yet is not due for anything.
    if (sub.status === "trialing" && sub.trialEndsAt && sub.trialEndsAt > now) continue;

    const periodStart = sub.currentPeriodEnd ?? sub.trialEndsAt ?? now;
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

    const price = sub.priceDirhams || Number(await getSetting("partner.plusPriceDirhams"));
    const [owed] = await db
      .select({
        bal: sql<string>`coalesce(sum(${schema.payouts.amount}) filter (where ${schema.payouts.status} in ('queued','released')), 0)`,
      })
      .from(schema.payouts)
      .where(eq(schema.payouts.hostId, sub.partnerId));
    const collectable = Number(owed?.bal ?? 0) >= price;

    if (collectable) {
      /*
       * The fee moves through the ledger like every other pound in this
       * business: what we owed the partner shrinks, and the difference becomes
       * revenue. A subscription that lived in its own column would be the one
       * number the trial balance could not explain.
       */
      const { post } = await import("../payments/ledger.js");
      await post(db, null, [
        { account: "host_payables", debit: price, memo: `Ciao Plus ${periodStart.toISOString().slice(0, 7)}` },
        { account: "platform_revenue", credit: price, memo: "Ciao Plus subscription" },
      ]);
    }

    await db
      .update(schema.partnerSubscriptions)
      .set({
        status: collectable ? "active" : "past_due",
        priceDirhams: price,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        updatedAt: new Date(),
      })
      .where(eq(schema.partnerSubscriptions.partnerId, sub.partnerId));
    charged++;
  }
  return charged;
}

/** Re-exported so routes can answer "is Plus on" without importing two modules. */
export { getSubscription };
