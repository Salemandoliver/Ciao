/**
 * Durable timer worker — §9.3, §12.5.
 * Polls scheduled_jobs with FOR UPDATE SKIP LOCKED; every handler is
 * idempotent (state-machine expectedFrom guards absorb races).
 * DB-backed so a cache/queue outage can never wedge a booking.
 */
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { config } from "./config.js";
import * as bookingSvc from "./modules/bookings/service.js";
import { transition } from "./modules/bookings/machine.js";
import * as calendar from "./modules/calendar/service.js";
import { notify } from "./modules/messaging/service.js";
import { lyd } from "@ciao/shared";
import { foldAllDirty } from "./modules/intelligence/profile.js";

type Job = typeof schema.scheduledJobs.$inferSelect;
type Logger = { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void };

const MAX_ATTEMPTS = 5;

/** Ensure the recurring intelligence jobs exist (idempotent, called on boot). */
export async function ensureRecurringJobs(): Promise<void> {
  for (const kind of [
    "profile_fold",
    "events_prune",
    "loyalty_sweep",
    "birthday_campaign",
    "partner_daily_agenda",
    "partner_housekeeping",
  ]) {
    const [pending] = await db
      .select({ id: schema.scheduledJobs.id })
      .from(schema.scheduledJobs)
      .where(and(eq(schema.scheduledJobs.kind, kind), isNull(schema.scheduledJobs.completedAt)))
      .limit(1);
    if (!pending) {
      await db.insert(schema.scheduledJobs).values({
        kind,
        refId: null,
        runAt: new Date(Date.now() + 60 * 1000),
      });
    }
  }
}

export function startWorkerLoop(log: Logger): NodeJS.Timeout {
  const timer = setInterval(() => {
    tick(log).catch((e) => log.error(e, "worker tick failed"));
  }, config.worker.pollIntervalMs);
  timer.unref();
  ensureRecurringJobs().catch((e) => log.error(e, "ensureRecurringJobs failed"));
  log.info({}, `worker loop started (${config.worker.pollIntervalMs}ms)`);
  return timer;
}

export async function tick(log: Logger): Promise<number> {
  // Claim due jobs.
  const jobs = await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(schema.scheduledJobs)
      .where(
        and(
          lte(schema.scheduledJobs.runAt, new Date()),
          isNull(schema.scheduledJobs.completedAt),
          sql`(${schema.scheduledJobs.lockedAt} is null or ${schema.scheduledJobs.lockedAt} < now() - interval '5 minutes')`,
          sql`${schema.scheduledJobs.attempts} < ${MAX_ATTEMPTS}`,
        ),
      )
      .orderBy(schema.scheduledJobs.runAt)
      .limit(20)
      .for("update", { skipLocked: true });
    for (const j of due) {
      await tx
        .update(schema.scheduledJobs)
        .set({ lockedAt: new Date(), attempts: j.attempts + 1 })
        .where(eq(schema.scheduledJobs.id, j.id));
    }
    return due;
  });

  for (const job of jobs) {
    try {
      await handle(job);
      await db
        .update(schema.scheduledJobs)
        .set({ completedAt: new Date() })
        .where(eq(schema.scheduledJobs.id, job.id));
    } catch (e) {
      log.error({ job: job.kind, refId: job.refId, err: String(e) }, "job failed");
      await db
        .update(schema.scheduledJobs)
        .set({ lastError: String(e), lockedAt: null })
        .where(eq(schema.scheduledJobs.id, job.id));
    }
  }
  return jobs.length;
}

async function handle(job: Job): Promise<void> {
  switch (job.kind) {
    case "host_confirmation_timeout": {
      if (job.refId) await bookingSvc.hostTimeout(job.refId);
      break;
    }
    case "hold_expiry": {
      if (!job.refId) break;
      const [b] = await db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.id, job.refId))
        .limit(1);
      if (!b) break;
      // Only expire bookings still waiting on payment; paid states move on.
      if (["draft", "requested", "payment_pending", "payment_failed"].includes(b.state)) {
        await transition({
          bookingId: b.id,
          to: "expired",
          actor: "system",
          reason: "hold_expired",
          expectedFrom: ["draft", "requested", "payment_pending", "payment_failed"],
          idempotencyKey: `expire:${b.id}`,
          sideEffects: async (tx, bk) => {
            await calendar.settleDays(tx, bk.id, "open");
          },
        });
      }
      break;
    }
    case "pre_arrival_reminder": {
      if (!job.refId) break;
      const [b] = await db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.id, job.refId))
        .limit(1);
      if (!b || !["confirmed", "pre_arrival_reconfirmed"].includes(b.state)) break;
      const [guest] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, b.guestId))
        .limit(1);
      const [venue] = await db
        .select()
        .from(schema.venues)
        .where(eq(schema.venues.id, b.venueId))
        .limit(1);
      if (guest) {
        /*
         * Directions go out only when the venue's disclosure policy allows a
         * pin at this stage — the deposit is paid by now, but an area-only
         * provider still shares her location herself, and a reminder that
         * quietly linked to her house would undo that in one message.
         */
        const { navigationUrl, revealedLocation } = await import("./modules/listings/location.js");
        const loc = venue ? revealedLocation(venue) : null;
        const mapLink = loc?.exact ? navigationUrl(loc.exact) : "";
        const isArabic = guest.locale !== "en";
        await notify({
          templateKey: "pre_arrival_reminder",
          toPhone: guest.phone,
          toUserId: guest.id,
          bookingId: b.id,
          vars: {
            code: b.code,
            venue: venue?.nameAr ?? "",
            balance: lyd(b.balanceOnArrival),
            link: `${config.webBaseUrl}/booking/${b.code}`,
            mapLink,
            directions: mapLink
              ? isArabic
                ? ` · الطريق على الخريطة: ${mapLink}`
                : ` · Directions: ${mapLink}`
              : "",
          },
        });
      }
      // Host readiness reconfirm (§6.1 step 6).
      if (b.hostId) {
        const [host] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, b.hostId))
          .limit(1);
        if (host) {
          const { signActionToken } = await import("./lib/auth.js");
          const token = await signActionToken({
            scope: `host_reconfirm:${b.id}`,
            userId: host.id,
            ttlSeconds: 48 * 3600,
          });
          await notify({
            templateKey: "host_reconfirm_request",
            toPhone: host.phone,
            toUserId: host.id,
            bookingId: b.id,
            vars: { code: b.code, link: `${config.webBaseUrl}/h/reconfirm?token=${token}` },
          });
        }
      }
      break;
    }
    case "complete_stay": {
      if (job.refId) await bookingSvc.completeStay(job.refId);
      break;
    }
    case "review_window_close": {
      // Double-blind window close: publish any unpublished single reviews (§8.8).
      if (!job.refId) break;
      await db
        .update(schema.reviews)
        .set({ publishedAt: new Date() })
        .where(
          and(
            eq(schema.reviews.bookingId, job.refId),
            isNull(schema.reviews.publishedAt),
          ),
        );
      break;
    }
    case "payout_release": {
      // Swept generically below via releasePayouts; kept for explicit scheduling.
      break;
    }
    case "profile_fold": {
      // Intelligence: fold fresh events into user profiles, then re-arm.
      const folded = await foldAllDirty();
      if (folded > 0) console.log(`intelligence: folded ${folded} profiles`);
      await db.insert(schema.scheduledJobs).values({
        kind: "profile_fold",
        refId: null,
        runAt: new Date(Date.now() + 6 * 3600 * 1000),
      }).onConflictDoNothing();
      break;
    }
    case "events_prune": {
      // Data minimization: raw events beyond 18 months are deleted; profiles
      // (derived aggregates) are what we keep long-term.
      await db.execute(sql`delete from events where ts < now() - interval '18 months'`);
      await db.insert(schema.scheduledJobs).values({
        kind: "events_prune",
        refId: null,
        runAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      }).onConflictDoNothing();
      break;
    }
    case "loyalty_sweep": {
      /**
       * Two housekeeping duties that both concern somebody's points, so they
       * share a job rather than racing each other on the same rows:
       *  - return points from partner vouchers that lapsed unused, so a guest
       *    who never made it to the café isn't quietly out of pocket;
       *  - expire awards past their date, written as offsetting rows so the
       *    guest's history explains where the points went.
       */
      const loyalty = await import("./modules/accounts/loyalty.js");
      const partners = await import("./modules/accounts/partners.js");
      const refunded = await partners.expireVouchers();
      const expired = await loyalty.expirePoints();
      if (refunded || expired)
        console.log(`loyalty sweep: ${refunded} points returned, ${expired} expired`);
      await db.insert(schema.scheduledJobs).values({
        kind: "loyalty_sweep",
        refId: null,
        runAt: new Date(Date.now() + 3600 * 1000), // hourly: vouchers live ~30min
      }).onConflictDoNothing();
      break;
    }
    case "birthday_campaign": {
      /**
       * Runs daily. The points are a loyalty benefit and go out regardless of
       * marketing consent; the message is marketing and does not — see
       * runBirthdayCampaign for why those are separate decisions.
       *
       * Re-arms for 06:00 Tripoli rather than "24h from now", so the gift and
       * the note arrive at a civil hour instead of drifting into the night as
       * the worker restarts. Libya is UTC+2 year-round with no DST, which is
       * why this can be a constant offset and not a timezone library.
       */
      const { runBirthdayCampaign } = await import("./modules/accounts/profile.js");
      const result = await runBirthdayCampaign();
      if (result.awarded)
        console.log(
          `birthday campaign: ${result.awarded} gifts awarded, ${result.messaged} notes sent`,
        );
      const next = new Date();
      next.setUTCHours(4, 0, 0, 0); // 06:00 in Tripoli
      if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
      await db.insert(schema.scheduledJobs).values({
        kind: "birthday_campaign",
        refId: null,
        runAt: next,
      }).onConflictDoNothing();
      break;
    }
    case "requeue_notification": {
      const p = job.payload as Parameters<typeof notify>[0] | null;
      if (p) await notify(p);
      break;
    }
    /**
     * The evening agenda.
     *
     * Sent the night before, not the morning of, because the decisions it
     * changes — buy the flowers, charge the batteries, tell the driver, leave
     * earlier for Tajoura — are made the night before. It is the single most
     * useful message this platform sends anyone, and it is the reason a
     * partner who never opens the console still gets value from it every day.
     *
     * Re-arms hourly rather than daily so partners on different agenda hours
     * are all served, and each one is sent at most once per day by the
     * `messages` journal check.
     */
    case "partner_daily_agenda": {
      const partner = await import("./modules/partner/agenda-job.js");
      const sent = await partner.sendDueAgendas();
      const warned = await partner.warnExpiringTrials();
      if (sent > 0 || warned > 0)
        console.log(`partner: ${sent} agendas, ${warned} trial warnings`);
      await db.insert(schema.scheduledJobs).values({
        kind: "partner_daily_agenda",
        refId: null,
        runAt: new Date(Date.now() + 3600 * 1000),
      }).onConflictDoNothing();
      break;
    }
    /**
     * Daily partner housekeeping: lapse quotes past their validity date, and
     * take the Ciao Plus fee out of money we already owe.
     *
     * Both are jobs that make the console tell the truth without anyone
     * opening it — a "3 quotes waiting" badge that includes one which lapsed
     * in March is worse than no badge.
     */
    case "partner_housekeeping": {
      const quotes = await import("./modules/partner/quotes.js");
      const money = await import("./modules/partner/money.js");
      const subs = await import("./modules/partner/subscription.js");
      const expired = await quotes.expireStaleQuotes();
      const charged = await money.chargeDuePlusPeriods();
      /*
       * Annual terms need the opposite of billing: a nudge before they lapse
       * and an honest status after. Both run here rather than on their own
       * schedule because they are cheap, daily, and belong in the same "what
       * changed overnight for partners" pass — one job to reason about when a
       * partner asks why they were or were not reminded.
       */
      const notices = await subs.sendRenewalNotices();
      const lapsed = await subs.expireLapsedSubscriptions();
      if (expired || charged || notices.sent || lapsed.expired)
        console.log(
          `partner housekeeping: ${expired} quotes expired, ${charged} subscriptions billed, ` +
            `${notices.sent} renewal notices, ${lapsed.expired} terms lapsed`,
        );
      await db.insert(schema.scheduledJobs).values({
        kind: "partner_housekeeping",
        refId: null,
        runAt: new Date(Date.now() + 24 * 3600 * 1000),
      }).onConflictDoNothing();
      break;
    }
    /**
     * A payout-destination change has sat out its cooling-off period.
     *
     * `activatePayoutAccount` returns false when the owner cancelled it in the
     * meantime — which is the whole point of the delay, and is a success, not
     * an error.
     */
    case "partner_payout_account_activate": {
      const money = await import("./modules/partner/money.js");
      if (job.refId) {
        const activated = await money.activatePayoutAccount(job.refId);
        console.log(`partner payout account ${job.refId}: ${activated ? "activated" : "superseded or cancelled"}`);
      }
      break;
    }
    default:
      break;
  }
}

/** Payout sweep — release queued payouts past their holdback (§10.3, §10.7). */
export async function releaseDuePayouts(): Promise<number> {
  const due = await db
    .select()
    .from(schema.payouts)
    .where(
      and(eq(schema.payouts.status, "queued"), lte(schema.payouts.releaseAfter, new Date())),
    )
    .limit(50);
  for (const p of due) {
    await db.transaction(async (tx) => {
      const ledger = await import("./modules/payments/ledger.js");
      await ledger.post(tx, p.bookingId, ledger.payoutReleasedLines({ amount: p.amount }));
      await tx
        .update(schema.payouts)
        .set({ status: "released" })
        .where(eq(schema.payouts.id, p.id));
    });
  }
  return due.length;
}

// Sweep payouts every 10 minutes alongside the main loop.
export function startPayoutSweep(log: Logger): NodeJS.Timeout {
  const t = setInterval(() => {
    releaseDuePayouts().catch((e) => log.error(e, "payout sweep failed"));
  }, 10 * 60 * 1000);
  t.unref();
  return t;
}
