import Link from "next/link";
import { LogoWithTail } from "@/components/logo";
import { ListingCard } from "@/components/listing-card";
import { HeroSearch } from "@/components/hero-search";
import { API_URL } from "@/lib/api";
import type { PublicListing } from "@/lib/types";

const HERO_LQIP =
  "data:image/webp;base64,UklGRl4AAABXRUJQVlA4IFIAAADwAwCdASoYAA4APu1iqU2ppaQiMAgBMB2JaACdMoRwIswAYJ/CjQnsAIHnzDPwqJPtzcUwUqPA5NluP4X5PnLdcbYjdrhJbqaf/J3/38gPgAAA";

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
  const [coast, halls] = await Promise.all([getFeatured("coast"), getFeatured("hall")]);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <LogoWithTail size={44} />
        <nav className="flex gap-3 text-sm font-bold text-sea">
          <Link href="/host">للمضيفين</Link>
          <Link href="/login">دخول</Link>
        </nav>
      </header>

      {/* Hero — the «قول تشاو» device (§3.2) over the Tripoli sunset */}
      <section className="card relative overflow-hidden text-white">
        <img
          src="/hero-800.webp"
          srcSet="/hero-800.webp 800w, /hero-1600.webp 1600w"
          sizes="(max-width: 640px) 100vw, 1024px"
          alt="غروب الشمس على مدينة ليبية"
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            backgroundImage: `url(${HERO_LQIP})`,
            backgroundSize: "cover",
          }}
        />
        {/* Sea-blue gradient keeps text sunlight-readable (§3.3) */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-sea/90 via-sea/45 to-sea/25"
          aria-hidden
        />
        <div className="relative p-6 sm:p-10 pb-4 sm:pb-6">
          <h1 className="font-baloo font-extrabold text-3xl sm:text-4xl leading-tight drop-shadow">
            قول <span className="text-amber">تشاو</span> للحجز بالمكالمات
          </h1>
          <p className="mt-3 text-white/95 text-lg max-w-xl drop-shadow">
            شاليهات الساحل وقاعات الأفراح — موثّقة ميدانيًا، صورناها بأنفسنا،
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
          ["✓ موثّق ميدانيًا", "وكيلنا زار المكان، شغّل المولّد، وصوّر كل شيء بنفسه"],
          ["💰 عربون يحمي الطرفين", "٢٠٪ فقط لقفل التاريخ — والمضيف يعرف أنك جاد"],
          ["📵 يشتغل وقت انقطاع الكهرباء", "قسيمتك والعنوان محفوظان بدون إنترنت، والتأكيدات تصلك واتساب و SMS"],
        ].map(([title, body]) => (
          <div key={title} className="card p-4">
            <h3 className="font-bold text-sea">{title}</h3>
            <p className="text-sm text-sea/70 mt-1">{body}</p>
          </div>
        ))}
      </section>

      <Section title="شاليهات واستراحات الساحل" href="/search?type=coast" items={coast} />
      <Section title="قاعات الأفراح" href="/search?type=hall" items={halls} />

      <footer className="mt-12 text-center text-sm text-sea/60 space-y-1">
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
