/**
 * Availability integrity — §9.5.
 * One row per (listing, day, session). Holds are placed atomically inside the
 * booking-request transaction; a hold that expires is swept by the worker.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";

type TxLike = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export function datesBetween(checkIn: string, checkOut: string): string[] {
  const days: string[] = [];
  const d = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  while (d < end) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

/**
 * Place a hold on all nights atomically. Fails with DATES_UNAVAILABLE if any
 * day is blocked/booked or held by another live booking.
 */
export async function holdDays(
  tx: TxLike,
  listingId: string,
  days: string[],
  session: string,
  bookingId: string,
  holdExpiresAt: Date,
): Promise<void> {
  const t = tx as typeof db;
  // Lock existing rows for these days.
  const existing = await t
    .select()
    .from(schema.calendarDays)
    .where(
      and(
        eq(schema.calendarDays.listingId, listingId),
        eq(schema.calendarDays.session, session),
        inArray(schema.calendarDays.day, days),
      ),
    )
    .for("update");

  const now = new Date();
  for (const row of existing) {
    const liveHold =
      row.state === "held" && row.holdExpiresAt && row.holdExpiresAt > now;
    if (row.state === "booked" || row.state === "blocked" || liveHold) {
      throw new CiaoError("DATES_UNAVAILABLE", { day: row.day });
    }
  }

  // Upsert every day to held.
  for (const day of days) {
    await t
      .insert(schema.calendarDays)
      .values({
        listingId,
        day,
        session,
        state: "held",
        bookingId,
        holdExpiresAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.calendarDays.listingId,
          schema.calendarDays.day,
          schema.calendarDays.session,
        ],
        set: {
          state: "held",
          bookingId,
          holdExpiresAt,
          updatedAt: new Date(),
        },
      });
  }
}

export async function settleDays(
  tx: TxLike,
  bookingId: string,
  to: "booked" | "open",
): Promise<void> {
  const t = tx as typeof db;
  await t
    .update(schema.calendarDays)
    .set({
      state: to,
      bookingId: to === "booked" ? bookingId : null,
      holdExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.calendarDays.bookingId, bookingId));
}

/** Host blocks dates (WhatsApp command or host PWA). */
export async function blockDays(
  listingId: string,
  days: string[],
  session = "night",
): Promise<void> {
  for (const day of days) {
    await db
      .insert(schema.calendarDays)
      .values({ listingId, day, session, state: "blocked", updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [
          schema.calendarDays.listingId,
          schema.calendarDays.day,
          schema.calendarDays.session,
        ],
        set: { state: "blocked", bookingId: null, holdExpiresAt: null, updatedAt: new Date() },
      });
  }
}

export async function openDays(
  listingId: string,
  days: string[],
  session = "night",
): Promise<void> {
  await db
    .update(schema.calendarDays)
    .set({ state: "open", bookingId: null, holdExpiresAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.calendarDays.listingId, listingId),
        eq(schema.calendarDays.session, session),
        inArray(schema.calendarDays.day, days),
        inArray(schema.calendarDays.state, ["blocked", "held"]),
      ),
    );
}

/** Month availability view for listing pages (missing rows = open). */
export async function monthAvailability(
  listingId: string,
  yearMonth: string, // "2026-08"
  session = "night",
): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(schema.calendarDays)
    .where(
      and(
        eq(schema.calendarDays.listingId, listingId),
        eq(schema.calendarDays.session, session),
        sql`${schema.calendarDays.day} >= ${yearMonth + "-01"}::date`,
        sql`${schema.calendarDays.day} < (${yearMonth + "-01"}::date + interval '1 month')`,
      ),
    );
  const out: Record<string, string> = {};
  const now = new Date();
  for (const r of rows) {
    const effective =
      r.state === "held" && r.holdExpiresAt && r.holdExpiresAt <= now ? "open" : r.state;
    out[r.day] = effective;
  }
  return out;
}
