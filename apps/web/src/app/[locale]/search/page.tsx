import { Link } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { HeroSearch } from "@/components/hero-search";
import { TrackEvent } from "@/components/track";
import { SearchResults } from "./results";
// From `map-geo`, not `map-view`: this is a server component, and everything a
// "use client" module exports crosses the boundary as a client reference —
// including a plain settings object, which would arrive here as a proxy.
import { DEFAULT_MAPS, type MapsSettings } from "@/components/map-geo";
import { API_URL } from "@/lib/api";
import { serviceCategories } from "@/lib/services";
import { VERTICALS, term } from "@/lib/vocab";
import { asLocale, type Locale } from "@/lib/i18n";
import type { PublicListing } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The filter chips are the product (§8.4), so they are written, not translated.
 * «ستر» is about screening and privacy for the women in the party — what the
 * walls, the pool and the approach actually allow — so English says "privacy",
 * never anything about how anyone should behave.
 */
const copy = {
  ar: {
    highPrivacy: "🔒 ستر عالي",
    generator: "⚡ مولّد",
    generatorBackup: "⚡ مولّد احتياطي",
    familyOnly: "👨‍👩‍👧 عائلات فقط",
    bedrooms: "🛏 +3 غرف",
    womenGuests: "👥 +400 ضيفة",
  },
  en: {
    highPrivacy: "🔒 High privacy",
    generator: "⚡ Generator",
    generatorBackup: "⚡ Backup generator",
    familyOnly: "👨‍👩‍👧 Families only",
    bedrooms: "🛏 3+ bedrooms",
    womenGuests: "👥 400+ women guests",
  },
} satisfies Record<Locale, unknown>;

/** Search with the cultural filters that ARE the product (§8.4). */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const locale = asLocale((await params).locale);
  const c = copy[locale];
  const sp = await searchParams;
  const type = sp.type === "hall" ? "hall" : sp.type === "service" ? "service" : "coast";
  const qs = new URLSearchParams({ type, limit: "30" });
  for (const key of [
    "city",
    "area",
    "minPrivacy",
    "generator",
    "familyOnly",
    "minBedrooms",
    "womensCapacity",
    "maxGuests",
    "checkIn",
    "checkOut",
    "serviceCategory",
  ]) {
    if (sp[key]) qs.set(key, sp[key]!);
  }

  let items: PublicListing[] = [];
  try {
    const res = await fetch(`${API_URL}/v1/listings?${qs}`, { cache: "no-store" });
    if (res.ok) items = ((await res.json()) as { items: PublicListing[] }).items;
  } catch {
    /* offline → SW serves cached page */
  }

  const maps = await getMapsSettings();

  /*
   * The same filters, without the page's own limit, so that a drawn area
   * narrows the search the guest already has rather than starting a new one.
   * `type` is in there, which is what makes drawing work on services and halls
   * and not only on the coast.
   */
  const areaQuery = new URLSearchParams(qs);
  areaQuery.delete("limit");

  const filterLink = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(qs);
    next.delete("limit");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `/search?${next}`;
  };

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16">
      <header className="flex items-center gap-4 py-4">
        <Link href="/">
          <Logo />
        </Link>
        <h1 className="font-bold text-sea">{term(VERTICALS, locale, type)}</h1>
        <div className="ms-auto">
          <LanguageToggle />
        </div>
      </header>

      <TrackEvent
        name="search.performed"
        props={{
          vertical: type,
          city: sp.city,
          area: sp.area,
          checkIn: sp.checkIn,
          checkOut: sp.checkOut,
          guests: sp.maxGuests ? Number(sp.maxGuests) : undefined,
          filters: ["minPrivacy", "generator", "familyOnly", "minBedrooms", "womensCapacity"].filter((k) => sp[k]),
          resultCount: items.length,
        }}
      />
      <div className="mb-4">
        <HeroSearch
          compact
          initial={{
            type,
            city: sp.city,
            area: sp.area,
            checkIn: sp.checkIn,
            checkOut: sp.checkOut,
            guests: sp.maxGuests ?? sp.womensCapacity,
            serviceCategory: sp.serviceCategory,
          }}
        />
      </div>

      {/* Cultural filters (§8.4): satar, generator, family-only, women's capacity */}
      <div className="flex flex-wrap gap-2 mb-4">
        {type === "coast" ? (
          <>
            <Link
              href={filterLink({ minPrivacy: sp.minPrivacy ? null : "80" })}
              className={`chip ${sp.minPrivacy ? "!bg-sea !text-white" : ""}`}
            >
              {c.highPrivacy}
            </Link>
            <Link
              href={filterLink({ generator: sp.generator ? null : "true" })}
              className={`chip ${sp.generator ? "!bg-sea !text-white" : ""}`}
            >
              {c.generator}
            </Link>
            <Link
              href={filterLink({ familyOnly: sp.familyOnly ? null : "true" })}
              className={`chip ${sp.familyOnly ? "!bg-sea !text-white" : ""}`}
            >
              {c.familyOnly}
            </Link>
            <Link
              href={filterLink({ minBedrooms: sp.minBedrooms ? null : "3" })}
              className={`chip ${sp.minBedrooms ? "!bg-sea !text-white" : ""}`}
            >
              {c.bedrooms}
            </Link>
          </>
        ) : type === "service" ? (
          <>
            {serviceCategories(locale).map(([key, emoji, label]) => (
              <Link
                key={key}
                href={filterLink({ serviceCategory: sp.serviceCategory === key ? null : key })}
                className={`chip ${sp.serviceCategory === key ? "!bg-sea !text-white" : ""}`}
              >
                {emoji} {label}
              </Link>
            ))}
          </>
        ) : (
          <>
            <Link
              href={filterLink({ womensCapacity: sp.womensCapacity ? null : "400" })}
              className={`chip ${sp.womensCapacity ? "!bg-sea !text-white" : ""}`}
            >
              {c.womenGuests}
            </Link>
            <Link
              href={filterLink({ generator: sp.generator ? null : "true" })}
              className={`chip ${sp.generator ? "!bg-sea !text-white" : ""}`}
            >
              {c.generatorBackup}
            </Link>
          </>
        )}
      </div>

      <SearchResults
        items={items}
        vertical={type}
        maps={maps}
        query={areaQuery.toString()}
      />
    </main>
  );
}

/**
 * Which map to draw, and whether the guest may draw on it.
 *
 * An operator decision (business console → الإعدادات), fetched with the page
 * rather than from the browser so the map does not wait on a second round trip
 * over a Libyan 3G connection. If the control plane is unreachable the map
 * still opens: OpenStreetMap, centred on Tripoli.
 */
async function getMapsSettings(): Promise<MapsSettings> {
  try {
    const res = await fetch(`${API_URL}/v1/settings/public`, { next: { revalidate: 300 } });
    if (!res.ok) return DEFAULT_MAPS;
    const body = (await res.json()) as { maps?: Partial<MapsSettings> };
    return {
      provider: body.maps?.provider === "google" ? "google" : "osm",
      defaultCentre: body.maps?.defaultCentre ?? DEFAULT_MAPS.defaultCentre,
      drawSearch: body.maps?.drawSearch !== false,
    };
  } catch {
    return DEFAULT_MAPS;
  }
}
