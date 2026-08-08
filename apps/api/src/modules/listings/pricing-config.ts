/**
 * One place that turns a listing row into a `PricingConfig`.
 *
 * There were two call sites building this by hand — the quote endpoint and the
 * booking service — and they each passed four of the listing's pricing fields.
 * That was survivable while there were four. It stopped being survivable the
 * moment a real rate card arrived and the number went to a dozen, spread
 * across columns and a second table, because the failure mode of the two
 * copies drifting is that the price a guest is *shown* stops matching the price
 * they are *charged*. In a marketplace whose entire pitch is that the number
 * you see is the number you pay, that is not a bug, it is the product failing.
 *
 * So: one function, used by both, and by the seed, and by anything that comes
 * later.
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import {
  DEFAULT_CHILD_POLICY,
  type BoardBasis,
  type PricingConfig,
  type RateWindow,
} from "@ciao/shared";

type ListingRow = typeof schema.listings.$inferSelect;

/**
 * Rate windows overlapping a stay.
 *
 * Filtered in SQL by the stay's own bounds rather than fetched wholesale: a
 * property that has been running promotions for three seasons accumulates
 * windows forever, and a two-night booking has no business reading them all.
 */
export async function rateWindowsFor(
  listingId: string,
  checkIn?: string,
  checkOut?: string,
): Promise<RateWindow[]> {
  const rows = await db
    .select()
    .from(schema.listingRates)
    .where(
      checkIn && checkOut
        ? and(
            eq(schema.listingRates.listingId, listingId),
            lte(schema.listingRates.startDate, checkOut),
            gte(schema.listingRates.endDate, checkIn),
          )
        : eq(schema.listingRates.listingId, listingId),
    );
  return rows.map((r) => ({
    startDate: r.startDate,
    endDate: r.endDate,
    nightly: r.nightly,
    flat: r.flat,
    ...(r.minNights ? { minNights: r.minNights } : {}),
    ...(r.labelAr ? { labelAr: r.labelAr } : {}),
    ...(r.labelEn ? { labelEn: r.labelEn } : {}),
  }));
}

/**
 * Build the config. `rates` is passed in rather than fetched here so a caller
 * inside a transaction can supply its own read.
 */
export function pricingConfigFor(listing: ListingRow, rates: RateWindow[] = []): PricingConfig {
  /*
   * The child policy is all-or-nothing. A listing that has set only one of the
   * three bounds has a policy with a hole in it, which is the precise failure
   * this design exists to prevent, so it falls back to the platform default
   * rather than being half-applied.
   */
  const hasChildPolicy =
    listing.childFreeUnder != null &&
    listing.childReducedUnder != null &&
    listing.childReducedBps != null;

  return {
    baseNightly: listing.baseNightly,
    weekendMultiplierBps: listing.weekendMultiplierBps,
    thursdayMultiplierBps: listing.thursdayMultiplierBps,
    ...(listing.weekendSupplement != null ? { weekendSupplement: listing.weekendSupplement } : {}),
    ...(listing.thursdaySupplement != null ? { thursdaySupplement: listing.thursdaySupplement } : {}),
    seasonMultiplierBps: listing.seasonMultiplierBps,
    ...(listing.dayUsePrice != null ? { dayUsePrice: listing.dayUsePrice } : {}),
    ...(listing.includedGuests != null ? { includedGuests: listing.includedGuests } : {}),
    ...(listing.extraGuestFee != null ? { extraGuestFee: listing.extraGuestFee } : {}),
    ...(listing.extraBedPrice != null ? { extraBedPrice: listing.extraBedPrice } : {}),
    ...(listing.minNights != null ? { minNights: listing.minNights } : {}),
    childPolicy: hasChildPolicy
      ? {
          freeUnder: listing.childFreeUnder!,
          reducedUnder: listing.childReducedUnder!,
          reducedBps: listing.childReducedBps!,
        }
      : DEFAULT_CHILD_POLICY,
    board: listing.boardBasis as BoardBasis,
    rates,
  };
}

/** The common case: fetch the windows and build the config in one go. */
export async function loadPricingConfig(
  listing: ListingRow,
  checkIn?: string,
  checkOut?: string,
): Promise<PricingConfig> {
  return pricingConfigFor(listing, await rateWindowsFor(listing.id, checkIn, checkOut));
}
