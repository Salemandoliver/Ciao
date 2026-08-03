import { NextResponse, type NextRequest } from "next/server";
import { LOCALES, DEFAULT_LOCALE } from "@/lib/i18n";

/**
 * Locale routing.
 *
 * Every route lives under `app/[locale]/`, but Arabic must not carry a prefix:
 * `ciao.ly/l/tajoura-golden-sands` is the link people paste into WhatsApp, and
 * turning it into `/ar/l/…` overnight would break every share that already
 * exists. So an unprefixed request is rewritten to `/ar/…` internally while
 * the address bar keeps the clean path, and `/en/…` passes straight through.
 *
 * A rewrite, not a redirect: a redirect would cost a round trip on a
 * connection where round trips are the expensive part.
 *
 * There is deliberately no automatic redirect based on `Accept-Language`
 * either. A phone sold in Libya often reports `en-US` because nobody changed
 * the factory setting, so guessing from the header would send Libyan guests to
 * the English site on their own home page. The language toggle is explicit and
 * remembered; the header is only a hint for a first-time visitor with no
 * stored preference, handled client-side where it can be corrected in one tap.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const prefixed = LOCALES.some(
    (l) => l !== DEFAULT_LOCALE && (pathname === `/${l}` || pathname.startsWith(`/${l}/`)),
  );
  if (prefixed) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  /*
   * Pages only. Anything with a file extension is a static asset and must be
   * served from the bare origin untouched.
   *
   * The first version of this listed known asset prefixes instead, and missed
   * `/hero-marina-800.webp` — every hero photograph on the site got rewritten
   * to `/ar/hero-marina-800.webp` and 404'd, so the home page lost its
   * background imagery. Matching on "has a dot in it" is the version that
   * cannot be out-grown: no app route contains a dot, and every asset does.
   *
   * `/sw.js` falling out of scope matters for a second reason — a service
   * worker's scope is the path it is served from, so a rewritten one would
   * silently stop controlling the site.
   */
  matcher: ["/((?!api/|_next/|.*\\.).*)"],
};
