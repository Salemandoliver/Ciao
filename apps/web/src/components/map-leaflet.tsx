"use client";
/**
 * The OpenStreetMap map. No key, no account, no per-load billing — which is
 * why it is the default and stays the default: Ciao must work on the day
 * nobody has bought anything.
 *
 * This whole module (Leaflet, its CSS, this component) is one lazy chunk,
 * loaded by `map-view.tsx` only when a map is actually on screen, because the
 * 3G budget (§12.3) does not survive shipping a mapping library to someone who
 * came to read a listing.
 *
 * Pins are APPROXIMATE locations only (§7.1): exact coordinates never leave
 * the server before the deposit is paid, and a venue whose provider chose
 * area-only has no coordinates here at all — it is in the list and not on the
 * map, which is the whole point of that setting.
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { trackClient } from "@/lib/tracker";
import { useLocale } from "@/lib/locale";
import { dirOf, type Locale } from "@/lib/i18n";
import type { PublicListing } from "@/lib/types";
import {
  PIN_INK,
  isUsablePolygon,
  pinColours,
  pinFont,
  pinLabel,
  type MapImplProps,
  type MapLatLng,
} from "./map-geo";

export default function LeafletMap({
  items,
  vertical,
  selectedId,
  onSelect,
  className = "",
  centre,
  drawing = false,
  polygon = null,
  onDrawn,
  onDrawCancelled,
}: MapImplProps) {
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const layerRef = useRef<L.LayerGroup | null>(null);
  const shapeRef = useRef<L.Polygon | null>(null);
  /*
   * Callbacks in refs so that changing `onSelect` — which a parent re-creates
   * on every render — does not tear the map down and rebuild it.
   */
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  const onCancelRef = useRef(onDrawCancelled);
  onCancelRef.current = onDrawCancelled;

  // ---------------------------------------------------------------- the map
  // Built once and kept. The original built it per result set, which meant a
  // drawn shape and the guest's own panning were thrown away every time the
  // results changed — precisely when they most want to keep looking at the
  // same piece of coast.
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, { zoomControl: true, attributionControl: true });
    map.setView([centre.lat, centre.lng], centre.zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      markersRef.current = {};
      shapeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------- pins
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    trackClient("map.opened", { vertical, resultCount: items.length });

    layer.clearLayers();
    markersRef.current = {};
    const bounds: [number, number][] = [];

    for (const item of items) {
      const lat = Number(item.approxLocation?.lat);
      const lng = Number(item.approxLocation?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue; // area-only: no pin, ever
      bounds.push([lat, lng]);
      const marker = L.marker([lat, lng], { icon: priceIcon(item, false, locale) }).addTo(layer);
      marker.on("click", () => {
        onSelectRef.current?.(item.id);
        trackClient("map.pin_selected", { listingId: item.id, vertical });
      });
      markersRef.current[item.id] = marker;
      // Honest about the ~500m fuzzing (§7.1). A `public` venue comes back
      // with radius 0 and gets a plain pin instead of a circle it has not
      // asked for.
      const radius = item.approxLocation?.radiusM ?? 500;
      if (radius > 0) {
        L.circle([lat, lng], {
          radius,
          color: PIN_INK,
          weight: 1,
          fillColor: PIN_INK,
          fillOpacity: 0.06,
        }).addTo(layer);
      }
    }

    // A drawn shape is the guest's own frame; don't yank the view off it.
    if (!polygon && bounds.length > 1) map.fitBounds(bounds, { padding: [48, 48] });
    else if (!polygon && bounds.length === 1) map.setView(bounds[0]!, 13);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, locale, vertical]);

  // Repaint pins when the selection changes (either direction: map ⇄ list).
  useEffect(() => {
    for (const item of items) {
      markersRef.current[item.id]?.setIcon(priceIcon(item, item.id === selectedId, locale));
    }
  }, [selectedId, items, locale]);

  // -------------------------------------------------------- committed shape
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    shapeRef.current?.remove();
    shapeRef.current = null;
    if (!polygon || polygon.length < 3) return;
    const shape = L.polygon(
      polygon.map((p) => [p.lat, p.lng] as [number, number]),
      { color: PIN_INK, weight: 2, fillColor: PIN_INK, fillOpacity: 0.1 },
    ).addTo(map);
    shapeRef.current = shape;
    map.fitBounds(shape.getBounds(), { padding: [36, 36] });
  }, [polygon]);

  // ------------------------------------------------------------- freehand
  /*
   * Drawn with a finger, not clicked vertex by vertex. Nobody outlines "the
   * southern part of Tripoli" as a sequence of taps, and a phone is the only
   * device most of this audience has.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawing) return;
    const container = map.getContainer();
    const handlers = [map.dragging, map.doubleClickZoom, map.scrollWheelZoom, map.touchZoom];
    for (const h of handlers) h.disable();
    const priorCursor = container.style.cursor;
    const priorTouch = container.style.touchAction;
    container.style.cursor = "crosshair";
    container.style.touchAction = "none"; // or the browser scrolls the page instead

    let points: MapLatLng[] = [];
    let lastPixel: { x: number; y: number } | null = null;
    let line: L.Polyline | null = null;
    let drawingNow = false;

    const pixel = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const toLatLng = (p: { x: number; y: number }): MapLatLng => {
      const ll = map.containerPointToLatLng(L.point(p.x, p.y));
      return { lat: ll.lat, lng: ll.lng };
    };

    const down = (e: PointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      drawingNow = true;
      const p = pixel(e);
      lastPixel = p;
      points = [toLatLng(p)];
      line = L.polyline([[points[0]!.lat, points[0]!.lng]], {
        color: PIN_INK,
        weight: 3,
        dashArray: "6 5",
      }).addTo(map);
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        /* older browsers: the window-level listeners below still finish it */
      }
    };

    const move = (e: PointerEvent) => {
      if (!drawingNow || !line) return;
      e.preventDefault();
      const p = pixel(e);
      // Thin at the source: a 6px gate keeps the shape and drops the tremor.
      if (lastPixel && Math.hypot(p.x - lastPixel.x, p.y - lastPixel.y) < 6) return;
      lastPixel = p;
      points.push(toLatLng(p));
      line.setLatLngs(points.map((q) => [q.lat, q.lng] as [number, number]));
    };

    const up = () => {
      if (!drawingNow) return;
      drawingNow = false;
      line?.remove();
      line = null;
      // A tap is not an area. Say so by cancelling rather than searching a
      // three-metre triangle and reporting nothing found.
      if (isUsablePolygon(points)) onDrawnRef.current?.(points);
      else onCancelRef.current?.();
      points = [];
      lastPixel = null;
    };

    container.addEventListener("pointerdown", down);
    container.addEventListener("pointermove", move);
    container.addEventListener("pointerup", up);
    container.addEventListener("pointercancel", up);
    window.addEventListener("pointerup", up);

    return () => {
      container.removeEventListener("pointerdown", down);
      container.removeEventListener("pointermove", move);
      container.removeEventListener("pointerup", up);
      container.removeEventListener("pointercancel", up);
      window.removeEventListener("pointerup", up);
      line?.remove();
      container.style.cursor = priorCursor;
      container.style.touchAction = priorTouch;
      for (const h of handlers) h.enable();
    };
  }, [drawing]);

  return <div ref={ref} className={className} />;
}

function priceIcon(item: PublicListing, active: boolean, locale: Locale): L.DivIcon {
  // Shared with the other two providers so the same listing is the same colour
  // whichever map the operator has switched on. No dark variant: this map keeps
  // OSM's stock tiles, which are light whatever the app's theme is.
  const c = pinColours(active);
  // The pin is raw HTML handed to Leaflet, outside React and outside the
  // document's `dir`, so it has to state its own direction and face.
  return L.divIcon({
    className: "",
    html: `<div style="background:${c.bg};border:1.5px solid ${c.border};color:${c.fg};font-weight:800;font-family:${pinFont(locale)};font-size:12px;padding:3px 9px;border-radius:999px;box-shadow:${c.shadow};white-space:nowrap;direction:${dirOf(locale)};transform:scale(${active ? 1.12 : 1});transition:transform .15s">${escapeHtml(pinLabel(item, locale))}</div>`,
    iconAnchor: [24, 14],
  });
}

/** Titles never reach the pin, but a price is still string interpolation into
 *  innerHTML, and the habit of escaping it costs nothing. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) =>
    ch === "&"
      ? "&amp;"
      : ch === "<"
        ? "&lt;"
        : ch === ">"
          ? "&gt;"
          : ch === '"'
            ? "&quot;"
            : "&#39;",
  );
}
