/**
 * Spending points at partner businesses.
 *
 * This is where loyalty stops being a discount on ourselves and becomes money
 * in a Libyan small business's till. A family that booked a chalet in Janzour
 * walks into the café at the resort and pays with points; the café gets a
 * customer it would not otherwise have had, and we settle with them in cash.
 * Nobody else in this market can offer a café that.
 *
 * Three decisions worth stating, because each is the kind of thing that looks
 * like a detail until it costs someone money:
 *
 *  1. **Points burn at issue, not at the counter.** A voucher that could still
 *     be spent elsewhere while sitting in a phone is a double-spend waiting to
 *     happen, and the person who would eat it is the café. Unredeemed vouchers
 *     expire and the points return.
 *  2. **A redeemed voucher is a real payable.** It posts to
 *     `partner_payable:<id>` in the same double-entry ledger as everything
 *     else, so what we owe the café appears on the finance screen rather than
 *     living in someone's notebook.
 *  3. **Short codes, read aloud.** These get shouted across a counter, so the
 *     alphabet excludes the characters people confuse.
 */
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { track } from "../intelligence/events.js";
import * as ledger from "../payments/ledger.js";
import { loyaltyConfig, pointsBalance } from "./loyalty.js";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function voucherCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++)
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

export const PARTNER_CATEGORY_AR: Record<string, string> = {
  cafe: "مقهى",
  restaurant: "مطعم",
  bakery: "مخبز وحلويات",
  spa: "مركز عناية",
  activity: "نشاط ترفيهي",
  shop: "متجر",
};

export async function listPartners(opts: { city?: string; venueId?: string } = {}) {
  const conditions = [eq(schema.partners.active, true)];
  if (opts.city) conditions.push(eq(schema.partners.city, opts.city));
  if (opts.venueId) conditions.push(eq(schema.partners.venueId, opts.venueId));

  return db
    .select({
      id: schema.partners.id,
      nameAr: schema.partners.nameAr,
      category: schema.partners.category,
      city: schema.partners.city,
      area: schema.partners.area,
      descriptionAr: schema.partners.descriptionAr,
      logoUrl: schema.partners.logoUrl,
      minValue: schema.partners.minValue,
      maxValue: schema.partners.maxValue,
      venueNameAr: schema.venues.nameAr,
    })
    .from(schema.partners)
    .leftJoin(schema.venues, eq(schema.partners.venueId, schema.venues.id))
    .where(and(...conditions))
    .orderBy(schema.partners.nameAr);
}

/**
 * Cut a voucher. Burns the points inside the same transaction that creates it,
 * so there is no window where a guest holds both the points and the voucher.
 */
export async function issueVoucher(userId: string, partnerId: string, value: number) {
  const cfg = await loyaltyConfig();
  if (!cfg.enabled || !cfg.partnersEnabled)
    throw new CiaoError("VALIDATION", "partner_redemption_disabled");

  const [partner] = await db
    .select()
    .from(schema.partners)
    .where(eq(schema.partners.id, partnerId))
    .limit(1);
  if (!partner || !partner.active) throw new CiaoError("BOOKING_NOT_FOUND", "partner_not_found");
  if (value < partner.minValue || value > partner.maxValue)
    throw new CiaoError("VALIDATION", "value_out_of_range");

  const points = Math.ceil(value / cfg.pointToDirham);
  const balance = await pointsBalance(userId);
  if (points > balance) throw new CiaoError("VALIDATION", "insufficient_points");

  const expiresAt = new Date(Date.now() + cfg.voucherMinutes * 60_000);

  // Collisions are vanishingly unlikely but not impossible; retry rather than
  // handing the guest an error for something that is our problem.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = voucherCode();
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.partnerRedemptions)
          .values({ code, userId, partnerId, points, value, expiresAt })
          .returning();
        await tx.insert(schema.loyaltyLedger).values({
          userId,
          delta: -points,
          reason: "partner_voucher",
          refId: `voucher:${row!.id}`,
          refType: "partner",
          memoAr: `قسيمة لدى ${partner.nameAr}`,
        });
        await tx
          .update(schema.users)
          .set({ pointsBalance: sql`${schema.users.pointsBalance} - ${points}` })
          .where(eq(schema.users.id, userId));
        return { ...row!, partnerName: partner.nameAr, expiresInMinutes: cfg.voucherMinutes };
      });
    } catch (e) {
      if (attempt === 4 || !String(e).includes("partner_redemption_code_uq")) throw e;
    }
  }
  throw new CiaoError("VALIDATION", "could_not_issue");
}

/**
 * Redeem at the counter. Called by the partner's own account, never by the
 * guest — otherwise a guest could mark their own voucher used and walk out
 * with a coffee the café never agreed to.
 */
export async function redeemVoucher(code: string, staffUserId: string) {
  const clean = code.trim().toUpperCase();
  const [voucher] = await db
    .select()
    .from(schema.partnerRedemptions)
    .where(eq(schema.partnerRedemptions.code, clean))
    .limit(1);
  if (!voucher) throw new CiaoError("BOOKING_NOT_FOUND", "unknown_code");

  const [partner] = await db
    .select()
    .from(schema.partners)
    .where(eq(schema.partners.id, voucher.partnerId))
    .limit(1);

  // Staff of that partner, or ops. A café must not be able to burn a voucher
  // issued for the restaurant next door.
  const [staff] = await db.select().from(schema.users).where(eq(schema.users.id, staffUserId)).limit(1);
  const isOps = staff && ["ops", "admin"].includes(staff.role);
  if (!isOps && partner?.staffUserId !== staffUserId)
    throw new CiaoError("AUTH_FORBIDDEN", "not_your_voucher");

  if (voucher.status === "redeemed") throw new CiaoError("VALIDATION", "already_redeemed");
  if (voucher.status !== "issued") throw new CiaoError("VALIDATION", `voucher_${voucher.status}`);
  if (voucher.expiresAt < new Date()) throw new CiaoError("VALIDATION", "voucher_expired");

  await db.transaction(async (tx) => {
    // Conditional update: two tills scanning the same code race here, and
    // exactly one of them must win.
    const [claimed] = await tx
      .update(schema.partnerRedemptions)
      .set({ status: "redeemed", redeemedAt: new Date(), redeemedByUserId: staffUserId })
      .where(
        and(
          eq(schema.partnerRedemptions.id, voucher.id),
          eq(schema.partnerRedemptions.status, "issued"),
        ),
      )
      .returning();
    if (!claimed) throw new CiaoError("VALIDATION", "already_redeemed");

    // The moment the coffee is handed over we owe the café money. Marketing
    // liability becomes a real one, and the finance screen should say so.
    await ledger.post(tx, null, [
      { account: "platform_revenue", debit: voucher.value, memo: "partner voucher redeemed" },
      { account: `partner_payable:${voucher.partnerId}`, credit: voucher.value, memo: clean },
    ]);
  });

  track(
    "partner.voucher_redeemed",
    { partnerId: voucher.partnerId, value: voucher.value, points: voucher.points },
    { userId: voucher.userId },
  );
  return { ok: true, value: voucher.value, partnerName: partner?.nameAr ?? "" };
}

/**
 * Return points from vouchers that lapsed unused. Runs from the worker — the
 * guest should not have to ask, and a café should never be able to honour a
 * code whose points have already gone back.
 */
export async function expireVouchers(limit = 200): Promise<number> {
  const due = await db
    .select()
    .from(schema.partnerRedemptions)
    .where(
      and(
        eq(schema.partnerRedemptions.status, "issued"),
        lte(schema.partnerRedemptions.expiresAt, new Date()),
      ),
    )
    .limit(limit);

  let refunded = 0;
  for (const v of due) {
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(schema.partnerRedemptions)
        .set({ status: "expired" })
        .where(
          and(
            eq(schema.partnerRedemptions.id, v.id),
            eq(schema.partnerRedemptions.status, "issued"),
          ),
        )
        .returning();
      if (!claimed) return; // redeemed between our read and this write
      await tx.insert(schema.loyaltyLedger).values({
        userId: v.userId,
        delta: v.points,
        reason: "partner_voucher_refund",
        refId: `voucher_refund:${v.id}`,
        refType: "partner",
        memoAr: "إرجاع نقاط قسيمة لم تُستخدم",
      });
      await tx
        .update(schema.users)
        .set({ pointsBalance: sql`${schema.users.pointsBalance} + ${v.points}` })
        .where(eq(schema.users.id, v.userId));
      refunded += v.points;
    });
  }
  return refunded;
}

export async function myVouchers(userId: string, limit = 20) {
  return db
    .select({
      id: schema.partnerRedemptions.id,
      code: schema.partnerRedemptions.code,
      points: schema.partnerRedemptions.points,
      value: schema.partnerRedemptions.value,
      status: schema.partnerRedemptions.status,
      expiresAt: schema.partnerRedemptions.expiresAt,
      redeemedAt: schema.partnerRedemptions.redeemedAt,
      createdAt: schema.partnerRedemptions.createdAt,
      partnerName: schema.partners.nameAr,
      partnerCategory: schema.partners.category,
    })
    .from(schema.partnerRedemptions)
    .innerJoin(schema.partners, eq(schema.partnerRedemptions.partnerId, schema.partners.id))
    .where(eq(schema.partnerRedemptions.userId, userId))
    .orderBy(desc(schema.partnerRedemptions.createdAt))
    .limit(limit);
}
