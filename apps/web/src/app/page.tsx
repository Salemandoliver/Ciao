import Link from "next/link";
import { LogoWithTail } from "@/components/logo";
import { ListingCard } from "@/components/listing-card";
import { HeroSearch } from "@/components/hero-search";
import { HeroRotator, type HeroImage } from "@/components/hero-rotator";
import { RecsStrip } from "@/components/recs";
import { ServiceTiles } from "@/components/service-tiles";
import { API_URL } from "@/lib/api";
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

export default async function HomePage() {
  const [coast, halls, hero] = await Promise.all([
    getFeatured("coast"),
    getFeatured("hall"),
    getHero(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <LogoWithTail size={44} />
        <nav className="flex items-center gap-3 text-sm font-bold text-sea">
          <Link href="/wishlist" aria-label="المفضلة">🤍</Link>
          <Link href="/about">من نحن</Link>
          <Link href="/host">للمضيفين</Link>
          <Link href="/login">دخول</Link>
        </nav>
      </header>

      {/* Hero — the «قول تشاو» device (§3.2) over the Tripoli sunset */}
      <section className="card relative overflow-hidden text-white">
        <HeroRotator images={hero.images} intervalMs={hero.intervalMs} />
        {/* Sea-blue gradient keeps text sunlight-readable (§3.3). Kept as
            light as legibility allows so the photography stays the hero. */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-sea/80 via-sea/35 to-sea/15"
          aria-hidden
        />
        <div className="relative p-6 sm:p-10 pb-4 sm:pb-6">
          <h1 className="font-baloo font-extrabold text-3xl sm:text-4xl leading-tight drop-shadow">
            قول <span className="text-amber">تشاو</span> للحجز بالمكالمات
          </h1>
          <p className="mt-3 text-white/95 text-lg max-w-xl drop-shadow">
            الشاليهات والاستراحات وقاعات الأفراح — موثّقة ميدانيًا، صورناها بأنفسنا،
            والمولّد مجرَّب. احجز بعربون بسيط والباقي نقدًا عند الوصول.
          </p>
        </div>
        <div className="relative px-3 sm:px-10 pb-4 sm:pb-8">
          <HeroSearch />
        </div>
      </section>

      {/* Trust strip (§11.2 — the badge defines the category) */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 text-center">
        {[
          ["✓ نعتمدها بأنفسنا", "فريق تشاو يزور كل مكان شخصيًا ويفحصه ويعتمده قبل النشر — ما تشوفه هو الموجود"],
          ["💰 عربون يحمي الطرفين", "٢٠٪ فقط لقفل التاريخ — والمضيف يعرف أنك جاد"],
          ["📵 يشتغل وقت انقطاع الكهرباء", "قسيمتك والعنوان محفوظان بدون إنترنت، والتأكيدات تصلك واتساب و SMS"],
        ].map(([title, body]) => (
          <div key={title} className="card p-4">
            <h3 className="font-bold text-sea">{title}</h3>
            <p className="text-sm text-sea/70 mt-1">{body}</p>
          </div>
        ))}
      </section>

      <RecsStrip />

      <Section title="شاليهات واستراحات" href="/search?type=coast" items={coast} />
      <Section title="قاعات الأفراح" href="/search?type=hall" items={halls} />

      <ServiceTiles />

      <footer className="mt-12 text-center text-sm text-sea/60 space-y-1">
        <p>
          <Link href="/about" className="font-bold text-sea/80 hover:text-sea">
            من نحن وكيف نعتمد الأماكن
          </Link>
        </p>
        <p>تشاو — ciao.ly · طرابلس، ليبيا</p>
        <p>الأسعار كلها بالدينار الليبي. العربون فقط أونلاين والباقي عند الوصول.</p>
      </footer>
    </main>
  );
}

function Section({
  title,
  href,
  items,
}: {
  title: string;
  href: string;
  items: PublicListing[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-xl text-sea">{title}</h2>
        <Link href={href} className="text-amber-dark font-bold text-sm">
          عرض الكل ←
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
