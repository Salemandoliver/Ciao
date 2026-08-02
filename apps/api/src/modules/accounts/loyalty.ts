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
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { track } from "../intelligence/events.js";
import { getSetting } from "../business/settings.js";

/**
 * Compiled-in defaults. The live values come from the control plane, so an
 * operator can run an Eid campaign without a deploy — these exist so the app
 * still behaves correctly if the settings table is unreachable.
 */
export const POINT_RULES = {
  /** Signing up at all — the nudge that turns a booker into a member. */
  signup: 1000,
  /** Verifying an email gives us a channel that survives a SIM change. */
  email_verified: 500,
  /**
   * The number that sets the scale of the whole programme: **one completed
   * stay should buy a coffee at a partner.** At 1000 points to the dinar that
   * is 5000 — about 0.4% of a typical booking, or 4% of our commission on it.
   * Set it lower and points become a number that never turns into anything,
   * which is worse than having no programme.
   */
  stay_completed: 5000,
  /** Writing a review — the corpus is the product (§8.8). */
  review_written: 2000,
  /** Your invitee completed their first stay. Paid on delivery, not signup. */
  referral_qualified: 10000,
  /** Being invited and completing your first stay. */
  referred_welcome: 5000,
  /**
   * Telling us your birthday.
   *
   * Paying for this rather than demanding it at signup is a data-quality
   * decision before it is a courtesy one. A required date-of-birth field on a
   * phone-first signup produces 01/01/1990 in bulk — and a birthday campaign
   * that fires on one day for a third of the base is worse than no campaign,
   * because it is visibly fake. People give you the real date when there is a
   * reason to.
   */
  birth_date_added: 500,
  /**
   * Telling us who usually travels with you — how many adults, how many
   * children, which age bands. Worth more than an email because it changes
   * what we can put in front of you: the ranker stops guessing party size from
   * behaviour and uses the number you gave it.
   */
  party_profile_added: 1000,
  /**
   * The annual birthday gift.
   *
   * The points are a loyalty benefit and are awarded whether or not the member
   * accepts marketing — they joined the programme, this is the programme. The
   * *message* saying so is marketing and only goes to people who opted in
   * (Law 6/2022). Conflating those two is how a nice gesture becomes an
   * unsolicited-communications complaint.
   */
  birthday_gift: 2500,
} as const;

export type PointReason = keyof typeof POINT_RULES;

/**
 * 1 point = 1 dirham of credit at conversion, i.e. 1000 points = 1 LYD.
 * Kept as an explicit constant because the day it changes, everything that
 * quotes a "worth" to the user has to change with it.
 */
export const POINT_TO_DIRHAM = 1;
export const MIN_REDEEM_POINTS = 5000; // 5 LYD — one stay's worth

/** The programme as it currently stands, straight from the control plane. */
export async function loyaltyConfig() {
  const [enabled, earnRules, pointToDirham, minRedeem, expiryMonths, partnersEnabled, voucherMinutes] =
    await Promise.all([
      getSetting("loyalty.enabled"),
      getSetting("loyalty.earnRules"),
      getSetting("loyalty.pointToDirham"),
      getSetting("loyalty.minRedeem"),
      getSetting("loyalty.expiryMonths"),
      getSetting("loyalty.partnersEnabled"),
      getSetting("loyalty.voucherMinutes"),
    ]);
  return {
    enabled: Boolean(enabled),
    earnRules: { ...POINT_RULES, ...(earnRules as Record<string, number>) },
    pointToDirham: Number(pointToDirham) || POINT_TO_DIRHAM,
    minRedeem: Number(minRedeem) || MIN_REDEEM_POINTS,
    expiryMonths: Number(expiryMonths ?? 0),
    partnersEnabled: Boolean(partnersEnabled),
    voucherMinutes: Number(voucherMinutes) || 30,
  };
}

const REASON_AR: Record<string, string> = {
  signup: "مكافأة إنشاء الحساب",
  email_verified: "توثيق البريد الإلكتروني",
  stay_completed: "إتمام إقامة",
  review_written: "كتابة تقييم",
  referral_qualified: "صديق دعوته أتمّ أول حجز",
  referred_welcome: "انضممت بدعوة من صديق",
  redeemed: "تحويل نقاط إلى رصيد",
  expired: "انتهت صلاحية نقاط",
  partner_voucher: "قسيمة لدى شريك",
  partner_voucher_refund: "إرجاع نقاط قسيمة منتهية",
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
  const cfg = await loyaltyConfig();
  if (!cfg.enabled) return 0;
  const delta = cfg.earnRules[reason];
  if (!delta) return 0;

  // Expiry is stamped per award, not computed later from a moving setting.
  // Shortening the programme's expiry must not retroactively wipe points
  // someone already earned under the old terms.
  const expiresAt =
    cfg.expiryMonths > 0
      ? new Date(new Date().setMonth(new Date().getMonth() + cfg.expiryMonths))
      : null;

  const [row] = await db
    .insert(schema.loyaltyLedger)
    .values({
      userId,
      delta,
      reason,
      refId: refId ?? reason, // null refIds would defeat the unique index
      refType,
      memoAr: REASON_AR[reason] ?? reason,
      expiresAt,
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
  const cfg = await loyaltyConfig();
  if (points < cfg.minRedeem) throw new CiaoError("VALIDATION", `min_redeem_${cfg.minRedeem}`);

  const balance = await pointsBalance(userId);
  if (points > balance) throw new CiaoError("VALIDATION", "insufficient_points");

  const dirhams = points * cfg.pointToDirham;
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

/**
 * Expire lapsed awards.
 *
 * Written as an offsetting negative row rather than a mutation of the original,
 * so a guest asking "where did my points go?" gets an answer with a date on it
 * instead of a silently smaller number. Runs from the worker.
 */
export async function expirePoints(limit = 500): Promise<number> {
  const due = await db
    .select()
    .from(schema.loyaltyLedger)
    .where(
      and(
        sql`${schema.loyaltyLedger.delta} > 0`,
        isNull(schema.loyaltyLedger.expiredAt),
        sql`${schema.loyaltyLedger.expiresAt} is not null`,
        lte(schema.loyaltyLedger.expiresAt, new Date()),
      ),
    )
    .limit(limit);
  if (due.length === 0) return 0;

  let expired = 0;
  for (const row of due) {
    // Only expire what the guest still holds: someone who already spent these
    // points must not be pushed negative by a late sweep.
    const balance = await pointsBalance(row.userId);
    const amount = Math.min(row.delta, Math.max(0, balance));
    await db.transaction(async (tx) => {
      await tx
        .update(schema.loyaltyLedger)
        .set({ expiredAt: new Date() })
        .where(eq(schema.loyaltyLedger.id, row.id));
      if (amount > 0) {
        await tx.insert(schema.loyaltyLedger).values({
          userId: row.userId,
          delta: -amount,
          reason: "expired",
          refId: `expire:${row.id}`,
          refType: "loyalty",
          memoAr: REASON_AR.expired,
        });
        await tx
          .update(schema.users)
          .set({ pointsBalance: sql`greatest(0, ${schema.users.pointsBalance} - ${amount})` })
          .where(eq(schema.users.id, row.userId));
      }
    });
    if (amount > 0) expired += amount;
  }
  return expired;
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
