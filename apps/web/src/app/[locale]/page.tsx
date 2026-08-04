import { Link } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { ListingCard } from "@/components/listing-card";
import { HeroSearch } from "@/components/hero-search";
import { HeroRotator, type HeroImage } from "@/components/hero-rotator";
import { Greeting } from "@/components/greeting";
import { RecsStrip } from "@/components/recs";
import { ServiceTiles } from "@/components/service-tiles";
import { BrandStatement } from "@/components/brand";
import { SupplyBand } from "@/components/supply-band";
import { LanguageToggle } from "@/components/language-toggle";
import { API_URL } from "@/lib/api";
import { asLocale, type Locale } from "@/lib/i18n";
import type { PublicListing } from "@/lib/types";

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
 * The English is written, not translated. «قول تشاو للحجز بالمكالمات» is a pun
 * — "say ciao to booking by phone call", where ciao is both the brand and the
 * goodbye — and it happens to work in English, so it stays. Elsewhere the
 * English says what the Arabic means rather than what it literally says.
 */
const copy = {
  ar: {
    wishlist: "المفضلة",
    about: "من نحن",
    hosts: "للمضيفين",
    account: "حسابي",
    heroEyebrow: "الحجز صار أقرب مما تتخيل",
    heroLead: "قول",
    heroBrand: "تشاو",
    heroTail: "للحجز بالمكالمات",
    /*
     * The emotional register. Everything else on this page argues that Ciao
     * works; this argues that it matters. Both are needed and neither
     * substitutes for the other — a marketplace that only ever talks about
     * deposits and verification reads like a utility company.
     */
    statementEyebrow: "لكل مناسبة، مكانها",
    statementHead: "المكان الجميل يخلّي الذكرى",
    statementAccent: "أجمل",
    statementBody:
      "من أول جلسة عائلية إلى ليلة العمر، نقرّبك من أماكن يحبها أهل ليبيا ويثقون فيها.",
    supplyEyebrow: "عندك مكان يستاهل الناس تعرفه؟",
    supplyHead: "خلّ مكانك جزءًا من حكاياتهم",
    supplyCta: "اعرض مكانك",
    heroBody:
      "الشاليهات والاستراحات وقاعات الأفراح — موثّقة ميدانيًا، صورناها بأنفسنا، والمولّد مجرَّب. احجز بعربون بسيط والباقي نقدًا عند الوصول.",
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
    footerAbout: "من نحن وكيف نعتمد الأماكن",
    footerRewards: "نقاط المكافآت",
    footerPlace: "تشاو — ciao.ly · طرابلس، ليبيا",
    footerPrices: "الأسعار كلها بالدينار الليبي. العربون فقط أونلاين والباقي عند الوصول.",
  },
  en: {
    wishlist: "Saved",
    about: "About",
    hosts: "For hosts",
    account: "Account",
    heroEyebrow: "Booking just got closer than you think",
    heroLead: "Say",
    heroBrand: "ciao",
    heroTail: "to booking by phone call",
    /*
     * Written, not translated. «المكان الجميل يخلّي الذكرى أجمل» is literally
     * "a beautiful place makes the memory more beautiful", which in English
     * lands as a greetings card. The claim underneath it — that the venue is
     * part of what people remember — is the part worth keeping.
     */
    statementEyebrow: "Every occasion has its place",
    statementHead: "The right place is half the",
    statementAccent: "memory",
    statementBody:
      "From a first family afternoon to the night of a lifetime, we bring you closer to the places Libyans love and trust.",
    supplyEyebrow: "Got a place people should know about?",
    supplyHead: "Make it part of their story",
    supplyCta: "List your place",
    heroBody:
      "Beach chalets, estirahas and wedding halls — visited and verified in person, photographed by us, generator tested. Book with a small deposit and pay the rest in cash on arrival.",
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
    footerAbout: "Who we are and how we verify places",
    footerRewards: "Reward points",
    footerPlace: "Ciao — ciao.ly · Tripoli, Libya",
    footerPrices:
      "All prices are in Libyan dinars. Only the deposit is paid online; the rest is paid on arrival.",
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
  const [coast, halls, hero] = await Promise.all([
    getFeatured("coast"),
    getFeatured("hall"),
    getHero(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Logo />
        <nav className="flex items-center gap-3 text-sm font-bold text-sea">
          <Link href="/wishlist" aria-label={c.wishlist}>🤍</Link>
          <Link href="/about">{c.about}</Link>
          <Link href="/hosts">{c.hosts}</Link>
          <Link href="/account">{c.account}</Link>
          <LanguageToggle />
        </nav>
      </header>

      {/* Signed-in members only, and client-side — the page itself is cached
          for everyone (§12.3), so it cannot know a name. Renders nothing at
          all when logged out, which is why it can sit above the hero without
          moving it. */}
      <Greeting />

      {/* Hero — the «قول تشاو» device (§3.2) over the Tripoli sunset */}
      <section className="card relative overflow-hidden text-white">
        <HeroRotator images={hero.images} intervalMs={hero.intervalMs} />
        {/* Sea-blue gradient keeps text sunlight-readable (§3.3). Kept as
            light as legibility allows so the photography stays the hero. */}
        <div
          className="absolute inset-0 photo-scrim-soft"
          aria-hidden
        />
        <div className="relative p-6 sm:p-10 pb-4 sm:pb-6" data-on-photo>
          {/* Amber on a photograph, so it carries the fixed colour the rest of
              the photo chrome uses rather than the themed `link` token. */}
          <p className="flex items-center gap-3 text-sm font-extrabold text-[#F0B458] drop-shadow mb-2">
            <span>{c.heroEyebrow}</span>
            <span className="hidden sm:block h-px w-16 bg-current opacity-60" aria-hidden />
          </p>
          <h1 className="font-baloo font-extrabold text-3xl sm:text-4xl leading-tight drop-shadow">
            {c.heroLead} <span className="text-amber">{c.heroBrand}</span> {c.heroTail}
          </h1>
          <p className="mt-3 text-white/95 text-lg max-w-xl drop-shadow">{c.heroBody}</p>
        </div>
        {/* On the photo: contrast here comes from `.hero-pill` / `.tab-on-photo`,
            which are deliberately fixed rather than themed. */}
        <div className="relative px-3 sm:px-10 pb-4 sm:pb-8" data-on-photo>
          <HeroSearch />
        </div>
      </section>

      {/* Trust strip (§11.2 — the badge defines the category) */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 text-center">
        {c.trust.map(([title, body]) => (
          <div key={title} className="card p-4">
            <h3 className="font-bold text-sea">{title}</h3>
            <p className="text-sm text-muted mt-1">{body}</p>
          </div>
        ))}
      </section>

      {/* The claim that this is about occasions rather than inventory. It sits
          after the trust strip on purpose: earn the right to be sentimental by
          first saying something checkable. */}
      <BrandStatement
        eyebrow={c.statementEyebrow}
        headline={c.statementHead}
        accent={c.statementAccent}
        body={c.statementBody}
      />

      <RecsStrip />

      <Section title={c.coast} href="/search?type=coast" items={coast} seeAll={c.seeAll} />
      <Section title={c.halls} href="/search?type=hall" items={halls} seeAll={c.seeAll} />

      <ServiceTiles />

      {/* Addressed to a different reader than everything above it, which is why
          it changes ground rather than merely changing words. Below the
          listings because a guest came here to find a chalet, and a host who
          owns one will scroll past their competitors to reach it. */}
      <SupplyBand
        surface="home"
        eyebrow={c.supplyEyebrow}
        headline={c.supplyHead}
        cta={c.supplyCta}
        href="/hosts"
      />

      <footer className="mt-12 text-center text-sm text-faint space-y-1">
        <p>
          <Link href="/about" className="font-bold text-sea/80 hover:text-sea">
            {c.footerAbout}
          </Link>
          {" · "}
          <Link href="/rewards" className="font-bold text-sea/80 hover:text-sea">
            {c.footerRewards}
          </Link>
        </p>
        <p>{c.footerPlace}</p>
        <p>{c.footerPrices}</p>
      </footer>
    </main>
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
