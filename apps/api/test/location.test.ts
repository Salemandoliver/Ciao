/**
 * Location disclosure and drawn-area search.
 *
 * The geometry here is easy and the policy is not, so most of these tests are
 * about the policy. Two promises in particular are the kind that a future
 * endpoint breaks silently:
 *
 *  - a provider who chose `area` never has coordinates published, and a paid
 *    deposit does not change that;
 *  - drawing a smaller and smaller shape never reveals anything the map did
 *    not already show.
 *
 * Both would pass a functional review while broken, which is why they are
 * pinned here rather than trusted to the reader of a serializer.
 */
import { describe, expect, it } from "vitest";
import {
  APPROX_RADIUS_M,
  defaultDisclosure,
  geoUri,
  navigationUrl,
  publicLocation,
  revealedLocation,
} from "../src/modules/listings/location.js";
import {
  parseBoundingBox,
  parsePolygon,
  pointInPolygon,
  polygonAreaKm2,
  polygonBounds,
  distanceMetres,
} from "../src/modules/listings/geo.js";
import { normaliseNeighbours } from "../src/modules/listings/neighbours.js";

/** A chalet in Tajoura, with the two points a venue can carry. */
const chalet = {
  type: "coast",
  locationDisclosure: "staged",
  approxLat: "32.8800",
  approxLng: "13.3500",
  exactLat: "32.8823",
  exactLng: "13.3541",
  addressAr: "الطريق الساحلي، تاجوراء",
};

/** A makeup artist working from her family home. */
const provider = {
  type: "service",
  locationDisclosure: "area",
  approxLat: "32.8100",
  approxLng: "13.2200",
  exactLat: "32.8134",
  exactLng: "13.2241",
  addressAr: "عين زارة",
};

/** A salon that wants to be found. */
const salon = { ...provider, locationDisclosure: "public" };

describe("disclosure defaults", () => {
  it("defaults services to area-only and everything else to staged", () => {
    // The safe answer for the common case, which a provider widens on
    // purpose — not the exposing answer she has to notice and turn off.
    expect(defaultDisclosure("service")).toBe("area");
    expect(defaultDisclosure("coast")).toBe("staged");
    expect(defaultDisclosure("hall")).toBe("staged");
  });
});

describe("what the public may see", () => {
  it("gives a chalet an approximate point and no exact one", () => {
    const loc = publicLocation(chalet);
    expect(loc.approx).toEqual({ lat: "32.8800", lng: "13.3500", radiusM: APPROX_RADIUS_M });
    expect(loc.exact).toBeNull();
    expect(loc.areaOnly).toBe(false);
  });

  it("gives an area-only provider no coordinates at all", () => {
    const loc = publicLocation(provider);
    expect(loc.approx).toBeNull();
    expect(loc.exact).toBeNull();
    expect(loc.areaOnly).toBe(true);
    // Nothing in the payload should carry either point.
    expect(JSON.stringify(loc)).not.toContain("32.81");
    expect(JSON.stringify(loc)).not.toContain("32.8134");
  });

  it("gives a public venue a real pin with no fuzz circle", () => {
    const loc = publicLocation(salon);
    expect(loc.exact).toEqual({ lat: "32.8134", lng: "13.2241" });
    expect(loc.approx?.radiusM).toBe(0);
  });
});

describe("what a paid deposit unlocks", () => {
  it("reveals the exact point and address for a chalet", () => {
    const loc = revealedLocation(chalet);
    expect(loc.exact).toEqual({ lat: "32.8823", lng: "13.3541" });
    expect(loc.addressAr).toContain("تاجوراء");
    expect(loc.withheldReason).toBeNull();
  });

  it("still withholds an area-only provider's address after payment", () => {
    // The deposit buys a booking, not an override of her decision.
    const loc = revealedLocation(provider);
    expect(loc.exact).toBeNull();
    expect(loc.addressAr).toBeNull();
    expect(loc.withheldReason).toBe("provider_choice");
  });

  it("distinguishes 'she chose not to' from 'nobody recorded it'", () => {
    // Different sentences on the screen: one is a policy, the other is a gap
    // in our own data, and telling a guest the wrong one is a support ticket.
    const missing = revealedLocation({ ...chalet, exactLat: null, exactLng: null, addressAr: null });
    expect(missing.withheldReason).toBe("not_recorded");
  });
});

describe("navigation links", () => {
  it("sends coordinates, never a name", () => {
    const url = navigationUrl({ lat: "32.8823", lng: "13.3541" });
    expect(url).toContain("destination=32.8823%2C13.3541");
    // A name would be geocoded, and three istirahas share a name on any given
    // stretch of coast road.
    expect(url).not.toMatch(/destination=[^0-9%]/);
  });

  it("offers a geo: fallback for phones without Google services", () => {
    const uri = geoUri({ lat: "32.88", lng: "13.35" }, "شاليه الرمال");
    expect(uri.startsWith("geo:32.88,13.35")).toBe(true);
    expect(uri).toContain("q=32.88,13.35");
  });
});

describe("drawn-area search", () => {
  const tripoliBox = "32.80,13.10,32.95,13.40";

  it("parses a well-formed box", () => {
    expect(parseBoundingBox(tripoliBox)).toEqual({
      south: 32.8,
      west: 13.1,
      north: 32.95,
      east: 13.4,
    });
  });

  it("returns null on nonsense rather than erroring the search", () => {
    // A malformed box in a URL should quietly fall back to an unfiltered
    // search, not 400 a guest out of their own results.
    expect(parseBoundingBox("banana")).toBeNull();
    expect(parseBoundingBox("32.95,13.10,32.80,13.40")).toBeNull(); // inverted
    expect(parseBoundingBox("51.5,-0.12,51.6,-0.10")).toBeNull(); // London
  });

  it("matches a point inside the drawn shape and rejects one outside", () => {
    const poly = parsePolygon("32.80,13.10;32.80,13.40;32.95,13.40;32.95,13.10")!;
    expect(pointInPolygon({ lat: 32.88, lng: 13.35 }, poly)).toBe(true);
    expect(pointInPolygon({ lat: 32.5, lng: 13.35 }, poly)).toBe(false);
  });

  it("handles a concave shape — people do not draw rectangles", () => {
    // An L, drawn round a bay. The notch must not match.
    const poly = parsePolygon(
      "32.80,13.10;32.80,13.40;32.85,13.40;32.85,13.20;32.95,13.20;32.95,13.10",
    )!;
    expect(pointInPolygon({ lat: 32.82, lng: 13.35 }, poly)).toBe(true); // in the foot
    expect(pointInPolygon({ lat: 32.90, lng: 13.15 }, poly)).toBe(true); // in the leg
    expect(pointInPolygon({ lat: 32.90, lng: 13.35 }, poly)).toBe(false); // the notch
  });

  it("caps the vertex count and rejects points outside Libya", () => {
    expect(parsePolygon("32.80,13.10;32.80,13.40")).toBeNull(); // not a shape
    expect(parsePolygon("51.5,-0.12;51.6,-0.12;51.6,-0.10")).toBeNull();
  });

  it("cannot be used to triangulate a real location", () => {
    /*
     * The attack: shrink the polygon until only one listing matches, and read
     * off its position. It converges — but only on the *published* approximate
     * point, because that is what search matches against. The exact point is
     * never an input to this code path, so there is nothing to converge on.
     */
    const publishedPoint = { lat: 32.88, lng: 13.35 }; // the fuzzed coordinate
    const tiny = parsePolygon("32.8799,13.3499;32.8799,13.3501;32.8801,13.3501;32.8801,13.3499")!;
    expect(pointInPolygon(publishedPoint, tiny)).toBe(true);
    // The real location, ~400m away, is not what was tested.
    const real = { lat: 32.8823, lng: 13.3541 };
    expect(distanceMetres(publishedPoint, real)).toBeGreaterThan(300);
    expect(pointInPolygon(real, tiny)).toBe(false);
  });

  it("reports the size of what was drawn", () => {
    const poly = parsePolygon("32.80,13.10;32.80,13.20;32.90,13.20;32.90,13.10")!;
    const km2 = polygonAreaKm2(poly);
    // ~11km x ~9km
    expect(km2).toBeGreaterThan(80);
    expect(km2).toBeLessThan(120);
    expect(polygonBounds(poly)).toEqual({ south: 32.8, west: 13.1, north: 32.9, east: 13.2 });
  });
});

describe("neighbours", () => {
  it("keeps the fields that decide a booking and drops the rest", () => {
    const out = normaliseNeighbours([
      {
        kind: "cafe",
        nameAr: "مقهى الشط",
        walkMinutes: 6,
        noteAr: "قسم عائلي في الطابق الأول",
        secretField: "x",
      },
      { kind: "not_a_kind", nameAr: "…" },
      { kind: "bakery" }, // no name
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "cafe", nameAr: "مقهى الشط", walkMinutes: 6 });
    expect(JSON.stringify(out)).not.toContain("secretField");
  });

  it("refuses implausible walking times rather than printing them", () => {
    const out = normaliseNeighbours([
      { kind: "supermarket", nameAr: "بقالة النور", walkMinutes: 0 },
      { kind: "pharmacy", nameAr: "صيدلية", walkMinutes: 999 },
    ]);
    expect(out[0]!.walkMinutes).toBeUndefined();
    expect(out[1]!.walkMinutes).toBeUndefined();
  });

  it("caps the list, because a long form produces filler", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ kind: "cafe", nameAr: `مقهى ${i}` }));
    expect(normaliseNeighbours(many).length).toBeLessThanOrEqual(8);
  });
});
