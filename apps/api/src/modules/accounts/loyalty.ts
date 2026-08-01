/**
 * Loyalty points, and why they are not money.
 *
 * Ciao already has a money balance: platform credit, held in the double-entry
 * ledger as `guest_credit:<userId>` and issued by `issueCredit()`. Points are a
 * separate, deliberately weaker instrument — a marketing liability we can
 * price, expire or retire, never a balance a customer paid us for.
 *
 * That separation is a regulatory position as much as a product one. Libya has
 * no e-money or escrow regime (§15.4); a balance that customers top up with
 * their own cash is the thing that makes a marketplace look like an unlicensed
 * deposit-taker. Points earned by behaviour are not that, and can ship today.
 *
 * The one place they touch: points can be *converted* into platform credit at
 * a published rate. Conversion is the moment a marketing liability becomes a
 * real one, so it goes through the ledger like any other money movement.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { track } from "../intelligence/events.js";

/** How points are earned. Values are deliberately modest and legible. */
export const POINT_RULES = {
  /** Signing up at all — the nudge that turns a booker into a member. */
  signup: 100,
  /** Verifying an email gives us a channel that survives a SIM change. */
  email_verified: 50,
  /** A completed stay, the behaviour we actually want. */
  stay_completed: 250,
  /** Writing a review — the corpus is the product (§8.8). */
  review_written: 150,
  /** Your invitee completed their first stay. Paid on delivery, not signup. */
  referral_qualified: 500,
  /** Being invited and completing your first stay. */
  referred_welcome: 250,
} as const;

export type PointReason = keyof typeof POINT_RULES;

/**
 * 1 point = 1 dirham of credit at conversion, i.e. 1000 points = 1 LYD.
 * Kept as an explicit constant because the day it changes, everything that
 * quotes a "worth" to the user has to change with it.
 */
export const POINT_TO_DIRHAM = 1;
export const MIN_REDEEM_POINTS = 1000; // 1 LYD — below this it's noise

const REASON_AR: Record<string, string> = {
  signup: "مكافأة إنشاء الحساب",
  email_verified: "توثيق البريد الإلكتروني",
  stay_completed: "إتمام إقامة",
  review_written: "كتابة تقييم",
  referral_qualified: "صديق دعوته أتمّ أول حجز",
  referred_welcome: "انضممت بدعوة من صديق",
  redeemed: "تحويل نقاط إلى رصيد",
};

/**
 * Award points, idempotently.
 *
 * The unique index on (userId, reason, refId) is what makes this safe to call
 * from a retried webhook or a double-tapped button: the second insert conflicts
 * and does nothing rather than minting points twice.
 */
export async function awardPoints(
  userId: string,
  reason: PointReason,
  refId: string | null,
  refType?: string,
): Promise<number> {
  const delta = POINT_RULES[reason];
  if (!delta) return 0;

  const [row] = await db
    .insert(schema.loyaltyLedger)
    .values({
      userId,
      delta,
      reason,
      refId: refId ?? reason, // null refIds would defeat the unique index
      refType,
      memoAr: REASON_AR[reason] ?? reason,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return 0; // already awarded

  await db
    .update(schema.users)
    .set({ pointsBalance: sql`${schema.users.pointsBalance} + ${delta}` })
    .where(eq(schema.users.id, userId));

  track("loyalty.earned", { reason, delta }, { userId });
  return delta;
}

/** Current balance, recomputed from the ledger — the cache is only a cache. */
export async function pointsBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.loyaltyLedger.delta}), 0)` })
    .from(schema.loyaltyLedger)
    .where(eq(schema.loyaltyLedger.userId, userId));
  return Number(row?.total ?? 0);
}

export async function pointsHistory(userId: string, limit = 50) {
  return db
    .select()
    .from(schema.loyaltyLedger)
    .where(eq(schema.loyaltyLedger.userId, userId))
    .orderBy(desc(schema.loyaltyLedger.createdAt))
    .limit(limit);
}

/**
 * Convert points into platform credit.
 *
 * This is the boundary where a marketing liability becomes real money, so it
 * runs in one transaction: burn the points, post the balanced ledger entries,
 * update both caches. Anything less and a crash mid-way either gives away free
 * credit or silently eats someone's points.
 */
export async function redeemPoints(userId: string, points: number) {
  if (points < MIN_REDEEM_POINTS)
    throw new CiaoError("VALIDATION", `min_redeem_${MIN_REDEEM_POINTS}`);

  const balance = await pointsBalance(userId);
  if (points > balance) throw new CiaoError("VALIDATION", "insufficient_points");

  const dirhams = points * POINT_TO_DIRHAM;
  const ledger = await import("../payments/ledger.js");

  await db.transaction(async (tx) => {
    await tx.insert(schema.loyaltyLedger).values({
      userId,
      delta: -points,
      reason: "redeemed",
      // Redemptions are not once-per-reference, so they carry a unique ref.
      refId: `redeem:${Date.now()}:${Math.round(points)}`,
      refType: "credit",
      memoAr: REASON_AR.redeemed,
    });
    await tx
      .update(schema.users)
      .set({
        pointsBalance: sql`${schema.users.pointsBalance} - ${points}`,
        creditBalance: sql`${schema.users.creditBalance} + ${dirhams}`,
      })
      .where(eq(schema.users.id, userId));
    await ledger.post(tx, null, [
      { account: "platform_revenue", debit: dirhams, memo: "loyalty redemption" },
      { account: `guest_credit:${userId}`, credit: dirhams, memo: "loyalty redemption" },
    ]);
  });

  track("loyalty.redeemed", { points, dirhams }, { userId });
  return { points, dirhams, remaining: balance - points };
}

/** Arabic label for a ledger row, so the client never has to translate. */
export function reasonLabel(reason: string): string {
  return REASON_AR[reason] ?? reason;
}

/**
 * Referral codes are shown, typed and read aloud over WhatsApp, so the
 * alphabet excludes characters people confuse: no O/0, no I/1, no L.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateReferralCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++)
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `CIAO${out}`;
}

/** Every member has a code; it is created on first request and never changes. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw new CiaoError("AUTH_REQUIRED");
  if (user.referralCode) return user.referralCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    const [updated] = await db
      .update(schema.users)
      .set({ referralCode: code })
      .where(and(eq(schema.users.id, userId), sql`${schema.users.referralCode} is null`))
      .returning();
    if (updated?.referralCode) return updated.referralCode;
    // Someone else took the code (or ours landed first) — re-read and retry.
    const [fresh] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (fresh?.referralCode) return fresh.referralCode;
  }
  throw new CiaoError("VALIDATION", "could_not_allocate_code");
}

/**
 * Attach a new member to whoever invited them.
 *
 * Deliberately does NOT pay anyone yet — status is `joined`. The reward lands
 * only when the invitee completes a stay, because rewarding signups in a market
 * this small is a standing invitation to farm fake accounts with cheap SIMs.
 */
export async function claimReferral(refereeId: string, code: string) {
  const clean = code.trim().toUpperCase();
  const [referrer] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.referralCode, clean))
    .limit(1);
  if (!referrer) throw new CiaoError("VALIDATION", "unknown_code");
  if (referrer.id === refereeId) throw new CiaoError("VALIDATION", "cannot_refer_yourself");

  const [existing] = await db
    .select()
    .from(schema.referrals)
    .where(eq(schema.referrals.refereeId, refereeId))
    .limit(1);
  if (existing) throw new CiaoError("VALIDATION", "already_referred");

  const [row] = await db
    .insert(schema.referrals)
    .values({ referrerId: referrer.id, refereeId, code: clean, status: "joined" })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new CiaoError("VALIDATION", "already_referred");

  track("referral.joined", { referrerId: referrer.id }, { userId: refereeId });
  return { referrerName: referrer.displayName ?? null };
}

/**
 * Called when a guest completes a stay: pays the referral if one is pending.
 * Idempotent through awardPoints' unique index plus the status guard.
 */
export async function qualifyReferral(refereeId: string, bookingId: string) {
  const [ref] = await db
    .select()
    .from(schema.referrals)
    .where(and(eq(schema.referrals.refereeId, refereeId), eq(schema.referrals.status, "joined")))
    .limit(1);
  if (!ref) return;

  await db
    .update(schema.referrals)
    .set({ status: "rewarded", bookingId, rewardedAt: new Date() })
    .where(eq(schema.referrals.id, ref.id));

  await awardPoints(ref.referrerId, "referral_qualified", ref.id, "referral");
  await awardPoints(refereeId, "referred_welcome", ref.id, "referral");
  track("referral.qualified", { referralId: ref.id, bookingId }, { userId: ref.referrerId });
}

export async function referralSummary(userId: string) {
  const code = await ensureReferralCode(userId);
  const rows = await db
    .select({
      id: schema.referrals.id,
      status: schema.referrals.status,
      createdAt: schema.referrals.createdAt,
      rewardedAt: schema.referrals.rewardedAt,
    })
    .from(schema.referrals)
    .where(eq(schema.referrals.referrerId, userId))
    .orderBy(desc(schema.referrals.createdAt))
    .limit(50);

  return {
    code,
    // §11.5 — we never expose who accepted an invite, only that one did.
    invited: rows.length,
    joined: rows.filter((r) => r.status === "joined").length,
    rewarded: rows.filter((r) => r.status === "rewarded").length,
    pointsPerReferral: POINT_RULES.referral_qualified,
    history: rows.map((r) => ({ status: r.status, at: r.rewardedAt ?? r.createdAt })),
  };
}
