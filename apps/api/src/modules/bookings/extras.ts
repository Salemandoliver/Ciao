/**
 * A booking's half of the partner catalogue.
 *
 * The stay itself is priced by `quoteStay` from the listing's nightly rate —
 * that path is price-locked, tested, and not something to rewrite. What this
 * adds is everything the partner sells *alongside* it: the barbecue, the extra
 * mattress, late checkout, the travel fee. In this market that half of the
 * booking is currently agreed over WhatsApp and forgotten by the time anyone
 * invoices, which is why a host's own record of what a guest owes so often differs
 * from the guest's.
 *
 * Three rules, all of which exist because this is money:
 *
 *  1. **The client sends a selection, never a total.** Quantities are clamped
 *     to what the partner allowed, add-ons belonging to somebody else are
 *     dropped, and required add-ons are added whether or not they were asked
 *     for. A client that can post a price is a client that can post any price.
 *  2. **The partner's discount is theirs, ours is ours.** Kept in separate
 *     columns and never summed: our promo code is marketing spend capped at
 *     our commission, and their offer reduces their revenue. One number would
 *     make the payout unexplainable to the person it is explained to.
 *  3. **Everything is snapshotted.** Names and prices are copied onto the
 *     booking, so renaming an add-on or repricing it next month cannot rewrite
 *     what a guest agreed to pay three weeks ago (§9.6).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { evaluatePromotion, type PricedAddonChoice } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { collectIntakeAnswers } from "../partner/catalogue.js";

export interface ExtrasInput {
  /** The venue's host — the partner whose catalogue this is. */
  hostId: string | null;
  /** The guest, so a per-customer offer limit can actually be evaluated. */
  guestId?: string | null;
  listingId: string;
  addons: { addonId: string; qty: number }[];
  intake: { questionId: string; answer: string }[];
  partnerPromoCode?: string | null;
  /** The stay total the partner's offer is evaluated against. */
  subtotal: number;
  day: string;
  guests: number;
  nights: number;
}

export interface ExtrasResult {
  addonsTotal: number;
  lines: { addonId: string; nameAr: string; qty: number; unitPrice: number; total: number }[];
  answers: { questionId: string; promptAr: string; answer: string }[];
  discount: number;
  promotionId: string | null;
  promotionLabel: string | null;
}

const EMPTY: ExtrasResult = {
  addonsTotal: 0,
  lines: [],
  answers: [],
  discount: 0,
  promotionId: null,
  promotionLabel: null,
};

export async function priceExtras(input: ExtrasInput): Promise<ExtrasResult> {
  // A listing whose venue has no host cannot have a catalogue. Not an error —
  // most of the marketplace predates this feature and must keep booking.
  if (!input.hostId) return EMPTY;
  const partnerId = input.hostId;

  // ── add-ons ────────────────────────────────────────────────────────────
  const wanted = new Map(
    input.addons.map((a) => [a.addonId, Math.max(0, Math.round(a.qty))] as const),
  );
  const rows = await db
    .select()
    .from(schema.partnerAddons)
    .where(
      and(
        eq(schema.partnerAddons.partnerId, partnerId),
        eq(schema.partnerAddons.active, true),
        wanted.size
          ? sql`(${schema.partnerAddons.required} = true or ${schema.partnerAddons.id} in (${sql.join(
              [...wanted.keys()].map((k) => sql`${k}::uuid`),
              sql`, `,
            )}))`
          : eq(schema.partnerAddons.required, true),
      ),
    );

  const choices: PricedAddonChoice[] = rows
    // A per-service add-on is scoped to a catalogue service; a stay booked
    // from a listing is not one of those, so only business-wide extras apply.
    .filter((a) => !a.serviceId)
    .map((a) => ({
      id: a.id,
      nameAr: a.nameAr,
      price: a.price,
      priceModel: a.priceModel,
      qty: a.required ? Math.max(1, wanted.get(a.id) ?? 1) : Math.min(wanted.get(a.id) ?? 0, a.maxQty),
    }))
    .filter((c) => c.qty > 0);

  let addonsTotal = 0;
  const lines: ExtrasResult["lines"] = [];
  for (const c of choices) {
    /*
     * `per_km` has no distance on a stay booking — nobody is driving to a
     * chalet on our behalf — so it prices as flat rather than silently
     * multiplying by zero and appearing free. A travel fee that shows as 0 is
     * a fee the host has to chase in person.
     */
    const multiplier =
      c.priceModel === "per_unit"
        ? Math.max(1, input.nights)
        : c.priceModel === "per_person"
          ? Math.max(1, input.guests)
          : 1;
    const total = c.price * c.qty * multiplier;
    addonsTotal += total;
    lines.push({
      addonId: c.id,
      nameAr: c.nameAr,
      qty: c.qty * multiplier,
      unitPrice: c.price,
      total,
    });
  }

  // ── the partner's own intake questions ─────────────────────────────────
  // Throws when a required question is unanswered, which is correct: the
  // partner said they cannot do the job without knowing, and a booking taken
  // anyway becomes the phone call the feature exists to prevent.
  const answers = await collectIntakeAnswers(partnerId, null, input.intake);

  // ── the partner's own offer ────────────────────────────────────────────
  const promo = await findOffer(partnerId, input.partnerPromoCode);
  /*
   * Resolve the guest against the partner's own customer book.
   *
   * Without this, `firstTimeOnly` and `maxPerClient` were dead letters on the
   * booking path: `evaluatePromotion` treats an absent `isFirstTime` as "not
   * disqualified", so a first-booking-only offer was granted to every returning
   * guest, every time. The link is `ciaoUserId`, set when a partner's client is
   * matched to a Ciao member; no row genuinely means first time.
   */
  const client =
    promo && input.guestId
      ? (
          await db
            .select({ id: schema.partnerClients.id, jobs: schema.partnerClients.jobsCount })
            .from(schema.partnerClients)
            .where(
              and(
                eq(schema.partnerClients.partnerId, partnerId),
                eq(schema.partnerClients.ciaoUserId, input.guestId),
              ),
            )
            .limit(1)
        )[0]
      : undefined;
  const clientRedemptions =
    promo && client
      ? Number(
          (
            await db
              .select({ n: sql<string>`count(*)` })
              .from(schema.partnerJobs)
              .where(
                and(
                  eq(schema.partnerJobs.partnerId, partnerId),
                  eq(schema.partnerJobs.clientId, client.id),
                  eq(schema.partnerJobs.promotionId, promo.id),
                ),
              )
          )[0]?.n ?? 0,
        )
      : 0;

  let discount = 0;
  let promotionId: string | null = null;
  let promotionLabel: string | null = null;
  if (promo) {
    const verdict = evaluatePromotion(
      {
        id: promo.id,
        code: promo.code,
        labelAr: promo.labelAr,
        kind: promo.kind,
        valueBps: promo.valueBps,
        valueFlat: promo.valueFlat,
        maxDiscount: promo.maxDiscount,
        minSpend: promo.minSpend,
        serviceIds: (promo.serviceIds as string[]) ?? [],
        fromDay: promo.fromDay,
        toDay: promo.toDay,
        travelFromDay: promo.travelFromDay,
        travelToDay: promo.travelToDay,
        maxRedemptions: promo.maxRedemptions,
        maxPerClient: promo.maxPerClient,
        redemptions: promo.redemptions,
        firstTimeOnly: promo.firstTimeOnly,
        active: promo.active,
        freeAddonId: promo.freeAddonId,
      },
      {
        subtotal: input.subtotal + addonsTotal,
        travelDay: input.day,
        today: new Date().toISOString().slice(0, 10),
        clientRedemptions,
        isFirstTime: (client?.jobs ?? 0) === 0,
        addons: choices,
      },
    );
    if (verdict.ok && verdict.discount > 0) {
      discount = verdict.discount;
      promotionId = promo.id;
      promotionLabel = promo.labelAr;
    }
    /*
     * A refused offer is silent here, unlike Ciao's promo codes which fail the
     * request loudly. The difference is who typed it: a guest entering our
     * code expects it to work and must be told when it does not, whereas an
     * automatic partner offer that happens not to qualify is not something the
     * guest asked for — surfacing "your offer was refused" for a discount they
     * never knew about would be confusing rather than honest.
     */
  }

  return { addonsTotal, lines, answers, discount, promotionId, promotionLabel };
}

/**
 * A named code wins; otherwise the partner's automatic offer applies.
 *
 * Scoped offers are excluded from the automatic path: a promotion aimed at
 * three specific catalogue services should not attach itself to a stay booked
 * from a listing, where none of those services is what was bought.
 */
async function findOffer(partnerId: string, code?: string | null) {
  if (code?.trim()) {
    const [row] = await db
      .select()
      .from(schema.partnerPromotions)
      .where(
        and(
          eq(schema.partnerPromotions.partnerId, partnerId),
          eq(schema.partnerPromotions.code, code.trim().toUpperCase()),
          eq(schema.partnerPromotions.active, true),
        ),
      )
      .limit(1);
    return row ?? null;
  }
  const autos = await db
    .select()
    .from(schema.partnerPromotions)
    .where(
      and(
        eq(schema.partnerPromotions.partnerId, partnerId),
        eq(schema.partnerPromotions.active, true),
        sql`${schema.partnerPromotions.code} is null`,
        sql`jsonb_array_length(${schema.partnerPromotions.serviceIds}) = 0`,
      ),
    );
  return autos[0] ?? null;
}
