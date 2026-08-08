"use client";
/**
 * Booking widget — §6.1 steps 3–4.
 * No account creation before checkout: phone + OTP appears only at "احجز".
 * Multi-rail choice; Sadad runs the OTP flow; card/tlync redirect.
 */
import { useEffect, useState } from "react";
import { useRouter, useLocale } from "@/lib/locale";
import { api, ensureSession, fmtLyd, setTokens, ApiError } from "@/lib/api";
import type { PublicListing, Quote } from "@/lib/types";
import { localPhone, normalizePhone } from "@ciao/shared";
import { trackClient } from "@/lib/tracker";
import { listingTitle } from "@/lib/content";
import { BOARD, PAYMENT_RAILS, term } from "@/lib/vocab";
import { Extras, type ListingCatalogue } from "./extras";
import {
  DEFAULT_PARTY,
  PartyPicker,
  RequirementsGate,
  unmetRequirements,
  type PartyValue,
} from "./party";
import type { Locale } from "@/lib/i18n";

type Step = "dates" | "phone" | "otp" | "rail" | "sadad_otp" | "done";

/**
 * The money words are the ones people read hardest, so they say exactly what
 * the Arabic says: a deposit that holds the date, the rest in cash on arrival,
 * and what happens if the host says no. Nothing is softened and nothing is
 * added — a promise invented in English is a promise the host never made.
 *
 * The WhatsApp message is written in the reader's language on purpose: it goes
 * to the Ciao team, who answer in both, and it arrives with the listing title
 * and slug so the right place is never in doubt.
 */
const copy = {
  ar: {
    otpSendFailed: "تعذر إرسال الرمز",
    otpWrong: "رمز غير صحيح",
    bookingFailed: "تعذر إنشاء الحجز",
    paymentFailed: "لم يكتمل الدفع — جرّب مرة أخرى",

    quoteTitle: "اطلب عرض سعر",
    quoteBody:
      "الخدمات تُسعَّر حسب مناسبتك — أرسل تاريخك وعدد الضيوف ويرد عليك المزوّد بعرض واضح عبر فريق تشاو.",
    quoteCta: "💬 اطلب عرض سعر (واتساب)",
    quoteNote: "الحجز والدفع عبر تشاو قادم للخدمات — حاليًا فريقنا يوصلك بالمزوّد المعتمد.",
    quoteWa: (title: string, slug: string) => `أريد عرض سعر من ${title} (${slug})`,

    viewingTitle: "احجز موعد معاينة",
    viewingBody:
      "الأعراس لا تُحجز بدون معاينة — نرتب لك زيارة للقاعة ثم تقفل التاريخ بعربون 10٪ أونلاين مع عقد PDF واضح.",
    viewingCta: "📅 اطلب موعد معاينة (واتساب)",
    viewingNote: "الحجز الذاتي الكامل للقاعات قادم — حاليًا فريق تشاو يرافقك خطوة بخطوة.",
    viewingWa: (title: string, slug: string) => `أريد معاينة ${title} (${slug})`,

    bookTitle: "احجز إقامتك",
    checkIn: "الوصول",
    checkOut: "المغادرة",
    nights: (n: number, price: string) => `${n} ليالٍ × ${price}`,
    depositNow: "العربون الآن (٢٠٪)",
    guestSupplement: "ضيوف إضافيون",
    beds: "أسرّة إضافية",
    depositCapped: "العربون عندنا له سقف — الباقي كله عند الوصول.",
    childDiscount: (free: number, half: number) =>
      [free ? `${free} مجانًا` : "", half ? `${half} بنص السعر` : ""]
        .filter(Boolean)
        .join(" · ") + " — خصم الأطفال محسوب",
    minNights: (n: number) => `هذا التاريخ أقل حجز فيه ${n} ليالٍ`,
    mustAccept: "وافق على شروط الدخول قبل الحجز",
    balance: "الباقي نقدًا عند الوصول",
    refundNote:
      "إذا رفض المضيف أو انتهت مهلة التأكيد، يرجع عربونك كاملًا فورًا كرصيد (+5٪ هدية) أو تحويلًا بنكيًا.",
    bookNow: (deposit: string) => `احجز الآن — العربون ${deposit}`,

    phoneLabel: "رقم هاتفك (يصلك رمز تحقق)",
    sendCode: "أرسل الرمز",
    otpLabel: "رمز التحقق",
    devCode: (code: string) => `وضع العرض التجريبي — رمزك: ${code}`,
    confirm: "تأكيد",

    railTitle: "اختر طريقة دفع العربون:",
    birthYear: "سنة الميلاد (لتحقق سداد)",
    booking: "جارٍ الحجز…",
    payDeposit: "ادفع العربون واقفل التاريخ",

    sadadOtp: "أدخل رمز سداد الذي وصلك برسالة:",
    confirmPayment: "تأكيد الدفع",
  },
  en: {
    otpSendFailed: "We could not send the code",
    otpWrong: "That code is not right",
    bookingFailed: "We could not create the booking",
    paymentFailed: "The payment did not go through — try again",

    quoteTitle: "Ask for a quote",
    quoteBody:
      "Services are priced around your occasion — send your date and guest count and the provider comes back with a clear quote through the Ciao team.",
    quoteCta: "💬 Ask for a quote (WhatsApp)",
    quoteNote:
      "Booking and paying through Ciao is coming for services — for now our team connects you to the verified provider.",
    quoteWa: (title: string, slug: string) => `I'd like a quote from ${title} (${slug})`,

    viewingTitle: "Book a viewing",
    viewingBody:
      "Nobody books a wedding without seeing the hall — we arrange the visit, then you hold the date with a 10% deposit online and a clear PDF contract.",
    viewingCta: "📅 Ask for a viewing (WhatsApp)",
    viewingNote:
      "Full self-service booking for halls is coming — for now the Ciao team walks you through it step by step.",
    viewingWa: (title: string, slug: string) => `I'd like to view ${title} (${slug})`,

    bookTitle: "Book your stay",
    checkIn: "Check-in",
    checkOut: "Check-out",
    nights: (n: number, price: string) => `${n} nights × ${price}`,
    depositNow: "Deposit now (20%)",
    guestSupplement: "Extra guests",
    beds: "Extra beds",
    depositCapped: "We cap the deposit — the rest is all paid on arrival.",
    childDiscount: (free: number, half: number) =>
      [free ? `${free} free` : "", half ? `${half} at half price` : ""]
        .filter(Boolean)
        .join(" · ") + " — children's discount applied",
    minNights: (n: number) => `These dates have a ${n}-night minimum`,
    mustAccept: "Agree to the conditions of entry before booking",
    balance: "Rest in cash on arrival",
    refundNote:
      "If the host declines or the confirmation window runs out, your deposit comes back in full straight away — as credit (+5% on top) or a bank transfer.",
    bookNow: (deposit: string) => `Book now — deposit ${deposit}`,

    phoneLabel: "Your phone number (we send a code)",
    sendCode: "Send the code",
    otpLabel: "Verification code",
    devCode: (code: string) => `Demo mode — your code: ${code}`,
    confirm: "Confirm",

    railTitle: "Choose how to pay the deposit:",
    birthYear: "Year of birth (for the Sadad check)",
    booking: "Booking…",
    payDeposit: "Pay the deposit and hold the date",

    sadadOtp: "Enter the Sadad code you were sent:",
    confirmPayment: "Confirm payment",
  },
} satisfies Record<Locale, unknown>;

export function BookingWidget({
  listing,
  catalogue,
}: {
  listing: PublicListing;
  /** The host's own extras, offers and questions. Absent on older listings. */
  catalogue?: ListingCatalogue | null;
}) {
  const router = useRouter();
  const locale = useLocale();
  const c = copy[locale];
  const title = listingTitle(locale, listing).text;
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [step, setStep] = useState<Step>("dates");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [devCode, setDevCode] = useState("");
  const [rails, setRails] = useState<string[]>([]);
  const [rail, setRail] = useState("");
  const [sadadBirthYear, setSadadBirthYear] = useState("");
  const [paymentIntentId, setPaymentIntentId] = useState("");
  const [sadadOtp, setSadadOtp] = useState("");
  const [bookingCode, setBookingCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [party, setParty] = useState<PartyValue>(DEFAULT_PARTY);
  /* The host's catalogue selections. Quantities are a request — the server
     clamps them and adds anything the host marked required. */
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  const [intake, setIntake] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState<string[]>([]);
  /**
   * Where this visitor came from, read once from the URL.
   *
   * A guest arriving from a venue's Facebook post carries `?src=fb` from the
   * storefront through to here, and it rides onto the booking — which is how a
   * partner finally gets a number for what their page is worth. Read from
   * `window` rather than threaded through props because the storefront, the
   * search page and a forwarded WhatsApp link all reach this component by
   * different routes and every one of them should attribute.
   */
  const [source] = useState(() => {
    if (typeof window === "undefined") return undefined;
    const s = new URLSearchParams(window.location.search).get("src");
    return s && ["fb", "wa", "ig", "qr", "tt", "direct"].includes(s) ? s : undefined;
  });
  const [promo] = useState(() => {
    if (typeof window === "undefined") return undefined;
    return new URLSearchParams(window.location.search).get("promo") ?? undefined;
  });

  const missing = unmetRequirements(listing, accepted);
  const heads = party.adults + party.childAges.length;
  const overCapacity = Boolean(listing.maxGuests && heads > listing.maxGuests);

  useEffect(() => {
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      setQuote(null);
      return;
    }
    /*
     * The party rides in the quote request, so the total on screen is the
     * total the server will charge. Anything else and the family watches one
     * number at checkout and pays another at the gate, which is the precise
     * complaint this marketplace was built to answer.
     */
    const qs = new URLSearchParams({ checkIn, checkOut, adults: String(party.adults) });
    if (party.childAges.length) qs.set("childAges", party.childAges.join(","));
    if (party.extraBeds) qs.set("extraBeds", String(party.extraBeds));
    api<Quote>(`/v1/listings/${listing.id}/quote?${qs}`)
      .then(setQuote)
      .catch(() => setQuote(null));
  }, [checkIn, checkOut, listing.id, party]);

  async function startBooking() {
    setError("");
    if (await ensureSession()) {
      await loadRails();
      setStep("rail");
    } else {
      setStep("phone");
    }
  }

  async function requestOtp() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ devCode?: string }>("/v1/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      if (r.devCode) setDevCode(r.devCode);
      setStep("otp");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : c.otpSendFailed);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ accessToken: string; refreshToken: string }>(
        "/v1/auth/otp/verify",
        { method: "POST", body: JSON.stringify({ phone, code: otp }) },
      );
      setTokens(r.accessToken, r.refreshToken);
      await loadRails();
      setStep("rail");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : c.otpWrong);
    } finally {
      setBusy(false);
    }
  }

  async function loadRails() {
    try {
      const r = await api<{ rails: string[] }>("/v1/payments/rails");
      setRails(r.rails);
      setRail(r.rails[0] ?? "");
    } catch {
      setRails(["local_card"]);
      setRail("local_card");
    }
  }

  async function submitBooking() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{
        code: string;
        payment: {
          intentId: string;
          kind: string;
          redirectUrl?: string;
          otpRequestId?: string;
        };
      }>("/v1/bookings", {
        method: "POST",
        headers: { "idempotency-key": `web-${listing.id}-${checkIn}-${Date.now()}` },
        body: JSON.stringify({
          listingId: listing.id,
          checkIn,
          checkOut,
          adults: party.adults,
          childAges: party.childAges,
          extraBeds: party.extraBeds,
          acceptedRequirements: accepted,
          addons: Object.entries(addonQty)
            .filter(([, n]) => n > 0)
            .map(([addonId, qty]) => ({ addonId, qty })),
          intake: Object.entries(intake)
            .filter(([, answer]) => answer.trim())
            .map(([questionId, answer]) => ({ questionId, answer })),
          ...(source ? { source } : {}),
          ...(promo ? { promoCode: promo } : {}),
          rail,
          ...(rail === "sadad"
            ? { sadad: { mobile: localPhone(normalizePhone(phone)), birthYear: sadadBirthYear } }
            : {}),
        }),
      });
      setBookingCode(r.code);
      if (r.payment.kind === "redirect" && r.payment.redirectUrl) {
        window.location.href = r.payment.redirectUrl;
      } else if (r.payment.kind === "otp_confirm") {
        setPaymentIntentId(r.payment.intentId);
        setStep("sadad_otp");
      } else {
        router.push(`/booking/${r.code}`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : c.bookingFailed);
    } finally {
      setBusy(false);
    }
  }

  async function confirmSadad() {
    setBusy(true);
    setError("");
    try {
      await api("/v1/payments/sadad/confirm", {
        method: "POST",
        body: JSON.stringify({ intentId: paymentIntentId, otp: sadadOtp }),
      });
      router.push(`/booking/${bookingCode}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : c.paymentFailed);
    } finally {
      setBusy(false);
    }
  }

  if (listing.type === "service") {
    return (
      <div className="card p-4 sticky top-4">
        <h2 className="font-bold text-sea text-lg">{c.quoteTitle}</h2>
        <p className="text-sm text-muted mt-1">{c.quoteBody}</p>
        <a
          className="btn-primary block text-center mt-4"
          href={`https://wa.me/218910000001?text=${encodeURIComponent(
            c.quoteWa(title, listing.slug),
          )}`}
        >
          {c.quoteCta}
        </a>
        <p className="text-xs text-faint mt-2 text-center">{c.quoteNote}</p>
      </div>
    );
  }

  if (listing.type === "hall") {
    return (
      <div className="card p-4 sticky top-4">
        <h2 className="font-bold text-sea text-lg">{c.viewingTitle}</h2>
        <p className="text-sm text-muted mt-1">{c.viewingBody}</p>
        <a
          className="btn-primary block text-center mt-4"
          href={`https://wa.me/218910000001?text=${encodeURIComponent(
            c.viewingWa(title, listing.slug),
          )}`}
        >
          {c.viewingCta}
        </a>
        <p className="text-xs text-faint mt-2 text-center">{c.viewingNote}</p>
      </div>
    );
  }

  return (
    <div className="card p-4 sticky top-4 space-y-3">
      <h2 className="font-bold text-sea text-lg">{c.bookTitle}</h2>

      {step === "dates" || quote === null ? (
        <>
          <label className="block text-sm font-bold">
            {c.checkIn}
            <input
              type="date"
              className="input mt-1"
              value={checkIn}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setCheckIn(e.target.value)}
            />
          </label>
          <label className="block text-sm font-bold">
            {c.checkOut}
            <input
              type="date"
              className="input mt-1"
              value={checkOut}
              min={checkIn}
              onChange={(e) => setCheckOut(e.target.value)}
            />
          </label>
        </>
      ) : null}

      {step === "dates" ? (
        <>
          <PartyPicker listing={listing} value={party} onChange={setParty} />
          <RequirementsGate listing={listing} accepted={accepted} onChange={setAccepted} />
          {/*
            The host's catalogue sits between the party and the price, because
            it changes the price. Putting it after the total would mean the
            number a guest reads first is the one they never pay. It needs the
            head count, which is why it follows the party picker rather than
            leading it: an add-on charged per person cannot be priced before
            anyone has said how many people are coming.
          */}
          {catalogue ? (
            <Extras
              catalogue={catalogue}
              qty={addonQty}
              onQty={(id, next) => setAddonQty((p) => ({ ...p, [id]: next }))}
              answers={intake}
              onAnswer={(id, value) => setIntake((p) => ({ ...p, [id]: value }))}
              nights={quote?.nights.length ?? 1}
              guests={heads}
            />
          ) : null}
        </>
      ) : null}

      {quote ? (
        <div className="rounded-xl bg-sand p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span>{c.nights(quote.nights.length, fmtLyd(quote.nights[0]?.price ?? 0, locale))}</span>
            <span className="font-bold">{fmtLyd(quote.total, locale)}</span>
          </div>
          <div className="flex justify-between text-sea font-bold text-base">
            <span>{c.depositNow}</span>
            <span>{fmtLyd(quote.deposit, locale)}</span>
          </div>
          {quote.guestTotal ? (
            <div className="flex justify-between text-muted">
              <span>{c.guestSupplement}</span>
              <span>{fmtLyd(quote.guestTotal, locale)}</span>
            </div>
          ) : null}
          {quote.bedTotal ? (
            <div className="flex justify-between text-muted">
              <span>{c.beds}</span>
              <span>{fmtLyd(quote.bedTotal, locale)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-muted">
            <span>{c.balance}</span>
            <span>{fmtLyd(quote.balanceOnArrival, locale)}</span>
          </div>
          {/*
            Say when the deposit is not the headline percentage. An operator
            ceiling that quietly makes 20% into something else is the kind of
            unexplained number that costs more trust than it saves conversion.
          */}
          {quote.depositCapped ? <p className="text-xs text-link">{c.depositCapped}</p> : null}
          {quote.party && quote.party.childrenFree + quote.party.childrenReduced > 0 ? (
            <p className="text-xs text-success font-bold">
              {c.childDiscount(quote.party.childrenFree, quote.party.childrenReduced)}
            </p>
          ) : null}
          {quote.board && quote.board !== "room_only" ? (
            <p className="text-xs text-link font-bold">🍽 {term(BOARD, locale, quote.board)}</p>
          ) : null}
          {quote.requiredMinNights && quote.nights.length < quote.requiredMinNights ? (
            <p className="text-xs font-bold text-danger">
              {c.minNights(quote.requiredMinNights)}
            </p>
          ) : null}
          <p className="text-xs text-faint pt-1">{c.refundNote}</p>
        </div>
      ) : null}

      {step === "dates" && quote ? (
        <>
          <button
            className="btn-amber w-full"
            onClick={startBooking}
            /*
             * Blocked rather than allowed-then-rejected. The server refuses
             * these too — it must, because a form is the thing an integration
             * skips — but discovering at the payment step that you needed to
             * tick a box is a worse experience than the box being obvious.
             */
            disabled={
              busy ||
              overCapacity ||
              missing.length > 0 ||
              Boolean(
                quote.requiredMinNights && quote.nights.length < quote.requiredMinNights,
              )
            }
          >
            {c.bookNow(fmtLyd(quote.deposit, locale))}
          </button>
          {missing.length > 0 ? (
            <p className="text-xs text-muted text-center">{c.mustAccept}</p>
          ) : null}
        </>
      ) : null}

      {step === "phone" ? (
        <div className="space-y-2">
          <label className="block text-sm font-bold">
            {c.phoneLabel}
            <input
              dir="ltr"
              className="input mt-1 text-center"
              placeholder="091 2345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <button className="btn-primary w-full" onClick={requestOtp} disabled={busy || phone.replace(/\D/g, "").length < 9}>
            {c.sendCode}
          </button>
        </div>
      ) : null}

      {step === "otp" ? (
        <div className="space-y-2">
          <label className="block text-sm font-bold">
            {c.otpLabel}
            <input
              dir="ltr"
              inputMode="numeric"
              className="input mt-1 text-center tracking-widest"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
          </label>
          {devCode ? <p className="text-xs text-link">{c.devCode(devCode)}</p> : null}
          <button className="btn-primary w-full" onClick={verifyOtp} disabled={busy || otp.length !== 6}>
            {c.confirm}
          </button>
        </div>
      ) : null}

      {step === "rail" ? (
        <div className="space-y-2">
          <p className="text-sm font-bold">{c.railTitle}</p>
          {rails.map((r) => (
            <label
              key={r}
              className={`flex items-center gap-2 rounded-xl border p-3 cursor-pointer ${
                rail === r ? "border-sea bg-sea/5" : "border-sea/15"
              }`}
            >
              <input
                type="radio"
                name="rail"
                checked={rail === r}
                onChange={() => {
                  setRail(r);
                  trackClient("rail.selected", { rail: r });
                }}
              />
              <span className="text-sm font-bold">{term(PAYMENT_RAILS, locale, r)}</span>
            </label>
          ))}
          {rail === "sadad" ? (
            <input
              dir="ltr"
              className="input"
              placeholder={c.birthYear}
              value={sadadBirthYear}
              onChange={(e) => setSadadBirthYear(e.target.value)}
            />
          ) : null}
          <button
            className="btn-amber w-full"
            onClick={submitBooking}
            disabled={busy || !rail || (rail === "sadad" && sadadBirthYear.length !== 4)}
          >
            {busy ? c.booking : c.payDeposit}
          </button>
        </div>
      ) : null}

      {step === "sadad_otp" ? (
        <div className="space-y-2">
          <p className="text-sm">{c.sadadOtp}</p>
          <input
            dir="ltr"
            inputMode="numeric"
            className="input text-center tracking-widest"
            maxLength={6}
            value={sadadOtp}
            onChange={(e) => setSadadOtp(e.target.value)}
          />
          <button className="btn-primary w-full" onClick={confirmSadad} disabled={busy}>
            {c.confirmPayment}
          </button>
        </div>
      ) : null}

      {error ? <p className="text-danger text-sm font-bold">{error}</p> : null}
    </div>
  );
}
