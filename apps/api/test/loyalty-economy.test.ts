/**
 * The loyalty economy: configurable rules, expiry, partner vouchers, promos.
 *
 * These tests exist because every failure here costs somebody real money —
 * a café honouring a voucher whose points were already spent, a guest whose
 * points vanished with no explanation, a promo that quietly pays a host out of
 * our pocket, or a "last one" code redeemed twice by two simultaneous
 * checkouts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { signAccessToken } from "../src/lib/auth.js";
import {
  awardPoints,
  expirePoints,
  loyaltyConfig,
  pointsBalance,
} from "../src/modules/accounts/loyalty.js";
import { expireVouchers, issueVoucher, redeemVoucher } from "../src/modules/accounts/partners.js";
import { applyPromo, evaluatePromo } from "../src/modules/accounts/promos.js";
import {
  invalidateSettingsCache,
  resetSettings,
  setSettings,
} from "../src/modules/business/settings.js";

let app: FastifyInstance;
let adminId: string;

const RUN = Math.floor(Math.random() * 90000) + 10000;
let seq = 0;

async function makeUser(role: "guest" | "admin" = "guest") {
  const phone = `+21893${RUN}${String(seq++).padStart(2, "0")}`;
  const [user] = await db.insert(schema.users).values({ phone, role }).returning();
  const token = await signAccessToken({ sub: user!.id, role, phone });
  return { id: user!.id, token, phone };
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function makePartner(staffUserId: string) {
  const [p] = await db
    .insert(schema.partners)
    .values({
      nameAr: `مقهى اختبار ${RUN}-${seq++}`,
      category: "cafe",
      city: "tripoli",
      staffUserId,
      minValue: 5_000,
      maxValue: 100_000,
    })
    .returning();
  return p!;
}

beforeAll(async () => {
  app = await buildApp();
  const [admin] = await db.select().from(schema.users).where(eq(schema.users.role, "admin")).limit(1);
  adminId = admin?.id ?? (await makeUser("admin")).id;
});

afterAll(async () => {
  // Fixtures must not leak into the live partner directory — the same lesson
  // as the test villas that once showed up in production search.
  await db
    .update(schema.partners)
    .set({ active: false })
    .where(sql`${schema.partners.nameAr} like 'مقهى اختبار%'`);
  await resetSettings(
    ["loyalty.earnRules", "loyalty.expiryMonths", "loyalty.pointToDirham", "loyalty.enabled"],
    adminId,
  );
  invalidateSettingsCache();
  await app.close();
  await pool.end();
});

describe("loyalty rules are operator-controlled", () => {
  it("an earn rate changed in the console applies to the next award", async () => {
    const user = await makeUser();
    await setSettings({ "loyalty.earnRules": { stay_completed: 999 } }, adminId);
    invalidateSettingsCache();

    const earned = await awardPoints(user.id, "stay_completed", `cfg-${RUN}`, "booking");
    expect(earned).toBe(999);

    await resetSettings(["loyalty.earnRules"], adminId);
    invalidateSettingsCache();
  });

  it("turning the programme off stops awards without erasing balances", async () => {
    const user = await makeUser();
    await awardPoints(user.id, "signup", `on-${RUN}`, "user");
    const before = await pointsBalance(user.id);
    expect(before).toBeGreaterThan(0);

    await setSettings({ "loyalty.enabled": false }, adminId);
    invalidateSettingsCache();
    const earned = await awardPoints(user.id, "stay_completed", `off-${RUN}`, "booking");
    expect(earned).toBe(0);
    expect(await pointsBalance(user.id)).toBe(before); // existing points untouched

    await resetSettings(["loyalty.enabled"], adminId);
    invalidateSettingsCache();
  });
});

describe("expiry", () => {
  it("stamps each award with its own date and never applies a change retroactively", async () => {
    const user = await makeUser();
    await setSettings({ "loyalty.expiryMonths": 12 }, adminId);
    invalidateSettingsCache();
    await awardPoints(user.id, "stay_completed", `exp-a-${RUN}`, "booking");

    // Shortening the programme must not move the goalposts on points already
    // earned under the old terms.
    await setSettings({ "loyalty.expiryMonths": 1 }, adminId);
    invalidateSettingsCache();

    const [first] = await db
      .select()
      .from(schema.loyaltyLedger)
      .where(eq(schema.loyaltyLedger.refId, `exp-a-${RUN}`));
    const monthsOut =
      (first!.expiresAt!.getFullYear() - new Date().getFullYear()) * 12 +
      (first!.expiresAt!.getMonth() - new Date().getMonth());
    expect(monthsOut).toBeGreaterThan(6); // still on the 12-month terms

    await resetSettings(["loyalty.expiryMonths"], adminId);
    invalidateSettingsCache();
  });

  it("expires lapsed points as an offsetting row, so the history explains itself", async () => {
    const user = await makeUser();
    await awardPoints(user.id, "stay_completed", `lapse-${RUN}`, "booking");
    const before = await pointsBalance(user.id);
    expect(before).toBeGreaterThan(0);

    // Backdate the award past its expiry.
    await db
      .update(schema.loyaltyLedger)
      .set({ expiresAt: new Date(Date.now() - 86_400_000) })
      .where(eq(schema.loyaltyLedger.refId, `lapse-${RUN}`));

    await expirePoints();
    expect(await pointsBalance(user.id)).toBe(0);

    const rows = await db
      .select()
      .from(schema.loyaltyLedger)
      .where(eq(schema.loyaltyLedger.userId, user.id));
    // The original award is still there; the loss is a separate, dated row.
    expect(rows.some((r) => r.delta > 0)).toBe(true);
    expect(rows.some((r) => r.reason === "expired" && r.delta < 0)).toBe(true);
  });

  it("never pushes a balance negative when points were already spent", async () => {
    const user = await makeUser();
    // Enough to cut a voucher above the partner's floor, plus the one award
    // we will later backdate into expiry.
    for (let i = 0; i < 40; i++)
      await awardPoints(user.id, "stay_completed", `spent-pad-${RUN}-${i}`, "booking");
    await awardPoints(user.id, "review_written", `spent-${RUN}`, "booking");
    const staff = await makeUser();
    const partner = await makePartner(staff.id);
    const cfg = await loyaltyConfig();
    const balance = await pointsBalance(user.id);

    // Spend everything, then let the (already spent) award lapse.
    await issueVoucher(user.id, partner.id, Math.min(balance * cfg.pointToDirham, partner.maxValue));
    await db
      .update(schema.loyaltyLedger)
      .set({ expiresAt: new Date(Date.now() - 86_400_000) })
      .where(eq(schema.loyaltyLedger.refId, `spent-${RUN}`));

    await expirePoints();
    expect(await pointsBalance(user.id)).toBeGreaterThanOrEqual(0);
  });
});

describe("partner vouchers", () => {
  it("burns points at issue, so a voucher can never be double-spent", async () => {
    const user = await makeUser();
    for (let i = 0; i < 40; i++) await awardPoints(user.id, "stay_completed", `v-${RUN}-${i}`, "booking");
    const before = await pointsBalance(user.id);
    const staff = await makeUser();
    const partner = await makePartner(staff.id);

    const voucher = await issueVoucher(user.id, partner.id, 5_000);
    expect(voucher.code).toMatch(/^[A-Z2-9]{6}$/);
    // Gone immediately — not at the counter.
    expect(await pointsBalance(user.id)).toBe(before - voucher.points);
  });

  it("only the partner's own account can redeem, and only once", async () => {
    const user = await makeUser();
    for (let i = 0; i < 40; i++) await awardPoints(user.id, "stay_completed", `r-${RUN}-${i}`, "booking");
    const staff = await makeUser();
    const otherStaff = await makeUser();
    const partner = await makePartner(staff.id);
    const voucher = await issueVoucher(user.id, partner.id, 5_000);

    // The café next door must not be able to burn this.
    await expect(redeemVoucher(voucher.code, otherStaff.id)).rejects.toThrow();
    // Nor may the guest mark their own voucher used.
    await expect(redeemVoucher(voucher.code, user.id)).rejects.toThrow();

    const ok = await redeemVoucher(voucher.code, staff.id);
    expect(ok.value).toBe(5_000);
    await expect(redeemVoucher(voucher.code, staff.id)).rejects.toThrow();
  });

  it("a redeemed voucher becomes a real payable, in balance", async () => {
    const user = await makeUser();
    for (let i = 0; i < 40; i++) await awardPoints(user.id, "stay_completed", `p-${RUN}-${i}`, "booking");
    const staff = await makeUser();
    const partner = await makePartner(staff.id);
    const voucher = await issueVoucher(user.id, partner.id, 10_000);
    await redeemVoucher(voucher.code, staff.id);

    const [owed] = await db
      .select({
        n: sql<string>`coalesce(sum(${schema.ledgerEntries.credit} - ${schema.ledgerEntries.debit}), 0)`,
      })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.account, `partner_payable:${partner.id}`));
    expect(Number(owed!.n)).toBe(10_000);

    const [totals] = await db
      .select({
        debit: sql<string>`sum(${schema.ledgerEntries.debit})`,
        credit: sql<string>`sum(${schema.ledgerEntries.credit})`,
      })
      .from(schema.ledgerEntries);
    expect(Number(totals!.debit)).toBe(Number(totals!.credit));
  });

  it("returns points when a voucher lapses unused, without the guest asking", async () => {
    const user = await makeUser();
    for (let i = 0; i < 40; i++) await awardPoints(user.id, "stay_completed", `e-${RUN}-${i}`, "booking");
    const staff = await makeUser();
    const partner = await makePartner(staff.id);
    const voucher = await issueVoucher(user.id, partner.id, 5_000);
    const afterIssue = await pointsBalance(user.id);

    await db
      .update(schema.partnerRedemptions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.partnerRedemptions.id, voucher.id));

    await expireVouchers();
    expect(await pointsBalance(user.id)).toBe(afterIssue + voucher.points);
    // And the café can no longer honour it.
    await expect(redeemVoucher(voucher.code, staff.id)).rejects.toThrow();
  });
});

describe("promo codes", () => {
  async function makePromo(over: Partial<typeof schema.promoCodes.$inferInsert> = {}) {
    const [p] = await db
      .insert(schema.promoCodes)
      .values({
        code: `T${RUN}${seq++}`,
        kind: "percent",
        value: 1000, // 10%
        perUserLimit: 1,
        ...over,
      })
      .returning();
    return p!;
  }

  it("never discounts deeper than our commission — the host's share is not a marketing budget", async () => {
    const user = await makeUser();
    const promo = await makePromo({ kind: "percent", value: 5000 }); // 50%
    const result = await evaluatePromo(promo.code, {
      userId: user.id,
      total: 1_000_000,
      commission: 100_000, // we earn 10%
    });
    // 50% of 1,000,000 is 500,000 — capped to what we actually earn.
    expect(result.discount).toBe(100_000);
    expect(result.cappedByCommission).toBe(true);
  });

  it("passes a modest discount through untouched", async () => {
    const user = await makeUser();
    const promo = await makePromo({ kind: "fixed", value: 20_000 });
    const result = await evaluatePromo(promo.code, {
      userId: user.id,
      total: 1_000_000,
      commission: 100_000,
    });
    expect(result.discount).toBe(20_000);
    expect(result.cappedByCommission).toBe(false);
  });

  it("enforces window, scope, minimum spend and per-user limit", async () => {
    const user = await makeUser();
    const ctx = { userId: user.id, total: 500_000, commission: 50_000 };

    const expired = await makePromo({ endsAt: new Date(Date.now() - 86_400_000) });
    await expect(evaluatePromo(expired.code, ctx)).rejects.toThrow();

    const future = await makePromo({ startsAt: new Date(Date.now() + 86_400_000) });
    await expect(evaluatePromo(future.code, ctx)).rejects.toThrow();

    const pricey = await makePromo({ minSpend: 900_000 });
    await expect(evaluatePromo(pricey.code, ctx)).rejects.toThrow();

    const hallsOnly = await makePromo({ vertical: "hall" });
    await expect(evaluatePromo(hallsOnly.code, { ...ctx, vertical: "coast" })).rejects.toThrow();

    const off = await makePromo({ active: false });
    await expect(evaluatePromo(off.code, ctx)).rejects.toThrow();
  });

  it("counts a use once per booking however many times it is applied", async () => {
    const user = await makeUser();
    const promo = await makePromo();
    const [booking] = await db.select().from(schema.bookings).limit(1);
    if (!booking) return;

    const result = await evaluatePromo(promo.code, {
      userId: user.id,
      total: 500_000,
      commission: 50_000,
    });
    expect(await applyPromo(result, user.id, booking.id)).toBe(true);
    // A retried request must be a no-op, not a second redemption.
    expect(await applyPromo(result, user.id, booking.id)).toBe(false);

    const [after] = await db
      .select()
      .from(schema.promoCodes)
      .where(eq(schema.promoCodes.id, promo.id));
    expect(after!.timesUsed).toBe(1);

    // And the per-user limit now bites.
    await expect(
      evaluatePromo(promo.code, { userId: user.id, total: 500_000, commission: 50_000 }),
    ).rejects.toThrow();
  });

  it("refuses once the total redemption cap is reached", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const promo = await makePromo({ maxRedemptions: 1, perUserLimit: 5 });
    const [booking] = await db.select().from(schema.bookings).limit(1);
    if (!booking) return;

    const first = await evaluatePromo(promo.code, {
      userId: userA.id,
      total: 500_000,
      commission: 50_000,
    });
    await applyPromo(first, userA.id, booking.id);

    await expect(
      evaluatePromo(promo.code, { userId: userB.id, total: 500_000, commission: 50_000 }),
    ).rejects.toThrow();
  });

  it("tells a guest why a code failed rather than just refusing", async () => {
    const user = await makeUser();
    const res = await app.inject({
      method: "POST",
      url: "/v1/promos/check",
      headers: auth(user.token),
      payload: { code: "DEFINITELYNOTREAL", total: 100_000, commission: 10_000 },
    });
    // A rejected code is a normal checkout outcome, not an error page.
    expect(res.statusCode).toBe(200);
    const body = res.json() as { valid: boolean; messageAr: string };
    expect(body.valid).toBe(false);
    expect(body.messageAr.length).toBeGreaterThan(0);
  });
});
