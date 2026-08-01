"use client";
/**
 * Overview — the screen a founder opens in the morning.
 *
 * Ordered by what you can act on, not by what is easiest to compute: what
 * needs a human today comes first, then money, then demand, then supply.
 */
import { useCallback, useEffect, useState } from "react";
import { api, fmtLyd } from "@/lib/api";
import { Bars, Money, Pill, Section, Stat } from "./lib";

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

const STATE_AR: Record<string, string> = {
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
};

const CATEGORY_AR: Record<string, string> = {
  misrepresentation: "عدم مطابقة للوصف",
  double_booking: "حجز مزدوج",
  no_show: "عدم حضور",
  cash_mismatch: "خلاف على المبلغ النقدي",
  other: "أخرى",
};

export function OverviewTab() {
  const [data, setData] = useState<Overview | null>(null);
  const [days, setDays] = useState(30);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>(`/v1/biz/overview?days=${days}`));
    } catch {
      setErr("تعذر تحميل لوحة التحكم");
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  if (err) return <p className="p-4 text-red-700 font-bold">{err}</p>;
  if (!data) return <p className="p-4 text-sea/60">جارٍ التحميل…</p>;

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
            {d === 365 ? "سنة" : `${d} يوم`}
          </button>
        ))}
        {data.posture.demoMode ? <Pill tone="amber">وضع العرض التجريبي</Pill> : null}
        {!data.posture.acceptingBookings ? <Pill tone="red">الحجوزات موقوفة</Pill> : null}
      </div>

      {/* 1 — what needs a human today */}
      <Section title={attention ? `يحتاج تدخلك اليوم (${attention})` : "لا شيء ينتظر تدخلك"}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat
            label="شكاوى مفتوحة"
            value={a.openDisputes}
            sub={a.overdueDisputes ? `${a.overdueDisputes} تجاوزت المهلة` : "ضمن المهلة"}
            tone={a.overdueDisputes ? "warn" : a.openDisputes ? "normal" : "good"}
          />
          <Stat
            label="معاينات بانتظار الاعتماد"
            value={a.pendingVerifications}
            tone={a.pendingVerifications ? "normal" : "good"}
          />
          <Stat
            label="حجوزات تنتظر ردّ المضيف"
            value={a.bookingsAwaitingHost}
            tone={a.bookingsAwaitingHost ? "normal" : "good"}
          />
          <Stat
            label="وسائل دفع متعثرة"
            value={a.degradedRails.length}
            sub={a.degradedRails.join("، ") || "كلها تعمل"}
            tone={a.degradedRails.length ? "warn" : "good"}
          />
        </div>

        {a.disputes.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-sea/60 text-start">
                <tr>
                  <th className="text-start py-1">الشكوى</th>
                  <th className="text-start py-1">النوع</th>
                  <th className="text-start py-1">المهلة</th>
                </tr>
              </thead>
              <tbody>
                {a.disputes.map((d) => (
                  <tr key={d.id} className="border-t border-sand">
                    <td className="py-1.5 font-mono text-[11px]">{d.bookingId.slice(0, 8)}</td>
                    <td className="py-1.5">{CATEGORY_AR[d.category] ?? d.category}</td>
                    <td className="py-1.5">
                      {d.overdue ? (
                        <Pill tone="red">تجاوزت المهلة</Pill>
                      ) : (
                        <span dir="ltr">{new Date(d.dueAt).toLocaleString("ar-LY")}</span>
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
      <Section title="المال (من دفتر الأستاذ)">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="إيرادات تشاو" value={<Money dirhams={data.money.revenue} />} />
          <Stat
            label="عرابين محتجزة"
            value={<Money dirhams={data.money.depositsHeld} />}
            sub="أموال ليست لنا — مستحقة للأمام"
          />
          <Stat label="مستحقات المضيفين" value={<Money dirhams={data.money.hostPayables} />} />
          <Stat
            label="تحت التسوية لدى مزوّد الدفع"
            value={<Money dirhams={data.money.railSettlementPending} />}
          />
        </div>
      </Section>

      {/* 3 — demand */}
      <Section title="الطلب">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          <Stat label="حجوزات مؤكدة" value={data.demand.committedBookings} />
          <Stat label="قيمة الحجوزات" value={<Money dirhams={data.demand.gmv} />} />
          <Stat label="عرابين محصّلة" value={<Money dirhams={data.demand.depositsCollected} />} />
        </div>
        <Bars
          rows={Object.entries(data.demand.byState)
            .sort((x, y) => y[1] - x[1])
            .map(([k, v]) => ({ label: STATE_AR[k] ?? k, value: v }))}
        />
      </Section>

      {/* 4 — supply */}
      <Section title="العرض">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          <Stat label="أماكن مسجّلة" value={data.supply.venues} />
          <Stat
            label="موثّقة ميدانيًا"
            value={data.supply.verified}
            sub={`${data.supply.venues - data.supply.verified} بانتظار المعاينة`}
          />
          <Stat
            label="توثيق يقارب الانتهاء"
            value={data.supply.verificationExpiringSoon}
            tone={data.supply.verificationExpiringSoon ? "warn" : "good"}
            sub="خلال 30 يومًا"
          />
        </div>
        <Bars
          rows={Object.entries(data.supply.listingsByStatus).map(([k, v]) => ({
            label:
              { draft: "مسودة", live: "منشور", paused: "موقوف", delisted: "مسحوب" }[k] ?? k,
            value: v,
          }))}
        />
      </Section>

      <p className="text-[11px] text-sea/45 mt-4 leading-relaxed">
        أرقام المال محسوبة من دفتر الأستاذ المزدوج لا من جدول الحجوزات، حتى لا تختلف الشاشة مع
        المحاسب أبدًا. المبالغ بالدينار الليبي؛ إجمالي القيمة {fmtLyd(data.demand.gmv)} خلال{" "}
        {data.windowDays} يومًا.
      </p>
    </div>
  );
}
