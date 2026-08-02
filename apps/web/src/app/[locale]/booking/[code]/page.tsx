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
import { trackClient } from "@/lib/tracker";
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
    directions: "🧭 الطريق إلى المكان",
    geoAlt: "افتح في تطبيق خرائط ثاني",
    coords: "الإحداثيات",
    coordsHint: "انسخها، أو اقراها في التلفون لواحد يعرف الطريق.",
    withheldProvider:
      "المزوّدة تشارك موقعها بنفسها بعد ما تأكد الحجز — هكي اختارت، وهكي تمشي الأمور عادةً.",
    withheldNotRecorded:
      "ما عندناش نقطة على الخريطة لهذا المكان لحدّ الآن. كلّم المضيف على الرقم فوق وهو يوصّفلك الطريق.",
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
    directions: "🧭 Directions",
    geoAlt: "Open in another maps app",
    coords: "Coordinates",
    coordsHint: "Copy them, or read them down the phone to someone who knows the road.",
    withheldProvider:
      "She shares her location herself once she has confirmed. That is how she has set it up, and how this usually works here.",
    withheldNotRecorded:
      "We do not have a pin for this place yet. Call the host on the number above and they will talk you in.",
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

          {showVoucher && b.venue ? <GettingThere booking={b} venue={b.venue} /> : null}

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

/**
 * How the guest actually gets there.
 *
 * This is the screen someone is holding at a gate, at night, on a coast road
 * with one bar of signal and a car full of family, so it is built for that and
 * not for the happy path:
 *
 *  - The link is rebuilt locally when the cached payload predates the API
 *    sending one. The voucher is offline-cached (§12.2) and a button that only
 *    works when the network does is not a button.
 *  - The raw coordinates are selectable text, because the method that beats
 *    every link is reading them down the phone to someone who knows the road.
 *  - `geo:` sits underneath, for a phone with no Google services.
 *
 * When there is no pin, this says why. A provider who chose to keep her
 * address to herself has not caused an error and is not a missing feature —
 * she shares it herself once she has confirmed, which is how this market works
 * anyway. A venue we simply have not walked to yet is our gap, not hers, and
 * the honest answer there is the host's phone.
 */
function GettingThere({
  booking,
  venue,
}: {
  booking: BookingDetail;
  venue: NonNullable<BookingDetail["venue"]>;
}) {
  const c = copy[useLocale()];
  const exact = venue.exactLocation ?? null;
  const coords = exact ? `${exact.lat},${exact.lng}` : null;
  const navUrl =
    venue.navigationUrl ??
    (coords
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coords)}`
      : null);
  const geo =
    venue.geoUri ??
    (coords ? `geo:${coords}?q=${coords}(${encodeURIComponent(venue.nameAr)})` : null);
  const withheld = venue.locationWithheldReason ?? null;

  // Nothing to say at all — no address, no pin, no reason, no phone.
  if (!venue.addressAr && !navUrl && !withheld && !venue.hostPhone) return null;

  const open = (target: "maps" | "geo") =>
    trackClient("navigation.opened", { bookingId: booking.id, target });

  return (
    <div className="rounded-xl bg-sand p-3 space-y-2">
      <p className="font-bold text-sea">{c.address}</p>
      {/* The address is written in Arabic by the agent who stood in front of
          the gate. It is shown as it is, marked as Arabic, so it orders
          correctly on an English page and is read aloud rather than spelled
          out. */}
      {venue.addressAr ? (
        <p lang="ar" dir="rtl">
          {venue.addressAr}
        </p>
      ) : null}

      {venue.hostPhone ? (
        <p dir="ltr" className="font-inter">
          ☎{" "}
          <a className="underline" href={`tel:${venue.hostPhone}`}>
            {venue.hostPhone}
          </a>
          {" · "}
          <a className="underline" href={`https://wa.me/${venue.hostPhone.replace("+", "")}`}>
            WhatsApp
          </a>
        </p>
      ) : null}

      {navUrl ? (
        <div className="space-y-2 pt-1">
          <a
            href={navUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => open("maps")}
            className="btn-primary block text-center"
          >
            {c.directions}
          </a>
          {coords ? (
            <div>
              <p className="text-faint text-xs">{c.coords}</p>
              {/* Selectable, and selected whole on a single tap — a long-press
                  drag to catch a decimal point is not something to ask of
                  someone standing in the dark. */}
              <p dir="ltr" className="font-inter font-bold select-all">
                {coords}
              </p>
              <p className="text-muted text-xs">{c.coordsHint}</p>
            </div>
          ) : null}
          {geo ? (
            <a href={geo} onClick={() => open("geo")} className="text-link text-sm underline">
              {c.geoAlt}
            </a>
          ) : null}
        </div>
      ) : withheld === "provider_choice" ? (
        <p className="text-muted text-sm">{c.withheldProvider}</p>
      ) : withheld === "not_recorded" ? (
        <p className="text-muted text-sm">{c.withheldNotRecorded}</p>
      ) : null}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const c = copy[useLocale()];
  return (
    <main className="mx-auto max-w-2xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/"><Logo /></Link>
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
