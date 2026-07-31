export interface PublicListing {
  id: string;
  slug: string;
  titleAr: string;
  titleEn?: string;
  descriptionAr?: string;
  type: "coast" | "hall";
  city: string;
  area?: string;
  approxLocation: { lat: string; lng: string; radiusM: number } | null;
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
  media: { url: string; kind: string; order: number }[];
  bookingTypes: string[];
  hostReliability?: number | null;
  rating?: number;
  ratingSource?: "ciao" | "guests";
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
  nights: { date: string; price: number }[];
  total: number;
  deposit: number;
  balanceOnArrival: number;
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
  listing?: { slug: string; titleAr: string; media: { url: string }[] };
  venue?: {
    nameAr: string;
    city: string;
    area?: string;
    addressAr?: string;
    exactLocation?: { lat: string; lng: string };
    hostPhone?: string;
  };
  timeline: { seq: number; to: string; actor: string; at: string }[];
}
