/**
 * Searching by an area you drew, instead of a city you picked from a list.
 *
 * Salem's example is the one that makes the case: "a makeup artist in the
 * southern part of Tripoli, near my parents' house". No dropdown of cities and
 * districts answers that, because the boundary that matters is the one in his
 * head — twenty minutes from a particular front door. Drawing it is the only
 * honest input.
 *
 * ## Why this is safe against the obvious attack
 *
 * The tempting worry is that a drawn shape becomes a way to triangulate an
 * exact location: draw a big polygon, see the listing; shrink it; repeat until
 * you have a ten-metre box around someone's house.
 *
 * It does not work here, because search matches against the **stored
 * approximate point** — the same ~500m-fuzzed coordinate we already publish on
 * the map. Narrowing a polygon converges on the fuzzed point, which was public
 * from the start, and tells you nothing about the real one. The fuzz is fixed
 * per venue and not re-rolled per request, which is what makes that true; a
 * per-request random offset would leak the centre to anyone who averaged
 * enough queries.
 *
 * Area-only venues (see location.ts) are searchable this way too, and still
 * return no coordinates. Being findable in a neighbourhood and being locatable
 * at a door are different things, and keeping them apart is the whole reason a
 * woman working from home can take bookings from her own area.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Libya, generously bounded — a cheap sanity check on anything inbound. */
const LIBYA = { south: 19.0, west: 9.0, north: 34.0, east: 26.0 };

export function isPlausibleLibyanPoint(p: LatLng): boolean {
  return (
    p.lat >= LIBYA.south && p.lat <= LIBYA.north && p.lng >= LIBYA.west && p.lng <= LIBYA.east
  );
}

/**
 * Parse `bbox=south,west,north,east`.
 *
 * Returns null rather than throwing on nonsense: a malformed bounding box in a
 * URL should quietly fall back to an unfiltered search, not 400 a guest out of
 * their results.
 */
export function parseBoundingBox(raw: string | undefined): BoundingBox | null {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [south, west, north, east] = parts as [number, number, number, number];
  if (south >= north || west >= east) return null;
  const box = { south, west, north, east };
  if (!isPlausibleLibyanPoint({ lat: south, lng: west })) return null;
  if (!isPlausibleLibyanPoint({ lat: north, lng: east })) return null;
  return box;
}

/**
 * Parse `poly=lat,lng;lat,lng;…` — the shape the guest actually drew.
 *
 * Capped at 60 vertices. A hand-drawn shape needs a dozen; anything much
 * larger is either a bug or someone probing, and the point-in-polygon test is
 * O(n) per candidate listing.
 */
export function parsePolygon(raw: string | undefined): LatLng[] | null {
  if (!raw) return null;
  const points: LatLng[] = [];
  for (const pair of raw.split(";").slice(0, 60)) {
    const [lat, lng] = pair.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const p = { lat: lat!, lng: lng! };
    if (!isPlausibleLibyanPoint(p)) return null;
    points.push(p);
  }
  return points.length >= 3 ? points : null;
}

/** The bounding box of a polygon — used to narrow in SQL before the exact test. */
export function polygonBounds(points: LatLng[]): BoundingBox {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    south: Math.min(...lats),
    west: Math.min(...lngs),
    north: Math.max(...lats),
    east: Math.max(...lngs),
  };
}

/**
 * Ray casting. Tripoli is at 32°N over a span of a few kilometres, so treating
 * lat/lng as a plane is accurate to well under the 500m fuzz already applied —
 * a spherical test would be more correct and less honest about its precision.
 */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const straddles = a.lat > point.lat !== b.lat > point.lat;
    if (!straddles) continue;
    const x = ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (point.lng < x) inside = !inside;
  }
  return inside;
}

export function pointInBox(point: LatLng, box: BoundingBox): boolean {
  return (
    point.lat >= box.south &&
    point.lat <= box.north &&
    point.lng >= box.west &&
    point.lng <= box.east
  );
}

/** Metres between two points — for "within N minutes' drive" style sorting. */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The area of a drawn shape, in square kilometres.
 *
 * Reported back to the guest ("you've drawn about 4 km²") rather than used to
 * refuse anything. A tiny shape is not an attack — it converges on a point we
 * already publish — it is just someone who will get no results, and telling
 * them why is better than silently returning an empty list.
 */
export function polygonAreaKm2(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const meanLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos((meanLat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    sum += (b.lng * kmPerDegLng) * (a.lat * kmPerDegLat) - (a.lng * kmPerDegLng) * (b.lat * kmPerDegLat);
  }
  return Math.abs(sum / 2);
}
