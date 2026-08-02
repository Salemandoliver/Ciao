/**
 * Quotes.
 *
 * The workflow a Libyan photographer or make-up artist actually runs is
 * enquiry → quote → deposit → job → delivery, and every step of it currently
 * happens in a WhatsApp thread. The quote is a voice note or a photograph of a
 * page in a notebook. It gets misremembered on both sides, it gets renegotiated
 * at the door on the morning of a wedding, and there is no version anyone can
 * point at.
 *
 * Giving her a priced, dated, shareable quote is the single highest-value
 * thing in this console, and it is not a hard feature — which is exactly why
 * it is worth doing properly:
 *
 *  - The customer opens it **without an account**. Requiring one here would
 *    kill the send, and the send is the whole point.
 *  - Accepting it creates the job and takes the day off the calendar in one
 *    step, so the thing she was going to forget is done for her.
 *  - It says plainly who the agreement is between. Ciao is not a party to a
 *    direct quote and does not take a commission on it, and the page says so
 *    rather than leaving the customer to wonder what our cut is.
 */
import { and, desc, eq, lt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { track } from "../intelligence/events.js";
import { createJob, quoteCode, upsertClient } from "./service.js";

export const lineItemSchema = z.object({
  labelAr: z.string().min(1).max(120),
  qty: z.number().min(0).max(10_000).default(1),
  unitPrice: z.number().int().min(0).max(1_000_000_000),
});
export type LineItem = z.infer<typeof lineItemSchema>;

/**
 * Totals are computed here and never taken from the client.
 *
 * A quote whose total the browser could set is a quote a customer could edit
 * before accepting — and since accepting creates a job at that price, that is
 * a straightforward way to book a wedding photographer for one dinar.
 */
export function priceQuote(items: LineItem[], discount = 0, depositBps = 0) {
  const subtotal = items.reduce((s, i) => s + Math.round(i.qty * i.unitPrice), 0);
  const cappedDiscount = Math.min(Math.max(0, discount), subtotal);
  const total = subtotal - cappedDiscount;
  return {
    subtotal,
    discount: cappedDiscount,
    total,
    depositAmount: Math.round((total * Math.min(Math.max(depositBps, 0), 10_000)) / 10_000),
  };
}

export interface QuoteInput {
  clientId?: string | null;
  client?: { nameAr: string; phone?: string | null } | null;
  listingId?: string | null;
  titleAr: string;
  lineItems: LineItem[];
  discount?: number;
  depositBps?: number;
  proposedDay?: string | null;
  session?: string | null;
  startTime?: string | null;
  validUntil?: string | null;
  notesAr?: string | null;
  termsAr?: string | null;
}

export async function createQuote(
  partnerId: string,
  actorId: string,
  input: QuoteInput,
): Promise<typeof schema.partnerQuotes.$inferSelect> {
  let clientId = input.clientId ?? null;
  if (!clientId && input.client?.nameAr) {
    clientId = (await upsertClient(partnerId, input.client, actorId)).id;
  }
  const priced = priceQuote(input.lineItems, input.discount ?? 0, input.depositBps ?? 0);

  const [quote] = await db
    .insert(schema.partnerQuotes)
    .values({
      code: quoteCode(),
      partnerId,
      clientId,
      listingId: input.listingId ?? null,
      titleAr: input.titleAr,
      lineItems: input.lineItems,
      subtotal: priced.subtotal,
      discount: priced.discount,
      total: priced.total,
      depositAmount: priced.depositAmount,
      proposedDay: input.proposedDay ?? null,
      session: input.session ?? null,
      startTime: input.startTime ?? null,
      validUntil: input.validUntil ?? null,
      notesAr: input.notesAr ?? null,
      termsAr: input.termsAr ?? null,
      status: "draft",
      createdById: actorId,
    })
    .returning();
  return quote!;
}

export async function updateQuote(
  partnerId: string,
  quoteId: string,
  input: Partial<QuoteInput> & { status?: "draft" | "sent" | "withdrawn" },
): Promise<typeof schema.partnerQuotes.$inferSelect> {
  const [existing] = await db
    .select()
    .from(schema.partnerQuotes)
    .where(eq(schema.partnerQuotes.id, quoteId))
    .limit(1);
  if (!existing || existing.partnerId !== partnerId) throw new CiaoError("AUTH_FORBIDDEN");
  /*
   * Once accepted a quote is frozen. It is the record of what was agreed, and
   * a document that can be edited after agreement is not a record of anything
   * — which is precisely the problem it was built to solve. Changing the deal
   * means a new quote, which is also how the customer finds out it changed.
   */
  if (existing.status === "accepted") {
    throw new CiaoError("VALIDATION", {
      field: "status",
      reasonAr: "العرض مقبول — أنشئ عرضًا جديدًا بدل تعديله",
      reasonEn: "This quote was accepted — create a new one rather than editing it",
    });
  }

  const lineItems = (input.lineItems ?? (existing.lineItems as LineItem[])) ?? [];
  const depositBps =
    input.depositBps ??
    (existing.total > 0 ? Math.round((existing.depositAmount / existing.total) * 10_000) : 0);
  const priced = priceQuote(lineItems, input.discount ?? existing.discount, depositBps);

  const [quote] = await db
    .update(schema.partnerQuotes)
    .set({
      titleAr: input.titleAr ?? existing.titleAr,
      lineItems,
      subtotal: priced.subtotal,
      discount: priced.discount,
      total: priced.total,
      depositAmount: priced.depositAmount,
      proposedDay: input.proposedDay !== undefined ? input.proposedDay : existing.proposedDay,
      session: input.session !== undefined ? input.session : existing.session,
      startTime: input.startTime !== undefined ? input.startTime : existing.startTime,
      validUntil: input.validUntil !== undefined ? input.validUntil : existing.validUntil,
      notesAr: input.notesAr !== undefined ? input.notesAr : existing.notesAr,
      termsAr: input.termsAr !== undefined ? input.termsAr : existing.termsAr,
      status: input.status ?? existing.status,
      sentAt: input.status === "sent" ? (existing.sentAt ?? new Date()) : existing.sentAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.partnerQuotes.id, quoteId))
    .returning();

  if (input.status === "sent" && existing.status !== "sent") {
    track(
      "partner.quote_sent",
      { total: quote!.total, lines: lineItems.length, hasDay: Boolean(quote!.proposedDay) },
      { userId: partnerId, source: "api" },
    );
  }
  return quote!;
}

/**
 * The public view of a quote — what the customer opens from WhatsApp.
 *
 * Everything not needed to decide is left out. The partner's other work, their
 * earnings, the customer's own history with them: none of it belongs on a page
 * whose URL is a six-character code sitting in a forwarded message.
 */
export async function publicQuote(code: string) {
  const [row] = await db
    .select({
      quote: schema.partnerQuotes,
      businessNameAr: schema.partnerProfiles.businessNameAr,
      businessNameEn: schema.partnerProfiles.businessNameEn,
      partnerName: schema.users.displayName,
      clientNameAr: schema.partnerClients.nameAr,
    })
    .from(schema.partnerQuotes)
    .leftJoin(schema.partnerProfiles, eq(schema.partnerQuotes.partnerId, schema.partnerProfiles.userId))
    .leftJoin(schema.users, eq(schema.partnerQuotes.partnerId, schema.users.id))
    .leftJoin(schema.partnerClients, eq(schema.partnerQuotes.clientId, schema.partnerClients.id))
    .where(eq(schema.partnerQuotes.code, code))
    .limit(1);
  if (!row) throw new CiaoError("BOOKING_NOT_FOUND");
  // A draft has not been sent to anybody, so as far as the world is concerned
  // it does not exist — including to someone guessing codes.
  if (row.quote.status === "draft") throw new CiaoError("BOOKING_NOT_FOUND");

  const expired =
    row.quote.status === "expired" ||
    Boolean(row.quote.validUntil && row.quote.validUntil < new Date().toISOString().slice(0, 10));

  return {
    code: row.quote.code,
    titleAr: row.quote.titleAr,
    businessNameAr: row.businessNameAr ?? row.partnerName ?? null,
    businessNameEn: row.businessNameEn ?? null,
    clientNameAr: row.clientNameAr ?? null,
    lineItems: row.quote.lineItems,
    subtotal: row.quote.subtotal,
    discount: row.quote.discount,
    total: row.quote.total,
    depositAmount: row.quote.depositAmount,
    proposedDay: row.quote.proposedDay,
    session: row.quote.session,
    startTime: row.quote.startTime,
    validUntil: row.quote.validUntil,
    notesAr: row.quote.notesAr,
    termsAr: row.quote.termsAr,
    status: expired && row.quote.status === "sent" ? "expired" : row.quote.status,
    /** Stated on the page: this is an agreement with the business, not with us. */
    platformRole: "listing" as const,
  };
}

/** Record that the customer opened it — the difference between two conversations. */
export async function recordQuoteView(code: string): Promise<void> {
  await db
    .update(schema.partnerQuotes)
    .set({
      viewCount: sql`${schema.partnerQuotes.viewCount} + 1`,
      lastViewedAt: new Date(),
    })
    .where(and(eq(schema.partnerQuotes.code, code), eq(schema.partnerQuotes.status, "sent")));
}

/**
 * The customer accepts. This is the moment the quote earns its keep: the job
 * appears in the diary and the day comes off the calendar without the partner
 * touching anything.
 */
export async function acceptQuote(
  code: string,
  decision: "accept" | "decline",
): Promise<{ status: string; jobId?: string }> {
  const [quote] = await db
    .select()
    .from(schema.partnerQuotes)
    .where(eq(schema.partnerQuotes.code, code))
    .limit(1);
  if (!quote) throw new CiaoError("BOOKING_NOT_FOUND");
  if (quote.status === "accepted") {
    // Idempotent: a customer who double-taps "accept" on a bad connection —
    // which is most of them — must not create a second job.
    return { status: "accepted", jobId: quote.jobId ?? undefined };
  }
  if (quote.status !== "sent") {
    throw new CiaoError("VALIDATION", {
      field: "status",
      reasonAr: "هذا العرض لم يعد متاحًا",
      reasonEn: "This quote is no longer available",
    });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (quote.validUntil && quote.validUntil < today) {
    await db
      .update(schema.partnerQuotes)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(schema.partnerQuotes.id, quote.id));
    throw new CiaoError("VALIDATION", {
      field: "validUntil",
      reasonAr: "انتهت صلاحية هذا العرض — اطلب عرضًا جديدًا",
      reasonEn: "This quote has expired — ask for a new one",
    });
  }

  if (decision === "decline") {
    await db
      .update(schema.partnerQuotes)
      .set({ status: "declined", respondedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.partnerQuotes.id, quote.id));
    return { status: "declined" };
  }

  const job = await createJob(quote.partnerId, quote.partnerId, {
    listingId: quote.listingId,
    clientId: quote.clientId,
    source: "direct",
    kind: "appointment",
    titleAr: quote.titleAr,
    day: quote.proposedDay ?? today,
    session: quote.session ?? "night",
    startTime: quote.startTime,
    status: "confirmed",
    price: quote.total,
    amountPaid: 0,
    notesAr: quote.notesAr,
    // A quote with no date agreed is a price agreement, not a booking, so it
    // must not silently take today off the calendar.
    blocksCalendar: Boolean(quote.proposedDay),
  });

  await db
    .update(schema.partnerQuotes)
    .set({
      status: "accepted",
      respondedAt: new Date(),
      jobId: job.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.partnerQuotes.id, quote.id));

  track(
    "partner.quote_accepted",
    { total: quote.total, daysToDecide: quote.sentAt
        ? Math.round((Date.now() - quote.sentAt.getTime()) / 86_400_000)
        : 0 },
    { userId: quote.partnerId, source: "api" },
  );

  return { status: "accepted", jobId: job.id };
}

export async function listQuotes(partnerId: string, status?: string) {
  const rows = await db
    .select({
      quote: schema.partnerQuotes,
      clientNameAr: schema.partnerClients.nameAr,
      clientPhone: schema.partnerClients.phone,
    })
    .from(schema.partnerQuotes)
    .leftJoin(schema.partnerClients, eq(schema.partnerQuotes.clientId, schema.partnerClients.id))
    .where(
      status
        ? and(eq(schema.partnerQuotes.partnerId, partnerId), eq(schema.partnerQuotes.status, status))
        : eq(schema.partnerQuotes.partnerId, partnerId),
    )
    .orderBy(desc(schema.partnerQuotes.createdAt))
    .limit(200);
  return rows.map(({ quote, clientNameAr, clientPhone }) => ({
    id: quote.id,
    code: quote.code,
    titleAr: quote.titleAr,
    total: quote.total,
    depositAmount: quote.depositAmount,
    status: quote.status,
    proposedDay: quote.proposedDay,
    validUntil: quote.validUntil,
    viewCount: quote.viewCount,
    lastViewedAt: quote.lastViewedAt,
    sentAt: quote.sentAt,
    clientNameAr,
    clientPhone,
    lineItems: quote.lineItems,
    jobId: quote.jobId,
  }));
}

/**
 * Worker sweep: a sent quote past its validity becomes expired.
 *
 * Doing this on a schedule rather than only on read means the partner's list
 * tells the truth without her opening it, and the "3 quotes waiting" count on
 * her dashboard never includes one that lapsed a month ago.
 */
export async function expireStaleQuotes(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .update(schema.partnerQuotes)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        inArray(schema.partnerQuotes.status, ["sent"]),
        sql`${schema.partnerQuotes.validUntil} is not null`,
        lt(schema.partnerQuotes.validUntil, today),
      ),
    )
    .returning({ id: schema.partnerQuotes.id });
  return rows.length;
}
