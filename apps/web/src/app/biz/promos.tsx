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
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd } from "@/lib/api";
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

const KIND_AR: Record<string, string> = {
  percent: "نسبة مئوية",
  fixed: "مبلغ ثابت",
  points: "نقاط مكافأة",
};

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

export function PromosTab({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<Promo[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Promo[] }>("/v1/biz/promos")).items);
    } catch {
      setMsg("تعذر تحميل الأكواد");
    }
  }, []);

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
      setMsg(`✅ أُنشئ الكود ${res.code}`);
      setForm(EMPTY);
      setAdding(false);
      await load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : "";
      setMsg(
        m.includes("code_exists")
          ? "هذا الكود مستخدم بالفعل"
          : e instanceof ApiError && e.status === 403
            ? "إنشاء الأكواد للمدير فقط"
            : "تعذر الإنشاء",
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
      setMsg("تعذر التغيير — التعديل للمدير فقط");
    }
  }

  function describe(p: Promo): string {
    if (p.kind === "percent") return `${(p.value / 100).toFixed(p.value % 100 ? 1 : 0)}٪`;
    if (p.kind === "fixed") return fmtLyd(p.value);
    return `${p.value} نقطة`;
  }

  function status(p: Promo): { label: string; tone: string } {
    if (!p.active) return { label: "موقوف", tone: "slate" };
    if (p.endsAt && new Date(p.endsAt) < new Date()) return { label: "منتهي", tone: "slate" };
    if (p.maxRedemptions != null && p.timesUsed >= p.maxRedemptions)
      return { label: "اكتمل", tone: "slate" };
    return { label: "ساري", tone: "green" };
  }

  return (
    <div>
      {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm">كيف تعمل أكواد الخصم عندنا</h3>
        <p className="text-xs text-sea/70 mt-1 leading-relaxed">
          الخصم يُموَّل من عمولة تشاو ولا يتجاوزها أبدًا. لو أنشأت كود ٥٠٪ على حجز عمولتنا فيه
          ١٠٪، سيحصل الضيف على ١٠٪ — لأن حصة المضيف وعدٌ قطعناه له، وليست ميزانية تسويق. النظام
          يقصّ الخصم تلقائيًا عند هذا الحد.
        </p>
      </div>

      <Section
        title={`الأكواد (${items.length})`}
        action={
          isAdmin ? (
            <button className="chip" onClick={() => setAdding((a) => !a)}>
              {adding ? "إلغاء" : "+ كود جديد"}
            </button>
          ) : (
            <Pill tone="slate">للقراءة فقط</Pill>
          )
        }
      >
        {adding ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            <label className="text-xs font-bold text-sea/70">
              الكود
              <input
                className="input !py-2 !text-sm mt-1"
                dir="ltr"
                placeholder="EID2027"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            </label>
            <label className="text-xs font-bold text-sea/70">
              النوع
              <select
                className="input !py-2 !text-sm mt-1"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}
              >
                {Object.entries(KIND_AR).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-sea/70">
              {form.kind === "percent" ? "النسبة (٪)" : form.kind === "fixed" ? "المبلغ (د.ل)" : "النقاط"}
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="decimal"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-sea/70">
              أقصى خصم (د.ل)
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                placeholder="اختياري"
                value={form.maxDiscount}
                onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-sea/70">
              القطاع
              <select
                className="input !py-2 !text-sm mt-1"
                value={form.vertical}
                onChange={(e) => setForm({ ...form, vertical: e.target.value })}
              >
                <option value="">كل الأقسام</option>
                <option value="coast">شاليهات واستراحات</option>
                <option value="hall">قاعات أفراح</option>
                <option value="service">خدمات</option>
              </select>
            </label>
            <label className="text-xs font-bold text-sea/70">
              المدينة
              <input
                className="input !py-2 !text-sm mt-1"
                dir="ltr"
                placeholder="tripoli (اختياري)"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-sea/70">
              أقل قيمة حجز (د.ل)
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                placeholder="0"
                value={form.minSpend}
                onChange={(e) => setForm({ ...form, minSpend: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-sea/70">
              ينتهي في
              <input
                type="date"
                className="input !py-2 !text-sm mt-1"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-sea/70">
              أقصى عدد استخدامات
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                placeholder="بلا حد"
                value={form.maxRedemptions}
                onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })}
              />
            </label>
            <label className="text-xs font-bold text-sea/70">
              الحد لكل مستخدم
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                value={form.perUserLimit}
                onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })}
              />
            </label>
            <input
              className="input !py-2 !text-sm sm:col-span-2"
              placeholder="وصف يظهر للضيف عند تطبيق الكود"
              value={form.descriptionAr}
              onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })}
            />
            <button
              className="btn-primary !py-2 !text-sm sm:col-span-2"
              disabled={busy || form.code.length < 3}
              onClick={create}
            >
              {busy ? "…" : "أنشئ الكود"}
            </button>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-sea/60">
              <tr>
                <th className="text-start py-1">الكود</th>
                <th className="text-start py-1">القيمة</th>
                <th className="text-start py-1">النطاق</th>
                <th className="text-start py-1">الاستخدام</th>
                <th className="text-start py-1">كلّفنا</th>
                <th className="text-start py-1">الحالة</th>
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
                        <div className="text-[11px] text-sea/55">{p.descriptionAr}</div>
                      ) : null}
                    </td>
                    <td className="py-2 font-bold text-sea">{describe(p)}</td>
                    <td className="py-2 text-sea/70">
                      {p.vertical
                        ? { coast: "شاليهات", hall: "قاعات", service: "خدمات" }[p.vertical]
                        : "الكل"}
                      {p.city ? ` · ${p.city}` : ""}
                      {p.minSpend > 0 ? ` · من ${fmtLyd(p.minSpend)}` : ""}
                    </td>
                    <td className="py-2 tabular-nums">
                      {p.timesUsed}
                      {p.maxRedemptions != null ? `/${p.maxRedemptions}` : ""}
                      <div className="text-[11px] text-sea/50">لكل عضو {p.perUserLimit}</div>
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
                          {p.active ? "إيقاف" : "تفعيل"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 ? (
                <tr>
                  <td className="p-3 text-sea/50" colSpan={6}>
                    لا أكواد بعد
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
