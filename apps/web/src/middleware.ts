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
   * Everything except Next's own assets and the files that must be served from
   * the bare origin: the service worker's scope is the path it is served from,
   * so a rewritten `/sw.js` would silently narrow it and the PWA would stop
   * controlling the site.
   */
  matcher: [
    "/((?!_next/|api/|favicon|icon-|apple-icon|manifest\\.json|sw\\.js|robots\\.txt|sitemap\\.xml|img/|images/|media/).*)",
  ],
};
