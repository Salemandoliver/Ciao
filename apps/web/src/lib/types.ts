/**
 * Something our agent noted standing outside the property (§8.10).
 *
 * Not a Places API result and not shaped like one: the note is the payload and
 * everything else is context for it. `lat`/`lng` are present only when the
 * agent walked over and dropped a pin, and they are safe to publish even for
 * an area-only venue — a bakery on the main road is a public business, not the
 * provider's front door.
 */
export interface NeighbourRecord {
  kind: string;
  nameAr: string;
  nameEn?: string;
  walkMinutes?: number;
  driveMinutes?: number;
  noteAr?: string;
  noteEn?: string;
  lat?: string;
  lng?: string;
}

export interface PublicListing {
  id: string;
  /** How many guests the nightly rate covers — not the capacity. */
  includedGuests?: number | null;
  extraGuestFee?: number | null;
  extraBedPrice?: number | null;
  minNights?: number | null;
  boardBasis?: string | null;
  childPolicy?: { freeUnder: number; reducedUnder: number; reducedBps: number } | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  unitKind?: string | null;
  bathrooms?: number | null;
  /** Conditions of entry the guest must satisfy at the gate. */
  requirements?: { key: string; mustAcknowledge?: boolean; detailAr?: string; detailEn?: string }[];
  houseRulesEn?: string | null;
  venueId?: string;
  venueSlug?: string | null;
  venueNameAr?: string;
  venueNameEn?: string | null;
  officeHours?: { from: string; to: string } | null;
  slug: string;
  titleAr: string;
  titleEn?: string;
  descriptionAr?: string;
  descriptionEn?: string;
  type: "coast" | "hall" | "service";
  city: string;
  area?: string;
  /*
   * §7.1, decided server-side by `location.ts` — never re-derived here.
   * `approxLocation` is the ~500m-fuzzed point the map may draw; a radius of 0
   * means the venue publishes an exact shopfront and wants a plain pin.
   * `locationAreaOnly` is a provider who works from home: she appears in
   * results and in a drawn-area search, and she gets no pin.
   */
  approxLocation: { lat: string; lng: string; radiusM: number } | null;
  exactLocation?: { lat: string; lng: string } | null;
  locationAreaOnly?: boolean;
  neighbours?: NeighbourRecord[];
  verified: boolean;
  verifiedAt?: string;
  amenities: {
    key: string;
    present: boolean;
    condition?: string;
    detail?: string;
    verifiedAt?: string;
  }[];
  privacy?: { score: number; walledPool: boolean; overlooked: boolean } | null;
  capacityWomens?: number | null;
  baseNightly: number;
  dayUsePrice?: number | null;
  maxGuests?: number | null;
  bedrooms?: number | null;
  familyOnly: boolean;
  cancellationTier: "flexible" | "moderate" | "strict";
  /**
   * The host's own catalogue, present on the detail response only.
   *
   * Absent from search and map payloads on purpose: a results page carrying
   * every add-on of every listing is a payload nobody asked for on a 3G
   * connection, which is the connection this app is designed against (§12.3).
   */
  catalogue?: {
    addons: {
      id: string;
      serviceId: string | null;
      nameAr: string;
      nameEn: string | null;
      descriptionAr: string | null;
      price: number;
      priceModel: string;
      maxQty: number;
      required: boolean;
    }[];
    offers: {
      id: string;
      labelAr: string;
      labelEn: string | null;
      kind: string;
      valueBps: number;
      valueFlat: number;
      code: string | null;
      minSpend: number;
      travelFromDay: string | null;
      travelToDay: string | null;
    }[];
    questions?: {
      id: string;
      promptAr: string;
      promptEn: string | null;
      helpAr: string | null;
      fieldType: string;
      options: { valueAr: string }[];
      required: boolean;
    }[];
  } | null;
  media: { url: string; thumbUrl?: string; kind: string; order: number }[];
  bookingTypes: string[];
  hostReliability?: number | null;
  rating?: number;
  ratingSource?: "ciao" | "guests";
  serviceCategory?: string | null;
  houseRulesAr?: string | null;
  dimensionAverages?: Record<string, number> | null;
  ratingHistogram?: Record<string, number> | null;
  similar?: {
    id: string;
    slug: string;
    titleAr: string;
    titleEn?: string;
    area?: string;
    baseNightly: number;
    media: { url: string; thumbUrl?: string; kind: string; order?: number }[];
    verified?: boolean;
    serviceCategory?: string | null;
  }[];
  packages?: HallPackage[];
  reviews?: { scores: Record<string, number>; text?: string; hostReply?: string }[];
  aggregateScore?: number | null;
  reviewCount?: number;
}

export interface HallPackage {
  id: string;
  nameAr: string;
  totalPrice: number;
  guestCountMax?: number;
  lineItems: {
    key: string;
    labelAr: string;
    included: boolean;
    detailAr?: string;
    extraPrice?: number;
  }[];
}

export interface Quote {
  nights: { date: string; price: number; room?: number; guests?: number; beds?: number; offerAr?: string; offerEn?: string }[];
  total: number;
  roomTotal?: number;
  guestTotal?: number;
  bedTotal?: number;
  deposit: number;
  /** True when the operator's ceiling trimmed the percentage deposit. */
  depositCapped?: boolean;
  balanceOnArrival: number;
  requiredMinNights?: number;
  party?: {
    adults: number;
    childrenFree: number;
    childrenReduced: number;
    childrenFull: number;
    chargedGuests: number;
    includedGuests: number;
  };
  board?: string;
}

export interface BookingDetail {
  id: string;
  code: string;
  state: string;
  type: string;
  checkIn?: string;
  checkOut?: string;
  totalAmount: number;
  depositAmount: number;
  balanceOnArrival: number;
  cancellationTier: string;
  confirmationDeadline?: string;
  listing?: { slug: string; titleAr: string; titleEn?: string; media: { url: string; thumbUrl?: string }[] };
  venue?: {
    nameAr: string;
    city: string;
    area?: string;
    /*
     * Everything from `addressAr` down is post-deposit only (§6.1 step 5) and
     * arrives already filtered by the venue's disclosure setting.
     * `locationWithheldReason` says why there is no pin when there isn't one,
     * so the voucher can explain rather than show an empty space:
     *   `provider_choice` — she shares her location herself, by design
     *   `not_recorded`    — we simply have not walked to this gate yet
     */
    addressAr?: string | null;
    exactLocation?: { lat: string; lng: string } | null;
    navigationUrl?: string | null;
    geoUri?: string | null;
    locationWithheldReason?: "provider_choice" | "not_recorded" | null;
    hostPhone?: string;
  };
  timeline: { seq: number; to: string; actor: string; at: string }[];
}

/**
 * The right encoding of a photograph for the size it is about to be drawn at.
 *
 * Uploaded photographs are stored twice — a wide one for the gallery and a
 * narrow one for everything else. Search results, cards, wishlists and the
 * unit picker all draw images a few hundred pixels across, and handing them
 * the 1600px file wastes roughly ninety percent of the bytes on pixels the
 * screen cannot show. On a Libyan mobile connection a twelve-card search page
 * is the difference between 200KB and 2.4MB, which is the difference between a
 * product that feels fast and one people stop opening.
 *
 * Photographs added before uploads existed have only the one size, so the
 * fallback is not an edge case — it is most of the catalogue today.
 */
export function thumb(m: { url: string; thumbUrl?: string } | undefined): string {
  return m?.thumbUrl ?? m?.url ?? "";
}
