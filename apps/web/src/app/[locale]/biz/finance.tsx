"use client";
/**
 * Finance — the money screen.
 *
 * Every figure comes from double-entry postings, so this page and the
 * accountant can never disagree. The trial-balance check is shown first and
 * unmissably: if debits and credits have drifted apart, nothing else on this
 * page can be trusted and the operator needs to know that before reading a
 * revenue number.
 */
import { useCallback, useEffect, useState } from "react";
import { api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { VERTICALS, accountLabel, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Bars, Money, Section, Stat } from "./lib";

interface Finance {
  windowDays: number;
  headline: { gmv: number; commission: number; takeRateBps: number; depositsCollected: number };
  ledger: {
    accounts: Record<string, { debit: number; credit: number; net: number; n: number }>;
    totalDebit: number;
    totalCredit: number;
    balanced: boolean;
    drift: number;
  };
  monthly: {
    month: string;
    bookings: number;
    gmv: number;
    commission: number;
    deposits: number;
    takeRateBps: number;
  }[];
  byVertical: { vertical: string; bookings: number; gmv: number; commission: number }[];
  payouts: { status: string; total: number; n: number }[];
  refunds: { status: string; total: number; n: number }[];
}

interface ByBusiness {
  items: {
    listingId: string;
    slug: string;
    titleAr: string;
    vertical: string;
    hostName: string | null;
    bookings: number;
    gmv: number;
    commission: number;
  }[];
}

/**
 * Finance copy.
 *
 * The out-of-balance warning is the one string on this screen that must not be
 * softened in translation. If debits and credits have drifted, every other
 * figure here is suspect, and the English says so as bluntly as the Arabic
 * does — "do not rely on the figures below", not "figures may be inaccurate".
 */
const copy = {
  ar: {
    payouts: {
      queued: "بانتظار موعد الصرف",
      released: "جاهزة للصرف",
      paid: "مصروفة",
      held: "محتجزة",
    } as Record<string, string>,
    refunds: {
      pending: "قيد التنفيذ",
      completed: "منفّذة",
      failed: "فشلت",
    } as Record<string, string>,
    years: (n: number) => `${n} سنة`,
    days: (n: number) => `${n} يوم`,
    exportCsv: "⬇ تصدير CSV",
    loadFailed: "تعذر تحميل البيانات المالية",
    loading: "جارٍ التحميل…",
    unbalanced: (drift: string) => `⚠ دفتر الأستاذ غير متوازن — فرق ${drift}`,
    unbalancedBody:
      "لا تعتمد على الأرقام أدناه قبل تسوية القيود. راجع صفحة المطابقة في لوحة العمليات.",
    gmv: "قيمة الحجوزات (GMV)",
    commission: "عمولة تشاو",
    takeRate: "نسبة العمولة الفعلية",
    takeRateSub: "العمولة ÷ قيمة الحجوزات",
    pct: (n: string) => `${n}٪`,
    depositsCollected: "العرابين المحصّلة",
    trialBalance: "ميزان المراجعة",
    colAccount: "الحساب",
    colDebit: "مدين",
    colCredit: "دائن",
    colNet: "الصافي",
    colEntries: "قيود",
    total: "الإجمالي",
    balanced: "✅ متوازن",
    notBalanced: "⚠ غير متوازن",
    monthly: "الاتجاه الشهري",
    colMonth: "الشهر",
    colBookings: "حجوزات",
    colValue: "القيمة",
    colCommission: "العمولة",
    colRate: "النسبة",
    noData: "لا بيانات بعد",
    byVertical: "القيمة حسب القطاع",
    hostPayables: "مستحقات المضيفين",
    noPayables: "لا مستحقات بعد",
    refundsTitle: "الاسترجاعات",
    noRefunds: "لا استرجاعات",
    byBusiness: "الأداء حسب النشاط",
    byBusinessNote: "الأعلى قيمة أولًا",
    colBusiness: "النشاط",
    colVertical: "القطاع",
  },
  en: {
    payouts: {
      queued: "Queued for the payout run",
      released: "Released for payment",
      paid: "Paid",
      held: "Held",
    } as Record<string, string>,
    refunds: {
      pending: "In progress",
      completed: "Completed",
      failed: "Failed",
    } as Record<string, string>,
    years: (n: number) => (n === 1 ? "1 year" : `${n} years`),
    days: (n: number) => `${n} days`,
    exportCsv: "⬇ Export CSV",
    loadFailed: "Could not load the finance data",
    loading: "Loading…",
    unbalanced: (drift: string) => `⚠ Ledger out of balance — ${drift} adrift`,
    unbalancedBody:
      "Do not rely on the figures below until the entries are reconciled. Go to the reconciliation page on the ops board.",
    gmv: "Booking value (GMV)",
    commission: "Ciao commission",
    takeRate: "Effective take rate",
    takeRateSub: "Commission ÷ booking value",
    pct: (n: string) => `${n}%`,
    depositsCollected: "Deposits collected",
    trialBalance: "Trial balance",
    colAccount: "Account",
    colDebit: "Debit",
    colCredit: "Credit",
    colNet: "Net",
    colEntries: "Entries",
    total: "Total",
    balanced: "✅ Balanced",
    notBalanced: "⚠ Out of balance",
    monthly: "Monthly trend",
    colMonth: "Month",
    colBookings: "Bookings",
    colValue: "Value",
    colCommission: "Commission",
    colRate: "Rate",
    noData: "Nothing yet",
    byVertical: "Value by vertical",
    hostPayables: "Host payables",
    noPayables: "No payables yet",
    refundsTitle: "Refunds",
    noRefunds: "No refunds",
    byBusiness: "Performance by business",
    byBusinessNote: "Highest value first",
    colBusiness: "Business",
    colVertical: "Vertical",
  },
} satisfies Record<Locale, unknown>;

export function FinanceTab() {
  const locale = useLocale();
  const c = copy[locale];
  const [data, setData] = useState<Finance | null>(null);
  const [biz, setBiz] = useState<ByBusiness | null>(null);
  const [days, setDays] = useState(90);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [f, b] = await Promise.all([
        api<Finance>(`/v1/biz/finance?days=${days}`),
        api<ByBusiness>(`/v1/biz/finance/by-business?days=${days}`),
      ]);
      setData(f);
      setBiz(b);
    } catch {
      setErr(copy[locale].loadFailed);
    }
  }, [days, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  function exportCsv() {
    if (!biz) return;
    const rows = [
      ["listing", "vertical", "host", "bookings", "gmv_lyd", "commission_lyd"],
      ...biz.items.map((i) => [
        i.titleAr.replace(/,/g, " "),
        i.vertical,
        (i.hostName ?? "").replace(/,/g, " "),
        String(i.bookings),
        (i.gmv / 1000).toFixed(2),
        (i.commission / 1000).toFixed(2),
      ]),
    ];
    // BOM so Excel opens Arabic correctly — the tool an accountant actually uses.
    const csv = "﻿" + rows.map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ciao-finance-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (err) return <p className="p-4 text-danger font-bold">{err}</p>;
  if (!data) return <p className="p-4 text-faint">{c.loading}</p>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {[30, 90, 365, 730].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`chip ${days === d ? "!bg-sea !text-white" : ""}`}
          >
            {d >= 365 ? c.years(d / 365) : c.days(d)}
          </button>
        ))}
        <button className="chip" onClick={exportCsv}>
          {c.exportCsv}
        </button>
      </div>

      {!data.ledger.balanced ? (
        <div className="rounded-2xl tone-warn p-3 mb-3">
          <p className="font-bold text-danger text-sm">
            {c.unbalanced(fmtLyd(Math.abs(data.ledger.drift), locale))}
          </p>
          <p className="text-xs text-danger/80 mt-1">{c.unbalancedBody}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label={c.gmv} value={<Money dirhams={data.headline.gmv} />} />
        <Stat label={c.commission} value={<Money dirhams={data.headline.commission} />} />
        <Stat
          label={c.takeRate}
          value={c.pct((data.headline.takeRateBps / 100).toFixed(1))}
          sub={c.takeRateSub}
        />
        <Stat
          label={c.depositsCollected}
          value={<Money dirhams={data.headline.depositsCollected} />}
        />
      </div>

      <Section title={c.trialBalance}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-faint">
              <tr>
                <th className="text-start py-1">{c.colAccount}</th>
                <th className="text-start py-1">{c.colDebit}</th>
                <th className="text-start py-1">{c.colCredit}</th>
                <th className="text-start py-1">{c.colNet}</th>
                <th className="text-start py-1">{c.colEntries}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.ledger.accounts)
                .sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net))
                .map(([account, a]) => (
                  <tr key={account} className="border-t border-sand">
                    <td className="py-1.5 font-bold text-sea">{accountLabel(locale, account)}</td>
                    <td className="py-1.5">
                      <Money dirhams={a.debit} />
                    </td>
                    <td className="py-1.5">
                      <Money dirhams={a.credit} />
                    </td>
                    <td className="py-1.5 font-bold">
                      <Money dirhams={a.net} />
                    </td>
                    <td className="py-1.5 tabular-nums text-faint">{a.n}</td>
                  </tr>
                ))}
              <tr className="border-t-2 border-sea/20 font-bold">
                <td className="py-1.5">{c.total}</td>
                <td className="py-1.5">
                  <Money dirhams={data.ledger.totalDebit} />
                </td>
                <td className="py-1.5">
                  <Money dirhams={data.ledger.totalCredit} />
                </td>
                <td className="py-1.5" colSpan={2}>
                  {data.ledger.balanced ? c.balanced : c.notBalanced}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={c.monthly}>
        {data.monthly.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-faint">
                <tr>
                  <th className="text-start py-1">{c.colMonth}</th>
                  <th className="text-start py-1">{c.colBookings}</th>
                  <th className="text-start py-1">{c.colValue}</th>
                  <th className="text-start py-1">{c.colCommission}</th>
                  <th className="text-start py-1">{c.colRate}</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((m) => (
                  <tr key={m.month} className="border-t border-sand">
                    <td className="py-1.5 font-bold" dir="ltr">{m.month}</td>
                    <td className="py-1.5 tabular-nums">{m.bookings}</td>
                    <td className="py-1.5">
                      <Money dirhams={m.gmv} />
                    </td>
                    <td className="py-1.5">
                      <Money dirhams={m.commission} />
                    </td>
                    <td className="py-1.5 tabular-nums">
                      {c.pct((m.takeRateBps / 100).toFixed(1))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-faint">{c.noData}</p>
        )}
      </Section>

      <Section title={c.byVertical}>
        <Bars
          rows={data.byVertical.map((v) => ({
            label: term(VERTICALS, locale, v.vertical),
            value: v.gmv,
          }))}
          format={(n) => fmtLyd(n, locale)}
        />
      </Section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 sm:gap-4">
        <Section title={c.hostPayables}>
          {data.payouts.length ? (
            <Bars
              rows={data.payouts.map((p) => ({
                label: `${c.payouts[p.status] ?? p.status} (${p.n})`,
                value: p.total,
              }))}
              format={(n) => fmtLyd(n, locale)}
            />
          ) : (
            <p className="text-sm text-faint">{c.noPayables}</p>
          )}
        </Section>
        <Section title={c.refundsTitle}>
          {data.refunds.length ? (
            <Bars
              rows={data.refunds.map((r) => ({
                label: `${c.refunds[r.status] ?? r.status} (${r.n})`,
                value: r.total,
              }))}
              format={(n) => fmtLyd(n, locale)}
            />
          ) : (
            <p className="text-sm text-faint">{c.noRefunds}</p>
          )}
        </Section>
      </div>

      <Section
        title={c.byBusiness}
        action={<span className="text-[11px] text-faint">{c.byBusinessNote}</span>}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-faint">
              <tr>
                <th className="text-start py-1">{c.colBusiness}</th>
                <th className="text-start py-1">{c.colVertical}</th>
                <th className="text-start py-1">{c.colBookings}</th>
                <th className="text-start py-1">{c.colValue}</th>
                <th className="text-start py-1">{c.colCommission}</th>
              </tr>
            </thead>
            <tbody>
              {(biz?.items ?? []).slice(0, 30).map((i) => (
                <tr key={i.listingId} className="border-t border-sand">
                  <td className="py-1.5">
                    <div className="font-bold text-sea">{i.titleAr}</div>
                    <div className="text-[11px] text-faint">{i.hostName ?? "—"}</div>
                  </td>
                  <td className="py-1.5">{term(VERTICALS, locale, i.vertical)}</td>
                  <td className="py-1.5 tabular-nums">{i.bookings}</td>
                  <td className="py-1.5">
                    <Money dirhams={i.gmv} />
                  </td>
                  <td className="py-1.5">
                    <Money dirhams={i.commission} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
