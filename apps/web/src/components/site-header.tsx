"use client";
/**
 * One nav for the guest side.
 *
 * There were three. The home page carried the wishlist, About and the account;
 * the search page carried a language toggle and nothing else; the listing page
 * carried a back link. So a guest who arrived on a result set — which is most
 * of them, because that is what a shared link points at — could not reach their
 * own bookings without going back to the home page first.
 *
 * The frames show one bar on every screen, and that is the fix as much as it is
 * the style: logo at the start, the page's own context beside it, the guest's
 * things at the end.
 *
 * The centre slot is what differs per page: the vertical on search, the way
 * back on a listing, nothing on the home page. It truncates rather than wraps,
 * because a long Arabic hall name should shorten the label and not push the
 * account link onto a second line.
 *
 * What is deliberately NOT here: the design's centred search pill. Both pages
 * that would carry one already render a real search — `HeroSearch` compact on
 * search, the hero's own on home — and a second search box in the bar above it
 * is two controls that do the same thing, one of which is a decoration.
 */
import { Link, useLocale } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: { wishlist: "المفضلة", about: "من نحن", account: "حسابي" },
  en: { wishlist: "Wishlist", about: "About", account: "Account" },
} satisfies Record<Locale, unknown>;

export function SiteHeader({ centre }: { centre?: React.ReactNode }) {
  const locale = useLocale();
  const c = copy[locale];
  return (
    <header className="flex items-center gap-4 py-4">
      <Link href="/" className="shrink-0">
        <Logo />
      </Link>
      {centre ? <div className="min-w-0 truncate">{centre}</div> : null}
      <nav className="ms-auto flex shrink-0 items-center gap-3 text-sm font-bold text-sea">
        <Link href="/wishlist" aria-label={c.wishlist}>
          🤍
        </Link>
        {/* The one item that goes when the bar gets tight: it is the only link
            here a guest is not part-way through something to reach. */}
        <Link href="/about" className="hidden sm:inline">
          {c.about}
        </Link>
        <Link href="/account">{c.account}</Link>
        <LanguageToggle />
      </nav>
    </header>
  );
}
