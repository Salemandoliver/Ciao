import type { Locale } from "./i18n";
import { SERVICE_CATEGORY_LABELS, term } from "./vocab";

/**
 * Event-service categories.
 *
 * The keys and their emoji are data — they are the same in every language and
 * they are what the search query carries. The words are not: they live in
 * `SERVICE_CATEGORY_LABELS` in vocab.ts with everything else that has to read
 * the same on the home tiles, the search chips and a listing card.
 */
export const SERVICE_CATEGORY_KEYS: [key: string, emoji: string][] = [
  ["catering", "🍽"],
  ["photography", "📸"],
  ["makeup", "💄"],
  ["hair", "💇‍♀️"],
  ["cakes", "🎂"],
  ["gym", "🏋️"],
];

/** `[key, emoji, label]` in the reader's language, in display order. */
export function serviceCategories(locale: Locale): [string, string, string][] {
  return SERVICE_CATEGORY_KEYS.map(([key, emoji]) => [
    key,
    emoji,
    term(SERVICE_CATEGORY_LABELS, locale, key),
  ]);
}

/** One category, emoji and all: "🍽 Catering & buffets". */
export function serviceLabel(locale: Locale, key: string | undefined): string {
  if (!key) return "";
  const emoji = SERVICE_CATEGORY_KEYS.find(([k]) => k === key)?.[1];
  const label = term(SERVICE_CATEGORY_LABELS, locale, key);
  return emoji ? `${emoji} ${label}` : label;
}
