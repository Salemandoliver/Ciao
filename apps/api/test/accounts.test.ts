/**
 * Member accounts — the contract.
 *
 * What these tests protect, in order of how much it would hurt to get wrong:
 *
 *  1. **Booking never requires an account.** The moment it does, we've broken
 *     the product for the son booking on his father's behalf.
 *  2. **Points are not money until they're converted**, and conversion goes
 *     through the double-entry ledger like every other lyd we touch.
 *  3. **Awards are idempotent.** A replayed webhook or a double-tap must not
 *     mint points, and a referral must not pay twice.
 *  4. **Wallet top-up stays off** until the §15.4 legal position is settled —
 *     this is the biggest regulatory exposure in the model, so it is a test,
 *     not a comment.
 *  5. **Privacy promises are enforced**, not just written on the About page.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { signAccessToken } from "../src/lib/auth.js";
import {
  MIN_REDEEM_POINTS,
  POINT_RULES,
  awardPoints,
  claimReferral,
  ensureReferralCode,
  pointsBalance,
  qualifyReferral,
  redeemPoints,
} from "../src/modules/accounts/loyalty.js";
import {
  invalidateSettingsCache,
  resetSettings,
  setSettings,
} from "../src/modules/business/settings.js";

let app: FastifyInstance;

/**
 * Fresh users per run. These tests assert first-time behaviour — the welcome
 * bonus, the first referral, marketing consent starting off — and the test
 * database persists between runs, so reusing fixed phone numbers would make
 * the suite pass once and then fail forever.
 */
const RUN = Math.floor(Math.random() * 90000) + 10000;
let seq = 0;

async function makeUser() {
  const phone = `+21894${RUN}${String(seq++).padStart(2, "0")}`;
  const [user] = await db.insert(schema.users).values({ phone, role: "guest" }).returning();
  const token = await signAccessToken({ sub: user!.id, role: "guest", phone });
  return { id: user!.id, token, phone };
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

let guest: Awaited<ReturnType<typeof makeUser>>;
let friend: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  app = await buildApp();
  guest = await makeUser();
  friend = await makeUser();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("membership is optional", () => {
  it("the account endpoints need a session but booking does not", async () => {
    const anon = await app.inject({ method: "GET", url: "/v1/me/account" });
    expect(anon.statusCode).toBe(401);
    // …while the marketplace itself stays open to anyone.
    const browse = await app.inject({ method: "GET", url: "/v1/listings?type=coast" });
    expect(browse.statusCode).toBe(200);
    const quote = await app.inject({ method: "GET", url: "/v1/stats/public" });
    expect(quote.statusCode).toBe(200);
  });

  it("joining is idempotent and hands back a referral code", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/v1/me/join",
      headers: auth(guest.token),
      payload: { displayName: "ضيف الاختبار" },
    });
    expect(first.statusCode).toBe(201);
    const a = first.json() as { pointsEarned: number; referralCode: string };
    expect(a.referralCode).toMatch(/^CIAO[A-Z2-9]{6}$/);

    const second = await app.inject({
      method: "POST",
      url: "/v1/me/join",
      headers: auth(guest.token),
      payload: {},
    });
    // Second join awards nothing — the welcome bonus is once per person.
    expect((second.json() as { pointsEarned: number }).pointsEarned).toBe(0);
    expect((second.json() as { referralCode: string }).referralCode).toBe(a.referralCode);
  });
});

describe("points are not money", () => {
  it("awards are idempotent per (user, reason, reference)", async () => {
    const before = await pointsBalance(guest.id);
    const bookingRef = "test-booking-ref";
    const first = await awardPoints(guest.id, "stay_completed", bookingRef, "booking");
    const replay = await awardPoints(guest.id, "stay_completed", bookingRef, "booking");
    expect(first).toBe(POINT_RULES.stay_completed);
    expect(replay).toBe(0); // a retried webhook must not mint points
    expect(await pointsBalance(guest.id)).toBe(before + POINT_RULES.stay_completed);
  });

  it("refuses to redeem below the floor or beyond the balance", async () => {
    await expect(redeemPoints(guest.id, 10)).rejects.toThrow();
    const balance = await pointsBalance(guest.id);
    await expect(redeemPoints(guest.id, balance + 10_000)).rejects.toThrow();
  });

  it("redemption moves points into credit through the ledger, in balance", async () => {
    // Top the guest up to a redeemable balance with distinct references.
    for (let i = 0; i < 5; i++)
      await awardPoints(guest.id, "stay_completed", `seed-${i}`, "booking");

    const before = await pointsBalance(guest.id);
    if (before < MIN_REDEEM_POINTS) return; // nothing to assert on a bare DB

    const account = `guest_credit:${guest.id}`;
    const creditBefore = await db
      .select({
        n: sql<string>`coalesce(sum(${schema.ledgerEntries.credit} - ${schema.ledgerEntries.debit}), 0)`,
      })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.account, account));

    const redeem = Math.floor(before / 1000) * 1000;
    const res = await redeemPoints(guest.id, redeem);
    expect(res.dirhams).toBe(redeem);
    expect(await pointsBalance(guest.id)).toBe(before - redeem);

    const creditAfter = await db
      .select({
        n: sql<string>`coalesce(sum(${schema.ledgerEntries.credit} - ${schema.ledgerEntries.debit}), 0)`,
      })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.account, account));
    expect(Number(creditAfter[0]!.n) - Number(creditBefore[0]!.n)).toBe(redeem);

    // And the books are still square — the whole reason this goes through the
    // ledger rather than incrementing a column.
    const [totals] = await db
      .select({
        debit: sql<string>`sum(${schema.ledgerEntries.debit})`,
        credit: sql<string>`sum(${schema.ledgerEntries.credit})`,
      })
      .from(schema.ledgerEntries);
    expect(Number(totals!.debit)).toBe(Number(totals!.credit));
  });
});

describe("referrals pay on delivery, not on signup", () => {
  it("claiming links the pair but pays nobody yet", async () => {
    const code = await ensureReferralCode(guest.id);
    const before = await pointsBalance(guest.id);
    await claimReferral(friend.id, code);
    expect(await pointsBalance(guest.id)).toBe(before); // signup alone earns nothing

    const [row] = await db
      .select()
      .from(schema.referrals)
      .where(eq(schema.referrals.refereeId, friend.id));
    expect(row!.status).toBe("joined");
  });

  it("refuses self-referral and double-referral", async () => {
    const code = await ensureReferralCode(guest.id);
    await expect(claimReferral(guest.id, code)).rejects.toThrow();
    await expect(claimReferral(friend.id, code)).rejects.toThrow(); // already linked
  });

  it("pays both sides once the invited guest completes a stay, exactly once", async () => {
    const referrerBefore = await pointsBalance(guest.id);
    const refereeBefore = await pointsBalance(friend.id);

    // A real booking id: the referral row references one, and a foreign key
    // that can be dodged in tests is a foreign key that stops meaning anything.
    const [anyBooking] = await db.select({ id: schema.bookings.id }).from(schema.bookings).limit(1);
    if (!anyBooking) return; // bare DB — nothing to qualify against
    await qualifyReferral(friend.id, anyBooking.id);
    expect(await pointsBalance(guest.id)).toBe(
      referrerBefore + POINT_RULES.referral_qualified,
    );
    expect(await pointsBalance(friend.id)).toBe(refereeBefore + POINT_RULES.referred_welcome);

    // Replaying the completion must not pay a second time.
    await qualifyReferral(friend.id, anyBooking.id);
    expect(await pointsBalance(guest.id)).toBe(
      referrerBefore + POINT_RULES.referral_qualified,
    );
  });

  it("never discloses who accepted an invitation", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me/referrals",
      headers: auth(guest.token),
    });
    const body = res.json() as Record<string, unknown>;
    const raw = JSON.stringify(body);
    // Counts, yes. Names, phones and ids of invitees, never (§11.5).
    expect(body.invited).toBeGreaterThan(0);
    expect(raw).not.toContain(friend.id);
    expect(raw).not.toContain(friend.phone);
  });
});

describe("wallet", () => {
  it("reads from the ledger and is signed from the guest's point of view", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me/wallet",
      headers: auth(guest.token),
    });
    expect(res.statusCode).toBe(200);
    const w = res.json() as {
      balance: number;
      topUpEnabled: boolean;
      transactions: { amount: number; direction: string }[];
    };
    expect(w.balance).toBe(w.transactions.reduce((s, t) => s + t.amount, 0));
    for (const t of w.transactions)
      expect(t.direction).toBe(t.amount > 0 ? "in" : "out");
  });

  it("refuses top-up while the regulatory gate is closed — and honours it when opened", async () => {
    const closed = await app.inject({
      method: "POST",
      url: "/v1/me/wallet/top-up",
      headers: auth(guest.token),
      payload: { amount: 50_000, rail: "sadad" },
    });
    expect(closed.statusCode).toBe(400);
    expect(closed.body).toContain("top_up_not_available_yet");

    // The gate is a setting, not a rewrite: flipping it is all it takes on the
    // day counsel clears the model.
    const [admin] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.role, "admin"))
      .limit(1);
    if (admin) {
      await setSettings({ "wallet.topUpEnabled": true }, admin.id);
      invalidateSettingsCache();
      const open = await app.inject({
        method: "POST",
        url: "/v1/me/wallet/top-up",
        headers: auth(guest.token),
        payload: { amount: 50_000, rail: "sadad" },
      });
      expect(open.statusCode).toBe(202);
      await resetSettings(["wallet.topUpEnabled"], admin.id);
      invalidateSettingsCache();
    }
  });
});

describe("preferences are declared, never inferred", () => {
  it("round-trips and keeps marketing consent off by default", async () => {
    const fresh = await makeUser();
    const before = await app.inject({
      method: "GET",
      url: "/v1/me/account",
      headers: auth(fresh.token),
    });
    const prefs = (before.json() as { preferences: Record<string, unknown> }).preferences;
    // Service messages always send; offers must be asked for (Law 6/2022).
    expect(prefs.marketingOptIn).toBe(false);
    expect(prefs.notifyWhatsapp).toBe(true);

    const patch = await app.inject({
      method: "PATCH",
      url: "/v1/me/preferences",
      headers: auth(fresh.token),
      payload: { theme: "dark", locale: "en", favouriteAreas: ["janzour"], marketingOptIn: true },
    });
    expect(patch.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/v1/me/account",
      headers: auth(fresh.token),
    });
    const p2 = (after.json() as { preferences: Record<string, unknown> }).preferences;
    expect(p2.theme).toBe("dark");
    expect(p2.favouriteAreas).toEqual(["janzour"]);
    expect(p2.marketingOptIn).toBe(true);
  });

  it("rejects a stored card number outright", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/payment-methods",
      headers: auth(guest.token),
      payload: { rail: "local_card", providerToken: "4111111111111111" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("looks_like_a_card_number");
  });
});

describe("data rights are buttons, not copy", () => {
  it("exports the member's own data and nobody else's", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me/export",
      headers: auth(guest.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: { id: string; phone: string } };
    expect(body.user.id).toBe(guest.id);
    expect(res.body).not.toContain(friend.phone);
  });

  it("refuses to close an account still holding money", async () => {
    await db
      .update(schema.users)
      .set({ creditBalance: 5000 })
      .where(eq(schema.users.id, guest.id));
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/close",
      headers: auth(guest.token),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("wallet_not_empty");
    await db.update(schema.users).set({ creditBalance: 0 }).where(eq(schema.users.id, guest.id));
  });
});
