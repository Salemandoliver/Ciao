/**
 * Locales.
 *
 * Arabic is not "the default locale" in the i18n-library sense — it is the
 * product. Ciao is built for Libyans booking in Libya, the copy is written in
 * Libyan Arabic rather than translated into it, and the layout is RTL-first.
 * English is a second, genuine surface for the people who need it — Libyans
 * abroad booking a wedding hall from Manchester, embassy and NGO staff, the
 * diaspora arranging a family stay — not a machine-translated veneer.
 *
 * That is why Arabic lives at the bare path (`/l/tajoura-golden-sands`) and
 * English takes the prefix (`/en/l/tajoura-golden-sands`). Both are real,
 * shareable URLs, which matters more here than almost anywhere: distribution
 * is a WhatsApp link forwarded to a family group, and whoever opens it must
 * land in the language the sender was reading.
 */
export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ar";

export function isLocale(value: string | undefined): value is Locale {
  return value === "ar" || value === "en";
}

export function asLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function dirOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** BCP-47 tag for `lang`, `Intl`, and the API's Accept-Language header. */
export function bcp47(locale: Locale): string {
  return locale === "ar" ? "ar-LY" : "en-GB";
}

/**
 * Prefix an app path for a locale.
 *
 * Arabic gets no prefix, so every existing link and every link anyone writes
 * from now on keeps working untouched for the majority of users. Absolute
 * URLs, anchors, mail/tel links and already-prefixed paths pass through — a
 * link helper that mangles `https://` or `tel:` is worse than no helper.
 */
export function localePath(path: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return path;
  if (!path.startsWith("/")) return path;
  if (path === `/${locale}` || path.startsWith(`/${locale}/`)) return path;
  return `/${locale}${path === "/" ? "" : path}`;
}

/**
 * The inverse: strip any locale prefix, giving the bare app path.
 *
 * It strips `/ar` as well as `/en`, even though Arabic URLs never carry a
 * prefix in the address bar, because the middleware rewrite means client code
 * can be handed either form depending on where it reads the path from. A
 * helper that only knew about `/en` would leave a stray `/ar` on the front the
 * one time it mattered.
 */
export function stripLocale(path: string): { locale: Locale; path: string } {
  for (const locale of LOCALES) {
    if (path === `/${locale}`) return { locale, path: "/" };
    if (path.startsWith(`/${locale}/`)) return { locale, path: path.slice(locale.length + 1) };
  }
  return { locale: DEFAULT_LOCALE, path };
}
