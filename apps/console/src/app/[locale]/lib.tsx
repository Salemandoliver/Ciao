"use client";
/**
 * Shared primitives for the Ciao Business console.
 *
 * These now live in `@/components/panel` so the partner control panel draws
 * from the same set — an operator and a chalet owner should recognise the same
 * page furniture, and two copies of "how a stat tile looks" is how one product
 * starts looking like two. Re-exported from here so every existing import in
 * the console keeps working.
 *
 * Listing status, verticals, roles and ledger accounts used to be duplicated
 * here as Arabic-only maps. They live in `@/lib/vocab` alongside every other
 * shared term, in both languages: read them with
 * `term(LISTING_STATUS, locale, k)`, `term(VERTICALS, …)`, `term(ROLES, …)`
 * and `accountLabel(locale, account)`. A status that reads one way in the
 * console and another way in the guest app is how people stop trusting it.
 */
export { Bars, Money, Pill, RangeMarker, Section, Stat } from "@/components/panel";
