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
    emailVerifiedAt: ts("email_verified_at"),
    // Cache of the loyalty ledger sum, same pattern as creditBalance: the
    // ledger is truth, this makes the common read cheap.
    pointsBalance: integer("points_balance").notNull().default(0),
    referralCode: varchar("referral_code", { length: 16 }),
    // no-show history gates privileges (§11.5)
    noShowCount: integer("no_show_count").notNull().default(0),
    completedStays: integer("completed_stays").notNull().default(0),
    creditBalance: money("credit_balance").notNull().default(0), // platform credit ledger cache
    idDocumentRef: text("id_document_ref"), // encrypted storage ref; Exchange sellers only
    disabled: boolean("disabled").notNull().default(false),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_phone_uq").on(t.phone),
    uniqueIndex("users_referral_code_uq").on(t.referralCode),
  ],
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

    /**
     * How much of this venue's location the world may see.
     *
     * §7.1 was written for chalets, where the risk runs one way: a guest who
     * has paid a deposit needs to find the gate, and until they have paid,
     * publishing the pin invites people to turn up uninvited. `staged` encodes
     * that — approximate before, exact after.
     *
     * Services broke the assumption. Most providers in this market are women
     * working from home, and a pin on a woman's front door is a category of
     * risk that a chalet does not carry — it is not a booking-integrity
     * question, it is a safety one, and it is hers to answer. So the provider
     * chooses when they join:
     *
     *   `area`   — never a pin, at any stage. Customers see the area, and she
     *              sends her location herself in chat once she has agreed the
     *              job. The default for services.
     *   `staged` — the chalet rule: approximate publicly, exact once a deposit
     *              is paid. The default for coast and hall venues.
     *   `public` — a pin anyone can see. For a salon, a studio, a hall with a
     *              shopfront: places that want to be found.
     *
     * Drawn-area search works under all three, because it matches on the
     * approximate point, which every venue has.
     */
    locationDisclosure: varchar("location_disclosure", { length: 10 })
      .notNull()
      .default("staged"), // area|staged|public

    /**
     * What is around it — recorded by our agent while they are standing there.
     *
     * The alternative was a Places API call per listing view, which costs $32
     * per thousand and, under Google's terms, may not be cached — so it would
     * be a bill that grows with traffic, forever, for data every competitor
     * can show. The agent is already at the property for the verification
     * visit, and what they can write down is strictly better: whether the café
     * suits families, whether the bakery opens on Friday, whether the
     * supermarket is still reachable when the power is out. Google does not
     * know any of that, and it is the same promise as the rest of the badge.
     *
     * Shape: NeighbourRecord[] — { kind, nameAr, nameEn?, walkMinutes?,
     * driveMinutes?, noteAr?, noteEn?, lat?, lng? }.
     */
    neighbours: jsonb("neighbours").notNull().default(sql`'[]'::jsonb`),
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
    // Services vertical (§ Airbnb-style): catering|photography|makeup|hair|cakes|gym
    serviceCategory: varchar("service_category", { length: 20 }),
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
    /** Promo discount applied at request time, funded from our commission. */
    discountAmount: money("discount_amount").notNull().default(0),
    promoCode: varchar("promo_code", { length: 24 }),
    /**
     * ─────────── What the partner's own catalogue contributed ───────────
     *
     * These four are the booking's half of the partner catalogue, and they are
     * columns on `bookings` rather than a join table for one reason: a booking
     * is a **frozen record of an agreement** (§9.6 price-lock). If the add-on
     * lines lived by reference, a partner renaming "شيشة" to "معسل" or
     * repricing late checkout would silently rewrite what a guest agreed to
     * pay three weeks ago. Snapshots cannot be edited after the fact, which is
     * the entire point of them.
     *
     * `partnerDiscountAmount` is separate from `discountAmount` above and the
     * separation is load-bearing: ours comes out of our commission, theirs
     * comes out of their revenue. Netting them into one number would make the
     * payout arithmetic unexplainable to the person it is being explained to.
     */
    partnerServiceId: uuid("partner_service_id"),
    /** [{ addonId, nameAr, qty, unitPrice, total }] — priced at request time. */
    addons: jsonb("addons").notNull().default(sql`'[]'::jsonb`),
    /** [{ questionId, promptAr, answer }] — the partner's own intake form. */
    intakeAnswers: jsonb("intake_answers").notNull().default(sql`'[]'::jsonb`),
    partnerPromotionId: uuid("partner_promotion_id"),
    partnerDiscountAmount: money("partner_discount_amount").notNull().default(0),
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
    /**
     * Null for money that is not about a booking.
     *
     * It was non-null until Ciao Plus started being sold for a year up front.
     * The alternative — a second intents table with its own invoice numbering,
     * its own webhook route and its own reconciliation — would have meant two
     * places to look when a payment goes missing, and two chances to get
     * replay protection subtly different. One pipeline, one journal, one
     * `invoice_no` space; `purpose` says what the money was for.
     */
    bookingId: uuid("booking_id").references(() => bookings.id),
    /** deposit|stage|exchange|subscription|other */
    purpose: varchar("purpose", { length: 20 }).notNull().default("deposit"),
    /** Who the non-booking money belongs to — a partner, for a subscription. */
    subjectId: uuid("subject_id"),
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
    /**
     * The provider's own words when a send fails — Meta's template-rejection
     * JSON, Twilio's error 21408. Without this a failed row says only
     * "failed", and diagnosing a rejected template means grepping server
     * logs that have long since rotated. Truncated at write time.
     */
    deliveryDetail: text("delivery_detail"),
    ladderStep: integer("ladder_step").notNull().default(0),
    sentAt: ts("sent_at"),
    readAt: ts("read_at"), // in-app inbox
    createdAt: now(),
  },
  (t) => [
    index("messages_booking_idx").on(t.bookingId),
    // The inbox reads by recipient, newest first — without this it scans.
    index("messages_to_user_idx").on(t.toUserId, t.createdAt),
  ],
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

/** Wishlist hearts — strong intent signal, feeds profile folding. */
export const wishlists = pgTable(
  "wishlists",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    listingId: uuid("listing_id").notNull().references(() => listings.id),
    createdAt: now(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.listingId] })],
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

/**
 * ─────────────────────────── Member accounts ───────────────────────────
 *
 * Signing up is optional and always will be: a guest can browse, quote and
 * book with a phone number and an OTP (§6.1 — no account creation before
 * checkout). An account buys extra — a wallet, points, an inbox, passkeys,
 * saved preferences — but nothing in the booking path may ever require one.
 */

/**
 * Passkeys (WebAuthn). The point in Libya is not password hygiene — there are
 * no passwords here — it is that OTP costs money, needs signal, and fails
 * during outages. A fingerprint works with no network at all, which matters at
 * a chalet gate, and matters more once a wallet holds real balance.
 *
 * We store the public key only. The private key never leaves the device's
 * secure element, so this table is worthless to whoever steals it.
 */
export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    credentialId: text("credential_id").notNull(), // base64url
    publicKey: text("public_key").notNull(), // base64url COSE key
    counter: integer("counter").notNull().default(0), // clone detection
    transports: jsonb("transports").notNull().default(sql`'[]'::jsonb`),
    deviceLabel: text("device_label"),
    lastUsedAt: ts("last_used_at"),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("webauthn_credential_uq").on(t.credentialId),
    index("webauthn_user_idx").on(t.userId),
  ],
);

/**
 * Declared preferences — guardrail 1 of the intelligence layer made concrete.
 * Everything here the user told us on purpose; nothing here is inferred from
 * behaviour. That separation is what lets us personalize without surveilling.
 */
export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  locale: varchar("locale", { length: 5 }).notNull().default("ar"),
  theme: varchar("theme", { length: 8 }).notNull().default("system"), // system|light|dark
  preferredRail: varchar("preferred_rail", { length: 12 }),
  notifyWhatsapp: boolean("notify_whatsapp").notNull().default(true),
  notifySms: boolean("notify_sms").notNull().default(true),
  notifyInApp: boolean("notify_in_app").notNull().default(true),
  // Off by default. Booking confirmations are service messages and always
  // send; offers are marketing and must be asked for (Law 6/2022 consent).
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  earlyAccessOptIn: boolean("early_access_opt_in").notNull().default(false),
  favouriteAreas: jsonb("favourite_areas").notNull().default(sql`'[]'::jsonb`),

  /**
   * Date of birth — declared, optional, and stored here rather than on the
   * user row on purpose: it is something a member chose to tell us so we can
   * greet them and time an offer, not part of their identity with us. Their
   * identity is their phone number.
   *
   * Only the day and month ever leave this table. The year resolves to a
   * coarse age band before it reaches the intelligence layer, so nothing
   * downstream — events, profiles, dashboards — ever carries a precise age.
   */
  birthDate: date("birth_date", { mode: "string" }),

  /**
   * When the birth date was put on file, and how many times it has moved.
   *
   * Both exist because of one exploit. Points are awarded for giving us a
   * birth date, and again every year on the day — so the cheapest attack on
   * the programme is to join, set your birthday to tomorrow, and collect the
   * annual gift within a day. On the numbers as first shipped that took a
   * fresh account to exactly the redemption floor without a single booking:
   * 1,000 signup + 500 for the date + 1,000 for the party profile + 2,500 for
   * the "birthday" = 5,000, which buys a coffee at a partner that Ciao then
   * settles in cash.
   *
   * `birthDateSetAt` closes it: a gift is only paid once the date has been on
   * file for a while, so a date typed yesterday earns nothing this year.
   * `birthDateChanges` protects the other casualty — a birth date that can be
   * dialled is not data, and the whole reason for collecting it was to know
   * when to say something. One correction is allowed, because people mistype;
   * after that it stops being editable and support has to do it, which is how
   * every other business treats a date of birth.
   */
  birthDateSetAt: ts("birth_date_set_at"),
  birthDateChanges: integer("birth_date_changes").notNull().default(0),

  /**
   * Who usually travels with them — the *shape* of the party, never who is in
   * it.
   *
   * Salem asked for family information so offers can be timed and sized well.
   * This is the version of that which stays on the right side of the
   * intelligence layer's third guardrail: "books for 8 adults and 3 children"
   * is a party profile; "has three daughters, aged 4, 7 and 11" is a register
   * of a family, and in a market built on satar that register is a liability
   * no amount of personalization would justify. Counts and bands answer every
   * question an offer needs to ask, and they do not go stale the way a named
   * child's age does.
   *
   * Bands are coarse on purpose: `toddler` (0–3), `child` (4–9), `teen`
   * (10–17). We record which bands are present, not how many are in each, and
   * we use them only to size and screen a property — never to target a child.
   */
  partyAdults: integer("party_adults"),
  partyChildren: integer("party_children"),
  childAgeBands: jsonb("child_age_bands").notNull().default(sql`'[]'::jsonb`),

  /**
   * Recurring occasions, as a month and nothing else.
   *
   * "Your anniversary is next month" needs a month. It does not need the year
   * you married, the day, or your spouse — so we do not hold them.
   */
  occasions: jsonb("occasions").notNull().default(sql`'[]'::jsonb`),

  /**
   * One upcoming event they are actively planning — the declared version of
   * the wedding pipeline the intelligence skill asks for. A stated date beats
   * inferring intent from a cluster of hall views, and it is honest: the
   * member knows why we are asking.
   */
  plannedEventKind: varchar("planned_event_kind", { length: 20 }),
  plannedEventDate: date("planned_event_date", { mode: "string" }),

  /** Stamped when the party profile is first completed, so the reward pays once. */
  profileCompletedAt: ts("profile_completed_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * Loyalty points — deliberately NOT money.
 *
 * Money lives in the double-entry ledger as `guest_credit:<userId>`; points
 * live here. Keeping them apart is a regulatory position as much as a design
 * one: points are a marketing liability we can retire at will, whereas a
 * balance a customer paid for is somebody's money (§15.4). Conflating them is
 * how a marketplace accidentally becomes an unlicensed deposit-taker.
 */
export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    delta: integer("delta").notNull(), // + earned, − redeemed
    reason: varchar("reason", { length: 40 }).notNull(),
    refType: varchar("ref_type", { length: 20 }),
    refId: text("ref_id"),
    memoAr: text("memo_ar"),
    /**
     * When this award lapses. Null means it never does — redemptions and
     * expiries themselves carry no expiry, only earnings do.
     */
    expiresAt: ts("expires_at"),
    expiredAt: ts("expired_at"),
    createdAt: now(),
  },
  (t) => [
    index("loyalty_user_idx").on(t.userId, t.createdAt),
    // The expiry sweep looks for live awards past their date.
    index("loyalty_expiry_idx").on(t.expiresAt),
    // One award per (user, reason, ref) — makes every earn idempotent, so a
    // retried webhook or a double-tapped button can't mint points twice.
    uniqueIndex("loyalty_award_uq").on(t.userId, t.reason, t.refId),
  ],
);

/**
 * Redemption partners — the coffee shop inside the resort, the restaurant on
 * the corniche, the bakery that does the cake.
 *
 * This is where loyalty stops being a discount on us and becomes money in a
 * Libyan small business's till. That makes it a genuinely different product:
 * points earned booking a chalet buy a coffee at the place next door, and the
 * café gets a paying customer it wouldn't have had.
 *
 * It also makes a burned point a *real* liability, so redemption posts to a
 * `partner_payable:<id>` ledger account rather than quietly vanishing.
 */
export const partners = pgTable(
  "partners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nameAr: text("name_ar").notNull(),
    category: varchar("category", { length: 24 }).notNull(), // cafe|restaurant|bakery|spa|activity|shop
    // Partners often sit inside a venue we already verified — the café at the
    // resort. Linking them lets us show "on site" on the listing page.
    venueId: uuid("venue_id").references(() => venues.id),
    city: varchar("city", { length: 40 }),
    area: varchar("area", { length: 60 }),
    contactPhone: varchar("contact_phone", { length: 20 }),
    /** Staff account that redeems vouchers at the counter. */
    staffUserId: uuid("staff_user_id").references(() => users.id),
    descriptionAr: text("description_ar"),
    logoUrl: text("logo_url"),
    /** Smallest and largest voucher a guest may cut, in dirhams. */
    minValue: money("min_value").notNull().default(5_000),
    maxValue: money("max_value").notNull().default(100_000),
    active: boolean("active").notNull().default(true),
    createdAt: now(),
  },
  (t) => [index("partners_active_idx").on(t.active), index("partners_venue_idx").on(t.venueId)],
);

/**
 * A point voucher: points already burned, value the partner may claim.
 *
 * Points are burned at issue, not at redemption. A voucher that could still be
 * spent elsewhere while sitting in someone's phone is a double-spend waiting
 * to happen — and the person who eats it would be the café. Unredeemed
 * vouchers expire and the points come back.
 */
export const partnerRedemptions = pgTable(
  "partner_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 12 }).notNull(),
    userId: uuid("user_id").notNull().references(() => users.id),
    partnerId: uuid("partner_id").notNull().references(() => partners.id),
    points: integer("points").notNull(),
    value: money("value").notNull(), // dirhams the partner may claim
    status: varchar("status", { length: 12 }).notNull().default("issued"),
    // issued|redeemed|expired|cancelled
    expiresAt: ts("expires_at").notNull(),
    redeemedAt: ts("redeemed_at"),
    redeemedByUserId: uuid("redeemed_by_user_id").references(() => users.id),
    settledAt: ts("settled_at"),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("partner_redemption_code_uq").on(t.code),
    index("partner_redemption_user_idx").on(t.userId, t.createdAt),
    index("partner_redemption_partner_idx").on(t.partnerId, t.status),
  ],
);

/**
 * Promo codes.
 *
 * The commercial rule encoded here: a promo is funded from Ciao's commission
 * and capped there. We will discount our own margin to win a booking; we will
 * not quietly pay a host out of pocket because someone typed a generous
 * percentage into a form at midnight.
 */
export const promoCodes = pgTable(
  "promo_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 24 }).notNull(),
    kind: varchar("kind", { length: 10 }).notNull(), // percent|fixed|points
    /** bps for percent, dirhams for fixed, whole points for points. */
    value: integer("value").notNull(),
    descriptionAr: text("description_ar"),
    vertical: varchar("vertical", { length: 8 }), // coast|hall|service|null = all
    city: varchar("city", { length: 40 }),
    listingId: uuid("listing_id").references(() => listings.id),
    minSpend: money("min_spend").notNull().default(0),
    maxDiscount: money("max_discount"), // ceiling for percent codes
    startsAt: ts("starts_at"),
    endsAt: ts("ends_at"),
    maxRedemptions: integer("max_redemptions"),
    perUserLimit: integer("per_user_limit").notNull().default(1),
    timesUsed: integer("times_used").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: now(),
  },
  (t) => [uniqueIndex("promo_code_uq").on(t.code), index("promo_active_idx").on(t.active)],
);

export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promoId: uuid("promo_id").notNull().references(() => promoCodes.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    discount: money("discount").notNull(),
    createdAt: now(),
  },
  (t) => [
    index("promo_redemption_promo_idx").on(t.promoId),
    // One row per (promo, booking) makes application idempotent under retry.
    uniqueIndex("promo_redemption_booking_uq").on(t.promoId, t.bookingId),
  ],
);

/**
 * Referrals. The invite code is public and shareable; the reward only lands
 * when the invited guest actually completes a stay, not when they sign up —
 * paying for signups in a market this small is paying for fake accounts.
 */
export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerId: uuid("referrer_id").notNull().references(() => users.id),
    refereeId: uuid("referee_id").references(() => users.id),
    code: varchar("code", { length: 16 }).notNull(),
    status: varchar("status", { length: 12 }).notNull().default("invited"),
    // invited|joined|qualified|rewarded
    bookingId: uuid("booking_id").references(() => bookings.id),
    rewardedAt: ts("rewarded_at"),
    createdAt: now(),
  },
  (t) => [
    index("referrals_referrer_idx").on(t.referrerId),
    // A person can only ever be referred once, by one person.
    uniqueIndex("referrals_referee_uq").on(t.refereeId),
  ],
);

/**
 * Saved payment preferences. We never store a card number — that is the
 * provider's job and their PCI scope, not ours. What we keep is which rail the
 * guest prefers, a label, and whatever opaque token the provider hands back.
 */
export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    rail: varchar("rail", { length: 12 }).notNull(),
    label: text("label"),
    providerToken: text("provider_token"), // opaque; never a PAN
    last4: varchar("last4", { length: 4 }),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: now(),
  },
  (t) => [index("payment_methods_user_idx").on(t.userId)],
);

/**
 * Platform control plane — runtime settings that steer the public app.
 *
 * Anything an operator should be able to change without a deploy lives here:
 * commission rates, which payment rails are offered, the home hero images,
 * demo-mode switches, feature flags. Env vars stay for secrets and
 * infrastructure; this table is for business decisions, because a founder in
 * Tripoli should not need a Railway redeploy to change a commission rate.
 *
 * Every write goes through setSetting(), which audits. Reads are cached in
 * process for a few seconds so the hot path (listings, quotes) stays cheap.
 */
export const platformSettings = pgTable("platform_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedById: uuid("updated_by_id").references(() => users.id),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * ─────────────────────── The partner control panel ───────────────────────
 *
 * Everything below belongs to the people who supply this marketplace: the man
 * with six chalets in Janzour, the hall on Airport Road, the make-up artist
 * who does four brides on a Thursday morning.
 *
 * The governing decision, and the reason these tables exist at all: **a
 * partner manages their whole book here, not just the part Ciao brought
 * them.** Almost none of them has a booking system today — the calendar is a
 * notebook, the diary is a WhatsApp thread, and the accounts receivable is
 * what they can remember. A console that only showed Ciao's bookings would be
 * a commission statement, and nobody opens a commission statement. A console
 * that holds the whole diary is the tool they run their business from, and
 * they will open it every morning.
 *
 * Three things follow from that, and each one is worth more than the feature
 * that produced it:
 *
 *  1. **It is the onboarding argument.** We are not asking a photographer to
 *     pay us 10% for leads. We are handing her a business system that is
 *     better than her notebook, free, and mentioning that it also brings
 *     customers.
 *  2. **It closes pitfall #2 — the ghost calendar** (§7.2). Off-platform
 *     bookings are the single largest cause of double-booking in this market,
 *     and no amount of weekly "please attest your calendar" nagging fixes
 *     that. Giving the partner a reason to record the off-platform job — she
 *     wants it in her own diary — blocks the date on Ciao as a side effect.
 *  3. **It is the market dataset** (§13.9). Real prices, real occupancy, real
 *     demand across both books, which nobody in Libya has.
 *
 * The promise that makes it work has to be kept absolutely: a direct job is
 * hers. Ciao charges no commission on it, never contacts the customer, and
 * never markets to them. The moment we monetise the diary, the diary empties.
 */

/**
 * Business-level settings for a partner — the things that are true about how
 * they work rather than about any single job.
 *
 * Keyed on the user because in this market the business *is* the person: Haj
 * Mustafa's six chalets are not a company, and asking him to create an
 * "organisation" before he can see his bookings would lose him at the first
 * screen. Halls that genuinely have staff get that through `partnerTeam`.
 */
export const partnerProfiles = pgTable("partner_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  businessNameAr: text("business_name_ar"),
  businessNameEn: text("business_name_en"),
  /**
   * Which shape of business this is. It changes the whole console: a chalet
   * thinks in nights, a hall thinks in sessions on a date, a make-up artist
   * thinks in appointments with a travel time between them. One console that
   * pretends all three are the same would be wrong for all three.
   */
  kind: varchar("kind", { length: 8 }).notNull().default("venue"), // venue|hall|service

  /** ISO day numbers (1=Mon … 7=Sun) the business works. Empty = every day. */
  workingDays: jsonb("working_days").notNull().default(sql`'[]'::jsonb`),
  /** { from: "09:00", to: "18:00" } — display and agenda only, not enforced. */
  workingHours: jsonb("working_hours"),
  /**
   * How much warning they need. A chalet can take a booking for tonight; a
   * caterer cooking for 300 cannot, and a request that arrives too late is
   * worse than no request because refusing it costs them a reliability strike.
   */
  noticeHours: integer("notice_hours").notNull().default(0),
  /**
   * How many jobs fit in a day. A chalet is 1. A make-up artist is 3 or 4, and
   * the difference is the whole reason her calendar cannot be a day grid of
   * open/closed like a venue's.
   */
  maxJobsPerDay: integer("max_jobs_per_day").notNull().default(1),

  /** Service providers who travel to the customer, and what they charge for it. */
  travelsToClient: boolean("travels_to_client").notNull().default(false),
  travelFee: money("travel_fee").notNull().default(0),
  serviceAreas: jsonb("service_areas").notNull().default(sql`'[]'::jsonb`),

  /** Their own deposit policy on direct work. Ciao's rate governs Ciao bookings. */
  defaultDepositBps: integer("default_deposit_bps").notNull().default(2000),

  /**
   * The daily agenda message — the feature that makes this a phone product
   * rather than an office product. Sent the evening before, over the same
   * channel ladder as everything else, so it survives a power cut.
   */
  agendaEnabled: boolean("agenda_enabled").notNull().default(true),
  /** Hour (Africa/Tripoli) the agenda goes out the evening before. */
  agendaHour: integer("agenda_hour").notNull().default(18),
  locale: varchar("locale", { length: 5 }).notNull().default("ar"),
  onboardedAt: ts("onboarded_at"),
  createdAt: now(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * The partner's own customer book. **Theirs, not ours.**
 *
 * We are the processor here, not the controller: these are contacts the
 * partner typed in about people who are their customers, often long before
 * Ciao existed. So the rules are strict and they are product rules, not just
 * policy text — Ciao never markets to a row in this table, never folds it into
 * the intelligence layer beyond counts, and any staff access is audited with a
 * reason attached (see `partner/service.ts`).
 *
 * `ciaoUserId` is set only when the partner's client is demonstrably an
 * existing Ciao member — matched on the normalized phone at write time. It
 * exists so "she has booked with me four times" is true across both books,
 * which is the number a partner most wants and can least easily keep.
 */
export const partnerClients = pgTable(
  "partner_clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => users.id),
    nameAr: text("name_ar").notNull(),
    phone: varchar("phone", { length: 20 }),
    ciaoUserId: uuid("ciao_user_id").references(() => users.id),
    notesAr: text("notes_ar"),
    /** Caches, so the client list does not fan out into a query per row. */
    jobsCount: integer("jobs_count").notNull().default(0),
    totalSpend: money("total_spend").notNull().default(0),
    lastJobAt: ts("last_job_at"),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("partner_clients_partner_idx").on(t.partnerId, t.lastJobAt),
    // One row per person per partner, so re-entering a returning customer
    // updates the history instead of splitting it in two.
    uniqueIndex("partner_clients_phone_uq").on(t.partnerId, t.phone),
  ],
);

/**
 * A job — one piece of work on one day.
 *
 * This is the unified record the whole console is built on, and it deliberately
 * spans both books:
 *
 *  - `bookingId` set → this job mirrors a Ciao booking. The booking is the
 *    truth for money and state; the job carries the partner's own notes and
 *    keeps it visible in one diary. State changes still go through the booking
 *    state machine, never through here — the console is a better set of hands
 *    on the same machine (§9.3).
 *  - `bookingId` null → a direct job the partner entered. Ciao takes nothing,
 *    knows nothing about the customer beyond what the partner typed, and the
 *    partner owns every field.
 *
 * `blocksCalendar` defaults true because that is the entire point: recording
 * Thursday's wedding in the diary is what stops Ciao selling Thursday.
 */
export const partnerJobs = pgTable(
  "partner_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => users.id),
    listingId: uuid("listing_id").references(() => listings.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    clientId: uuid("client_id").references(() => partnerClients.id),
    /** Where the work came from — the number that tells a partner what Ciao is worth. */
    source: varchar("source", { length: 12 }).notNull().default("direct"),
    // ciao|whatsapp|phone|walk_in|instagram|facebook|repeat|direct|other
    kind: varchar("kind", { length: 12 }).notNull().default("event"),
    // stay|day_use|event|session|appointment|visit
    titleAr: text("title_ar").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    /** Null for a one-day job. Inclusive of the last night for a stay. */
    endDay: date("end_day", { mode: "string" }),
    session: varchar("session", { length: 16 }).notNull().default("night"),
    startTime: varchar("start_time", { length: 5 }), // "16:30", local
    endTime: varchar("end_time", { length: 5 }),
    status: varchar("status", { length: 12 }).notNull().default("confirmed"),
    // enquiry|quoted|confirmed|done|cancelled|no_show
    /** Partner-entered money on direct jobs; mirrored from the booking on Ciao ones. */
    price: money("price").notNull().default(0),
    amountPaid: money("amount_paid").notNull().default(0),
    /**
     * ─────────────── The catalogue, as it landed on this job ───────────────
     *
     * Same snapshot discipline as `bookings`: names and prices are copied in,
     * not referenced, so a job written in June still reads in December the way
     * it was agreed — even if the service has since been renamed, repriced or
     * deleted. A diary that quietly rewrites its own history is worse than a
     * notebook, because a notebook cannot.
     *
     * `serviceId` is kept alongside the snapshot purely so the catalogue can
     * count what sells. Nothing renders from it.
     */
    serviceId: uuid("service_id"),
    units: integer("units").notNull().default(1),
    guestCount: integer("guest_count"),
    addons: jsonb("addons").notNull().default(sql`'[]'::jsonb`),
    intakeAnswers: jsonb("intake_answers").notNull().default(sql`'[]'::jsonb`),
    promotionId: uuid("promotion_id"),
    discount: money("discount").notNull().default(0),
    /**
     * Who is doing the work.
     *
     * A hall with two coordinators and a studio with three photographers both
     * need this, and the agenda is useless without it: "you have a wedding on
     * Thursday" is not the same message as "Fatima has a wedding on Thursday".
     * Team member ids from `partnerTeam`; empty means the owner.
     */
    assignedTo: jsonb("assigned_to").notNull().default(sql`'[]'::jsonb`),
    locationAr: text("location_ar"),
    notesAr: text("notes_ar"),
    blocksCalendar: boolean("blocks_calendar").notNull().default(true),
    completedAt: ts("completed_at"),
    cancelledAt: ts("cancelled_at"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("partner_jobs_partner_day_idx").on(t.partnerId, t.day),
    index("partner_jobs_client_idx").on(t.clientId),
    // A Ciao booking mirrors into exactly one job, so the sync is idempotent
    // however many times a webhook or a worker replays it.
    uniqueIndex("partner_jobs_booking_uq").on(t.bookingId),
  ],
);

/**
 * Quotes — the single most useful thing this console gives a service provider.
 *
 * A photographer's real workflow is enquiry → quote → deposit → shoot →
 * delivery, and today the quote is a voice note or a screenshot of a note-app
 * page. It gets misremembered, it gets renegotiated at the door, and it is
 * unenforceable. A quote with priced lines, a validity date and a link that
 * unfurls properly in WhatsApp is a professional posture no competitor in this
 * market offers, and it costs us nothing but the table.
 *
 * `code` is public and shareable: the customer opens it without an account,
 * because requiring one at this point would kill the send.
 */
export const partnerQuotes = pgTable(
  "partner_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 12 }).notNull(),
    partnerId: uuid("partner_id").notNull().references(() => users.id),
    clientId: uuid("client_id").references(() => partnerClients.id),
    listingId: uuid("listing_id").references(() => listings.id),
    titleAr: text("title_ar").notNull(),
    /** [{ labelAr, qty, unitPrice, total }] — priced lines, comparable rows. */
    lineItems: jsonb("line_items").notNull().default(sql`'[]'::jsonb`),
    subtotal: money("subtotal").notNull().default(0),
    discount: money("discount").notNull().default(0),
    total: money("total").notNull().default(0),
    depositAmount: money("deposit_amount").notNull().default(0),
    proposedDay: date("proposed_day", { mode: "string" }),
    session: varchar("session", { length: 16 }),
    startTime: varchar("start_time", { length: 5 }),
    validUntil: date("valid_until", { mode: "string" }),
    notesAr: text("notes_ar"),
    termsAr: text("terms_ar"),
    status: varchar("status", { length: 10 }).notNull().default("draft"),
    // draft|sent|accepted|declined|expired|withdrawn
    /**
     * Whether the customer opened it, and when they last did. A partner
     * chasing a quote wants to know the difference between "she hasn't seen
     * it" and "she's seen it three times and hasn't answered" — those are two
     * different conversations.
     */
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: ts("last_viewed_at"),
    sentAt: ts("sent_at"),
    respondedAt: ts("responded_at"),
    jobId: uuid("job_id").references(() => partnerJobs.id),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("partner_quotes_code_uq").on(t.code),
    index("partner_quotes_partner_idx").on(t.partnerId, t.createdAt),
  ],
);

/**
 * Team members.
 *
 * A hall has staff; a resort has a manager; the owner is often not the person
 * holding the phone at 9pm. Without this the only way to let a manager confirm
 * bookings is to hand them the owner's login — which is what happens today,
 * and it is why "who cancelled that booking" is unanswerable in this market.
 *
 * The role split is drawn where the money is:
 *  - `owner`   — everything, including where payouts go and who is on the team.
 *  - `manager` — the diary, the calendar, quotes, clients, earnings summary.
 *                Not the payout destination, not the team, not the plan.
 *  - `staff`   — today's work and the calendar. No money screens at all.
 *
 * Staff can still see a client's phone number for a job they are working,
 * because otherwise they cannot ring the customer who is late, which is the
 * job. They cannot see the client list or what anything earned.
 */
export const partnerTeam = pgTable(
  "partner_team",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => users.id),
    memberUserId: uuid("member_user_id").notNull().references(() => users.id),
    role: varchar("role", { length: 8 }).notNull().default("staff"), // owner|manager|staff
    invitedById: uuid("invited_by_id").references(() => users.id),
    disabledAt: ts("disabled_at"),
    lastSeenAt: ts("last_seen_at"),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("partner_team_uq").on(t.partnerId, t.memberUserId),
    index("partner_team_member_idx").on(t.memberUserId),
  ],
);

/**
 * Where a partner's money goes — and the delay that protects it.
 *
 * Account-takeover in a marketplace does not steal the account, it redirects
 * the payouts, and it is the highest-value attack available against Ciao
 * because it converts one compromised phone into every future booking's
 * deposit. So changing the destination is not an ordinary edit:
 *
 *  - the new destination sits `pending` until `activatesAt` (a cooling-off
 *    period the control plane sets, 24h by default),
 *  - the *previous* channel is notified the moment the change is requested,
 *    which is the only alert that reaches the real owner if the attacker
 *    already controls the new one,
 *  - payouts due in the meantime hold rather than paying to either account.
 *
 * The delay is the control. A thief needs the owner not to read a WhatsApp
 * message for a day, which is a much harder thing to arrange than an OTP.
 */
export const partnerPayoutAccounts = pgTable(
  "partner_payout_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => users.id),
    rail: varchar("rail", { length: 12 }).notNull().default("bank_app"),
    label: text("label"),
    /** Masked for display; the full reference is never rendered back to a client. */
    accountRef: text("account_ref").notNull(),
    status: varchar("status", { length: 10 }).notNull().default("pending"),
    // pending|active|cancelled|replaced
    activatesAt: ts("activates_at"),
    activatedAt: ts("activated_at"),
    cancelledAt: ts("cancelled_at"),
    requestedById: uuid("requested_by_id").references(() => users.id),
    requestedIp: varchar("requested_ip", { length: 45 }),
    createdAt: now(),
  },
  (t) => [index("partner_payout_accounts_partner_idx").on(t.partnerId, t.status)],
);

/**
 * Ciao Plus — the intelligence subscription.
 *
 * What is free and what is paid is a deliberate line, not a paywall drawn
 * wherever it fit: **your own numbers are always free; the market costs
 * money.** A partner should never have to pay to see how much they earned or
 * who owes them — charging for that would make the console a hostage
 * situation, and they would go back to the notebook. What Plus sells is the
 * thing they genuinely cannot get anywhere else and that costs us real work to
 * produce honestly: what the rest of the market is doing.
 *
 * Settlement has two shapes, and the second is now the headline one.
 *
 * `payout_netting` takes the fee out of money we already owe them. It works,
 * it needs no payment rail, and it suits a partner with steady Ciao volume.
 * But it fails exactly where the product needs to win: a partner whose book is
 * mostly direct work has few payouts to net against, and they are precisely
 * the partner for whom market data is worth paying for.
 *
 * `annual_upfront` is the answer, and it is shaped by the market rather than
 * by convention. There is no direct debit in Libya and recurring card billing
 * does not meaningfully exist, so a monthly subscription is a monthly
 * collections problem — twelve chances a year to lose a customer to a failed
 * charge nobody could have fixed. One payment, once, through the same rails
 * that already take deposits, buying a year. That is a thing a Libyan business
 * owner recognises: it is how they pay for everything else.
 */
export const partnerSubscriptions = pgTable("partner_subscriptions", {
  partnerId: uuid("partner_id").primaryKey().references(() => users.id),
  plan: varchar("plan", { length: 8 }).notNull().default("free"), // free|plus
  status: varchar("status", { length: 10 }).notNull().default("none"),
  // none|trialing|active|past_due|cancelled
  trialEndsAt: ts("trial_ends_at"),
  currentPeriodStart: ts("current_period_start"),
  currentPeriodEnd: ts("current_period_end"),
  priceDirhams: money("price_dirhams").notNull().default(0),
  /** How the fee is collected: payout_netting | annual_upfront. */
  settlement: varchar("settlement", { length: 16 }).notNull().default("payout_netting"),
  /** monthly | annual — what the current period represents. */
  term: varchar("term", { length: 8 }).notNull().default("monthly"),
  /**
   * The booking-style payment that bought the current annual term.
   *
   * Kept as a reference rather than a boolean so a partner querying "what did
   * I actually pay and when" has a receipt to point at, and so a disputed
   * charge can be traced to a rail transaction like any other money in the
   * system. Null for netted subscriptions, which have no single payment.
   */
  paymentId: uuid("payment_id"),
  /**
   * Renewal reminders already sent for this period, as day-offsets ("30",
   * "7", "1"). Idempotence for the reminder job: a subscription notice that
   * arrives three times reads as dunning, and dunning a partner who has not
   * lapsed is how they learn to ignore our messages.
   */
  renewalNoticesSent: jsonb("renewal_notices_sent").notNull().default(sql`'[]'::jsonb`),
  /** Set when the partner asks not to be reminded again this period. */
  renewalRemindersOff: boolean("renewal_reminders_off").notNull().default(false),
  cancelledAt: ts("cancelled_at"),
  createdAt: now(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * ═══════════════════ The catalogue: what a partner actually sells ══════════
 *
 * Everything above this line models work that has already been agreed — a job
 * in the diary, a quote sent, money owed. What was missing is the thing every
 * one of those starts from: **what this business offers, in its own words.**
 *
 * The design constraint is that "partner" covers a resort with forty chalets
 * and a photographer who works alone out of a bag. A schema that models nights
 * is wrong for her; a schema that models sessions is wrong for them. So the
 * catalogue models neither. It models a *priced thing with a unit*, and the
 * unit is the partner's choice:
 *
 *   night        a chalet, priced per night          — resorts, estirahas
 *   day          a hall or a venue hired for a day   — halls, farms
 *   session      a half-day or a named slot          — photographers, halls
 *   hour         priced by the hour                  — studios, gyms
 *   person       priced per head                     — catering, make-up
 *   item         a flat price for a thing            — a cake, an album
 *
 * That list is deliberately short and deliberately not extensible by config.
 * Six units cover the market, and each one changes how a price is computed and
 * how the booking form reads. A seventh added carelessly would mean a unit the
 * pricing engine cannot multiply and the consumer app cannot label.
 */
export const partnerServices = pgTable(
  "partner_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => users.id),
    /**
     * The Ciao listing this is sold under, when it is sold on the marketplace
     * at all. Null is a first-class case and an important one: a partner's
     * catalogue is theirs, and plenty of what they sell — the corporate rate,
     * the thing they only do for regulars — is never going on the marketplace.
     * Making the listing optional is what lets the console hold their whole
     * business rather than the shop window we happen to run.
     */
    listingId: uuid("listing_id").references(() => listings.id),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    /** night|day|session|hour|person|item — see the block comment above. */
    unit: varchar("unit", { length: 8 }).notNull().default("item"),
    basePrice: money("base_price").notNull().default(0),
    /**
     * Bounds on how many units may be bought at once. `minUnits` is how a
     * two-night minimum, a ten-person minimum order, or a three-hour hire gets
     * expressed without a rule engine.
     */
    minUnits: integer("min_units").notNull().default(1),
    maxUnits: integer("max_units"),
    /** Minutes, for the units where duration is real. Drives the agenda. */
    durationMinutes: integer("duration_minutes"),
    /** Head-count bounds where the thing has a capacity — a hall, a table. */
    minGuests: integer("min_guests"),
    maxGuests: integer("max_guests"),
    /**
     * Overrides of the profile defaults, per service, because one business
     * genuinely has two answers. A photographer takes a portrait session
     * tomorrow and needs three weeks for a wedding; one `noticeHours` on the
     * profile cannot say both, and the version that protects the wedding
     * refuses the easy money.
     */
    noticeHours: integer("notice_hours"),
    depositBps: integer("deposit_bps"),
    cancellationTier: varchar("cancellation_tier", { length: 12 }),
    /** How many of THIS can run in a day, when it differs from the profile. */
    dailyCapacity: integer("daily_capacity"),
    /** Free-text bullets the customer sees: "شامل الإضاءة", "٣ ساعات تصوير". */
    includesAr: jsonb("includes_ar").notNull().default(sql`'[]'::jsonb`),
    media: jsonb("media").notNull().default(sql`'[]'::jsonb`),
    /**
     * Whether a customer may book this without the partner saying yes. Off by
     * default and that default is the point: a partner who discovers the app
     * sold something they cannot deliver will never trust it again. They turn
     * this on per service once they believe us.
     */
    instantBook: boolean("instant_book").notNull().default(false),
    /** Visible on the marketplace. A service can be active internally and unlisted. */
    published: boolean("published").notNull().default(false),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Cached demand counters so the catalogue list needs no fan-out. */
    bookedCount: integer("booked_count").notNull().default(0),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("partner_services_partner_idx").on(t.partnerId, t.active, t.sortOrder),
    index("partner_services_listing_idx").on(t.listingId, t.published),
  ],
);

/**
 * Add-ons — the second half of every real quote in this market.
 *
 * A chalet is never just a chalet: it is the chalet, plus the barbecue, plus
 * an extra mattress, plus late checkout. A wedding photographer's price is a
 * package plus an album plus a second shooter plus travel to Misrata. Those
 * extras are where the margin lives, and today they are negotiated over
 * WhatsApp and forgotten by the time anyone invoices.
 *
 * `serviceId` null means the add-on is offered across the whole business,
 * which is how travel fees and late checkout actually behave.
 */
export const partnerAddons = pgTable(
  "partner_addons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => users.id),
    serviceId: uuid("service_id").references(() => partnerServices.id),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    descriptionAr: text("description_ar"),
    price: money("price").notNull().default(0),
    /**
     * flat        one charge however big the booking
     * per_unit    multiplied by nights/hours/sessions — late checkout per night
     * per_person  multiplied by head count — an extra plate
     * per_km      multiplied by distance — the travel fee, honestly modelled
     */
    priceModel: varchar("price_model", { length: 10 }).notNull().default("flat"),
    maxQty: integer("max_qty").notNull().default(1),
    /**
     * Required add-ons exist and pretending otherwise makes the total a lie:
     * a cleaning fee is not optional, and a customer who sees it appear at the
     * last step feels tricked. Required means it is in the headline price and
     * shown as a line, not hidden and added at checkout.
     */
    required: boolean("required").notNull().default(false),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("partner_addons_partner_idx").on(t.partnerId, t.active, t.sortOrder)],
);

/**
 * Price rules — seasonality, weekends, and the last-minute deal.
 *
 * Every partner in this market already does this in their head: August is more,
 * Thursday and Friday are more, a wedding date twelve months out gets a
 * discount to lock it in. Making them type one number into a box and then
 * quote a different one over the phone is how a marketplace's prices become
 * fiction. So the rules are explicit, they stack in a defined order, and the
 * partner can see the resulting price for any date before a customer does.
 *
 * `adjustBps` is a multiplier in basis points against the base — 12000 is
 * +20%, 8500 is −15% — and `adjustFlat` is added after. Both are signed and
 * both may be present, because "August is +20% and there is a 50 dinar
 * generator surcharge" is a real sentence.
 */
export const partnerPriceRules = pgTable(
  "partner_price_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => users.id),
    serviceId: uuid("service_id").references(() => partnerServices.id),
    labelAr: text("label_ar").notNull(),
    /** season | weekday | lead_time | duration */
    kind: varchar("kind", { length: 10 }).notNull(),
    /** season: inclusive date window. */
    fromDay: date("from_day", { mode: "string" }),
    toDay: date("to_day", { mode: "string" }),
    /** weekday: ISO day numbers (1=Mon … 7=Sun). Friday here is 5. */
    weekdays: jsonb("weekdays").notNull().default(sql`'[]'::jsonb`),
    /** lead_time: applies when the booking is this far out (or nearer). */
    minLeadDays: integer("min_lead_days"),
    maxLeadDays: integer("max_lead_days"),
    /** duration: applies from this many units — the weekly rate. */
    minUnits: integer("min_units"),
    adjustBps: integer("adjust_bps").notNull().default(10000),
    adjustFlat: money("adjust_flat").notNull().default(0),
    /** Lower runs first. Ties break on id so a price is never non-deterministic. */
    priority: integer("priority").notNull().default(100),
    active: boolean("active").notNull().default(true),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("partner_price_rules_partner_idx").on(t.partnerId, t.active, t.priority)],
);

/**
 * Promotions the partner writes themselves.
 *
 * Distinct from `promoCodes`, which is Ciao's marketing spend and is capped at
 * our commission so a platform campaign can never reach into a host's pocket.
 * This is the opposite: the partner's own money, their own decision, and the
 * cap is theirs to set. Eid offers, a first-booking discount, a quiet-Tuesday
 * rate — the things they already post on Instagram and then honour manually.
 *
 * A promotion with no code is automatic: it applies to anyone who qualifies,
 * which is what "10% off all September" actually means. Requiring a code for
 * that would mean the discount only reaches customers who already knew.
 */
export const partnerPromotions = pgTable(
  "partner_promotions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => users.id),
    /** Null = automatic. Uppercased and unique per partner when present. */
    code: varchar("code", { length: 24 }),
    labelAr: text("label_ar").notNull(),
    labelEn: text("label_en"),
    /** percent | fixed | free_addon */
    kind: varchar("kind", { length: 10 }).notNull().default("percent"),
    /** percent: basis points off (1500 = 15%). fixed: dirhams off. */
    valueBps: integer("value_bps").notNull().default(0),
    valueFlat: money("value_flat").notNull().default(0),
    freeAddonId: uuid("free_addon_id").references(() => partnerAddons.id),
    /** A ceiling on a percentage, so "20% off" cannot become a catastrophe. */
    maxDiscount: money("max_discount"),
    minSpend: money("min_spend").notNull().default(0),
    /** Empty = every service. */
    serviceIds: jsonb("service_ids").notNull().default(sql`'[]'::jsonb`),
    /** When the offer may be *used*. */
    fromDay: date("from_day", { mode: "string" }),
    toDay: date("to_day", { mode: "string" }),
    /** When the *stay or job* must fall — a September offer sold in June. */
    travelFromDay: date("travel_from_day", { mode: "string" }),
    travelToDay: date("travel_to_day", { mode: "string" }),
    /** Total redemptions allowed, and per customer. 0 = unlimited. */
    maxRedemptions: integer("max_redemptions").notNull().default(0),
    maxPerClient: integer("max_per_client").notNull().default(0),
    redemptions: integer("redemptions").notNull().default(0),
    firstTimeOnly: boolean("first_time_only").notNull().default(false),
    /** Show on the listing page, or keep it for people given the code. */
    publicOnListing: boolean("public_on_listing").notNull().default(true),
    active: boolean("active").notNull().default(true),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("partner_promotions_partner_idx").on(t.partnerId, t.active),
    uniqueIndex("partner_promotions_code_uq").on(t.partnerId, t.code),
  ],
);

/**
 * The questions a partner needs answered before they can do the work.
 *
 * This is the most under-modelled thing in every booking product and the most
 * requested thing by anyone who actually runs a service business. A make-up
 * artist needs to know the bride's skin tone and whether there is a mirror
 * with decent light. A caterer needs the head count and whether anyone is
 * coeliac. A chalet needs to know if a generator will be needed overnight.
 *
 * Today those get asked over WhatsApp, one at a time, over three days. Asking
 * them at booking is the difference between a job that runs and a job that
 * turns into six phone calls — and it is the single feature most likely to
 * make a partner say the app saves them time.
 */
export const partnerIntakeQuestions = pgTable(
  "partner_intake_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => users.id),
    serviceId: uuid("service_id").references(() => partnerServices.id),
    promptAr: text("prompt_ar").notNull(),
    promptEn: text("prompt_en"),
    helpAr: text("help_ar"),
    /** text | number | choice | boolean | date | phone */
    fieldType: varchar("field_type", { length: 8 }).notNull().default("text"),
    /** choice: [{ valueAr }] — kept as data so the partner writes the options. */
    options: jsonb("options").notNull().default(sql`'[]'::jsonb`),
    required: boolean("required").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("partner_intake_partner_idx").on(t.partnerId, t.active, t.sortOrder)],
);

/**
 * Costs, so the money screen can stop lying by omission.
 *
 * Revenue is not profit, and a console that only counts money coming in
 * teaches a partner nothing they did not already know. The moment it can also
 * hold the generator diesel, the assistant's day rate and the Instagram
 * boost, "did August actually make money" becomes answerable — and that is a
 * question nobody in this market can currently answer about their own
 * business.
 *
 * Deliberately not an accounting system. No double entry, no chart of
 * accounts, no VAT. A row is a date, an amount, a category and optionally the
 * job it belonged to. Anything more would be a product nobody fills in.
 */
export const partnerExpenses = pgTable(
  "partner_expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => users.id),
    jobId: uuid("job_id").references(() => partnerJobs.id),
    day: date("day", { mode: "string" }).notNull(),
    labelAr: text("label_ar").notNull(),
    /** staff|supplies|fuel|maintenance|marketing|rent|transport|fees|other */
    category: varchar("category", { length: 12 }).notNull().default("other"),
    amount: money("amount").notNull().default(0),
    /** Recurring costs entered once — rent, a salary. Expanded on read. */
    recurring: varchar("recurring", { length: 8 }), // null|monthly|weekly
    recurringUntil: date("recurring_until", { mode: "string" }),
    notesAr: text("notes_ar"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("partner_expenses_partner_idx").on(t.partnerId, t.day)],
);

/**
 * ───────────────── Partner sign-in: passwords and sessions ─────────────────
 *
 * The consumer app has no passwords and should not have any: a guest signs in
 * with a phone number and an OTP, which is right for someone who books twice a
 * summer. The partner app is a different product with different users, and the
 * reasons to depart are concrete:
 *
 *  - **A business has staff.** A hall's receptionist needs her own login, and
 *    the alternative today is that everyone shares the owner's phone. That is
 *    why "who cancelled that booking" is unanswerable in this market.
 *  - **OTP costs money per sign-in and needs signal at the moment of use.**
 *    Someone opening their diary six times a day during a power cut cannot
 *    depend on an SMS arriving each time.
 *  - **A password survives a changed SIM**, which a phone-only identity does
 *    not, and SIM turnover here is high.
 *
 * OTP does not go away — it becomes the recovery channel, which is the one job
 * it is unambiguously best at in Libya. Passkeys remain available on top.
 */
export const partnerCredentials = pgTable("partner_credentials", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  /**
   * `scrypt$N$r$p$salt$hash`, all base64url.
   *
   * scrypt because it is in Node's standard library — no dependency to keep
   * patched — and because it is memory-hard, which is the property that
   * matters when the threat is someone who has already taken a copy of the
   * table and is grinding it offline.
   */
  passwordHash: text("password_hash").notNull(),
  passwordSetAt: ts("password_set_at").notNull().defaultNow(),
  /**
   * Set when ops issues a credential rather than the owner choosing one, so
   * the first sign-in forces a change. A password somebody else knows is not
   * a password.
   */
  mustChange: boolean("must_change").notNull().default(false),
  /**
   * Lockout state. Throttling by IP alone does not protect one account from a
   * distributed guess, and a business account whose payouts can be redirected
   * is worth the effort of one.
   */
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastLoginAt: ts("last_login_at"),
  lastLoginIp: varchar("last_login_ip", { length: 45 }),
  createdAt: now(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * Partner sessions — deliberately a separate table from `refresh_tokens`.
 *
 * Sharing one table would mean a token minted for the consumer app could be
 * presented to the partner app and vice versa. Two tables and two JWT
 * audiences make that structurally impossible rather than a matter of
 * remembering to check, and they let a partner see and revoke their own
 * devices without touching their guest account.
 */
export const partnerSessions = pgTable(
  "partner_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    /** "Chrome on Android" — coarse on purpose; enough to recognise a device. */
    deviceLabel: text("device_label"),
    ip: varchar("ip", { length: 45 }),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    rotatedAt: ts("rotated_at"),
    revokedAt: ts("revoked_at"),
    createdAt: now(),
  },
  (t) => [
    index("partner_sessions_user_idx").on(t.userId),
    uniqueIndex("partner_sessions_token_uq").on(t.tokenHash),
  ],
);

/**
 * Business-console credentials — Ciao's own team (admin / ops / finance).
 *
 * Mirrors `partner_credentials` deliberately and shares none of its rows: the
 * console is a third product with its own origin, own sign-in and own `biz`
 * token audience. A person who is both a partner and on Ciao's team (it
 * happens — a founder who also lists a family chalet) holds two independent
 * passwords, and compromising one buys nothing on the other.
 */
export const bizCredentials = pgTable("biz_credentials", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  /** `scrypt$N$r$p$salt$hash` — same format and parameters as partner_credentials. */
  passwordHash: text("password_hash").notNull(),
  passwordSetAt: ts("password_set_at").notNull().defaultNow(),
  mustChange: boolean("must_change").notNull().default(false),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastLoginAt: ts("last_login_at"),
  lastLoginIp: varchar("last_login_ip", { length: 45 }),
  createdAt: now(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Console sessions — separate table so a refresh token cannot cross products. */
export const bizSessions = pgTable(
  "biz_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    deviceLabel: text("device_label"),
    ip: varchar("ip", { length: 45 }),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    rotatedAt: ts("rotated_at"),
    revokedAt: ts("revoked_at"),
    createdAt: now(),
  },
  (t) => [
    index("biz_sessions_user_idx").on(t.userId),
    uniqueIndex("biz_sessions_token_uq").on(t.tokenHash),
  ],
);

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
