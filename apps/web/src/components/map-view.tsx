"use client";
/**
 * Map search with price pins (Airbnb-style) — Leaflet bundled from our own
 * origin (lazy chunk, loads only when the map opens — 3G critical path stays
 * light). OpenStreetMap tiles, no API key. Pins show APPROXIMATE locations
 * only (§7.1) — the exact position never leaves the server pre-deposit.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import "leaflet/dist/leaflet.css";
import { trackClient } from "@/lib/tracker";
import type { PublicListing } from "@/lib/types";

export function MapView({ items, vertical }: { items: PublicListing[]; vertical: string }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove(): void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    trackClient("map.opened", { vertical, resultCount: items.length });

    import("leaflet")
      .then((L) => {
        if (cancelled || !ref.current || mapRef.current) return;
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
        mapRef.current = map;
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
          const price =
            item.baseNightly > 0
              ? `${Math.round(item.baseNightly / 1000).toLocaleString("ar-LY")} د.ل`
              : "باقات";
          const icon = L.divIcon({
            className: "",
            html: `<div style="background:#fff;border:1.5px solid #1B4F72;color:#1B4F72;font-weight:800;font-family:Almarai,Tahoma,sans-serif;font-size:12px;padding:3px 9px;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.25);white-space:nowrap;direction:rtl">${price}</div>`,
            iconAnchor: [24, 14],
          });
          const marker = L.marker([lat, lng], { icon }).addTo(map);
          marker.on("click", () => router.push(`/l/${item.slug}`));
          // Approximate-location circle (~500m) — honest about the fuzzing (§7.1).
          L.circle([lat, lng], {
            radius: item.approxLocation!.radiusM ?? 500,
            color: "#1B4F72",
            weight: 1,
            fillColor: "#1B4F72",
            fillOpacity: 0.07,
          }).addTo(map);
        }
        if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40] });
      })
      .catch(() => {
        /* chunk load failed offline — the list view is always there */
      });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card overflow-hidden">
      <div ref={ref} style={{ height: "60vh", minHeight: 380 }} />
      <p className="text-[11px] text-sea/50 p-2 text-center">
        📍 المواقع تقريبية (~500م) لحماية خصوصية المضيفين — العنوان الدقيق يظهر بعد دفع العربون
      </p>
    </div>
  );
}
