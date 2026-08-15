import { Link } from "@/lib/locale";
import { ListingCard } from "@/components/listing-card";
import { HeroSearch } from "@/components/hero-search";
import { HeroRotator, type HeroImage } from "@/components/hero-rotator";
import { Greeting } from "@/components/greeting";
import { RecsStrip } from "@/components/recs";
import { PartnerInvite } from "@/components/partner-invite";
import { BrandSlot } from "@/components/brand-slot";
import { ServiceTiles } from "@/components/service-tiles";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { API_URL } from "@/lib/api";
import { asLocale, type Locale } from "@/lib/i18n";
import type { PublicListing } from "@/lib/types";
import type { RenderedBrandMessage } from "@ciao/shared";

/** Fallback if the control plane is unreachable — the page must still render. */
const FALLBACK_HERO: { intervalMs: number; images: HeroImage[] } = {
  intervalMs: 6000,
  images: [
    { src: "/hero-marina", alt: "واجهة طرابلس البحرية والحديقة المطلة على المتوسط" },
    { src: "/hero-castle", alt: "السرايا الحمراء في طرابلس القديمة" },
    { src: "/hero-lake", alt: "بحيرة أبو ستة وأفق طرابلس" },
    { src: "/hero-skyline", alt: "أبراج طرابلس الجديدة على الكورنيش" },
    { src: "/hero", alt: "غروب الشمس على مدينة ليبية" },
  ],
};

/**
 * Page copy.
 *
 * Colocated with the page rather than pooled in one enormous dictionary: the
 * Arabic and the English sit next to each other and next to the markup, so a
 * change to one is visibly a change to a pair, and nobody edits a headline and
 * leaves the other language stale three directories away.
 *
 * The English is written, not translated. «قول تشاو للحجز أونلاين» is a pun —
 * "say ciao to booking online", where ciao is both the brand and the goodbye —
 * and it happens to work in English, so it stays. Elsewhere the English says
 * what the Arabic means rather than what it literally says.
 */
const copy = {
  ar: {
    heroLead: "قول",
    heroBrand: "تشاو",
    heroTail: "للحجز أونلاين",
    heroBody:
      "الشاليهات والاستراحات وقاعات الأفراح — كلها بين يديك. احجز بعربون بسيط وادفع الباقي عند الوصول.",
    trust: [
      [
        "✓ نعتمدها بأنفسنا",
        "فريق تشاو يزور كل مكان شخصيًا ويفحصه ويعتمده قبل النشر — ما تشوفه هو الموجود",
      ],
      ["💰 عربون يحمي الطرفين", "٢٠٪ فقط لقفل التاريخ — والمضيف يعرف أنك جاد"],
      [
        "📵 يشتغل وقت انقطاع الكهرباء",
        "قسيمتك والعنوان محفوظان بدون إنترنت، والتأكيدات تصلك واتساب و SMS",
      ],
    ],
    coast: "شاليهات واستراحات",
    halls: "قاعات الأفراح",
    seeAll: "عرض الكل ←",
  },
  en: {
    heroLead: "Say",
    heroBrand: "ciao",
    heroTail: "to booking online.",
    heroBody:
      "Beach chalets, estirahas and wedding halls — all at your fingertips. Book with a small deposit and pay the rest on arrival.",
    trust: [
      [
        "✓ We verify them ourselves",
        "Someone from Ciao visits every place, inspects it and approves it before it goes live — what you see is what is there",
      ],
      [
        "💰 A deposit that protects both sides",
        "Just 20% to hold the date — and the host knows you mean it",
      ],
      [
        "📵 Works through a power cut",
        "Your voucher and the address are saved offline, and confirmations reach you on WhatsApp and SMS",
      ],
    ],
    coast: "Chalets & estirahas",
    halls: "Wedding halls",
    seeAll: "See all →",
  },
} satisfies Record<Locale, unknown>;

/** Hero imagery is operator-controlled (business console → الإعدادات). */
async function getHero(): Promise<{ intervalMs: number; images: HeroImage[] }> {
  try {
    const res = await fetch(`${API_URL}/v1/settings/public`, { next: { revalidate: 60 } });
    if (!res.ok) return FALLBACK_HERO;
    const body = (await res.json()) as { hero?: { intervalMs?: number; images?: HeroImage[] } };
    const images = body.hero?.images?.filter((i) => i?.src) ?? [];
    return images.length
      ? { intervalMs: body.hero?.intervalMs ?? 6000, images }
      : FALLBACK_HERO;
  } catch {
    return FALLBACK_HERO;
  }
}

/**
 * The brand band's words, resolved by the API for this language and audience.
 *
 * The home page passes no city and no vertical, and that is a statement rather
 * than an omission: a static page served from a CDN does not know who is
 * reading it, and guessing would put a Misrata offer in front of Tripoli. A
 * targeted message therefore appears on the search pages that do know, and the
 * composer says exactly that to whoever schedules one.
 *
 * Sixty seconds, matching the rest of the public control plane. A greeting
 * scheduled to start today appears within a minute of the day turning, which
 * is the resolution anybody actually schedules at — and the alternative is an
 * uncacheable request on every home-page view over a 3G connection.
 *
 * On failure the band renders nothing rather than something stale: the
 * standing copy already lives behind this endpoint, so a fetch that fails
 * means the origin is down, and an app with no origin has worse things to say
 * than a missing paragraph.
 */
type BrandPayload = RenderedBrandMessage & { id: string; standing: boolean };

async function getBrandMessage(locale: Locale): Promise<BrandPayload | null> {
  try {
    const res = await fetch(`${API_URL}/v1/brand-message?locale=${locale}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as BrandPayload;
  } catch {
    return null;
  }
}

export const revalidate = 300; // listing content is CDN-cacheable (§12.3)

async function getFeatured(type: "coast" | "hall"): Promise<PublicListing[]> {
  try {
    const res = await fetch(`${API_URL}/v1/listings?type=${type}&limit=6`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    return ((await res.json()) as { items: PublicListing[] }).items;
  } catch {
    return []; // origin down → static shell still renders (§12.5)
  }
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  const c = copy[locale];
  const [coast, halls, hero, brand] = await Promise.all([
    getFeatured("coast"),
    getFeatured("hall"),
    getHero(),
    getBrandMessage(locale),
  ]);


  return (
    <>
      {/*
        `max-w-7xl`, matching the search page. At 5xl the home page used barely
        two thirds of a 1440px screen and the three-column rows below rendered
        as three narrow cards in a wide margin, which is the mobile layout
        widened rather than a desktop layout.
      */}
      <main className="mx-auto max-w-7xl px-4 pb-16">
      {/*
        The same bar the search and listing pages now carry. "للمضيفين" is still
        not in it: partners have their own product on their own origin, and the
        panel further down this page is where a prospective one puts their hand
        up — a nav item there sent people to read about hosting on a page that
        then had to send them somewhere else again.
      */}
      <SiteHeader />

      {/* Signed-in members only, and client-side — the page itself is cached
          for everyone (§12.3), so it cannot know a name. Renders nothing at
          all when logged out, which is why it can sit above the hero without
          moving it. */}
      <Greeting />

      {/* Hero — the «قول تشاو» device (§3.2) over the Tripoli sunset */}
      {/*
        The hero is sized, not left to its contents.

        It used to take whatever height the headline and the search pill
        happened to need — about 250px on a 390×844 phone, roughly 30% of the
        screen, on a page whose entire argument is the photograph. The brand
        guidelines ask for 60%, and this is a marketplace that sells the coast.

        `svh` rather than `vh` deliberately: `vh` on mobile Safari and Chrome
        means the viewport with the address bar *collapsed*, so a 60vh hero is
        taller than the visible area on first paint and pushes the search pill —
        the one thing a guest came here to use — below the fold until they
        scroll. `svh` is the smallest state, so the pill is reachable at rest.

        `justify-end` puts the type along the bottom edge, which is where the
        scrim work in `.type-on-photo` assumes it is, and leaves the top of the
        frame — where the sky and the horizon are — uncovered.
      */}
      <section className="card relative overflow-hidden text-white min-h-[60svh] flex flex-col justify-end">
        {/*
          The rotation, and it stays the rotation.

          A featured venue was tried here and reverted on founder direction. Two
          reasons, both good: the imagery is an operator decision made in the
          console (`home.hero`), and putting one property on the front page
          makes the marketplace an advertisement for whichever listing happened
          to sort first. The photographs are of Libya, not of a supplier.
        */}
        <HeroRotator images={hero.images} intervalMs={hero.intervalMs} />
        {/*
          No scrim. Founder direction, August 2026: the photograph shows
          through exactly as it was taken.

          Nothing was simply deleted — the legibility the wash was buying had
          to go somewhere, so it moved into the letters. `.type-on-photo` now
          carries a heavier halo (see globals.css), which darkens the few
          pixels around each glyph instead of the whole picture. Measured
          against the brightest frame of the rotation with
          `tools/photo-contrast.mjs`, which is the check to re-run before
          anyone adds a fourth hero photograph: a white sky is the frame that
          breaks this, not a sunset.
        */}
        <div className="relative p-6 sm:p-10 pb-4 sm:pb-6" data-on-photo>
          <h1 className="font-baloo font-extrabold text-3xl sm:text-4xl leading-tight type-on-photo">
            {c.heroLead} <span className="brand-on-photo">{c.heroBrand}</span> {c.heroTail}
          </h1>
          <p className="mt-3 text-white text-lg max-w-xl type-on-photo">{c.heroBody}</p>
        </div>
        {/* On the photo: contrast here comes from `.hero-pill` / `.tab-on-photo`,
            which are deliberately fixed rather than themed. */}
        <div className="relative px-3 sm:px-10 pb-4 sm:pb-8" data-on-photo>
          <HeroSearch />
        </div>
      </section>

      {/*
        No category tiles here. They were built from the frames and removed on
        founder direction: the hero's own vertical tabs already choose between
        chalets, halls and services, so a second row of three doing the same
        thing is a decision the guest has already made, asked again with
        photographs.
      */}

      {/* Trust strip (§11.2 — the badge defines the category) */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 text-center">
        {c.trust.map(([title, body]) => (
          <div key={title} className="card p-4">
            <h3 className="font-bold text-sea">{title}</h3>
            <p className="text-sm text-muted mt-1">{body}</p>
          </div>
        ))}
      </section>

      {/*
        The promise, stated once — and now written in Ciao Business rather than
        deployed. It sits after the trust strip because the trust strip is the
        argument and this is the conclusion, and before the inventory, because a
        reason to care has to arrive before the thing to care about.

        The copy that used to be hardcoded here still exists: it is the standing
        message the API falls back to when nothing is scheduled, so no content
        calendar can leave the page with a hole in it.
      */}
      {brand ? (
        <BrandSlot
          message={brand}
          messageId={brand.id}
          standing={brand.standing}
          surface="home"
        />
      ) : null}

      <RecsStrip />

      <Section title={c.coast} href="/search?type=coast" items={coast} seeAll={c.seeAll} />
      <Section title={c.halls} href="/search?type=hall" items={halls} seeAll={c.seeAll} />

      <ServiceTiles />

      {/*
        The invitation to bring supply, placed last on purpose: an owner is
        most likely to recognise that her own place belongs here directly
        after scrolling past everyone else's.
      */}
      <PartnerInvite surface="home" />

      </main>
      {/*
        Outside the container, so the band reaches both edges of the viewport.
        A footer that stops at the content width is a rectangle floating in the
        middle of a wide screen rather than the end of a page.
      */}
      <SiteFooter />
    </>
  );
}

function Section({
  title,
  href,
  items,
  seeAll,
}: {
  title: string;
  href: string;
  items: PublicListing[];
  seeAll: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-xl text-sea">{title}</h2>
        <Link href={href} className="text-link font-bold text-sm">
          {seeAll}
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((l) => (
          <ListingCard key={l.id} l={l} />
        ))}
      </div>
    </section>
  );
}
