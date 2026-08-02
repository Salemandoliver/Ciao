"use client";
/**
 * Money.
 *
 * Three questions in the order a partner actually asks them: what have I
 * earned across everything, what is Ciao about to send me and when exactly,
 * and who still owes me. The third is the sleeper — a photographer with four
 * unpaid balances from March is carrying an interest-free loan she never
 * agreed to make, and she has no list of them anywhere.
 *
 * The payout release date is shown with its reason attached. The T+1-after-
 * check-in rule is the platform's only real enforcement lever and also the
 * thing partners complain about most; a date that just appears with no
 * explanation is how a host concludes we are sitting on their money.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { JOB_SOURCES, PAYMENT_RAILS, UI, fmtDate, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Bars, Pill, Section, Stat } from "@/components/panel";
import type { MoneyView, PartnerMe } from "./types";

const copy = {
  ar: {
    earned: "دخلك",
    viaCiao: "عن طريق تشاو",
    direct: "شغلك المباشر",
    share: (pct: number) => `${pct}% من دخلك جا عن طريق تشاو`,
    monthly: "دخلك بالشهور",
    payoutsTitle: "مستحقاتك من تشاو",
    payoutsHint:
      "حصتك من العربون تُحوَّل بعد يوم من وصول الضيف — لأنها ضمانك وضمان الضيف إن المكان زي ما اتفقنا.",
    queued: "بانتظار التحويل",
    inFlight: "قيد التحويل",
    paid: "حُوِّل",
    releasedOn: (d: string) => `يُحرَّر ${d}`,
    owedTitle: "فلوس عندك عند الناس",
    owedHint: "شغل تم أو مؤكد وما وصلك كامل مقابله.",
    overdue: "متأخر",
    noOwed: "ما عندك مستحقات — كل شيء محصّل.",
    accountTitle: "حساب استلام الأموال",
    accountHint: (h: number) =>
      `لحمايتك: أي تغيير للحساب يسري بعد ${h} ساعة، ويوصلك تنبيه على رقمك القديم فورًا. إن ما كنت أنت، توقفه بضغطة.`,
    accountPending: (d: string) => `تغيير معلّق — يسري ${d}`,
    stopChange: "أوقف التغيير",
    changeAccount: "غيّر الحساب",
    accountRef: "رقم الحساب أو المحفظة",
    accountLabel: "اسم للحساب (اختياري)",
    rail: "الوسيلة",
    request: "اطلب التغيير",
    requested: "أرسلنا التنبيه — التغيير يسري بعد المهلة",
    onlyOwner: "تغيير حساب الأموال لصاحب النشاط فقط.",
    failed: "تعذر التنفيذ",
    noData: "لا بيانات بعد",
  },
  en: {
    earned: "Your income",
    viaCiao: "Through Ciao",
    direct: "Your direct work",
    share: (pct: number) => `${pct}% of your income came through Ciao`,
    monthly: "Income by month",
    payoutsTitle: "What Ciao owes you",
    payoutsHint:
      "Your share of the deposit transfers a day after the guest arrives — that timing is what protects both of you if the place isn't what was agreed.",
    queued: "Awaiting transfer",
    inFlight: "Being transferred",
    paid: "Transferred",
    releasedOn: (d: string) => `Released ${d}`,
    owedTitle: "Money owed to you",
    owedHint: "Work that's done or confirmed and not fully paid.",
    overdue: "Overdue",
    noOwed: "Nothing outstanding — it's all collected.",
    accountTitle: "Where your money goes",
    accountHint: (h: number) =>
      `For your protection: any change takes effect after ${h} hours, and an alert goes to your existing number immediately. If it wasn't you, one tap stops it.`,
    accountPending: (d: string) => `Change pending — takes effect ${d}`,
    stopChange: "Stop this change",
    changeAccount: "Change the account",
    accountRef: "Account or wallet number",
    accountLabel: "A name for it (optional)",
    rail: "Method",
    request: "Request the change",
    requested: "Alert sent — the change takes effect after the hold",
    onlyOwner: "Only the business owner can change where money goes.",
    failed: "Could not do that",
    noData: "Nothing yet",
  },
} satisfies Record<Locale, unknown>;

export function MoneyTab({ me }: { me: PartnerMe }) {
  const locale = useLocale();
  const c = copy[locale];
  const [data, setData] = useState<MoneyView | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ rail: string; accountRef: string; label: string } | null>(null);
  const scope = `partnerId=${me.partnerId}`;

  const load = useCallback(async () => {
    try {
      setData(await api<MoneyView>(`/v1/partner/money?${scope}`));
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    }
  }, [scope, c.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function requestChange() {
    if (!form?.accountRef.trim()) return;
    setBusy(true);
    try {
      await api(`/v1/partner/payout-account?${scope}`, {
        method: "POST",
        body: JSON.stringify({
          rail: form.rail,
          accountRef: form.accountRef,
          label: form.label || null,
        }),
      });
      setMessage(c.requested);
      setForm(null);
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  async function stopChange(id: string) {
    setBusy(true);
    try {
      await api(`/v1/partner/payout-account/${id}?${scope}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="p-4 text-faint">{term(UI, locale, "loading")}</p>;

  const pending = data.payoutAccounts.find((a) => a.status === "pending");
  const active = data.payoutAccounts.find((a) => a.status === "active");

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Stat label={c.viaCiao} value={fmtLyd(data.earnings.totalCiao, locale)} />
        <Stat label={c.direct} value={fmtLyd(data.earnings.totalDirect, locale)} />
        <Stat
          label={c.queued}
          value={fmtLyd(data.payouts.queued, locale)}
          tone={data.payouts.queued > 0 ? "good" : "normal"}
        />
      </div>

      <Section
        title={c.monthly}
        hint={
          data.earnings.totalCiao + data.earnings.totalDirect > 0
            ? c.share(Math.round(data.earnings.ciaoShareBps / 100))
            : undefined
        }
      >
        <Bars
          rows={data.earnings.months.map((m) => ({
            label: m.month,
            value: m.ciao + m.direct,
          }))}
          format={(n) => fmtLyd(n, locale)}
        />
      </Section>

      <Section title={c.owedTitle} hint={c.owedHint}>
        {data.receivables.items.length === 0 ? (
          <p className="text-sm text-faint">{c.noOwed}</p>
        ) : (
          <>
            <p className="text-lg font-extrabold text-sea tabular-nums mb-2">
              {fmtLyd(data.receivables.total, locale)}
              {data.receivables.overdueTotal > 0 ? (
                <span className="text-sm font-bold text-[color:rgb(var(--danger))] ms-2">
                  {c.overdue} {fmtLyd(data.receivables.overdueTotal, locale)}
                </span>
              ) : null}
            </p>
            <ul className="space-y-2">
              {data.receivables.items.map((r) => (
                <li
                  key={r.jobId}
                  className="rounded-2xl bg-sand p-3 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sea text-sm truncate" lang="ar" dir="rtl">
                      {r.titleAr}
                    </p>
                    {/*
                      The client's name is Arabic data on a page that may be in
                      English, so it is marked as Arabic rather than folded into
                      the surrounding sentence — otherwise a screen reader
                      spells it out in an English accent and the browser orders
                      it wrongly against the date beside it.
                    */}
                    <p className="text-[11px] text-muted">
                      {fmtDate(locale, r.day, { day: "numeric", month: "short", year: "numeric" })}
                      {r.clientNameAr ? (
                        <>
                          {" · "}
                          <span lang="ar" dir="rtl">
                            {r.clientNameAr}
                          </span>
                        </>
                      ) : null}
                      {` · ${term(JOB_SOURCES, locale, r.source)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.overdue ? <Pill tone="red">{c.overdue}</Pill> : null}
                    <span className="font-bold text-sea tabular-nums">{fmtLyd(r.due, locale)}</span>
                    {r.clientPhone ? (
                      <a
                        className="chip !text-xs font-bold"
                        href={`https://wa.me/${r.clientPhone.replace("+", "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        💬
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title={c.payoutsTitle} hint={c.payoutsHint}>
        {data.payouts.items.length === 0 ? (
          <p className="text-sm text-faint">{c.noData}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.payouts.items.map((p) => (
              <li key={p.id} className="rounded-xl bg-sand p-2.5 flex justify-between items-center">
                <span className="font-bold text-sea tabular-nums">{fmtLyd(p.amount, locale)}</span>
                <span className="text-[11px] text-muted">
                  {p.status === "queued"
                    ? c.releasedOn(
                        fmtDate(locale, p.releaseAfter, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        }),
                      )
                    : p.status === "released"
                      ? c.inFlight
                      : c.paid}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/*
        The payout destination.

        Redirecting payouts is the highest-value attack against this platform —
        one compromised phone becomes every future deposit. The delay and the
        alert to the *old* number are the control, and both are explained on
        the screen rather than being invisible friction people work around.
      */}
      <Section title={c.accountTitle} hint={c.accountHint(data.payoutHoldHours)}>
        {active ? (
          <p className="text-sm font-bold text-sea" dir="ltr">
            {term(PAYMENT_RAILS, locale, active.rail)} · {active.ref}
          </p>
        ) : null}

        {pending ? (
          <div className="tone-warn rounded-2xl p-3 mt-2">
            <p className="text-sm font-bold text-sea" dir="ltr">
              {pending.ref}
            </p>
            <p className="text-[11px] text-muted">
              {c.accountPending(
                pending.activatesAt
                  ? fmtDate(locale, pending.activatesAt, {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "",
              )}
            </p>
            {data.canChangePayoutAccount ? (
              <button
                className="btn-primary !py-1.5 !px-3 !text-xs mt-2"
                disabled={busy}
                onClick={() => void stopChange(pending.id)}
              >
                {c.stopChange}
              </button>
            ) : null}
          </div>
        ) : null}

        {!data.canChangePayoutAccount ? (
          <p className="text-[11px] text-faint mt-2">{c.onlyOwner}</p>
        ) : form ? (
          <div className="grid gap-3 sm:grid-cols-2 mt-3">
            <label className="text-sm">
              <span className="text-xs font-bold text-muted">{c.rail}</span>
              <select
                className="input !py-2 !text-sm mt-1"
                value={form.rail}
                onChange={(e) => setForm({ ...form, rail: e.target.value })}
              >
                {["bank_app", "sadad", "adfali", "local_card"].map((r) => (
                  <option key={r} value={r}>
                    {term(PAYMENT_RAILS, locale, r)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-xs font-bold text-muted">{c.accountRef}</span>
              <input
                className="input !py-2 !text-sm mt-1"
                dir="ltr"
                value={form.accountRef}
                onChange={(e) => setForm({ ...form, accountRef: e.target.value })}
              />
            </label>
            <label className="sm:col-span-2 text-sm">
              <span className="text-xs font-bold text-muted">{c.accountLabel}</span>
              <input
                className="input !py-2 !text-sm mt-1"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </label>
            <div className="sm:col-span-2 flex gap-2">
              <button
                className="btn-primary !py-2 !px-5 !text-sm"
                disabled={busy}
                onClick={() => void requestChange()}
              >
                {c.request}
              </button>
              <button className="chip !text-sm font-bold" onClick={() => setForm(null)}>
                {term(UI, locale, "cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            className="chip !text-sm font-bold mt-3"
            onClick={() => setForm({ rail: "bank_app", accountRef: "", label: "" })}
          >
            {c.changeAccount}
          </button>
        )}
      </Section>

      {message ? <p className="card p-3 mt-3 text-sm font-bold text-sea">{message}</p> : null}
    </>
  );
}
