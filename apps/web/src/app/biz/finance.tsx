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
import { Bars, Money, Section, Stat, VERTICAL_AR, accountLabel } from "./lib";

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

const PAYOUT_AR: Record<string, string> = {
  queued: "بانتظار موعد الصرف",
  released: "جاهزة للصرف",
  paid: "مصروفة",
  held: "محتجزة",
};
const REFUND_AR: Record<string, string> = {
  pending: "قيد التنفيذ",
  completed: "منفّذة",
  failed: "فشلت",
};

export function FinanceTab() {
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
      setErr("تعذر تحميل البيانات المالية");
    }
  }, [days]);

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

  if (err) return <p className="p-4 text-red-700 font-bold">{err}</p>;
  if (!data) return <p className="p-4 text-sea/60">جارٍ التحميل…</p>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {[30, 90, 365, 730].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`chip ${days === d ? "!bg-sea !text-white" : ""}`}
          >
            {d >= 365 ? `${d / 365} سنة` : `${d} يوم`}
          </button>
        ))}
        <button className="chip" onClick={exportCsv}>
          ⬇ تصدير CSV
        </button>
      </div>

      {!data.ledger.balanced ? (
        <div className="rounded-2xl bg-red-50 ring-1 ring-red-300 p-3 mb-3">
          <p className="font-bold text-red-800 text-sm">
            ⚠ دفتر الأستاذ غير متوازن — فرق {fmtLyd(Math.abs(data.ledger.drift))}
          </p>
          <p className="text-xs text-red-700 mt-1">
            لا تعتمد على الأرقام أدناه قبل تسوية القيود. راجع صفحة المطابقة في لوحة العمليات.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="قيمة الحجوزات (GMV)" value={<Money dirhams={data.headline.gmv} />} />
        <Stat label="عمولة تشاو" value={<Money dirhams={data.headline.commission} />} />
        <Stat
          label="نسبة العمولة الفعلية"
          value={`${(data.headline.takeRateBps / 100).toFixed(1)}٪`}
          sub="العمولة ÷ قيمة الحجوزات"
        />
        <Stat
          label="العرابين المحصّلة"
          value={<Money dirhams={data.headline.depositsCollected} />}
        />
      </div>

      <Section title="ميزان المراجعة">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-sea/60">
              <tr>
                <th className="text-start py-1">الحساب</th>
                <th className="text-start py-1">مدين</th>
                <th className="text-start py-1">دائن</th>
                <th className="text-start py-1">الصافي</th>
                <th className="text-start py-1">قيود</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.ledger.accounts)
                .sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net))
                .map(([account, a]) => (
                  <tr key={account} className="border-t border-sand">
                    <td className="py-1.5 font-bold text-sea">{accountLabel(account)}</td>
                    <td className="py-1.5">
                      <Money dirhams={a.debit} />
                    </td>
                    <td className="py-1.5">
                      <Money dirhams={a.credit} />
                    </td>
                    <td className="py-1.5 font-bold">
                      <Money dirhams={a.net} />
                    </td>
                    <td className="py-1.5 tabular-nums text-sea/60">{a.n}</td>
                  </tr>
                ))}
              <tr className="border-t-2 border-sea/20 font-bold">
                <td className="py-1.5">الإجمالي</td>
                <td className="py-1.5">
                  <Money dirhams={data.ledger.totalDebit} />
                </td>
                <td className="py-1.5">
                  <Money dirhams={data.ledger.totalCredit} />
                </td>
                <td className="py-1.5" colSpan={2}>
                  {data.ledger.balanced ? "✅ متوازن" : "⚠ غير متوازن"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="الاتجاه الشهري">
        {data.monthly.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-sea/60">
                <tr>
                  <th className="text-start py-1">الشهر</th>
                  <th className="text-start py-1">حجوزات</th>
                  <th className="text-start py-1">القيمة</th>
                  <th className="text-start py-1">العمولة</th>
                  <th className="text-start py-1">النسبة</th>
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
                    <td className="py-1.5 tabular-nums">{(m.takeRateBps / 100).toFixed(1)}٪</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-sea/50">لا بيانات بعد</p>
        )}
      </Section>

      <Section title="القيمة حسب القطاع">
        <Bars
          rows={data.byVertical.map((v) => ({
            label: VERTICAL_AR[v.vertical] ?? v.vertical,
            value: v.gmv,
          }))}
          format={(n) => fmtLyd(n)}
        />
      </Section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 sm:gap-4">
        <Section title="مستحقات المضيفين">
          {data.payouts.length ? (
            <Bars
              rows={data.payouts.map((p) => ({
                label: `${PAYOUT_AR[p.status] ?? p.status} (${p.n})`,
                value: p.total,
              }))}
              format={(n) => fmtLyd(n)}
            />
          ) : (
            <p className="text-sm text-sea/50">لا مستحقات بعد</p>
          )}
        </Section>
        <Section title="الاسترجاعات">
          {data.refunds.length ? (
            <Bars
              rows={data.refunds.map((r) => ({
                label: `${REFUND_AR[r.status] ?? r.status} (${r.n})`,
                value: r.total,
              }))}
              format={(n) => fmtLyd(n)}
            />
          ) : (
            <p className="text-sm text-sea/50">لا استرجاعات</p>
          )}
        </Section>
      </div>

      <Section title="الأداء حسب النشاط" action={<span className="text-[11px] text-sea/50">الأعلى قيمة أولًا</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-sea/60">
              <tr>
                <th className="text-start py-1">النشاط</th>
                <th className="text-start py-1">القطاع</th>
                <th className="text-start py-1">حجوزات</th>
                <th className="text-start py-1">القيمة</th>
                <th className="text-start py-1">العمولة</th>
              </tr>
            </thead>
            <tbody>
              {(biz?.items ?? []).slice(0, 30).map((i) => (
                <tr key={i.listingId} className="border-t border-sand">
                  <td className="py-1.5">
                    <div className="font-bold text-sea">{i.titleAr}</div>
                    <div className="text-[11px] text-sea/50">{i.hostName ?? "—"}</div>
                  </td>
                  <td className="py-1.5">{VERTICAL_AR[i.vertical] ?? i.vertical}</td>
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
