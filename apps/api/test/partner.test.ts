/**
 * The partner control panel's contract.
 *
 * Ordered by how much each failure would cost, which is not the same as how
 * likely it is:
 *
 *  - a team member reaching a business they do not work for, or staff reading
 *    the money screens — object-level authorisation is where marketplaces leak;
 *  - a payout destination that changes without the delay or the alert, which
 *    is the single highest-value attack against this platform;
 *  - a diary edit that moves a real booking, or a direct job that fails to
 *    take its day off the marketplace calendar — both produce a family at a
 *    gate that is already occupied;
 *  - a quote whose total the customer can set, or which books twice on a
 *    double tap;
 *  - premium market data served to somebody who has not paid for it, and a
 *    price benchmark computed from too few businesses to be anything but a
 *    competitor's price.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { signAccessToken } from "../src/lib/auth.js";
import { invalidateSettingsCache, setSettings } from "../src/modules/business/settings.js";
import { extractDays, parseCommand } from "../src/modules/partner/commands.js";
import { priceQuote } from "../src/modules/partner/quotes.js";
import { activatePayoutAccount, maskAccountRef } from "../src/modules/partner/money.js";
import { jobDays, partnerCan, plusActive } from "@ciao/shared";

let app: FastifyInstance;

/** A fresh cast per run, since these assert first-time behaviour against a live DB. */
const run = Date.now().toString().slice(-7);
const phones = {
  owner: `+2189470${run.slice(-5)}`,
  manager: `+2189471${run.slice(-5)}`,
  staff: `+2189472${run.slice(-5)}`,
  outsider: `+2189473${run.slice(-5)}`,
};

let owner = { id: "", token: "" };
let manager = { id: "", token: "" };
let staff = { id: "", token: "" };
let outsider = { id: "", token: "" };
let listingId = "";
let venueId = "";

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function makeUser(phone: string) {
  const [user] = await db
    .insert(schema.users)
    .values({ phone, role: "host", displayName: `partner-${phone.slice(-4)}` })
    .returning();
  const token = await signAccessToken({ sub: user!.id, role: "host", phone });
  return { id: user!.id, token };
}

beforeAll(async () => {
  app = await buildApp();
  owner = await makeUser(phones.owner);
  manager = await makeUser(phones.manager);
  staff = await makeUser(phones.staff);
  outsider = await makeUser(phones.outsider);

  const [venue] = await db
    .insert(schema.venues)
    .values({
      type: "coast",
      nameAr: `اختبار ${run}`,
      city: "tripoli",
      area: "janzour",
      hostId: owner.id,
      verifiedAt: new Date(),
      amenities: [],
    })
    .returning();
  venueId = venue!.id;
  const [listing] = await db
    .insert(schema.listings)
    .values({
      venueId: venue!.id,
      slug: `partner-test-${run}`,
      status: "live",
      titleAr: "شاليه اختبار",
      baseNightly: 600_000,
      media: [{ url: "/x.webp", kind: "image", order: 0 }],
    })
    .returning();
  listingId = listing!.id;

  await db.insert(schema.partnerTeam).values([
    { partnerId: owner.id, memberUserId: manager.id, role: "manager" },
    { partnerId: owner.id, memberUserId: staff.id, role: "staff" },
  ]);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

// ------------------------------------------------------------------ pure logic
describe("partner domain rules", () => {
  it("a job's days are inclusive of the last day worked", () => {
    // Unlike a stay, whose last night is the night before check-out. Getting
    // this backwards puts a chalet's diary one day out from its calendar.
    expect(jobDays("2026-08-14", "2026-08-16")).toEqual([
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
    expect(jobDays("2026-08-14")).toEqual(["2026-08-14"]);
    // A reversed range is a typo, not an instruction to write a year of rows.
    expect(jobDays("2026-08-16", "2026-08-14")).toEqual(["2026-08-16"]);
  });

  it("staff cannot reach money, and only an owner holds admin", () => {
    expect(partnerCan("staff", "diary")).toBe(true);
    expect(partnerCan("staff", "money")).toBe(false);
    expect(partnerCan("staff", "clients")).toBe(false);
    expect(partnerCan("manager", "money")).toBe(true);
    expect(partnerCan("manager", "admin")).toBe(false);
    expect(partnerCan("owner", "admin")).toBe(true);
  });

  it("a past-due subscription stays entitled", () => {
    // The fee is netted from payouts, so "past due" means we had no payout to
    // net it from — which happens to the partner having a quiet month. Cutting
    // off their market data at that exact moment would be both cruel and daft.
    const future = new Date(Date.now() + 86_400_000);
    expect(plusActive({ plan: "plus", status: "past_due", currentPeriodEnd: future })).toBe(true);
    expect(plusActive({ plan: "plus", status: "cancelled", currentPeriodEnd: future })).toBe(false);
    expect(
      plusActive({ plan: "plus", status: "trialing", trialEndsAt: new Date(Date.now() - 1000) }),
    ).toBe(false);
    expect(plusActive(null)).toBe(false);
  });

  it("a quote's total is computed, never accepted from the caller", () => {
    // A total the browser could set is a wedding photographer booked for one
    // dinar, since accepting creates the job at that price.
    const priced = priceQuote(
      [
        { labelAr: "تصوير", qty: 1, unitPrice: 2_000_000 },
        { labelAr: "ألبوم", qty: 2, unitPrice: 250_000 },
      ],
      100_000,
      2000,
    );
    expect(priced.subtotal).toBe(2_500_000);
    expect(priced.total).toBe(2_400_000);
    expect(priced.depositAmount).toBe(480_000);
    // A discount larger than the bill cannot make the total negative.
    expect(priceQuote([{ labelAr: "x", qty: 1, unitPrice: 1000 }], 99_999).total).toBe(0);
  });

  it("masks an account reference everywhere it appears", () => {
    expect(maskAccountRef("1234567890123")).toBe("•••• 0123");
    expect(maskAccountRef("12")).toBe("••••");
  });
});

// ------------------------------------------------------------------ commands
describe("WhatsApp commands", () => {
  const dec = new Date("2026-12-20T10:00:00Z");

  it("reads Libyan Arabic, Arabic-Indic digits and ranges", () => {
    expect(parseCommand("احجب 12-15/8", dec).kind).toBe("block");
    expect(parseCommand("افتح 14/8", dec).kind).toBe("open");
    expect(parseCommand("اليوم", dec).kind).toBe("agenda");
    expect(parseCommand("مساعدة", dec).kind).toBe("help");

    expect(extractDays("احجب 12-15/8", dec)).toEqual([
      "2027-08-12",
      "2027-08-13",
      "2027-08-14",
      "2027-08-15",
    ]);
    expect(extractDays("احجب ١٥/٨", dec)).toEqual(["2027-08-15"]);
    expect(extractDays("مشغول 15 أغسطس", dec)).toEqual(["2027-08-15"]);
    expect(extractDays("block 2026-12-25", dec)).toEqual(["2026-12-25"]);
  });

  it("a bare day/month means the NEXT one, never the one that has passed", () => {
    // "احجب 15/8" written in December means next August. Assuming the past is
    // the failure that silently does nothing and leaves the date sellable.
    expect(extractDays("15/8", dec)).toEqual(["2027-08-15"]);
    expect(extractDays("25/12", dec)).toEqual(["2026-12-25"]);
  });

  it("refuses an impossible date rather than rolling it into the next month", () => {
    // "احجب 31/9" must not quietly block the 1st of October.
    expect(extractDays("31/9", dec)).toEqual([]);
  });

  it("ignores a bare number with no month", () => {
    // "احجب 15" could be this month or next, and blocking the wrong one costs
    // a booking. Asking is better than guessing.
    expect(extractDays("احجب 15", dec)).toEqual([]);
  });

  it("blocks and opens days through the command path", async () => {
    const block = await app.inject({
      method: "POST",
      url: `/v1/partner/command?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { message: "احجب 2027-03-10" },
    });
    expect(block.statusCode).toBe(200);
    expect(block.json().changedDays).toContain("2027-03-10");

    const [row] = await db
      .select()
      .from(schema.calendarDays)
      .where(
        and(eq(schema.calendarDays.listingId, listingId), eq(schema.calendarDays.day, "2027-03-10")),
      );
    expect(row?.state).toBe("blocked");

    const open = await app.inject({
      method: "POST",
      url: `/v1/partner/command?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { message: "افتح 2027-03-10" },
    });
    expect(open.statusCode).toBe(200);
    const [after] = await db
      .select()
      .from(schema.calendarDays)
      .where(
        and(eq(schema.calendarDays.listingId, listingId), eq(schema.calendarDays.day, "2027-03-10")),
      );
    expect(after?.state).toBe("open");
  });
});

// ------------------------------------------------------------------ authorisation
describe("authorisation", () => {
  it("refuses a partnerId the caller has no membership for", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/partner/me?partnerId=${owner.id}`,
      headers: auth(outsider.token),
    });
    // Forbidden, not "not found" — the difference would let anyone enumerate
    // which user ids are businesses.
    expect(res.statusCode).toBe(403);
  });

  it("lets a manager act for the business but not touch the payout account", async () => {
    const me = await app.inject({
      method: "GET",
      url: `/v1/partner/me?partnerId=${owner.id}`,
      headers: auth(manager.token),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().role).toBe("manager");
    expect(me.json().capabilities).not.toContain("admin");

    const change = await app.inject({
      method: "POST",
      url: `/v1/partner/payout-account?partnerId=${owner.id}`,
      headers: auth(manager.token),
      payload: { rail: "bank_app", accountRef: "9999888877776666" },
    });
    expect(change.statusCode).toBe(403);
  });

  it("keeps money off every staff surface, not just the money tab", async () => {
    const money = await app.inject({
      method: "GET",
      url: `/v1/partner/money?partnerId=${owner.id}`,
      headers: auth(staff.token),
    });
    expect(money.statusCode).toBe(403);

    const insights = await app.inject({
      method: "GET",
      url: `/v1/partner/insights?partnerId=${owner.id}`,
      headers: auth(staff.token),
    });
    expect(insights.statusCode).toBe(403);

    const clients = await app.inject({
      method: "GET",
      url: `/v1/partner/clients?partnerId=${owner.id}`,
      headers: auth(staff.token),
    });
    expect(clients.statusCode).toBe(403);
  });

  it("zeroes the money on the agenda a staff member CAN see", async () => {
    // Staff need the day and the client's number to do the job; they must not
    // be able to read the business's takings off the same screen.
    await app.inject({
      method: "POST",
      url: `/v1/partner/jobs?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: {
        titleAr: "عرس تجريبي",
        day: "2027-04-01",
        price: 3_000_000,
        client: { nameAr: "أم محمد", phone: "0913334444" },
        listingId,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/partner/agenda?partnerId=${owner.id}&from=2027-04-01&days=1`,
      headers: auth(staff.token),
    });
    expect(res.statusCode).toBe(200);
    const job = res.json().days[0].jobs[0];
    expect(job.clientPhone).toBeTruthy(); // they can still ring the client
    expect(job.price).toBe(0);
    expect(job.balanceDue).toBe(0);
  });
});

// ------------------------------------------------------------------ the diary
describe("the diary", () => {
  it("a direct job takes its days off the marketplace calendar", async () => {
    // This is the mechanism that closes pitfall #2. The partner records the
    // wedding they took over WhatsApp; Ciao stops selling that Thursday.
    const res = await app.inject({
      method: "POST",
      url: `/v1/partner/jobs?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: {
        titleAr: "حجز من واتساب",
        day: "2027-05-20",
        endDay: "2027-05-22",
        source: "whatsapp",
        listingId,
        blocksCalendar: true,
      },
    });
    expect(res.statusCode).toBe(201);

    const rows = await db
      .select()
      .from(schema.calendarDays)
      .where(eq(schema.calendarDays.listingId, listingId));
    const blocked = rows.filter((r) => r.state === "blocked").map((r) => r.day);
    expect(blocked).toEqual(
      expect.arrayContaining(["2027-05-20", "2027-05-21", "2027-05-22"]),
    );
  });

  it("cancelling a job gives the days back", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/v1/partner/jobs?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { titleAr: "يلغى", day: "2027-06-05", listingId, blocksCalendar: true },
    });
    const jobId = created.json().job.id;

    await app.inject({
      method: "PATCH",
      url: `/v1/partner/jobs/${jobId}?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { status: "cancelled" },
    });

    const [row] = await db
      .select()
      .from(schema.calendarDays)
      .where(
        and(eq(schema.calendarDays.listingId, listingId), eq(schema.calendarDays.day, "2027-06-05")),
      );
    expect(row?.state).toBe("open");
  });

  it("a sold day is never blocked by a diary edit, and says so", async () => {
    await db
      .insert(schema.calendarDays)
      .values({ listingId, day: "2027-07-04", session: "night", state: "booked" })
      .onConflictDoUpdate({
        target: [schema.calendarDays.listingId, schema.calendarDays.day, schema.calendarDays.session],
        set: { state: "booked" },
      });

    const res = await app.inject({
      method: "POST",
      url: `/v1/partner/calendar?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { days: ["2027-07-04", "2027-07-05"], action: "block" },
    });
    expect(res.statusCode).toBe(200);
    // Named in the refusal, never silently skipped: a partner who believes a
    // day is closed and finds a family at the gate is the exact failure this
    // whole platform exists to prevent.
    expect(res.json().refused).toEqual(["2027-07-04"]);
    expect(res.json().changed).toEqual(["2027-07-05"]);

    const [row] = await db
      .select()
      .from(schema.calendarDays)
      .where(
        and(eq(schema.calendarDays.listingId, listingId), eq(schema.calendarDays.day, "2027-07-04")),
      );
    expect(row?.state).toBe("booked");
  });

  it("refuses to move a Ciao booking's dates or money from the diary", async () => {
    const [guest] = await db
      .insert(schema.users)
      .values({ phone: `+2189474${run.slice(-5)}`, role: "guest" })
      .returning();
    const [booking] = await db
      .insert(schema.bookings)
      .values({
        code: `CIA-P${run.slice(-5)}`,
        listingId,
        venueId,
        guestId: guest!.id,
        hostId: owner.id,
        type: "stay",
        state: "confirmed",
        checkIn: "2027-09-10",
        checkOut: "2027-09-12",
        totalAmount: 1_200_000,
        depositAmount: 240_000,
        commissionAmount: 120_000,
        balanceOnArrival: 960_000,
      })
      .returning();

    // The mirror appears on read.
    const jobs = await app.inject({
      method: "GET",
      url: `/v1/partner/jobs?partnerId=${owner.id}`,
      headers: auth(owner.token),
    });
    const mirrored = jobs.json().items.find((j: { bookingId: string }) => j.bookingId === booking!.id);
    expect(mirrored).toBeTruthy();
    expect(mirrored.locked).toBe(true);
    // The last night is the 11th, not the 12th — a stay's check-out morning is
    // a day the chalet is free.
    expect(mirrored.endDay).toBe("2027-09-11");
    // Their share, not the guest's gross.
    expect(mirrored.price).toBe(240_000 - 120_000 + 960_000);

    const moved = await app.inject({
      method: "PATCH",
      url: `/v1/partner/jobs/${mirrored.id}?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { day: "2027-09-20" },
    });
    expect(moved.statusCode).toBe(400);

    // Their own notes on a Ciao booking are still theirs to write.
    const noted = await app.inject({
      method: "PATCH",
      url: `/v1/partner/jobs/${mirrored.id}?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { notesAr: "البوابة الثانية" },
    });
    expect(noted.statusCode).toBe(200);
  });

  it("cannot claim a direct job came from Ciao", async () => {
    // `source` is what tells us how much of this market we are actually
    // winning. If a partner could set it to "ciao" the number would be fiction.
    const res = await app.inject({
      method: "POST",
      url: `/v1/partner/jobs?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { titleAr: "محاولة", day: "2027-10-01", source: "ciao" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().job.source).toBe("direct");
  });

  it("warns before saving when a day is already full", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/partner/jobs/load?partnerId=${owner.id}&days=2027-04-01,2027-04-02`,
      headers: auth(owner.token),
    });
    expect(res.statusCode).toBe(200);
    const days = res.json().days as { day: string; full: boolean }[];
    expect(days.find((d) => d.day === "2027-04-01")?.full).toBe(true);
    expect(days.find((d) => d.day === "2027-04-02")?.full).toBe(false);
  });
});

// ------------------------------------------------------------------ quotes
describe("quotes", () => {
  let code = "";

  it("a draft is invisible to the world until it is sent", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/v1/partner/quotes?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: {
        titleAr: "تصوير عرس",
        lineItems: [{ labelAr: "تصوير", qty: 1, unitPrice: 2_000_000 }],
        depositBps: 2500,
        proposedDay: "2027-08-19",
        client: { nameAr: "هدى", phone: "0915556666" },
      },
    });
    expect(created.statusCode).toBe(201);
    code = created.json().quote.code;

    const publicView = await app.inject({ method: "GET", url: `/v1/q/${code}` });
    expect(publicView.statusCode).toBe(404);
  });

  it("accepting books the day, and a double tap does not book it twice", async () => {
    const draft = (await listOwnerQuotes()).find((q) => q.status === "draft")!;
    await app.inject({
      method: "PATCH",
      url: `/v1/partner/quotes/${draft.id}?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { status: "sent" },
    });

    const first = await app.inject({
      method: "POST",
      url: `/v1/q/${code}/respond`,
      payload: { decision: "accept" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("accepted");
    const jobId = first.json().jobId;
    expect(jobId).toBeTruthy();

    // Most customers on this network double-tap. A second job would be a
    // second wedding in the diary.
    const second = await app.inject({
      method: "POST",
      url: `/v1/q/${code}/respond`,
      payload: { decision: "accept" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().jobId).toBe(jobId);

    const jobs = await db
      .select()
      .from(schema.partnerJobs)
      .where(eq(schema.partnerJobs.partnerId, owner.id));
    expect(jobs.filter((j) => j.titleAr === "تصوير عرس")).toHaveLength(1);
  });

  it("an accepted quote can no longer be edited", async () => {
    const quotes = await listOwnerQuotes();
    const accepted = quotes.find((q) => q.status === "accepted")!;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/partner/quotes/${accepted.id}?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { titleAr: "غيّرت رأيي" },
    });
    // It is the record of what was agreed. A document that can be edited after
    // agreement is not a record of anything.
    expect(res.statusCode).toBe(400);
  });

  it("an expired quote cannot be accepted", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/v1/partner/quotes?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: {
        titleAr: "عرض قديم",
        lineItems: [{ labelAr: "خدمة", qty: 1, unitPrice: 500_000 }],
        validUntil: "2020-01-01",
      },
    });
    const oldCode = created.json().quote.code;
    await app.inject({
      method: "PATCH",
      url: `/v1/partner/quotes/${created.json().quote.id}?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { status: "sent" },
    });
    const res = await app.inject({
      method: "POST",
      url: `/v1/q/${oldCode}/respond`,
      payload: { decision: "accept" },
    });
    expect(res.statusCode).toBe(400);
  });

  async function listOwnerQuotes() {
    const res = await app.inject({
      method: "GET",
      url: `/v1/partner/quotes?partnerId=${owner.id}`,
      headers: auth(owner.token),
    });
    return res.json().items as { id: string; status: string }[];
  }
});

// ------------------------------------------------------------------ payout security
describe("the payout destination", () => {
  it("holds a change, keeps the old account live, and can be stopped", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/partner/payout-account?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { rail: "bank_app", accountRef: "1111222233334444", label: "مصرف الصحاري" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
    expect(res.json().activatesAt).toBeTruthy();

    // The alert goes to the number of record the moment the change is asked
    // for — the only message that reaches the real owner if the account has
    // already been taken over.
    const [alert] = await db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.toUserId, owner.id),
          eq(schema.messages.templateKey, "partner_payout_account_changed"),
        ),
      )
      .limit(1);
    expect(alert).toBeTruthy();

    // "That wasn't me."
    const stopped = await app.inject({
      method: "DELETE",
      url: `/v1/partner/payout-account/${res.json().id}?partnerId=${owner.id}`,
      headers: auth(owner.token),
    });
    expect(stopped.statusCode).toBe(200);

    // And the worker, arriving later, must not resurrect it.
    expect(await activatePayoutAccount(res.json().id)).toBe(false);
  });

  it("activates only after the hold, and supersedes the previous account", async () => {
    const requested = await app.inject({
      method: "POST",
      url: `/v1/partner/payout-account?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { rail: "sadad", accountRef: "5555666677778888" },
    });
    const id = requested.json().id;

    const before = await app.inject({
      method: "GET",
      url: `/v1/partner/money?partnerId=${owner.id}`,
      headers: auth(owner.token),
    });
    const accounts = before.json().payoutAccounts as { status: string; ref: string }[];
    expect(accounts.find((a) => a.status === "pending")).toBeTruthy();
    // Never the full reference, not even back to the owner who typed it.
    expect(accounts.every((a) => !a.ref.includes("5555"))).toBe(true);

    expect(await activatePayoutAccount(id)).toBe(true);
    const [row] = await db
      .select()
      .from(schema.partnerPayoutAccounts)
      .where(eq(schema.partnerPayoutAccounts.id, id));
    expect(row?.status).toBe("active");
  });
});

// ------------------------------------------------------------------ Ciao Plus
describe("Ciao Plus", () => {
  it("withholds market panels server-side, not in the console", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/partner/insights?partnerId=${owner.id}`,
      headers: auth(owner.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().plus).toBe(false);
    // Absent from the payload entirely. Hidden in the UI would mean the data
    // was already on the wire.
    expect(res.json().market).toBeUndefined();
    // The free half is a complete picture, not a teaser.
    expect(res.json().own.earnings).toBeTruthy();
    expect(res.json().own.sourceMix.length).toBeGreaterThan(0);
  });

  it("gives the free season once per partner, not once per subscribe", async () => {
    const start = await app.inject({
      method: "POST",
      url: `/v1/partner/plus?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { action: "start" },
    });
    expect(start.statusCode).toBe(200);
    const firstTrialEnd = start.json().trialEndsAt;
    expect(firstTrialEnd).toBeTruthy();

    const unlocked = await app.inject({
      method: "GET",
      url: `/v1/partner/insights?partnerId=${owner.id}`,
      headers: auth(owner.token),
    });
    expect(unlocked.json().plus).toBe(true);
    expect(unlocked.json().market).toBeTruthy();

    await app.inject({
      method: "POST",
      url: `/v1/partner/plus?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { action: "cancel" },
    });
    const again = await app.inject({
      method: "POST",
      url: `/v1/partner/plus?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { action: "start" },
    });
    // Cancel-and-rejoin must not be a permanent free tier.
    expect(again.json().trialEndsAt).toBe(firstTrialEnd);
  });

  it("suppresses a price benchmark computed from too few businesses", async () => {
    // Below the floor, a "market median" is a competitor's price with a hat
    // on — and a partner could read a rival's rate off our own dashboard.
    await setSettings({ "partner.benchmarkMinPeers": 40 }, owner.id);
    invalidateSettingsCache();
    const res = await app.inject({
      method: "GET",
      url: `/v1/partner/insights?partnerId=${owner.id}`,
      headers: auth(owner.token),
    });
    const pp = res.json().market.pricePosition;
    expect(pp.available).toBe(false);
    expect(pp.suppressedReason).toBe("not_enough_peers");
    // Nothing leaks through the back door either.
    expect(pp.p50).toBe(0);

    await setSettings({ "partner.benchmarkMinPeers": 5 }, owner.id);
    invalidateSettingsCache();
  });

  it("refuses to start when the operator has switched the product off", async () => {
    await setSettings({ "partner.plusEnabled": false }, owner.id);
    invalidateSettingsCache();
    const res = await app.inject({
      method: "POST",
      url: `/v1/partner/plus?partnerId=${outsider.id}`,
      headers: auth(outsider.token),
      payload: { action: "start" },
    });
    expect(res.statusCode).toBe(403);
    await setSettings({ "partner.plusEnabled": true }, owner.id);
    invalidateSettingsCache();
  });
});

// ------------------------------------------------------------------ the customer book
describe("the customer book", () => {
  it("merges a returning customer on their phone rather than splitting the history", async () => {
    // The same woman is "هدى", "هدى العرفي" and "هدى بنت خالتي" across three
    // years of a notebook. The phone is the only thing that stays the same.
    await app.inject({
      method: "POST",
      url: `/v1/partner/clients?partnerId=${owner.id}`,
      headers: auth(owner.token),
      payload: { nameAr: "هدى العرفي", phone: "0915556666" },
    });
    const rows = await db
      .select()
      .from(schema.partnerClients)
      .where(
        and(
          eq(schema.partnerClients.partnerId, owner.id),
          eq(schema.partnerClients.phone, "+218915556666"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nameAr).toBe("هدى العرفي");
  });

  it("counts a client's jobs and spend without a query per row", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/partner/clients?partnerId=${owner.id}&search=هدى`,
      headers: auth(owner.token),
    });
    expect(res.statusCode).toBe(200);
    const client = res.json().items[0];
    expect(client.jobsCount).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ ops view
describe("the ops view of the partner base", () => {
  it("reports counts and the source mix, and never the customer book", async () => {
    const [admin] = await db
      .insert(schema.users)
      .values({ phone: `+2189475${run.slice(-5)}`, role: "admin" })
      .returning();
    const token = await signAccessToken({
      sub: admin!.id,
      role: "admin",
      phone: admin!.phone,
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/partner-panel",
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobs.total).toBeGreaterThan(0);
    expect(Array.isArray(body.sourceMix)).toBe(true);
    // The number this whole feature exists to produce.
    expect(body.sourceMix.some((s: { source: string }) => s.source === "whatsapp")).toBe(true);
    expect(JSON.stringify(body)).not.toContain("هدى");
  });

  it("is closed to a partner, however senior in their own business", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/partner-panel",
      headers: auth(owner.token),
    });
    expect(res.statusCode).toBe(403);
  });
});
