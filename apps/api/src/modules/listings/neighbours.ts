/**
 * What's around a place — recorded by our own agent, not bought from an API.
 *
 * This is the answer to "show the customer there's a supermarket nearby, a
 * nice coffee shop". The obvious build is a Places API call per listing view.
 * It was rejected on three grounds, in ascending order of importance:
 *
 *  1. Cost. $32 per thousand Nearby Search calls, and Google's terms forbid
 *     caching the content, so it is a permanent per-view bill that grows with
 *     traffic. At modest volume that is a few hundred dollars a month for a
 *     pre-revenue marketplace.
 *  2. Sameness. A generic POI list is available to every competitor at the
 *     same price. It differentiates nothing.
 *  3. It answers the wrong question. A family choosing an istiraha does not
 *     want to know that a café exists 400 metres away; they want to know
 *     whether they can sit in it — whether it has a family section, whether
 *     the bakery is open early on Eid, whether the supermarket still trades
 *     when the power is out. Those are the facts that decide a booking here,
 *     and no map API has them.
 *
 * Our agent is already standing at the property for the verification visit.
 * Four to six honest lines cost nothing and are worth more.
 */

/**
 * Deliberately a short list. A long one produces a long form, a long form
 * produces a bored agent, and a bored agent produces filler.
 */
export const NEIGHBOUR_KINDS = [
  "supermarket",
  "bakery",
  "cafe",
  "restaurant",
  "pharmacy",
  "clinic",
  "mosque",
  "petrol",
  "atm",
  "beach_access",
  "playground",
] as const;

export type NeighbourKind = (typeof NEIGHBOUR_KINDS)[number];

export interface NeighbourRecord {
  kind: NeighbourKind;
  nameAr: string;
  nameEn?: string;
  /** Minutes on foot. Omitted when it is not realistically walkable. */
  walkMinutes?: number;
  /** Minutes by car, for the ones you would drive to. */
  driveMinutes?: number;
  /**
   * The line that earns its place. "قسم عائلي في الطابق الأول" is worth more
   * than the café's name; "يفتح ٦ صباحًا حتى في العيد" is worth more than a
   * distance. Everything else here is available from a map.
   */
  noteAr?: string;
  noteEn?: string;
  /**
   * Optional pin. Recorded when the agent drops one, so the guest can open it
   * for directions — but the neighbour list stands on its own without it, and
   * an `area`-only venue can still list its neighbours safely because these
   * are public businesses, not the provider's home.
   */
  lat?: string;
  lng?: string;
}

const MAX_NEIGHBOURS = 8;

export function normaliseNeighbours(input: unknown): NeighbourRecord[] {
  if (!Array.isArray(input)) return [];
  const out: NeighbourRecord[] = [];
  for (const raw of input.slice(0, MAX_NEIGHBOURS)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (!(NEIGHBOUR_KINDS as readonly unknown[]).includes(r.kind)) continue;
    const nameAr = typeof r.nameAr === "string" ? r.nameAr.trim().slice(0, 80) : "";
    if (!nameAr) continue;
    const minutes = (v: unknown) => {
      const n = Math.trunc(Number(v));
      return Number.isFinite(n) && n > 0 && n <= 120 ? n : undefined;
    };
    const text = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim().slice(0, 160) : undefined;
    const coord = (v: unknown) =>
      typeof v === "string" && /^-?\d{1,3}(\.\d+)?$/.test(v) ? v : undefined;
    out.push({
      kind: r.kind as NeighbourKind,
      nameAr,
      nameEn: text(r.nameEn),
      walkMinutes: minutes(r.walkMinutes),
      driveMinutes: minutes(r.driveMinutes),
      noteAr: text(r.noteAr),
      noteEn: text(r.noteEn),
      lat: coord(r.lat),
      lng: coord(r.lng),
    });
  }
  return out;
}
