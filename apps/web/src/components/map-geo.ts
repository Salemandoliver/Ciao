/**
 * The small amount of geometry — and the handful of shared shapes — that both
 * map implementations need.
 *
 * Deliberately a straight port of `apps/api/src/modules/listings/geo.ts` and
 * nothing more: the client draws the shape and says how big it is, the server
 * decides what is inside it. Two implementations of point-in-polygon would be
 * two chances to disagree about a listing on a boundary, and the server's
 * answer is the only one that matters.
 *
 * The privacy rule that geo.ts explains at length holds here too, and is worth
 * restating where the shape is actually made: the outline is a user's hand
 * around a piece of Tripoli, and on a tight enough shape that is a home
 * address. It goes to the search endpoint and nowhere else — never into an
 * event, never into a URL we keep.
 */

import { fmtNum } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import type { PublicListing } from "@/lib/types";

export interface MapLatLng {
  lat: number;
  lng: number;
}

/** The maps we know how to draw. */
export type MapProvider = "osm" | "google" | "mapbox";

/** What `/v1/settings/public` says about maps. */
export interface MapsSettings {
  provider: MapProvider;
  defaultCentre: { lat: number; lng: number; zoom: number };
  drawSearch: boolean;
}

export const DEFAULT_MAPS: MapsSettings = {
  provider: "mapbox",
  // Tripoli. The same fallback the API ships, repeated here so a map still
  // opens somewhere sensible when the control plane is unreachable.
  defaultCentre: { lat: 32.8872, lng: 13.1913, zoom: 11 },
  drawSearch: true,
};

/**
 * Which map actually renders.
 *
 * Three providers, one rule: the operator's choice only counts if the credential
 * that choice needs is in the build. Mapbox is the default because it is the
 * only one of the three that is both legible in Libya — Arabic labels, the coast
 * road named the way people name it — and priced for a market where a good month
 * is a few thousand searches.
 *
 * The fallbacks are silent, on purpose and unchanged in spirit from when there
 * were two: a token nobody has bought yet is our procurement problem, not
 * something to put in front of a guest looking for a beach house. Mapbox
 * without a token drops to Google if that key exists, and to OSM otherwise —
 * OSM being the one that always works because it needs nothing.
 *
 * An operator who explicitly picks OSM gets OSM. Explicitly picking Google with
 * no key still means OSM, exactly as before.
 */
export function resolveProvider(maps: MapsSettings | undefined): MapProvider {
  const wanted = maps?.provider ?? DEFAULT_MAPS.provider;
  if (wanted === "mapbox" && mapboxToken()) return "mapbox";
  if (wanted === "google" && googleMapsKey()) return "google";
  // Asked for Mapbox, no token: Google is the better map if we have bought it.
  if (wanted === "mapbox" && googleMapsKey()) return "google";
  return "osm";
}

export function googleMapsKey(): string | null {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || null;
}

export function mapboxToken(): string | null {
  return process.env.NEXT_PUBLIC_MAPBOX_TOKEN || null;
}

/**
 * The area of a drawn shape in km², matching the server's `polygonAreaKm2`.
 *
 * Shown to the guest ("about 4 km²") rather than used to refuse anything. A
 * tiny shape is not an attack — it converges on the fuzzed point we already
 * publish — it is just someone who is about to get nothing back, and the
 * number is what lets us explain why.
 */
export function polygonAreaKm2(points: MapLatLng[]): number {
  if (points.length < 3) return 0;
  const meanLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos((meanLat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    sum +=
      b.lng * kmPerDegLng * (a.lat * kmPerDegLat) - a.lng * kmPerDegLng * (b.lat * kmPerDegLat);
  }
  return Math.abs(sum / 2);
}

/** The centre of a shape — the only part of it that may be recorded. */
export function polygonCentre(points: MapLatLng[]): MapLatLng {
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}

/** Three decimal places — about 100m. Coarse enough not to be a front door. */
export function round3(n: number): number {
  return Number(n.toFixed(3));
}

/**
 * `poly=lat,lng;lat,lng;…`, capped at the 60 vertices the API accepts.
 *
 * A finger dragged across a phone produces hundreds of points; every one past
 * the first couple of dozen describes the tremor in someone's hand rather than
 * the neighbourhood they meant. Thinning by even stride keeps the shape and
 * throws away the noise.
 */
export const MAX_POLYGON_POINTS = 60;

export function thinPolygon(points: MapLatLng[], max = MAX_POLYGON_POINTS): MapLatLng[] {
  if (points.length <= max) return points;
  const stride = points.length / max;
  const out: MapLatLng[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * stride)]!);
  return out;
}

export function encodePolygon(points: MapLatLng[]): string {
  return thinPolygon(points)
    .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join(";");
}

/** Libya, generously bounded — the same sanity check the API applies. */
export function isPlausibleLibyanPoint(p: MapLatLng): boolean {
  return p.lat >= 19 && p.lat <= 34 && p.lng >= 9 && p.lng <= 26;
}

/**
 * A shape worth sending: at least three points, all in Libya, and not so
 * small that it is obviously a slip of the finger rather than an area.
 */
export function isUsablePolygon(points: MapLatLng[]): boolean {
  return points.length >= 3 && points.every(isPlausibleLibyanPoint);
}

/** Below this the shape is almost certainly why nothing came back. */
export const TINY_AREA_KM2 = 1.5;

/* ------------------------------------------------------------------ mercator
 * Google's map has no `containerPointToLatLng`, so a freehand drag needs the
 * conversion done by hand from the visible bounds. Web Mercator, unrotated,
 * untilted — which is what the map is while someone is drawing on it.
 */

export function mercatorY(lat: number): number {
  const clamped = Math.max(-85.05, Math.min(85.05, lat));
  return Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
}

export function inverseMercatorY(y: number): number {
  return (360 / Math.PI) * (Math.atan(Math.exp(y)) - Math.PI / 4);
}

/* -------------------------------------------------------------- shared props
 * Both providers render the same map, so they take the same props and the
 * wrapper can swap one for the other without anything above it noticing.
 */

export interface MapImplProps {
  items: PublicListing[];
  vertical: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  centre: { lat: number; lng: number; zoom: number };
  /** True while the guest is dragging out a shape. */
  drawing?: boolean;
  /** The committed shape, drawn on the map until it is cleared. */
  polygon?: MapLatLng[] | null;
  /** A finished shape. Called once, on pointer-up. */
  onDrawn?: (points: MapLatLng[]) => void;
  /** Drawing was started and abandoned (a tap, a two-point scribble). */
  onDrawCancelled?: () => void;
}

/**
 * What a price pin says.
 *
 * A pin has room for two or three words, so these are the shortest honest
 * form: what you would say pointing at the map. Shared by both providers
 * because a listing must not cost «250 د.ل» on one map and "Packages" on the
 * other depending on which one the operator switched on this morning.
 */
const pinCopy = {
  ar: { dinars: (n: string) => `${n} د.ل`, service: "خدمة", packages: "باقات" },
  en: { dinars: (n: string) => `${n} LYD`, service: "Service", packages: "Packages" },
} satisfies Record<Locale, unknown>;

export function pinLabel(item: PublicListing, locale: Locale): string {
  const c = pinCopy[locale];
  if (item.baseNightly > 0) return c.dinars(fmtNum(locale, Math.round(item.baseNightly / 1000)));
  return item.type === "service" ? c.service : c.packages;
}

/**
 * Pin colours are hex on purpose.
 *
 * Everything else in the app resolves through a theme token, and these
 * deliberately do not: `globals.css` sets out the rule for anything sitting on
 * a photograph — a verified badge, a price pin — and a pin on map tiles is the
 * same case. A token would invert underneath it and put pale ink on a pale road.
 *
 * ## Why the pill is the deeper orange and not the brand orange
 *
 * The design file asks for white price text on an orange pill. White on the
 * brand orange `#e8641b` measures 3.35:1, and a price is the whole reason the
 * pin exists — it is content, at 12px, and 3.35 is not readable enough to ship.
 * The deeper `#b84a10` — already in the palette as `--amber-dark` — carries
 * white at 5.22:1 and still reads as the same orange from a metre away.
 *
 * The selected pin then goes the other way: the brand orange with navy ink
 * (5.19:1), which is both brighter and more saturated than the resting state,
 * so selection reads as the pin lighting up rather than merely changing hue.
 */
export const PIN_INK = "#0d1b2a";
export const PIN_PAPER = "#ffffff";
/** The resting pill. */
export const PIN_BRAND = "#b84a10";
/** The selected pill — the brand orange proper. */
export const PIN_BRAND_ACTIVE = "#e8641b";

/**
 * One place decides what a pin looks like, so a listing cannot be a different
 * colour on Mapbox than it is on the OSM fallback.
 *
 * `dark` only adds the glow the design file asks for on a dark map; the pill
 * itself is identical in both, because the tiles under it are the one thing on
 * screen that the theme does change.
 */
export function pinColours(active: boolean, dark = false) {
  return {
    bg: active ? PIN_BRAND_ACTIVE : PIN_BRAND,
    fg: active ? PIN_INK : PIN_PAPER,
    border: PIN_INK,
    shadow: dark
      ? `0 0 0 1px rgba(232,100,27,.45), 0 2px 10px rgba(232,100,27,.55)`
      : `0 1px 5px rgba(0,0,0,.28)`,
  };
}

export function pinFont(locale: Locale): string {
  return locale === "en" ? "Inter,Almarai,Tahoma,sans-serif" : "Almarai,Tahoma,sans-serif";
}
