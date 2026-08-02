"use client";
/**
 * Ops intelligence panels — funnel tiles, weekly trend, seasonality,
 * demand map, lead times, repeat rate. Single-hue (sea) sequential bars,
 * one measure per panel, values in ink. Data: /v1/ops/insights.
 */
import { useEffect, useState } from "react";
import { api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { AREAS, fmtNum, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

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
  declaredProfiles?: {
    withBirthDate: number;
    withParty: number;
    marketingOptIn: number;
    total: number;
    avgPartySize: number;
    partySizes: { bucket: string; users: number }[];
    partySizesSuppressedRows: number;
    birthMonths: { month: number; users: number }[];
    birthMonthsSuppressedRows: number;
  };
}

const copy = {
  ar: {
    months: ["", "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
    dow: ["", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"],
    filters: {
      minPrivacy: "🔒 ستر عالي",
      generator: "⚡ مولّد",
      familyOnly: "👨‍👩‍👧 عائلات",
      minBedrooms: "🛏 غرف",
      womensCapacity: "👥 سعة نسائية",
    } as Record<string, string>,
    declaredTitle: "ما أخبرنا به الأعضاء",
    declaredBirthdays: "أعطونا تاريخ ميلادهم",
    declaredParty: "أعطونا ملف المجموعة",
    declaredOptIn: "يقبلون الرسائل التسويقية",
    declaredAvgParty: "متوسط حجم المجموعة",
    ofMembers: (total: string) => `من ${total} عضو`,
    optInNote: "الهدية تصل الجميع، الرسالة لمن وافق",
    avgPartyNote: "كبار وأطفال معًا",
    partySizesTitle: "أحجام المجموعات",
    birthMonthsTitle: "أشهر الميلاد",
    suppressed: (n: string) => `${n} صف مخفي (أقل من ٣ أعضاء)`,
    loadFailed: "تعذر تحميل لوحة الذكاء",
    loading: "جارٍ تحميل لوحة الذكاء…",
    title: "📊 الذكاء والاتجاهات",
    days: (n: number) => `${n} يوم`,
    pct: (n: number) => `${n}٪`,
    noData: "لا بيانات بعد.",

    fSearches: "عمليات بحث",
    fListingViews: "مشاهدات عقارات",
    fQuotes: "عروض أسعار",
    fBookingRequests: "طلبات حجز",
    fPaid: "عرابين مدفوعة",
    fConfirmed: "حجوزات مؤكدة",

    weeklyTitle: "الحجوزات أسبوعيًا",
    weeklyTotal: (amount: string) => ` · إجمالي القيمة ${amount}`,
    seasonByMonth: "الموسمية — حسب شهر الوصول",
    seasonByDow: "حسب يوم الوصول",
    demandByArea: "الطلب حسب المنطقة (بحث)",
    kAnonNote: "تظهر المناطق عندما يبحث فيها ٣ مستخدمين مختلفون على الأقل (حماية للخصوصية).",
    leadTimes: "قبل كم يوم يحجزون؟",
    leadBucket: (bucket: string) => `${bucket} يوم`,
    topFilters: "الفلاتر الأكثر استخدامًا",
    repeatTitle: "العملاء المتكررون",
    repeatNote: (repeaters: string, total: string) => `${repeaters} من ${total} ضيف حجزوا أكثر من مرة`,
  },
  en: {
    months: ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    dow: ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    filters: {
      minPrivacy: "🔒 High privacy",
      generator: "⚡ Generator",
      familyOnly: "👨‍👩‍👧 Families",
      minBedrooms: "🛏 Bedrooms",
      womensCapacity: "👥 Women's capacity",
    } as Record<string, string>,
    declaredTitle: "What members told us",
    declaredBirthdays: "Gave a date of birth",
    declaredParty: "Gave a party profile",
    declaredOptIn: "Accept marketing messages",
    declaredAvgParty: "Average party size",
    ofMembers: (total: string) => `of ${total} members`,
    optInNote: "The gift reaches everyone; the message needs consent",
    avgPartyNote: "Adults and children together",
    partySizesTitle: "Party sizes",
    birthMonthsTitle: "Birth months",
    suppressed: (n: string) => `${n} row(s) withheld (fewer than 3 members)`,
    loadFailed: "Could not load the intelligence panel",
    loading: "Loading the intelligence panel…",
    title: "📊 Intelligence and trends",
    days: (n: number) => `${n} days`,
    pct: (n: number) => `${n}%`,
    noData: "Nothing yet.",

    fSearches: "Searches",
    fListingViews: "Listing views",
    fQuotes: "Quotes",
    fBookingRequests: "Booking requests",
    fPaid: "Deposits paid",
    fConfirmed: "Bookings confirmed",

    weeklyTitle: "Bookings by week",
    weeklyTotal: (amount: string) => ` · total value ${amount}`,
    seasonByMonth: "Seasonality — by check-in month",
    seasonByDow: "By check-in day",
    demandByArea: "Demand by area (searches)",
    kAnonNote: "An area appears once at least 3 different users have searched it (privacy protection).",
    leadTimes: "How far ahead do they book?",
    leadBucket: (bucket: string) => `${bucket} days`,
    topFilters: "Most-used filters",
    repeatTitle: "Repeat customers",
    repeatNote: (repeaters: string, total: string) =>
      `${repeaters} of ${total} guests booked more than once`,
  },
} satisfies Record<Locale, unknown>;

function Bars({
  data,
  formatValue,
}: {
  data: { label: string; value: number }[];
  formatValue?: (v: number) => string;
}) {
  const locale = useLocale();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2 text-sm" title={`${d.label}: ${d.value}`}>
          <span className="w-24 shrink-0 text-muted text-xs">{d.label}</span>
          <div className="flex-1 h-4 bg-sand rounded-sm overflow-hidden">
            <div
              className="h-full bg-sea rounded-e-[4px]"
              style={{ width: `${(d.value / max) * 100}%`, minWidth: d.value > 0 ? 3 : 0 }}
            />
          </div>
          <span className="w-14 shrink-0 font-bold text-sea text-xs text-start">
            {formatValue ? formatValue(d.value) : fmtNum(locale, d.value)}
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
      <p className="text-xs text-muted mt-0.5">{label}</p>
      {sub ? <p className="text-[11px] text-link font-bold">{sub}</p> : null}
    </div>
  );
}

export function InsightsPanels() {
  const locale = useLocale();
  const c = copy[locale];
  const [data, setData] = useState<Insights | null>(null);
  const [days, setDays] = useState(90);
  const [err, setErr] = useState("");

  useEffect(() => {
    api<Insights>(`/v1/ops/insights?days=${days}`)
      .then(setData)
      .catch(() => setErr(c.loadFailed));
  }, [days, c]);

  if (err) return <p className="text-sm text-danger">{err}</p>;
  if (!data) return <p className="text-sm text-faint">{c.loading}</p>;

  const f = data.funnel;
  const pct = (a: number, b: number) => (b > 0 ? c.pct(Math.round((a / b) * 100)) : "—");
  const totalWeeklyGmv = data.weekly.reduce((s, w) => s + w.gmv, 0);

  return (
    <section className="mb-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg text-sea">{c.title}</h2>
        <div className="flex gap-1">
          {[30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`chip text-xs ${days === d ? "!bg-sea !text-white" : ""}`}
            >
              {c.days(d)}
            </button>
          ))}
        </div>
      </div>

      {/* Funnel — stat tiles with stage conversion */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Tile label={c.fSearches} value={String(f.searches?.count ?? 0)} />
        <Tile
          label={c.fListingViews}
          value={String(f.listingViews?.count ?? 0)}
          sub={pct(f.listingViews?.count ?? 0, f.searches?.count ?? 0)}
        />
        <Tile
          label={c.fQuotes}
          value={String(f.quotes?.count ?? 0)}
          sub={pct(f.quotes?.count ?? 0, f.listingViews?.count ?? 0)}
        />
        <Tile
          label={c.fBookingRequests}
          value={String(f.bookingRequests?.count ?? 0)}
          sub={pct(f.bookingRequests?.count ?? 0, f.quotes?.count ?? 0)}
        />
        <Tile
          label={c.fPaid}
          value={String(f.paid?.count ?? 0)}
          sub={pct(f.paid?.count ?? 0, f.bookingRequests?.count ?? 0)}
        />
        <Tile
          label={c.fConfirmed}
          value={String(f.confirmed?.count ?? 0)}
          sub={pct(f.confirmed?.count ?? 0, f.paid?.count ?? 0)}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Weekly bookings (single measure; GMV gets its own summary line) */}
        <div className="card p-4">
          <h3 className="font-bold text-sea text-sm mb-2">
            {c.weeklyTitle}
            <span className="font-normal text-faint">
              {c.weeklyTotal(fmtLyd(totalWeeklyGmv, locale))}
            </span>
          </h3>
          {data.weekly.length === 0 ? (
            <p className="text-xs text-faint">{c.noData}</p>
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
          <h3 className="font-bold text-sea text-sm mb-2">{c.seasonByMonth}</h3>
          <Bars
            data={data.seasonality.byMonth.map((m) => ({
              label: c.months[Number(m.month)] ?? m.month,
              value: m.count,
            }))}
          />
        </div>

        {/* Day-of-week (Thursday/Friday wedding-weekend signal) */}
        <div className="card p-4">
          <h3 className="font-bold text-sea text-sm mb-2">{c.seasonByDow}</h3>
          <Bars
            data={data.seasonality.byDow.map((d) => ({
              label: c.dow[d.dow] ?? String(d.dow),
              value: d.count,
            }))}
          />
        </div>

        {/* Demand by area (k-anonymized server-side) */}
        <div className="card p-4">
          <h3 className="font-bold text-sea text-sm mb-2">{c.demandByArea}</h3>
          {data.demandByArea.length === 0 ? (
            <p className="text-xs text-faint">{c.kAnonNote}</p>
          ) : (
            <Bars
              data={data.demandByArea.map((a) => ({
                label: term(AREAS, locale, a.area),
                value: a.searches,
              }))}
            />
          )}
        </div>

        {/* Lead times */}
        <div className="card p-4">
          <h3 className="font-bold text-sea text-sm mb-2">{c.leadTimes}</h3>
          <Bars
            data={data.leadTimes.map((l) => ({ label: c.leadBucket(l.bucket), value: l.count }))}
          />
        </div>

        {/* Filters + repeat */}
        <div className="card p-4 space-y-3">
          <div>
            <h3 className="font-bold text-sea text-sm mb-1">{c.topFilters}</h3>
            {data.filterUsage.length === 0 ? (
              <p className="text-xs text-faint">{c.noData}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {data.filterUsage.map((x) => (
                  <span key={x.filter} className="chip text-xs">
                    {c.filters[x.filter] ?? x.filter} · {fmtNum(locale, x.count)}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 className="font-bold text-sea text-sm">{c.repeatTitle}</h3>
            <p className="text-2xl font-extrabold text-sea" dir="ltr">
              {data.repeatRate.totalGuests > 0
                ? `${Math.round((data.repeatRate.repeaters / data.repeatRate.totalGuests) * 100)}%`
                : "—"}
            </p>
            <p className="text-xs text-faint">
              {c.repeatNote(
                fmtNum(locale, data.repeatRate.repeaters),
                fmtNum(locale, data.repeatRate.totalGuests),
              )}
            </p>
          </div>
        </div>
      </div>

      {/*
        Declared profiles.
        Not a demographic panel — it answers the two operating questions
        ("can the birthday campaign run yet?" and "what size of party are we
        actually serving?") and nothing else. Grouped rows are suppressed below
        three members like every other panel here, and the suppressed count is
        printed rather than hidden, so a thin month reads as withheld instead
        of as zero.
      */}
      {data.declaredProfiles ? (
        <div className="card p-4 mt-4">
          <h2 className="font-bold text-sea mb-3">{c.declaredTitle}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile
              label={c.declaredBirthdays}
              value={fmtNum(locale, data.declaredProfiles.withBirthDate)}
              sub={c.ofMembers(fmtNum(locale, data.declaredProfiles.total))}
            />
            <Tile
              label={c.declaredParty}
              value={fmtNum(locale, data.declaredProfiles.withParty)}
              sub={c.ofMembers(fmtNum(locale, data.declaredProfiles.total))}
            />
            <Tile
              label={c.declaredOptIn}
              value={fmtNum(locale, data.declaredProfiles.marketingOptIn)}
              sub={c.optInNote}
            />
            <Tile
              label={c.declaredAvgParty}
              value={String(data.declaredProfiles.avgPartySize || "—")}
              sub={c.avgPartyNote}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <h3 className="font-bold text-sea text-sm mb-2">{c.partySizesTitle}</h3>
              <Bars
                data={data.declaredProfiles.partySizes.map((r) => ({
                  label: r.bucket,
                  value: r.users,
                }))}
              />
              {data.declaredProfiles.partySizesSuppressedRows > 0 ? (
                <p className="text-[11px] text-faint mt-2">
                  {c.suppressed(
                    fmtNum(locale, data.declaredProfiles.partySizesSuppressedRows),
                  )}
                </p>
              ) : null}
            </div>
            <div>
              <h3 className="font-bold text-sea text-sm mb-2">{c.birthMonthsTitle}</h3>
              <Bars
                data={data.declaredProfiles.birthMonths.map((r) => ({
                  // `months` is 1-indexed with a blank at 0 so month numbers
                  // read straight through — no off-by-one to remember.
                  label: c.months[r.month] ?? String(r.month),
                  value: r.users,
                }))}
              />
              {data.declaredProfiles.birthMonthsSuppressedRows > 0 ? (
                <p className="text-[11px] text-faint mt-2">
                  {c.suppressed(
                    fmtNum(locale, data.declaredProfiles.birthMonthsSuppressedRows),
                  )}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
