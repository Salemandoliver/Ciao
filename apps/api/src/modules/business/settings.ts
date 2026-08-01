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
  /** Feature flags for the public app. */
  "features.wishlist": true,
  "features.map": true,
  "features.services": true,
  "features.reviews": true,
  /** Trust policy (§8.8, §11.6) — the numbers the trust surface publishes. */
  "trust.minReviewsForGuestRating": 3,
  "trust.disputeSlaHours": 48,
  "trust.reviewWindowDays": 14,
  /** Operational posture. */
  "ops.demoMode": true,
  "ops.acceptingBookings": true,
  /** Banner shown across the public app when set (power cuts, holidays, …). */
  "ops.announcementAr": "",
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
    case "home.hero": {
      const v = value as { images?: unknown[]; intervalMs?: number };
      if (!Array.isArray(v?.images) || v.images.length === 0)
        return "يجب أن تبقى صورة واحدة على الأقل في الواجهة";
      if (v.images.length > 8) return "الحد الأقصى 8 صور في الواجهة";
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
