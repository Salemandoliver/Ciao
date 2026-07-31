import { FEES } from "./domain.js";
import { priceBand } from "./domain.js";

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

export function quoteStay(
  cfg: PricingConfig,
  checkIn: Date,
  checkOut: Date,
  opts: { foundingHost?: boolean } = {},
): StayQuote {
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
  const deposit = Math.round((total * FEES.coastDepositBps) / 10000);
  const commissionBps = opts.foundingHost
    ? FEES.coastFoundingHostBps
    : FEES.coastCommissionBps;
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

export function quoteHall(packageTotal: number): HallQuote {
  const dateLockFee = Math.round((packageTotal * FEES.hallDateLockBps) / 10000);
  const commission = Math.min(
    Math.round((packageTotal * FEES.hallCommissionBps) / 10000),
    FEES.hallCommissionCapDirhams,
  );
  return {
    packageTotal,
    dateLockFee,
    commission: Math.min(commission, dateLockFee),
    hostShareOfDateLock: Math.max(0, dateLockFee - Math.min(commission, dateLockFee)),
  };
}
