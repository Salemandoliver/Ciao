"use client";
/**
 * Today — the home of the whole console.
 *
 * Written for someone standing up, holding a phone, about to leave the house.
 * It answers four questions in the order they are actually asked: what am I
 * doing, who is it for, where is it, and what do they still owe me. Everything
 * else in this product is a tab; this is the app.
 *
 * The phone number is a link, not text. A partner running late needs one tap
 * to WhatsApp the client, and «اتصل» beside a number they have to retype is
 * the difference between a tool and a report.
 */
import { useCallback, useEffect, useState } from "react";
import { api, fmtLyd, ApiError } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { JOB_SOURCES, JOB_STATUS, JOB_STATUS_TONE, fmtDate, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Pill, Section, Stat } from "@/components/panel";
import type { AgendaJob, PartnerMe } from "./types";

const copy = {
  ar: {
    today: "اليوم",
    tomorrow: "بكرة",
    nothing: "ما عندك شغل مسجّل.",
    nothingHint: "سجّل شغلك هنا حتى اللي جاك من واتساب — يمنع التعارض ويحسب لك دخلك.",
    addJob: "أضف شغل",
    call: "اتصل",
    whatsapp: "واتساب",
    owed: "الباقي",
    paid: "مدفوع بالكامل",
    jobsToday: "شغل اليوم",
    owedToday: "مستحق اليوم",
    quotesWaiting: "عروض تنتظر ردًّا",
    loadFailed: "تعذر التحميل",
    retry: "أعد المحاولة",
    quickTitle: "أمر سريع",
    quickHint: "اكتب زي ما تكتب في واتساب: «احجب 12-15/8» أو «افتح 14/8» أو «اليوم».",
    send: "نفّذ",
    quickPlaceholder: "احجب 12-15/8",
    ciaoBooking: "حجز تشاو",
  },
  en: {
    today: "Today",
    tomorrow: "Tomorrow",
    nothing: "Nothing in the diary.",
    nothingHint:
      "Add your work here even when it came from WhatsApp — it stops clashes and totals your income.",
    addJob: "Add a job",
    call: "Call",
    whatsapp: "WhatsApp",
    owed: "Still owed",
    paid: "Paid in full",
    jobsToday: "Jobs today",
    owedToday: "Owed today",
    quotesWaiting: "Quotes awaiting a reply",
    loadFailed: "Could not load",
    retry: "Try again",
    quickTitle: "Quick command",
    quickHint: 'Write it like a WhatsApp message: "block 12-15/8", "open 14/8", or "today".',
    send: "Run",
    quickPlaceholder: "block 12-15/8",
    ciaoBooking: "Ciao booking",
  },
} satisfies Record<Locale, unknown>;

export function TodayTab({ me, onGo }: { me: PartnerMe; onGo: (tab: "jobs" | "quotes") => void }) {
  const locale = useLocale();
  const c = copy[locale];
  const [days, setDays] = useState<{ day: string; jobs: AgendaJob[] }[]>([]);
  const [quotesWaiting, setQuotesWaiting] = useState(0);
  const [error, setError] = useState("");
  const [command, setCommand] = useState("");
  const [commandReply, setCommandReply] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = `partnerId=${me.partnerId}`;
  const showMoney = me.capabilities.includes("money");

  const load = useCallback(async () => {
    setError("");
    try {
      const agenda = await api<{ days: { day: string; jobs: AgendaJob[] }[] }>(
        `/v1/partner/agenda?${scope}&days=2`,
      );
      setDays(agenda.days);
      if (showMoney) {
        const quotes = await api<{ items: { status: string }[] }>(
          `/v1/partner/quotes?${scope}&status=sent`,
        );
        setQuotesWaiting(quotes.items.length);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : c.loadFailed);
    }
  }, [scope, showMoney, c.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runCommand() {
    if (!command.trim()) return;
    setBusy(true);
    try {
      const res = await api<{ ar: string; en: string }>(`/v1/partner/command?${scope}`, {
        method: "POST",
        body: JSON.stringify({ message: command }),
      });
      setCommandReply(locale === "en" ? res.en : res.ar);
      setCommand("");
      await load();
    } catch (e) {
      setCommandReply(e instanceof ApiError ? e.message : c.loadFailed);
    } finally {
      setBusy(false);
    }
  }

  const todayJobs = days[0]?.jobs ?? [];
  const owedToday = todayJobs.reduce((s, j) => s + j.balanceDue, 0);

  if (error) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-muted">{error}</p>
        <button className="btn-primary !py-2 !text-sm mt-3" onClick={() => void load()}>
          {c.retry}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className={`grid gap-2 ${showMoney ? "grid-cols-3" : "grid-cols-1"}`}>
        <Stat label={c.jobsToday} value={todayJobs.length} />
        {showMoney ? (
          <>
            <Stat
              label={c.owedToday}
              value={fmtLyd(owedToday, locale)}
              tone={owedToday > 0 ? "warn" : "normal"}
            />
            <Stat
              label={c.quotesWaiting}
              value={quotesWaiting}
              sub={
                quotesWaiting > 0 ? (
                  <button className="underline font-bold" onClick={() => onGo("quotes")}>
                    {locale === "en" ? "Open" : "افتح"}
                  </button>
                ) : null
              }
            />
          </>
        ) : null}
      </div>

      {days.map((d, i) => (
        <Section
          key={d.day}
          title={`${i === 0 ? c.today : i === 1 ? c.tomorrow : ""} · ${fmtDate(locale, d.day, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}`}
          action={
            i === 0 ? (
              <button className="chip !text-xs font-bold" onClick={() => onGo("jobs")}>
                + {c.addJob}
              </button>
            ) : null
          }
        >
          {d.jobs.length === 0 ? (
            <div>
              <p className="text-sm text-faint">{c.nothing}</p>
              {i === 0 ? <p className="text-[11px] text-faint mt-1">{c.nothingHint}</p> : null}
            </div>
          ) : (
            <ul className="space-y-2">
              {d.jobs.map((j) => (
                <li key={j.id} className="rounded-2xl bg-sand p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {/*
                        The time sits in its own flex slot rather than inline.
                        A `dir="ltr"` span inside an RTL paragraph collapses
                        against the Arabic that follows it, so "09:00" and the
                        job title ran together into one unreadable word — and
                        the time is the first thing being read on this screen.
                      */}
                      <p className="font-bold text-sea leading-tight flex items-baseline gap-1.5">
                        {j.startTime ? (
                          <span className="tabular-nums text-muted shrink-0" dir="ltr">
                            {j.startTime}
                          </span>
                        ) : null}
                        <span lang="ar" dir="rtl">
                          {j.titleAr}
                        </span>
                      </p>
                      {j.clientNameAr ? (
                        <p className="text-sm text-muted" lang="ar" dir="rtl">
                          {j.clientNameAr}
                        </p>
                      ) : null}
                      {j.locationAr ? (
                        <p className="text-[11px] text-faint" lang="ar" dir="rtl">
                          📍 {j.locationAr}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Pill tone={JOB_STATUS_TONE[j.status] ?? "sand"}>
                        {term(JOB_STATUS, locale, j.status)}
                      </Pill>
                      <span className="text-[11px] text-faint">
                        {j.bookingCode
                          ? c.ciaoBooking
                          : term(JOB_SOURCES, locale, j.source)}
                      </span>
                    </div>
                  </div>

                  {j.notesAr ? (
                    <p className="text-[11px] text-muted mt-1" lang="ar" dir="rtl">
                      {j.notesAr}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {j.clientPhone ? (
                      <>
                        {/*
                          Two taps, both one-handed. `wa.me` opens the thread
                          they are already having with this client, which is
                          where the conversation actually lives.
                        */}
                        <a
                          className="chip !text-xs font-bold"
                          href={`tel:${j.clientPhone}`}
                          dir="ltr"
                        >
                          📞 {c.call}
                        </a>
                        <a
                          className="chip !text-xs font-bold"
                          href={`https://wa.me/${j.clientPhone.replace("+", "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          💬 {c.whatsapp}
                        </a>
                      </>
                    ) : null}
                    {showMoney ? (
                      j.balanceDue > 0 ? (
                        <span className="text-xs font-bold text-link tabular-nums">
                          {c.owed}: {fmtLyd(j.balanceDue, locale)}
                        </span>
                      ) : j.price > 0 ? (
                        <span className="text-xs text-faint">{c.paid}</span>
                      ) : null
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ))}

      {/*
        The command box.

        It looks redundant next to a calendar you can tap — and it is not. This
        is the interface a large share of this supply base will actually use,
        because it is the one they already use for everything else. Having it
        here also means the parser is exercised against real Libyan phrasing
        long before it becomes the only way in over WhatsApp.
      */}
      <Section title={c.quickTitle} hint={c.quickHint}>
        <div className="flex gap-2">
          <input
            className="input !py-2 !text-sm"
            placeholder={c.quickPlaceholder}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runCommand();
            }}
          />
          <button
            className="btn-primary !py-2 !px-4 !text-sm shrink-0"
            disabled={busy}
            onClick={() => void runCommand()}
          >
            {c.send}
          </button>
        </div>
        {commandReply ? (
          <p className="text-sm text-sea font-bold mt-2 whitespace-pre-line" lang={locale === "en" ? "en" : "ar"}>
            {commandReply}
          </p>
        ) : null}
      </Section>
    </>
  );
}
