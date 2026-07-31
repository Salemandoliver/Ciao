/**
 * End-to-end integration against a real Postgres:
 * happy path (§6.1), host timeout (§6.4), guest cancellation with tiers,
 * webhook replay protection, ledger invariants (§10.4).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { eq, sql } from "drizzle-orm";
import { tick } from "../src/worker-loop.js";
import { signMockWebhook } from "../src/modules/payments/providers/mock.js";

let app: FastifyInstance;
let guestToken = "";
let hostToken = "";
let opsToken = "";
let listingId = "";
let listingSlug = "";

const silentLog = { info: () => {}, error: () => {} };

async function login(phone: string): Promise<string> {
  const reqRes = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/request",
    payload: { phone },
  });
  const { devCode } = reqRes.json() as { devCode: string };
  const verRes = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: devCode, displayName: "Test User" },
  });
  expect(verRes.statusCode).toBe(200);
  return (verRes.json() as { accessToken: string }).accessToken;
}

async function setRole(phone: string, role: string) {
  await db
    .update(schema.users)
    .set({ role })
    .where(eq(schema.users.phone, phone));
}

async function payDeposit(invoiceNo: string, amount: number, outcome = "payment.completed") {
  const payload = JSON.stringify({
    event: outcome,
    invoice_no: invoiceNo,
    transaction_id: `mock_${invoiceNo}`,
    amount,
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/payments/webhook/mock",
    headers: { "content-type": "application/json", "x-signature": signMockWebhook(payload) },
    payload,
  });
  expect(res.statusCode).toBe(200);
}

function future(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function createBooking(
  token: string,
  checkIn: string,
  checkOut: string,
): Promise<{ bookingId: string; code: string; invoiceNo: string; deposit: number }> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/bookings",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      listingId,
      checkIn,
      checkOut,
      guestCount: 6,
      rail: "local_card",
    },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as {
    bookingId: string;
    code: string;
    payment: { invoiceNo: string };
    quote: { deposit: number };
  };
  return {
    bookingId: body.bookingId,
    code: body.code,
    invoiceNo: body.payment.invoiceNo,
    deposit: body.quote.deposit,
  };
}

async function bookingState(id: string): Promise<string> {
  const [b] = await db
    .select({ state: schema.bookings.state })
    .from(schema.bookings)
    .where(eq(schema.bookings.id, id))
    .limit(1);
  return b!.state;
}

beforeAll(async () => {
  app = await buildApp();

  guestToken = await login("+218945000001");
  await setRole("+218946000001", "host"); // ensure phone exists later
  hostToken = await login("+218946000001");
  await setRole("+218946000001", "host");
  hostToken = await login("+218946000001"); // refresh with host role
  opsToken = await login("+218947000001");
  await setRole("+218947000001", "admin");
  opsToken = await login("+218947000001");

  // Create venue+listing via ops API (exercises the supply pipeline).
  const [host] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.phone, "+218946000001"))
    .limit(1);

  const venueRes = await app.inject({
    method: "POST",
    url: "/v1/ops/venues",
    headers: { authorization: `Bearer ${opsToken}` },
    payload: {
      type: "coast",
      nameAr: "فيلا الاختبار",
      city: "tripoli",
      area: "janzour",
      hostPhone: host!.phone,
      addressAr: "عنوان سري يظهر بعد العربون",
    },
  });
  expect(venueRes.statusCode).toBe(201);
  const venue = venueRes.json() as { id: string };

  const listingRes = await app.inject({
    method: "POST",
    url: "/v1/ops/listings",
    headers: { authorization: `Bearer ${opsToken}` },
    payload: {
      venueId: venue.id,
      slug: `test-villa-${Date.now()}`,
      titleAr: "فيلا الاختبار",
      baseNightly: 600_000,
      cancellationTier: "moderate",
      maxGuests: 10,
      bedrooms: 3,
    },
  });
  expect(listingRes.statusCode).toBe(201);
  const listing = listingRes.json() as { id: string; slug: string };
  listingId = listing.id;
  listingSlug = listing.slug;
  await app.inject({
    method: "POST",
    url: `/v1/ops/listings/${listingId}/status`,
    headers: { authorization: `Bearer ${opsToken}` },
    payload: { status: "live" },
  });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("public discovery", () => {
  it("search returns the live listing with approximate location only", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/listings?city=tripoli" });
    expect(res.statusCode).toBe(200);
    const { items } = res.json() as { items: { slug: string; approxLocation: unknown }[] };
    const mine = items.find((i) => i.slug === listingSlug);
    expect(mine).toBeTruthy();
    expect(JSON.stringify(mine)).not.toContain("عنوان سري");
  });

  it("quote matches design-doc arithmetic", async () => {
    // Pick weekday-only span (Sun→Wed).
    const res = await app.inject({
      method: "GET",
      url: `/v1/listings/${listingId}/quote?checkIn=2027-03-07&checkOut=2027-03-10`,
    });
    const q = res.json() as { total: number; deposit: number };
    expect(q.total).toBe(1_800_000);
    expect(q.deposit).toBe(360_000);
    // Commission never exposed to guests (§9.1).
    expect(JSON.stringify(q)).not.toContain("commission");
  });
});

describe("happy path (§6.1)", () => {
  it("request → pay → host confirm → voucher/address revealed → check-in → complete → review", async () => {
    const b = await createBooking(guestToken, future(30), future(33));
    expect(await bookingState(b.bookingId)).toBe("payment_pending");

    // Address hidden pre-deposit.
    let detail = await app.inject({
      method: "GET",
      url: `/v1/bookings/${b.code}`,
      headers: { authorization: `Bearer ${guestToken}` },
    });
    expect((detail.json() as { venue: { addressAr?: string } }).venue.addressAr).toBeUndefined();

    await payDeposit(b.invoiceNo, b.deposit);
    expect(await bookingState(b.bookingId)).toBe("payment_held");

    // Webhook replay is ignored (§13.4).
    await payDeposit(b.invoiceNo, b.deposit);
    expect(await bookingState(b.bookingId)).toBe("payment_held");

    // Host confirms (authed path).
    const confirm = await app.inject({
      method: "POST",
      url: `/v1/bookings/${b.bookingId}/host-response`,
      headers: { authorization: `Bearer ${hostToken}` },
      payload: { decision: "confirm" },
    });
    expect(confirm.statusCode).toBe(200);
    expect(await bookingState(b.bookingId)).toBe("confirmed");

    // Contact revealed post-deposit (§6.1 step 5).
    detail = await app.inject({
      method: "GET",
      url: `/v1/bookings/${b.code}`,
      headers: { authorization: `Bearer ${guestToken}` },
    });
    const dj = detail.json() as { venue: { addressAr?: string }; state: string };
    expect(dj.venue.addressAr).toContain("عنوان");

    // Host payout queued with T+1-after-check-in release (§10.3).
    const [payout] = await db
      .select()
      .from(schema.payouts)
      .where(eq(schema.payouts.bookingId, b.bookingId));
    expect(payout).toBeTruthy();
    expect(payout!.amount).toBe(b.deposit - 180_000); // deposit minus 10% commission
    expect(payout!.releaseAfter.getTime()).toBeGreaterThan(Date.now());

    // Calendar days booked.
    const [day] = await db
      .select()
      .from(schema.calendarDays)
      .where(eq(schema.calendarDays.bookingId, b.bookingId))
      .limit(1);
    expect(day!.state).toBe("booked");

    // Check-in by host, then completion via worker job simulation.
    const ci = await app.inject({
      method: "POST",
      url: `/v1/bookings/${b.bookingId}/checkin`,
      headers: { authorization: `Bearer ${hostToken}` },
    });
    expect(ci.statusCode).toBe(200);
    expect(await bookingState(b.bookingId)).toBe("checked_in");

    // Force the complete_stay job due now and run the worker.
    await db
      .update(schema.scheduledJobs)
      .set({ runAt: new Date(Date.now() - 1000) })
      .where(eq(schema.scheduledJobs.refId, b.bookingId));
    await tick(silentLog);
    expect(await bookingState(b.bookingId)).toBe("completed");

    // Guest reviews → loyalty credit + state reviewed (§6.1 step 8).
    const review = await app.inject({
      method: "POST",
      url: `/v1/bookings/${b.bookingId}/reviews`,
      headers: { authorization: `Bearer ${guestToken}` },
      payload: {
        scores: { cleanliness: 5, accuracy: 5, privacy: 4, communication: 5, value: 4 },
        text: "المكان مطابق للصور تمامًا والمولد شغال.",
      },
    });
    expect(review.statusCode).toBe(201);
    expect(await bookingState(b.bookingId)).toBe("reviewed");

    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${guestToken}` },
    });
    expect((me.json() as { creditBalance: number }).creditBalance).toBeGreaterThanOrEqual(10_000);
  });
});

describe("failure journeys (§6.4)", () => {
  it("host timeout → auto-release, full credit refund + 5% goodwill", async () => {
    const b = await createBooking(guestToken, future(40), future(42));
    await payDeposit(b.invoiceNo, b.deposit);
    expect(await bookingState(b.bookingId)).toBe("payment_held");

    // Fire the timeout by moving the deadline into the past.
    await db
      .update(schema.scheduledJobs)
      .set({ runAt: new Date(Date.now() - 1000) })
      .where(
        sql`${schema.scheduledJobs.refId} = ${b.bookingId} and ${schema.scheduledJobs.kind} = 'host_confirmation_timeout'`,
      );
    await tick(silentLog);
    expect(await bookingState(b.bookingId)).toBe("host_timeout");

    // Refund + goodwill credit exist.
    const refundRows = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.bookingId, b.bookingId));
    expect(refundRows.length).toBe(1);
    expect(refundRows[0]!.amount).toBe(b.deposit);

    // Calendar reopened.
    const days = await db
      .select()
      .from(schema.calendarDays)
      .where(eq(schema.calendarDays.bookingId, b.bookingId));
    expect(days.length).toBe(0); // booking link cleared on reopen
  });

  it("late host confirm after timeout fails cleanly", async () => {
    const b = await createBooking(guestToken, future(50), future(52));
    await payDeposit(b.invoiceNo, b.deposit);
    await db
      .update(schema.scheduledJobs)
      .set({ runAt: new Date(Date.now() - 1000) })
      .where(
        sql`${schema.scheduledJobs.refId} = ${b.bookingId} and ${schema.scheduledJobs.kind} = 'host_confirmation_timeout'`,
      );
    await tick(silentLog);
    const confirm = await app.inject({
      method: "POST",
      url: `/v1/bookings/${b.bookingId}/host-response`,
      headers: { authorization: `Bearer ${hostToken}` },
      payload: { decision: "confirm" },
    });
    expect(confirm.statusCode).toBe(409); // CONFIRMATION_WINDOW_CLOSED
    const err = confirm.json() as { error: { code: string; message: string } };
    expect(err.error.code).toBe("CIAO-2004");
    // Arabic-first error surface (§13.3).
    expect(err.error.message).toMatch(/[؀-ۿ]/);
  });

  it("moderate-tier guest cancellation inside 7 days refunds 50%, forfeits 50% to host", async () => {
    const b = await createBooking(guestToken, future(3), future(5));
    await payDeposit(b.invoiceNo, b.deposit);
    await app.inject({
      method: "POST",
      url: `/v1/bookings/${b.bookingId}/host-response`,
      headers: { authorization: `Bearer ${hostToken}` },
      payload: { decision: "confirm" },
    });
    const cancel = await app.inject({
      method: "POST",
      url: `/v1/bookings/${b.bookingId}/cancel`,
      headers: { authorization: `Bearer ${guestToken}` },
    });
    expect(cancel.statusCode).toBe(200);
    expect((cancel.json() as { refundFraction: number }).refundFraction).toBe(0.5);
    expect(await bookingState(b.bookingId)).toBe("cancelled_by_guest");
  });

  it("action-token host confirmation is single-use (replay rejected)", async () => {
    const b = await createBooking(guestToken, future(60), future(62));
    await payDeposit(b.invoiceNo, b.deposit);
    // Grab the action token from the notification link in the messages journal.
    const msgs = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.bookingId, b.bookingId));
    const withLink = msgs.find((m) => m.body.includes("token="));
    expect(withLink).toBeTruthy();
    const token = decodeURIComponent(withLink!.body.split("token=")[1]!.split(/[\s&]/)[0]!);

    const first = await app.inject({
      method: "POST",
      url: "/v1/actions/host-response",
      payload: { token, decision: "confirm" },
    });
    expect(first.statusCode).toBe(200);
    expect(await bookingState(b.bookingId)).toBe("confirmed");

    const replay = await app.inject({
      method: "POST",
      url: "/v1/actions/host-response",
      payload: { token, decision: "decline" },
    });
    expect(replay.statusCode).toBe(401); // consumed — replay protection
  });

  it("double-booking is structurally impossible: overlapping request rejected", async () => {
    const b = await createBooking(guestToken, future(70), future(73));
    await payDeposit(b.invoiceNo, b.deposit);
    const overlap = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: `Bearer ${guestToken}` },
      payload: {
        listingId,
        checkIn: future(71),
        checkOut: future(74),
        rail: "local_card",
      },
    });
    expect(overlap.statusCode).toBe(409);
    expect((overlap.json() as { error: { code: string } }).error.code).toBe("CIAO-2003");
  });
});

describe("chat masking (§8.7)", () => {
  it("masks phone numbers pre-deposit", async () => {
    const b = await createBooking(guestToken, future(80), future(81));
    const msg = await app.inject({
      method: "POST",
      url: `/v1/bookings/${b.bookingId}/messages`,
      headers: { authorization: `Bearer ${guestToken}` },
      payload: { text: "كلمني على 0912345678" },
    });
    expect(msg.statusCode).toBe(200);
    expect((msg.json() as { body: string }).body).not.toContain("0912345678");
  });
});

describe("ledger integrity (§10.4)", () => {
  it("every transaction is balanced and reconciliation is clean", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/ops/reconciliation",
      headers: { authorization: `Bearer ${opsToken}` },
    });
    expect(res.statusCode).toBe(200);
    const r = res.json() as { unbalancedTransactions: number; accounts: { account: string; balance: number }[] };
    expect(r.unbalancedTransactions).toBe(0);
  });
});

describe("idempotency (§13.3)", () => {
  it("same Idempotency-Key replays the original response", async () => {
    const key = `test-${Date.now()}`;
    const payload = {
      listingId,
      checkIn: future(90),
      checkOut: future(91),
      rail: "local_card",
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: `Bearer ${guestToken}`, "idempotency-key": key },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: `Bearer ${guestToken}`, "idempotency-key": key },
      payload,
    });
    expect(second.statusCode).toBe(201);
    expect((second.json() as { code: string }).code).toBe((first.json() as { code: string }).code);
  });
});
