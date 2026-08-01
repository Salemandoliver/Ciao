import Link from "next/link";
import { Logo } from "@/components/logo";
import { HeroSearch } from "@/components/hero-search";
import { TrackEvent } from "@/components/track";
import { SearchResults } from "./results";
import { API_URL } from "@/lib/api";
import { SERVICE_CATEGORIES } from "@/lib/services";
import type { PublicListing } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Search with the cultural filters that ARE the product (§8.4). */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const type = params.type === "hall" ? "hall" : params.type === "service" ? "service" : "coast";
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
    if (params[key]) qs.set(key, params[key]!);
  }

  let items: PublicListing[] = [];
  try {
    const res = await fetch(`${API_URL}/v1/listings?${qs}`, { cache: "no-store" });
    if (res.ok) items = ((await res.json()) as { items: PublicListing[] }).items;
  } catch {
    /* offline → SW serves cached page */
  }

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
          <Logo size={36} />
        </Link>
        <h1 className="font-bold text-sea">
          {type === "coast" ? "شاليهات واستراحات" : type === "service" ? "خدمات المناسبات" : "قاعات الأفراح"}
        </h1>
      </header>

      <TrackEvent
        name="search.performed"
        props={{
          vertical: type,
          city: params.city,
          area: params.area,
          checkIn: params.checkIn,
          checkOut: params.checkOut,
          guests: params.maxGuests ? Number(params.maxGuests) : undefined,
          filters: ["minPrivacy", "generator", "familyOnly", "minBedrooms", "womensCapacity"].filter((k) => params[k]),
          resultCount: items.length,
        }}
      />
      <div className="mb-4">
        <HeroSearch
          compact
          initial={{
            type,
            city: params.city,
            area: params.area,
            checkIn: params.checkIn,
            checkOut: params.checkOut,
            guests: params.maxGuests ?? params.womensCapacity,
            serviceCategory: params.serviceCategory,
          }}
        />
      </div>

      {/* Cultural filters (§8.4): satar, generator, family-only, women's capacity */}
      <div className="flex flex-wrap gap-2 mb-4">
        {type === "coast" ? (
          <>
            <Link
              href={filterLink({ minPrivacy: params.minPrivacy ? null : "80" })}
              className={`chip ${params.minPrivacy ? "!bg-sea !text-white" : ""}`}
            >
              🔒 ستر عالي
            </Link>
            <Link
              href={filterLink({ generator: params.generator ? null : "true" })}
              className={`chip ${params.generator ? "!bg-sea !text-white" : ""}`}
            >
              ⚡ مولّد
            </Link>
            <Link
              href={filterLink({ familyOnly: params.familyOnly ? null : "true" })}
              className={`chip ${params.familyOnly ? "!bg-sea !text-white" : ""}`}
            >
              👨‍👩‍👧 عائلات فقط
            </Link>
            <Link
              href={filterLink({ minBedrooms: params.minBedrooms ? null : "3" })}
              className={`chip ${params.minBedrooms ? "!bg-sea !text-white" : ""}`}
            >
              🛏 +3 غرف
            </Link>
          </>
        ) : type === "service" ? (
          <>
            {SERVICE_CATEGORIES.map(([key, emoji, label]) => (
              <Link
                key={key}
                href={filterLink({ serviceCategory: params.serviceCategory === key ? null : key })}
                className={`chip ${params.serviceCategory === key ? "!bg-sea !text-white" : ""}`}
              >
                {emoji} {label}
              </Link>
            ))}
          </>
        ) : (
          <>
            <Link
              href={filterLink({ womensCapacity: params.womensCapacity ? null : "400" })}
              className={`chip ${params.womensCapacity ? "!bg-sea !text-white" : ""}`}
            >
              👥 +400 ضيفة
            </Link>
            <Link
              href={filterLink({ generator: params.generator ? null : "true" })}
              className={`chip ${params.generator ? "!bg-sea !text-white" : ""}`}
            >
              ⚡ مولّد احتياطي
            </Link>
          </>
        )}
      </div>

      <SearchResults items={items} vertical={type} />
    </main>
  );
}
