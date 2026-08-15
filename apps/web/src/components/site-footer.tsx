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
      <ul className="space-y-1.5 text-sm">{children}</ul>
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
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-8">
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

          <Column title={c.hosts}>
            <Item href="/hosts" label={c.hostsCta} />
          </Column>
        </div>

        {/*
          The pricing sentence stays, and stays last. It is the one line in the
          footer that is not navigation: it tells a guest what they are about to
          be charged and where, which is §10 in a sentence and belongs on every
          page rather than only in the terms.
        */}
        <p
          className="mt-8 pt-6 text-sm border-t"
          style={{ color: MUTED, borderColor: "rgb(245 238 221 / 0.15)" }}
        >
          {c.prices}
        </p>
      </div>
    </footer>
  );
}
