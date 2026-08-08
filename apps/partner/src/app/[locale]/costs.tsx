"use client";
/**
 * المصاريف والربح — costs, and therefore profit.
 *
 * The money screen above this one counts what came in. That is the number a
 * partner already knows, roughly, from their own pocket. What nobody in this
 * market can currently produce about their own business is the *other* number:
 * did August actually make money, after the diesel and the assistant and the
 * Instagram boost.
 *
 * Deliberately not an accounting system. No double entry, no chart of
 * accounts, no VAT — a row is a date, an amount, a category, and optionally the
 * job it belonged to. Anything more is a product nobody fills in, and a costs
 * feature that goes unused makes the profit line a lie rather than a blank.
 *
 * Recurring costs are entered once and expanded on read. A partner who types
 * "rent, 800 a month" should not end up with a table to maintain, and changing
 * the amount should change it everywhere — which is what they expect a rent
 * line to do.
 */
import { useCallback, useEffect, useState } from "react";
import { api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";
import { Bars, Section, Stat } from "@/components/panel";
import type { PartnerMe } from "./types";

interface Expense {
  id: string;
  day: string;
  labelAr: string;
  category: string;
  amount: number;
  recurring: string | null;
}

interface Pnl {
  months: {
    month: string;
    revenue: number;
    confirmed: number;
    collected: number;
    costs: number;
    profit: number;
    jobs: number;
  }[];
  totals: {
    revenue: number;
    confirmed: number;
    collected: number;
    costs: number;
    profit: number;
    jobs: number;
  };
  byCategory: { category: string; amount: number }[];
}

const CATEGORIES = [
  "staff",
  "supplies",
  "fuel",
  "maintenance",
  "marketing",
  "rent",
  "transport",
  "fees",
  "other",
] as const;

const copy = {
  ar: {
    title: "المصاريف والربح",
    hint: "سجّل مصاريفك عشان تعرف ربحك الحقيقي، مش بس اللي دخل.",
    revenue: "الدخل المنفَّذ",
    confirmed: "مؤكد وجاي",
    costs: "المصاريف",
    profit: "الربح",
    jobs: "شغلة",
    byCategory: "المصاريف حسب النوع",
    byMonth: "شهر بشهر",
    add: "أضف مصروف",
    cancel: "إلغاء",
    day: "التاريخ",
    label: "على شنو",
    amount: "المبلغ (د.ل)",
    category: "النوع",
    categories: {
      staff: "عمالة",
      supplies: "مشتريات",
      fuel: "وقود ومولّد",
      maintenance: "صيانة",
      marketing: "دعاية",
      rent: "إيجار",
      transport: "مواصلات",
      fees: "رسوم وعمولات",
      other: "أخرى",
    },
    recurring: "يتكرر",
    recurringNo: "مرة وحدة",
    recurringMonthly: "كل شهر",
    recurringWeekly: "كل أسبوع",
    save: "احفظ",
    saving: "جارٍ الحفظ…",
    remove: "أزل",
    empty: "ما سجّلت مصاريف في هالفترة.",
    emptyBody: "أول مصروف يخلي رقم الربح صحيح: الديزل، أجرة المساعد، الإيجار.",
    range: "الفترة",
    profitNote:
      "«الدخل المنفَّذ» هو شغل خلص. «مؤكد وجاي» محجوز وما تم بعد — نفصلهم عشان ما تحسب فلوس ما وصلت.",
    loading: "لحظة…",
    failed: "تعذر التنفيذ.",
  },
  en: {
    title: "Costs and profit",
    hint: "Record what you spend, and the profit line becomes real rather than a guess.",
    revenue: "Delivered revenue",
    confirmed: "Confirmed, upcoming",
    costs: "Costs",
    profit: "Profit",
    jobs: "jobs",
    byCategory: "Costs by type",
    byMonth: "Month by month",
    add: "Add a cost",
    cancel: "Cancel",
    day: "Date",
    label: "What for",
    amount: "Amount (LYD)",
    category: "Type",
    categories: {
      staff: "Staff",
      supplies: "Supplies",
      fuel: "Fuel & generator",
      maintenance: "Maintenance",
      marketing: "Marketing",
      rent: "Rent",
      transport: "Transport",
      fees: "Fees & commission",
      other: "Other",
    },
    recurring: "Repeats",
    recurringNo: "One off",
    recurringMonthly: "Every month",
    recurringWeekly: "Every week",
    save: "Save",
    saving: "Saving…",
    remove: "Remove",
    empty: "No costs recorded in this period.",
    emptyBody: "The first one makes the profit number true: diesel, an assistant's day, the rent.",
    range: "Period",
    profitNote:
      "\"Delivered\" is work that happened. \"Confirmed, upcoming\" is booked but not yet done — kept apart so you never count money that hasn't arrived.",
    loading: "One moment…",
    failed: "Could not do that.",
  },
} satisfies Record<Locale, unknown>;

/** Twelve months back, to today. Long enough to see a season. */
function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCMonth(from.getUTCMonth() - 11);
  from.setUTCDate(1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function CostsPanel({ me }: { me: PartnerMe }) {
  const locale = useLocale();
  const c = copy[locale];
  const scope = me.partnerId ? `partnerId=${me.partnerId}&` : "";

  const [range] = useState(defaultRange);
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [f, setF] = useState({
    day: new Date().toISOString().slice(0, 10),
    labelAr: "",
    amount: "",
    category: "other",
    recurring: "",
  });

  const load = useCallback(async () => {
    try {
      const [p, e] = await Promise.all([
        api<Pnl>(`/v1/partner/pnl?${scope}from=${range.from}&to=${range.to}`),
        api<{ items: Expense[] }>(`/v1/partner/expenses?${scope}from=${range.from}&to=${range.to}`),
      ]);
      setPnl(p);
      setExpenses(e.items);
    } catch {
      setError(c.failed);
    }
  }, [scope, range.from, range.to, c.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    try {
      await api(`/v1/partner/expenses?${scope.replace(/&$/, "")}`, {
        method: "POST",
        body: JSON.stringify({
          day: f.day,
          labelAr: f.labelAr.trim(),
          amount: Math.max(0, Math.round(Number(f.amount || 0) * 1000)),
          category: f.category,
          recurring: f.recurring || null,
        }),
      });
      setF({ ...f, labelAr: "", amount: "" });
      setOpen(false);
      await load();
    } catch {
      setError(c.failed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api(`/v1/partner/expenses/${id}?${scope.replace(/&$/, "")}`, { method: "DELETE" }).catch(
      () => undefined,
    );
    await load();
  }

  if (!pnl) return <p className="p-4 text-faint">{error || c.loading}</p>;

  const t = pnl.totals;
  return (
    <>
      <Section title={c.title} hint={c.hint}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label={c.revenue} value={fmtLyd(t.revenue, locale)} sub={`${t.jobs} ${c.jobs}`} />
          <Stat label={c.confirmed} value={fmtLyd(t.confirmed, locale)} />
          <Stat label={c.costs} value={fmtLyd(t.costs, locale)} />
          {/*
            The one number nobody here can currently produce about themselves.
            Toned by sign rather than always green: a loss shown in success
            colours is a console that flatters, and a partner who catches it
            doing that stops believing the rest of the screen.
          */}
          <Stat
            label={c.profit}
            value={fmtLyd(t.profit, locale)}
            tone={t.profit < 0 ? "warn" : "good"}
          />
        </div>
        <p className="text-[11px] text-faint mt-3 leading-relaxed">{c.profitNote}</p>
      </Section>

      {pnl.byCategory.length > 0 ? (
        <Section title={c.byCategory}>
          <Bars
            rows={pnl.byCategory.map((r) => ({
              label: c.categories[r.category as keyof typeof c.categories] ?? r.category,
              value: r.amount,
            }))}
            format={(n) => fmtLyd(n, locale)}
          />
        </Section>
      ) : null}

      {pnl.months.length > 0 ? (
        <Section title={c.byMonth}>
          {/* Bars encode magnitude, and a loss has none to encode — so a
              negative month draws an empty bar while `display` still prints
              the real figure. Clamping both would turn a losing month into a
              break-even one on the one screen a partner would use to notice. */}
          <Bars
            rows={pnl.months.map((m) => ({
              label: m.month,
              value: Math.max(0, m.profit),
              display: fmtLyd(m.profit, locale),
            }))}
            format={(n) => fmtLyd(n, locale)}
          />
        </Section>
      ) : null}

      <Section
        title={c.add}
        action={
          <button className="text-xs font-bold text-link underline" onClick={() => setOpen((v) => !v)}>
            {open ? c.cancel : c.add}
          </button>
        }
      >
        {expenses.length === 0 && !open ? (
          <div className="text-center py-5">
            <p className="font-bold text-sea">{c.empty}</p>
            <p className="text-sm text-faint mt-1 max-w-sm mx-auto">{c.emptyBody}</p>
            <button className="btn-primary !py-2 !text-sm mt-3" onClick={() => setOpen(true)}>
              {c.add}
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {expenses.slice(0, 30).map((e) => (
              <li key={e.id} className="rounded-2xl bg-sand p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-sea text-sm truncate">{e.labelAr}</p>
                  <p className="text-[11px] text-muted tabular-nums" dir="ltr">
                    {e.day} · {c.categories[e.category as keyof typeof c.categories] ?? e.category}
                    {e.recurring ? ` · ${e.recurring === "weekly" ? c.recurringWeekly : c.recurringMonthly}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="tabular-nums text-sm text-sea">{fmtLyd(e.amount, locale)}</span>
                  <button className="text-xs underline text-faint" onClick={() => void remove(e.id)}>
                    {c.remove}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {open ? (
          <div className="grid gap-3 sm:grid-cols-2 mt-3">
            <label className="block text-sm">
              <span className="text-xs font-bold text-muted">{c.day}</span>
              <input className="input !py-2 !text-sm mt-1" type="date" dir="ltr" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-bold text-muted">{c.amount}</span>
              <input className="input !py-2 !text-sm mt-1" inputMode="numeric" dir="ltr" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-xs font-bold text-muted">{c.label}</span>
              <input className="input !py-2 !text-sm mt-1" value={f.labelAr} onChange={(e) => setF({ ...f, labelAr: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-bold text-muted">{c.category}</span>
              <select className="input !py-2 !text-sm mt-1" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {CATEGORIES.map((k) => (
                  <option key={k} value={k}>
                    {c.categories[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs font-bold text-muted">{c.recurring}</span>
              <select className="input !py-2 !text-sm mt-1" value={f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.value })}>
                <option value="">{c.recurringNo}</option>
                <option value="monthly">{c.recurringMonthly}</option>
                <option value="weekly">{c.recurringWeekly}</option>
              </select>
            </label>
            <div className="sm:col-span-2">
              <button className="btn-primary !py-2 !px-5 !text-sm" disabled={busy || !f.labelAr.trim()} onClick={() => void add()}>
                {busy ? c.saving : c.save}
              </button>
            </div>
          </div>
        ) : null}
      </Section>
    </>
  );
}
