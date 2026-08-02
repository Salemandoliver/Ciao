"use client";
/**
 * Quotes.
 *
 * The workflow this replaces is a voice note. A bride asks a photographer what
 * a wedding costs, the photographer records ninety seconds of pricing, and
 * three weeks later at the door nobody agrees on what was said. This screen
 * produces a priced, dated document with a link that unfurls in WhatsApp — and
 * accepting it books the day.
 *
 * The share step is Web Share where the browser has it, because on Android
 * that hands the link straight to WhatsApp, which is where the conversation
 * already is. Copy-to-clipboard is the fallback, never the primary: asking
 * someone to copy a link and go and find the thread is where sends get lost.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { QUOTE_STATUS, QUOTE_STATUS_TONE, UI, fmtDate, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Pill, Section } from "@/components/panel";
import type { PartnerMe, Quote, QuoteLine } from "./types";

const copy = {
  ar: {
    title: "العروض",
    hint: "عرض سعر مكتوب بتاريخ صلاحية — ترسله في واتساب، والزبون يقبل بضغطة.",
    add: "عرض جديد",
    empty: "ما عندك عروض بعد.",
    fTitle: "عنوان العرض",
    fTitlePh: "تصوير عرس — باقة كاملة",
    fClient: "اسم الزبون",
    fPhone: "رقمه",
    fDay: "تاريخ المناسبة",
    fValid: "صالح لغاية",
    fDeposit: "العربون %",
    fNotes: "ملاحظات",
    fTerms: "الشروط",
    lines: "البنود",
    addLine: "أضف بند",
    lineLabel: "البند",
    qty: "العدد",
    unit: "سعر الوحدة (د.ل)",
    total: "الإجمالي",
    deposit: "العربون",
    save: "احفظ",
    send: "أرسل للزبون",
    share: "شارك الرابط",
    copied: "تم نسخ الرابط",
    withdraw: "اسحب العرض",
    viewed: (n: number, when: string) => `فتحه الزبون ${n} مرة — آخر مرة ${when}`,
    notViewed: "ما فتحه الزبون بعد",
    validUntil: "صالح لغاية",
    saved: "تم الحفظ",
    failed: "تعذر الحفظ",
    shareText: (title: string, total: string) => `عرض سعر: ${title} — ${total}`,
    accepted: "مقبول ✓",
    ownPromise:
      "العرض اتفاق بينك وبين زبونك. تشاو ما تاخذ عمولة عليه، ونستعمله فقط عشان نحجز اليوم في تقويمك لما يُقبل.",
  },
  en: {
    title: "Quotes",
    hint: "A written, dated quote you send on WhatsApp — the customer accepts with one tap.",
    add: "New quote",
    empty: "No quotes yet.",
    fTitle: "Quote title",
    fTitlePh: "Wedding photography — full package",
    fClient: "Client name",
    fPhone: "Their number",
    fDay: "Date of the event",
    fValid: "Valid until",
    fDeposit: "Deposit %",
    fNotes: "Notes",
    fTerms: "Terms",
    lines: "Line items",
    addLine: "Add a line",
    lineLabel: "Item",
    qty: "Qty",
    unit: "Unit price (LYD)",
    total: "Total",
    deposit: "Deposit",
    save: "Save",
    send: "Send to client",
    share: "Share the link",
    copied: "Link copied",
    withdraw: "Withdraw",
    viewed: (n: number, when: string) => `Opened ${n} time(s) — last ${when}`,
    notViewed: "Not opened yet",
    validUntil: "Valid until",
    saved: "Saved",
    failed: "Could not save",
    shareText: (title: string, total: string) => `Quote: ${title} — ${total}`,
    accepted: "Accepted ✓",
    ownPromise:
      "The quote is between you and your customer. Ciao takes no commission on it — we only use it to hold the day in your calendar when it's accepted.",
  },
} satisfies Record<Locale, unknown>;

interface Draft {
  id?: string;
  titleAr: string;
  clientName: string;
  clientPhone: string;
  proposedDay: string;
  validUntil: string;
  depositPct: string;
  notesAr: string;
  termsAr: string;
  lines: { labelAr: string; qty: string; unit: string }[];
}

function emptyDraft(defaultDepositBps: number): Draft {
  const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  return {
    titleAr: "",
    clientName: "",
    clientPhone: "",
    proposedDay: "",
    // A quote with no expiry is a price the customer can hold you to next
    // summer. Two weeks is the default because it is long enough to think and
    // short enough to be a reason to answer.
    validUntil: inTwoWeeks,
    depositPct: String(Math.round(defaultDepositBps / 100)),
    notesAr: "",
    termsAr: "",
    lines: [{ labelAr: "", qty: "1", unit: "" }],
  };
}

export function QuotesTab({ me }: { me: PartnerMe }) {
  const locale = useLocale();
  const c = copy[locale];
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = `partnerId=${me.partnerId}`;

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: Quote[] }>(`/v1/partner/quotes?${scope}`);
      setQuotes(res.items);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    }
  }, [scope, c.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    if (!draft) return { subtotal: 0, deposit: 0 };
    const subtotal = draft.lines.reduce(
      (s, l) => s + Math.round((Number(l.qty) || 0) * (Number(l.unit) || 0) * 1000),
      0,
    );
    const pct = Math.min(100, Math.max(0, Number(draft.depositPct) || 0));
    return { subtotal, deposit: Math.round((subtotal * pct) / 100) };
  }, [draft]);

  async function save(send: boolean) {
    if (!draft || !draft.titleAr.trim()) return;
    const lineItems: QuoteLine[] = draft.lines
      .filter((l) => l.labelAr.trim())
      .map((l) => ({
        labelAr: l.labelAr,
        qty: Number(l.qty) || 1,
        unitPrice: Math.round((Number(l.unit) || 0) * 1000),
      }));
    if (lineItems.length === 0) return;

    setBusy(true);
    setMessage("");
    try {
      const body = {
        titleAr: draft.titleAr,
        ...(draft.clientName
          ? { client: { nameAr: draft.clientName, phone: draft.clientPhone || null } }
          : {}),
        lineItems,
        depositBps: Math.round((Number(draft.depositPct) || 0) * 100),
        proposedDay: draft.proposedDay || null,
        validUntil: draft.validUntil || null,
        notesAr: draft.notesAr || null,
        termsAr: draft.termsAr || null,
        ...(send ? { status: "sent" as const } : {}),
      };
      const res = draft.id
        ? await api<{ quote: Quote; shareUrl: string }>(`/v1/partner/quotes/${draft.id}?${scope}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          })
        : await api<{ quote: Quote; shareUrl: string }>(`/v1/partner/quotes?${scope}`, {
            method: "POST",
            body: JSON.stringify(body),
          });
      setDraft(null);
      await load();
      if (send) await share(res.quote, res.shareUrl);
      else setMessage(c.saved);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  async function share(quote: Quote, url?: string) {
    const link = url ?? `${window.location.origin}/q/${quote.code}`;
    const text = c.shareText(quote.titleAr, fmtLyd(quote.total, locale));
    // Web Share hands this straight to WhatsApp on Android, which is where the
    // conversation already is. Clipboard is the fallback, not the plan.
    if (navigator.share) {
      try {
        await navigator.share({ title: quote.titleAr, text, url: link });
        return;
      } catch {
        /* the user dismissed the sheet — fall through to copying */
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${link}`);
      setMessage(c.copied);
    } catch {
      setMessage(link);
    }
  }

  async function sendExisting(quote: Quote) {
    setBusy(true);
    try {
      const res = await api<{ quote: Quote; shareUrl: string }>(
        `/v1/partner/quotes/${quote.id}?${scope}`,
        { method: "PATCH", body: JSON.stringify({ status: "sent" }) },
      );
      await load();
      await share(res.quote, res.shareUrl);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section
        title={c.title}
        hint={c.hint}
        action={
          <button
            className="btn-primary !py-1.5 !px-3 !text-xs"
            onClick={() => setDraft(emptyDraft(me.profile.defaultDepositBps))}
          >
            + {c.add}
          </button>
        }
      >
        {quotes.length === 0 ? (
          <p className="text-sm text-faint">{c.empty}</p>
        ) : (
          <ul className="space-y-2">
            {quotes.map((q) => (
              <li key={q.id} className="rounded-2xl bg-sand p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-sea leading-tight" lang="ar" dir="rtl">
                      {q.titleAr}
                    </p>
                    <p className="text-[11px] text-muted">
                      <span className="font-inter" dir="ltr">
                        {q.code}
                      </span>
                      {q.clientNameAr ? ` · ${q.clientNameAr}` : ""}
                      {q.proposedDay
                        ? ` · ${fmtDate(locale, q.proposedDay, { day: "numeric", month: "short" })}`
                        : ""}
                    </p>
                    {q.validUntil ? (
                      <p className="text-[11px] text-faint">
                        {c.validUntil}{" "}
                        {fmtDate(locale, q.validUntil, { day: "numeric", month: "short" })}
                      </p>
                    ) : null}
                    {/*
                      "She hasn't seen it" and "she's seen it three times and
                      hasn't answered" are two different conversations, and the
                      partner deserves to know which one they are in.
                    */}
                    {q.status === "sent" ? (
                      <p className="text-[11px] text-faint">
                        {q.viewCount > 0 && q.lastViewedAt
                          ? c.viewed(
                              q.viewCount,
                              fmtDate(locale, q.lastViewedAt, { day: "numeric", month: "short" }),
                            )
                          : c.notViewed}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Pill tone={QUOTE_STATUS_TONE[q.status] ?? "sand"}>
                      {term(QUOTE_STATUS, locale, q.status)}
                    </Pill>
                    <span className="text-sm font-bold text-sea tabular-nums">
                      {fmtLyd(q.total, locale)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {q.status === "draft" ? (
                    <button
                      className="btn-primary !py-1.5 !px-3 !text-xs"
                      disabled={busy}
                      onClick={() => void sendExisting(q)}
                    >
                      {c.send}
                    </button>
                  ) : null}
                  {q.status === "sent" ? (
                    <button className="chip !text-xs font-bold" onClick={() => void share(q)}>
                      {c.share}
                    </button>
                  ) : null}
                  {q.status === "accepted" ? (
                    <span className="text-xs font-bold text-[color:rgb(var(--success))]">
                      {c.accepted}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {draft ? (
        <Section title={c.add} hint={c.ownPromise}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2 text-sm">
              <span className="text-xs font-bold text-muted">{c.fTitle}</span>
              <input
                className="input !py-2 !text-sm mt-1"
                placeholder={c.fTitlePh}
                value={draft.titleAr}
                onChange={(e) => setDraft({ ...draft, titleAr: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-bold text-muted">{c.fClient}</span>
              <input
                className="input !py-2 !text-sm mt-1"
                value={draft.clientName}
                onChange={(e) => setDraft({ ...draft, clientName: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-bold text-muted">{c.fPhone}</span>
              <input
                className="input !py-2 !text-sm mt-1"
                dir="ltr"
                inputMode="tel"
                value={draft.clientPhone}
                onChange={(e) => setDraft({ ...draft, clientPhone: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-bold text-muted">{c.fDay}</span>
              <input
                type="date"
                dir="ltr"
                className="input !py-2 !text-sm mt-1"
                value={draft.proposedDay}
                onChange={(e) => setDraft({ ...draft, proposedDay: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-bold text-muted">{c.fValid}</span>
              <input
                type="date"
                dir="ltr"
                className="input !py-2 !text-sm mt-1"
                value={draft.validUntil}
                onChange={(e) => setDraft({ ...draft, validUntil: e.target.value })}
              />
            </label>
          </div>

          <p className="text-xs font-bold text-muted mt-4 mb-2">{c.lines}</p>
          <div className="space-y-2">
            {draft.lines.map((line, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input !py-2 !text-sm flex-1"
                  placeholder={c.lineLabel}
                  value={line.labelAr}
                  onChange={(e) => {
                    const lines = [...draft.lines];
                    lines[i] = { ...line, labelAr: e.target.value };
                    setDraft({ ...draft, lines });
                  }}
                />
                <input
                  className="input !py-2 !text-sm !w-16 shrink-0"
                  dir="ltr"
                  inputMode="numeric"
                  aria-label={c.qty}
                  value={line.qty}
                  onChange={(e) => {
                    const lines = [...draft.lines];
                    lines[i] = { ...line, qty: e.target.value };
                    setDraft({ ...draft, lines });
                  }}
                />
                <input
                  className="input !py-2 !text-sm !w-24 shrink-0"
                  dir="ltr"
                  inputMode="numeric"
                  aria-label={c.unit}
                  placeholder={c.unit}
                  value={line.unit}
                  onChange={(e) => {
                    const lines = [...draft.lines];
                    lines[i] = { ...line, unit: e.target.value };
                    setDraft({ ...draft, lines });
                  }}
                />
              </div>
            ))}
          </div>
          <button
            className="chip !text-xs font-bold mt-2"
            onClick={() =>
              setDraft({ ...draft, lines: [...draft.lines, { labelAr: "", qty: "1", unit: "" }] })
            }
          >
            + {c.addLine}
          </button>

          <div className="grid gap-3 sm:grid-cols-2 mt-4">
            <label className="text-sm">
              <span className="text-xs font-bold text-muted">{c.fDeposit}</span>
              <input
                className="input !py-2 !text-sm mt-1"
                dir="ltr"
                inputMode="numeric"
                value={draft.depositPct}
                onChange={(e) => setDraft({ ...draft, depositPct: e.target.value })}
              />
            </label>
            <div className="text-sm self-end">
              <p className="text-xs text-faint">
                {c.total}:{" "}
                <span className="font-bold text-sea tabular-nums">
                  {fmtLyd(totals.subtotal, locale)}
                </span>
              </p>
              <p className="text-xs text-faint">
                {c.deposit}:{" "}
                <span className="font-bold text-sea tabular-nums">
                  {fmtLyd(totals.deposit, locale)}
                </span>
              </p>
            </div>
            <label className="sm:col-span-2 text-sm">
              <span className="text-xs font-bold text-muted">{c.fNotes}</span>
              <textarea
                className="input !py-2 !text-sm mt-1"
                rows={2}
                value={draft.notesAr}
                onChange={(e) => setDraft({ ...draft, notesAr: e.target.value })}
              />
            </label>
            <label className="sm:col-span-2 text-sm">
              <span className="text-xs font-bold text-muted">{c.fTerms}</span>
              <textarea
                className="input !py-2 !text-sm mt-1"
                rows={2}
                value={draft.termsAr}
                onChange={(e) => setDraft({ ...draft, termsAr: e.target.value })}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <button
              className="btn-primary !py-2 !px-5 !text-sm"
              disabled={busy}
              onClick={() => void save(true)}
            >
              {c.send}
            </button>
            <button
              className="chip !text-sm font-bold"
              disabled={busy}
              onClick={() => void save(false)}
            >
              {c.save}
            </button>
            <button className="text-sm text-faint underline" onClick={() => setDraft(null)}>
              {term(UI, locale, "cancel")}
            </button>
          </div>
        </Section>
      ) : null}

      {message ? <p className="card p-3 mt-3 text-sm font-bold text-sea">{message}</p> : null}
    </>
  );
}
