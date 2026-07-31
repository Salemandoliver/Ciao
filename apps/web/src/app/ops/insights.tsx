"use client";
/**
 * Ops intelligence panels — funnel tiles, weekly trend, seasonality,
 * demand map, lead times, repeat rate. Single-hue (sea) sequential bars,
 * one measure per panel, values in ink. Data: /v1/ops/insights.
 */
import { useEffect, useState } from "react";
import { api, fmtLyd } from "@/lib/api";

interface Insights {
  windowDays: number;
  funnel: Record<string, { count: number; users: number }>;
  weekly: { week: string; bookings: number; gmv: number; deposits: number }[];
  seasonality: {
    byMonth: { month: string; count: number }[];
    byDow: { dow: number; count: number }[];
  };
  demandByArea: { area: string; searches: number; users: number }[];
  filterUsage: { filter: string; count: number }[];
  leadTimes: { bucket: string; count: number }[];
  repeatRate: { repeaters: number; totalGuests: number };
}

const MONTH_AR = ["", "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const DOW_AR = ["", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"];
const FILTER_AR: Record<string, string> = {
  minPrivacy: "🔒 ستر عالي",
  generator: "⚡ مولّد",
  familyOnly: "👨‍👩‍👧 عائلات",
  minBedrooms: "🛏 غرف",
  womensCapacity: "👥 سعة نسائية",
};

function Bars({
  data,
  formatValue,
}: {
  data: { label: string; value: number }[];
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2 text-sm" title={`${d.label}: ${d.value}`}>
          <span className="w-24 shrink-0 text-sea/70 text-xs">{d.label}</span>
          <div className="flex-1 h-4 bg-sand rounded-sm overflow-hidden">
            <div
              className="h-full bg-sea rounded-e-[4px]"
              style={{ width: `${(d.value / max) * 100}%`, minWidth: d.value > 0 ? 3 : 0 }}
            />
          </div>
          <span className="w-14 shrink-0 font-bold text-sea text-xs text-start">
            {formatValue ? formatValue(d.value) : d.value.toLocaleString("ar-LY")}
          </span>
        </div>
      ))}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3 text-center">
      <p className="text-2xl font-extrabold text-sea" dir="ltr">{value}</p>
      <p className="text-xs text-sea/70 mt-0.5">{label}</p>
      {sub ? <p className="text-[11px] text-amber-dark font-bold">{sub}</p> : null}
    </div>
  );
}

export function InsightsPanels() {
  const [data, setData] = useState<Insights | null>(null);
  const [days, setDays] = useState(90);
  const [err, setErr] = useState("");

  useEffect(() => {
    api<Insights>(`/v1/ops/insights?days=${days}`)
      .then(setData)
      .catch(() => setErr("تعذر تحميل لوحة الذكاء"));
  }, [days]);

  if (err) return <p className="text-sm text-red-700">{err}</p>;
  if (!data) return <p className="text-sm text-sea/60">جارٍ تحميل لوحة الذكاء…</p>;

  const f = data.funnel;
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}٪` : "—");
  const totalWeeklyGmv = data.weekly.reduce((s, w) => s + w.gmv, 0);

  return (
    <section className="mb-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg text-sea">📊 الذكاء والاتجاهات</h2>
        <div className="flex gap-1">
          {[30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`chip text-xs ${days === d ? "!bg-sea !text-white" : ""}`}
            >
              {d} يوم
            </button>
          ))}
        </div>
      </div>

      {/* Funnel — stat tiles with stage conversion */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Tile label="عمليات بحث" value={String(f.searches?.count ?? 0)} />
        <Tile
          label="مشاهدات عقارات"
          value={String(f.listingViews?.count ?? 0)}
          sub={pct(f.listingViews?.count ?? 0, f.searches?.count ?? 0)}
        />
        <Tile
          label="عروض أسعار"
          value={String(f.quotes?.count ?? 0)}
          sub={pct(f.quotes?.count ?? 0, f.listingViews?.count ?? 0)}
        />
        <Tile
          label="طلبات حجز"
          value={String(f.bookingRequests?.count ?? 0)}
          sub={pct(f.bookingRequests?.count ?? 0, f.quotes?.count ?? 0)}
        />
        <Tile
          label="عرابين مدفوعة"
          value={String(f.paid?.count ?? 0)}
          sub={pct(f.paid?.count ?? 0, f.bookingRequests?.count ?? 0)}
        />
        <Tile
          label="حجوزات مؤكدة"
          value={String(f.confirmed?.count ?? 0)}
          sub={pct(f.confirmed?.count ?? 0, f.paid?.count ?? 0)}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Weekly bookings (single measure; GMV gets its own summary line) */}
        <div className="card p-4">
          <h3 className="font-bold text-sea text-sm mb-2">
            الحجوزات أسبوعيًا
            <span className="font-normal text-sea/60"> · إجمالي القيمة {fmtLyd(totalWeeklyGmv)}</span>
          </h3>
          {data.weekly.length === 0 ? (
            <p className="text-xs text-sea/50">لا بيانات بعد.</p>
          ) : (
            <Bars
              data={data.weekly.map((w) => ({
                label: w.week.slice(5),
                value: w.bookings,
              }))}
            />
          )}
        </div>

        {/* Seasonality by check-in month */}
        <div className="card p-4">
          <h3 className="font-bold text-sea text-sm mb-2">الموسمية — حسب شهر الوصول</h3>
          <Bars
            data={data.seasonality.byMonth.map((m) => ({
              label: MONTH_AR[Number(m.month)] ?? m.month,
              value: m.count,
            }))}
          />
        </div>

        {/* Day-of-week (Thursday/Friday wedding-weekend signal) */}
        <div className="card p-4">
          <h3 className="font-bold text-sea text-sm mb-2">حسب يوم الوصول</h3>
          <Bars
            data={data.seasonality.byDow.map((d) => ({
              label: DOW_AR[d.dow] ?? String(d.dow),
              value: d.count,
            }))}
          />
        </div>

        {/* Demand by area (k-anonymized server-side) */}
        <div className="card p-4">
          <h3 className="font-bold text-sea text-sm mb-2">الطلب حسب المنطقة (بحث)</h3>
          {data.demandByArea.length === 0 ? (
            <p className="text-xs text-sea/50">
              تظهر المناطق عندما يبحث فيها ٣ مستخدمين مختلفون على الأقل (حماية للخصوصية).
            </p>
          ) : (
            <Bars data={data.demandByArea.map((a) => ({ label: a.area, value: a.searches }))} />
          )}
        </div>

        {/* Lead times */}
        <div className="card p-4">
          <h3 className="font-bold text-sea text-sm mb-2">قبل كم يوم يحجزون؟</h3>
          <Bars
            data={data.leadTimes.map((l) => ({ label: `${l.bucket} يوم`, value: l.count }))}
          />
        </div>

        {/* Filters + repeat */}
        <div className="card p-4 space-y-3">
          <div>
            <h3 className="font-bold text-sea text-sm mb-1">الفلاتر الأكثر استخدامًا</h3>
            {data.filterUsage.length === 0 ? (
              <p className="text-xs text-sea/50">لا بيانات بعد.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {data.filterUsage.map((x) => (
                  <span key={x.filter} className="chip text-xs">
                    {FILTER_AR[x.filter] ?? x.filter} · {x.count}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 className="font-bold text-sea text-sm">العملاء المتكررون</h3>
            <p className="text-2xl font-extrabold text-sea" dir="ltr">
              {data.repeatRate.totalGuests > 0
                ? `${Math.round((data.repeatRate.repeaters / data.repeatRate.totalGuests) * 100)}%`
                : "—"}
            </p>
            <p className="text-xs text-sea/60">
              {data.repeatRate.repeaters} من {data.repeatRate.totalGuests} ضيف حجزوا أكثر من مرة
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
