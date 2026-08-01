"use client";
/**
 * Trust dialog — the window behind the stars.
 *
 * Ciao competes on trust, so we show the whole record in one place: what
 * guests scored, what they wrote, and what happened when something went
 * wrong. The dispute panel is deliberately public (counts + outcomes, never
 * statements) — a host with cases that were all resolved fast is a BETTER
 * signal than a host with no history at all.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ensureSession } from "@/lib/api";
import { trackClient } from "@/lib/tracker";

export interface TrustData {
  rating: {
    value: number | null;
    count: number;
    histogram: Record<string, number>;
    dimensions: Record<string, number> | null;
    source: "ciao" | "guests";
  };
  reviews: {
    id: string;
    author: string;
    overall: number;
    text?: string | null;
    hostReply?: string | null;
    at: string;
  }[];
  disputes: {
    deliveredBookings: number;
    opened: number;
    resolved: number;
    open: number;
    resolvedWithinSla: number;
    medianHours: number | null;
    remedies: Record<string, number>;
  };
  canReview: { eligible: boolean; bookingCode?: string; reason?: string };
}

const DIMENSION_AR: Record<string, string> = {
  cleanliness: "النظافة",
  accuracy: "المطابقة للوصف",
  privacy: "الخصوصية والستر",
  communication: "التواصل",
  value: "القيمة مقابل السعر",
  quality: "جودة الخدمة",
  punctuality: "الالتزام بالموعد",
};

const REMEDY_AR: Record<string, string> = {
  partial_refund: "استرجاع جزئي للضيف",
  full_refund_relocation: "استرجاع كامل أو مكان بديل",
  credit: "رصيد تعويضي",
  strike: "جزاء على المضيف",
  none: "لا مخالفة بعد التحقق",
};

export function TrustDialog({
  listingId,
  listingTitle,
  ciaoRating,
  onClose,
}: {
  listingId: string;
  listingTitle: string;
  ciaoRating?: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<TrustData | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      await ensureSession();
      const d = await api<TrustData>(`/v1/listings/${listingId}/trust`);
      setData(d);
      trackClient("trust.opened", {
        listingId,
        rating: d.rating.value,
        reviewCount: d.rating.count,
        disputeCount: d.disputes.opened,
      });
    } catch {
      setErr("تعذر تحميل التقييمات — تحقق من الاتصال.");
    }
  }, [listingId]);

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [load, onClose]);

  const total = data?.rating.count ?? 0;
  const headline = data?.rating.value ?? ciaoRating ?? null;
  const isGuestRating = data?.rating.source === "guests";

  return (
    <div
      className="fixed inset-0 z-50 bg-sea-dark/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-bubble shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-sand px-5 py-3 flex items-center justify-between">
          <h2 className="font-bold text-sea truncate">{listingTitle}</h2>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="w-8 h-8 rounded-full bg-sand text-sea font-bold shrink-0"
          >
            ✕
          </button>
        </div>

        {err ? <p className="p-5 text-red-700 font-bold text-sm">{err}</p> : null}
        {!data && !err ? <p className="p-5 text-sea/60 text-sm">جارٍ التحميل…</p> : null}

        {data ? (
          <div className="p-5 space-y-6">
            {/* headline */}
            <div className="text-center">
              <p className="text-4xl font-extrabold text-sea" dir="ltr">
                {headline ? headline.toFixed(1) : "—"}
              </p>
              <p className="text-amber-dark text-lg" dir="ltr" aria-hidden>
                {"★".repeat(Math.min(5, Math.floor((headline ?? 0) + 0.25)))}
                <span className="opacity-25">
                  {"★".repeat(5 - Math.min(5, Math.floor((headline ?? 0) + 0.25)))}
                </span>
              </p>
              <p className="text-sm text-sea/70 mt-1">
                {isGuestRating
                  ? `${total} تقييم من ضيوف أكملوا الحجز`
                  : "تقييم تشاو من الفحص الميداني — لا تقييمات ضيوف بعد"}
              </p>
            </div>

            {/* histogram (percentages, Amazon-style) */}
            {total > 0 ? (
              <div className="space-y-1.5">
                {[5, 4, 3, 2, 1].map((n) => {
                  const c = data.rating.histogram[String(n)] ?? 0;
                  const pct = total > 0 ? Math.round((c / total) * 100) : 0;
                  return (
                    <div key={n} className="flex items-center gap-2 text-sm">
                      <span className="w-12 shrink-0 text-sea/70 text-xs">{n} نجوم</span>
                      <div className="flex-1 h-3 bg-sand rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-amber rounded-e-[3px]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-xs font-bold text-sea text-start" dir="ltr">
                        {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* dimensions */}
            {data.rating.dimensions ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.entries(data.rating.dimensions).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-sand p-2.5">
                    <p className="text-[11px] text-sea/60">{DIMENSION_AR[k] ?? k}</p>
                    <p className="font-extrabold text-sea" dir="ltr">{v.toFixed(1)}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {/* dispute record — the differentiator */}
            <div className="rounded-bubble border-2 border-sea/15 p-4">
              <h3 className="font-bold text-sea mb-1">🛡 سجل الشكاوى والحلول</h3>
              <p className="text-xs text-sea/60 mb-3">
                نعرض عدد الشكاوى ونتائجها فقط — نص الشكوى وبيانات أصحابها لا تُنشر أبدًا.
              </p>
              {data.disputes.opened === 0 ? (
                <p className="text-sm text-sea/80">
                  ✅ لا توجد أي شكوى من أصل{" "}
                  <span className="font-bold">{data.disputes.deliveredBookings}</span> حجز مكتمل.
                </p>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-sand p-2">
                      <p className="font-extrabold text-sea text-lg" dir="ltr">
                        {data.disputes.opened}
                      </p>
                      <p className="text-[11px] text-sea/60">
                        شكاوى من {data.disputes.deliveredBookings} حجز
                      </p>
                    </div>
                    <div className="rounded-xl bg-sand p-2">
                      <p className="font-extrabold text-green-700 text-lg" dir="ltr">
                        {data.disputes.resolved}
                      </p>
                      <p className="text-[11px] text-sea/60">تم حلّها</p>
                    </div>
                    <div className="rounded-xl bg-sand p-2">
                      <p className="font-extrabold text-sea text-lg" dir="ltr">
                        {data.disputes.medianHours != null ? `${data.disputes.medianHours}س` : "—"}
                      </p>
                      <p className="text-[11px] text-sea/60">وسيط زمن الحل</p>
                    </div>
                  </div>
                  {data.disputes.resolvedWithinSla > 0 ? (
                    <p className="text-sea/80">
                      ⏱ {data.disputes.resolvedWithinSla} منها حُلّت خلال مهلة الـ٤٨ ساعة التي نلتزم بها.
                    </p>
                  ) : null}
                  {Object.keys(data.disputes.remedies).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {Object.entries(data.disputes.remedies).map(([k, n]) => (
                        <span key={k} className="chip text-xs">
                          {REMEDY_AR[k] ?? k}: {n}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {data.disputes.open > 0 ? (
                    <p className="text-amber-dark font-bold">
                      ⏳ {data.disputes.open} شكوى قيد المعالجة الآن.
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            {/* write a review */}
            <div className="rounded-bubble bg-sand p-4 text-center">
              {data.canReview.eligible && data.canReview.bookingCode ? (
                <>
                  <p className="text-sm text-sea/80 mb-2">
                    أنت أكملت إقامة هنا — رأيك يساعد كل عائلة بعدك.
                  </p>
                  <Link
                    href={`/booking/${data.canReview.bookingCode}/review`}
                    className="btn-amber inline-block !py-2"
                    onClick={() =>
                      trackClient("review.started", {
                        listingId,
                        bookingCode: data.canReview.bookingCode,
                      })
                    }
                  >
                    ⭐ اكتب تقييمك
                  </Link>
                </>
              ) : (
                <p className="text-sm text-sea/70">
                  {data.canReview.reason === "sign_in"
                    ? "سجّل دخولك لتكتب تقييمًا — التقييم متاح فقط لمن أكمل حجزًا هنا."
                    : "التقييمات تُقبل فقط ممن أكمل حجزًا مدفوع العربون على تشاو — لهذا لا توجد تقييمات مزيفة."}
                </p>
              )}
            </div>

            {/* reviews */}
            {data.reviews.length > 0 ? (
              <div className="space-y-3">
                <h3 className="font-bold text-sea">آراء الضيوف</h3>
                {data.reviews.map((r) => (
                  <div key={r.id} className="border-b border-sand pb-3 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-sea">{r.author}</span>
                      <span className="text-amber-dark text-xs" dir="ltr">
                        {"★".repeat(Math.min(5, Math.round(r.overall)))} {r.overall.toFixed(1)}
                      </span>
                    </div>
                    {r.text ? <p className="text-sm mt-1 text-sea/85">{r.text}</p> : null}
                    {r.hostReply ? (
                      <p className="text-xs mt-1.5 text-sea/60 border-s-2 border-sand ps-2">
                        ↩ رد المضيف: {r.hostReply}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Any trigger that opens the trust dialog (used for "see all reviews"). */
export function TrustButton({
  listingId,
  listingTitle,
  rating,
  className = "",
  children,
}: {
  listingId: string;
  listingTitle: string;
  rating?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      {open ? (
        <TrustDialog
          listingId={listingId}
          listingTitle={listingTitle}
          ciaoRating={rating}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Clickable stars that open the trust dialog. */
export function TrustStars({
  listingId,
  listingTitle,
  rating,
  source,
  count,
  size = "text-sm",
}: {
  listingId: string;
  listingTitle: string;
  rating?: number;
  source?: "ciao" | "guests";
  count?: number;
  size?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!rating) return null;
  const full = Math.min(5, Math.floor(rating + 0.25));
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 ${size} hover:underline`}
      >
        <span className="text-amber-dark tracking-tight" dir="ltr" aria-hidden>
          {"★".repeat(full)}
          <span className="opacity-25">{"★".repeat(5 - full)}</span>
        </span>
        <span className="font-bold text-sea">{rating.toFixed(1)}</span>
        <span className="text-sea/60 text-xs">
          {count && count > 0
            ? `· ${count} ${source === "guests" ? "تقييم" : "تقييم تشاو"}`
            : "· تقييم تشاو"}
        </span>
      </button>
      {open ? (
        <TrustDialog
          listingId={listingId}
          listingTitle={listingTitle}
          ciaoRating={rating}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
