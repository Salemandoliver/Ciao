/**
 * The shapes the partner console reads.
 *
 * Kept in one file rather than declared per tab because several tabs render
 * the same job, and a job that has a `balanceDue` on one screen and not on
 * another is how a partner ends up believing one of the two screens.
 */

export type PartnerCapability = "diary" | "clients" | "money" | "settings" | "admin";
export type PartnerRole = "owner" | "manager" | "staff";

export interface PartnerListing {
  id: string;
  slug: string;
  titleAr: string;
  titleEn?: string | null;
  status: string;
  baseNightly: number;
  serviceCategory?: string | null;
  venueType: string;
  area?: string | null;
  city: string;
  verified: boolean;
}

export interface PartnerMe {
  partnerId: string;
  role: PartnerRole;
  capabilities: PartnerCapability[];
  profile: {
    kind: "venue" | "hall" | "service";
    businessNameAr: string | null;
    businessNameEn: string | null;
    workingDays: number[];
    workingHours: { from: string; to: string } | null;
    noticeHours: number;
    maxJobsPerDay: number;
    travelsToClient: boolean;
    travelFee: number;
    serviceAreas: string[];
    defaultDepositBps: number;
    agendaEnabled: boolean;
    agendaHour: number;
    onboardedAt: string | null;
  };
  listings: PartnerListing[];
  businesses: { partnerId: string; role: PartnerRole; nameAr: string | null; isSelf: boolean }[];
  plus: {
    enabled: boolean;
    active: boolean;
    plan: string;
    status: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    priceDirhams: number;
    trialDays: number;
  };
  directJobsEnabled: boolean;
}

export interface AgendaJob {
  id: string;
  titleAr: string;
  status: string;
  source: string;
  startTime: string | null;
  endTime: string | null;
  locationAr: string | null;
  notesAr: string | null;
  price: number;
  amountPaid: number;
  balanceDue: number;
  clientNameAr: string | null;
  clientPhone: string | null;
  bookingCode: string | null;
}

export interface Job {
  id: string;
  titleAr: string;
  day: string;
  endDay: string | null;
  session: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  source: string;
  kind: string;
  price: number;
  amountPaid: number;
  balanceDue: number;
  locationAr: string | null;
  notesAr: string | null;
  blocksCalendar: boolean;
  listingId: string | null;
  listingTitleAr: string | null;
  clientId: string | null;
  clientNameAr: string | null;
  clientPhone: string | null;
  bookingId: string | null;
  bookingCode: string | null;
  bookingState: string | null;
  /** Ciao bookings: dates and money are the booking's, not the diary's. */
  locked: boolean;
}

export interface CalendarDay {
  day: string;
  state: string;
  full: boolean;
  jobs: {
    id: string;
    titleAr: string;
    status: string;
    source: string;
    startTime: string | null;
    clientNameAr: string | null;
    bookingCode: string | null;
  }[];
}

export interface QuoteLine {
  labelAr: string;
  qty: number;
  unitPrice: number;
}

export interface Quote {
  id: string;
  code: string;
  titleAr: string;
  total: number;
  depositAmount: number;
  status: string;
  proposedDay: string | null;
  validUntil: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  sentAt: string | null;
  clientNameAr: string | null;
  clientPhone: string | null;
  lineItems: QuoteLine[];
  jobId: string | null;
}

export interface PartnerClient {
  id: string;
  nameAr: string;
  phone: string | null;
  notesAr: string | null;
  jobsCount: number;
  totalSpend: number;
  lastJobAt: string | null;
}

export interface MoneyView {
  earnings: {
    months: { month: string; ciao: number; direct: number; jobs: number }[];
    totalCiao: number;
    totalDirect: number;
    ciaoShareBps: number;
  };
  payouts: {
    queued: number;
    inFlight: number;
    paid: number;
    items: {
      id: string;
      amount: number;
      status: string;
      rail: string;
      releaseAfter: string;
      paidAt: string | null;
      bookingCode: string | null;
    }[];
  };
  receivables: {
    total: number;
    overdueTotal: number;
    items: {
      jobId: string;
      titleAr: string;
      day: string;
      source: string;
      due: number;
      clientNameAr: string | null;
      clientPhone: string | null;
      bookingCode: string | null;
      overdue: boolean;
    }[];
  };
  payoutAccounts: {
    id: string;
    rail: string;
    label: string | null;
    ref: string;
    status: string;
    activatesAt: string | null;
  }[];
  canChangePayoutAccount: boolean;
  payoutHoldHours: number;
}

export interface Insights {
  windowDays: number;
  plus: boolean;
  own: {
    jobs: { total: number; ciao: number; direct: number };
    earnings: {
      total: number;
      ciao: number;
      direct: number;
      collected: number;
      outstanding: number;
    };
    sourceMix: { source: string; jobs: number; value: number }[];
    monthly: { month: string; jobs: number; value: number }[];
    occupancyBps: number;
    openDays: number;
    busyDays: number;
    repeatClients: { repeat: number; total: number };
    funnel: { views: number; quotesViewed: number; requests: number; confirmed: number };
    reliability: { score: number; medianResponseMinutes: number; confirmationRateBps: number };
    quotes: { sent: number; accepted: number; acceptanceBps: number };
  };
  market?: {
    areaDemand: { searches: number; users: number; area: string | null; vertical: string };
    missedDemand: { searchesOnClosedDays: number; closedDays: number; sampleDays: number };
    pricePosition: {
      available: boolean;
      peers: number;
      p25: number;
      p50: number;
      p75: number;
      yours: number;
      positionBps: number | null;
      suppressedReason?: string;
    };
    leadTime: { bucket: string; count: number }[];
    seasonality: { month: string; index: number }[];
    conversion: { yoursBps: number; medianBps: number; available: boolean; peers: number };
  };
  actions: { key: string; ar: string; en: string; plus: boolean }[];
}

/**
 * The Facebook kit.
 *
 * A venue here is the property as the marketplace knows it, not a listing: the
 * link a partner pins to their page points at the whole place, because that is
 * what their followers know the name of. `storefrontPath` is null until ops has
 * assigned a slug, and the screen has to say so rather than build a URL that
 * 404s in front of forty-four thousand people.
 */
export interface StorefrontVenue {
  id: string;
  slug: string | null;
  nameAr: string;
  nameEn: string | null;
  type: string;
  city: string;
  /** `/v/<slug>` — or null, meaning "not ready to be published yet". */
  storefrontPath: string | null;
}

export interface PartnerOffer {
  id: string;
  code: string;
  venueId: string;
  kind: string;
  /** Percent off in basis points: 1000 is 10%. */
  value: number;
  descriptionAr: string | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  timesUsed: number;
  active: boolean;
  /**
   * Active, started, and not yet expired — decided by the API against the
   * server clock. A phone with the wrong date must not be able to make a dead
   * offer look live in a post the partner is about to publish.
   */
  live: boolean;
}

export interface Storefront {
  webBaseUrl: string;
  venues: StorefrontVenue[];
  offers: PartnerOffer[];
  /** Counts and money per channel tag. Never a list of who visited. */
  attribution: { venueId: string; source: string; bookings: number; value: number }[];
}

export interface TeamMember {
  id: string;
  role: PartnerRole;
  disabledAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  memberUserId: string;
  name: string | null;
  phone: string;
}
