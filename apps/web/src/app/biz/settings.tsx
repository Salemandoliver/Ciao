"use client";
/**
 * Settings — the control plane.
 *
 * These values steer the live public app: what guests are charged, which
 * payment rails appear at checkout, which photos lead the home page, whether
 * we're taking bookings at all. So the screen is built to make the
 * consequences visible: every field says what it does in plain Arabic, money
 * fields show the percentage rather than basis points, and anything currently
 * overridden is marked so an operator can tell "we chose this" from "this is
 * the default".
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { Pill, Section } from "./lib";
import { HeroSettings } from "./hero-settings";

interface SettingRow {
  key: string;
  value: unknown;
  default: unknown;
  overridden: boolean;
  updatedAt: string | null;
}

/** What each key means, in the operator's language. */
const META: Record<string, { label: string; help: string; kind: "bps" | "money" | "bool" | "number" | "text" | "rails" }> = {
  "fees.coastCommissionBps": {
    label: "عمولة تشاو — الشاليهات والاستراحات",
    help: "نسبة من قيمة الحجز. مدمجة في العربون، ولا تظهر للضيف كرسم منفصل.",
    kind: "bps",
  },
  "fees.coastDepositBps": {
    label: "العربون — الشاليهات والاستراحات",
    help: "ما يدفعه الضيف مقدّمًا لقفل التاريخ. يجب أن يبقى أعلى من العمولة.",
    kind: "bps",
  },
  "fees.hallCommissionBps": {
    label: "عمولة تشاو — قاعات الأفراح",
    help: "نسبة من قيمة الباقة، بحد أقصى ثابت أدناه.",
    kind: "bps",
  },
  "fees.hallCommissionCapDirhams": {
    label: "الحد الأقصى لعمولة القاعة",
    help: "سقف بالدينار مهما بلغت قيمة الباقة.",
    kind: "money",
  },
  "fees.hallDateLockBps": {
    label: "مقدّم قفل تاريخ القاعة",
    help: "ما يدفعه العميل لحجز التاريخ قبل الزيارة.",
    kind: "bps",
  },
  "payments.enabledRails": {
    label: "وسائل الدفع المعروضة",
    help: "ترتيب الظهور في صفحة الدفع. أطفئ وسيلة متعثرة بدل إيقاف الحجز كله.",
    kind: "rails",
  },
  "features.wishlist": { label: "المفضلة (القلوب)", help: "إظهار زر الحفظ في البطاقات.", kind: "bool" },
  "features.map": { label: "البحث بالخريطة", help: "إظهار الخريطة بجانب النتائج.", kind: "bool" },
  "features.services": { label: "قطاع الخدمات", help: "إظهار تبويب «خدمات» في التطبيق.", kind: "bool" },
  "features.reviews": { label: "التقييمات والشكاوى", help: "إظهار النجوم ونافذة التقييمات.", kind: "bool" },
  "trust.minReviewsForGuestRating": {
    label: "الحد الأدنى للتقييمات قبل اعتماد رأي الضيوف",
    help: "قبل هذا العدد يظهر تقييم تشاو الميداني بدل متوسط الضيوف.",
    kind: "number",
  },
  "trust.disputeSlaHours": {
    label: "مهلة حل الشكوى (ساعة)",
    help: "الوعد المنشور للعملاء. تغييره يغيّر ما نَعِد به علنًا.",
    kind: "number",
  },
  "trust.reviewWindowDays": {
    label: "مهلة كتابة التقييم (يوم)",
    help: "بعدها يُغلق باب التقييم لذلك الحجز.",
    kind: "number",
  },
  "ops.demoMode": {
    label: "وضع العرض التجريبي",
    help: "يُظهر رمز الدخول على الشاشة. يجب إطفاؤه قبل أول عميل حقيقي.",
    kind: "bool",
  },
  "ops.acceptingBookings": {
    label: "استقبال الحجوزات",
    help: "إطفاؤه يوقف الحجز الجديد ويُبقي التطبيق يعمل للتصفح.",
    kind: "bool",
  },
  "ops.announcementAr": {
    label: "شريط إعلان للعموم",
    help: "يظهر أعلى التطبيق. اتركه فارغًا لإخفائه.",
    kind: "text",
  },
};

const RAILS: [string, string][] = [
  ["sadad", "سداد"],
  ["adfali", "أضفلي"],
  ["local_card", "بطاقة محلية"],
  ["tlync", "T-Lync"],
  ["cash", "نقدًا عند الوصول"],
];

export function SettingsTab({ isAdmin }: { isAdmin: boolean }) {
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
      setMsg("تعذر تحميل الإعدادات");
    }
  }, []);

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
      setMsg(
        res.changed.length
          ? `✅ حُفظ ${res.changed.length} إعداد — يسري على التطبيق خلال ثوانٍ`
          : "لا تغييرات",
      );
      await load();
    } catch (e) {
      setMsg(
        e instanceof ApiError
          ? e.status === 403
            ? "تعديل الإعدادات للمدير فقط"
            : e.message
          : "تعذر الحفظ",
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
      setMsg("✅ أُعيد للقيمة الافتراضية");
      await load();
    } catch {
      setMsg("تعذر الاسترجاع");
    }
  }

  const group = (prefix: string) => rows.filter((r) => r.key.startsWith(prefix));
  const dirty = Object.keys(draft).length;

  function Field({ row }: { row: SettingRow }) {
    const meta = META[row.key];
    if (!meta) return null;
    const v = valueOf(row.key);
    const changed = row.key in draft;

    return (
      <div
        className={`rounded-2xl p-3 ${changed ? "bg-amber/15 ring-1 ring-amber" : "bg-sand/40"}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold text-sea text-sm">{meta.label}</div>
            <div className="text-[11px] text-sea/60 mt-0.5 leading-relaxed">{meta.help}</div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            {row.overridden ? (
              <button className="text-[10px] font-bold text-sea/60 underline" onClick={() => reset(row.key)}>
                إعادة للافتراضي
              </button>
            ) : (
              <Pill tone="slate">افتراضي</Pill>
            )}
          </div>
        </div>

        <div className="mt-2">
          {meta.kind === "bool" ? (
            <label className="inline-flex items-center gap-2 text-sm font-bold text-sea">
              <input
                type="checkbox"
                disabled={!isAdmin}
                checked={Boolean(v)}
                onChange={(e) => set(row.key, e.target.checked)}
              />
              {v ? "مُفعّل" : "مُعطّل"}
            </label>
          ) : meta.kind === "bps" ? (
            <div className="flex items-center gap-2">
              <input
                className="input !py-1.5 !text-sm max-w-[110px]"
                inputMode="decimal"
                disabled={!isAdmin}
                value={(Number(v) / 100).toString()}
                onChange={(e) => set(row.key, Math.round(Number(e.target.value || 0) * 100))}
              />
              <span className="text-sm font-bold text-sea/70">٪</span>
              <span className="text-[11px] text-sea/45">
                الافتراضي {(Number(row.default) / 100).toFixed(1)}٪
              </span>
            </div>
          ) : meta.kind === "money" ? (
            <div className="flex items-center gap-2">
              <input
                className="input !py-1.5 !text-sm max-w-[140px]"
                inputMode="numeric"
                disabled={!isAdmin}
                value={(Number(v) / 1000).toString()}
                onChange={(e) => set(row.key, Math.round(Number(e.target.value || 0) * 1000))}
              />
              <span className="text-sm font-bold text-sea/70">د.ل</span>
            </div>
          ) : meta.kind === "number" ? (
            <input
              className="input !py-1.5 !text-sm max-w-[110px]"
              inputMode="numeric"
              disabled={!isAdmin}
              value={String(v ?? "")}
              onChange={(e) => set(row.key, Number(e.target.value || 0))}
            />
          ) : meta.kind === "rails" ? (
            <div className="flex flex-wrap gap-1.5">
              {RAILS.map(([k, label]) => {
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
                    {label}
                  </button>
                );
              })}
            </div>
          ) : (
            <input
              className="input !py-1.5 !text-sm"
              disabled={!isAdmin}
              placeholder="اتركه فارغًا لإخفاء الشريط"
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
        <p className="rounded-2xl bg-sand p-3 text-sm text-sea/70 mb-3">
          أنت تشاهد الإعدادات للقراءة فقط — التعديل يحتاج صلاحية مدير.
        </p>
      ) : null}

      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-sand/95 backdrop-blur flex items-center gap-3">
        <button
          className="btn-primary !py-1.5 !px-5 !text-sm disabled:opacity-40"
          disabled={!isAdmin || !dirty || busy}
          onClick={save}
        >
          {busy ? "…" : dirty ? `حفظ ${dirty} تغيير` : "لا تغييرات"}
        </button>
        {dirty ? (
          <button className="chip" onClick={() => setDraft({})}>
            تراجع
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

      <Section title="الشروط التجارية">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {group("fees.").map((r) => (
            <Field key={r.key} row={r} />
          ))}
        </div>
        <p className="text-[11px] text-sea/45 mt-3 leading-relaxed">
          العربون يجب أن يبقى أعلى من العمولة، وإلا لن يغطي عمولة تشاو ونصبح ندفع من جيبنا مقابل
          كل حجز. النظام يرفض الحفظ في هذه الحالة.
        </p>
      </Section>

      <Section title="الدفع">
        <div className="grid grid-cols-1 gap-2">
          {group("payments.").map((r) => (
            <Field key={r.key} row={r} />
          ))}
        </div>
      </Section>

      <Section title="الثقة والتقييمات">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {group("trust.").map((r) => (
            <Field key={r.key} row={r} />
          ))}
        </div>
      </Section>

      <Section title="الميزات">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {group("features.").map((r) => (
            <Field key={r.key} row={r} />
          ))}
        </div>
      </Section>

      <Section title="حالة التشغيل">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {group("ops.").map((r) => (
            <Field key={r.key} row={r} />
          ))}
        </div>
      </Section>
    </div>
  );
}
