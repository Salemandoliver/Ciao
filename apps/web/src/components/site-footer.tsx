"use client";
/**
 * The footer — a dark band across the full width of the viewport.
 *
 * What was here was three centred lines of grey text, which is a footer for a
 * page and not for a marketplace. The design gives it columns: the catalogue,
 * the company, the guest's own account, and the way in for a host.
 *
 * ## It is dark in both themes, on purpose
 *
 * The frames put a navy band at the foot of the light pages as well as the dark
 * ones, and that is the right call rather than an oversight: the footer's job is
 * to end the page, and a cream footer under a cream page ends nothing. So the
 * colours here are fixed, like the chips that sit on photographs — the band is
 * its own surface and does not follow the tokens.
 *
 * ## Full width, so it has to live outside `<main>`
 *
 * Every page centres its content in a `max-w-*` container. A band that stops at
 * 1280px is a grey rectangle floating in the middle of a wide screen, so this
 * renders after the container closes and paints edge to edge.
 */
import { Link, useLocale } from "@/lib/locale";
import { Logo } from "@/components/logo";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: {
    explore: "استكشف",
    coast: "شاليهات واستراحات",
    halls: "قاعات أفراح",
    services: "خدمات المناسبات",
    company: "تشاو",
    about: "من نحن وكيف نعتمد الأماكن",
    rewards: "نقاط المكافآت",
    partners: "شركاء المكافآت",
    account: "حسابك",
    my: "حجوزاتي",
    wishlist: "المفضلة",
    signin: "تسجيل الدخول",
    hosts: "لديك مكان؟",
    hostsCta: "اعرض مكانك على تشاو",
    follow: "تابعنا",
    soon: "قريبًا",
    place: "تشاو — ciao.ly · صُنع بحب في ليبيا",
    prices: "الأسعار كلها بالدينار الليبي. العربون فقط أونلاين والباقي عند الوصول.",
  },
  en: {
    explore: "Explore",
    coast: "Chalets & estirahas",
    halls: "Wedding halls",
    services: "Event services",
    company: "Ciao",
    about: "Who we are and how we verify places",
    rewards: "Reward points",
    partners: "Reward partners",
    account: "Your account",
    my: "My bookings",
    wishlist: "Wishlist",
    signin: "Sign in",
    hosts: "Have a place?",
    hostsCta: "List it on Ciao",
    follow: "Follow us",
    soon: "Coming soon",
    place: "Ciao — ciao.ly · Made with Love in Libya",
    prices:
      "All prices in Libyan dinars. Only the deposit is paid online; the rest on arrival.",
  },
} satisfies Record<Locale, unknown>;

/* Cream on the band measures 15.9:1; the muted tan 7.4:1. Both are fixed
 * because the band is. */
const INK = "#f5eedd";
const MUTED = "#c4a97a";

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-bold text-sm mb-2" style={{ color: INK }}>
        {title}
      </h3>
      <ul className="space-y-1 text-sm">{children}</ul>
    </div>
  );
}

/* ------------------------------------------------------------------- social
 * Marks only, drawn rather than fetched: three inline paths cost nothing and an
 * icon font or an SVG sprite would be a network request for nine glyphs.
 *
 * They are NOT links. The pages do not exist yet, and an anchor pointing at
 * nothing — or worse at a stranger's account on the same handle — is a broken
 * promise on every page of the site. So these are inert until there is
 * somewhere to send people, and they say so: `aria-disabled`, a "coming soon"
 * title, and no `href` for a keyboard to land on.
 */
const SOCIAL = [
  {
    key: "facebook",
    label: "Facebook",
    path: "M15.12 5.32H17V2.14A26.11 26.11 0 0 0 14.26 2C11.54 2 9.68 3.66 9.68 6.7v2.62H6.61v3.56h3.07V22h3.68v-9.12h3.06l.46-3.56h-3.52V7.05c0-1.03.28-1.73 1.76-1.73Z",
  },
  {
    key: "instagram",
    label: "Instagram",
    path: "M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85C2.38 3.92 3.89 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16Zm0 5.17a4.67 4.67 0 1 0 0 9.34 4.67 4.67 0 0 0 0-9.34Zm0 7.7a3.03 3.03 0 1 1 0-6.07 3.03 3.03 0 0 1 0 6.07Zm4.85-8.99a1.09 1.09 0 1 0 0 2.18 1.09 1.09 0 0 0 0-2.18Z",
  },
  {
    key: "tiktok",
    label: "TikTok",
    path: "M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.59 2.59 0 0 1 0-5.18c.27 0 .52.04.76.12v-3.2a5.79 5.79 0 0 0-.76-.05 5.71 5.71 0 1 0 5.71 5.71V9.01a7.35 7.35 0 0 0 4.29 1.37V7.3a4.29 4.29 0 0 1-3.26-1.48Z",
  },
] as const;

function Social({ label, soon }: { label: string; soon: string }) {
  return (
    /*
     * Label and marks on one line rather than stacked. Three 36px circles under
     * a heading is two rows for one small thing, and the band is a footer — the
     * least of the page's claims on the screen.
     */
    <div className="flex items-center gap-3">
      <h3 className="font-bold text-sm shrink-0" style={{ color: INK }}>
        {label}
      </h3>
      <ul className="flex items-center gap-2" dir="ltr">
        {SOCIAL.map((s) => (
          <li key={s.key}>
            <span
              role="img"
              aria-label={`${s.label} — ${soon}`}
              aria-disabled="true"
              title={`${s.label} — ${soon}`}
              className="grid h-8 w-8 place-items-center rounded-full"
              style={{ background: "rgb(245 238 221 / 0.08)", color: MUTED }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d={s.path} />
              </svg>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Item({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 rounded-sm"
        style={{ color: MUTED }}
      >
        {label}
      </Link>
    </li>
  );
}

export function SiteFooter() {
  const locale = useLocale();
  const c = copy[locale];
  return (
    <footer className="mt-16" style={{ background: "#0d1b2a" }}>
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-8 gap-y-7">
          {/* The mark leads the band, and takes its own column on a wide
              screen so the four link columns keep an even rhythm. */}
          <div className="col-span-2 lg:col-span-1">
            <Logo onDark />
            <p className="mt-3 text-sm" style={{ color: MUTED }}>
              {c.place}
            </p>
          </div>

          <Column title={c.explore}>
            <Item href="/search?type=coast" label={c.coast} />
            <Item href="/search?type=hall" label={c.halls} />
            <Item href="/search?type=service" label={c.services} />
          </Column>

          <Column title={c.company}>
            <Item href="/about" label={c.about} />
            <Item href="/rewards" label={c.rewards} />
            <Item href="/rewards/partners" label={c.partners} />
          </Column>

          <Column title={c.account}>
            <Item href="/my" label={c.my} />
            <Item href="/wishlist" label={c.wishlist} />
            <Item href="/account" label={c.signin} />
          </Column>

          {/*
            The hosts column carries one link, which left a hole under it on a
            wide screen. The social marks fill it and belong beside it: both are
            the "and one more thing" end of the band rather than navigation
            through the catalogue.
          */}
          <div className="space-y-4">
            <Column title={c.hosts}>
              <Item href="/hosts" label={c.hostsCta} />
            </Column>
            <Social label={c.follow} soon={c.soon} />
          </div>
        </div>

        {/*
          The pricing sentence stays, and stays last. It is the one line in the
          footer that is not navigation: it tells a guest what they are about to
          be charged and where, which is §10 in a sentence and belongs on every
          page rather than only in the terms.
        */}
        <p
          className="mt-7 pt-5 text-sm border-t"
          style={{ color: MUTED, borderColor: "rgb(245 238 221 / 0.15)" }}
        >
          {c.prices}
        </p>
      </div>
    </footer>
  );
}
