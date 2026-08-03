"use client";
/**
 * Overview — the screen a founder opens in the morning.
 *
 * Ordered by what you can act on, not by what is easiest to compute: what
 * needs a human today comes first, then money, then demand, then supply.
 */
import { useCallback, useEffect, useState } from "react";
import { api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { LISTING_STATUS, fmtDate, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Bars, Money, Pill, Section, Stat } from "./lib";
import { PartnerPanel } from "./partner-panel";

interface Overview {
  windowDays: number;
  money: {
    revenue: number;
    depositsHeld: number;
    hostPayables: number;
    railSettlementPending: number;
    guestCredit: number;
  };
  demand: {
    committedBookings: number;
    gmv: number;
    depositsCollected: number;
    byState: Record<string, number>;
  };
  supply: {
    venues: number;
    verified: number;
    verificationExpiringSoon: number;
    listingsByStatus: Record<string, number>;
  };
  needsAttention: {
    pendingVerifications: number;
    bookingsAwaitingHost: number;
    openDisputes: number;
    overdueDisputes: number;
    disputes: { id: string; bookingId: string; category: string; dueAt: string; overdue: boolean }[];
    degradedRails: string[];
  };
  posture: { demoMode: boolean; acceptingBookings: boolean; announcementAr: string };
}

/**
 * Booking states and dispute categories, in operations English.
 *
 * These are the state machine's own names, so they are labelled by what has
 * happened rather than by how it feels: "host did not respond in time", not
 * "the host was slow". An operator reading this column is deciding who to ring.
 */
const copy = {
  ar: {
    states: {
      draft: "مسودة",
      requested: "طلب جديد",
      payment_pending: "بانتظار الدفع",
      payment_held: "عربون محجوز — بانتظار المضيف",
      host_confirmed: "أكّده المضيف",
      confirmed: "مؤكد",
      pre_arrival_reconfirmed: "أُعيد تأكيده قبل الوصول",
      checked_in: "وصل الضيف",
      completed: "مكتمل",
      reviewed: "تم التقييم",
      host_declined: "رفضه المضيف",
      host_timeout: "انتهت مهلة المضيف",
      payment_failed: "فشل الدفع",
      cancelled_by_guest: "ألغاه الضيف",
      cancelled_by_host: "ألغاه المضيف",
      force_majeure_credit: "ظرف قاهر — رصيد",
      disputed: "شكوى مفتوحة",
      resolved: "شكوى محلولة",
      exchange_listed: "معروض للتحويل",
      transferred: "حُوِّل لضيف آخر",
      no_show: "لم يحضر",
      expired: "منتهي",
    } as Record<string, string>,
    categories: {
      misrepresentation: "عدم مطابقة للوصف",
      double_booking: "حجز مزدوج",
      no_show: "عدم حضور",
      cash_mismatch: "خلاف على المبلغ النقدي",
      other: "أخرى",
    } as Record<string, string>,
    year: "سنة",
    days: (n: number) => `${n} يوم`,
    demoMode: "وضع العرض التجريبي",
    bookingsOff: "الحجوزات موقوفة",
    loadFailed: "تعذر تحميل لوحة التحكم",
    loading: "جارٍ التحميل…",
    attention: (n: number) => `يحتاج تدخلك اليوم (${n})`,
    attentionClear: "لا شيء ينتظر تدخلك",
    openDisputes: "شكاوى مفتوحة",
    overdue: (n: number) => `${n} تجاوزت المهلة`,
    withinSla: "ضمن المهلة",
    pendingVerifications: "معاينات بانتظار الاعتماد",
    awaitingHost: "حجوزات تنتظر ردّ المضيف",
    degradedRails: "وسائل دفع متعثرة",
    railsSeparator: "، ",
    railsAllUp: "كلها تعمل",
    colDispute: "الشكوى",
    colCategory: "النوع",
    colDue: "المهلة",
    pastDue: "تجاوزت المهلة",
    moneyTitle: "المال (من دفتر الأستاذ)",
    revenue: "إيرادات تشاو",
    depositsHeld: "عرابين محتجزة",
    depositsHeldSub: "أموال ليست لنا — مستحقة للأمام",
    hostPayables: "مستحقات المضيفين",
    railPending: "تحت التسوية لدى مزوّد الدفع",
    demandTitle: "الطلب",
    committed: "حجوزات مؤكدة",
    gmv: "قيمة الحجوزات",
    depositsCollected: "عرابين محصّلة",
    supplyTitle: "العرض",
    venues: "أماكن مسجّلة",
    verified: "موثّقة ميدانيًا",
    awaitingVisit: (n: number) => `${n} بانتظار المعاينة`,
    expiringSoon: "توثيق يقارب الانتهاء",
    within30Days: "خلال 30 يومًا",
    footer: (gmv: string, days: number) =>
      `أرقام المال محسوبة من دفتر الأستاذ المزدوج لا من جدول الحجوزات، حتى لا تختلف الشاشة مع المحاسب أبدًا. المبالغ بالدينار الليبي؛ إجمالي القيمة ${gmv} خلال ${days} يومًا.`,
  },
  en: {
    states: {
      draft: "Draft",
      requested: "New request",
      payment_pending: "Awaiting payment",
      payment_held: "Deposit held — awaiting host",
      host_confirmed: "Host confirmed",
      confirmed: "Confirmed",
      pre_arrival_reconfirmed: "Reconfirmed before arrival",
      checked_in: "Guest checked in",
      completed: "Completed",
      reviewed: "Reviewed",
      host_declined: "Host declined",
      host_timeout: "Host did not respond in time",
      payment_failed: "Payment failed",
      cancelled_by_guest: "Cancelled by guest",
      cancelled_by_host: "Cancelled by host",
      force_majeure_credit: "Force majeure — credited",
      disputed: "Dispute open",
      resolved: "Dispute resolved",
      exchange_listed: "Listed for transfer",
      transferred: "Transferred to another guest",
      no_show: "No-show",
      expired: "Expired",
    } as Record<string, string>,
    categories: {
      misrepresentation: "Not as described",
      double_booking: "Double booking",
      no_show: "No-show",
      cash_mismatch: "Cash amount disputed",
      other: "Other",
    } as Record<string, string>,
    year: "1 year",
    days: (n: number) => `${n} days`,
    demoMode: "Demo mode",
    bookingsOff: "Bookings suspended",
    loadFailed: "Could not load the dashboard",
    loading: "Loading…",
    attention: (n: number) => `Needs you today (${n})`,
    attentionClear: "Nothing waiting on you",
    openDisputes: "Open disputes",
    overdue: (n: number) => `${n} past the deadline`,
    withinSla: "Within the deadline",
    pendingVerifications: "Inspections awaiting sign-off",
    awaitingHost: "Bookings awaiting host reply",
    degradedRails: "Degraded payment rails",
    railsSeparator: ", ",
    railsAllUp: "All up",
    colDispute: "Dispute",
    colCategory: "Category",
    colDue: "Due",
    pastDue: "Past the deadline",
    moneyTitle: "Money (from the ledger)",
    revenue: "Ciao revenue",
    depositsHeld: "Deposits held",
    depositsHeldSub: "Not our money — owed onward",
    hostPayables: "Host payables",
    railPending: "Awaiting settlement at the provider",
    demandTitle: "Demand",
    committed: "Committed bookings",
    gmv: "Booking value",
    depositsCollected: "Deposits collected",
    supplyTitle: "Supply",
    venues: "Venues on the books",
    verified: "Verified in person",
    awaitingVisit: (n: number) => `${n} awaiting a visit`,
    expiringSoon: "Verification expiring",
    within30Days: "Within 30 days",
    footer: (gmv: string, days: number) =>
      `The money figures are computed from the double-entry ledger, not from the bookings table, so this screen and the accountant can never disagree. Amounts are in Libyan dinars; total booking value ${gmv} over ${days} days.`,
  },
} satisfies Record<Locale, unknown>;

export function OverviewTab() {
  const locale = useLocale();
  const c = copy[locale];
  const [data, setData] = useState<Overview | null>(null);
  const [days, setDays] = useState(30);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>(`/v1/biz/overview?days=${days}`));
    } catch {
      setErr(copy[locale].loadFailed);
    }
  }, [days, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  if (err) return <p className="p-4 text-danger font-bold">{err}</p>;
  if (!data) return <p className="p-4 text-faint">{c.loading}</p>;

  const a = data.needsAttention;
  const attention =
    a.pendingVerifications + a.bookingsAwaitingHost + a.openDisputes + a.degradedRails.length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {[7, 30, 90, 365].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`chip ${days === d ? "!bg-sea !text-white" : ""}`}
          >
            {d === 365 ? c.year : c.days(d)}
          </button>
        ))}
        {data.posture.demoMode ? <Pill tone="amber">{c.demoMode}</Pill> : null}
        {!data.posture.acceptingBookings ? <Pill tone="red">{c.bookingsOff}</Pill> : null}
      </div>

      {/* 1 — what needs a human today */}
      <Section title={attention ? c.attention(attention) : c.attentionClear}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat
            label={c.openDisputes}
            value={a.openDisputes}
            sub={a.overdueDisputes ? c.overdue(a.overdueDisputes) : c.withinSla}
            tone={a.overdueDisputes ? "warn" : a.openDisputes ? "normal" : "good"}
          />
          <Stat
            label={c.pendingVerifications}
            value={a.pendingVerifications}
            tone={a.pendingVerifications ? "normal" : "good"}
          />
          <Stat
            label={c.awaitingHost}
            value={a.bookingsAwaitingHost}
            tone={a.bookingsAwaitingHost ? "normal" : "good"}
          />
          <Stat
            label={c.degradedRails}
            value={a.degradedRails.length}
            sub={a.degradedRails.join(c.railsSeparator) || c.railsAllUp}
            tone={a.degradedRails.length ? "warn" : "good"}
          />
        </div>

        {a.disputes.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-faint text-start">
                <tr>
                  <th className="text-start py-1">{c.colDispute}</th>
                  <th className="text-start py-1">{c.colCategory}</th>
                  <th className="text-start py-1">{c.colDue}</th>
                </tr>
              </thead>
              <tbody>
                {a.disputes.map((d) => (
                  <tr key={d.id} className="border-t border-sand">
                    <td className="py-1.5 font-mono text-[11px]">{d.bookingId.slice(0, 8)}</td>
                    <td className="py-1.5">{c.categories[d.category] ?? d.category}</td>
                    <td className="py-1.5">
                      {d.overdue ? (
                        <Pill tone="red">{c.pastDue}</Pill>
                      ) : (
                        <span dir="ltr">
                          {fmtDate(locale, d.dueAt, {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      {/* 2 — money, straight from the ledger */}
      <Section title={c.moneyTitle}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label={c.revenue} value={<Money dirhams={data.money.revenue} />} />
          <Stat
            label={c.depositsHeld}
            value={<Money dirhams={data.money.depositsHeld} />}
            sub={c.depositsHeldSub}
          />
          <Stat label={c.hostPayables} value={<Money dirhams={data.money.hostPayables} />} />
          <Stat
            label={c.railPending}
            value={<Money dirhams={data.money.railSettlementPending} />}
          />
        </div>
      </Section>

      {/* 3 — demand */}
      <Section title={c.demandTitle}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          <Stat label={c.committed} value={data.demand.committedBookings} />
          <Stat label={c.gmv} value={<Money dirhams={data.demand.gmv} />} />
          <Stat label={c.depositsCollected} value={<Money dirhams={data.demand.depositsCollected} />} />
        </div>
        <Bars
          rows={Object.entries(data.demand.byState)
            .sort((x, y) => y[1] - x[1])
            .map(([k, v]) => ({ label: c.states[k] ?? k, value: v }))}
        />
      </Section>

      {/* 4 — supply */}
      <Section title={c.supplyTitle}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          <Stat label={c.venues} value={data.supply.venues} />
          <Stat
            label={c.verified}
            value={data.supply.verified}
            sub={c.awaitingVisit(data.supply.venues - data.supply.verified)}
          />
          <Stat
            label={c.expiringSoon}
            value={data.supply.verificationExpiringSoon}
            tone={data.supply.verificationExpiringSoon ? "warn" : "good"}
            sub={c.within30Days}
          />
        </div>
        <Bars
          rows={Object.entries(data.supply.listingsByStatus).map(([k, v]) => ({
            label: term(LISTING_STATUS, locale, k),
            value: v,
          }))}
        />
      </Section>

      {/* 5 — the supply base's own diaries, and how much of it we win */}
      <PartnerPanel />

      <p className="text-[11px] text-faint mt-4 leading-relaxed">
        {c.footer(fmtLyd(data.demand.gmv, locale), data.windowDays)}
      </p>
    </div>
  );
}
