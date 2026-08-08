"use client";
/**
 * تشاو بلس — the subscription screen, and the checkout.
 *
 * Two things make this page different from every SaaS pricing page, and both
 * come from the market rather than from taste.
 *
 * **It is sold by the year, in one payment.** There is no direct debit in
 * Libya and recurring card billing does not meaningfully exist, so a monthly
 * plan is a monthly collections problem — twelve chances a year to lose a
 * customer to a failed charge nobody could have fixed. One payment for ten
 * months' price is a thing a Libyan business owner recognises, because it is
 * how they pay for everything else. The saving is stated in months rather than
 * a percentage for the same reason: "pay for ten, get twelve" is the sentence
 * they will repeat to somebody else.
 *
 * **It says what stays free, first.** Before any price appears, the page lists
 * what a partner never has to pay for — their diary, their money, their
 * clients, their own numbers. That is not generosity framing; it is the actual
 * product line, and a partner who suspects their own earnings are about to go
 * behind a paywall will close the app rather than argue.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";
import { Section } from "@/components/panel";
import type { PartnerMe } from "./types";

interface PlusView {
  plan: string;
  status: string;
  term: string;
  settlement: string;
  active: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  daysLeft: number | null;
  renewingSoon: boolean;
  priceDirhams: number;
  offer: {
    enabled: boolean;
    monthlyDirhams: number;
    annualDirhams: number;
    savingsDirhams: number;
    monthsCharged: number;
    trialDays: number;
  };
}

const RAILS = ["local_card", "sadad", "adfali", "tlync"] as const;

const copy = {
  ar: {
    title: "تشاو بلس",
    lead: "أرقامك أنت مجانية دائمًا. اللي يتباع هو أرقام السوق.",
    freeTitle: "مجاني دائمًا — ما يتغير",
    free: [
      "دفترك كامل: الحجوزات والتقويم والزبائن",
      "فلوسك: اللي دخل، اللي باقي، اللي مستحق",
      "أرقامك: دخلك، أشغالك، مصاريفك، أرباحك",
      "العروض والفواتير وفريقك",
    ],
    paidTitle: "اللي يفتحه بلس",
    paid: [
      "متوسط أسعار منطقتك لنفس نوع الخدمة",
      "متى يرتفع الطلب فعلًا — بالشهر وباليوم",
      "من وين يجي زبائن السوق، مش زبائنك أنت فقط",
      "مقارنة سعرك بالسوق قبل ما تسعّر",
    ],
    privacy:
      "أرقام السوق مجمّعة ومخفيّة الهوية: ما تشوف نشاطًا باسمه أبدًا، وما يشوفك أحد. وإذا كان عدد المنافسين في منطقتك قليل جدًا نخفي الرقم بدل ما نعرضه ناقص.",
    // status
    activeTitle: "اشتراكك شغّال",
    trialTitle: "أنت في الموسم المجاني",
    until: (d: string) => `حتى ${d}`,
    daysLeft: (n: number) => `باقي ${n} يوم`,
    renewSoon: "اشتراكك قرب ينتهي — جدّده وما تخسر يوم، الأيام الباقية تنضاف للسنة الجديدة.",
    lapsedTitle: "انتهى اشتراكك",
    lapsedBody: "دفترك وأرقامك زي ما هي. اللي وقف هو أرقام السوق فقط.",
    // buying
    buyTitle: "اشترك سنة",
    perMonth: "في الشهر",
    perYear: "في السنة",
    payFor: (n: number) => `ادفع ${n} شهور، خذ 12`,
    save: "توفّر",
    whyAnnual:
      "ما في خصم مباشر شهري في ليبيا، فبدل ما نلاحقك كل شهر — دفعة وحدة تكفي سنة كاملة.",
    rail: "طريقة الدفع",
    rails: {
      local_card: "بطاقة مصرفية محلية",
      sadad: "سداد",
      adfali: "أضفلي",
      tlync: "T-Lync",
    },
    pay: "ادفع واشترك",
    paying: "جارٍ التحويل…",
    startTrial: "ابدأ الموسم المجاني",
    trialLead: (n: number) => `${n} يوم مجانًا، مرة وحدة. بدون بطاقة.`,
    cancel: "إيقاف التجديد",
    cancelConfirm: "توقف التجديد؟ اشتراكك يكمّل لآخر المدة المدفوعة.",
    cancelled: "التجديد موقوف. اشتراكك يكمّل لنهاية المدة.",
    disabled: "تشاو بلس مقفول حاليًا.",
    onlyOwner: "الاشتراك لصاحب النشاط.",
    failed: "تعذر التنفيذ — أعد المحاولة.",
    alreadyActive: "عندك اشتراك سارٍ. تقدر تجدّده في آخر شهر.",
    loading: "لحظة…",
    paidOk: "تم الدفع ✅ اشتراكك مفعّل.",
  },
  en: {
    title: "Ciao Plus",
    lead: "Your own numbers are free, always. What's sold is the market's.",
    freeTitle: "Free forever — this doesn't change",
    free: [
      "Your whole book: bookings, calendar, clients",
      "Your money: what came in, what's owed, what's due",
      "Your numbers: revenue, jobs, costs, profit",
      "Offers, invoices and your team",
    ],
    paidTitle: "What Plus opens",
    paid: [
      "The average price in your area for the same kind of service",
      "When demand actually peaks — by month and by day",
      "Where the market's customers come from, not just yours",
      "Your price against the market, before you quote",
    ],
    privacy:
      "Market numbers are aggregated and anonymous: you never see a named business, and none of them sees you. Where there are too few competitors in an area to hide behind, we suppress the number rather than show you a thin one.",
    activeTitle: "Your subscription is running",
    trialTitle: "You're in the free season",
    until: (d: string) => `until ${d}`,
    daysLeft: (n: number) => `${n} days left`,
    renewSoon:
      "Your subscription ends soon — renew and lose nothing; the days you have left are added to the new year.",
    lapsedTitle: "Your subscription has ended",
    lapsedBody: "Your book and your own numbers are exactly as they were. Only the market data stopped.",
    buyTitle: "Subscribe for a year",
    perMonth: "a month",
    perYear: "a year",
    payFor: (n: number) => `Pay for ${n} months, get 12`,
    save: "You save",
    whyAnnual:
      "There's no direct debit in Libya, so rather than chase you every month — one payment covers a full year.",
    rail: "How you'll pay",
    rails: {
      local_card: "Local bank card",
      sadad: "Sadad",
      adfali: "Adfali",
      tlync: "T-Lync",
    },
    pay: "Pay and subscribe",
    paying: "Taking you to payment…",
    startTrial: "Start the free season",
    trialLead: (n: number) => `${n} days free, once. No card.`,
    cancel: "Stop renewing",
    cancelConfirm: "Stop renewing? Your subscription runs to the end of the period you paid for.",
    cancelled: "Renewal stopped. Your subscription runs to the end of the period.",
    disabled: "Ciao Plus is currently switched off.",
    onlyOwner: "Subscriptions are for the business owner.",
    failed: "Could not do that — please try again.",
    alreadyActive: "You already have an active subscription. You can renew in its final month.",
    loading: "One moment…",
    paidOk: "Paid ✅ Your subscription is active.",
  },
} satisfies Record<Locale, unknown>;

export function PlusTab({ me }: { me: PartnerMe }) {
  const locale = useLocale();
  const c = copy[locale];
  const scope = me.partnerId ? `?partnerId=${me.partnerId}` : "";

  const [view, setView] = useState<PlusView | null>(null);
  const [rail, setRail] = useState<string>("local_card");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setView(await api<PlusView>(`/v1/partner/plus${scope}`));
    } catch {
      setError(c.failed);
    }
  }, [scope, c.failed]);

  useEffect(() => {
    void load();
    // A partner returning from a payment page lands back here with ?paid=1.
    // The webhook is what actually grants the year, so this only tells them
    // where to look — it never claims success on its own.
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("paid")) {
      setMessage(c.paidOk);
    }
  }, [load, c.paidOk]);

  if (!view) return <p className="p-4 text-faint">{error || c.loading}</p>;
  if (!view.offer.enabled) return <p className="card p-4 text-sm text-muted">{c.disabled}</p>;

  const canBuy = me.capabilities.includes("admin");
  const fmt = (d: number) => fmtLyd(d, locale);
  const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

  async function buy() {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ redirectUrl?: string; kind: string }>(
        `/v1/partner/plus/checkout${scope}`,
        { method: "POST", body: JSON.stringify({ rail }) },
      );
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl;
        return;
      }
      await load();
      setMessage(c.paidOk);
    } catch (e) {
      const detail = e instanceof ApiError ? (e.detail as { reason?: string })?.reason : null;
      setError(detail === "already_active" ? c.alreadyActive : c.failed);
    } finally {
      setBusy(false);
    }
  }

  async function startTrial() {
    setBusy(true);
    try {
      await api(`/v1/partner/plus/trial${scope}`, { method: "POST", body: "{}" });
      await load();
    } catch {
      setError(c.failed);
    } finally {
      setBusy(false);
    }
  }

  async function stopRenewal() {
    if (!window.confirm(c.cancelConfirm)) return;
    setBusy(true);
    try {
      await api(`/v1/partner/plus/cancel${scope}`, { method: "POST", body: "{}" });
      setMessage(c.cancelled);
      await load();
    } catch {
      setError(c.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Status first: what a returning partner came here to check. */}
      {view.active ? (
        <section className={`card p-5 ${view.renewingSoon ? "tone-warn" : "tone-good"}`}>
          <h2 className="font-extrabold text-sea">
            {view.status === "trialing" ? c.trialTitle : c.activeTitle}
          </h2>
          <p className="text-sm text-muted mt-1">
            {c.until(date(view.status === "trialing" ? view.trialEndsAt : view.currentPeriodEnd))}
            {view.daysLeft !== null ? ` · ${c.daysLeft(view.daysLeft)}` : ""}
          </p>
          {view.renewingSoon ? <p className="text-sm text-muted mt-2">{c.renewSoon}</p> : null}
        </section>
      ) : view.status === "past_due" || view.status === "cancelled" ? (
        <section className="card p-5">
          <h2 className="font-extrabold text-sea">{c.lapsedTitle}</h2>
          <p className="text-sm text-muted mt-1">{c.lapsedBody}</p>
        </section>
      ) : null}

      {/*
        What stays free, before any price is mentioned.
        A partner who suspects their own earnings are about to go behind a
        paywall closes the app rather than reading on.
      */}
      <Section title={c.freeTitle}>
        <ul className="space-y-1.5">
          {c.free.map((line) => (
            <li key={line} className="flex gap-2 text-sm text-muted">
              <span aria-hidden className="text-[color:rgb(var(--success))] font-bold">
                ✓
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={c.paidTitle} hint={c.lead}>
        <ul className="space-y-1.5">
          {c.paid.map((line) => (
            <li key={line} className="flex gap-2 text-sm text-muted">
              <span aria-hidden className="text-link font-bold">
                ★
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-faint mt-3 leading-relaxed">{c.privacy}</p>
      </Section>

      {/* Buying. Only the owner sees this at all. */}
      {canBuy && !view.active ? (
        <Section title={c.buyTitle} hint={c.whyAnnual}>
          <div className="rounded-2xl bg-sand p-4">
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div>
                <p className="text-3xl font-extrabold text-sea tabular-nums" dir="ltr">
                  {fmt(view.offer.annualDirhams)}
                </p>
                <p className="text-xs text-muted">{c.perYear}</p>
              </div>
              <div className="text-end">
                <p className="text-sm font-bold text-link">{c.payFor(view.offer.monthsCharged)}</p>
                <p className="text-[11px] text-faint tabular-nums" dir="ltr">
                  {c.save} {fmt(view.offer.savingsDirhams)}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-faint mt-2 tabular-nums" dir="ltr">
              {fmt(view.offer.monthlyDirhams)} / {c.perMonth}
            </p>
          </div>

          <label className="block text-sm mt-4">
            <span className="text-xs font-bold text-muted">{c.rail}</span>
            <select
              className="input !py-2 !text-sm mt-1"
              value={rail}
              onChange={(e) => setRail(e.target.value)}
            >
              {RAILS.map((r) => (
                <option key={r} value={r}>
                  {c.rails[r]}
                </option>
              ))}
            </select>
          </label>

          <button className="btn-primary w-full mt-4" disabled={busy} onClick={() => void buy()}>
            {busy ? c.paying : c.pay}
          </button>

          {view.offer.trialDays > 0 && view.status === "none" ? (
            <div className="text-center mt-3">
              <button className="text-sm font-bold text-link underline" disabled={busy} onClick={() => void startTrial()}>
                {c.startTrial}
              </button>
              <p className="text-[11px] text-faint mt-1">{c.trialLead(view.offer.trialDays)}</p>
            </div>
          ) : null}
        </Section>
      ) : null}

      {canBuy && view.active && view.status !== "trialing" ? (
        <div className="text-center mt-4">
          <button className="text-xs font-bold text-faint underline" disabled={busy} onClick={() => void stopRenewal()}>
            {c.cancel}
          </button>
        </div>
      ) : null}

      {!canBuy ? <p className="card p-4 text-sm text-muted mt-4">{c.onlyOwner}</p> : null}
      {message ? <p className="card p-3 mt-4 text-sm font-bold text-sea">{message}</p> : null}
      {error ? (
        <p className="card p-3 mt-4 text-sm font-bold text-[color:rgb(var(--danger))]">{error}</p>
      ) : null}
    </>
  );
}
