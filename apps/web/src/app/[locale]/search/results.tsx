"use client";
/**
 * Split-screen results (Airbnb pattern): scrollable list beside a map that
 * never goes away. Clicking a pin selects the listing — the card scrolls into
 * view and highlights, and a preview card appears over the map — so the map
 * stays put and stops being a dead-end detour.
 * Mobile: one column with a floating list⇄map switch (no room for both).
 *
 * ## Drawing an area
 *
 * Salem's case is the one that makes it worth building: "a makeup artist in
 * the southern part of Tripoli, near my parents' house". No dropdown of cities
 * and districts answers that, because the boundary that matters is the one in
 * his head. So the guest draws it, and the shape goes to the same
 * `/v1/listings` as every other filter — which means it works on services and
 * halls exactly as it works on the coast.
 *
 * Two things this screen has to be honest about, because both look like bugs
 * otherwise:
 *
 *  - An empty area is empty, and if the shape is tiny that is almost certainly
 *    why. Saying so beats a blank map.
 *  - Most venues in the catalogue have no coordinates recorded yet, and a
 *    drawn area cannot match a venue that has no point. If we quietly dropped
 *    them, an empty result would read as "there is nothing there" when what it
 *    means is "we have not walked to those gates yet". So we count them and
 *    say so.
 *
 * The shape itself never leaves this component except as a `poly=` query. Not
 * in the URL, not in an event, not in a log: a tight enough polygon around a
 * house is a home address (see the API's geo.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocale } from "@/lib/locale";
import { ListingCard } from "@/components/listing-card";
import {
  MapView,
  TINY_AREA_KM2,
  encodePolygon,
  polygonAreaKm2,
  polygonCentre,
  round3,
  type MapLatLng,
  type MapsSettings,
} from "@/components/map-view";
import { Heart } from "@/components/heart";
import { API_URL, apiAcceptLanguage, fmtLyd } from "@/lib/api";
import { listingTitle, textProps } from "@/lib/content";
import { trackClient } from "@/lib/tracker";
import { fmtNum } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import type { PublicListing } from "@/lib/types";
import { thumb } from "@/lib/types";

const copy = {
  ar: {
    empty: "لا نتائج بهذه الفلاتر — جرّب توسيع البحث.",
    found: (n: string) => `${n} مكان مميز`,
    approx: "📍 المواقع تقريبية (~500م) — العنوان الدقيق بعد العربون",
    list: "☰ القائمة",
    map: "🗺 الخريطة",
    perNight: (price: string) => `${price} / ليلة`,
    onRequest: "حسب الطلب",
    close: "إغلاق",
    draw: "✏️ ارسم منطقة",
    drawHint: "ارسم بإصبعك شكلًا على الخريطة",
    cancelDraw: "إلغاء الرسم",
    clearArea: "✕ امسح المنطقة",
    areaSize: (km: string) => `المنطقة المرسومة ≈ ${km} كم²`,
    areaLoading: "جارٍ البحث داخل المنطقة…",
    areaError: "تعذر البحث داخل المنطقة — جرّب مرة أخرى.",
    areaCount: (n: string) => `${n} داخل المنطقة`,
    areaEmptyTitle: "ما فيش حاجة داخل المنطقة اللي رسمتها.",
    areaTiny: "المنطقة صغيرة جدًا — وهذا على الأغلب السبب. وسّعها شوية وجرّب.",
    areaWiden: "وسّع المنطقة، أو امسحها وترجع لك كل النتائج.",
    noPin: (n: string) =>
      `${n} من نتائج هذا البحث بدون موقع مسجّل على الخريطة، وبحث المنطقة ما يقدرش يلقاها — امسح المنطقة وترجع لك في القائمة.`,
    noPinsAtAll: "ما فيش مواقع مسجّلة لهذه النتائج بعد — وتقدر ترسم منطقة برضو",
  },
  en: {
    empty: "No results with these filters — try widening the search.",
    found: (n: string) => `${n} premium venues found`,
    approx: "📍 Locations are approximate (~500m) — the exact address follows the deposit",
    list: "☰ List",
    map: "🗺 Map",
    perNight: (price: string) => `${price} / night`,
    onRequest: "On request",
    close: "Close",
    draw: "✏️ Draw an area",
    drawHint: "Draw a shape on the map with your finger",
    cancelDraw: "Cancel drawing",
    clearArea: "✕ Clear the area",
    areaSize: (km: string) => `Drawn area ≈ ${km} km²`,
    areaLoading: "Searching inside the area…",
    areaError: "Could not search that area — try again.",
    areaCount: (n: string) => `${n} inside the area`,
    areaEmptyTitle: "Nothing inside the area you drew.",
    areaTiny: "The shape is very small, which is the likely reason — draw a wider one.",
    areaWiden: "Widen the area, or clear it to get all the results back.",
    noPin: (n: string) =>
      `${n} of the results for this search have no location on the map, so a drawn area cannot find them — clear the area and they are back in the list.`,
    noPinsAtAll:
      "None of these listings has a location on the map yet — you can still draw an area",
  },
} satisfies Record<Locale, unknown>;

type AreaState = "idle" | "loading" | "done" | "error";

export function SearchResults({
  items,
  vertical,
  maps,
  query = "",
}: {
  items: PublicListing[];
  vertical: string;
  /** From `/v1/settings/public`; picks the provider and whether drawing is on. */
  maps?: MapsSettings;
  /** The current filters, so a drawn search keeps every one of them. */
  query?: string;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMapMobile, setShowMapMobile] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [polygon, setPolygon] = useState<MapLatLng[] | null>(null);
  const [areaItems, setAreaItems] = useState<PublicListing[] | null>(null);
  const [areaState, setAreaState] = useState<AreaState>("idle");
  const listRef = useRef<HTMLDivElement>(null);

  const shown = areaItems ?? items;
  const selected = shown.find((i) => i.id === selectedId) ?? null;
  const drawEnabled = maps?.drawSearch !== false;
  const anyCoords = items.some((i) => i.approxLocation?.lat);
  /*
   * The map stays up whenever drawing is available, even with nothing to pin.
   * An empty Tripoli you can draw on is more use than no map at all, and it is
   * where the "these have no location" note belongs — which is the normal case
   * for services, the vertical this feature was built for.
   */
  const showMap = anyCoords || drawEnabled;
  const areaKm2 = polygon ? polygonAreaKm2(polygon) : 0;
  /*
   * Counted against the unfiltered result set, not the drawn one: this is how
   * many places were never eligible for the shape at all, which is exactly
   * what makes an empty area readable.
   */
  const withoutPin = items.filter((i) => !i.approxLocation?.lat).length;

  /*
   * Map pin → bring the card to the guest rather than making them hunt.
   *
   * Only from the map. This used to fire on any selection change, and cards
   * select themselves on hover to light up their pin — so moving the mouse
   * across the results scrolled the page under the cursor, which is
   * disorienting on its own and became untenable once the cards grew photo
   * arrows: reaching for "next photo" made the page slide away from you.
   *
   * Hovering says "highlight this on the map". Clicking a pin says "show me
   * that one". Only the second is a request to move.
   */
  const selectionSource = useRef<"map" | "hover" | null>(null);
  const selectFromMap = useCallback((id: string) => {
    selectionSource.current = "map";
    setSelectedId(id);
  }, []);
  const selectFromHover = useCallback((id: string) => {
    selectionSource.current = "hover";
    setSelectedId(id);
  }, []);

  useEffect(() => {
    if (!selectedId || selectionSource.current !== "map") return;
    const el = document.getElementById(`card-${selectedId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedId]);

  const runAreaSearch = useCallback(
    async (points: MapLatLng[]) => {
      setDrawing(false);
      setPolygon(points);
      setSelectedId(null);
      setAreaState("loading");
      const params = new URLSearchParams(query);
      params.set("poly", encodePolygon(points));
      params.set("limit", "50");
      try {
        const res = await fetch(`${API_URL}/v1/listings?${params}`, {
          headers: { "accept-language": apiAcceptLanguage() },
        });
        if (!res.ok) throw new Error("area search failed");
        const body = (await res.json()) as { items: PublicListing[] };
        setAreaItems(body.items);
        setAreaState("done");
        /*
         * The centre and the size, never the outline. A drawn shape is the
         * strongest demand signal this marketplace can collect — someone
         * outlining by hand the piece of Libya they want to be in — and three
         * decimal places (~100m) is coarse enough to be a neighbourhood
         * rather than a front door.
         */
        const centre = polygonCentre(points);
        trackClient("search.area_drawn", {
          vertical,
          shape: "polygon",
          centreLat: round3(centre.lat),
          centreLng: round3(centre.lng),
          areaKm2: round1(polygonAreaKm2(points)),
          resultCount: body.items.length,
        });
      } catch {
        // Offline, or the origin is down. The shape stays on the map so the
        // guest can retry it rather than draw it again.
        setAreaState("error");
      }
    },
    [query, vertical],
  );

  const clearArea = useCallback(() => {
    setPolygon(null);
    setAreaItems(null);
    setAreaState("idle");
    setDrawing(false);
    setSelectedId(null);
  }, []);

  const startDrawing = useCallback(() => {
    // On a phone the map is behind the list, and you cannot draw on what you
    // cannot see. On a wide screen it is already beside the list, and flipping
    // this would mount a second map nobody can see.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setShowMapMobile(true);
    }
    setDrawing(true);
  }, []);

  if (items.length === 0 && !polygon) {
    return <div className="card p-8 text-center text-muted">{c.empty}</div>;
  }

  const mapProps = {
    items: shown,
    vertical,
    selectedId,
    maps,
    drawing,
    polygon,
    onSelect: selectFromMap,
    onDrawn: runAreaSearch,
    onDrawCancelled: () => setDrawing(false),
  };

  return (
    <>
      {/* Area controls — above both columns, so they are reachable in either
          mobile view and sit correctly in an RTL and an LTR layout. */}
      {showMap && drawEnabled ? (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
          {drawing ? (
            <>
              <span className="chip font-bold">{c.drawHint}</span>
              <button type="button" onClick={() => setDrawing(false)} className="chip">
                {c.cancelDraw}
              </button>
            </>
          ) : (
            <button type="button" onClick={startDrawing} className="chip font-bold">
              {c.draw}
            </button>
          )}
          {polygon ? (
            <>
              <span className="text-muted">{c.areaSize(fmtNum(locale, round1(areaKm2)))}</span>
              {areaState === "loading" ? (
                <span className="text-faint">{c.areaLoading}</span>
              ) : areaState === "done" ? (
                <span className="text-muted">{c.areaCount(fmtNum(locale, shown.length))}</span>
              ) : null}
              <button type="button" onClick={clearArea} className="chip font-bold">
                {c.clearArea}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {/*
        The count, in the accent, above the results — the design's line.

        `text-link` rather than `--amber` and not by preference: this sits on the
        page ground rather than on a card, where the brand orange is 3.14:1 and
        even the deeper `--amber-dark` only reaches 4.43:1 at 14px. `--link` is
        the token that exists for accent-coloured text and clears 4.5:1 on both
        grounds in both themes. It reads as the same warm accent at a glance.
      */}
      {shown.length > 0 ? (
        <p className="text-sm font-bold text-link mb-3">{c.found(fmtNum(locale, shown.length))}</p>
      ) : null}

      {/* The listings a drawn area could never have matched. Said out loud,
          because an empty area otherwise reads as an empty country. */}
      {polygon && withoutPin > 0 ? (
        <p className="text-sm text-muted mb-3">{c.noPin(fmtNum(locale, withoutPin))}</p>
      ) : null}

      {/*
        Desktop is a map with a rail beside it, not two equal halves.

        The frames give the map roughly three fifths and the results a
        scrollable sidebar, which is the right weight: on a phone the list is
        the product and the map is a toggle, but on a wide screen the map is the
        thing you cannot get anywhere else, and 50/50 spends half a monitor
        rendering a column of cards two abreast.

        The map leads on `lg` via `order`, not by moving it in the DOM. Source
        order still puts the list first, which is what a screen reader follows
        and what the mobile stack needs — down there the map is a toggle and
        must not come first.
      */}
      <div
        className={`lg:grid lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-4 ${
          showMapMobile ? "hidden lg:grid" : ""
        }`}
      >
        {/* results list */}
        <div
          ref={listRef}
          className="lg:order-2 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto lg:pe-1"
        >
          {shown.length === 0 ? (
            <div className="card p-6 space-y-2 mb-4">
              <p className="font-bold text-sea">
                {areaState === "error" ? c.areaError : c.areaEmptyTitle}
              </p>
              {areaState !== "error" ? (
                <p className="text-muted text-sm">
                  {areaKm2 > 0 && areaKm2 < TINY_AREA_KM2 ? c.areaTiny : c.areaWiden}
                </p>
              ) : null}
              <button type="button" onClick={clearArea} className="chip font-bold">
                {c.clearArea}
              </button>
            </div>
          ) : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4 pb-4">
            {shown.map((l) => (
              <div
                key={l.id}
                id={`card-${l.id}`}
                onMouseEnter={() => anyCoords && selectFromHover(l.id)}
                className={`rounded-bubble transition-shadow ${
                  selectedId === l.id ? "ring-2 ring-sea shadow-lg" : ""
                }`}
              >
                <ListingCard l={l} />
              </div>
            ))}
          </div>
        </div>

        {/* map — sticky, always present on desktop, and leading the row */}
        {showMap ? (
          <div className="hidden lg:block relative lg:order-1">
            <div className="sticky top-4">
              <MapView
                {...mapProps}
                className="rounded-bubble overflow-hidden shadow-sm h-[calc(100dvh-9rem)]"
              />
              {selected ? (
                <PreviewCard listing={selected} onClose={() => setSelectedId(null)} />
              ) : (
                <p className="absolute bottom-3 inset-x-0 text-center pointer-events-none">
                  {/* Sits on the map tiles, which are light in both themes. */}
                  <span className="chip-on-photo !text-[11px]">
                    {anyCoords ? c.approx : c.noPinsAtAll}
                  </span>
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* mobile map view */}
      {showMap && showMapMobile ? (
        <div className="lg:hidden relative">
          <MapView {...mapProps} className="rounded-bubble overflow-hidden h-[calc(100dvh-12rem)]" />
          {selected ? (
            <PreviewCard listing={selected} onClose={() => setSelectedId(null)} />
          ) : null}
        </div>
      ) : null}

      {/* mobile switch */}
      {showMap ? (
        <button
          type="button"
          onClick={() => setShowMapMobile((v) => !v)}
          className="lg:hidden fixed bottom-5 inset-x-0 mx-auto w-fit z-30 bg-sea text-white font-bold rounded-full px-5 py-2.5 shadow-lg text-sm"
        >
          {showMapMobile ? c.list : c.map}
        </button>
      ) : null}
    </>
  );
}

/** One decimal place: "≈ 4.2 km²" is a size; "≈ 4.19483 km²" is a spec sheet. */
function round1(n: number): number {
  return Number(n.toFixed(1));
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
              src={thumb(cover)}
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
