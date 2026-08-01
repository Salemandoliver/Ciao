"use client";
/**
 * Host PWA — §8.3 MVP: bookings + confirm/decline, calendar blocks,
 * payout statement, reliability coaching.
 *
 * Hosts are the one audience almost certain to be reading Arabic, but the
 * screen is bilingual anyway: a host managing a Tripoli hall from abroad, or a
 * venue manager whose working language is English, should not be shut out of
 * confirming a booking. The listing titles and the coaching line come from the
 * API in Arabic and are marked as such rather than machine-translated.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useLocale, useRouter } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { api, ensureSession, fmtLyd, ApiError } from "@/lib/api";
import { listingTitle, textProps } from "@/lib/content";
import { fmtDate } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

interface HostBooking {
  id: string;
  code: string;
  state: string;
  checkIn?: string;
  checkOut?: string;
  payoutAmount: number;
  balanceOnArrival: number;
  confirmationDeadline?: string;
}
interface HostListing {
  id: string;
  titleAr: string;
  titleEn?: string | null;
  status: string;
  verified: boolean;
}
interface Payout { id: string; amount: number; status: string; releaseAfter: string }

const copy = {
  ar: {
    loadFailed: "تعذر التحميل",
    actionFailed: "تعذر التنفيذ",
    reliability: (score: number) => `⭐ موثوقيتك: ${score}/100`,
    badDates: "أدخل تواريخ بصيغة 2026-08-15",
    blocked: (n: number) => `تم حجب ${n} يوم`,
    pending: (n: number) => `⏰ طلبات تنتظر ردّك (${n})`,
    yourShare: (deposit: string, cash: string) => `حصتك من العربون: ${deposit} + ${cash} نقدًا`,
    confirm: "أكّد",
    decline: "ارفض",
    bookingsTitle: "حجوزاتك",
    noBookings: "لا حجوزات بعد.",
    guestArrived: "وصل الضيف ✓",
    calendarTitle: "تقويمك — احجب أيامك المحجوزة خارج تشاو",
    block: "احجب",
    calendarNote: "حجب أيامك المحجوزة خارج المنصة يحميك من الحجز المزدوج — ويرفع ترتيبك.",
    payoutsTitle: "مستحقاتك",
    noPayouts: "لا مستحقات بعد.",
    releasedOn: (date: string) => `يُحرَّر ${date}`,
    transferring: "قيد التحويل",
  },
  en: {
    loadFailed: "Could not load",
    actionFailed: "Could not do that",
    reliability: (score: number) => `⭐ Your reliability: ${score}/100`,
    badDates: "Enter dates in the form 2026-08-15",
    blocked: (n: number) => (n === 1 ? "1 day blocked" : `${n} days blocked`),
    pending: (n: number) => `⏰ Requests waiting for your answer (${n})`,
    yourShare: (deposit: string, cash: string) =>
      `Your share of the deposit: ${deposit} + ${cash} in cash`,
    confirm: "Confirm",
    decline: "Decline",
    bookingsTitle: "Your bookings",
    noBookings: "No bookings yet.",
    guestArrived: "Guest arrived ✓",
    calendarTitle: "Your calendar — block the days you booked outside Ciao",
    block: "Block",
    calendarNote:
      "Blocking days you booked off the platform protects you from a double booking — and lifts your ranking.",
    payoutsTitle: "Your payouts",
    noPayouts: "No payouts yet.",
    releasedOn: (date: string) => `Released ${date}`,
    transferring: "Being transferred",
  },
} satisfies Record<Locale, unknown>;

export default function HostDashboard() {
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const [bookings, setBookings] = useState<HostBooking[]>([]);
  const [listings, setListings] = useState<HostListing[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [reliability, setReliability] = useState<{ score: number; coaching: string } | null>(null);
  const [blockInput, setBlockInput] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [b, l, p, r] = await Promise.all([
      api<{ items: HostBooking[] }>("/v1/host/bookings"),
      api<{ items: HostListing[] }>("/v1/host/listings"),
      api<{ items: Payout[] }>("/v1/host/payouts"),
      api<{ score: number; coaching: string }>("/v1/host/reliability"),
    ]);
    setBookings(b.items);
    setListings(l.items);
    setPayouts(p.items);
    setReliability(r);
  }, []);

  useEffect(() => {
    ensureSession().then((ok) => {
      if (!ok) return router.push("/login?next=/host");
      load().catch(() => setMsg(c.loadFailed));
    });
  }, [router, load, c]);

  async function respond(id: string, decision: "confirm" | "decline") {
    try {
      await api(`/v1/bookings/${id}/host-response`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : c.actionFailed);
    }
  }

  async function checkin(id: string) {
    try {
      await api(`/v1/bookings/${id}/checkin`, { method: "POST", body: "{}" });
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : c.actionFailed);
    }
  }

  async function block(listingId: string) {
    const days = (blockInput[listingId] ?? "")
      .split(/[,\s]+/)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (days.length === 0) return setMsg(c.badDates);
    await api(`/v1/host/listings/${listingId}/block`, {
      method: "POST",
      body: JSON.stringify({ days, action: "block" }),
    });
    setMsg(c.blocked(days.length));
  }

  const pending = bookings.filter((b) => b.state === "payment_held");

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/"><Logo /></Link>
        <div className="flex items-center gap-3">
          {reliability ? (
            <span className="chip">{c.reliability(reliability.score)}</span>
          ) : null}
          <LanguageToggle />
        </div>
      </header>

      {/* Coaching is written by the API in Arabic — shown as Arabic, not guessed at. */}
      {reliability ? (
        <p className="text-sm text-muted mb-4" lang="ar" dir="rtl">
          {reliability.coaching}
        </p>
      ) : null}
      {msg ? <p className="card p-3 mb-4 text-sm font-bold text-sea">{msg}</p> : null}

      {pending.length > 0 ? (
        <section className="mb-6">
          <h2 className="font-bold text-lg text-link mb-2">{c.pending(pending.length)}</h2>
          {pending.map((b) => (
            <div key={b.id} className="card p-4 mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="font-inter font-bold" dir="ltr">{b.code}</p>
                <p className="text-sm text-muted">{b.checkIn} → {b.checkOut}</p>
                <p className="text-sm font-bold text-sea">
                  {c.yourShare(fmtLyd(b.payoutAmount, locale), fmtLyd(b.balanceOnArrival, locale))}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <button className="btn-primary !py-2 !px-4 text-sm" onClick={() => respond(b.id, "confirm")}>
                  {c.confirm}
                </button>
                <button className="text-sm text-faint underline" onClick={() => respond(b.id, "decline")}>
                  {c.decline}
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="font-bold text-lg text-sea mb-2">{c.bookingsTitle}</h2>
        {bookings.length === 0 ? (
          <p className="text-faint text-sm">{c.noBookings}</p>
        ) : (
          <ul className="space-y-2">
            {bookings.map((b) => (
              <li key={b.id} className="card p-3 flex justify-between items-center text-sm">
                <span className="font-inter font-bold" dir="ltr">{b.code}</span>
                <span>{b.checkIn}</span>
                <span className="chip">{b.state}</span>
                {["confirmed", "pre_arrival_reconfirmed"].includes(b.state) ? (
                  <button className="underline text-sea font-bold" onClick={() => checkin(b.id)}>
                    {c.guestArrived}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <h2 className="font-bold text-lg text-sea mb-2">{c.calendarTitle}</h2>
        {listings.map((l) => {
          const title = listingTitle(locale, l);
          return (
            <div key={l.id} className="card p-3 mb-2">
              <p className="font-bold text-sm mb-2" {...textProps(title)}>
                {title.text} {l.verified ? "✓" : ""}
              </p>
              <div className="flex gap-2">
                <input
                  dir="ltr"
                  className="input !py-2 text-sm"
                  placeholder="2026-08-15, 2026-08-16"
                  value={blockInput[l.id] ?? ""}
                  onChange={(e) => setBlockInput((s) => ({ ...s, [l.id]: e.target.value }))}
                />
                <button className="btn-primary !py-2 !px-4 text-sm shrink-0" onClick={() => block(l.id)}>
                  {c.block}
                </button>
              </div>
            </div>
          );
        })}
        <p className="text-xs text-faint">{c.calendarNote}</p>
      </section>

      <section>
        <h2 className="font-bold text-lg text-sea mb-2">{c.payoutsTitle}</h2>
        <ul className="space-y-1 text-sm">
          {payouts.map((p) => (
            <li key={p.id} className="card p-3 flex justify-between">
              <span className="font-bold">{fmtLyd(p.amount, locale)}</span>
              <span className="chip">
                {p.status === "queued"
                  ? c.releasedOn(
                      fmtDate(locale, p.releaseAfter, {
                        day: "numeric",
                        month: "numeric",
                        year: "numeric",
                      }),
                    )
                  : p.status === "released"
                    ? c.transferring
                    : p.status}
              </span>
            </li>
          ))}
          {payouts.length === 0 ? <p className="text-faint">{c.noPayouts}</p> : null}
        </ul>
      </section>
    </main>
  );
}
