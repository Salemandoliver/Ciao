"use client";
/**
 * Loyalty economy management.
 *
 * Three things on one screen because they are one decision: what the programme
 * promises, what it currently owes, and who can absorb it. Changing the earn
 * rate without seeing the outstanding liability is how a loyalty programme
 * quietly becomes the largest unfunded item on a small company's balance
 * sheet — so the liability sits directly above the controls that move it.
 *
 * The English keeps the arithmetic exact: point-to-dirham rate, minimum
 * redemption, expiry in months, voucher validity in minutes. These are the
 * terms of a promise to members, and a loose translation of a rate is a
 * different promise.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { AREAS, fmtNum, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Money, Pill, Section, Stat } from "./lib";

interface Loyalty {
  config: {
    enabled: boolean;
    earnRules: Record<string, number>;
    pointToDirham: number;
    minRedeem: number;
    expiryMonths: number;
    partnersEnabled: boolean;
    voucherMinutes: number;
  };
  liability: {
    outstandingPoints: number;
    outstandingDirhams: number;
    membersHoldingPoints: number;
    lapsingWithin30Days: number;
  };
  byReason: { reason: string; points: number; entries: number }[];
}

interface Partner {
  id: string;
  nameAr: string;
  category: string;
  city: string | null;
  area: string | null;
  venueNameAr: string | null;
  staffPhone: string | null;
  minValue: number;
  maxValue: number;
  active: boolean;
  issued: number;
  redeemed: number;
  owed: number;
}

/** The earn events, in the order they are shown. */
const EARN_KEYS = [
  "signup",
  "email_verified",
  "stay_completed",
  "review_written",
  "referral_qualified",
  "referred_welcome",
  "birth_date_added",
  "party_profile_added",
  "birthday_gift",
];

/** Partner categories offered when adding one. */
const CATEGORY_KEYS = ["cafe", "restaurant", "bakery", "spa", "activity", "shop"];

const copy = {
  ar: {
    earn: {
      signup: "إنشاء العضوية",
      email_verified: "توثيق البريد",
      stay_completed: "إتمام إقامة",
      review_written: "كتابة تقييم",
      referral_qualified: "دعوة أثمرت حجزًا",
      birth_date_added: "إضافة تاريخ الميلاد",
      party_profile_added: "إضافة ملف المجموعة",
      birthday_gift: "هدية عيد الميلاد (سنويًا)",
      referred_welcome: "ترحيب بمدعو",
    } as Record<string, string>,
    reason: {
      redeemed: "تحويل إلى رصيد",
      expired: "انتهت صلاحيتها",
      partner_voucher: "قسائم الشركاء",
      partner_voucher_refund: "إرجاع قسائم منتهية",
    } as Record<string, string>,
    categories: {
      cafe: "مقهى",
      restaurant: "مطعم",
      bakery: "مخبز وحلويات",
      spa: "مركز عناية",
      activity: "نشاط ترفيهي",
      shop: "متجر",
    } as Record<string, string>,
    loading: "جارٍ التحميل…",
    loadFailed: "تعذر تحميل بيانات البرنامج",
    saved: (n: number) => `✅ حُفظ ${n} إعداد`,
    noChanges: "لا تغييرات",
    saveFailed: "تعذر الحفظ",
    partnerAdded: "✅ أُضيف الشريك",
    addFailedWhy: (why: string) => `تعذر الإضافة: ${why}`,
    addFailed: "تعذر الإضافة",
    toggleFailed: "تعذر التغيير",
    settleConfirm: (amount: string, name: string) => `تأكيد سداد ${amount} إلى ${name}؟`,
    settled: (amount: string, n: number) => `✅ سُدّد ${amount} عن ${n} قسيمة`,
    settleAdminOnly: "السداد للمدير فقط",
    settleFailed: "تعذر السداد",

    liabilityTitle: "التزام البرنامج",
    outstandingPoints: "نقاط قائمة لدى الأعضاء",
    costIfRedeemed: "تكلفتها لو صُرفت كلها",
    membersHolding: "أعضاء يملكون نقاطًا",
    lapsing30: "تنتهي خلال 30 يومًا",
    pointsUnit: "نقطة",
    liabilityNote:
      "النقاط ليست نقودًا لكنها وعد: هذا الرقم هو ما ستكلّفنا لو طالب به الجميع غدًا. عدّل قيم الكسب وأنت تنظر إليه.",

    earnTitle: "قواعد الكسب",
    saveN: (n: number) => `حفظ ${n}`,

    conversionTitle: "التحويل والصلاحية",
    pointValue: "قيمة النقطة (درهم)",
    pointValueHint: (n: string) => `${n} نقطة = ١ د.ل`,
    minRedeem: "أقل رصيد للتحويل (نقطة)",
    minRedeemHint: "أقل من هذا لا يستحق العناء",
    expiryMonths: "مدة صلاحية النقاط (شهر)",
    expiryHint: "0 = لا تنتهي. لا يُطبَّق بأثر رجعي على نقاط كُسبت من قبل.",
    voucherMinutes: "صلاحية قسيمة الشريك (دقيقة)",
    voucherHint: "بعدها تعود النقاط للعضو تلقائيًا",
    programmeOn: "البرنامج مفعّل",
    partnerRedemption: "الصرف عند الشركاء",
    adminOnlyNote: "التعديل للمدير فقط — هذه أرقام تكلّف مالًا.",

    movementTitle: "حركة النقاط",
    thReason: "السبب",
    thPoints: "النقاط",
    thEntries: "عدد الحركات",

    partnersTitle: "شركاء الصرف",
    addPartnerChip: "+ شريك",
    cancel: "إلغاء",
    partnersNote:
      "المقهى داخل المنتجع، المخبز القريب. النقاط تتحول عندهم إلى زبون حقيقي، ونحن نسدّد لهم نقدًا. رقم هاتف الكاشير يصبح حسابه لصرف القسائم.",
    partnerName: "اسم الشريك",
    tillPhone: "هاتف الكاشير 09XXXXXXXX",
    areaPlaceholder: "المنطقة (janzour)",
    minVoucher: "أقل قيمة قسيمة (د.ل)",
    maxVoucher: "أعلى قيمة قسيمة (د.ل)",
    partnerDesc: "وصف قصير يظهر للعضو",
    addPartner: "أضف الشريك",
    thPartner: "الشريك",
    thVouchers: "قسائم",
    thOwed: "مستحق له",
    inside: (venue: string) => ` · داخل ${venue}`,
    noTillAccount: " · بلا حساب كاشير",
    pause: "إيقاف",
    activate: "تفعيل",
    settle: "سدّد",
    paused: "موقوف",
    noPartners: "لا شركاء بعد",
  },
  en: {
    earn: {
      signup: "Signing up",
      email_verified: "Verifying an email address",
      stay_completed: "Completing a stay",
      review_written: "Writing a review",
      referral_qualified: "An invite that led to a booking",
      birth_date_added: "Adding a date of birth",
      party_profile_added: "Adding a party profile",
      birthday_gift: "Birthday gift (yearly)",
      referred_welcome: "Welcome for an invited member",
    } as Record<string, string>,
    reason: {
      redeemed: "Converted to credit",
      expired: "Expired",
      partner_voucher: "Partner vouchers",
      partner_voucher_refund: "Expired vouchers returned",
    } as Record<string, string>,
    categories: {
      cafe: "Café",
      restaurant: "Restaurant",
      bakery: "Bakery & sweets",
      spa: "Beauty & spa",
      activity: "Leisure activity",
      shop: "Shop",
    } as Record<string, string>,
    loading: "Loading…",
    loadFailed: "Could not load the programme data",
    saved: (n: number) => `✅ ${n} setting${n === 1 ? "" : "s"} saved`,
    noChanges: "No changes",
    saveFailed: "Could not save",
    partnerAdded: "✅ Partner added",
    addFailedWhy: (why: string) => `Could not add: ${why}`,
    addFailed: "Could not add the partner",
    toggleFailed: "Could not change that",
    settleConfirm: (amount: string, name: string) => `Settle ${amount} to ${name}?`,
    settled: (amount: string, n: number) =>
      `✅ ${amount} settled across ${n} voucher${n === 1 ? "" : "s"}`,
    settleAdminOnly: "Only an admin can settle",
    settleFailed: "Could not settle",

    liabilityTitle: "Programme liability",
    outstandingPoints: "Points outstanding with members",
    costIfRedeemed: "Cost if all were redeemed",
    membersHolding: "Members holding points",
    lapsing30: "Expiring within 30 days",
    pointsUnit: "points",
    liabilityNote:
      "Points are not money, but they are a promise: this figure is what they would cost us if everyone claimed tomorrow. Change the earn values with it in front of you.",

    earnTitle: "Earn rules",
    saveN: (n: number) => `Save ${n}`,

    conversionTitle: "Conversion and expiry",
    pointValue: "Point value (dirhams)",
    pointValueHint: (n: string) => `${n} points = 1 LYD`,
    minRedeem: "Minimum balance to convert (points)",
    minRedeemHint: "Below this it is not worth the trouble",
    expiryMonths: "Points expire after (months)",
    expiryHint: "0 = never expire. Not applied retroactively to points already earned.",
    voucherMinutes: "Partner voucher validity (minutes)",
    voucherHint: "After that the points return to the member automatically",
    programmeOn: "Programme enabled",
    partnerRedemption: "Redemption at partners",
    adminOnlyNote: "Only an admin can change these — these numbers cost money.",

    movementTitle: "Points movement",
    thReason: "Reason",
    thPoints: "Points",
    thEntries: "Entries",

    partnersTitle: "Redemption partners",
    addPartnerChip: "+ Partner",
    cancel: "Cancel",
    partnersNote:
      "The café inside the resort, the bakery down the road. Points turn into a real customer for them, and we settle with them in cash. The till phone number becomes their account for redeeming vouchers.",
    partnerName: "Partner name (Arabic)",
    tillPhone: "Till phone 09XXXXXXXX",
    areaPlaceholder: "Area (janzour)",
    minVoucher: "Minimum voucher value (LYD)",
    maxVoucher: "Maximum voucher value (LYD)",
    partnerDesc: "Short description shown to the member (Arabic)",
    addPartner: "Add partner",
    thPartner: "Partner",
    thVouchers: "Vouchers",
    thOwed: "Owed",
    inside: (venue: string) => ` · inside ${venue}`,
    noTillAccount: " · no till account",
    pause: "Pause",
    activate: "Activate",
    settle: "Settle",
    paused: "Paused",
    noPartners: "No partners yet",
  },
} satisfies Record<Locale, unknown>;

export function LoyaltyTab({ isAdmin }: { isAdmin: boolean }) {
  const locale = useLocale();
  const t = copy[locale];
  const [data, setData] = useState<Loyalty | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    nameAr: "",
    category: "cafe",
    city: "tripoli",
    area: "",
    staffPhone: "",
    descriptionAr: "",
    minValue: "5",
    maxValue: "100",
  });

  const load = useCallback(async () => {
    try {
      const [l, p] = await Promise.all([
        api<Loyalty>("/v1/biz/loyalty"),
        api<{ items: Partner[] }>("/v1/biz/partners"),
      ]);
      setData(l);
      setPartners(p.items);
      setDraft({});
    } catch {
      setMsg(t.loadFailed);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const val = (key: string, fallback: unknown) => (key in draft ? draft[key] : fallback);
  const set = (key: string, v: unknown) => {
    setDraft((d) => ({ ...d, [key]: v }));
    setMsg("");
  };

  async function save() {
    if (Object.keys(draft).length === 0) return;
    try {
      const res = await api<{ changed: string[] }>("/v1/biz/settings", {
        method: "PUT",
        body: JSON.stringify({ patch: draft }),
      });
      setMsg(res.changed.length ? t.saved(res.changed.length) : t.noChanges);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : t.saveFailed);
    }
  }

  async function addPartner() {
    setMsg("");
    try {
      await api("/v1/biz/partners", {
        method: "POST",
        body: JSON.stringify({
          nameAr: form.nameAr,
          category: form.category,
          city: form.city,
          area: form.area || undefined,
          staffPhone: form.staffPhone || undefined,
          descriptionAr: form.descriptionAr || undefined,
          minValue: Number(form.minValue) * 1000,
          maxValue: Number(form.maxValue) * 1000,
        }),
      });
      setMsg(t.partnerAdded);
      setAdding(false);
      setForm({ ...form, nameAr: "", staffPhone: "", descriptionAr: "" });
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? t.addFailedWhy(e.message) : t.addFailed);
    }
  }

  async function togglePartner(p: Partner) {
    await api(`/v1/biz/partners/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !p.active }),
    }).catch(() => setMsg(t.toggleFailed));
    await load();
  }

  async function settle(p: Partner) {
    if (!window.confirm(t.settleConfirm(fmtLyd(p.owed, locale), p.nameAr))) return;
    try {
      const res = await api<{ total: number; settled: number }>(`/v1/biz/partners/${p.id}/settle`, {
        method: "POST",
      });
      setMsg(t.settled(fmtLyd(res.total, locale), res.settled));
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 403 ? t.settleAdminOnly : t.settleFailed);
    }
  }

  if (!data) return <p className="p-4 text-faint">{t.loading}</p>;
  const c = data.config;
  const dirty = Object.keys(draft).length;
  const reasonLabel = (key: string) => t.earn[key] ?? t.reason[key] ?? key;

  return (
    <div>
      {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}

      {/* The liability, before the levers that move it */}
      <Section title={t.liabilityTitle}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat
            label={t.outstandingPoints}
            value={fmtNum(locale, data.liability.outstandingPoints)}
          />
          <Stat
            label={t.costIfRedeemed}
            value={<Money dirhams={data.liability.outstandingDirhams} />}
            tone={data.liability.outstandingDirhams > 5_000_000 ? "warn" : "normal"}
          />
          <Stat label={t.membersHolding} value={data.liability.membersHoldingPoints} />
          <Stat
            label={t.lapsing30}
            value={fmtNum(locale, data.liability.lapsingWithin30Days)}
            sub={t.pointsUnit}
          />
        </div>
        <p className="text-[11px] text-faint mt-3 leading-relaxed">{t.liabilityNote}</p>
      </Section>

      <Section
        title={t.earnTitle}
        action={
          isAdmin && dirty ? (
            <button className="btn-primary !py-1.5 !px-4 !text-sm" onClick={save}>
              {t.saveN(dirty)}
            </button>
          ) : null
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {EARN_KEYS.map((key) => {
            const rules = (val("loyalty.earnRules", c.earnRules) as Record<string, number>) ?? {};
            return (
              <label key={key} className="flex items-center justify-between gap-2 rounded-2xl bg-sand/40 p-3">
                <span className="text-sm text-sea/85">{t.earn[key] ?? key}</span>
                <input
                  className="input !py-1.5 !text-sm max-w-[110px] text-center"
                  inputMode="numeric"
                  disabled={!isAdmin}
                  value={rules[key] ?? 0}
                  onChange={(e) =>
                    set("loyalty.earnRules", { ...rules, [key]: Number(e.target.value || 0) })
                  }
                />
              </label>
            );
          })}
        </div>
      </Section>

      <Section title={t.conversionTitle}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field
            label={t.pointValue}
            hint={t.pointValueHint(
              fmtNum(
                locale,
                Math.round(1000 / Number(val("loyalty.pointToDirham", c.pointToDirham) || 1)),
              ),
            )}
            value={val("loyalty.pointToDirham", c.pointToDirham) as number}
            disabled={!isAdmin}
            onChange={(v) => set("loyalty.pointToDirham", v)}
          />
          <Field
            label={t.minRedeem}
            hint={t.minRedeemHint}
            value={val("loyalty.minRedeem", c.minRedeem) as number}
            disabled={!isAdmin}
            onChange={(v) => set("loyalty.minRedeem", v)}
          />
          <Field
            label={t.expiryMonths}
            hint={t.expiryHint}
            value={val("loyalty.expiryMonths", c.expiryMonths) as number}
            disabled={!isAdmin}
            onChange={(v) => set("loyalty.expiryMonths", v)}
          />
          <Field
            label={t.voucherMinutes}
            hint={t.voucherHint}
            value={val("loyalty.voucherMinutes", c.voucherMinutes) as number}
            disabled={!isAdmin}
            onChange={(v) => set("loyalty.voucherMinutes", v)}
          />
        </div>
        <div className="flex flex-wrap gap-4 mt-3">
          <Toggle
            label={t.programmeOn}
            on={Boolean(val("loyalty.enabled", c.enabled))}
            disabled={!isAdmin}
            onChange={(v) => set("loyalty.enabled", v)}
          />
          <Toggle
            label={t.partnerRedemption}
            on={Boolean(val("loyalty.partnersEnabled", c.partnersEnabled))}
            disabled={!isAdmin}
            onChange={(v) => set("loyalty.partnersEnabled", v)}
          />
        </div>
        {!isAdmin ? <p className="text-[11px] text-faint mt-2">{t.adminOnlyNote}</p> : null}
      </Section>

      <Section title={t.movementTitle}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-faint">
              <tr>
                <th className="text-start py-1">{t.thReason}</th>
                <th className="text-start py-1">{t.thPoints}</th>
                <th className="text-start py-1">{t.thEntries}</th>
              </tr>
            </thead>
            <tbody>
              {data.byReason
                .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
                .map((r) => (
                  <tr key={r.reason} className="border-t border-sand">
                    <td className="py-1.5 font-bold text-sea">{reasonLabel(r.reason)}</td>
                    <td
                      className={`py-1.5 tabular-nums font-bold ${
                        r.points > 0 ? "text-success" : "text-muted"
                      }`}
                    >
                      {r.points > 0 ? "+" : ""}
                      {fmtNum(locale, r.points)}
                    </td>
                    <td className="py-1.5 tabular-nums text-faint">{r.entries}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title={t.partnersTitle}
        action={
          <button className="chip" onClick={() => setAdding((a) => !a)}>
            {adding ? t.cancel : t.addPartnerChip}
          </button>
        }
      >
        <p className="text-xs text-faint mb-3 leading-relaxed">{t.partnersNote}</p>

        {adding ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            <input
              className="input !py-2 !text-sm"
              placeholder={t.partnerName}
              value={form.nameAr}
              onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
            />
            <select
              className="input !py-2 !text-sm"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {CATEGORY_KEYS.map((k) => (
                <option key={k} value={k}>{t.categories[k] ?? k}</option>
              ))}
            </select>
            <input
              className="input !py-2 !text-sm"
              dir="ltr"
              placeholder={t.tillPhone}
              value={form.staffPhone}
              onChange={(e) => setForm({ ...form, staffPhone: e.target.value })}
            />
            <input
              className="input !py-2 !text-sm"
              dir="ltr"
              placeholder={t.areaPlaceholder}
              value={form.area}
              onChange={(e) => setForm({ ...form, area: e.target.value })}
            />
            <label className="text-xs font-bold text-muted">
              {t.minVoucher}
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                value={form.minValue}
                onChange={(e) => setForm({ ...form, minValue: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-muted">
              {t.maxVoucher}
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                value={form.maxValue}
                onChange={(e) => setForm({ ...form, maxValue: e.target.value })}
              />
            </label>
            <textarea
              className="input !py-2 !text-sm sm:col-span-2 h-16"
              placeholder={t.partnerDesc}
              value={form.descriptionAr}
              onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })}
            />
            <button
              className="btn-primary !py-2 !text-sm sm:col-span-2"
              disabled={!form.nameAr}
              onClick={addPartner}
            >
              {t.addPartner}
            </button>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-faint">
              <tr>
                <th className="text-start py-1">{t.thPartner}</th>
                <th className="text-start py-1">{t.thVouchers}</th>
                <th className="text-start py-1">{t.thOwed}</th>
                <th className="text-start py-1"></th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id} className="border-t border-sand">
                  <td className="py-2">
                    <div className="font-bold text-sea">{p.nameAr}</div>
                    <div className="text-[11px] text-faint">
                      {t.categories[p.category] ?? p.category}
                      {p.venueNameAr
                        ? t.inside(p.venueNameAr)
                        : p.area
                          ? ` · ${term(AREAS, locale, p.area)}`
                          : ""}
                      {p.staffPhone ? ` · ${p.staffPhone}` : t.noTillAccount}
                    </div>
                  </td>
                  <td className="py-2 tabular-nums">
                    {p.redeemed}/{p.issued}
                  </td>
                  <td className="py-2">
                    <Money dirhams={p.owed} />
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      <button className="chip !text-[11px]" onClick={() => togglePartner(p)}>
                        {p.active ? t.pause : t.activate}
                      </button>
                      {p.owed > 0 ? (
                        <button className="chip !text-[11px] !bg-amber" onClick={() => settle(p)}>
                          {t.settle}
                        </button>
                      ) : null}
                    </div>
                    {!p.active ? <Pill tone="slate">{t.paused}</Pill> : null}
                  </td>
                </tr>
              ))}
              {partners.length === 0 ? (
                <tr>
                  <td className="p-3 text-faint" colSpan={4}>
                    {t.noPartners}
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

function Field({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block rounded-2xl bg-sand/40 p-3">
      <span className="block text-sm text-sea/85 font-bold">{label}</span>
      {hint ? <span className="block text-[11px] text-faint mt-0.5">{hint}</span> : null}
      <input
        className="input !py-1.5 !text-sm mt-2 max-w-[140px]"
        inputMode="numeric"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(Number(e.target.value || 0))}
      />
    </label>
  );
}

function Toggle({
  label,
  on,
  disabled,
  onChange,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm font-bold text-sea">
      <input
        type="checkbox"
        className="w-5 h-5"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
