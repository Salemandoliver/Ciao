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
  for (const kind of ["profile_fold", "events_prune"]) {
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
    case "requeue_notification": {
      const p = job.payload as Parameters<typeof notify>[0] | null;
      if (p) await notify(p);
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
