"use client";
/**
 * A quote, as the customer sees it.
 *
 * This page opens from a WhatsApp message, on a phone, from someone with no
 * Ciao account and no intention of making one. So it does exactly one job:
 * show the price clearly enough to decide on, and take the answer.
 *
 * Two things it says out loud that most marketplaces would bury. First, that
 * the agreement is with the business and not with Ciao — the customer is
 * entitled to know who they are dealing with and what our cut is, and the
 * answer here is none. Second, that accepting holds the date, because the
 * difference between "I'll take it" and a booking is the thing that goes wrong
 * in this market every summer.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Link, useLocale } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { ApiError, api, fmtLyd } from "@/lib/api";
import { fmtDate } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

interface PublicQuote {
  code: string;
  titleAr: string;
  businessNameAr: string | null;
  businessNameEn: string | null;
  clientNameAr: string | null;
  lineItems: { labelAr: string; qty: number; unitPrice: number }[];
  subtotal: number;
  discount: number;
  total: number;
  depositAmount: number;
  proposedDay: string | null;
  startTime: string | null;
  validUntil: string | null;
  notesAr: string | null;
  termsAr: string | null;
  status: string;
}

const copy = {
  ar: {
    from: "عرض سعر من",
    to: "إلى",
    date: "التاريخ",
    validUntil: "صالح لغاية",
    subtotal: "المجموع",
    discount: "خصم",
    total: "الإجمالي",
    deposit: "العربون المطلوب",
    accept: "أوافق على العرض",
    decline: "أعتذر",
    notes: "ملاحظات",
    terms: "الشروط",
    acceptedTitle: "تمام — تم قبول العرض",
    acceptedBody: "وصل الخبر لصاحب النشاط وحُجز لك التاريخ. يتواصل معك للترتيب.",
    declinedTitle: "تم إبلاغ صاحب النشاط",
    declinedBody: "شكرًا على ردّك.",
    expiredTitle: "انتهت صلاحية هذا العرض",
    expiredBody: "كلّم صاحب النشاط ويرسل لك عرضًا جديدًا.",
    notFound: "ما لقينا هذا العرض. تأكد من الرابط.",
    loading: "جارٍ التحميل…",
    platformNote:
      "هذا الاتفاق بينك وبين صاحب النشاط مباشرة. تشاو ما تاخذ عمولة على هذا العرض — دورنا إننا نحجز التاريخ في تقويمه لما توافق، عشان ما ينباع لأحد ثاني.",
    holdNote: "الموافقة تحجز التاريخ.",
    browse: "تصفّح تشاو",
    failed: "تعذر التنفيذ — أعد المحاولة",
  },
  en: {
    from: "A quote from",
    to: "For",
    date: "Date",
    validUntil: "Valid until",
    subtotal: "Subtotal",
    discount: "Discount",
    total: "Total",
    deposit: "Deposit required",
    accept: "Accept this quote",
    decline: "Decline",
    notes: "Notes",
    terms: "Terms",
    acceptedTitle: "Done — the quote is accepted",
    acceptedBody: "The business has been told and the date is held for you. They'll be in touch.",
    declinedTitle: "The business has been told",
    declinedBody: "Thanks for replying.",
    expiredTitle: "This quote has expired",
    expiredBody: "Ask the business and they'll send you a new one.",
    notFound: "We couldn't find this quote. Check the link.",
    loading: "Loading…",
    platformNote:
      "This agreement is directly between you and the business. Ciao takes no commission on it — our part is holding the date in their calendar once you accept, so it can't be sold to anyone else.",
    holdNote: "Accepting holds the date.",
    browse: "Browse Ciao",
    failed: "Something went wrong — please try again",
  },
} satisfies Record<Locale, unknown>;

export default function QuotePage() {
  const locale = useLocale();
  const c = copy[locale];
  const params = useParams<{ code: string }>();
  const code = params?.code ?? "";
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [outcome, setOutcome] = useState<"accepted" | "declined" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api<{ quote: PublicQuote }>(`/v1/q/${code}`);
      setQuote(res.quote);
      if (res.quote.status === "accepted") setOutcome("accepted");
      if (res.quote.status === "declined") setOutcome("declined");
      setState("ready");
    } catch {
      setState("missing");
    }
  }, [code]);

  useEffect(() => {
    if (code) void load();
  }, [code, load]);

  async function respond(decision: "accept" | "decline") {
    setBusy(true);
    setError("");
    try {
      await api(`/v1/q/${code}/respond`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      setOutcome(decision === "accept" ? "accepted" : "declined");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <p className="p-6 text-faint">{c.loading}</p>;
  if (state === "missing" || !quote)
    return (
      <main className="mx-auto max-w-md px-4 py-10 text-center">
        <Link href="/">
          <Logo />
        </Link>
        <p className="card p-6 mt-6 text-sm text-muted">{c.notFound}</p>
      </main>
    );

  const businessName =
    (locale === "en" ? quote.businessNameEn : null) ?? quote.businessNameAr ?? "";
  const expired = quote.status === "expired";

  return (
    <main className="mx-auto max-w-md px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/">
          <Logo />
        </Link>
        <LanguageToggle />
      </header>

      <div className="card p-5">
        <p className="text-[11px] text-faint">{c.from}</p>
        <h1 className="text-lg font-extrabold text-sea" lang="ar" dir="rtl">
          {businessName}
        </h1>
        <p className="font-bold text-sea mt-2" lang="ar" dir="rtl">
          {quote.titleAr}
        </p>
        {quote.clientNameAr ? (
          <p className="text-[11px] text-faint mt-1" lang="ar" dir="rtl">
            {c.to}: {quote.clientNameAr}
          </p>
        ) : null}
        {quote.proposedDay ? (
          <p className="text-sm text-muted mt-1">
            {c.date}:{" "}
            {fmtDate(locale, quote.proposedDay, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            {quote.startTime ? ` · ${quote.startTime}` : ""}
          </p>
        ) : null}

        <ul className="mt-4 space-y-1.5">
          {quote.lineItems.map((l, i) => (
            <li key={i} className="flex justify-between gap-3 text-sm border-b border-sea/10 pb-1.5">
              <span className="text-muted" lang="ar" dir="rtl">
                {l.labelAr}
                {l.qty !== 1 ? <span className="text-faint"> × {l.qty}</span> : null}
              </span>
              <span className="font-bold text-sea tabular-nums shrink-0">
                {fmtLyd(Math.round(l.qty * l.unitPrice), locale)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-3 space-y-1 text-sm">
          {quote.discount > 0 ? (
            <>
              <div className="flex justify-between text-muted">
                <span>{c.subtotal}</span>
                <span className="tabular-nums">{fmtLyd(quote.subtotal, locale)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>{c.discount}</span>
                <span className="tabular-nums">−{fmtLyd(quote.discount, locale)}</span>
              </div>
            </>
          ) : null}
          <div className="flex justify-between text-lg font-extrabold text-sea">
            <span>{c.total}</span>
            <span className="tabular-nums">{fmtLyd(quote.total, locale)}</span>
          </div>
          {quote.depositAmount > 0 ? (
            <div className="flex justify-between text-sm font-bold text-link">
              <span>{c.deposit}</span>
              <span className="tabular-nums">{fmtLyd(quote.depositAmount, locale)}</span>
            </div>
          ) : null}
        </div>

        {quote.validUntil ? (
          <p className="text-[11px] text-faint mt-3">
            {c.validUntil}{" "}
            {fmtDate(locale, quote.validUntil, { day: "numeric", month: "long", year: "numeric" })}
          </p>
        ) : null}

        {quote.notesAr ? (
          <div className="mt-4">
            <p className="text-xs font-bold text-muted">{c.notes}</p>
            <p className="text-sm text-muted" lang="ar" dir="rtl">
              {quote.notesAr}
            </p>
          </div>
        ) : null}
        {quote.termsAr ? (
          <div className="mt-3">
            <p className="text-xs font-bold text-muted">{c.terms}</p>
            <p className="text-[11px] text-faint" lang="ar" dir="rtl">
              {quote.termsAr}
            </p>
          </div>
        ) : null}
      </div>

      {outcome === "accepted" ? (
        <div className="card p-5 mt-3 text-center tone-good">
          <p className="font-bold text-sea">{c.acceptedTitle}</p>
          <p className="text-sm text-muted mt-1">{c.acceptedBody}</p>
        </div>
      ) : outcome === "declined" ? (
        <div className="card p-5 mt-3 text-center">
          <p className="font-bold text-sea">{c.declinedTitle}</p>
          <p className="text-sm text-muted mt-1">{c.declinedBody}</p>
        </div>
      ) : expired ? (
        <div className="card p-5 mt-3 text-center">
          <p className="font-bold text-sea">{c.expiredTitle}</p>
          <p className="text-sm text-muted mt-1">{c.expiredBody}</p>
        </div>
      ) : (
        <div className="mt-4">
          <button
            className="btn-primary w-full"
            disabled={busy}
            onClick={() => void respond("accept")}
          >
            {c.accept}
          </button>
          <p className="text-[11px] text-faint text-center mt-1">{c.holdNote}</p>
          <button
            className="w-full text-sm text-faint underline mt-3"
            disabled={busy}
            onClick={() => void respond("decline")}
          >
            {c.decline}
          </button>
        </div>
      )}

      {error ? (
        <p className="card p-3 mt-3 text-sm font-bold text-[color:rgb(var(--danger))]">{error}</p>
      ) : null}

      {/* Who this agreement is with, said plainly rather than left to be assumed. */}
      <p className="text-[11px] text-faint mt-6">{c.platformNote}</p>
      <p className="text-center mt-4">
        <Link href="/" className="chip !text-xs font-bold">
          {c.browse}
        </Link>
      </p>
    </main>
  );
}
