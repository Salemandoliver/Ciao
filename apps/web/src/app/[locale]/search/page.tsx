import { Link } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { HeroSearch } from "@/components/hero-search";
import { TrackEvent } from "@/components/track";
import { BrandSlot } from "@/components/brand-slot";
import { SearchResults } from "./results";
// From `map-geo`, not `map-view`: this is a server component, and everything a
// "use client" module exports crosses the boundary as a client reference —
// including a plain settings object, which would arrive here as a proxy.
import { DEFAULT_MAPS, type MapProvider, type MapsSettings } from "@/components/map-geo";
import { API_URL } from "@/lib/api";
import { serviceCategories } from "@/lib/services";
import { VERTICALS, term } from "@/lib/vocab";
import { asLocale, type Locale } from "@/lib/i18n";
import type { PublicListing } from "@/lib/types";
import type { RenderedBrandMessage } from "@ciao/shared";

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

/**
 * The brand message for this search — the only page that can honour targeting.
 *
 * The home page is a static shell served from a CDN and knows nothing about
 * who is reading it, so a message aimed at Tripoli or at wedding halls can
 * never fire there. Here both facts are in the URL the guest typed, so a
 * «عيد مبارك في طرابلس» campaign reaches the people it was written for.
 *
 * Uncached, because this page already is (`dynamic = "force-dynamic"`): the
 * filters are the product and a stale result set is a worse failure than a
 * fresh request. A miss renders nothing rather than something wrong.
 */
type BrandPayload = RenderedBrandMessage & { id: string; standing: boolean };

async function getBrandMessage(
  locale: Locale,
  vertical: string,
  city: string | undefined,
): Promise<BrandPayload | null> {
  const q = new URLSearchParams({ locale, vertical });
  if (city) q.set("city", city);
  try {
    const res = await fetch(`${API_URL}/v1/brand-message?${q}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return (await res.json()) as BrandPayload;
  } catch {
    return null;
  }
}

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
  const brand = await getBrandMessage(locale, type, sp.city);

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

      {/*
        Below the search bar rather than above it. Somebody who has already
        typed a city and a date came here to see results, and a greeting that
        pushes the first chalet below the fold is an advertisement wearing a
        brand message's clothes. The standing copy is suppressed for the same
        reason: on the home page it is the argument for the product, and on a
        results page it is a paragraph between a guest and what they asked for.
      */}
      {brand && !brand.standing ? (
        <BrandSlot
          message={brand}
          messageId={brand.id}
          standing={brand.standing}
          surface="search"
        />
      ) : null}

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
 * still opens: the default provider, centred on Tripoli.
 *
 * The provider is checked against the list rather than trusted, because this is
 * a value off the wire being handed to a component that picks a code path with
 * it. An unrecognised one — a rolled-back API, a typed row in the settings
 * table — means the default, not a blank map.
 */
const PROVIDERS: readonly MapProvider[] = ["osm", "google", "mapbox"];

async function getMapsSettings(): Promise<MapsSettings> {
  try {
    const res = await fetch(`${API_URL}/v1/settings/public`, { next: { revalidate: 300 } });
    if (!res.ok) return DEFAULT_MAPS;
    const body = (await res.json()) as { maps?: Partial<MapsSettings> };
    const provider = body.maps?.provider;
    return {
      provider:
        provider && PROVIDERS.includes(provider) ? provider : DEFAULT_MAPS.provider,
      defaultCentre: body.maps?.defaultCentre ?? DEFAULT_MAPS.defaultCentre,
      drawSearch: body.maps?.drawSearch !== false,
    };
  } catch {
    return DEFAULT_MAPS;
  }
}
