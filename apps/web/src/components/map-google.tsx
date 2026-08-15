"use client";
/**
 * The Google Maps map — the same map as `map-leaflet.tsx`, drawn by a
 * different library.
 *
 * It exists because Google's tiles are the ones Libyans actually recognise:
 * the informal names, the unpaved coast turnings and half the businesses in
 * Tripoli are on Google and on nothing else. It is not the default, because
 * Google bills per load in a market where a good month is a few thousand
 * searches and the platform has to survive the bad ones.
 *
 * So the choice is an operator setting, not a rewrite: `maps.provider` in the
 * console picks the provider, and this file only ever renders if a key is also
 * present in the build. Without a key the wrapper silently uses OSM — see
 * `resolveProvider`. Nothing here is a fallback path a guest can see.
 *
 * The privacy rules are identical and are not restated: approximate points
 * only, no pin at all for an area-only venue (§7.1).
 */
import { useEffect, useRef, useState } from "react";
import { trackClient } from "@/lib/tracker";
import { useLocale } from "@/lib/locale";
import { dirOf, type Locale } from "@/lib/i18n";
import type { PublicListing } from "@/lib/types";
import {
  PIN_INK,
  googleMapsKey,
  inverseMercatorY,
  isUsablePolygon,
  mercatorY,
  pinColours,
  pinFont,
  pinLabel,
  type MapImplProps,
  type MapLatLng,
} from "./map-geo";

/* ---------------------------------------------------------------- the loader
 * One script tag per page, ever.
 *
 * Two maps on one screen (the desktop split view and the mobile sheet both
 * mount one) would otherwise mean two downloads and a console full of Google's
 * "you have included the API multiple times" warning. The promise is
 * module-level, so the second caller waits on the first one's script instead
 * of adding another.
 */
let loader: Promise<GoogleMapsApi> | null = null;

function loadGoogleMaps(key: string, language: string): Promise<GoogleMapsApi> {
  if (loader) return loader;
  loader = new Promise<GoogleMapsApi>((resolve, reject) => {
    const existing = (window as unknown as { google?: { maps?: GoogleMapsApi } }).google?.maps;
    if (existing) return resolve(existing);
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key,
      // Arabic labels on an Arabic page. `region` biases place names and
      // formatting to Libya rather than to wherever the request came from.
      language,
      region: "LY",
      loading: "async",
      v: "weekly",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onload = () => {
      const api = (window as unknown as { google?: { maps?: GoogleMapsApi } }).google?.maps;
      if (api) resolve(api);
      else reject(new Error("google maps loaded without an api"));
    };
    script.onerror = () => {
      // A blocked or unreachable script must be retryable on the next mount —
      // half of Libya's connections drop a 200KB script at least once.
      loader = null;
      reject(new Error("google maps script failed"));
    };
    document.head.appendChild(script);
  });
  return loader;
}

export default function GoogleMap({
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
  const apiRef = useRef<GoogleMapsApi | null>(null);
  const mapRef = useRef<GMap | null>(null);
  const markersRef = useRef<Record<string, GMarker>>({});
  const overlaysRef = useRef<GOverlay[]>([]);
  const shapeRef = useRef<GOverlay | null>(null);
  /*
   * Bumped once when the script lands. Every effect below depends on it, which
   * is how they re-run against a map that did not exist on first render —
   * cheaper and less fragile than each of them polling for one.
   */
  const [ready, setReady] = useState(0);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  const onCancelRef = useRef(onDrawCancelled);
  onCancelRef.current = onDrawCancelled;

  // ---------------------------------------------------------------- the map
  useEffect(() => {
    const key = googleMapsKey();
    if (!key || !ref.current || mapRef.current) return;
    let cancelled = false;
    // Google wants a language it publishes tiles in: bare `ar`, not `ar-LY`.
    loadGoogleMaps(key, locale === "en" ? "en-GB" : "ar")
      .then((api) => {
        if (cancelled || !ref.current || mapRef.current) return;
        apiRef.current = api;
        mapRef.current = new api.Map(ref.current, {
          center: { lat: centre.lat, lng: centre.lng },
          zoom: centre.zoom,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });
        setReady((n) => n + 1);
      })
      .catch(() => {
        /* the list is always there; a missing map is not an error screen */
      });
    return () => {
      cancelled = true;
      // Google has no `map.remove()`; detaching the overlays is what stops
      // them holding the map and the div alive after React drops them.
      for (const overlay of overlaysRef.current) overlay.setMap(null);
      shapeRef.current?.setMap(null);
      overlaysRef.current = [];
      markersRef.current = {};
      shapeRef.current = null;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------- pins
  useEffect(() => {
    const api = apiRef.current;
    const map = mapRef.current;
    if (!api || !map) return;
    trackClient("map.opened", { vertical, resultCount: items.length });

    for (const overlay of overlaysRef.current) overlay.setMap(null);
    overlaysRef.current = [];
    markersRef.current = {};

    const bounds = new api.LatLngBounds();
    let count = 0;
    for (const item of items) {
      const lat = Number(item.approxLocation?.lat);
      const lng = Number(item.approxLocation?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue; // area-only
      count += 1;
      bounds.extend({ lat, lng });
      const marker = new api.Marker({
        position: { lat, lng },
        map,
        icon: priceIcon(api, item, false, locale),
      });
      marker.addListener("click", () => {
        onSelectRef.current?.(item.id);
        trackClient("map.pin_selected", { listingId: item.id, vertical });
      });
      markersRef.current[item.id] = marker;
      overlaysRef.current.push(marker);
      const radius = item.approxLocation?.radiusM ?? 500;
      if (radius > 0) {
        overlaysRef.current.push(
          new api.Circle({
            center: { lat, lng },
            radius,
            map,
            strokeColor: PIN_INK,
            strokeWeight: 1,
            fillColor: PIN_INK,
            fillOpacity: 0.06,
          }),
        );
      }
    }

    if (!polygon && count > 1) map.fitBounds(bounds, 48);
    else if (!polygon && count === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(13);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, locale, vertical, ready]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    for (const item of items) {
      markersRef.current[item.id]?.setIcon(
        priceIcon(api, item, item.id === selectedId, locale),
      );
    }
  }, [selectedId, items, locale, ready]);

  // -------------------------------------------------------- committed shape
  useEffect(() => {
    const api = apiRef.current;
    const map = mapRef.current;
    if (!api || !map) return;
    shapeRef.current?.setMap(null);
    shapeRef.current = null;
    if (!polygon || polygon.length < 3) return;
    const shape = new api.Polygon({
      paths: polygon,
      map,
      strokeColor: PIN_INK,
      strokeWeight: 2,
      fillColor: PIN_INK,
      fillOpacity: 0.1,
      clickable: false,
    });
    shapeRef.current = shape;
    const bounds = new api.LatLngBounds();
    for (const p of polygon) bounds.extend(p);
    map.fitBounds(bounds, 36);
  }, [polygon, ready]);

  // --------------------------------------------------------------- freehand
  useEffect(() => {
    const api = apiRef.current;
    const map = mapRef.current;
    const container = ref.current;
    if (!api || !map || !container || !drawing) return;

    map.setOptions({
      draggable: false,
      gestureHandling: "none",
      scrollwheel: false,
      disableDoubleClickZoom: true,
    });
    const priorCursor = container.style.cursor;
    const priorTouch = container.style.touchAction;
    container.style.cursor = "crosshair";
    container.style.touchAction = "none";

    let points: MapLatLng[] = [];
    let lastPixel: { x: number; y: number } | null = null;
    let line: GPolyline | null = null;
    let drawingNow = false;

    /*
     * Google has no `containerPointToLatLng`, so the conversion is done from
     * the visible bounds by hand. Web Mercator on an unrotated, untilted map —
     * which is what the map is while a finger is on it, because every gesture
     * that could rotate or tilt it is disabled two statements above.
     */
    const toLatLng = (x: number, y: number): MapLatLng | null => {
      const b = map.getBounds();
      if (!b) return null;
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const ne = b.getNorthEast();
      const sw = b.getSouthWest();
      let lngSpan = ne.lng() - sw.lng();
      if (lngSpan < 0) lngSpan += 360; // meaningless in Libya, cheap to be right
      const top = mercatorY(ne.lat());
      const bottom = mercatorY(sw.lat());
      return {
        lat: inverseMercatorY(top + (y / rect.height) * (bottom - top)),
        lng: sw.lng() + (x / rect.width) * lngSpan,
      };
    };

    const pixel = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const down = (e: PointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      const p = pixel(e);
      const ll = toLatLng(p.x, p.y);
      if (!ll) return;
      e.preventDefault();
      drawingNow = true;
      lastPixel = p;
      points = [ll];
      line = new api.Polyline({
        path: points,
        map,
        strokeColor: PIN_INK,
        strokeWeight: 3,
        clickable: false,
      });
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        /* the window listener finishes the stroke instead */
      }
    };

    const move = (e: PointerEvent) => {
      if (!drawingNow || !line) return;
      e.preventDefault();
      const p = pixel(e);
      if (lastPixel && Math.hypot(p.x - lastPixel.x, p.y - lastPixel.y) < 6) return;
      const ll = toLatLng(p.x, p.y);
      if (!ll) return;
      lastPixel = p;
      points.push(ll);
      line.setPath(points);
    };

    const up = () => {
      if (!drawingNow) return;
      drawingNow = false;
      line?.setMap(null);
      line = null;
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
      line?.setMap(null);
      container.style.cursor = priorCursor;
      container.style.touchAction = priorTouch;
      map.setOptions({
        draggable: true,
        gestureHandling: "auto",
        scrollwheel: true,
        disableDoubleClickZoom: false,
      });
    };
  }, [drawing, ready]);

  return <div ref={ref} className={className} />;
}

/* ------------------------------------------------------------------- pins
 * The pin is an SVG data URL rather than an HTML overlay.
 *
 * Google's HTML markers (`AdvancedMarkerElement`) need a cloud-configured map
 * ID, which is one more thing to buy and one more thing to be misconfigured on
 * the day this is switched on. An inline SVG needs nothing, renders the same
 * Arabic price as the Leaflet pin, and cannot be broken by a console setting.
 */
function priceIcon(
  api: GoogleMapsApi,
  item: PublicListing,
  active: boolean,
  locale: Locale,
): GIcon {
  const label = pinLabel(item, locale);
  // Shared with the other two providers so the same listing is the same colour
  // whichever map the operator has switched on.
  const { bg, fg, border } = pinColours(active);
  // Arabic and Latin digits are near enough the same width at this size; the
  // 9px-per-character estimate errs wide, which shows as padding, not clipping.
  const width = Math.max(46, 16 + label.length * 9) * (active ? 1.12 : 1);
  const height = 26 * (active ? 1.12 : 1);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${height / 2}" ` +
    `fill="${bg}" stroke="${border}" stroke-width="1.5"/>` +
    `<text x="${width / 2}" y="${height / 2}" dominant-baseline="central" text-anchor="middle" ` +
    `direction="${dirOf(locale)}" font-family="${pinFont(locale)}" font-size="12" ` +
    `font-weight="800" fill="${fg}">${escapeXml(label)}</text></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new api.Size(width, height),
    anchor: new api.Point(width / 2, height / 2),
  };
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) =>
    ch === "&"
      ? "&amp;"
      : ch === "<"
        ? "&lt;"
        : ch === ">"
          ? "&gt;"
          : ch === '"'
            ? "&quot;"
            : "&apos;",
  );
}

/* ---------------------------------------------------------------- the types
 * `@types/google.maps` is a dependency we do not have and would rather not add
 * for a provider that is switched off. This is the surface this file actually
 * touches, written out — narrow enough to be checked, and it fails loudly here
 * rather than silently at a call site if Google changes shape.
 */
interface GLatLng {
  lat(): number;
  lng(): number;
}
interface GBounds {
  extend(p: MapLatLng): void;
  getNorthEast(): GLatLng;
  getSouthWest(): GLatLng;
  getCenter(): GLatLng;
}
interface GOverlay {
  setMap(map: GMap | null): void;
}
interface GMarker extends GOverlay {
  setIcon(icon: GIcon): void;
  addListener(event: string, handler: () => void): void;
}
interface GPolyline extends GOverlay {
  setPath(path: MapLatLng[]): void;
}
interface GIcon {
  url: string;
  scaledSize: unknown;
  anchor: unknown;
}
interface GMap {
  setCenter(p: GLatLng | MapLatLng): void;
  setZoom(z: number): void;
  fitBounds(bounds: GBounds, padding?: number): void;
  getBounds(): GBounds | null;
  setOptions(options: Record<string, unknown>): void;
}
interface GoogleMapsApi {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => GMap;
  Marker: new (options: Record<string, unknown>) => GMarker;
  Circle: new (options: Record<string, unknown>) => GOverlay;
  Polyline: new (options: Record<string, unknown>) => GPolyline;
  Polygon: new (options: Record<string, unknown>) => GOverlay;
  LatLngBounds: new () => GBounds;
  Size: new (w: number, h: number) => unknown;
  Point: new (x: number, y: number) => unknown;
}
