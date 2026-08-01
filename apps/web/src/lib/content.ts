import type { Locale } from "./i18n";

/**
 * Listing text in the reader's language, with an honest fallback.
 *
 * Ciao's listings are written in Arabic by the people who visited the place.
 * The English columns exist and get filled in from the business console, but
 * they will be empty for a long while, and the two obvious ways to handle that
 * are both wrong for this product:
 *
 *  - Machine-translating on the fly would mean publishing unreviewed text
 *    about a property we personally inspected and vouched for. The whole
 *    proposition is "we went there and this is what we found"; an automated
 *    paraphrase of that claim is not the same claim, and the first time a
 *    mistranslation contradicts the amenity table the badge is worth nothing.
 *  - Hiding listings without English text would show an English visitor an
 *    almost empty marketplace, which reads as "nothing available here" rather
 *    than "not translated yet".
 *
 * So: show the Arabic, and mark it as Arabic. `lang` and `dir` on the element
 * matter beyond tidiness — they tell a screen reader to switch voice instead
 * of spelling Arabic out letter by letter in an English accent, and they let
 * the browser render the string with correct bidirectional ordering inside an
 * otherwise left-to-right page.
 */
export interface LocalisedText {
  text: string;
  /** The language the text is actually in, which may not be the page's. */
  lang: Locale;
  /** True when we fell back — the caller decides whether to flag it. */
  isFallback: boolean;
}

function choose(
  locale: Locale,
  ar: string | undefined | null,
  en: string | undefined | null,
): LocalisedText | null {
  const preferred = locale === "en" ? en : ar;
  if (preferred && preferred.trim()) return { text: preferred, lang: locale, isFallback: false };
  const other = locale === "en" ? ar : en;
  if (other && other.trim()) {
    return { text: other, lang: locale === "en" ? "ar" : "en", isFallback: true };
  }
  return null;
}

export function listingTitle(
  locale: Locale,
  listing: { titleAr: string; titleEn?: string | null },
): LocalisedText {
  // A listing always has an Arabic title (NOT NULL in the schema), so the
  // non-null assertion here is a schema guarantee rather than an assumption.
  return choose(locale, listing.titleAr, listing.titleEn)!;
}

export function listingDescription(
  locale: Locale,
  listing: { descriptionAr?: string | null; descriptionEn?: string | null },
): LocalisedText | null {
  return choose(locale, listing.descriptionAr, listing.descriptionEn);
}

/** Props to spread onto the element rendering a LocalisedText. */
export function textProps(t: LocalisedText) {
  return { lang: t.lang, dir: t.lang === "ar" ? ("rtl" as const) : ("ltr" as const) };
}
