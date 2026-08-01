"use client";
/**
 * Trust dialog — the window behind the stars.
 *
 * Ciao competes on trust, so we show the whole record in one place: what
 * guests scored, what they wrote, and what happened when something went
 * wrong. The dispute panel is deliberately public (counts + outcomes, never
 * statements) — a host with cases that were all resolved fast is a BETTER
 * signal than a host with no history at all.
 *
 * Review text is written by guests and carries no language of its own in the
 * data, so it is rendered with `dir="auto"`: an Arabic review inside the
 * English dialog still reads right-to-left, and an English one does not get
 * forced the other way.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useLocale } from "@/lib/locale";
import { api, ensureSession } from "@/lib/api";
import { trackClient } from "@/lib/tracker";
import { fmtNum } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

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

const copy = {
  ar: {
    close: "إغلاق",
    loading: "جارٍ التحميل…",
    loadFailed: "تعذر تحميل التقييمات — تحقق من الاتصال.",
    guestRatings: (n: string) => `${n} تقييم من ضيوف أكملوا الحجز`,
    ciaoInspection: "تقييم تشاو من الفحص الميداني — لا تقييمات ضيوف بعد",
    starsRow: (n: number) => `${n} نجوم`,
    dimensions: {
      cleanliness: "النظافة",
      accuracy: "المطابقة للوصف",
      privacy: "الخصوصية والستر",
      communication: "التواصل",
      value: "القيمة مقابل السعر",
      quality: "جودة الخدمة",
      punctuality: "الالتزام بالموعد",
    } as Record<string, string>,
    disputesTitle: "🛡 سجل الشكاوى والحلول",
    disputesNote: "نعرض عدد الشكاوى ونتائجها فقط — نص الشكوى وبيانات أصحابها لا تُنشر أبدًا.",
    noneOf: (delivered: string) => (
      <>
        ✅ لا توجد أي شكوى من أصل <span className="font-bold">{delivered}</span> حجز مكتمل.
      </>
    ),
    openedOf: (delivered: string) => `شكاوى من ${delivered} حجز`,
    resolvedLabel: "تم حلّها",
    medianLabel: "وسيط زمن الحل",
    hoursShort: (n: string) => `${n}س`,
    withinSla: (n: string) => `⏱ ${n} منها حُلّت خلال مهلة الـ٤٨ ساعة التي نلتزم بها.`,
    openNow: (n: string) => `⏳ ${n} شكوى قيد المعالجة الآن.`,
    remedies: {
      partial_refund: "استرجاع جزئي للضيف",
      full_refund_relocation: "استرجاع كامل أو مكان بديل",
      credit: "رصيد تعويضي",
      strike: "جزاء على المضيف",
      none: "لا مخالفة بعد التحقق",
    } as Record<string, string>,
    canReviewLead: "أنت أكملت إقامة هنا — رأيك يساعد كل عائلة بعدك.",
    writeReview: "⭐ اكتب تقييمك",
    signInToReview: "سجّل دخولك لتكتب تقييمًا — التقييم متاح فقط لمن أكمل حجزًا هنا.",
    reviewsGated:
      "التقييمات تُقبل فقط ممن أكمل حجزًا مدفوع العربون على تشاو — لهذا لا توجد تقييمات مزيفة.",
    guestVoices: "آراء الضيوف",
    hostReply: "↩ رد المضيف:",
    reviews: "تقييم",
    ciaoRating: "تقييم تشاو",
  },
  en: {
    close: "Close",
    loading: "Loading…",
    loadFailed: "Could not load the reviews — check your connection.",
    guestRatings: (n: string) => `${n} reviews from guests who completed a booking`,
    ciaoInspection: "Ciao's rating from our own inspection — no guest reviews yet",
    starsRow: (n: number) => `${n} stars`,
    dimensions: {
      cleanliness: "Cleanliness",
      accuracy: "Matches the listing",
      privacy: "Privacy and screening",
      communication: "Communication",
      value: "Value for money",
      quality: "Quality of service",
      punctuality: "Turning up on time",
    } as Record<string, string>,
    disputesTitle: "🛡 Complaints and how they ended",
    disputesNote:
      "We show the number of complaints and their outcomes only — the text of a complaint and who made it are never published.",
    noneOf: (delivered: string) => (
      <>
        ✅ Not one complaint out of <span className="font-bold">{delivered}</span> completed
        bookings.
      </>
    ),
    openedOf: (delivered: string) => `complaints out of ${delivered} bookings`,
    resolvedLabel: "Resolved",
    medianLabel: "Median time to resolve",
    hoursShort: (n: string) => `${n}h`,
    withinSla: (n: string) =>
      `⏱ ${n} of them were resolved inside the 48-hour deadline we hold ourselves to.`,
    openNow: (n: string) => `⏳ ${n} complaints are being handled right now.`,
    remedies: {
      partial_refund: "Partial refund to the guest",
      full_refund_relocation: "Full refund or another place",
      credit: "Compensation credit",
      strike: "Penalty on the host",
      none: "No breach found after checking",
    } as Record<string, string>,
    canReviewLead: "You completed a stay here — what you say helps every family after you.",
    writeReview: "⭐ Write your review",
    signInToReview:
      "Sign in to write a review — reviews are open only to people who completed a booking here.",
    reviewsGated:
      "Reviews are accepted only from people who completed a booking with a paid deposit on Ciao — which is why there are no fake reviews here.",
    guestVoices: "What guests said",
    hostReply: "↪ Host's reply:",
    reviews: "reviews",
    ciaoRating: "Ciao inspection",
  },
} satisfies Record<Locale, unknown>;

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
  const locale = useLocale();
  const c = copy[locale];
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
      setErr(c.loadFailed);
    }
  }, [listingId, c]);

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
        className="bg-surface w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-bubble shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="sticky top-0 bg-surface/95 backdrop-blur border-b border-sand px-5 py-3 flex items-center justify-between">
          <h2 className="font-bold text-sea truncate" dir="auto">
            {listingTitle}
          </h2>
          <button
            onClick={onClose}
            aria-label={c.close}
            className="w-8 h-8 rounded-full bg-sand text-sea font-bold shrink-0"
          >
            ✕
          </button>
        </div>

        {err ? <p className="p-5 text-danger font-bold text-sm">{err}</p> : null}
        {!data && !err ? <p className="p-5 text-faint text-sm">{c.loading}</p> : null}

        {data ? (
          <div className="p-5 space-y-6">
            {/* headline */}
            <div className="text-center">
              <p className="text-4xl font-extrabold text-sea" dir="ltr">
                {headline ? headline.toFixed(1) : "—"}
              </p>
              <p className="text-link text-lg" dir="ltr" aria-hidden>
                {"★".repeat(Math.min(5, Math.floor((headline ?? 0) + 0.25)))}
                <span className="opacity-25">
                  {"★".repeat(5 - Math.min(5, Math.floor((headline ?? 0) + 0.25)))}
                </span>
              </p>
              <p className="text-sm text-muted mt-1">
                {isGuestRating ? c.guestRatings(fmtNum(locale, total)) : c.ciaoInspection}
              </p>
            </div>

            {/* histogram (percentages, Amazon-style) */}
            {total > 0 ? (
              <div className="space-y-1.5">
                {[5, 4, 3, 2, 1].map((n) => {
                  const count = data.rating.histogram[String(n)] ?? 0;
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={n} className="flex items-center gap-2 text-sm">
                      <span className="w-12 shrink-0 text-muted text-xs">{c.starsRow(n)}</span>
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
                    <p className="text-[11px] text-faint">{c.dimensions[k] ?? k}</p>
                    <p className="font-extrabold text-sea" dir="ltr">{v.toFixed(1)}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {/* dispute record — the differentiator */}
            <div className="rounded-bubble border-2 border-sea/15 p-4">
              <h3 className="font-bold text-sea mb-1">{c.disputesTitle}</h3>
              <p className="text-xs text-faint mb-3">{c.disputesNote}</p>
              {data.disputes.opened === 0 ? (
                <p className="text-sm text-sea/80">
                  {c.noneOf(fmtNum(locale, data.disputes.deliveredBookings))}
                </p>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-sand p-2">
                      <p className="font-extrabold text-sea text-lg" dir="ltr">
                        {data.disputes.opened}
                      </p>
                      <p className="text-[11px] text-faint">
                        {c.openedOf(fmtNum(locale, data.disputes.deliveredBookings))}
                      </p>
                    </div>
                    <div className="rounded-xl bg-sand p-2">
                      <p className="font-extrabold text-success text-lg" dir="ltr">
                        {data.disputes.resolved}
                      </p>
                      <p className="text-[11px] text-faint">{c.resolvedLabel}</p>
                    </div>
                    <div className="rounded-xl bg-sand p-2">
                      <p className="font-extrabold text-sea text-lg" dir="ltr">
                        {data.disputes.medianHours != null
                          ? c.hoursShort(fmtNum(locale, data.disputes.medianHours))
                          : "—"}
                      </p>
                      <p className="text-[11px] text-faint">{c.medianLabel}</p>
                    </div>
                  </div>
                  {data.disputes.resolvedWithinSla > 0 ? (
                    <p className="text-sea/80">
                      {c.withinSla(fmtNum(locale, data.disputes.resolvedWithinSla))}
                    </p>
                  ) : null}
                  {Object.keys(data.disputes.remedies).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {Object.entries(data.disputes.remedies).map(([k, n]) => (
                        <span key={k} className="chip text-xs">
                          {c.remedies[k] ?? k}: {fmtNum(locale, n)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {data.disputes.open > 0 ? (
                    <p className="text-link font-bold">
                      {c.openNow(fmtNum(locale, data.disputes.open))}
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            {/* write a review */}
            <div className="rounded-bubble bg-sand p-4 text-center">
              {data.canReview.eligible && data.canReview.bookingCode ? (
                <>
                  <p className="text-sm text-sea/80 mb-2">{c.canReviewLead}</p>
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
                    {c.writeReview}
                  </Link>
                </>
              ) : (
                <p className="text-sm text-muted">
                  {data.canReview.reason === "sign_in" ? c.signInToReview : c.reviewsGated}
                </p>
              )}
            </div>

            {/* reviews */}
            {data.reviews.length > 0 ? (
              <div className="space-y-3">
                <h3 className="font-bold text-sea">{c.guestVoices}</h3>
                {data.reviews.map((r) => (
                  <div key={r.id} className="border-b border-sand pb-3 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-sea" dir="auto">
                        {r.author}
                      </span>
                      {/* Always five glyphs so the rows read as one scale, not
                          ragged lines of different lengths. */}
                      <span className="text-link text-xs" dir="ltr">
                        {"★".repeat(Math.min(5, Math.round(r.overall)))}
                        <span className="opacity-25">
                          {"★".repeat(5 - Math.min(5, Math.round(r.overall)))}
                        </span>{" "}
                        {r.overall.toFixed(1)}
                      </span>
                    </div>
                    {r.text ? (
                      <p className="text-sm mt-1 text-sea/85" dir="auto">
                        {r.text}
                      </p>
                    ) : null}
                    {r.hostReply ? (
                      <p className="text-xs mt-1.5 text-faint border-s-2 border-sand ps-2" dir="auto">
                        {c.hostReply} {r.hostReply}
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
  const locale = useLocale();
  const c = copy[locale];
  const [open, setOpen] = useState(false);
  if (!rating) return null;
  const full = Math.min(5, Math.floor(rating + 0.25));
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 ${size} hover:underline`}
      >
        <span className="text-link tracking-tight" dir="ltr" aria-hidden>
          {"★".repeat(full)}
          <span className="opacity-25">{"★".repeat(5 - full)}</span>
        </span>
        <span className="font-bold text-sea">{rating.toFixed(1)}</span>
        <span className="text-faint text-xs">
          {count && count > 0
            ? `· ${fmtNum(locale, count)} ${source === "guests" ? c.reviews : c.ciaoRating}`
            : `· ${c.ciaoRating}`}
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
