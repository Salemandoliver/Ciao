import { FEES } from "./domain";
import { priceBand } from "./domain";

/**
 * Pricing engine — §9.6. All amounts in integer dirhams.
 *
 * Rewritten August 2026 against a real rate card (Lancaster Al Salam, Sabratha)
 * rather than against the modelled chalet in §16.4. Three things that price
 * card taught us, each of which the previous engine got wrong:
 *
 * **A published rate covers a number of guests, and that number is not the
 * capacity.** Lancaster's villa sleeps six and its rate covers two; guests
 * three through six are 300 د.ل each. `includedGuests` is therefore a separate
 * field from `maxGuests`, and `extraGuestFee` — a column that existed and was
 * read by nothing — is now actually charged.
 *
 * **The band multiplies the base, not the total.** Their weekend is a flat
 * +600 د.ل however many guests are staying, which as a ratio is 1.1667× at two
 * guests and 1.125× at six. Multiply after adding the guest supplement and a
 * six-guest weekend night quotes 5,600 instead of 5,400 — 200 د.ل a night too
 * much. Multiply the base and *then* add the supplement and every cell of the
 * published table reproduces exactly. There is a test that asserts all eight.
 *
 * **Children are not small adults.** Under five free, six to ten half price is
 * the standard Libyan family rate and it is most of this market's demand. A
 * party of two adults and three young children priced as five adults is a
 * quote that is wrong in the direction that loses the booking.
 */

/** What the nightly rate feeds you. Descriptive, but it decides comparability. */
export type BoardBasis = "room_only" | "breakfast" | "half_board" | "full_board";

export const BOARD_BASES: readonly BoardBasis[] = [
  "room_only",
  "breakfast",
  "half_board",
  "full_board",
] as const;

/**
 * Children's pricing, expressed so it cannot have a hole in it.
 *
 * Lancaster's own wording — "under 5 free, from 6 to 10 half price" — leaves a
 * five-year-old belonging to neither rule. That is not pedantry; it is an
 * argument at the front desk in front of a tired family, which is exactly the
 * kind of moment this platform exists to remove. So the policy is two upper
 * bounds rather than two ranges: an age is free if it is below `freeUnder`,
 * reduced if it is below `reducedUnder`, and full price otherwise. Every age
 * lands in exactly one band by construction.
 */
export interface ChildPolicy {
  /** Ages strictly below this are free. Lancaster: 6 (so 0–5 free). */
  freeUnder: number;
  /** Ages strictly below this pay `reducedBps`. Lancaster: 11 (so 6–10). */
  reducedUnder: number;
  /** Share of the per-guest supplement a reduced child pays. 5000 = half. */
  reducedBps: number;
}

export const DEFAULT_CHILD_POLICY: ChildPolicy = {
  freeUnder: 6,
  reducedUnder: 11,
  reducedBps: 5000,
};

/** A child policy is only usable if the bands are ordered. */
export function childPolicyIsSane(p: ChildPolicy): boolean {
  return (
    p.freeUnder >= 0 &&
    p.reducedUnder >= p.freeUnder &&
    p.reducedBps >= 0 &&
    p.reducedBps <= 10000
  );
}

/**
 * A price for a range of dates — the "عرض خاص من ١٠/٨ إلى ٢٠/٨" case.
 *
 * This replaces `baseNightly` for the nights it covers. Bands still apply on
 * top by default, because a promotional week still has expensive weekends;
 * `flat` switches that off for the operator who means one price, full stop.
 *
 * `minNights` rides on the window because peak-season minimums are a property
 * of the season, not of the property.
 */
export interface RateWindow {
  /** ISO date, inclusive. */
  startDate: string;
  /** ISO date, inclusive. */
  endDate: string;
  /** Dirhams. Replaces the listing's base for these nights. */
  nightly: number;
  /** When true the weekend/Thursday bands do not apply inside the window. */
  flat?: boolean;
  minNights?: number;
  labelAr?: string;
  labelEn?: string;
}

export interface PricingConfig {
  baseNightly: number; // dirhams
  weekendMultiplierBps: number; // e.g. 12500 = 1.25x
  thursdayMultiplierBps: number; // wedding-eve band
  /**
   * A flat weekend supplement in dirhams, used *instead of* the multiplier
   * when set — and it is the shape this market actually publishes.
   *
   * Lancaster's weekend is +600 د.ل however many guests are staying. As a
   * ratio that is 4,200/3,600 = 7/6, which is 11666.67 basis points: not
   * representable. Rounding to 11667 quotes 4,200.12 and rounding to 11666
   * quotes 4,199.76 — either way the number on our page stops matching the
   * number on their poster, and "the price you see is the price you pay" is
   * the entire product.
   *
   * So the engine holds both shapes and the operator picks the one their price
   * list is written in, rather than us forcing every venue in Libya through an
   * arithmetic that cannot express what they charge.
   */
  weekendSupplement?: number;
  thursdaySupplement?: number;
  seasonMultiplierBps: number; // set per city band; 10000 = 1x
  dayUsePrice?: number;
  /**
   * How many guests the nightly rate already covers. Defaults to "everyone",
   * which is what every listing built before August 2026 meant, so existing
   * data keeps quoting exactly what it quoted yesterday.
   */
  includedGuests?: number;
  /** Per guest beyond `includedGuests`, per night. */
  extraGuestFee?: number;
  /** Per extra bed, per night. Lancaster: 150 د.ل. */
  extraBedPrice?: number;
  minNights?: number;
  childPolicy?: ChildPolicy;
  rates?: RateWindow[];
  board?: BoardBasis;
}

/** Who is actually coming. Ages, not a head count — the ages decide the price. */
export interface Party {
  adults: number;
  /** One entry per child, their age in years at check-in. */
  childAges?: number[];
  extraBeds?: number;
}

export const EMPTY_PARTY: Party = { adults: 0, childAges: [], extraBeds: 0 };

/** Every head, whatever they pay. Capacity counts people, not revenue. */
export function partySize(p: Party): number {
  return p.adults + (p.childAges?.length ?? 0);
}

/**
 * What share of the per-guest supplement each person owes, biggest first.
 *
 * Sorted descending on purpose. The included guests are consumed by the most
 * expensive people in the party, so the ones who spill over the included count
 * are the discounted children. That is both the cheaper reading for the family
 * and the one a receptionist would give you out loud: "the rate covers two,
 * the children are extra at half".
 */
export function guestWeights(p: Party, policy: ChildPolicy): number[] {
  const weights = Array<number>(p.adults).fill(1);
  for (const age of p.childAges ?? []) {
    if (age < policy.freeUnder) weights.push(0);
    else if (age < policy.reducedUnder) weights.push(policy.reducedBps / 10000);
    else weights.push(1);
  }
  return weights.sort((a, b) => b - a);
}

/** The rate window covering a date, if any. Later windows win a tie. */
export function rateWindowFor(cfg: PricingConfig, iso: string): RateWindow | undefined {
  let found: RateWindow | undefined;
  for (const w of cfg.rates ?? []) {
    if (iso >= w.startDate && iso <= w.endDate) found = w;
  }
  return found;
}

/** The room rate for one night, before any guest supplement. */
export function nightlyPrice(cfg: PricingConfig, date: Date): number {
  const iso = date.toISOString().slice(0, 10);
  const window = rateWindowFor(cfg, iso);
  const base = window ? window.nightly : cfg.baseNightly;

  let withBand = base;
  if (!(window && window.flat)) {
    const band = priceBand(date);
    /*
     * A supplement wins over a multiplier when both are present, because a
     * supplement is what somebody typed off their own price list and a
     * multiplier is what our schema defaulted to.
     */
    if (band === "weekend") {
      withBand =
        cfg.weekendSupplement != null
          ? base + cfg.weekendSupplement
          : Math.round((base * cfg.weekendMultiplierBps) / 10000);
    } else if (band === "thursday") {
      withBand =
        cfg.thursdaySupplement != null
          ? base + cfg.thursdaySupplement
          : Math.round((base * cfg.thursdayMultiplierBps) / 10000);
    }
  }
  return Math.round((withBand * cfg.seasonMultiplierBps) / 10000);
}

export interface QuotedNight {
  date: string;
  /** The room, banded. */
  room: number;
  /** The guest supplement for this night. */
  guests: number;
  /** Extra beds for this night. */
  beds: number;
  /** room + guests + beds. */
  price: number;
  /** Set when a rate window applied, so the UI can name the offer. */
  offerAr?: string;
  offerEn?: string;
}

export interface StayQuote {
  nights: QuotedNight[];
  /** Rooms only, across the stay. */
  roomTotal: number;
  /** Guest supplements across the stay. */
  guestTotal: number;
  /** Extra beds across the stay. */
  bedTotal: number;
  total: number;
  deposit: number;
  /** True when the percentage deposit was reduced by the ceiling (§10.x). */
  depositCapped: boolean;
  balanceOnArrival: number;
  commission: number; // withheld from deposit at settlement (§9.1)
  hostShareOfDeposit: number;
  /** The longest minimum the stay has to satisfy; the caller enforces it. */
  requiredMinNights: number;
  /** How the party was priced, so a receipt can show its working. */
  party: {
    adults: number;
    childrenFree: number;
    childrenReduced: number;
    childrenFull: number;
    chargedGuests: number;
    includedGuests: number;
  };
  board?: BoardBasis;
}

/**
 * Fee overrides. Commercial terms are operator-controlled at runtime (the
 * business console writes them to the control plane), so every pricing call
 * accepts the effective schedule. Omitting it uses the compiled-in defaults,
 * which keeps the pure functions testable and keeps the app correct if the
 * settings table is ever unreachable.
 */
export interface FeeSchedule {
  coastDepositBps: number;
  coastDepositCapDirhams: number;
  coastCommissionBps: number;
  coastFoundingHostBps: number;
  hallDateLockBps: number;
  hallCommissionBps: number;
  hallCommissionCapDirhams: number;
}

export function quoteStay(
  cfg: PricingConfig,
  checkIn: Date,
  checkOut: Date,
  opts: { party?: Party; foundingHost?: boolean; fees?: Partial<FeeSchedule> } = {},
): StayQuote {
  const fees = { ...FEES, ...opts.fees };
  const policy = cfg.childPolicy ?? DEFAULT_CHILD_POLICY;
  const party = opts.party ?? EMPTY_PARTY;

  /*
   * `includedGuests` defaults to the whole party rather than to 1. Every
   * listing that existed before this field did meant "the price is the price",
   * and a default of 1 would have silently repriced the entire catalogue the
   * moment the checkout started sending a guest count.
   */
  const size = partySize(party);
  const included = cfg.includedGuests ?? size;
  const extraFee = cfg.extraGuestFee ?? 0;

  const weights = guestWeights(party, policy);
  const spill = weights.slice(Math.max(0, included));
  const chargedUnits = spill.reduce((s, w) => s + w, 0);
  const guestPerNight = Math.round(extraFee * chargedUnits);
  const bedsPerNight = Math.round((cfg.extraBedPrice ?? 0) * (party.extraBeds ?? 0));

  const nights: QuotedNight[] = [];
  let requiredMinNights = cfg.minNights ?? 1;
  const d = new Date(checkIn);
  while (d < checkOut) {
    const iso = d.toISOString().slice(0, 10);
    const window = rateWindowFor(cfg, iso);
    if (window?.minNights) requiredMinNights = Math.max(requiredMinNights, window.minNights);
    const room = nightlyPrice(cfg, d);
    nights.push({
      date: iso,
      room,
      guests: guestPerNight,
      beds: bedsPerNight,
      price: room + guestPerNight + bedsPerNight,
      ...(window?.labelAr ? { offerAr: window.labelAr } : {}),
      ...(window?.labelEn ? { offerEn: window.labelEn } : {}),
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const roomTotal = nights.reduce((s, n) => s + n.room, 0);
  const guestTotal = nights.reduce((s, n) => s + n.guests, 0);
  const bedTotal = nights.reduce((s, n) => s + n.beds, 0);
  const total = roomTotal + guestTotal + bedTotal;

  const commissionBps = opts.foundingHost
    ? fees.coastFoundingHostBps
    : fees.coastCommissionBps;
  const commission = Math.round((total * commissionBps) / 10000);

  /*
   * The deposit, with a ceiling — and a floor underneath the ceiling.
   *
   * Twenty per cent of a 14,400 د.ل villa weekend is 2,880 د.ل asked for in
   * one push on Sadad, from someone who met this platform ten minutes ago.
   * That is a conversion problem and possibly a rail problem, so the operator
   * can cap it.
   *
   * But the cap cannot go below our own commission, because the commission is
   * carried by the deposit (§9.1) and Ciao never invoices a host for it. On a
   * week-long booking the commission alone exceeds any sane ceiling, and the
   * honest answer is that the deposit rises to meet it rather than that we
   * quietly stop earning. `depositCapped` tells the UI to explain itself.
   */
  const pctDeposit = Math.round((total * fees.coastDepositBps) / 10000);
  const cap = fees.coastDepositCapDirhams > 0 ? fees.coastDepositCapDirhams : Infinity;
  const ceilinged = Math.min(pctDeposit, cap);
  const deposit = Math.min(total, Math.max(ceilinged, commission));

  let childrenFree = 0;
  let childrenReduced = 0;
  let childrenFull = 0;
  for (const age of party.childAges ?? []) {
    if (age < policy.freeUnder) childrenFree += 1;
    else if (age < policy.reducedUnder) childrenReduced += 1;
    else childrenFull += 1;
  }

  return {
    nights,
    roomTotal,
    guestTotal,
    bedTotal,
    total,
    deposit,
    depositCapped: deposit < pctDeposit,
    balanceOnArrival: total - deposit,
    commission: Math.min(commission, deposit), // commission is carried by the deposit
    hostShareOfDeposit: Math.max(0, deposit - Math.min(commission, deposit)),
    requiredMinNights,
    party: {
      adults: party.adults,
      childrenFree,
      childrenReduced,
      childrenFull,
      chargedGuests: chargedUnits,
      includedGuests: included,
    },
    ...(cfg.board ? { board: cfg.board } : {}),
  };
}

export interface HallQuote {
  packageTotal: number;
  dateLockFee: number;
  commission: number;
  hostShareOfDateLock: number;
}

export function quoteHall(
  packageTotal: number,
  feeOverrides: Partial<FeeSchedule> = {},
): HallQuote {
  const fees = { ...FEES, ...feeOverrides };
  const dateLockFee = Math.round((packageTotal * fees.hallDateLockBps) / 10000);
  const commission = Math.min(
    Math.round((packageTotal * fees.hallCommissionBps) / 10000),
    fees.hallCommissionCapDirhams,
  );
  return {
    packageTotal,
    dateLockFee,
    commission: Math.min(commission, dateLockFee),
    hostShareOfDateLock: Math.max(0, dateLockFee - Math.min(commission, dateLockFee)),
  };
}
