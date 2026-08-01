"use client";
/**
 * Split-screen results (Airbnb pattern): scrollable list beside a map that
 * never goes away. Clicking a pin selects the listing — the card scrolls into
 * view and highlights, and a preview card appears over the map — so the map
 * stays put and stops being a dead-end detour.
 * Mobile: one column with a floating list⇄map switch (no room for both).
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocale } from "@/lib/locale";
import { ListingCard } from "@/components/listing-card";
import { MapView } from "@/components/map-view";
import { Heart } from "@/components/heart";
import { fmtLyd } from "@/lib/api";
import { listingTitle, textProps } from "@/lib/content";
import type { Locale } from "@/lib/i18n";
import type { PublicListing } from "@/lib/types";

const copy = {
  ar: {
    empty: "لا نتائج بهذه الفلاتر — جرّب توسيع البحث.",
    approx: "📍 المواقع تقريبية (~500م) — العنوان الدقيق بعد العربون",
    list: "☰ القائمة",
    map: "🗺 الخريطة",
    perNight: (price: string) => `${price} / ليلة`,
    onRequest: "حسب الطلب",
    close: "إغلاق",
  },
  en: {
    empty: "No results with these filters — try widening the search.",
    approx: "📍 Locations are approximate (~500m) — the exact address follows the deposit",
    list: "☰ List",
    map: "🗺 Map",
    perNight: (price: string) => `${price} / night`,
    onRequest: "On request",
    close: "Close",
  },
} satisfies Record<Locale, unknown>;

export function SearchResults({
  items,
  vertical,
}: {
  items: PublicListing[];
  vertical: string;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMapMobile, setShowMapMobile] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const hasCoords = items.some((i) => i.approxLocation?.lat);
  const selected = items.find((i) => i.id === selectedId) ?? null;

  // Map click → bring the card to the guest rather than making them hunt.
  useEffect(() => {
    if (!selectedId) return;
    const el = document.getElementById(`card-${selectedId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedId]);

  if (items.length === 0) {
    return <div className="card p-8 text-center text-muted">{c.empty}</div>;
  }

  return (
    <>
      <div className={`lg:grid lg:grid-cols-2 lg:gap-4 ${showMapMobile ? "hidden lg:grid" : ""}`}>
        {/* results list */}
        <div ref={listRef} className="lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto lg:pe-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4 pb-4">
            {items.map((l) => (
              <div
                key={l.id}
                id={`card-${l.id}`}
                onMouseEnter={() => hasCoords && setSelectedId(l.id)}
                className={`rounded-bubble transition-shadow ${
                  selectedId === l.id ? "ring-2 ring-sea shadow-lg" : ""
                }`}
              >
                <ListingCard l={l} />
              </div>
            ))}
          </div>
        </div>

        {/* map — sticky, always present on desktop */}
        {hasCoords ? (
          <div className="hidden lg:block relative">
            <div className="sticky top-4">
              <MapView
                items={items}
                vertical={vertical}
                selectedId={selectedId}
                onSelect={setSelectedId}
                className="rounded-bubble overflow-hidden shadow-sm h-[calc(100dvh-9rem)]"
              />
              {selected ? (
                <PreviewCard listing={selected} onClose={() => setSelectedId(null)} />
              ) : (
                <p className="absolute bottom-3 inset-x-0 text-center pointer-events-none">
                  {/* Sits on the map tiles, which are light in both themes. */}
                  <span className="chip-on-photo !text-[11px]">{c.approx}</span>
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* mobile map view */}
      {hasCoords && showMapMobile ? (
        <div className="lg:hidden relative">
          <MapView
            items={items}
            vertical={vertical}
            selectedId={selectedId}
            onSelect={setSelectedId}
            className="rounded-bubble overflow-hidden h-[calc(100dvh-12rem)]"
          />
          {selected ? (
            <PreviewCard listing={selected} onClose={() => setSelectedId(null)} />
          ) : null}
        </div>
      ) : null}

      {/* mobile switch */}
      {hasCoords ? (
        <button
          onClick={() => setShowMapMobile((v) => !v)}
          className="lg:hidden fixed bottom-5 inset-x-0 mx-auto w-fit z-30 bg-sea text-white font-bold rounded-full px-5 py-2.5 shadow-lg text-sm"
        >
          {showMapMobile ? c.list : c.map}
        </button>
      ) : null}
    </>
  );
}

function PreviewCard({
  listing,
  onClose,
}: {
  listing: PublicListing;
  onClose: () => void;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const cover = listing.media.find((m) => m.kind === "photo");
  const title = listingTitle(locale, listing);
  return (
    <div className="absolute bottom-3 inset-x-3 bg-surface rounded-bubble shadow-xl overflow-hidden flex z-[500]">
      <Link href={`/l/${listing.slug}`} className="flex flex-1 min-w-0">
        <div className="w-28 h-28 shrink-0 bg-sea/10 relative">
          {cover ? (
            <img
              src={cover.url}
              alt={title.text}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="p-3 min-w-0 flex-1">
          <p className="font-bold text-sm leading-snug line-clamp-2" {...textProps(title)}>
            {title.text}
          </p>
          {listing.rating ? (
            <p className="text-xs text-link font-bold mt-0.5" dir="ltr">
              ★ {listing.rating.toFixed(1)}
              {listing.reviewCount ? ` (${listing.reviewCount})` : ""}
            </p>
          ) : null}
          <p className="text-sm font-bold text-sea mt-1">
            {listing.baseNightly > 0
              ? c.perNight(fmtLyd(listing.baseNightly, locale))
              : c.onRequest}
          </p>
        </div>
      </Link>
      <div className="flex flex-col items-center justify-between p-2">
        <button
          onClick={onClose}
          aria-label={c.close}
          className="w-7 h-7 rounded-full bg-sand text-sea text-xs font-bold"
        >
          ✕
        </button>
        <Heart listingId={listing.id} size={28} />
      </div>
    </div>
  );
}
