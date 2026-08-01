/**
 * Promo codes.
 *
 * The commercial rule that shapes everything here: **a promo is funded from
 * Ciao's commission and capped there.** We will discount our own margin to win
 * a booking. We will not quietly pay a host out of pocket because somebody
 * typed a generous percentage into a form at midnight — the host's share of a
 * booking is a promise we made them, not a marketing budget.
 *
 * So `discountFor()` computes the headline discount, then clamps it to the
 * commission on that booking and says so in the response. A 50% code on a
 * booking where we earn 10% gives 10% off, not a loss.
 *
 * Everything else is the usual discipline: validity windows, per-user and
 * total caps enforced with a conditional UPDATE rather than a read-then-write,
 * and one redemption row per (promo, booking) so a retried request is a no-op.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { track } from "../intelligence/events.js";

export interface PromoContext {
  userId: string;
  total: number; // dirhams, before discount
  commission: number; // what Ciao earns on this booking
  vertical?: string;
  city?: string;
  listingId?: string;
}

export interface PromoResult {
  code: string;
  promoId: string;
  discount: number;
  /** True when the headline value was trimmed to our commission. */
  cappedByCommission: boolean;
  descriptionAr: string | null;
  kind: string;
}

/** Human reasons, in Arabic — these are shown at checkout, not logged. */
const REJECTION_AR: Record<string, string> = {
  unknown: "الكود غير صحيح",
  inactive: "هذا الكود لم يعد ساريًا",
  not_started: "هذا العرض لم يبدأ بعد",
  expired: "انتهت صلاحية هذا العرض",
  exhausted: "اكتمل عدد مرات استخدام هذا العرض",
  per_user: "استخدمت هذا العرض من قبل",
  min_spend: "قيمة الحجز أقل من الحد المطلوب لهذا العرض",
  vertical: "هذا العرض لا ينطبق على هذا القسم",
  city: "هذا العرض لا ينطبق على هذه المدينة",
  listing: "هذا العرض مخصص لمكان آخر",
  no_benefit: "لا يمكن تطبيق خصم على هذا الحجز",
};

export function rejectionMessage(reason: string): string {
  return REJECTION_AR[reason] ?? REJECTION_AR.unknown!;
}

/**
 * Evaluate a code against a booking. Pure read — no counters move here, so it
 * is safe to call from a live checkout screen on every keystroke.
 */
export async function evaluatePromo(code: string, ctx: PromoContext): Promise<PromoResult> {
  const clean = code.trim().toUpperCase();
  const [promo] = await db
    .select()
    .from(schema.promoCodes)
    .where(eq(schema.promoCodes.code, clean))
    .limit(1);
  if (!promo) throw new CiaoError("VALIDATION", "unknown");
  if (!promo.active) throw new CiaoError("VALIDATION", "inactive");

  const now = new Date();
  if (promo.startsAt && promo.startsAt > now) throw new CiaoError("VALIDATION", "not_started");
  if (promo.endsAt && promo.endsAt < now) throw new CiaoError("VALIDATION", "expired");
  if (promo.maxRedemptions != null && promo.timesUsed >= promo.maxRedemptions)
    throw new CiaoError("VALIDATION", "exhausted");

  const [used] = await db
    .select({ n: sql<string>`count(*)` })
    .from(schema.promoRedemptions)
    .where(
      and(
        eq(schema.promoRedemptions.promoId, promo.id),
        eq(schema.promoRedemptions.userId, ctx.userId),
      ),
    );
  if (Number(used?.n ?? 0) >= promo.perUserLimit)
    throw new CiaoError("VALIDATION", "per_user");

  if (ctx.total < promo.minSpend) throw new CiaoError("VALIDATION", "min_spend");
  if (promo.vertical && ctx.vertical && promo.vertical !== ctx.vertical)
    throw new CiaoError("VALIDATION", "vertical");
  if (promo.city && ctx.city && promo.city !== ctx.city) throw new CiaoError("VALIDATION", "city");
  if (promo.listingId && ctx.listingId && promo.listingId !== ctx.listingId)
    throw new CiaoError("VALIDATION", "listing");

  // Headline value…
  let discount =
    promo.kind === "percent"
      ? Math.round((ctx.total * promo.value) / 10000)
      : promo.kind === "fixed"
        ? promo.value
        : 0; // `points` codes award points on completion instead of discounting
  if (promo.maxDiscount != null) discount = Math.min(discount, promo.maxDiscount);
  discount = Math.min(discount, ctx.total);

  // …then the rule that matters: never deeper than what we earn.
  const cappedByCommission = promo.kind !== "points" && discount > ctx.commission;
  if (cappedByCommission) discount = ctx.commission;

  if (promo.kind !== "points" && discount <= 0) throw new CiaoError("VALIDATION", "no_benefit");

  return {
    code: clean,
    promoId: promo.id,
    discount,
    cappedByCommission,
    descriptionAr: promo.descriptionAr,
    kind: promo.kind,
  };
}

/**
 * Record a use. Counters move here, atomically.
 *
 * The `timesUsed` increment carries its own guard in the WHERE clause, so two
 * simultaneous checkouts on the last remaining redemption cannot both win —
 * a read-then-write would let them.
 */
export async function applyPromo(
  result: PromoResult,
  userId: string,
  bookingId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.promoRedemptions)
      .values({ promoId: result.promoId, userId, bookingId, discount: result.discount })
      .onConflictDoNothing()
      .returning();
    if (!row) return false; // already applied to this booking — a retry

    const [bumped] = await tx
      .update(schema.promoCodes)
      .set({ timesUsed: sql`${schema.promoCodes.timesUsed} + 1` })
      .where(
        and(
          eq(schema.promoCodes.id, result.promoId),
          sql`(${schema.promoCodes.maxRedemptions} is null
               or ${schema.promoCodes.timesUsed} < ${schema.promoCodes.maxRedemptions})`,
        ),
      )
      .returning();
    if (!bumped) throw new CiaoError("VALIDATION", "exhausted");

    return true;
  }).then((applied) => {
    if (applied)
      track(
        "promo.applied",
        { code: result.code, discount: result.discount, kind: result.kind },
        { userId },
      );
    return applied;
  });
}

/** Codes are typed on phones and read over WhatsApp — keep them unambiguous. */
export function normalizePromoCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}
