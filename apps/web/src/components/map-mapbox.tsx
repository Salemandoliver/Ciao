"use client";
/**
 * The Mapbox map — the same map as `map-leaflet.tsx` and `map-google.tsx`,
 * drawn by a third library, and the one that renders by default.
 *
 * It is the default because it is the only one of the three that is legible in
 * Libya and affordable at the same time. OSM knows the coast road exists but
 * not what anyone calls it; Google knows every unpaved turning and bills $7 per
 * 1,000 loads for the privilege. Mapbox has real Arabic labels — `name_ar` on
 * the vector tiles, set below — and a free tier measured in tens of thousands
 * of loads, which is the shape of a good month here.
 *
 * The provider is still an operator setting (`maps.provider`), and this file
 * only ever renders if `NEXT_PUBLIC_MAPBOX_TOKEN` is also in the build. Without
 * a token the wrapper falls back silently — see `resolveProvider`. Nothing here
 * is a path a guest can see.
 *
 * The privacy rules are identical to the other two and are not restated:
 * approximate points only, no pin at all for an area-only venue (§7.1).
 */
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { trackClient } from "@/lib/tracker";
import { useLocale } from "@/lib/locale";
import { dirOf, type Locale } from "@/lib/i18n";
import type { PublicListing } from "@/lib/types";
import {
  PIN_INK,
  PIN_PAPER,
  isUsablePolygon,
  mapboxToken,
  pinFont,
  pinLabel,
  type MapImplProps,
  type MapLatLng,
} from "./map-geo";

/*
 * The light style, at noon and at midnight.
 *
 * Deliberately not switched with the app's theme: `map-geo.ts` explains why the
 * pin colours are raw hex rather than theme tokens — tiles are a photograph of
 * the world, and a pin that follows the theme ends up as pale ink on a pale
 * road at 1am. Swapping the tiles for `dark-v11` at night would put that
 * decision back on the table for one provider out of three and make the same
 * listing a different colour on two maps. If the dark map is wanted it is a
 * change to all three, made on purpose.
 */
const STYLE = "mapbox://styles/mapbox/light-v11";

/*
 * Arabic on a vector map needs a shaping plugin; without it labels arrive as
 * disconnected letters in the wrong order, which is worse than English ones.
 * `deferred` keeps the ~200KB off the wire until a label actually needs it, and
 * the module-level guard is because Mapbox throws if it is set twice — two maps
 * on one screen (desktop split view, mobile sheet) would otherwise do exactly
 * that.
 */
const RTL_PLUGIN =
  "https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js";
let rtlRequested = false;

function ensureRtlText(): void {
  if (rtlRequested) return;
  rtlRequested = true;
  try {
    mapboxgl.setRTLTextPlugin(RTL_PLUGIN, () => {}, true);
  } catch {
    /* already installed by another map on this page */
  }
}

/* Source and layer ids. Added once on load, then fed with `setData` — cheaper
 * and far less fragile than adding and removing layers as results change. */
const FUZZ_SRC = "ciao-fuzz";
const SHAPE_SRC = "ciao-shape";
const STROKE_SRC = "ciao-stroke";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

export default function MapboxMap({
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
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, { marker: mapboxgl.Marker; el: HTMLDivElement }>>({});
  /*
   * Bumped when the style finishes loading. Every effect below depends on it,
   * which is how they re-run against sources that did not exist on first
   * render — the same trick `map-google.tsx` uses for its script.
   */
  const [ready, setReady] = useState(0);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  const onCancelRef = useRef(onDrawCancelled);
  onCancelRef.current = onDrawCancelled;

  // ---------------------------------------------------------------- the map
  // Built once and kept, so a drawn shape and the guest's own panning survive
  // a change in the result set — which is exactly when they are most likely to
  // still be looking at the same strip of coast.
  useEffect(() => {
    const token = mapboxToken();
    if (!token || !ref.current || mapRef.current) return;
    ensureRtlText();
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: ref.current,
      style: STYLE,
      center: [centre.lng, centre.lat], // Mapbox takes lng first
      zoom: centre.zoom,
      attributionControl: true, // required by Mapbox's terms; never turn off
      dragRotate: false, // a rotated map makes a drawn shape hard to reason about
      pitchWithRotate: false,
      cooperativeGestures: false,
    });
    map.touchPitch.disable();
    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      dirOf(locale) === "rtl" ? "top-left" : "top-right",
    );

    map.on("load", () => {
      localiseLabels(map, locale);

      // The ~500m fuzz circles (§7.1), as real metres on the ground rather
      // than a pixel radius that would lie at every zoom but one.
      map.addSource(FUZZ_SRC, { type: "geojson", data: EMPTY });
      map.addLayer({
        id: `${FUZZ_SRC}-fill`,
        type: "fill",
        source: FUZZ_SRC,
        paint: { "fill-color": PIN_INK, "fill-opacity": 0.06 },
      });
      map.addLayer({
        id: `${FUZZ_SRC}-line`,
        type: "line",
        source: FUZZ_SRC,
        paint: { "line-color": PIN_INK, "line-width": 1, "line-opacity": 0.5 },
      });

      // The committed shape, drawn until the guest clears it.
      map.addSource(SHAPE_SRC, { type: "geojson", data: EMPTY });
      map.addLayer({
        id: `${SHAPE_SRC}-fill`,
        type: "fill",
        source: SHAPE_SRC,
        paint: { "fill-color": PIN_INK, "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: `${SHAPE_SRC}-line`,
        type: "line",
        source: SHAPE_SRC,
        paint: { "line-color": PIN_INK, "line-width": 2 },
      });

      // The stroke under a moving finger.
      map.addSource(STROKE_SRC, { type: "geojson", data: EMPTY });
      map.addLayer({
        id: `${STROKE_SRC}-line`,
        type: "line",
        source: STROKE_SRC,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": PIN_INK, "line-width": 3, "line-dasharray": [2, 1.5] },
      });

      setReady((n) => n + 1);
    });

    mapRef.current = map;
    return () => {
      for (const { marker } of Object.values(markersRef.current)) marker.remove();
      markersRef.current = {};
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------- pins
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    trackClient("map.opened", { vertical, resultCount: items.length });

    for (const { marker } of Object.values(markersRef.current)) marker.remove();
    markersRef.current = {};

    const bounds = new mapboxgl.LngLatBounds();
    const fuzz: ReturnType<typeof circleFeature>[] = [];
    let count = 0;

    for (const item of items) {
      const lat = Number(item.approxLocation?.lat);
      const lng = Number(item.approxLocation?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue; // area-only: no pin, ever
      count += 1;
      bounds.extend([lng, lat]);

      const el = document.createElement("div");
      paintPin(el, item, item.id === selectedId, locale);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current?.(item.id);
        trackClient("map.pin_selected", { listingId: item.id, vertical });
      });
      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(map);
      markersRef.current[item.id] = { marker, el };

      // Honest about the fuzzing. A `public` venue comes back with radius 0
      // and gets a plain pin instead of a circle it has not asked for.
      const radius = item.approxLocation?.radiusM ?? 500;
      if (radius > 0) fuzz.push(circleFeature({ lat, lng }, radius));
    }

    source(map, FUZZ_SRC)?.setData({ type: "FeatureCollection", features: fuzz });

    // A drawn shape is the guest's own frame; don't yank the view off it.
    if (!polygon && count > 1) map.fitBounds(bounds, { padding: 48, duration: 0 });
    else if (!polygon && count === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(13);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, locale, vertical, ready]);

  // Repaint pins when the selection changes (either direction: map ⇄ list).
  useEffect(() => {
    for (const item of items) {
      const entry = markersRef.current[item.id];
      if (entry) paintPin(entry.el, item, item.id === selectedId, locale);
    }
  }, [selectedId, items, locale, ready]);

  // -------------------------------------------------------- committed shape
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = source(map, SHAPE_SRC);
    if (!src) return;
    if (!polygon || polygon.length < 3) {
      src.setData(EMPTY);
      return;
    }
    const ring = polygon.map((p) => [p.lng, p.lat] as [number, number]);
    ring.push(ring[0]!); // GeoJSON rings close themselves
    src.setData({ type: "FeatureCollection", features: [polygonFeature([ring])] });
    const bounds = new mapboxgl.LngLatBounds();
    for (const p of polygon) bounds.extend([p.lng, p.lat]);
    map.fitBounds(bounds, { padding: 36, duration: 0 });
  }, [polygon, ready]);

  // --------------------------------------------------------------- freehand
  /*
   * Drawn with a finger, not clicked vertex by vertex. Nobody outlines "the
   * southern part of Tripoli" as a sequence of taps, and a phone is the only
   * device most of this audience has.
   *
   * `map.unproject()` does the pixel→coordinate conversion properly, which is
   * the one place this file is simpler than `map-google.tsx`: no hand-rolled
   * Mercator from the visible bounds, and it stays correct at any zoom.
   */
  useEffect(() => {
    const map = mapRef.current;
    const container = ref.current;
    if (!map || !container || !ready || !drawing) return;

    const gestures = [map.dragPan, map.scrollZoom, map.doubleClickZoom, map.touchZoomRotate];
    for (const g of gestures) g.disable();
    const priorCursor = container.style.cursor;
    const priorTouch = container.style.touchAction;
    container.style.cursor = "crosshair";
    container.style.touchAction = "none"; // or the browser scrolls the page instead

    const stroke = source(map, STROKE_SRC);
    let points: MapLatLng[] = [];
    let lastPixel: { x: number; y: number } | null = null;
    let drawingNow = false;

    const pixel = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const toLatLng = (p: { x: number; y: number }): MapLatLng => {
      const ll = map.unproject([p.x, p.y]);
      return { lat: ll.lat, lng: ll.lng };
    };
    const paint = () => {
      // A LineString needs two positions to be valid GeoJSON; the first
      // pointer-down has one, and feeding it through makes Mapbox complain in
      // the console on every single stroke.
      if (points.length < 2) return;
      stroke?.setData({
        type: "FeatureCollection",
        features: [lineFeature(points.map((q) => [q.lng, q.lat] as [number, number]))],
      });
    };

    const down = (e: PointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      drawingNow = true;
      const p = pixel(e);
      lastPixel = p;
      points = [toLatLng(p)];
      paint();
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        /* older browsers: the window-level listener below still finishes it */
      }
    };

    const move = (e: PointerEvent) => {
      if (!drawingNow) return;
      e.preventDefault();
      const p = pixel(e);
      // Thin at the source: a 6px gate keeps the shape and drops the tremor.
      if (lastPixel && Math.hypot(p.x - lastPixel.x, p.y - lastPixel.y) < 6) return;
      lastPixel = p;
      points.push(toLatLng(p));
      paint();
    };

    const up = () => {
      if (!drawingNow) return;
      drawingNow = false;
      stroke?.setData(EMPTY);
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
      stroke?.setData(EMPTY);
      container.style.cursor = priorCursor;
      container.style.touchAction = priorTouch;
      for (const g of gestures) g.enable();
    };
  }, [drawing, ready]);

  return <div ref={ref} className={className} />;
}

/* ------------------------------------------------------------------- pins
 * A real DOM element rather than an icon.
 *
 * Mapbox markers take an element, which means the pin is the same pill of HTML
 * the Leaflet map draws — and because the label goes in through `textContent`
 * there is no string interpolation into markup to escape, unlike the other two
 * implementations.
 */
function paintPin(
  el: HTMLDivElement,
  item: PublicListing,
  active: boolean,
  locale: Locale,
): void {
  const bg = active ? PIN_INK : PIN_PAPER;
  const fg = active ? PIN_PAPER : PIN_INK;
  el.textContent = pinLabel(item, locale);
  // The marker lives outside React and outside the document's `dir`, so it has
  // to state its own direction and face.
  el.dir = dirOf(locale);
  el.style.cssText =
    `background:${bg};border:1.5px solid ${PIN_INK};color:${fg};font-weight:800;` +
    `font-family:${pinFont(locale)};font-size:12px;padding:3px 9px;border-radius:999px;` +
    `box-shadow:0 1px 5px rgba(0,0,0,.28);white-space:nowrap;cursor:pointer;` +
    `transform:scale(${active ? 1.12 : 1});transition:transform .15s`;
}

/* ---------------------------------------------------------------- geometry */

function source(map: mapboxgl.Map, id: string): mapboxgl.GeoJSONSource | null {
  // `getSource` is undefined until the style has loaded, and during teardown.
  const src = map.getSource(id);
  return src && src.type === "geojson" ? (src as mapboxgl.GeoJSONSource) : null;
}

function polygonFeature(rings: [number, number][][]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: rings },
  };
}

function lineFeature(points: [number, number][]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: points },
  };
}

/**
 * A fuzz circle as a 64-sided polygon in real metres.
 *
 * Mapbox's `circle` layer measures its radius in pixels, which would mean the
 * ~500m we promise the venue shrinks as the guest zooms out and grows as they
 * zoom in — a privacy claim that is only true at one zoom level. The same flat
 * metres-per-degree the rest of the geometry uses is accurate well past 500m at
 * Libyan latitudes.
 */
function circleFeature(centre: MapLatLng, radiusM: number, steps = 64) {
  const dLat = radiusM / 110_574;
  const dLng = radiusM / (111_320 * Math.cos((centre.lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([centre.lng + dLng * Math.cos(t), centre.lat + dLat * Math.sin(t)]);
  }
  return polygonFeature([ring]);
}

/* ------------------------------------------------------------------ labels
 * Mapbox ships every name in every language it has, and shows the local one by
 * default — which in Tripoli is Arabic, and on an English page is a wall of
 * script most visitors cannot read. `name_ar` and `name_en` are fields on the
 * vector tiles, so this is a relabel rather than a second download; `coalesce`
 * keeps the local name wherever the translation is missing, which is most of
 * the smaller places in Libya.
 */
function localiseLabels(map: mapboxgl.Map, locale: Locale): void {
  const field = locale === "en" ? "name_en" : "name_ar";
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== "symbol") continue;
    try {
      // Only relabel what already has a label — some symbol layers are icons
      // only, and giving them a text field would put names on things the style
      // deliberately leaves unnamed.
      if (map.getLayoutProperty(layer.id, "text-field") === undefined) continue;
      map.setLayoutProperty(layer.id, "text-field", [
        "coalesce",
        ["get", field],
        ["get", "name"],
      ]);
    } catch {
      /* a layer that will not take the property keeps the one it had */
    }
  }
}
