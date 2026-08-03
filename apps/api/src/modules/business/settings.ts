/**
 * Platform control plane.
 *
 * Business decisions belong to the business, not to a deploy pipeline. A
 * founder in Tripoli who wants to drop the coast commission to 8% for Eid, put
 * a new photo on the home page, or switch the Sadad rail off because the bank
 * is down should be able to do it from the console in ten seconds.
 *
 * So: env vars hold secrets and infrastructure; THIS holds business config.
 * Every value has a typed default (the app must boot and serve correctly with
 * an empty settings table), every write is audited, and reads are cached
 * briefly so the hot path — listings, quotes, checkout — never pays for the
 * flexibility.
 */
import { eq, inArray } from "drizzle-orm";
import { FEES } from "@ciao/shared";
import { db, schema } from "../../db/client.js";

export interface HeroImage {
  /** Base path without the width suffix, e.g. "/hero-marina" → -800/-1600.webp */
  src: string;
  alt: string;
}

/**
 * The full settings surface. Adding a setting = adding a key here with its
 * default; the console renders it and the app reads it with no other plumbing.
 */
export const SETTING_DEFAULTS = {
  /**
   * Maps.
   *
   * `provider` is a control-plane decision, not a build-time one, because the
   * trade-off is commercial: Google's tiles are what everyone in Libya
   * recognises — which is the whole point when someone is drawing an area near
   * their parents' house — and they cost $7 per 1,000 map loads above a free
   * 10,000 a month. OpenStreetMap is free and thinner on Libyan detail.
   *
   * Setting `google` without a key configured falls back to OSM rather than
   * rendering a broken map, so this can be switched on the day the key exists
   * and the domain it is locked to.
   *
   * Note what is NOT here: any Places API usage. "What's nearby" is recorded
   * by our own agents on the verification visit (see listings/neighbours.ts) —
   * $32 per 1,000 calls, uncacheable under Google's terms, for data that
   * cannot tell a family whether a café will seat them.
   */
  "maps.provider": "osm" as "osm" | "google",
  /** Where a map opens when there is nothing better to centre on. */
  "maps.defaultCentre": { lat: 32.8872, lng: 13.1913, zoom: 11 },
  /** Let guests search by drawing an area rather than picking a city. */
  "maps.drawSearch": true,

  /** Home hero rotation (§3.2). Order is display order. */
  "home.hero": {
    intervalMs: 6000,
    images: [
      { src: "/hero-marina", alt: "واجهة طرابلس البحرية والحديقة المطلة على المتوسط" },
      { src: "/hero-castle", alt: "السرايا الحمراء في طرابلس القديمة" },
      { src: "/hero-lake", alt: "بحيرة أبو ستة وأفق طرابلس" },
      { src: "/hero-skyline", alt: "أبراج طرابلس الجديدة على الكورنيش" },
      { src: "/hero", alt: "غروب الشمس على مدينة ليبية" },
    ] as HeroImage[],
  },
  /** Commercial terms (§9.1). Basis points, so 1000 = 10%. */
  "fees.coastCommissionBps": FEES.coastCommissionBps,
  "fees.coastDepositBps": FEES.coastDepositBps,
  "fees.hallCommissionBps": FEES.hallCommissionBps,
  "fees.hallCommissionCapDirhams": FEES.hallCommissionCapDirhams,
  "fees.hallDateLockBps": FEES.hallDateLockBps,
  /** Which payment rails the checkout offers, in display order (§10.2). */
  "payments.enabledRails": ["sadad", "adfali", "local_card", "cash"],
  /**
   * Loyalty programme — every number the guest sees, operator-owned.
   *
   * These are commercial levers, not constants: a founder running an Eid
   * campaign should be able to double the points on a completed stay from the
   * console, and should be able to see what the programme currently promises
   * without reading the source.
   */
  "loyalty.enabled": true,
  /** Points per event. Keys match the earn reasons in loyalty.ts. */
  "loyalty.earnRules": {
    signup: 1000,
    email_verified: 500,
    // The number that sets the whole programme's scale: one completed stay
    // should buy a coffee at a partner. At 1000 points to the dinar that means
    // 5000 — roughly 0.4% of a typical booking, or 4% of our commission on it.
    // Anything less and points are a number that never becomes anything.
    stay_completed: 5000,
    review_written: 2000,
    referral_qualified: 10000,
    referred_welcome: 5000,
  } as Record<string, number>,
  /** Dirhams per point at redemption. 1 → 1000 points = 1 LYD. */
  "loyalty.pointToDirham": 1,
  /** Floor for converting to wallet credit — below this it's noise. */
  "loyalty.minRedeem": 5000,
  /**
   * Months before an earned point lapses. 0 means points never expire.
   * Expiry manages the liability; it is also the setting most likely to anger
   * customers, so the terms page states it plainly and every award shows its
   * own expiry date in the guest's history.
   */
  "loyalty.expiryMonths": 24,
  /** Spending points at partner businesses, and how long a voucher lives. */
  "loyalty.partnersEnabled": true,
  "loyalty.voucherMinutes": 30,
  /**
   * Wallet top-up — customers funding a balance with their own cash.
   * OFF by default and deliberately so: Libya has no e-money or escrow regime,
   * and holding customer funds is the single biggest regulatory exposure in
   * the model (§15.4). The code path exists and is tested; switching it on is
   * a founder decision that follows a legal opinion, not a deploy.
   */
  "wallet.topUpEnabled": false,
  /** Feature flags for the public app. */
  "features.wishlist": true,
  "features.map": true,
  "features.services": true,
  "features.reviews": true,
  "features.accounts": true,
  "features.loyalty": true,
  /** Trust policy (§8.8, §11.6) — the numbers the trust surface publishes. */
  "trust.minReviewsForGuestRating": 3,
  "trust.disputeSlaHours": 48,
  "trust.reviewWindowDays": 14,
  /**
   * The partner control panel — what supply-side businesses can do, and what
   * the intelligence subscription costs.
   *
   * These are commercial levers of exactly the kind the control plane exists
   * for. The Plus price in particular will be wrong the first time we set it,
   * and finding the right number should be a conversation in the console, not
   * a deploy.
   */
  "partner.directJobsEnabled": true,
  /**
   * Ciao Plus — market intelligence. Own numbers are always free (see the
   * `partnerSubscriptions` comment for why that line is where it is).
   */
  "partner.plusEnabled": true,
  /** 250 LYD/month, in dirhams. */
  "partner.plusPriceDirhams": 250_000,
  /**
   * Every partner gets a full season free. The trial is the onboarding
   * argument — a photographer who has seen what the market data tells her for
   * six months will not go back to guessing — and a season is the shortest
   * window in which this market's seasonality is visible at all.
   */
  "partner.plusTrialDays": 180,
  /**
   * The smallest number of comparable businesses a price benchmark may be
   * computed from. Below this the "market" is one or two identifiable
   * competitors and the panel is a way of reading their prices, not a
   * benchmark — so it is suppressed rather than shown thin.
   */
  "partner.benchmarkMinPeers": 5,
  /**
   * Hours a payout-destination change waits before it takes effect. The delay
   * is the anti-takeover control; the notification to the *old* channel is
   * what makes the delay useful (see `partnerPayoutAccounts`).
   */
  "partner.payoutChangeHoldHours": 24,
  /** Send the evening agenda message to partners who have it switched on. */
  "partner.agendaEnabled": true,
  /** Operational posture. */
  "ops.demoMode": true,
  "ops.acceptingBookings": true,
  /** Banner shown across the public app when set (power cuts, holidays, …). */
  "ops.announcementAr": "",

  /**
   * Messaging — the operational switches, not the credentials.
   *
   * Tokens and provider identity stay in env vars (secrets are not rows an
   * ops screen can read). What belongs here is what an operator changes at
   * 11pm with no deploy: shutting off a misbehaving channel, and the quiet
   * hours. A kill switch removes the rung from the ladder — WhatsApp off
   * means messages fall through to SMS, both off means the message journals
   * as skipped rather than pretending to send.
   */
  "messaging.whatsappEnabled": true,
  "messaging.smsEnabled": true,
  /** Quiet hours in Africa/Tripoli local time (§13.5). Critical messages pass. */
  "messaging.quietFromHour": 23,
  "messaging.quietToHour": 8,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

/**
 * Short-TTL process cache. Settings change rarely and are read constantly;
 * 10s means an operator sees their change effectively immediately while the
 * booking path stays a single map lookup.
 */
const CACHE_TTL_MS = 10_000;
let cache: Record<string, unknown> = {};
let cachedAt = 0;

async function loadAll(): Promise<Record<string, unknown>> {
  if (Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  try {
    const rows = await db.select().from(schema.platformSettings);
    const next: Record<string, unknown> = {};
    for (const r of rows) next[r.key] = r.value;
    cache = next;
    cachedAt = Date.now();
  } catch {
    // A settings outage must never take the marketplace down — fall through
    // to defaults rather than throwing into a booking request.
  }
  return cache;
}

/** Read one setting, falling back to its compiled-in default. */
export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<(typeof SETTING_DEFAULTS)[K]> {
  const all = await loadAll();
  return (all[key] ?? SETTING_DEFAULTS[key]) as (typeof SETTING_DEFAULTS)[K];
}

/** Read every setting merged over defaults — what the console renders. */
export async function getAllSettings(): Promise<Record<string, unknown>> {
  const stored = await loadAll();
  return { ...SETTING_DEFAULTS, ...stored };
}

/** Which keys are currently overridden (so the console can show "default"). */
export async function getOverriddenKeys(): Promise<string[]> {
  return Object.keys(await loadAll());
}

/**
 * Write settings and audit the change. Returns the keys that actually moved,
 * so the audit trail records intent rather than every no-op save.
 */
export async function setSettings(
  patch: Record<string, unknown>,
  actorId: string,
): Promise<string[]> {
  const keys = Object.keys(patch).filter((k) => (SETTING_KEYS as string[]).includes(k));
  if (keys.length === 0) return [];
  const before = await getAllSettings();
  const changed: string[] = [];

  for (const key of keys) {
    const next = patch[key];
    if (JSON.stringify(before[key]) === JSON.stringify(next)) continue;
    await db
      .insert(schema.platformSettings)
      .values({ key, value: next as object, updatedById: actorId })
      .onConflictDoUpdate({
        target: schema.platformSettings.key,
        set: { value: next as object, updatedById: actorId, updatedAt: new Date() },
      });
    changed.push(key);
    await db.insert(schema.auditLog).values({
      actorId,
      action: "settings.update",
      targetType: "setting",
      targetId: key,
      detail: { from: before[key], to: next },
    });
  }
  cachedAt = 0; // next read is fresh
  return changed;
}

/** Reset keys to their compiled defaults (delete the override rows). */
export async function resetSettings(keys: string[], actorId: string): Promise<string[]> {
  const valid = keys.filter((k) => (SETTING_KEYS as string[]).includes(k));
  if (valid.length === 0) return [];
  await db.delete(schema.platformSettings).where(inArray(schema.platformSettings.key, valid));
  for (const key of valid) {
    await db.insert(schema.auditLog).values({
      actorId,
      action: "settings.reset",
      targetType: "setting",
      targetId: key,
    });
  }
  cachedAt = 0;
  return valid;
}

/** Test/worker hook — drop the cache after an out-of-band write. */
export function invalidateSettingsCache(): void {
  cachedAt = 0;
}

/** Effective fee schedule: defaults overridden by the control plane. */
export async function effectiveFees() {
  const all = await getAllSettings();
  return {
    ...FEES,
    coastCommissionBps: Number(all["fees.coastCommissionBps"]),
    coastDepositBps: Number(all["fees.coastDepositBps"]),
    hallCommissionBps: Number(all["fees.hallCommissionBps"]),
    hallCommissionCapDirhams: Number(all["fees.hallCommissionCapDirhams"]),
    hallDateLockBps: Number(all["fees.hallDateLockBps"]),
  };
}

/** Public subset — safe to serve unauthenticated to the web app. */
export async function publicSettings() {
  const all = await getAllSettings();
  return {
    hero: all["home.hero"],
    features: {
      wishlist: all["features.wishlist"],
      map: all["features.map"],
      services: all["features.services"],
      reviews: all["features.reviews"],
      accounts: all["features.accounts"],
      loyalty: all["features.loyalty"],
    },
    maps: {
      provider: all["maps.provider"],
      defaultCentre: all["maps.defaultCentre"],
      drawSearch: all["maps.drawSearch"],
    },
    paymentRails: all["payments.enabledRails"],
    loyalty: {
      enabled: all["loyalty.enabled"],
      earnRules: all["loyalty.earnRules"],
      pointToDirham: all["loyalty.pointToDirham"],
      minRedeem: all["loyalty.minRedeem"],
      expiryMonths: all["loyalty.expiryMonths"],
      partnersEnabled: all["loyalty.partnersEnabled"],
    },
    announcementAr: all["ops.announcementAr"],
    acceptingBookings: all["ops.acceptingBookings"],
    demoMode: all["ops.demoMode"],
  };
}

/** Guard rails so the console cannot save something that breaks pricing. */
export function validateSetting(key: string, value: unknown): string | null {
  switch (key) {
    case "fees.coastCommissionBps":
    case "fees.hallCommissionBps":
      return typeof value === "number" && value >= 0 && value <= 3000
        ? null
        : "العمولة يجب أن تكون بين 0% و30%";
    case "fees.coastDepositBps":
    case "fees.hallDateLockBps":
      // Below the commission the deposit can't cover our fee (§9.1).
      return typeof value === "number" && value >= 500 && value <= 5000
        ? null
        : "العربون يجب أن يكون بين 5% و50%";
    case "trust.minReviewsForGuestRating":
      return typeof value === "number" && value >= 1 && value <= 20
        ? null
        : "الحد الأدنى للتقييمات بين 1 و20";
    case "trust.disputeSlaHours":
      return typeof value === "number" && value >= 4 && value <= 168
        ? null
        : "مهلة حل الشكوى بين 4 و168 ساعة";
    case "messaging.quietFromHour":
    case "messaging.quietToHour":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23
        ? null
        : "ساعة الهدوء يجب أن تكون بين 0 و23";
    case "home.hero": {
      const v = value as { images?: unknown[]; intervalMs?: number };
      if (!Array.isArray(v?.images) || v.images.length === 0)
        return "يجب أن تبقى صورة واحدة على الأقل في الواجهة";
      if (v.images.length > 8) return "الحد الأقصى 8 صور في الواجهة";
      return null;
    }
    case "loyalty.pointToDirham":
      return typeof value === "number" && value > 0 && value <= 100
        ? null
        : "قيمة النقطة يجب أن تكون بين 1 و100 درهم";
    case "loyalty.minRedeem":
      return typeof value === "number" && value >= 100 && value <= 100_000
        ? null
        : "الحد الأدنى للتحويل بين 100 و100000 نقطة";
    case "loyalty.expiryMonths":
      return typeof value === "number" && value >= 0 && value <= 120
        ? null
        : "مدة الصلاحية بين 0 (بلا انتهاء) و120 شهرًا";
    case "loyalty.voucherMinutes":
      return typeof value === "number" && value >= 5 && value <= 1440
        ? null
        : "مدة صلاحية القسيمة بين 5 دقائق و24 ساعة";
    case "partner.plusPriceDirhams":
      return typeof value === "number" && value >= 0 && value <= 5_000_000
        ? null
        : "سعر تشاو بلس بين 0 و5000 د.ل شهريًا";
    case "partner.plusTrialDays":
      return typeof value === "number" && value >= 0 && value <= 730
        ? null
        : "مدة التجربة بين 0 و730 يومًا";
    case "partner.benchmarkMinPeers":
      /*
       * The floor of 3 is not a taste preference. Below three comparable
       * businesses a median is a competitor's price with a hat on, and a
       * partner could read a rival's rate off our own dashboard.
       */
      return typeof value === "number" && value >= 3 && value <= 50
        ? null
        : "الحد الأدنى للمقارنة بين 3 و50 نشاطًا";
    case "partner.payoutChangeHoldHours":
      return typeof value === "number" && value >= 0 && value <= 168
        ? null
        : "مهلة تغيير حساب التحويل بين 0 و168 ساعة";
    case "loyalty.earnRules": {
      const v = value as Record<string, unknown>;
      if (!v || typeof v !== "object") return "قواعد الكسب غير صالحة";
      for (const [k, n] of Object.entries(v))
        if (typeof n !== "number" || n < 0 || n > 100_000)
          return `قيمة غير صالحة للقاعدة ${k}`;
      return null;
    }
    case "payments.enabledRails":
      return Array.isArray(value) && value.length > 0
        ? null
        : "يجب تفعيل وسيلة دفع واحدة على الأقل";
    default:
      return null;
  }
}

/** Cross-field check: a deposit that can't cover commission breaks the model. */
export async function validateCoherence(next: Record<string, unknown>): Promise<string | null> {
  const all = { ...(await getAllSettings()), ...next };
  const coastDeposit = Number(all["fees.coastDepositBps"]);
  const coastCommission = Number(all["fees.coastCommissionBps"]);
  if (coastDeposit < coastCommission)
    return "العربون أقل من العمولة — لن يغطي العربون عمولة تشاو (§9.1)";
  const hallLock = Number(all["fees.hallDateLockBps"]);
  const hallCommission = Number(all["fees.hallCommissionBps"]);
  if (hallLock < hallCommission)
    return "مقدّم حجز القاعة أقل من العمولة — لن يغطي عمولة تشاو";
  return null;
}

/** Used by the settings route to describe a key to the console UI. */
export async function settingRow(key: SettingKey) {
  const all = await getAllSettings();
  const overridden = (await getOverriddenKeys()).includes(key);
  const [row] = overridden
    ? await db
        .select({ updatedAt: schema.platformSettings.updatedAt })
        .from(schema.platformSettings)
        .where(eq(schema.platformSettings.key, key))
        .limit(1)
    : [];
  return {
    key,
    value: all[key],
    default: SETTING_DEFAULTS[key],
    overridden,
    updatedAt: row?.updatedAt ?? null,
  };
}
