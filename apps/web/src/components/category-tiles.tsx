"use client";
/**
 * «استكشف حسب الفئة» — the three photographs directly under the hero.
 *
 * This is the design's first move after the hero and the app did not have it:
 * three ways into the catalogue, each carrying a picture rather than a word.
 * The app's own taxonomy, not the mockup's — the frames label the tiles
 * Chalets / Estirahas / Halls, but `coast` is one vertical here covering both
 * chalets and estirahas, and inventing a split the search endpoint cannot
 * filter on would produce a tile that returns the same results as its
 * neighbour. Three tiles, three real destinations.
 *
 * Photography rather than the emoji tiles further down the page. The emoji
 * strip is right for six service categories, which are abstractions; a chalet
 * on the coast is a place, and the picture is the whole argument (§3.2).
 */
import { Link, useLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: {
    heading: "استكشف حسب الفئة",
    seeAll: "عرض الكل ←",
    coast: "شاليهات واستراحات",
    halls: "قاعات أفراح",
    services: "خدمات",
  },
  en: {
    heading: "Explore by category",
    seeAll: "See all →",
    coast: "Chalets",
    halls: "Halls",
    services: "Services",
  },
} satisfies Record<Locale, unknown>;

/**
 * The photographs are the ones already in the build for the hero rotation, at
 * the 800px variant — a tile is never wider than a third of the viewport, so
 * the 1600 would be three times the bytes for pixels nobody sees on a
 * connection that cannot spare them (§12.3).
 */
const TILES = [
  { key: "coast", href: "/search?type=coast", src: "/hero-marina-800.webp" },
  { key: "halls", href: "/search?type=hall", src: "/hero-castle-800.webp" },
  { key: "services", href: "/search?type=service", src: "/hero-lake-800.webp" },
] as const;

export function CategoryTiles() {
  const locale = useLocale();
  const c = copy[locale];
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-xl text-sea">{c.heading}</h2>
        <Link href="/search" className="text-link font-bold text-sm">
          {c.seeAll}
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {TILES.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className="relative block overflow-hidden rounded-bubble aspect-square sm:aspect-[4/3] group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
          >
            <img
              src={t.src}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            {/*
              A scrim only where the word is. The label sits along the bottom
              edge, so the gradient covers the bottom third and leaves the rest
              of the photograph alone — the same argument as `.photo-scrim-bottom`
              on the venue storefront, applied at tile scale.
            */}
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-1/2"
              style={{
                backgroundImage:
                  "linear-gradient(to top, rgb(13 27 42 / .78) 0%, rgb(13 27 42 / .35) 55%, transparent 100%)",
              }}
            />
            {/* `start` rather than `left`: the label follows the reading edge. */}
            <span className="absolute bottom-2 start-2.5 end-2.5 text-white font-bold text-sm leading-tight type-on-photo">
              {c[t.key]}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
