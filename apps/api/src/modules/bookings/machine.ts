/**
 * Booking state machine executor — §9.3.
 * Every transition: validated against TRANSITIONS, journaled in booking_events,
 * idempotent (bookingId + idempotencyKey unique), executed in one DB transaction.
 * Timeouts run server-side via scheduled_jobs; clients only request transitions.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  canTransition,
  type BookingState,
} from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";

export type Actor = "guest" | "host" | "ops" | "system";

export interface TransitionRequest {
  bookingId: string;
  to: BookingState;
  actor: Actor;
  actorId?: string;
  reason?: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  /** Optional guard: transition only valid from one of these states. */
  expectedFrom?: BookingState[];
  /** Side effects executed inside the same transaction, after the state write. */
  sideEffects?: (tx: TxLike, booking: BookingRow) => Promise<void>;
}

type TxLike = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type BookingRow = typeof schema.bookings.$inferSelect;

export interface TransitionResult {
  booking: BookingRow;
  applied: boolean; // false when idempotent replay
}

export async function transition(req: TransitionRequest): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    // Row-lock the booking to serialize concurrent transitions.
    const [booking] = await tx
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, req.bookingId))
      .for("update");
    if (!booking) throw new CiaoError("BOOKING_NOT_FOUND");

    const from = booking.state as BookingState;

    // Idempotent replay: same key already journaled → return current row untouched.
    if (req.idempotencyKey) {
      const [existing] = await tx
        .select({ id: schema.bookingEvents.id })
        .from(schema.bookingEvents)
        .where(
          and(
            eq(schema.bookingEvents.bookingId, req.bookingId),
            eq(schema.bookingEvents.idempotencyKey, req.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return { booking, applied: false };
    }

    if (req.expectedFrom && !req.expectedFrom.includes(from)) {
      // A timeout firing after the host already confirmed is normal, not an error:
      // caller decides via applied=false when the expected state has moved on.
      return { booking, applied: false };
    }

    if (from === req.to) return { booking, applied: false };

    if (!canTransition(from, req.to)) {
      throw new CiaoError("BOOKING_ILLEGAL_TRANSITION", {
        from,
        to: req.to,
      });
    }

    const [{ maxSeq }] = (await tx
      .select({ maxSeq: sql<number>`coalesce(max(${schema.bookingEvents.seq}), 0)` })
      .from(schema.bookingEvents)
      .where(eq(schema.bookingEvents.bookingId, req.bookingId))) as [
      { maxSeq: number },
    ];

    await tx.insert(schema.bookingEvents).values({
      bookingId: req.bookingId,
      seq: Number(maxSeq) + 1,
      fromState: from,
      toState: req.to,
      actor: req.actor,
      actorId: req.actorId,
      reason: req.reason,
      payload: req.payload,
      idempotencyKey: req.idempotencyKey,
    });

    const patch: Partial<BookingRow> = { state: req.to, updatedAt: new Date() };
    if (req.to === "checked_in") patch.checkedInAt = new Date();
    if (req.to === "completed") patch.completedAt = new Date();
    if (
      req.to === "cancelled_by_guest" ||
      req.to === "cancelled_by_host" ||
      req.to === "force_majeure_credit"
    )
      patch.cancelledAt = new Date();

    const [updated] = await tx
      .update(schema.bookings)
      .set(patch)
      .where(eq(schema.bookings.id, req.bookingId))
      .returning();

    if (req.sideEffects) await req.sideEffects(tx, updated!);

    return { booking: updated!, applied: true };
  });
}

/** Schedule a durable server-side timer (idempotent on kind+ref+runAt). */
export async function scheduleJob(
  tx: TxLike | Db,
  kind: string,
  refId: string | null,
  runAt: Date,
  payload?: Record<string, unknown>,
): Promise<void> {
  await (tx as Db)
    .insert(schema.scheduledJobs)
    .values({ kind, refId, runAt, payload })
    .onConflictDoNothing();
}

type Db = typeof db;
