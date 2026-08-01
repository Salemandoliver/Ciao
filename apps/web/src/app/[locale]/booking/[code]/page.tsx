"use client";
/**
 * Booking tracker + voucher — §6.1 steps 4–7.
 * Offline-cached by the service worker (§12.2): the voucher (code, address,
 * host phone) must survive a blackout on arrival day.
 *
 * The state labels live in `@/lib/vocab`, not here: the same states are shown
 * on «حجوزاتي» and in this page's own timeline, and they have to read the same
 * in both places and both languages.
 */
import { use, useCallback, useEffect, useState } from "react";
import { Link, useLocale } from "@/lib/locale";
import { JoinPrompt } from "@/components/join-prompt";
import { Logo } from "@/components/logo";
import { api, ensureSession, fmtLyd } from "@/lib/api";
import { listingTitle, textProps } from "@/lib/content";
import {
  BOOKING_STATUS,
  BOOKING_STATUS_HINT,
  BOOKING_STATUS_TONE,
  fmtDate,
  fmtDateTime,
  term,
} from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import type { BookingDetail } from "@/lib/types";

const copy = {
  ar: {
    myBookings: "حجوزاتي",
    loading: "جارٍ التحميل…",
    signInPrompt: (code: string) => `سجّل دخولك برقم هاتفك لعرض الحجز ${code}`,
    signIn: "دخول",
    staleWarning: "تعذر تحديث الحالة — تعرض آخر نسخة محفوظة",
    checkIn: "الوصول",
    checkOut: "المغادرة",
    depositPaid: "العربون المدفوع",
    balance: "الباقي نقدًا عند الوصول",
    address: "📍 العنوان (ظهر بعد دفع العربون)",
    openMaps: "افتح في الخرائط",
    review: "⭐ قيّم إقامتك (يفتح لك رصيد خصم)",
    timeline: "سجل الحجز",
    deadlinePassed: "انتهت المهلة — سيتم إرجاع عربونك تلقائيًا إن لم يؤكد المضيف",
    timeLeft: (h: number, m: number) => `متبقٍ للمضيف: ${h} س ${m} د`,
  },
  en: {
    myBookings: "My bookings",
    loading: "Loading…",
    signInPrompt: (code: string) => `Sign in with your phone number to see booking ${code}`,
    signIn: "Sign in",
    staleWarning: "Could not refresh the status — showing the last saved copy",
    checkIn: "Check-in",
    checkOut: "Check-out",
    depositPaid: "Deposit paid",
    balance: "Rest in cash on arrival",
    address: "📍 Address (shown once the deposit is paid)",
    openMaps: "Open in Maps",
    review: "⭐ Rate your stay (it unlocks credit)",
    timeline: "Booking history",
    deadlinePassed:
      "The window has closed — your deposit is returned automatically if the host does not confirm",
    timeLeft: (h: number, m: number) => `The host has ${h}h ${m}m left`,
  },
} satisfies Record<Locale, unknown>;

export default function BookingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const locale = useLocale();
  const c = copy[locale];
  const [b, setB] = useState<BookingDetail | null>(null);
  const [err, setErr] = useState("");
  const [needLogin, setNeedLogin] = useState(false);

  const load = useCallback(async () => {
    if (!(await ensureSession())) {
      setNeedLogin(true);
      return;
    }
    try {
      setB(await api<BookingDetail>(`/v1/bookings/${code}`));
      setErr("");
    } catch {
      setErr(c.staleWarning);
    }
  }, [code, c]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000); // countdown tracking (§6.1 step 4)
    return () => clearInterval(t);
  }, [load]);

  if (needLogin) {
    return (
      <Shell>
        <div className="card p-6 text-center space-y-3">
          <p>{c.signInPrompt(code)}</p>
          {/* Bare path on purpose: the Link puts the locale on the front, and
              the login page prefixes `next` again when it redirects. */}
          <Link href={`/login?next=/booking/${code}`} className="btn-primary inline-block">
            {c.signIn}
          </Link>
        </div>
      </Shell>
    );
  }

  if (!b) return <Shell><p className="text-center py-12 text-faint">{c.loading}</p></Shell>;

  const label = term(BOOKING_STATUS, locale, b.state);
  const hint = BOOKING_STATUS_HINT[locale][b.state];
  const tone = BOOKING_STATUS_TONE[b.state] ?? "bg-sand";
  const title = b.listing ? listingTitle(locale, b.listing) : null;
  const showVoucher = ["confirmed", "pre_arrival_reconfirmed", "checked_in"].includes(b.state);

  return (
    <Shell>
      <div className="space-y-4">
        <div className={`card p-4 ${tone}`}>
          <p className="font-bold text-lg">{label}</p>
          {hint ? <p className="text-sm mt-1 opacity-80">{hint}</p> : null}
          {b.state === "payment_held" && b.confirmationDeadline ? (
            <Countdown deadline={b.confirmationDeadline} />
          ) : null}
        </div>

        {/* Voucher — cached offline, works at 2% battery on 3G (§12.1) */}
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            {title ? (
              <h1 className="font-bold text-xl text-sea" {...textProps(title)}>
                {title.text}
              </h1>
            ) : null}
            <span className="font-inter font-bold text-lg tracking-wider bg-sea text-white rounded-lg px-3 py-1" dir="ltr">
              {b.code}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label={c.checkIn} value={b.checkIn ? fmtDate(locale, b.checkIn) : "-"} />
            <Info label={c.checkOut} value={b.checkOut ? fmtDate(locale, b.checkOut) : "-"} />
            <Info label={c.depositPaid} value={fmtLyd(b.depositAmount, locale)} />
            <Info label={c.balance} value={fmtLyd(b.balanceOnArrival, locale)} />
          </div>

          {showVoucher && b.venue?.addressAr ? (
            <div className="rounded-xl bg-sand p-3 space-y-1">
              <p className="font-bold text-sea">{c.address}</p>
              {/* The address is written in Arabic by the agent who stood in
                  front of the gate. It is shown as it is, marked as Arabic, so
                  it orders correctly on an English page and is read aloud
                  rather than spelled out. */}
              <p lang="ar" dir="rtl">{b.venue.addressAr}</p>
              {b.venue.hostPhone ? (
                <p dir="ltr" className="font-inter">
                  ☎ <a className="underline" href={`tel:${b.venue.hostPhone}`}>{b.venue.hostPhone}</a>
                  {" · "}
                  <a className="underline" href={`https://wa.me/${b.venue.hostPhone.replace("+", "")}`}>
                    WhatsApp
                  </a>
                </p>
              ) : null}
              {b.venue.exactLocation?.lat ? (
                <a
                  className="underline text-sea text-sm"
                  href={`https://maps.google.com/?q=${b.venue.exactLocation.lat},${b.venue.exactLocation.lng}`}
                >
                  {c.openMaps}
                </a>
              ) : null}
            </div>
          ) : null}

          {b.state === "completed" ? (
            <Link href={`/booking/${b.code}/review`} className="btn-amber block text-center">
              {c.review}
            </Link>
          ) : null}
        </div>

        {/* Timeline */}
        <div className="card p-4">
          <h2 className="font-bold text-sea mb-2 text-sm">{c.timeline}</h2>
          <ol className="space-y-1 text-sm text-muted">
            {b.timeline.map((e) => (
              <li key={e.seq}>
                {fmtDateTime(locale, e.at, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Africa/Tripoli",
                })}{" "}
                — {term(BOOKING_STATUS, locale, e.to)}
              </li>
            ))}
          </ol>
        </div>

        {/* The membership offer lands only once the date is actually held —
            asking before the booking works would be a toll gate (§6.1). */}
        {showVoucher ? <JoinPrompt bookingCode={b.code} /> : null}

        {err ? <p className="text-link text-sm text-center">{err}</p> : null}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const c = copy[useLocale()];
  return (
    <main className="mx-auto max-w-2xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/"><Logo size={36} /></Link>
        <Link href="/my" className="text-sm font-bold text-sea">{c.myBookings}</Link>
      </header>
      {children}
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-faint text-xs">{label}</p>
      <p className="font-bold">{value}</p>
    </div>
  );
}

function Countdown({ deadline }: { deadline: string }) {
  const c = copy[useLocale()];
  const [left, setLeft] = useState("");
  useEffect(() => {
    const update = () => {
      const ms = new Date(deadline).getTime() - Date.now();
      if (ms <= 0) {
        setLeft(c.deadlinePassed);
        return;
      }
      const m = Math.floor(ms / 60000);
      setLeft(c.timeLeft(Math.floor(m / 60), m % 60));
    };
    update();
    const t = setInterval(update, 30_000);
    return () => clearInterval(t);
  }, [deadline, c]);
  return <p className="text-sm font-bold mt-1">{left}</p>;
}
