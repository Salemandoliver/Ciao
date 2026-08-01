"use client";
/**
 * Airbnb-style services strip — emoji tiles per category.
 *
 * A client component only so it can read the locale from context: the home
 * page renders it without props, and a tile row of six links is not worth
 * threading `locale` through a prop nobody else needs. There is no state and
 * no effect here; the markup is the same on the server and the client.
 */
import { Link, useLocale } from "@/lib/locale";
import { serviceCategories } from "@/lib/services";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: { heading: "خدمات المناسبات 🛎", seeAll: "عرض الكل ←" },
  en: { heading: "Event services 🛎", seeAll: "See all →" },
} satisfies Record<Locale, unknown>;

export function ServiceTiles() {
  const locale = useLocale();
  const c = copy[locale];
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-xl text-sea">{c.heading}</h2>
        <Link href="/search?type=service" className="text-link font-bold text-sm">
          {c.seeAll}
        </Link>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {serviceCategories(locale).map(([key, emoji, label]) => (
          <Link
            key={key}
            href={`/search?type=service&serviceCategory=${key}`}
            className="card p-3 text-center hover:shadow-md transition-shadow"
          >
            <span className="block text-3xl" aria-hidden>{emoji}</span>
            <span className="block text-xs font-bold text-sea mt-1.5">{label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
