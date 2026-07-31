/**
 * PostgreSQL schema v1 — design doc §13.2.
 * All money in integer dirhams (LYD minor units, 1 LYD = 1000 dirhams).
 * All timestamps UTC (timestamptz); Africa/Tripoli is a display concern.
 */
import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  bigint,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const money = (name: string) => bigint(name, { mode: "number" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const now = () => ts("created_at").notNull().defaultNow();

// ---------------------------------------------------------------- users
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: varchar("phone", { length: 20 }).notNull(), // E.164, phone-first identity
    role: varchar("role", { length: 10 }).notNull().default("guest"), // guest|host|agent|ops|admin
    displayName: text("display_name"),
    // §11.5: female guests default to initials publicly
    publicName: text("public_name"),
    locale: varchar("locale", { length: 5 }).notNull().default("ar"),
    email: text("email"),
    // no-show history gates privileges (§11.5)
    noShowCount: integer("no_show_count").notNull().default(0),
    completedStays: integer("completed_stays").notNull().default(0),
    creditBalance: money("credit_balance").notNull().default(0), // platform credit ledger cache
    idDocumentRef: text("id_document_ref"), // encrypted storage ref; Exchange sellers only
    disabled: boolean("disabled").notNull().default(false),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_phone_uq").on(t.phone)],
);

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: varchar("phone", { length: 20 }).notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    channel: varchar("channel", { length: 10 }).notNull().default("sms"), // sms|whatsapp
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: now(),
  },
  (t) => [index("otp_phone_idx").on(t.phone, t.createdAt)],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    rotatedAt: ts("rotated_at"),
    revokedAt: ts("revoked_at"),
    createdAt: now(),
  },
  (t) => [index("refresh_user_idx").on(t.userId)],
);

/** Single-use signed action tokens (§13.3) — journal of consumption for replay protection. */
export const actionTokens = pgTable(
  "action_tokens",
  {
    jti: uuid("jti").primaryKey(),
    scope: text("scope").notNull(), // e.g. host_confirm:bookingId
    userId: uuid("user_id").references(() => users.id),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: now(),
  },
);

// ---------------------------------------------------------------- venues & listings
export const venues = pgTable(
  "venues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: varchar("type", { length: 8 }).notNull(), // coast|hall
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    city: varchar("city", { length: 40 }).notNull(), // tripoli|misrata|benghazi...
    area: varchar("area", { length: 60 }), // janzour, tajoura, airport_road...
    hostId: uuid("host_id").references(() => users.id),
    // §7.1 anti-leakage: approx geo public, exact geo revealed post-deposit
    approxLat: text("approx_lat"),
    approxLng: text("approx_lng"),
    exactLat: text("exact_lat"),
    exactLng: text("exact_lng"),
    addressAr: text("address_ar"), // revealed post-deposit
    verificationGrade: varchar("verification_grade", { length: 30 })
      .notNull()
      .default("unverified"), // deed|utility_bill_attestation|local_attestation|unverified
    verifiedAt: ts("verified_at"),
    verificationExpiresAt: ts("verification_expires_at"),
    badgeRevoked: boolean("badge_revoked").notNull().default(false),
    amenities: jsonb("amenities").notNull().default(sql`'[]'::jsonb`), // AmenityRecord[]
    privacy: jsonb("privacy"), // PrivacyAssessment
    // hall-specific capacity truth
    capacityWomens: integer("capacity_womens"),
    capacityMens: integer("capacity_mens"),
    foundingHost: boolean("founding_host").notNull().default(false), // §16.2 promo flag
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("venues_city_type_idx").on(t.city, t.type)],
);

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id").notNull().references(() => venues.id),
    slug: varchar("slug", { length: 80 }).notNull(),
    status: varchar("status", { length: 12 }).notNull().default("draft"), // draft|live|paused|delisted
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en"),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    bookingTypes: jsonb("booking_types").notNull().default(sql`'["stay"]'::jsonb`),
    // pricing config (§9.6) — dirhams + bps multipliers
    baseNightly: money("base_nightly").notNull().default(0),
    weekendMultiplierBps: integer("weekend_multiplier_bps").notNull().default(12500),
    thursdayMultiplierBps: integer("thursday_multiplier_bps").notNull().default(11500),
    seasonMultiplierBps: integer("season_multiplier_bps").notNull().default(10000),
    dayUsePrice: money("day_use_price"),
    extraGuestFee: money("extra_guest_fee"),
    maxGuests: integer("max_guests"),
    bedrooms: integer("bedrooms"),
    cancellationTier: varchar("cancellation_tier", { length: 10 })
      .notNull()
      .default("moderate"), // flexible|moderate|strict
    houseRulesAr: text("house_rules_ar"),
    media: jsonb("media").notNull().default(sql`'[]'::jsonb`), // [{url, kind, order, watermark}]
    familyOnly: boolean("family_only").notNull().default(false),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("listings_slug_uq").on(t.slug),
    index("listings_venue_idx").on(t.venueId),
    index("listings_status_idx").on(t.status),
  ],
);

/** Hall package line-items (§8.5, §13.2). */
export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id").notNull().references(() => listings.id),
    nameAr: text("name_ar").notNull(),
    // standardised comparable rows — [{key, labelAr, included, detailAr, extraPrice}]
    lineItems: jsonb("line_items").notNull().default(sql`'[]'::jsonb`),
    totalPrice: money("total_price").notNull(),
    guestCountMax: integer("guest_count_max"),
    active: boolean("active").notNull().default(true),
    createdAt: now(),
  },
  (t) => [index("packages_listing_idx").on(t.listingId)],
);

/**
 * Calendar — one row per (listing, date, session). §13.2
 * state: open|blocked|booked|held. Held rows carry the booking that holds them.
 */
export const calendarDays = pgTable(
  "calendar_days",
  {
    listingId: uuid("listing_id").notNull().references(() => listings.id),
    day: date("day", { mode: "string" }).notNull(),
    session: varchar("session", { length: 16 }).notNull().default("night"),
    state: varchar("state", { length: 8 }).notNull().default("open"),
    priceOverride: money("price_override"),
    bookingId: uuid("booking_id"),
    holdExpiresAt: ts("hold_expires_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.listingId, t.day, t.session] }),
    index("calendar_booking_idx").on(t.bookingId),
  ],
);

// ---------------------------------------------------------------- bookings
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 12 }).notNull(), // human/WhatsApp-friendly
    listingId: uuid("listing_id").notNull().references(() => listings.id),
    venueId: uuid("venue_id").notNull().references(() => venues.id),
    guestId: uuid("guest_id").notNull().references(() => users.id),
    hostId: uuid("host_id").references(() => users.id),
    type: varchar("type", { length: 12 }).notNull(), // stay|day_use|event_date|visit
    state: varchar("state", { length: 24 }).notNull().default("draft"),
    checkIn: date("check_in", { mode: "string" }),
    checkOut: date("check_out", { mode: "string" }),
    session: varchar("session", { length: 16 }).notNull().default("night"),
    packageId: uuid("package_id").references(() => packages.id),
    guestCount: integer("guest_count"),
    // money snapshot (dirhams) — frozen at request time; booked dates are price-locked (§9.6)
    totalAmount: money("total_amount").notNull().default(0),
    depositAmount: money("deposit_amount").notNull().default(0),
    balanceOnArrival: money("balance_on_arrival").notNull().default(0),
    commissionAmount: money("commission_amount").notNull().default(0),
    cancellationTier: varchar("cancellation_tier", { length: 10 })
      .notNull()
      .default("moderate"),
    confirmationDeadline: ts("confirmation_deadline"),
    contactRevealed: boolean("contact_revealed").notNull().default(false),
    voucherIssuedAt: ts("voucher_issued_at"),
    checkedInAt: ts("checked_in_at"),
    completedAt: ts("completed_at"),
    cancelledAt: ts("cancelled_at"),
    concierge: boolean("concierge").notNull().default(false), // Phase A manual bookings
    notes: text("notes"),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bookings_code_uq").on(t.code),
    index("bookings_guest_idx").on(t.guestId),
    index("bookings_host_idx").on(t.hostId),
    index("bookings_state_idx").on(t.state),
    index("bookings_listing_dates_idx").on(t.listingId, t.checkIn),
  ],
);

/** Event-sourced journal per booking (§9.3). */
export const bookingEvents = pgTable(
  "booking_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    seq: integer("seq").notNull(),
    fromState: varchar("from_state", { length: 24 }),
    toState: varchar("to_state", { length: 24 }).notNull(),
    actor: varchar("actor", { length: 12 }).notNull(), // guest|host|ops|system
    actorId: uuid("actor_id"),
    reason: text("reason"),
    payload: jsonb("payload"),
    idempotencyKey: text("idempotency_key"),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("booking_events_seq_uq").on(t.bookingId, t.seq),
    uniqueIndex("booking_events_idem_uq").on(t.bookingId, t.idempotencyKey),
  ],
);

// ---------------------------------------------------------------- payments & ledger
export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    purpose: varchar("purpose", { length: 20 }).notNull().default("deposit"), // deposit|stage|exchange|other
    amount: money("amount").notNull(),
    rail: varchar("rail", { length: 12 }).notNull(), // sadad|adfali|local_card|tlync|mpgs|credit
    provider: varchar("provider", { length: 12 }).notNull(), // plutu|dpay|tlync|mock
    providerRef: text("provider_ref"), // gateway invoice/transaction id
    invoiceNo: varchar("invoice_no", { length: 40 }).notNull(), // unique per attempt (§10.2)
    status: varchar("status", { length: 16 }).notNull().default("created"),
    // created|pending|held|captured|failed|expired|refunded
    failureCode: text("failure_code"),
    expiresAt: ts("expires_at"),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pi_invoice_uq").on(t.invoiceNo),
    index("pi_booking_idx").on(t.bookingId),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intentId: uuid("intent_id").notNull().references(() => paymentIntents.id),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    amount: money("amount").notNull(),
    rail: varchar("rail", { length: 12 }).notNull(),
    provider: varchar("provider", { length: 12 }).notNull(),
    providerRef: text("provider_ref"),
    capturedAt: ts("captured_at").notNull().defaultNow(),
  },
  (t) => [index("payments_booking_idx").on(t.bookingId)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    paymentId: uuid("payment_id").references(() => payments.id),
    amount: money("amount").notNull(),
    method: varchar("method", { length: 16 }).notNull(), // credit|rail_refund|bank_transfer
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    // pending|completed|failed
    bonusCredit: money("bonus_credit").notNull().default(0), // §10.6 +5% credit incentive
    slaDueAt: ts("sla_due_at"),
    completedAt: ts("completed_at"),
    createdAt: now(),
  },
  (t) => [index("refunds_booking_idx").on(t.bookingId)],
);

export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id").notNull().references(() => users.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    amount: money("amount").notNull(),
    rail: varchar("rail", { length: 12 }).notNull().default("bank_app"),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    // queued|released|paid|held
    releaseAfter: ts("release_after").notNull(), // T+1 after check-in; T+3 for card-funded (§10.7)
    paidAt: ts("paid_at"),
    createdAt: now(),
  },
  (t) => [index("payouts_host_idx").on(t.hostId), index("payouts_status_idx").on(t.status)],
);

/**
 * Double-entry ledger (§10.4). Every money movement writes balanced journal pairs.
 * Accounts: guest_deposits_held, host_payables, platform_revenue, refund_reserve,
 * rail_settlement_pending:<provider>, guest_credit:<userId>
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    txId: uuid("tx_id").notNull(), // groups the balanced pair/set
    account: text("account").notNull(),
    bookingId: uuid("booking_id"),
    debit: money("debit").notNull().default(0),
    credit: money("credit").notNull().default(0),
    memo: text("memo"),
    createdAt: now(),
  },
  (t) => [index("ledger_tx_idx").on(t.txId), index("ledger_account_idx").on(t.account)],
);

/** Webhook inbox — journal-first processing with replay protection (§13.4). */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 12 }).notNull(),
    externalId: text("external_id").notNull(), // provider event id / signature hash
    payload: jsonb("payload").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    processedAt: ts("processed_at"),
    error: text("error"),
    createdAt: now(),
  },
  (t) => [uniqueIndex("webhook_ext_uq").on(t.provider, t.externalId)],
);

/** Rail health (§10.8). */
export const railHealth = pgTable("rail_health", {
  rail: varchar("rail", { length: 12 }).primaryKey(),
  healthy: boolean("healthy").notNull().default(true),
  lastCheckAt: ts("last_check_at").notNull().defaultNow(),
  lastFailureAt: ts("last_failure_at"),
  note: text("note"),
});

/** Logged-cash receipts (§10.6) — dual confirmation, numbered receipt. */
export const loggedCashReceipts = pgTable(
  "logged_cash_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptNo: varchar("receipt_no", { length: 20 }).notNull(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    amount: money("amount").notNull(),
    purpose: varchar("purpose", { length: 20 }).notNull(), // arrival_balance|stage_payment
    hostConfirmedAt: ts("host_confirmed_at"),
    guestConfirmedAt: ts("guest_confirmed_at"),
    mismatchTicketId: uuid("mismatch_ticket_id"),
    createdAt: now(),
  },
  (t) => [uniqueIndex("cash_receipt_no_uq").on(t.receiptNo)],
);

// ---------------------------------------------------------------- messaging
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").references(() => bookings.id),
    kind: varchar("kind", { length: 10 }).notNull(), // chat|notify
    templateKey: text("template_key"),
    channel: varchar("channel", { length: 10 }), // whatsapp|sms|voice|inapp
    fromUserId: uuid("from_user_id").references(() => users.id),
    toUserId: uuid("to_user_id").references(() => users.id),
    toPhone: varchar("to_phone", { length: 20 }),
    body: text("body").notNull(),
    maskedBody: text("masked_body"), // §8.7 pre-deposit contact masking
    deliveryStatus: varchar("delivery_status", { length: 12 })
      .notNull()
      .default("queued"), // queued|sent|delivered|failed|skipped
    ladderStep: integer("ladder_step").notNull().default(0),
    sentAt: ts("sent_at"),
    createdAt: now(),
  },
  (t) => [index("messages_booking_idx").on(t.bookingId)],
);

// ---------------------------------------------------------------- trust
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    listingId: uuid("listing_id").notNull().references(() => listings.id),
    authorRole: varchar("author_role", { length: 6 }).notNull(), // guest|host
    authorId: uuid("author_id").notNull().references(() => users.id),
    // dimensions (§8.8) — 1–5
    scores: jsonb("scores").notNull(), // {cleanliness, accuracy, privacy, communication, value} | hall variant
    text: text("text"),
    publishedAt: ts("published_at"), // double-blind: null until both submit or 7d window passes
    hostReply: text("host_reply"),
    moderated: boolean("moderated").notNull().default(false),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("reviews_booking_author_uq").on(t.bookingId, t.authorRole),
    index("reviews_listing_idx").on(t.listingId),
  ],
);

export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    openedById: uuid("opened_by_id").notNull().references(() => users.id),
    category: varchar("category", { length: 30 }).notNull(), // misrepresentation|double_booking|no_show|cash_mismatch|other
    statement: text("statement"),
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    status: varchar("status", { length: 12 }).notNull().default("open"), // open|adjudicating|resolved
    resolution: text("resolution"),
    remedy: varchar("remedy", { length: 30 }), // partial_refund|full_refund_relocation|credit|strike|none
    dueAt: ts("due_at").notNull(), // 48h SLA (§11.6)
    resolvedAt: ts("resolved_at"),
    createdAt: now(),
  },
  (t) => [index("disputes_status_idx").on(t.status)],
);

export const reliabilityScores = pgTable("reliability_scores", {
  hostId: uuid("host_id").primaryKey().references(() => users.id),
  score: integer("score").notNull().default(50),
  confirmationRateBps: integer("confirmation_rate_bps").notNull().default(10000),
  medianResponseMinutes: integer("median_response_minutes").notNull().default(0),
  attestationStreakWeeks: integer("attestation_streak_weeks").notNull().default(0),
  doubleBookingIncidents: integer("double_booking_incidents").notNull().default(0),
  cancellationStrikes: integer("cancellation_strikes").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Field-agent verification evidence bundles (§8.10, §11.2). */
export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id").notNull().references(() => venues.id),
    agentId: uuid("agent_id").notNull().references(() => users.id),
    visitDate: date("visit_date", { mode: "string" }).notNull(),
    gpsLat: text("gps_lat"),
    gpsLng: text("gps_lng"),
    checklist: jsonb("checklist").notNull(), // structured checklist incl. generator run test
    evidenceMedia: jsonb("evidence_media").notNull().default(sql`'[]'::jsonb`), // private, EXIF kept (§13.8)
    identityEvidenceGrade: varchar("identity_evidence_grade", { length: 30 }).notNull(),
    contractRef: text("contract_ref"), // photo of signed host agreement
    outcome: varchar("outcome", { length: 12 }).notNull().default("pending"), // pending|approved|rejected
    syncedFromOffline: boolean("synced_from_offline").notNull().default(false),
    createdAt: now(),
  },
  (t) => [index("verifications_venue_idx").on(t.venueId)],
);

// ---------------------------------------------------------------- exchange (Phase C tables, schema-ready)
export const exchangeListings = pgTable(
  "exchange_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    sellerId: uuid("seller_id").notNull().references(() => users.id),
    askAmount: money("ask_amount").notNull(), // capped at 100% of original (§9.8)
    hallApproval: varchar("hall_approval", { length: 12 }).notNull().default("pending"), // pending|approved|blocked
    status: varchar("status", { length: 12 }).notNull().default("listed"), // listed|sold|delisted
    createdAt: now(),
  },
  (t) => [uniqueIndex("exchange_booking_uq").on(t.bookingId)],
);

export const transfers = pgTable("transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  exchangeListingId: uuid("exchange_listing_id")
    .notNull()
    .references(() => exchangeListings.id),
  buyerId: uuid("buyer_id").notNull().references(() => users.id),
  amount: money("amount").notNull(),
  feeAmount: money("fee_amount").notNull(),
  newBookingId: uuid("new_booking_id").references(() => bookings.id),
  completedAt: ts("completed_at"),
  createdAt: now(),
});

// ---------------------------------------------------------------- infrastructure
/**
 * Durable server-side timers (§9.3, §12.5): confirmation countdowns, hold expiry,
 * ping ladders, payout releases, reconciliation. DB-backed so a Redis outage can
 * never wedge a booking; worker polls with SKIP LOCKED.
 */
export const scheduledJobs = pgTable(
  "scheduled_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: varchar("kind", { length: 40 }).notNull(),
    // host_confirmation_timeout|hold_expiry|ping_ladder|pre_arrival_reminder|
    // payout_release|review_window_close|refund_sla_check|reconciliation
    refId: uuid("ref_id"), // bookingId etc.
    runAt: ts("run_at").notNull(),
    payload: jsonb("payload"),
    lockedAt: ts("locked_at"),
    attempts: integer("attempts").notNull().default(0),
    completedAt: ts("completed_at"),
    lastError: text("last_error"),
    createdAt: now(),
  },
  (t) => [
    index("jobs_due_idx").on(t.runAt, t.completedAt),
    uniqueIndex("jobs_kind_ref_uq").on(t.kind, t.refId, t.runAt),
  ],
);

/** Idempotency keys for mutating API calls (§12.5, §13.3). */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: now(),
  },
);

// ---------------------------------------------------------------- intelligence
/**
 * Event spine — append-only, first-party behavioral events.
 * Every row: WHO (userId and/or anonId) did WHAT (name, dot-namespaced)
 * WHEN (ts) with WHAT DETAILS (props). Never stores free-text PII or phone
 * numbers in props. Client and server both emit; server events are canonical
 * for money/funnel truth.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: ts("ts").notNull().defaultNow(),
    name: varchar("name", { length: 48 }).notNull(), // e.g. "search.performed"
    userId: uuid("user_id"),
    anonId: varchar("anon_id", { length: 40 }), // client-generated, pre-login
    sessionId: varchar("session_id", { length: 40 }),
    source: varchar("source", { length: 8 }).notNull().default("api"), // web|api|worker|ops
    props: jsonb("props").notNull().default(sql`'{}'::jsonb`),
    context: jsonb("context"), // {locale, ua, viewport, referrer} — set at ingest
  },
  (t) => [
    index("events_name_ts_idx").on(t.name, t.ts),
    index("events_user_ts_idx").on(t.userId, t.ts),
    index("events_anon_ts_idx").on(t.anonId, t.ts),
  ],
);

/**
 * Folded user profiles — derived, rebuildable from events + bookings.
 * traits is versioned JSON; folding is incremental (lastEventTs cursor).
 */
export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  traits: jsonb("traits").notNull().default(sql`'{}'::jsonb`),
  lastEventTs: ts("last_event_ts"),
  foldVersion: integer("fold_version").notNull().default(1),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Ops audit log (§13.8). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    targetType: varchar("target_type", { length: 30 }),
    targetId: text("target_id"),
    detail: jsonb("detail"),
    createdAt: now(),
  },
  (t) => [index("audit_actor_idx").on(t.actorId, t.createdAt)],
);
