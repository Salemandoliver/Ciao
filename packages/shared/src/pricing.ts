import { FEES } from "./domain";
import { priceBand } from "./domain";

/** Pricing engine — §9.6. All amounts in integer dirhams. */

export interface PricingConfig {
  baseNightly: number; // dirhams
  weekendMultiplierBps: number; // e.g. 12500 = 1.25x
  thursdayMultiplierBps: number; // wedding-eve band
  seasonMultiplierBps: number; // set per city band; 10000 = 1x
  dayUsePrice?: number;
  extraGuestFee?: number;
}

export function nightlyPrice(cfg: PricingConfig, date: Date): number {
  const band = priceBand(date);
  let bps = 10000;
  if (band === "weekend") bps = cfg.weekendMultiplierBps;
  else if (band === "thursday") bps = cfg.thursdayMultiplierBps;
  const withBand = Math.round((cfg.baseNightly * bps) / 10000);
  return Math.round((withBand * cfg.seasonMultiplierBps) / 10000);
}

export interface StayQuote {
  nights: { date: string; price: number }[];
  total: number;
  deposit: number;
  balanceOnArrival: number;
  commission: number; // withheld from deposit at settlement (§9.1)
  hostShareOfDeposit: number;
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
  opts: { foundingHost?: boolean; fees?: Partial<FeeSchedule> } = {},
): StayQuote {
  const fees = { ...FEES, ...opts.fees };
  const nights: { date: string; price: number }[] = [];
  const d = new Date(checkIn);
  while (d < checkOut) {
    nights.push({
      date: d.toISOString().slice(0, 10),
      price: nightlyPrice(cfg, d),
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const total = nights.reduce((s, n) => s + n.price, 0);
  const deposit = Math.round((total * fees.coastDepositBps) / 10000);
  const commissionBps = opts.foundingHost
    ? fees.coastFoundingHostBps
    : fees.coastCommissionBps;
  const commission = Math.round((total * commissionBps) / 10000);
  return {
    nights,
    total,
    deposit,
    balanceOnArrival: total - deposit,
    commission: Math.min(commission, deposit), // commission is carried by the deposit
    hostShareOfDeposit: Math.max(0, deposit - Math.min(commission, deposit)),
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
