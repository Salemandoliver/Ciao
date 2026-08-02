"use client";
/**
 * The numbers.
 *
 * The line this screen draws is the whole commercial argument of Ciao Plus:
 * **your own numbers are free forever; the market costs money.**
 *
 * So the free half is not a teaser. It is a complete, useful picture of the
 * partner's own business — income, where work comes from, how full they are,
 * whether customers come back, how their Ciao page converts — and it stays
 * complete whether or not they ever pay us a dinar. Charging for that would
 * make the console a hostage situation, and they would go back to the notebook.
 *
 * The paid half is the thing nobody in Libya can tell them: what the rest of
 * the market is doing. It is presented with its limits visible — how many
 * businesses a benchmark was computed from, and a plain refusal to show one at
 * all when that number is too small to be anything but a competitor's price
 * with a hat on.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { AREAS, JOB_SOURCES, UI, VERTICALS, fmtDate, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Bars, Pill, RangeMarker, Section, Stat } from "@/components/panel";
import type { Insights, PartnerMe } from "./types";

const copy = {
  ar: {
    windowLabel: "الفترة",
    d30: "٣٠ يوم",
    d90: "٩٠ يوم",
    d365: "سنة",
    jobs: "شغلات",
    jobsSplit: (ciao: number, direct: number) => `${ciao} من تشاو · ${direct} من عندك`,
    income: "الدخل",
    occupancy: "نسبة الانشغال",
    outstanding: "غير محصّل",
    actions: "وش تسوي الحين",
    sourceTitle: "من وين يجيك الشغل",
    sourceHint: "من دفترك أنت — يشمل الشغل اللي ما جا من تشاو.",
    monthlyTitle: "شغلك بالشهور",
    funnelTitle: "صفحتك في تشاو",
    funnelHint: "كم واحد شاف صفحتك وكم منهم طلب حجز.",
    views: "زيارات",
    quotes: "شافوا السعر",
    requests: "طلبات حجز",
    confirmed: "تأكدت",
    repeatTitle: "زبائن يرجعون",
    repeatValue: (r: number, t: number) => `${r} من ${t} زبون رجعوا لك`,
    reliabilityTitle: "موثوقيتك",
    quotesTitle: "عروضك",
    quotesValue: (a: number, s: number) => `${a} مقبول من ${s} مُرسل`,
    plusTitle: "تشاو بلس — أرقام السوق",
    plusPitch:
      "أرقامك أنت مجانية للأبد. تشاو بلس يوريك السوق: الطلب في منطقتك، وين سعرك بين المشابهين، والطلب اللي فاتك وأنت مقفول.",
    plusFree: (d: number) => `جرّبه مجانًا ${d} يوم`,
    plusPrice: (p: string) => `بعدها ${p} في الشهر، تُخصم من مستحقاتك`,
    plusStart: "ابدأ الموسم المجاني",
    plusStartPaid: "اشترك",
    plusCancel: "إلغاء الاشتراك",
    plusTrialEnds: (d: string) => `التجربة تنتهي ${d}`,
    demandTitle: "الطلب في منطقتك",
    demandValue: (n: number, area: string) => `${n} عملية بحث على ${area}`,
    missedTitle: "طلب فاتك",
    missedValue: (n: number, days: number) =>
      `${n} عملية بحث وقعت على أيام تقويمك فيها مقفول (${days} يوم مقفول)`,
    missedNone: "ما ضاع عليك طلب بسبب تقويم مقفول.",
    priceTitle: "سعرك بين المشابهين",
    priceYours: "سعرك",
    priceMedian: "وسيط السوق",
    pricePeers: (n: number) => `مقارنة مع ${n} نشاط مشابه`,
    priceSuppressed:
      "ما عندنا عدد كافٍ من الأنشطة المشابهة عشان نطلع مقارنة. نعرضها لما يصير العدد كافيًا — ما نبي نوريك سعر منافس واحد بعينه.",
    leadTitle: "متى يحجزون؟",
    leadHint: "كم يوم قبل الموعد يحجز الناس في فئتك — يقول لك متى تفتح تقويم الموسم الجاي.",
    seasonTitle: "مواسم السوق",
    seasonHint: "١٠٠ يعني شهر عادي. أعلى من كذا يعني ذروة.",
    conversionTitle: "تحويل الزيارات لحجوزات",
    conversionValue: (yours: string, median: string) => `أنت ${yours} · وسيط السوق ${median}`,
    conversionSuppressed: "ما عندنا مقارنة كافية بعد.",
    failed: "تعذر التحميل",
    minutes: (n: number) => `${n} دقيقة`,
  },
  en: {
    windowLabel: "Period",
    d30: "30 days",
    d90: "90 days",
    d365: "A year",
    jobs: "Jobs",
    jobsSplit: (ciao: number, direct: number) => `${ciao} from Ciao · ${direct} your own`,
    income: "Income",
    occupancy: "How full you were",
    outstanding: "Uncollected",
    actions: "What to do now",
    sourceTitle: "Where your work comes from",
    sourceHint: "From your own diary — including work Ciao had nothing to do with.",
    monthlyTitle: "Your work by month",
    funnelTitle: "Your Ciao page",
    funnelHint: "How many people saw your page, and how many asked to book.",
    views: "Views",
    quotes: "Saw the price",
    requests: "Booking requests",
    confirmed: "Confirmed",
    repeatTitle: "Returning clients",
    repeatValue: (r: number, t: number) => `${r} of ${t} clients came back`,
    reliabilityTitle: "Your reliability",
    quotesTitle: "Your quotes",
    quotesValue: (a: number, s: number) => `${a} accepted out of ${s} sent`,
    plusTitle: "Ciao Plus — the market",
    plusPitch:
      "Your own numbers are free forever. Ciao Plus shows you the market: demand in your area, where your price sits among comparable businesses, and the demand that walked past a closed calendar.",
    plusFree: (d: number) => `Free for ${d} days`,
    plusPrice: (p: string) => `then ${p} a month, taken from your payouts`,
    plusStart: "Start the free season",
    plusStartPaid: "Subscribe",
    plusCancel: "Cancel",
    plusTrialEnds: (d: string) => `Free season ends ${d}`,
    demandTitle: "Demand in your area",
    demandValue: (n: number, area: string) => `${n} searches for ${area}`,
    missedTitle: "Demand you missed",
    missedValue: (n: number, days: number) =>
      `${n} searches landed on days your calendar was closed (${days} closed days)`,
    missedNone: "No demand was lost to a closed calendar.",
    priceTitle: "Your price among comparable businesses",
    priceYours: "Yours",
    priceMedian: "Market median",
    pricePeers: (n: number) => `Compared against ${n} similar businesses`,
    priceSuppressed:
      "There aren't enough comparable businesses yet to show a benchmark. We'll show it once there are — we won't show you one competitor's price wearing a hat.",
    leadTitle: "How far ahead people book",
    leadHint:
      "Days between booking and the date, across your category — it tells you when to open next season.",
    seasonTitle: "Market seasons",
    seasonHint: "100 is an average month. Higher means a peak.",
    conversionTitle: "Views that become bookings",
    conversionValue: (yours: string, median: string) => `You ${yours} · market median ${median}`,
    conversionSuppressed: "Not enough comparison yet.",
    failed: "Could not load",
    minutes: (n: number) => `${n} min`,
  },
} satisfies Record<Locale, unknown>;

const MONTH_LABEL = ["", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

export function InsightsTab({ me, onReload }: { me: PartnerMe; onReload: () => void }) {
  const locale = useLocale();
  const c = copy[locale];
  const [days, setDays] = useState(90);
  const [data, setData] = useState<Insights | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = `partnerId=${me.partnerId}`;

  const load = useCallback(async () => {
    try {
      setData(await api<Insights>(`/v1/partner/insights?${scope}&days=${days}`));
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    }
  }, [scope, days, c.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function togglePlus(action: "start" | "cancel") {
    setBusy(true);
    try {
      await api(`/v1/partner/plus?${scope}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      await load();
      onReload();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="p-4 text-faint">{term(UI, locale, "loading")}</p>;
  const own = data.own;
  const market = data.market;
  const pct = (bps: number) => `${Math.round(bps / 100)}%`;

  return (
    <>
      <div className="flex gap-1.5 mb-2">
        {[30, 90, 365].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold ${
              days === d ? "bg-sea text-white" : "bg-sand text-muted"
            }`}
          >
            {d === 30 ? c.d30 : d === 90 ? c.d90 : c.d365}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {/*
          The split is labelled rather than written as "6 · 0". Two bare
          numbers separated by a dot are unreadable in either direction, and
          which one is Ciao's is exactly the thing the partner is looking for.
        */}
        <Stat
          label={c.jobs}
          value={own.jobs.total}
          sub={c.jobsSplit(own.jobs.ciao, own.jobs.direct)}
        />
        <Stat label={c.income} value={fmtLyd(own.earnings.total, locale)} />
        <Stat label={c.occupancy} value={pct(own.occupancyBps)} sub={`${own.busyDays}/${data.windowDays}`} />
        <Stat
          label={c.outstanding}
          value={fmtLyd(own.earnings.outstanding, locale)}
          tone={own.earnings.outstanding > 0 ? "warn" : "normal"}
        />
      </div>

      {data.actions.length > 0 ? (
        <Section title={c.actions}>
          <ul className="space-y-2">
            {data.actions.map((a) => (
              <li key={a.key} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-0.5">
                  {a.plus ? "✦" : "→"}
                </span>
                <span className="text-muted" lang={locale === "en" ? "en" : "ar"}>
                  {locale === "en" ? a.en : a.ar}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={c.sourceTitle} hint={c.sourceHint}>
        <Bars
          rows={own.sourceMix.map((s) => ({
            label: term(JOB_SOURCES, locale, s.source),
            value: s.jobs,
          }))}
        />
      </Section>

      <Section title={c.monthlyTitle}>
        <Bars
          rows={own.monthly.map((m) => ({ label: m.month, value: m.value }))}
          format={(n) => fmtLyd(n, locale)}
        />
      </Section>

      <Section title={c.funnelTitle} hint={c.funnelHint}>
        <Bars
          rows={[
            { label: c.views, value: own.funnel.views },
            { label: c.quotes, value: own.funnel.quotesViewed },
            { label: c.requests, value: own.funnel.requests },
            { label: c.confirmed, value: own.funnel.confirmed },
          ]}
        />
      </Section>

      <div className="grid gap-2 sm:grid-cols-3 mt-4">
        <Stat
          label={c.repeatTitle}
          value={own.repeatClients.repeat}
          sub={c.repeatValue(own.repeatClients.repeat, own.repeatClients.total)}
        />
        <Stat
          label={c.reliabilityTitle}
          value={`${own.reliability.score}/100`}
          sub={
            own.reliability.medianResponseMinutes > 0
              ? c.minutes(own.reliability.medianResponseMinutes)
              : undefined
          }
          tone={own.reliability.score >= 80 ? "good" : own.reliability.score < 60 ? "warn" : "normal"}
        />
        <Stat
          label={c.quotesTitle}
          value={pct(own.quotes.acceptanceBps)}
          sub={c.quotesValue(own.quotes.accepted, own.quotes.sent)}
        />
      </div>

      {/* ─────────────────────── Ciao Plus ─────────────────────── */}
      {!me.plus.enabled ? null : !data.plus ? (
        <Section title={c.plusTitle}>
          <p className="text-sm text-muted">{c.plusPitch}</p>
          <p className="text-sm font-bold text-sea mt-3">
            {me.plus.trialEndsAt ? null : c.plusFree(me.plus.trialDays)}
          </p>
          <p className="text-[11px] text-faint">
            {c.plusPrice(fmtLyd(me.plus.priceDirhams, locale))}
          </p>
          <button
            className="btn-primary !py-2 !px-5 !text-sm mt-3"
            disabled={busy}
            onClick={() => void togglePlus("start")}
          >
            {me.plus.trialEndsAt ? c.plusStartPaid : c.plusStart}
          </button>
        </Section>
      ) : (
        <>
          <Section
            title={c.plusTitle}
            action={
              <button
                className="text-[11px] text-faint underline"
                disabled={busy}
                onClick={() => void togglePlus("cancel")}
              >
                {c.plusCancel}
              </button>
            }
            hint={
              me.plus.status === "trialing" && me.plus.trialEndsAt
                ? c.plusTrialEnds(
                    fmtDate(locale, me.plus.trialEndsAt, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }),
                  )
                : undefined
            }
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat
                label={c.demandTitle}
                value={market?.areaDemand.searches ?? 0}
                sub={c.demandValue(
                  market?.areaDemand.searches ?? 0,
                  market?.areaDemand.area
                    ? term(AREAS, locale, market.areaDemand.area)
                    : term(VERTICALS, locale, market?.areaDemand.vertical),
                )}
              />
              <Stat
                label={c.missedTitle}
                value={market?.missedDemand.searchesOnClosedDays ?? 0}
                tone={(market?.missedDemand.searchesOnClosedDays ?? 0) > 0 ? "warn" : "normal"}
                sub={
                  market && market.missedDemand.searchesOnClosedDays > 0
                    ? c.missedValue(
                        market.missedDemand.searchesOnClosedDays,
                        market.missedDemand.closedDays,
                      )
                    : c.missedNone
                }
              />
            </div>
          </Section>

          <Section
            title={c.priceTitle}
            hint={
              market?.pricePosition.available
                ? c.pricePeers(market.pricePosition.peers)
                : undefined
            }
          >
            {market?.pricePosition.available ? (
              <>
                <RangeMarker
                  p25={market.pricePosition.p25}
                  p50={market.pricePosition.p50}
                  p75={market.pricePosition.p75}
                  value={market.pricePosition.yours}
                  format={(n) => fmtLyd(n, locale)}
                />
                <p className="text-sm mt-2">
                  <span className="text-faint">{c.priceYours}: </span>
                  <span className="font-bold text-sea tabular-nums">
                    {fmtLyd(market.pricePosition.yours, locale)}
                  </span>
                  <span className="text-faint"> · {c.priceMedian}: </span>
                  <span className="font-bold text-sea tabular-nums">
                    {fmtLyd(market.pricePosition.p50, locale)}
                  </span>
                </p>
              </>
            ) : (
              /*
               * Suppression is stated, not silent. A blank chart reads as "no
               * demand", which is a much worse lie than "not enough data yet".
               */
              <p className="text-sm text-faint">{c.priceSuppressed}</p>
            )}
          </Section>

          <Section title={c.leadTitle} hint={c.leadHint}>
            <Bars
              rows={(market?.leadTime ?? []).map((l) => ({ label: l.bucket, value: l.count }))}
            />
          </Section>

          <Section title={c.seasonTitle} hint={c.seasonHint}>
            <Bars
              rows={(market?.seasonality ?? []).map((s) => ({
                label: MONTH_LABEL[Number(s.month)] ?? s.month,
                value: s.index,
              }))}
            />
          </Section>

          <Section title={c.conversionTitle}>
            {market?.conversion.available ? (
              <p className="text-sm font-bold text-sea">
                {c.conversionValue(
                  pct(market.conversion.yoursBps),
                  pct(market.conversion.medianBps),
                )}
              </p>
            ) : (
              <p className="text-sm text-faint">{c.conversionSuppressed}</p>
            )}
          </Section>
        </>
      )}

      {message ? <p className="card p-3 mt-3 text-sm font-bold text-sea">{message}</p> : null}
      {data.plus ? (
        <p className="text-[11px] text-faint mt-4">
          <Pill tone="amber">Ciao Plus</Pill>{" "}
          {locale === "en"
            ? "Market panels are aggregates only. No panel names another business, and benchmarks are withheld until there are enough of them to be a market rather than a competitor."
            : "أرقام السوق مجمّعة فقط. ما نذكر أي نشاط باسمه، وما نعرض المقارنة إلا لما يكون العدد كافيًا حتى تكون سوقًا لا منافسًا واحدًا."}
        </p>
      ) : null}
    </>
  );
}
