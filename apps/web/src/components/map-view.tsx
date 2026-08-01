"use client";
/**
 * Map with Arabic price pins (Airbnb-style), designed to live PERMANENTLY
 * beside the results list rather than as a hidden toggle — the map is how
 * people actually think about "which strip of coast is this?".
 *
 * Leaflet is a lazy chunk from our own origin (3G budget §12.3); tiles are
 * OpenStreetMap (no key, no cost). Pins are APPROXIMATE locations only (§7.1):
 * exact coordinates never leave the server before the deposit is paid.
 */
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { trackClient } from "@/lib/tracker";
import { useLocale } from "@/lib/locale";
import { fmtNum } from "@/lib/vocab";
import { dirOf, type Locale } from "@/lib/i18n";
import type { PublicListing } from "@/lib/types";

/**
 * Pin labels. A price pin has room for two or three words, so these are the
 * shortest honest form: what you would say pointing at the map.
 */
const copy = {
  ar: { dinars: (n: string) => `${n} د.ل`, service: "خدمة", packages: "باقات" },
  en: { dinars: (n: string) => `${n} LYD`, service: "Service", packages: "Packages" },
} satisfies Record<Locale, unknown>;

type MarkerHandle = { setIcon(icon: unknown): void };

export function MapView({
  items,
  vertical,
  selectedId,
  onSelect,
  className = "",
}: {
  items: PublicListing[];
  vertical: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}) {
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove(): void; setView(c: [number, number], z: number): void } | null>(
    null,
  );
  const markersRef = useRef<Record<string, MarkerHandle>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LRef = useRef<any>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Build the map once per result set.
  useEffect(() => {
    let cancelled = false;
    trackClient("map.opened", { vertical, resultCount: items.length });

    import("leaflet")
      .then((L) => {
        if (cancelled || !ref.current || mapRef.current) return;
        LRef.current = L;
        const withCoords = items.filter((i) => i.approxLocation?.lat);
        const center: [number, number] = withCoords.length
          ? [
              withCoords.reduce((s, i) => s + Number(i.approxLocation!.lat), 0) /
                withCoords.length,
              withCoords.reduce((s, i) => s + Number(i.approxLocation!.lng), 0) /
                withCoords.length,
            ]
          : [32.8, 13.18]; // Tripoli

        const map = L.map(ref.current, { zoomControl: true, attributionControl: true });
        mapRef.current = map as never;
        map.setView(center, 11);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 17,
          attribution: "© OpenStreetMap",
        }).addTo(map);

        const bounds: [number, number][] = [];
        for (const item of withCoords) {
          const lat = Number(item.approxLocation!.lat);
          const lng = Number(item.approxLocation!.lng);
          bounds.push([lat, lng]);
          const marker = L.marker([lat, lng], {
            icon: priceIcon(L, item, false, locale),
          }).addTo(map);
          marker.on("click", () => {
            onSelectRef.current?.(item.id);
            trackClient("map.pin_selected", { listingId: item.id, vertical });
          });
          markersRef.current[item.id] = marker as MarkerHandle;
          // Honest about the ~500m fuzzing (§7.1).
          L.circle([lat, lng], {
            radius: item.approxLocation!.radiusM ?? 500,
            color: "#1B4F72",
            weight: 1,
            fillColor: "#1B4F72",
            fillOpacity: 0.06,
          }).addTo(map);
        }
        if (bounds.length > 1) map.fitBounds(bounds, { padding: [48, 48] });
      })
      .catch(() => {
        /* chunk failed offline — the list is always there */
      });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, locale]);

  // Repaint pins when the selection changes (either direction: map ⇄ list).
  useEffect(() => {
    const L = LRef.current;
    if (!L) return;
    for (const item of items) {
      const m = markersRef.current[item.id];
      if (m) m.setIcon(priceIcon(L, item, item.id === selectedId, locale));
    }
  }, [selectedId, items, locale]);

  return <div ref={ref} className={className} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function priceIcon(L: any, item: PublicListing, active: boolean, locale: Locale) {
  const c = copy[locale];
  const price =
    item.baseNightly > 0
      ? c.dinars(fmtNum(locale, Math.round(item.baseNightly / 1000)))
      : item.type === "service"
        ? c.service
        : c.packages;
  const bg = active ? "#1B4F72" : "#fff";
  const fg = active ? "#fff" : "#1B4F72";
  // The pin is raw HTML handed to Leaflet, outside React and outside the
  // document's `dir`, so it has to state its own direction and face.
  const font = locale === "en" ? "Inter,Almarai,Tahoma,sans-serif" : "Almarai,Tahoma,sans-serif";
  return L.divIcon({
    className: "",
    html: `<div style="background:${bg};border:1.5px solid #1B4F72;color:${fg};font-weight:800;font-family:${font};font-size:12px;padding:3px 9px;border-radius:999px;box-shadow:0 1px 5px rgba(0,0,0,.28);white-space:nowrap;direction:${dirOf(locale)};transform:scale(${active ? 1.12 : 1});transition:transform .15s">${price}</div>`,
    iconAnchor: [24, 14],
  });
}
