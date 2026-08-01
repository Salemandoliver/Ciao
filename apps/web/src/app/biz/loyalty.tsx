"use client";
/**
 * Loyalty economy management.
 *
 * Three things on one screen because they are one decision: what the programme
 * promises, what it currently owes, and who can absorb it. Changing the earn
 * rate without seeing the outstanding liability is how a loyalty programme
 * quietly becomes the largest unfunded item on a small company's balance
 * sheet — so the liability sits directly above the controls that move it.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd } from "@/lib/api";
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

const EARN_AR: Record<string, string> = {
  signup: "إنشاء العضوية",
  email_verified: "توثيق البريد",
  stay_completed: "إتمام إقامة",
  review_written: "كتابة تقييم",
  referral_qualified: "دعوة أثمرت حجزًا",
  referred_welcome: "ترحيب بمدعو",
};

const REASON_AR: Record<string, string> = {
  ...EARN_AR,
  redeemed: "تحويل إلى رصيد",
  expired: "انتهت صلاحيتها",
  partner_voucher: "قسائم الشركاء",
  partner_voucher_refund: "إرجاع قسائم منتهية",
};

const CATEGORIES: [string, string][] = [
  ["cafe", "مقهى"],
  ["restaurant", "مطعم"],
  ["bakery", "مخبز وحلويات"],
  ["spa", "مركز عناية"],
  ["activity", "نشاط ترفيهي"],
  ["shop", "متجر"],
];

export function LoyaltyTab({ isAdmin }: { isAdmin: boolean }) {
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
      setMsg("تعذر تحميل بيانات البرنامج");
    }
  }, []);

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
      setMsg(res.changed.length ? `✅ حُفظ ${res.changed.length} إعداد` : "لا تغييرات");
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "تعذر الحفظ");
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
      setMsg("✅ أُضيف الشريك");
      setAdding(false);
      setForm({ ...form, nameAr: "", staffPhone: "", descriptionAr: "" });
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? `تعذر الإضافة: ${e.message}` : "تعذر الإضافة");
    }
  }

  async function togglePartner(p: Partner) {
    await api(`/v1/biz/partners/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !p.active }),
    }).catch(() => setMsg("تعذر التغيير"));
    await load();
  }

  async function settle(p: Partner) {
    if (!window.confirm(`تأكيد سداد ${fmtLyd(p.owed)} إلى ${p.nameAr}؟`)) return;
    try {
      const res = await api<{ total: number; settled: number }>(`/v1/biz/partners/${p.id}/settle`, {
        method: "POST",
      });
      setMsg(`✅ سُدّد ${fmtLyd(res.total)} عن ${res.settled} قسيمة`);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 403 ? "السداد للمدير فقط" : "تعذر السداد");
    }
  }

  if (!data) return <p className="p-4 text-sea/60">جارٍ التحميل…</p>;
  const c = data.config;
  const dirty = Object.keys(draft).length;

  return (
    <div>
      {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}

      {/* The liability, before the levers that move it */}
      <Section title="التزام البرنامج">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat
            label="نقاط قائمة لدى الأعضاء"
            value={data.liability.outstandingPoints.toLocaleString("ar-LY")}
          />
          <Stat
            label="تكلفتها لو صُرفت كلها"
            value={<Money dirhams={data.liability.outstandingDirhams} />}
            tone={data.liability.outstandingDirhams > 5_000_000 ? "warn" : "normal"}
          />
          <Stat label="أعضاء يملكون نقاطًا" value={data.liability.membersHoldingPoints} />
          <Stat
            label="تنتهي خلال 30 يومًا"
            value={data.liability.lapsingWithin30Days.toLocaleString("ar-LY")}
            sub="نقطة"
          />
        </div>
        <p className="text-[11px] text-sea/45 mt-3 leading-relaxed">
          النقاط ليست نقودًا لكنها وعد: هذا الرقم هو ما ستكلّفنا لو طالب به الجميع غدًا. عدّل قيم
          الكسب وأنت تنظر إليه.
        </p>
      </Section>

      <Section
        title="قواعد الكسب"
        action={
          isAdmin && dirty ? (
            <button className="btn-primary !py-1.5 !px-4 !text-sm" onClick={save}>
              حفظ {dirty}
            </button>
          ) : null
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(EARN_AR).map(([key, label]) => {
            const rules = (val("loyalty.earnRules", c.earnRules) as Record<string, number>) ?? {};
            return (
              <label key={key} className="flex items-center justify-between gap-2 rounded-2xl bg-sand/40 p-3">
                <span className="text-sm text-sea/85">{label}</span>
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

      <Section title="التحويل والصلاحية">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field
            label="قيمة النقطة (درهم)"
            hint={`${Math.round(1000 / Number(val("loyalty.pointToDirham", c.pointToDirham) || 1))} نقطة = ١ د.ل`}
            value={val("loyalty.pointToDirham", c.pointToDirham) as number}
            disabled={!isAdmin}
            onChange={(v) => set("loyalty.pointToDirham", v)}
          />
          <Field
            label="أقل رصيد للتحويل (نقطة)"
            hint="أقل من هذا لا يستحق العناء"
            value={val("loyalty.minRedeem", c.minRedeem) as number}
            disabled={!isAdmin}
            onChange={(v) => set("loyalty.minRedeem", v)}
          />
          <Field
            label="مدة صلاحية النقاط (شهر)"
            hint="0 = لا تنتهي. لا يُطبَّق بأثر رجعي على نقاط كُسبت من قبل."
            value={val("loyalty.expiryMonths", c.expiryMonths) as number}
            disabled={!isAdmin}
            onChange={(v) => set("loyalty.expiryMonths", v)}
          />
          <Field
            label="صلاحية قسيمة الشريك (دقيقة)"
            hint="بعدها تعود النقاط للعضو تلقائيًا"
            value={val("loyalty.voucherMinutes", c.voucherMinutes) as number}
            disabled={!isAdmin}
            onChange={(v) => set("loyalty.voucherMinutes", v)}
          />
        </div>
        <div className="flex flex-wrap gap-4 mt-3">
          <Toggle
            label="البرنامج مفعّل"
            on={Boolean(val("loyalty.enabled", c.enabled))}
            disabled={!isAdmin}
            onChange={(v) => set("loyalty.enabled", v)}
          />
          <Toggle
            label="الصرف عند الشركاء"
            on={Boolean(val("loyalty.partnersEnabled", c.partnersEnabled))}
            disabled={!isAdmin}
            onChange={(v) => set("loyalty.partnersEnabled", v)}
          />
        </div>
        {!isAdmin ? (
          <p className="text-[11px] text-sea/50 mt-2">التعديل للمدير فقط — هذه أرقام تكلّف مالًا.</p>
        ) : null}
      </Section>

      <Section title="حركة النقاط">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-sea/60">
              <tr>
                <th className="text-start py-1">السبب</th>
                <th className="text-start py-1">النقاط</th>
                <th className="text-start py-1">عدد الحركات</th>
              </tr>
            </thead>
            <tbody>
              {data.byReason
                .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
                .map((r) => (
                  <tr key={r.reason} className="border-t border-sand">
                    <td className="py-1.5 font-bold text-sea">{REASON_AR[r.reason] ?? r.reason}</td>
                    <td
                      className={`py-1.5 tabular-nums font-bold ${
                        r.points > 0 ? "text-emerald-700" : "text-sea/70"
                      }`}
                    >
                      {r.points > 0 ? "+" : ""}
                      {r.points.toLocaleString("ar-LY")}
                    </td>
                    <td className="py-1.5 tabular-nums text-sea/60">{r.entries}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="شركاء الصرف"
        action={
          <button className="chip" onClick={() => setAdding((a) => !a)}>
            {adding ? "إلغاء" : "+ شريك"}
          </button>
        }
      >
        <p className="text-xs text-sea/60 mb-3 leading-relaxed">
          المقهى داخل المنتجع، المخبز القريب. النقاط تتحول عندهم إلى زبون حقيقي، ونحن نسدّد لهم
          نقدًا. رقم هاتف الكاشير يصبح حسابه لصرف القسائم.
        </p>

        {adding ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            <input
              className="input !py-2 !text-sm"
              placeholder="اسم الشريك"
              value={form.nameAr}
              onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
            />
            <select
              className="input !py-2 !text-sm"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {CATEGORIES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <input
              className="input !py-2 !text-sm"
              dir="ltr"
              placeholder="هاتف الكاشير 09XXXXXXXX"
              value={form.staffPhone}
              onChange={(e) => setForm({ ...form, staffPhone: e.target.value })}
            />
            <input
              className="input !py-2 !text-sm"
              dir="ltr"
              placeholder="المنطقة (janzour)"
              value={form.area}
              onChange={(e) => setForm({ ...form, area: e.target.value })}
            />
            <label className="text-xs font-bold text-sea/70">
              أقل قيمة قسيمة (د.ل)
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                value={form.minValue}
                onChange={(e) => setForm({ ...form, minValue: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-sea/70">
              أعلى قيمة قسيمة (د.ل)
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                value={form.maxValue}
                onChange={(e) => setForm({ ...form, maxValue: e.target.value })}
              />
            </label>
            <textarea
              className="input !py-2 !text-sm sm:col-span-2 h-16"
              placeholder="وصف قصير يظهر للعضو"
              value={form.descriptionAr}
              onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })}
            />
            <button
              className="btn-primary !py-2 !text-sm sm:col-span-2"
              disabled={!form.nameAr}
              onClick={addPartner}
            >
              أضف الشريك
            </button>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-sea/60">
              <tr>
                <th className="text-start py-1">الشريك</th>
                <th className="text-start py-1">قسائم</th>
                <th className="text-start py-1">مستحق له</th>
                <th className="text-start py-1"></th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id} className="border-t border-sand">
                  <td className="py-2">
                    <div className="font-bold text-sea">{p.nameAr}</div>
                    <div className="text-[11px] text-sea/55">
                      {CATEGORIES.find(([v]) => v === p.category)?.[1] ?? p.category}
                      {p.venueNameAr ? ` · داخل ${p.venueNameAr}` : p.area ? ` · ${p.area}` : ""}
                      {p.staffPhone ? ` · ${p.staffPhone}` : " · بلا حساب كاشير"}
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
                        {p.active ? "إيقاف" : "تفعيل"}
                      </button>
                      {p.owed > 0 ? (
                        <button className="chip !text-[11px] !bg-amber" onClick={() => settle(p)}>
                          سدّد
                        </button>
                      ) : null}
                    </div>
                    {!p.active ? <Pill tone="slate">موقوف</Pill> : null}
                  </td>
                </tr>
              ))}
              {partners.length === 0 ? (
                <tr>
                  <td className="p-3 text-sea/50" colSpan={4}>
                    لا شركاء بعد
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
      {hint ? <span className="block text-[11px] text-sea/55 mt-0.5">{hint}</span> : null}
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
