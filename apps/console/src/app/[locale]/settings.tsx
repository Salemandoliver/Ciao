"use client";
/**
 * Settings — the control plane.
 *
 * These values steer the live public app: what guests are charged, which
 * payment rails appear at checkout, which photos lead the home page, whether
 * we're taking bookings at all. So the screen is built to make the
 * consequences visible: every field says what it does in plain language, money
 * fields show the percentage rather than basis points, and anything currently
 * overridden is marked so an operator can tell "we chose this" from "this is
 * the default".
 *
 * The English here is held to a higher bar than the rest of the console. Every
 * label and every line of help text is a switch that changes what the public
 * app does, so the English says exactly what the Arabic says — same meaning,
 * same warning, same force. A softened warning on this screen is an incident
 * waiting to happen.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { PAYMENT_RAILS, fmtNum, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Pill, Section } from "./lib";
import { HeroSettings } from "./hero-settings";

interface SettingRow {
  key: string;
  value: unknown;
  default: unknown;
  overridden: boolean;
  updatedAt: string | null;
}

type Kind = "bps" | "money" | "bool" | "number" | "text" | "rails";

/** How each key is edited. Language-independent, so it sits outside `copy`. */
const KINDS: Record<string, Kind> = {
  "fees.coastCommissionBps": "bps",
  "fees.coastDepositBps": "bps",
  "fees.hallCommissionBps": "bps",
  "fees.hallCommissionCapDirhams": "money",
  "fees.hallDateLockBps": "bps",
  "payments.enabledRails": "rails",
  "features.wishlist": "bool",
  "features.map": "bool",
  "features.services": "bool",
  "features.reviews": "bool",
  "trust.minReviewsForGuestRating": "number",
  "trust.disputeSlaHours": "number",
  "trust.reviewWindowDays": "number",
  "ops.demoMode": "bool",
  "ops.acceptingBookings": "bool",
  "ops.announcementAr": "text",
};

/** Rail order as offered in the picker; the labels come from shared vocab. */
const RAIL_KEYS = ["sadad", "adfali", "local_card", "tlync", "cash"];

type Meta = { label: string; help: string };

const copy = {
  ar: {
    meta: {
      "fees.coastCommissionBps": {
        label: "عمولة تشاو — الشاليهات والاستراحات",
        help: "نسبة من قيمة الحجز. مدمجة في العربون، ولا تظهر للضيف كرسم منفصل.",
      },
      "fees.coastDepositBps": {
        label: "العربون — الشاليهات والاستراحات",
        help: "ما يدفعه الضيف مقدّمًا لقفل التاريخ. يجب أن يبقى أعلى من العمولة.",
      },
      "fees.hallCommissionBps": {
        label: "عمولة تشاو — قاعات الأفراح",
        help: "نسبة من قيمة الباقة، بحد أقصى ثابت أدناه.",
      },
      "fees.hallCommissionCapDirhams": {
        label: "الحد الأقصى لعمولة القاعة",
        help: "سقف بالدينار مهما بلغت قيمة الباقة.",
      },
      "fees.hallDateLockBps": {
        label: "مقدّم قفل تاريخ القاعة",
        help: "ما يدفعه العميل لحجز التاريخ قبل الزيارة.",
      },
      "payments.enabledRails": {
        label: "وسائل الدفع المعروضة",
        help: "ترتيب الظهور في صفحة الدفع. أطفئ وسيلة متعثرة بدل إيقاف الحجز كله.",
      },
      "features.wishlist": { label: "المفضلة (القلوب)", help: "إظهار زر الحفظ في البطاقات." },
      "features.map": { label: "البحث بالخريطة", help: "إظهار الخريطة بجانب النتائج." },
      "features.services": { label: "قطاع الخدمات", help: "إظهار تبويب «خدمات» في التطبيق." },
      "features.reviews": { label: "التقييمات والشكاوى", help: "إظهار النجوم ونافذة التقييمات." },
      "trust.minReviewsForGuestRating": {
        label: "الحد الأدنى للتقييمات قبل اعتماد رأي الضيوف",
        help: "قبل هذا العدد يظهر تقييم تشاو الميداني بدل متوسط الضيوف.",
      },
      "trust.disputeSlaHours": {
        label: "مهلة حل الشكوى (ساعة)",
        help: "الوعد المنشور للعملاء. تغييره يغيّر ما نَعِد به علنًا.",
      },
      "trust.reviewWindowDays": {
        label: "مهلة كتابة التقييم (يوم)",
        help: "بعدها يُغلق باب التقييم لذلك الحجز.",
      },
      "ops.demoMode": {
        label: "وضع العرض التجريبي",
        help: "يُظهر رمز الدخول على الشاشة. يجب إطفاؤه قبل أول عميل حقيقي.",
      },
      "ops.acceptingBookings": {
        label: "استقبال الحجوزات",
        help: "إطفاؤه يوقف الحجز الجديد ويُبقي التطبيق يعمل للتصفح.",
      },
      "ops.announcementAr": {
        label: "شريط إعلان للعموم",
        help: "يظهر أعلى التطبيق. اتركه فارغًا لإخفائه.",
      },
    } as Record<string, Meta>,
    readOnly: "أنت تشاهد الإعدادات للقراءة فقط — التعديل يحتاج صلاحية مدير.",
    loadFailed: "تعذر تحميل الإعدادات",
    saved: (n: number) => `✅ حُفظ ${n} إعداد — يسري على التطبيق خلال ثوانٍ`,
    noChanges: "لا تغييرات",
    adminOnly: "تعديل الإعدادات للمدير فقط",
    saveFailed: "تعذر الحفظ",
    wasReset: "✅ أُعيد للقيمة الافتراضية",
    resetFailed: "تعذر الاسترجاع",
    resetToDefault: "إعادة للافتراضي",
    isDefault: "افتراضي",
    on: "مُفعّل",
    off: "مُعطّل",
    percent: "٪",
    lyd: "د.ل",
    defaultIs: (pct: string) => `الافتراضي ${pct}٪`,
    announcementPlaceholder: "اتركه فارغًا لإخفاء الشريط",
    saveN: (n: number) => `حفظ ${n} تغيير`,
    discard: "تراجع",
    commercial: "الشروط التجارية",
    payments: "الدفع",
    trust: "الثقة والتقييمات",
    features: "الميزات",
    posture: "حالة التشغيل",
    depositRule:
      "العربون يجب أن يبقى أعلى من العمولة، وإلا لن يغطي عمولة تشاو ونصبح ندفع من جيبنا مقابل كل حجز. النظام يرفض الحفظ في هذه الحالة.",
  },
  en: {
    meta: {
      "fees.coastCommissionBps": {
        label: "Ciao commission — chalets and estirahas",
        help: "A share of the booking value. Built into the deposit; the guest never sees it as a separate charge.",
      },
      "fees.coastDepositBps": {
        label: "Deposit — chalets and estirahas",
        help: "What the guest pays up front to hold the date. It must stay above the commission.",
      },
      "fees.hallCommissionBps": {
        label: "Ciao commission — wedding halls",
        help: "A share of the package value, subject to the fixed cap below.",
      },
      "fees.hallCommissionCapDirhams": {
        label: "Cap on hall commission",
        help: "A ceiling in dinars, however large the package.",
      },
      "fees.hallDateLockBps": {
        label: "Hall date-lock payment",
        help: "What the customer pays to hold the date before the visit.",
      },
      "payments.enabledRails": {
        label: "Payment methods shown",
        help: "The order they appear at checkout. Switch off a failing rail rather than stopping bookings altogether.",
      },
      "features.wishlist": { label: "Saved list (the hearts)", help: "Show the save button on cards." },
      "features.map": { label: "Map search", help: "Show the map beside the results." },
      "features.services": { label: "Services vertical", help: "Show the Services tab in the app." },
      "features.reviews": {
        label: "Reviews and disputes",
        help: "Show the stars and the review window.",
      },
      "trust.minReviewsForGuestRating": {
        label: "Minimum reviews before guest ratings count",
        help: "Below this count the Ciao inspection rating is shown instead of the guest average.",
      },
      "trust.disputeSlaHours": {
        label: "Dispute resolution deadline (hours)",
        help: "The promise we publish to customers. Changing it changes what we promise in public.",
      },
      "trust.reviewWindowDays": {
        label: "Review window (days)",
        help: "After this, reviews close for that booking.",
      },
      "ops.demoMode": {
        label: "Demo mode",
        help: "Shows the login code on screen. Must be switched off before the first real customer.",
      },
      "ops.acceptingBookings": {
        label: "Accepting bookings",
        help: "Switching it off stops new bookings and leaves the app running for browsing.",
      },
      "ops.announcementAr": {
        label: "Public announcement bar",
        help: "Appears at the top of the app, in Arabic. Leave it empty to hide it.",
      },
    } as Record<string, Meta>,
    readOnly: "You are viewing settings read-only — changing them needs admin rights.",
    loadFailed: "Could not load the settings",
    saved: (n: number) =>
      `✅ ${n} setting${n === 1 ? "" : "s"} saved — live in the app within seconds`,
    noChanges: "No changes",
    adminOnly: "Only an admin can change settings",
    saveFailed: "Could not save",
    wasReset: "✅ Reset to the default",
    resetFailed: "Could not reset",
    resetToDefault: "Reset to default",
    isDefault: "Default",
    on: "On",
    off: "Off",
    percent: "%",
    lyd: "LYD",
    defaultIs: (pct: string) => `Default ${pct}%`,
    announcementPlaceholder: "Leave empty to hide the bar",
    saveN: (n: number) => `Save ${n} change${n === 1 ? "" : "s"}`,
    discard: "Discard",
    commercial: "Commercial terms",
    payments: "Payments",
    trust: "Trust and reviews",
    features: "Features",
    posture: "Operating state",
    depositRule:
      "The deposit must stay above the commission. If it does not, it will not cover Ciao's commission and we pay out of our own pocket on every booking. The system refuses to save in that state.",
  },
} satisfies Record<Locale, unknown>;

export function SettingsTab({ isAdmin }: { isAdmin: boolean }) {
  const locale = useLocale();
  const c = copy[locale];
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ settings: SettingRow[] }>("/v1/biz/settings");
      setRows(res.settings);
      setDraft({});
    } catch {
      setMsg(c.loadFailed);
    }
  }, [c]);

  useEffect(() => {
    void load();
  }, [load]);

  const valueOf = (key: string) => {
    if (key in draft) return draft[key];
    return rows.find((r) => r.key === key)?.value;
  };
  const set = (key: string, v: unknown) => {
    setDraft((d) => ({ ...d, [key]: v }));
    setMsg("");
  };

  async function save() {
    if (Object.keys(draft).length === 0) return;
    setBusy(true);
    try {
      const res = await api<{ changed: string[] }>("/v1/biz/settings", {
        method: "PUT",
        body: JSON.stringify({ patch: draft }),
      });
      setMsg(res.changed.length ? c.saved(res.changed.length) : c.noChanges);
      await load();
    } catch (e) {
      setMsg(
        e instanceof ApiError ? (e.status === 403 ? c.adminOnly : e.message) : c.saveFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  async function reset(key: string) {
    try {
      await api("/v1/biz/settings/reset", {
        method: "POST",
        body: JSON.stringify({ keys: [key] }),
      });
      setMsg(c.wasReset);
      await load();
    } catch {
      setMsg(c.resetFailed);
    }
  }

  const group = (prefix: string) => rows.filter((r) => r.key.startsWith(prefix));
  const dirty = Object.keys(draft).length;

  function Field({ row }: { row: SettingRow }) {
    const kind = KINDS[row.key];
    const meta = c.meta[row.key];
    if (!kind || !meta) return null;
    const v = valueOf(row.key);
    const changed = row.key in draft;

    return (
      <div
        className={`rounded-2xl p-3 ${changed ? "bg-amber/15 ring-1 ring-amber" : "bg-sand/40"}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold text-sea text-sm">{meta.label}</div>
            <div className="text-[11px] text-faint mt-0.5 leading-relaxed">{meta.help}</div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            {row.overridden ? (
              <button className="text-[10px] font-bold text-faint underline" onClick={() => reset(row.key)}>
                {c.resetToDefault}
              </button>
            ) : (
              <Pill tone="slate">{c.isDefault}</Pill>
            )}
          </div>
        </div>

        <div className="mt-2">
          {kind === "bool" ? (
            <label className="inline-flex items-center gap-2 text-sm font-bold text-sea">
              <input
                type="checkbox"
                disabled={!isAdmin}
                checked={Boolean(v)}
                onChange={(e) => set(row.key, e.target.checked)}
              />
              {v ? c.on : c.off}
            </label>
          ) : kind === "bps" ? (
            <div className="flex items-center gap-2">
              <input
                className="input !py-1.5 !text-sm max-w-[110px]"
                inputMode="decimal"
                disabled={!isAdmin}
                value={(Number(v) / 100).toString()}
                onChange={(e) => set(row.key, Math.round(Number(e.target.value || 0) * 100))}
              />
              <span className="text-sm font-bold text-muted">{c.percent}</span>
              <span className="text-[11px] text-faint">
                {c.defaultIs(
                  fmtNum(locale, Number(row.default) / 100, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }),
                )}
              </span>
            </div>
          ) : kind === "money" ? (
            <div className="flex items-center gap-2">
              <input
                className="input !py-1.5 !text-sm max-w-[140px]"
                inputMode="numeric"
                disabled={!isAdmin}
                value={(Number(v) / 1000).toString()}
                onChange={(e) => set(row.key, Math.round(Number(e.target.value || 0) * 1000))}
              />
              <span className="text-sm font-bold text-muted">{c.lyd}</span>
            </div>
          ) : kind === "number" ? (
            <input
              className="input !py-1.5 !text-sm max-w-[110px]"
              inputMode="numeric"
              disabled={!isAdmin}
              value={String(v ?? "")}
              onChange={(e) => set(row.key, Number(e.target.value || 0))}
            />
          ) : kind === "rails" ? (
            <div className="flex flex-wrap gap-1.5">
              {RAIL_KEYS.map((k) => {
                const list = (v as string[]) ?? [];
                const on = list.includes(k);
                return (
                  <button
                    key={k}
                    disabled={!isAdmin}
                    className={`chip !text-[11px] ${on ? "!bg-sea !text-white" : ""}`}
                    onClick={() =>
                      set(row.key, on ? list.filter((x) => x !== k) : [...list, k])
                    }
                  >
                    {term(PAYMENT_RAILS, locale, k)}
                  </button>
                );
              })}
            </div>
          ) : (
            <input
              className="input !py-1.5 !text-sm"
              disabled={!isAdmin}
              placeholder={c.announcementPlaceholder}
              value={String(v ?? "")}
              onChange={(e) => set(row.key, e.target.value)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {!isAdmin ? (
        <p className="rounded-2xl bg-sand p-3 text-sm text-muted mb-3">{c.readOnly}</p>
      ) : null}

      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-sand/95 backdrop-blur flex items-center gap-3">
        <button
          className="btn-primary !py-1.5 !px-5 !text-sm disabled:opacity-40"
          disabled={!isAdmin || !dirty || busy}
          onClick={save}
        >
          {busy ? "…" : dirty ? c.saveN(dirty) : c.noChanges}
        </button>
        {dirty ? (
          <button className="chip" onClick={() => setDraft({})}>
            {c.discard}
          </button>
        ) : null}
        {msg ? <span className="text-sm font-bold text-sea truncate">{msg}</span> : null}
      </div>

      <HeroSettings
        row={rows.find((r) => r.key === "home.hero")}
        value={valueOf("home.hero")}
        isAdmin={isAdmin}
        onChange={(v) => set("home.hero", v)}
      />

      <Section title={c.commercial}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {group("fees.").map((r) => (
            <Field key={r.key} row={r} />
          ))}
        </div>
        <p className="text-[11px] text-faint mt-3 leading-relaxed">{c.depositRule}</p>
      </Section>

      <Section title={c.payments}>
        <div className="grid grid-cols-1 gap-2">
          {group("payments.").map((r) => (
            <Field key={r.key} row={r} />
          ))}
        </div>
      </Section>

      <Section title={c.trust}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {group("trust.").map((r) => (
            <Field key={r.key} row={r} />
          ))}
        </div>
      </Section>

      <Section title={c.features}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {group("features.").map((r) => (
            <Field key={r.key} row={r} />
          ))}
        </div>
      </Section>

      <Section title={c.posture}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {group("ops.").map((r) => (
            <Field key={r.key} row={r} />
          ))}
        </div>
      </Section>
    </div>
  );
}
