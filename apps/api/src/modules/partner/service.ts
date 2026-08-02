/**
 * Partner service layer — jobs, the unified calendar, the customer book, and
 * the money views.
 *
 * The one rule that shapes this file: **a job never moves a booking.** Where a
 * job mirrors a Ciao booking, the booking is the truth for state and money and
 * every transition still goes through the state machine (§9.3). The job
 * carries the partner's own view of that work — their notes, their client
 * record — and nothing else. A console that could nudge a booking sideways
 * without the journal would destroy the property the whole system rests on.
 *
 * The second rule: **a direct job is the partner's.** Ciao takes no
 * commission, stores no more about the customer than the partner typed, and
 * never messages them. What the platform gets out of it is a calendar that
 * tells the truth, which is worth more than a commission we would have had to
 * lie to collect.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import {
  jobDays,
  jobOccupies,
  normalizePhone,
  plusActive,
  type JobStatus,
  type PartnerKind,
} from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { track } from "../intelligence/events.js";
import { getSetting } from "../business/settings.js";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Quote codes are read aloud over the phone and typed from a WhatsApp message,
 * so the alphabet drops every glyph that gets confused when spoken or seen —
 * the same reasoning as booking codes and referral codes elsewhere.
 */
export function quoteCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `Q-${s}`;
}

// ---------------------------------------------------------------- profile
export type PartnerProfileRow = typeof schema.partnerProfiles.$inferSelect;

/**
 * The partner's profile, created on first touch.
 *
 * Lazily rather than at signup because hosts exist who predate this console
 * entirely, and because the alternative — refusing to show a partner their own
 * bookings until they have filled in a settings form — is the kind of gate
 * that loses the person you spent a field visit acquiring.
 */
export async function ensureProfile(
  partnerId: string,
  hint?: { kind?: PartnerKind; businessNameAr?: string },
): Promise<PartnerProfileRow> {
  const [existing] = await db
    .select()
    .from(schema.partnerProfiles)
    .where(eq(schema.partnerProfiles.userId, partnerId))
    .limit(1);
  if (existing) return existing;

  // Infer the shape of the business from what they already supply, so the
  // console is right the first time they open it rather than after a settings
  // trip: a make-up artist should not have to tell us she is not a chalet.
  const venueRows = await db
    .select({ type: schema.venues.type, name: schema.venues.nameAr })
    .from(schema.venues)
    .where(eq(schema.venues.hostId, partnerId))
    .limit(5);
  const types = new Set(venueRows.map((v) => v.type));
  const kind: PartnerKind =
    hint?.kind ??
    (types.has("service") ? "service" : types.has("hall") ? "hall" : "venue");

  const [created] = await db
    .insert(schema.partnerProfiles)
    .values({
      userId: partnerId,
      kind,
      businessNameAr: hint?.businessNameAr ?? venueRows[0]?.name ?? null,
      // A service provider takes several appointments a day; a venue takes one
      // booking. Defaulting a make-up artist to one job a day would have her
      // fighting the calendar on her first Thursday.
      maxJobsPerDay: kind === "service" ? 4 : 1,
      travelsToClient: kind === "service",
      onboardedAt: null,
    })
    .returning();
  return created!;
}

// ---------------------------------------------------------------- subscription
export async function getSubscription(partnerId: string) {
  const [row] = await db
    .select()
    .from(schema.partnerSubscriptions)
    .where(eq(schema.partnerSubscriptions.partnerId, partnerId))
    .limit(1);
  return row ?? null;
}

export async function hasPlus(partnerId: string): Promise<boolean> {
  if (!(await getSetting("partner.plusEnabled"))) return false;
  return plusActive(await getSubscription(partnerId));
}

// ---------------------------------------------------------------- clients
/**
 * Find or create a customer in the partner's own book.
 *
 * Matching on the normalized phone rather than the name is what makes "she has
 * booked with me four times" true: the same woman is "هدى", "هدى العرفي" and
 * "هدى (بنت خالتي)" across three years of a notebook, and a partner will never
 * reconcile those by hand. The phone is the one thing that stays the same.
 */
export async function upsertClient(
  partnerId: string,
  input: { id?: string; nameAr: string; phone?: string | null; notesAr?: string | null },
  actorId: string,
): Promise<typeof schema.partnerClients.$inferSelect> {
  const phone = input.phone ? normalizePhone(input.phone) : null;

  if (input.id) {
    const [existing] = await db
      .select()
      .from(schema.partnerClients)
      .where(eq(schema.partnerClients.id, input.id))
      .limit(1);
    if (!existing || existing.partnerId !== partnerId) throw new CiaoError("AUTH_FORBIDDEN");
    const [updated] = await db
      .update(schema.partnerClients)
      .set({
        nameAr: input.nameAr,
        phone,
        notesAr: input.notesAr ?? existing.notesAr,
        updatedAt: new Date(),
      })
      .where(eq(schema.partnerClients.id, input.id))
      .returning();
    return updated!;
  }

  if (phone) {
    const [match] = await db
      .select()
      .from(schema.partnerClients)
      .where(
        and(
          eq(schema.partnerClients.partnerId, partnerId),
          eq(schema.partnerClients.phone, phone),
        ),
      )
      .limit(1);
    if (match) {
      // A returning customer keeps their history; only the name catches up, in
      // case the partner has learned a fuller version of it since.
      const [updated] = await db
        .update(schema.partnerClients)
        .set({ nameAr: input.nameAr, updatedAt: new Date() })
        .where(eq(schema.partnerClients.id, match.id))
        .returning();
      return updated!;
    }
  }

  /*
   * If this customer already has a Ciao account we link it — but only by
   * phone, only inside this partner's book, and it is never surfaced to the
   * partner as "this person is a Ciao member". Telling a photographer which of
   * her clients hold accounts with us would be handing over our members'
   * relationship with us, which is not ours to hand over.
   */
  let ciaoUserId: string | null = null;
  if (phone) {
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.phone, phone))
      .limit(1);
    ciaoUserId = user?.id ?? null;
  }

  const [created] = await db
    .insert(schema.partnerClients)
    .values({
      partnerId,
      nameAr: input.nameAr,
      phone,
      ciaoUserId,
      notesAr: input.notesAr ?? null,
    })
    .returning();
  void actorId;
  return created!;
}

/** Refresh the cached counters after a job changes. */
async function refreshClientTotals(clientId: string): Promise<void> {
  const [agg] = await db
    .select({
      jobs: sql<string>`count(*)`,
      spend: sql<string>`coalesce(sum(${schema.partnerJobs.price}) filter (where ${schema.partnerJobs.status} in ('confirmed','done')), 0)`,
      last: sql<string | null>`max(${schema.partnerJobs.day})`,
    })
    .from(schema.partnerJobs)
    .where(
      and(
        eq(schema.partnerJobs.clientId, clientId),
        ne(schema.partnerJobs.status, "cancelled"),
      ),
    );
  await db
    .update(schema.partnerClients)
    .set({
      jobsCount: Number(agg?.jobs ?? 0),
      totalSpend: Number(agg?.spend ?? 0),
      lastJobAt: agg?.last ? new Date(`${agg.last}T00:00:00Z`) : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.partnerClients.id, clientId));
}

// ---------------------------------------------------------------- jobs
export interface JobInput {
  listingId?: string | null;
  clientId?: string | null;
  client?: { nameAr: string; phone?: string | null } | null;
  source?: string;
  kind?: string;
  titleAr: string;
  day: string;
  endDay?: string | null;
  session?: string;
  startTime?: string | null;
  endTime?: string | null;
  status?: JobStatus;
  price?: number;
  amountPaid?: number;
  locationAr?: string | null;
  notesAr?: string | null;
  blocksCalendar?: boolean;
}

/**
 * Is this partner already full on these days?
 *
 * `maxJobsPerDay` is what makes one calendar work for both a chalet and a
 * make-up artist. A venue is one job a day and the check reads as "that day is
 * taken"; a make-up artist is four and it reads as "you already have four
 * brides that morning" — the same rule, and the second one is a warning a
 * partner will thank us for rather than a refusal.
 */
export async function dayLoad(
  partnerId: string,
  days: string[],
  excludeJobId?: string,
): Promise<Record<string, number>> {
  if (days.length === 0) return {};
  // The SQL below brackets on the first and last day, so they have to BE the
  // first and last. Callers pass whatever the user typed, in whatever order.
  const sorted = [...days].sort();
  const rows = await db
    .select({ day: schema.partnerJobs.day, endDay: schema.partnerJobs.endDay, id: schema.partnerJobs.id })
    .from(schema.partnerJobs)
    .where(
      and(
        eq(schema.partnerJobs.partnerId, partnerId),
        inArray(schema.partnerJobs.status, ["confirmed", "done"]),
        // A range job can start before the window and still cover it, so the
        // filter has to be generous and the expansion below does the real work.
        lte(schema.partnerJobs.day, sorted[sorted.length - 1]!),
        or(
          isNull(schema.partnerJobs.endDay),
          gte(schema.partnerJobs.endDay, sorted[0]!),
        ),
      ),
    );
  const counts: Record<string, number> = {};
  const wanted = new Set(days);
  for (const r of rows) {
    if (excludeJobId && r.id === excludeJobId) continue;
    for (const d of jobDays(r.day, r.endDay)) {
      if (wanted.has(d)) counts[d] = (counts[d] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Push a job's occupancy into the public calendar.
 *
 * This is the mechanism that closes pitfall #2. A direct job the partner
 * entered for their own diary marks those days blocked on the listing, so the
 * marketplace stops selling a Thursday that is already a wedding. It only ever
 * writes `blocked` and only ever clears days it can see are free — it must not
 * disturb a `booked` day, because that day belongs to a real Ciao booking and
 * a diary edit is not allowed to cancel somebody's stay.
 */
async function syncJobToCalendar(
  job: typeof schema.partnerJobs.$inferSelect,
  previousDays: string[] = [],
): Promise<void> {
  if (!job.listingId) return;
  const shouldOccupy = job.blocksCalendar && jobOccupies(job.status);
  const days = shouldOccupy ? jobDays(job.day, job.endDay) : [];
  const release = previousDays.filter((d) => !days.includes(d));

  for (const day of days) {
    const [existing] = await db
      .select()
      .from(schema.calendarDays)
      .where(
        and(
          eq(schema.calendarDays.listingId, job.listingId),
          eq(schema.calendarDays.day, day),
          eq(schema.calendarDays.session, job.session),
        ),
      )
      .limit(1);
    // A day already sold through Ciao stays sold. The job is the mirror of
    // that booking or a clash the partner needs to see — either way, silently
    // overwriting `booked` would be the console cancelling a stay.
    if (existing?.state === "booked") continue;
    await db
      .insert(schema.calendarDays)
      .values({
        listingId: job.listingId,
        day,
        session: job.session,
        state: "blocked",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.calendarDays.listingId,
          schema.calendarDays.day,
          schema.calendarDays.session,
        ],
        set: { state: "blocked", bookingId: null, holdExpiresAt: null, updatedAt: new Date() },
      });
  }

  if (release.length > 0) {
    // Only days this job was holding as a block come back. `booked` and `held`
    // days are left exactly where they are.
    await db
      .update(schema.calendarDays)
      .set({ state: "open", updatedAt: new Date() })
      .where(
        and(
          eq(schema.calendarDays.listingId, job.listingId),
          eq(schema.calendarDays.session, job.session),
          inArray(schema.calendarDays.day, release),
          eq(schema.calendarDays.state, "blocked"),
        ),
      );
  }
}

export async function createJob(
  partnerId: string,
  actorId: string,
  input: JobInput,
): Promise<typeof schema.partnerJobs.$inferSelect> {
  let clientId = input.clientId ?? null;
  if (!clientId && input.client?.nameAr) {
    const client = await upsertClient(partnerId, input.client, actorId);
    clientId = client.id;
  }

  const [job] = await db
    .insert(schema.partnerJobs)
    .values({
      partnerId,
      listingId: input.listingId ?? null,
      clientId,
      source: input.source ?? "direct",
      kind: input.kind ?? "event",
      titleAr: input.titleAr,
      day: input.day,
      endDay: input.endDay ?? null,
      session: input.session ?? "night",
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      status: input.status ?? "confirmed",
      price: input.price ?? 0,
      amountPaid: input.amountPaid ?? 0,
      locationAr: input.locationAr ?? null,
      notesAr: input.notesAr ?? null,
      blocksCalendar: input.blocksCalendar ?? true,
      createdById: actorId,
    })
    .returning();

  await syncJobToCalendar(job!);
  if (clientId) await refreshClientTotals(clientId);

  /*
   * The event carries the shape of the work and never the customer. `source`
   * is the valuable field — across the whole marketplace it answers "how much
   * of Libya's chalet and wedding business is Ciao actually winning", which is
   * a question nobody in this market can answer today, including us.
   */
  track(
    "partner.job_created",
    {
      source: job!.source,
      kind: job!.kind,
      linked: Boolean(job!.bookingId),
      hasPrice: (job!.price ?? 0) > 0,
      leadDays: Math.max(
        0,
        Math.round(
          (new Date(`${job!.day}T00:00:00Z`).getTime() - Date.now()) / 86_400_000,
        ),
      ),
    },
    { userId: actorId, source: "api" },
  );
  return job!;
}

export async function updateJob(
  partnerId: string,
  actorId: string,
  jobId: string,
  patch: Partial<JobInput>,
): Promise<typeof schema.partnerJobs.$inferSelect> {
  const [existing] = await db
    .select()
    .from(schema.partnerJobs)
    .where(eq(schema.partnerJobs.id, jobId))
    .limit(1);
  if (!existing || existing.partnerId !== partnerId) throw new CiaoError("AUTH_FORBIDDEN");

  /*
   * A job that mirrors a Ciao booking is not editable here in the ways that
   * would make the two disagree. Dates and money belong to the booking and
   * move through the state machine; notes and the client record are the
   * partner's own and are theirs to change. Refusing the whole edit would be
   * worse — the partner's note about where to park is exactly what they want
   * to write on a Ciao booking too.
   */
  const linked = Boolean(existing.bookingId);
  const guarded: (keyof JobInput)[] = ["day", "endDay", "session", "price", "status", "listingId"];
  if (linked) {
    for (const key of guarded) {
      if (patch[key] !== undefined) {
        throw new CiaoError("VALIDATION", {
          field: key,
          reasonAr: "هذا الحجز من تشاو — التواريخ والمبالغ تُدار من صفحة الحجز نفسها",
          reasonEn: "This is a Ciao booking — dates and amounts are managed from the booking itself",
        });
      }
    }
  }

  let clientId = patch.clientId !== undefined ? patch.clientId : existing.clientId;
  if (patch.client?.nameAr) {
    const client = await upsertClient(partnerId, patch.client, actorId);
    clientId = client.id;
  }

  const previousDays = jobDays(existing.day, existing.endDay);
  const status = (patch.status ?? existing.status) as JobStatus;

  const [job] = await db
    .update(schema.partnerJobs)
    .set({
      listingId: patch.listingId !== undefined ? patch.listingId : existing.listingId,
      clientId,
      source: patch.source ?? existing.source,
      kind: patch.kind ?? existing.kind,
      titleAr: patch.titleAr ?? existing.titleAr,
      day: patch.day ?? existing.day,
      endDay: patch.endDay !== undefined ? patch.endDay : existing.endDay,
      session: patch.session ?? existing.session,
      startTime: patch.startTime !== undefined ? patch.startTime : existing.startTime,
      endTime: patch.endTime !== undefined ? patch.endTime : existing.endTime,
      status,
      price: patch.price ?? existing.price,
      amountPaid: patch.amountPaid ?? existing.amountPaid,
      locationAr: patch.locationAr !== undefined ? patch.locationAr : existing.locationAr,
      notesAr: patch.notesAr !== undefined ? patch.notesAr : existing.notesAr,
      blocksCalendar: patch.blocksCalendar ?? existing.blocksCalendar,
      completedAt: status === "done" ? (existing.completedAt ?? new Date()) : null,
      cancelledAt: status === "cancelled" ? (existing.cancelledAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.partnerJobs.id, jobId))
    .returning();

  await syncJobToCalendar(job!, previousDays);
  if (clientId) await refreshClientTotals(clientId);
  if (existing.clientId && existing.clientId !== clientId) {
    await refreshClientTotals(existing.clientId);
  }

  if (status === "done" && existing.status !== "done") {
    track(
      "partner.job_completed",
      { source: job!.source, kind: job!.kind, linked, paidInFull: job!.amountPaid >= job!.price },
      { userId: actorId, source: "api" },
    );
  }
  return job!;
}

/**
 * Mirror a Ciao booking into the partner's diary.
 *
 * Idempotent on `bookingId` (unique index), so the worker can re-run this as
 * often as it likes. Called on sync rather than on every booking transition,
 * because the diary needs the booking to exist and be current — not to
 * duplicate the booking's own lifecycle.
 */
export async function syncBookingsToJobs(partnerId: string): Promise<number> {
  const rows = await db
    .select({ booking: schema.bookings, listing: schema.listings })
    .from(schema.bookings)
    .innerJoin(schema.listings, eq(schema.bookings.listingId, schema.listings.id))
    .where(
      and(
        eq(schema.bookings.hostId, partnerId),
        inArray(schema.bookings.state, [
          "payment_held",
          "confirmed",
          "pre_arrival_reconfirmed",
          "checked_in",
          "completed",
          "reviewed",
        ]),
      ),
    )
    .orderBy(desc(schema.bookings.createdAt))
    .limit(500);

  let synced = 0;
  for (const { booking, listing } of rows) {
    const status: JobStatus =
      booking.state === "completed" || booking.state === "reviewed" || booking.state === "checked_in"
        ? "done"
        : booking.state === "payment_held"
          ? "enquiry"
          : "confirmed";
    /*
     * A stay's `checkOut` is the morning the guest leaves, so the last night
     * they occupy is the day before. A job's `endDay` is a day worked. Without
     * this the diary would show a chalet busy on a day it is free, and the
     * partner would decline a booking they could have taken.
     */
    const endDay =
      booking.checkOut && booking.checkIn && booking.checkOut > booking.checkIn
        ? new Date(new Date(`${booking.checkOut}T00:00:00Z`).getTime() - 86_400_000)
            .toISOString()
            .slice(0, 10)
        : null;

    const values = {
      partnerId,
      listingId: booking.listingId,
      bookingId: booking.id,
      source: "ciao" as const,
      kind: booking.type === "event_date" ? "event" : booking.type === "day_use" ? "day_use" : "stay",
      titleAr: `${listing.titleAr} — ${booking.code}`,
      day: booking.checkIn ?? new Date().toISOString().slice(0, 10),
      endDay,
      session: booking.session,
      status,
      // What the partner earns, not what the guest paid: the deposit less our
      // commission, plus the cash they collect at the door. Showing gross here
      // and net on the payout screen is how a partner ends up believing one of
      // the two numbers is a lie.
      price: booking.depositAmount - booking.commissionAmount + booking.balanceOnArrival,
      amountPaid: ["confirmed", "pre_arrival_reconfirmed", "checked_in", "completed", "reviewed"].includes(
        booking.state,
      )
        ? booking.depositAmount - booking.commissionAmount
        : 0,
      blocksCalendar: false, // the booking already holds the calendar itself
      updatedAt: new Date(),
    };

    await db
      .insert(schema.partnerJobs)
      .values(values)
      .onConflictDoUpdate({
        target: schema.partnerJobs.bookingId,
        set: {
          status: values.status,
          day: values.day,
          endDay: values.endDay,
          price: values.price,
          amountPaid: values.amountPaid,
          updatedAt: new Date(),
        },
      });
    synced++;
  }
  return synced;
}

// ---------------------------------------------------------------- calendar
export interface CalendarDay {
  day: string;
  /** open | blocked | booked | held — the listing-level truth. */
  state: string;
  jobs: {
    id: string;
    titleAr: string;
    status: string;
    source: string;
    startTime: string | null;
    clientNameAr: string | null;
    bookingCode: string | null;
  }[];
  /** True when the day is at or over `maxJobsPerDay`. */
  full: boolean;
}

/**
 * One month of the partner's world, merged.
 *
 * Three sources have to agree on this screen or it is worse than useless: the
 * listing calendar (what the marketplace will sell), the diary (what the
 * partner knows they are doing), and the load rule (how much fits in a day).
 * Merging them server-side rather than in the console means the WhatsApp
 * agenda, the console and any future native app can never disagree about
 * whether a Thursday is free.
 */
export async function calendarMonth(
  partnerId: string,
  yearMonth: string,
  listingId?: string | null,
): Promise<{ days: CalendarDay[]; maxJobsPerDay: number }> {
  const first = `${yearMonth}-01`;
  const start = new Date(`${first}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) throw new CiaoError("VALIDATION", { field: "month" });
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const lastDay = new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10);

  const profile = await ensureProfile(partnerId);
  const listingIds = listingId
    ? [listingId]
    : (
        await db
          .select({ id: schema.listings.id })
          .from(schema.listings)
          .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
          .where(eq(schema.venues.hostId, partnerId))
      ).map((r) => r.id);

  const calRows = listingIds.length
    ? await db
        .select()
        .from(schema.calendarDays)
        .where(
          and(
            inArray(schema.calendarDays.listingId, listingIds),
            gte(schema.calendarDays.day, first),
            lte(schema.calendarDays.day, lastDay),
          ),
        )
    : [];

  const jobRows = await db
    .select({
      job: schema.partnerJobs,
      clientName: schema.partnerClients.nameAr,
      bookingCode: schema.bookings.code,
    })
    .from(schema.partnerJobs)
    .leftJoin(schema.partnerClients, eq(schema.partnerJobs.clientId, schema.partnerClients.id))
    .leftJoin(schema.bookings, eq(schema.partnerJobs.bookingId, schema.bookings.id))
    .where(
      and(
        eq(schema.partnerJobs.partnerId, partnerId),
        ne(schema.partnerJobs.status, "cancelled"),
        lte(schema.partnerJobs.day, lastDay),
        or(isNull(schema.partnerJobs.endDay), gte(schema.partnerJobs.endDay, first)),
        listingId ? eq(schema.partnerJobs.listingId, listingId) : sql`true`,
      ),
    );

  const byDay = new Map<string, CalendarDay>();
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, { day: key, state: "open", jobs: [], full: false });
  }

  const now = new Date();
  for (const row of calRows) {
    const entry = byDay.get(row.day);
    if (!entry) continue;
    // An expired hold is an open day. Showing it as held would have a partner
    // decline work over a checkout somebody abandoned an hour ago.
    const effective =
      row.state === "held" && row.holdExpiresAt && row.holdExpiresAt <= now ? "open" : row.state;
    // Across several listings the busiest state wins, because the question the
    // partner is asking of a month grid is "can I take work that day".
    const rank: Record<string, number> = { open: 0, held: 1, blocked: 2, booked: 3 };
    if ((rank[effective] ?? 0) >= (rank[entry.state] ?? 0)) entry.state = effective;
  }

  for (const { job, clientName, bookingCode } of jobRows) {
    for (const day of jobDays(job.day, job.endDay)) {
      const entry = byDay.get(day);
      if (!entry) continue;
      entry.jobs.push({
        id: job.id,
        titleAr: job.titleAr,
        status: job.status,
        source: job.source,
        startTime: job.startTime,
        clientNameAr: clientName ?? null,
        bookingCode: bookingCode ?? null,
      });
    }
  }

  for (const entry of byDay.values()) {
    const occupying = entry.jobs.filter((j) => jobOccupies(j.status)).length;
    entry.full = occupying >= profile.maxJobsPerDay;
    entry.jobs.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  }

  return {
    days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    maxJobsPerDay: profile.maxJobsPerDay,
  };
}

// ---------------------------------------------------------------- agenda
/**
 * What is happening today and tomorrow — the screen a make-up artist opens at
 * seven in the morning, and the message she gets the evening before.
 *
 * Deliberately not a filtered view of the jobs list. It answers four questions
 * in the order they are actually asked: what am I doing, who is it for, where,
 * and what do they still owe me.
 */
export async function agenda(
  partnerId: string,
  fromDay: string,
  days = 2,
): Promise<{
  day: string;
  jobs: {
    id: string;
    titleAr: string;
    status: string;
    source: string;
    startTime: string | null;
    endTime: string | null;
    locationAr: string | null;
    notesAr: string | null;
    price: number;
    amountPaid: number;
    balanceDue: number;
    clientNameAr: string | null;
    clientPhone: string | null;
    bookingCode: string | null;
  }[];
}[]> {
  const start = new Date(`${fromDay}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) throw new CiaoError("VALIDATION", { field: "from" });
  const endDate = new Date(start.getTime() + (days - 1) * 86_400_000);
  const last = endDate.toISOString().slice(0, 10);

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
        inArray(schema.partnerJobs.status, ["confirmed", "done", "quoted", "enquiry"]),
        lte(schema.partnerJobs.day, last),
        or(isNull(schema.partnerJobs.endDay), gte(schema.partnerJobs.endDay, fromDay)),
      ),
    )
    .orderBy(asc(schema.partnerJobs.startTime));

  const out: Awaited<ReturnType<typeof agenda>> = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    out.push({
      day,
      jobs: rows
        .filter(({ job }) => jobDays(job.day, job.endDay).includes(day))
        .map(({ job, clientName, clientPhone, bookingCode }) => ({
          id: job.id,
          titleAr: job.titleAr,
          status: job.status,
          source: job.source,
          startTime: job.startTime,
          endTime: job.endTime,
          locationAr: job.locationAr,
          notesAr: job.notesAr,
          price: job.price,
          amountPaid: job.amountPaid,
          balanceDue: Math.max(0, job.price - job.amountPaid),
          clientNameAr: clientName ?? null,
          clientPhone: clientPhone ?? null,
          bookingCode: bookingCode ?? null,
        })),
    });
  }
  return out;
}
