/**
 * Who may see where a place is.
 *
 * This is the only module allowed to answer that question. It exists as one
 * function rather than a check repeated at each serializer because location
 * leakage is the failure mode that does not announce itself: a new endpoint
 * that returns the venue row and forgets one `if` looks perfectly fine in
 * review, in tests, and in production, right up until someone notices a
 * provider's home address in a JSON payload.
 *
 * Three policies, set per venue (see `venues.locationDisclosure`):
 *
 *   `area`   — no coordinates leave the server, ever, for anyone. The venue is
 *              described by its city and area and nothing finer. Chosen by
 *              providers who work from home.
 *   `staged` — §7.1: an approximate point publicly, the exact point and the
 *              written address once a deposit is held.
 *   `public` — an exact point for everyone. A salon or a hall that wants a
 *              shopfront on the map.
 *
 * Note that drawn-area search works under all three, because search matches on
 * the *approximate* point, which is stored for every venue and never returned
 * under `area`. Being findable and being locatable are different things, and
 * the distinction is what lets a woman working from home take bookings from
 * her neighbourhood without publishing her door.
 */

export type LocationDisclosure = "area" | "staged" | "public";

export function asDisclosure(value: string | null | undefined): LocationDisclosure {
  return value === "area" || value === "public" ? value : "staged";
}

/**
 * The default for a venue type.
 *
 * Services default to `area` — the safe answer for the common case, which a
 * provider can widen deliberately, rather than the exposing answer she has to
 * notice and turn off.
 */
export function defaultDisclosure(venueType: string): LocationDisclosure {
  return venueType === "service" ? "area" : "staged";
}

export interface GeoPoint {
  lat: string;
  lng: string;
}

export interface VenueLocationFields {
  type: string;
  locationDisclosure?: string | null;
  approxLat?: string | null;
  approxLng?: string | null;
  exactLat?: string | null;
  exactLng?: string | null;
  addressAr?: string | null;
}

export interface PublicLocation {
  /** Shown on the search map. Null when the venue is area-only. */
  approx: (GeoPoint & { radiusM: number }) | null;
  /** Only ever set for `public` venues pre-booking. */
  exact: GeoPoint | null;
  /** True when the map should show no pin at all, so the UI can say why. */
  areaOnly: boolean;
  disclosure: LocationDisclosure;
}

/** ~500m of fuzz on the published point (§7.1). */
export const APPROX_RADIUS_M = 500;

/** What an unauthenticated visitor, or a guest with no deposit, may see. */
export function publicLocation(venue: VenueLocationFields): PublicLocation {
  const disclosure = asDisclosure(venue.locationDisclosure ?? defaultDisclosure(venue.type));
  if (disclosure === "area") {
    return { approx: null, exact: null, areaOnly: true, disclosure };
  }
  const approx =
    venue.approxLat && venue.approxLng
      ? { lat: venue.approxLat, lng: venue.approxLng, radiusM: APPROX_RADIUS_M }
      : null;
  if (disclosure === "public") {
    const exact =
      venue.exactLat && venue.exactLng ? { lat: venue.exactLat, lng: venue.exactLng } : null;
    // The map draws whatever is in `approx`; a radius of 0 is how it knows to
    // put down a plain pin rather than a fuzz circle around one.
    return {
      approx: exact ? { ...exact, radiusM: 0 } : approx,
      exact,
      areaOnly: false,
      disclosure,
    };
  }
  return { approx, exact: null, areaOnly: false, disclosure };
}

export interface RevealedLocation {
  exact: GeoPoint | null;
  addressAr: string | null;
  /** Why there is no pin, when there isn't one — so the UI can explain. */
  withheldReason: "provider_choice" | "not_recorded" | null;
}

/**
 * What a guest with a paid deposit may see.
 *
 * `area` venues withhold even here, and that is the point: the provider said
 * her address is not something the platform hands out, and a deposit does not
 * overrule her. The booking screen tells the guest to expect her to share it
 * directly, which is what actually happens in this market anyway.
 */
export function revealedLocation(venue: VenueLocationFields): RevealedLocation {
  const disclosure = asDisclosure(venue.locationDisclosure ?? defaultDisclosure(venue.type));
  if (disclosure === "area") {
    return { exact: null, addressAr: null, withheldReason: "provider_choice" };
  }
  if (!venue.exactLat || !venue.exactLng) {
    return {
      exact: null,
      addressAr: venue.addressAr ?? null,
      withheldReason: venue.addressAr ? null : "not_recorded",
    };
  }
  return {
    exact: { lat: venue.exactLat, lng: venue.exactLng },
    addressAr: venue.addressAr ?? null,
    withheldReason: null,
  };
}

/**
 * A link that opens turn-by-turn navigation in whatever the guest already has.
 *
 * This is the highest-value half of "use Google Maps" and it costs nothing: no
 * API, no key, no per-load billing. It matters more here than it would
 * elsewhere because most istirahas have no street address at all — a pin is
 * not a convenience, it is the only way to find the gate. It goes in the
 * confirmation message and on the voucher, both of which are post-deposit, so
 * §7.1 is preserved without a special case.
 *
 * The label is passed through Google's `destination` as text alongside the
 * coordinates so the app shows a name rather than a bare pin.
 */
export function navigationUrl(point: GeoPoint): string {
  /*
   * Coordinates, never a name. Passing the venue's title as `destination`
   * would make Google geocode it — and an istiraha whose name is shared with
   * three others on the same coast road would send the guest to the wrong
   * gate, at night, with a car full of family. The pin is the whole point.
   */
  const params = new URLSearchParams({
    api: "1",
    destination: `${point.lat},${point.lng}`,
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * The same destination as a `geo:` URI.
 *
 * Google Maps is what nearly everyone in Libya uses, but "nearly" is doing
 * work: a guest whose phone has no Google services, or who prefers another
 * app, still needs to arrive. `geo:` is handled by every maps app on Android
 * and is the honest fallback. The voucher shows the raw coordinates too, for
 * the case that beats every link — reading them aloud down the phone to
 * someone who knows the road.
 */
export function geoUri(point: GeoPoint, label?: string): string {
  const base = `geo:${point.lat},${point.lng}`;
  return label ? `${base}?q=${point.lat},${point.lng}(${encodeURIComponent(label)})` : base;
}
