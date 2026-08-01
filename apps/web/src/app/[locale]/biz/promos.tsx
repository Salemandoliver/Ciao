"use client";
/**
 * Promo code management.
 *
 * The screen leads with the rule rather than hiding it in a tooltip: a promo
 * comes out of Ciao's commission and is capped there. An operator typing 50%
 * should understand before they save that a guest booking a chalet we earn 10%
 * on will get 10% off — not that we will pay the host's share for them.
 *
 * Creating a code is admin-only, because spending margin is the same class of
 * decision as changing the commission rate.
 *
 * The English states that rule in the same words and with the same force. It
 * is the one paragraph on this screen that stops an operator giving away money
 * that is not ours to give.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { CITIES, VERTICALS, fmtNum, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Money, Pill, Section } from "./lib";

interface Promo {
  id: string;
  code: string;
  kind: string;
  value: number;
  descriptionAr: string | null;
  vertical: string | null;
  city: string | null;
  minSpend: number;
  maxDiscount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  perUserLimit: number;
  timesUsed: number;
  active: boolean;
  discountGiven: number;
}

const KIND_KEYS = ["percent", "fixed", "points"] as const;
const VERTICAL_KEYS = ["coast", "hall", "service"];

const EMPTY = {
  code: "",
  kind: "percent" as "percent" | "fixed" | "points",
  value: "10",
  descriptionAr: "",
  vertical: "",
  city: "",
  minSpend: "",
  maxDiscount: "",
  endsAt: "",
  maxRedemptions: "",
  perUserLimit: "1",
};

const copy = {
  ar: {
    kinds: {
      percent: "نسبة مئوية",
      fixed: "مبلغ ثابت",
      points: "نقاط مكافأة",
    } as Record<string, string>,
    loadFailed: "تعذر تحميل الأكواد",
    created: (code: string) => `✅ أُنشئ الكود ${code}`,
    codeExists: "هذا الكود مستخدم بالفعل",
    adminOnly: "إنشاء الأكواد للمدير فقط",
    createFailed: "تعذر الإنشاء",
    toggleFailed: "تعذر التغيير — التعديل للمدير فقط",
    points: (n: number) => `${n} نقطة`,
    stPaused: "موقوف",
    stExpired: "منتهي",
    stFull: "اكتمل",
    stActive: "ساري",

    ruleTitle: "كيف تعمل أكواد الخصم عندنا",
    ruleBody:
      "الخصم يُموَّل من عمولة تشاو ولا يتجاوزها أبدًا. لو أنشأت كود ٥٠٪ على حجز عمولتنا فيه ١٠٪، سيحصل الضيف على ١٠٪ — لأن حصة المضيف وعدٌ قطعناه له، وليست ميزانية تسويق. النظام يقصّ الخصم تلقائيًا عند هذا الحد.",

    codesTitle: (n: number) => `الأكواد (${n})`,
    newCode: "+ كود جديد",
    cancel: "إلغاء",
    readOnly: "للقراءة فقط",

    fCode: "الكود",
    fKind: "النوع",
    fPercent: "النسبة (٪)",
    fAmount: "المبلغ (د.ل)",
    fPoints: "النقاط",
    fMaxDiscount: "أقصى خصم (د.ل)",
    optional: "اختياري",
    fVertical: "القطاع",
    allVerticals: "كل الأقسام",
    fCity: "المدينة",
    cityPlaceholder: "tripoli (اختياري)",
    fMinSpend: "أقل قيمة حجز (د.ل)",
    fEndsAt: "ينتهي في",
    fMaxRedemptions: "أقصى عدد استخدامات",
    noLimit: "بلا حد",
    fPerUser: "الحد لكل مستخدم",
    fDescription: "وصف يظهر للضيف عند تطبيق الكود",
    createCode: "أنشئ الكود",

    thCode: "الكود",
    thValue: "القيمة",
    thScope: "النطاق",
    thUsage: "الاستخدام",
    thCost: "كلّفنا",
    thStatus: "الحالة",
    scopeAll: "الكل",
    fromSpend: (amount: string) => ` · من ${amount}`,
    perMember: (n: number) => `لكل عضو ${n}`,
    pause: "إيقاف",
    activate: "تفعيل",
    noCodes: "لا أكواد بعد",
  },
  en: {
    kinds: {
      percent: "Percentage",
      fixed: "Fixed amount",
      points: "Reward points",
    } as Record<string, string>,
    loadFailed: "Could not load the codes",
    created: (code: string) => `✅ Code ${code} created`,
    codeExists: "That code is already in use",
    adminOnly: "Only an admin can create codes",
    createFailed: "Could not create the code",
    toggleFailed: "Could not change that — only an admin can",
    points: (n: number) => `${n} points`,
    stPaused: "Paused",
    stExpired: "Expired",
    stFull: "Fully used",
    stActive: "Active",

    ruleTitle: "How discount codes work here",
    ruleBody:
      "A discount is funded out of Ciao's commission and never exceeds it. Create a 50% code and use it on a booking we earn 10% on, and the guest gets 10% — because the host's share is a promise we made them, not a marketing budget. The system trims the discount to that limit automatically.",

    codesTitle: (n: number) => `Codes (${n})`,
    newCode: "+ New code",
    cancel: "Cancel",
    readOnly: "Read-only",

    fCode: "Code",
    fKind: "Type",
    fPercent: "Percentage (%)",
    fAmount: "Amount (LYD)",
    fPoints: "Points",
    fMaxDiscount: "Maximum discount (LYD)",
    optional: "Optional",
    fVertical: "Vertical",
    allVerticals: "All verticals",
    fCity: "City",
    cityPlaceholder: "tripoli (optional)",
    fMinSpend: "Minimum booking value (LYD)",
    fEndsAt: "Ends on",
    fMaxRedemptions: "Maximum redemptions",
    noLimit: "No limit",
    fPerUser: "Limit per user",
    fDescription: "Description shown to the guest when the code is applied",
    createCode: "Create the code",

    thCode: "Code",
    thValue: "Value",
    thScope: "Scope",
    thUsage: "Redemptions",
    thCost: "Cost to us",
    thStatus: "Status",
    scopeAll: "All",
    fromSpend: (amount: string) => ` · from ${amount}`,
    perMember: (n: number) => `${n} per member`,
    pause: "Pause",
    activate: "Activate",
    noCodes: "No codes yet",
  },
} satisfies Record<Locale, unknown>;

export function PromosTab({ isAdmin }: { isAdmin: boolean }) {
  const locale = useLocale();
  const t = copy[locale];
  const [items, setItems] = useState<Promo[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Promo[] }>("/v1/biz/promos")).items);
    } catch {
      setMsg(t.loadFailed);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setMsg("");
    try {
      const payload: Record<string, unknown> = {
        code: form.code,
        kind: form.kind,
        // Percent is stored in basis points so 12.5% is expressible.
        value:
          form.kind === "percent"
            ? Math.round(Number(form.value) * 100)
            : form.kind === "fixed"
              ? Math.round(Number(form.value) * 1000)
              : Math.round(Number(form.value)),
        perUserLimit: Number(form.perUserLimit) || 1,
        minSpend: form.minSpend ? Math.round(Number(form.minSpend) * 1000) : 0,
      };
      if (form.descriptionAr) payload.descriptionAr = form.descriptionAr;
      if (form.vertical) payload.vertical = form.vertical;
      if (form.city) payload.city = form.city;
      if (form.maxDiscount) payload.maxDiscount = Math.round(Number(form.maxDiscount) * 1000);
      if (form.maxRedemptions) payload.maxRedemptions = Number(form.maxRedemptions);
      if (form.endsAt) payload.endsAt = new Date(`${form.endsAt}T23:59:59Z`).toISOString();

      const res = await api<{ code: string }>("/v1/biz/promos", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMsg(t.created(res.code));
      setForm(EMPTY);
      setAdding(false);
      await load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : "";
      setMsg(
        m.includes("code_exists")
          ? t.codeExists
          : e instanceof ApiError && e.status === 403
            ? t.adminOnly
            : t.createFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggle(p: Promo) {
    try {
      await api(`/v1/biz/promos/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !p.active }),
      });
      await load();
    } catch {
      setMsg(t.toggleFailed);
    }
  }

  function describe(p: Promo): string {
    if (p.kind === "percent") {
      const digits = p.value % 100 ? 1 : 0;
      const pct = fmtNum(locale, p.value / 100, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
      return locale === "en" ? `${pct}%` : `${pct}٪`;
    }
    if (p.kind === "fixed") return fmtLyd(p.value, locale);
    return t.points(p.value);
  }

  function status(p: Promo): { label: string; tone: string } {
    if (!p.active) return { label: t.stPaused, tone: "slate" };
    if (p.endsAt && new Date(p.endsAt) < new Date()) return { label: t.stExpired, tone: "slate" };
    if (p.maxRedemptions != null && p.timesUsed >= p.maxRedemptions)
      return { label: t.stFull, tone: "slate" };
    return { label: t.stActive, tone: "green" };
  }

  return (
    <div>
      {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm">{t.ruleTitle}</h3>
        <p className="text-xs text-muted mt-1 leading-relaxed">{t.ruleBody}</p>
      </div>

      <Section
        title={t.codesTitle(items.length)}
        action={
          isAdmin ? (
            <button className="chip" onClick={() => setAdding((a) => !a)}>
              {adding ? t.cancel : t.newCode}
            </button>
          ) : (
            <Pill tone="slate">{t.readOnly}</Pill>
          )
        }
      >
        {adding ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            <label className="text-xs font-bold text-muted">
              {t.fCode}
              <input
                className="input !py-2 !text-sm mt-1"
                dir="ltr"
                placeholder="EID2027"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            </label>
            <label className="text-xs font-bold text-muted">
              {t.fKind}
              <select
                className="input !py-2 !text-sm mt-1"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}
              >
                {KIND_KEYS.map((k) => (
                  <option key={k} value={k}>{t.kinds[k]}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-muted">
              {form.kind === "percent" ? t.fPercent : form.kind === "fixed" ? t.fAmount : t.fPoints}
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="decimal"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-muted">
              {t.fMaxDiscount}
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                placeholder={t.optional}
                value={form.maxDiscount}
                onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-muted">
              {t.fVertical}
              <select
                className="input !py-2 !text-sm mt-1"
                value={form.vertical}
                onChange={(e) => setForm({ ...form, vertical: e.target.value })}
              >
                <option value="">{t.allVerticals}</option>
                {VERTICAL_KEYS.map((k) => (
                  <option key={k} value={k}>{term(VERTICALS, locale, k)}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-muted">
              {t.fCity}
              <input
                className="input !py-2 !text-sm mt-1"
                dir="ltr"
                placeholder={t.cityPlaceholder}
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-muted">
              {t.fMinSpend}
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                placeholder="0"
                value={form.minSpend}
                onChange={(e) => setForm({ ...form, minSpend: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-muted">
              {t.fEndsAt}
              <input
                type="date"
                className="input !py-2 !text-sm mt-1"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-muted">
              {t.fMaxRedemptions}
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                placeholder={t.noLimit}
                value={form.maxRedemptions}
                onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-muted">
              {t.fPerUser}
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                value={form.perUserLimit}
                onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })}
              />
            </label>
            <input
              className="input !py-2 !text-sm sm:col-span-2"
              placeholder={t.fDescription}
              value={form.descriptionAr}
              onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })}
            />
            <button
              className="btn-primary !py-2 !text-sm sm:col-span-2"
              disabled={busy || form.code.length < 3}
              onClick={create}
            >
              {busy ? "…" : t.createCode}
            </button>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-faint">
              <tr>
                <th className="text-start py-1">{t.thCode}</th>
                <th className="text-start py-1">{t.thValue}</th>
                <th className="text-start py-1">{t.thScope}</th>
                <th className="text-start py-1">{t.thUsage}</th>
                <th className="text-start py-1">{t.thCost}</th>
                <th className="text-start py-1">{t.thStatus}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const st = status(p);
                return (
                  <tr key={p.id} className="border-t border-sand align-top">
                    <td className="py-2">
                      <div className="font-bold text-sea font-mono" dir="ltr">{p.code}</div>
                      {p.descriptionAr ? (
                        <div className="text-[11px] text-faint">{p.descriptionAr}</div>
                      ) : null}
                    </td>
                    <td className="py-2 font-bold text-sea">{describe(p)}</td>
                    <td className="py-2 text-muted">
                      {p.vertical ? term(VERTICALS, locale, p.vertical) : t.scopeAll}
                      {p.city ? ` · ${term(CITIES, locale, p.city)}` : ""}
                      {p.minSpend > 0 ? t.fromSpend(fmtLyd(p.minSpend, locale)) : ""}
                    </td>
                    <td className="py-2 tabular-nums">
                      {p.timesUsed}
                      {p.maxRedemptions != null ? `/${p.maxRedemptions}` : ""}
                      <div className="text-[11px] text-faint">{t.perMember(p.perUserLimit)}</div>
                    </td>
                    <td className="py-2">
                      <Money dirhams={p.discountGiven} />
                    </td>
                    <td className="py-2">
                      <Pill tone={st.tone}>{st.label}</Pill>
                      {isAdmin ? (
                        <button
                          className="chip !text-[11px] mt-1"
                          onClick={() => toggle(p)}
                        >
                          {p.active ? t.pause : t.activate}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 ? (
                <tr>
                  <td className="p-3 text-faint" colSpan={6}>
                    {t.noCodes}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
