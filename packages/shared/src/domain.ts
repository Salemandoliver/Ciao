/** Shared domain constants & types — design doc §5, §8, §9, §13.2. */

export type UserRole = "guest" | "host" | "agent" | "ops" | "admin";

export type VenueType = "coast" | "hall";

export type VerificationGrade =
  | "deed"
  | "utility_bill_attestation"
  | "local_attestation"
  | "unverified";

export type PaymentRail =
  | "sadad"
  | "adfali"
  | "local_card"
  | "tlync"
  | "mpgs"
  | "cash_logged"
  | "credit";

export type PaymentProviderName = "plutu" | "dpay" | "tlync" | "mock";

export type CalendarState = "open" | "blocked" | "booked" | "held";

export type SessionKind =
  | "night" // stay inventory
  | "day_use" // 9:00–19:00 style sessions
  | "mens_evening"
  | "womens_evening"
  | "full_day"
  | "visit_slot";

/** Fees — §9.2 launch hypothesis. Basis points where relevant. */
export const FEES = {
  coastCommissionBps: 1000, // 10% of booking value
  coastFoundingHostBps: 500, // 5% first-season promo (first 40 hosts)
  hallCommissionBps: 700, // 7% of package value
  hallCommissionCapDirhams: 2_500_000, // LYD 2,500 in dirhams
  coastDepositBps: 2000, // 20% deposit
  hallDateLockBps: 1000, // 10% date-lock
  exchangeTransferFlatDirhams: 200_000, // LYD 200 flat (150–300 band)
  noShowPlatformShareBps: 1000, // our 10% of forfeited deposit
  refundCreditBonusBps: 500, // +5% credit-first bonus (§10.6)
} as const;

/** All money is integer dirhams (LYD minor units, 1 LYD = 1000 dirhams). §13.2 */
export const DIRHAMS_PER_LYD = 1000;

export function lyd(amountDirhams: number): string {
  return (amountDirhams / DIRHAMS_PER_LYD).toLocaleString("en-US", {
    maximumFractionDigits: 3,
  });
}

/** Weekend in Libya is Friday–Saturday; Thursday is the wedding-eve band. §9.6 */
export function priceBand(date: Date): "weekday" | "thursday" | "weekend" {
  const day = date.getUTCDay(); // 0 Sun ... 6 Sat
  if (day === 4) return "thursday";
  if (day === 5 || day === 6) return "weekend";
  return "weekday";
}

/** Amenity truth-table shape (§8.5) — present/absent/condition, not free text. */
export interface AmenityRecord {
  key: string; // e.g. "generator", "pool", "water_tank", "bride_suite"
  present: boolean;
  condition?: "good" | "fair" | "poor";
  detail?: string; // "12 KVA diesel, fuel included"
  verifiedAt?: string; // ISO date the agent tested it
}

export interface PrivacyAssessment {
  walledPool: boolean;
  overlooked: boolean;
  separateFamilyEntrance: boolean;
  score: number; // 0–100 computed
}

export function privacyScore(a: Omit<PrivacyAssessment, "score">): number {
  let s = 0;
  if (a.walledPool) s += 45;
  if (!a.overlooked) s += 40;
  if (a.separateFamilyEntrance) s += 15;
  return s;
}

/** Reliability score inputs — §11.4 */
export interface ReliabilityInputs {
  confirmationRate: number; // 0–1
  medianResponseMinutes: number;
  attestationStreakWeeks: number;
  doubleBookingIncidents: number;
  cancellationStrikes: number;
  accuracyScore: number; // 0–5 review dimension
}

export function reliabilityScore(r: ReliabilityInputs): number {
  let s = 50;
  s += Math.round(30 * r.confirmationRate);
  s += r.medianResponseMinutes <= 30 ? 10 : r.medianResponseMinutes <= 120 ? 5 : 0;
  s += Math.min(10, r.attestationStreakWeeks);
  s -= 15 * r.doubleBookingIncidents;
  s -= 10 * r.cancellationStrikes;
  s += Math.round((r.accuracyScore - 3) * 5);
  return Math.max(0, Math.min(100, s));
}
