"use client";
/**
 * Booking widget — §6.1 steps 3–4.
 * No account creation before checkout: phone + OTP appears only at "احجز".
 * Multi-rail choice; Sadad runs the OTP flow; card/tlync redirect.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ensureSession, fmtLyd, setTokens, ApiError } from "@/lib/api";
import type { PublicListing, Quote } from "@/lib/types";
import { localPhone, normalizePhone } from "@ciao/shared";
import { trackClient } from "@/lib/tracker";

type Step = "dates" | "phone" | "otp" | "rail" | "sadad_otp" | "done";

const RAIL_AR: Record<string, string> = {
  sadad: "سداد (المدار)",
  adfali: "إدفعلي (مصرف التجارة والتنمية)",
  local_card: "بطاقة مصرفية محلية",
  tlync: "تطبيقات المصارف (T-Lync)",
  mpgs: "Visa / Mastercard دولية",
};

export function BookingWidget({ listing }: { listing: PublicListing }) {
  const router = useRouter();
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

  useEffect(() => {
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      setQuote(null);
      return;
    }
    api<Quote>(
      `/v1/listings/${listing.id}/quote?checkIn=${checkIn}&checkOut=${checkOut}`,
    )
      .then(setQuote)
      .catch(() => setQuote(null));
  }, [checkIn, checkOut, listing.id]);

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
      setError(e instanceof ApiError ? e.message : "تعذر إرسال الرمز");
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
      setError(e instanceof ApiError ? e.message : "رمز غير صحيح");
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
      setError(e instanceof ApiError ? e.message : "تعذر إنشاء الحجز");
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
      setError(e instanceof ApiError ? e.message : "لم يكتمل الدفع — جرّب مرة أخرى");
    } finally {
      setBusy(false);
    }
  }

  if (listing.type === "service") {
    return (
      <div className="card p-4 sticky top-4">
        <h2 className="font-bold text-sea text-lg">اطلب عرض سعر</h2>
        <p className="text-sm text-sea/70 mt-1">
          الخدمات تُسعَّر حسب مناسبتك — أرسل تاريخك وعدد الضيوف ويرد عليك المزوّد
          بعرض واضح عبر فريق تشاو.
        </p>
        <a
          className="btn-primary block text-center mt-4"
          href={`https://wa.me/218910000001?text=${encodeURIComponent(
            `أريد عرض سعر من ${listing.titleAr} (${listing.slug})`,
          )}`}
        >
          💬 اطلب عرض سعر (واتساب)
        </a>
        <p className="text-xs text-sea/50 mt-2 text-center">
          الحجز والدفع عبر تشاو قادم للخدمات — حاليًا فريقنا يوصلك بالمزوّد المعتمد.
        </p>
      </div>
    );
  }

  if (listing.type === "hall") {
    return (
      <div className="card p-4 sticky top-4">
        <h2 className="font-bold text-sea text-lg">احجز موعد معاينة</h2>
        <p className="text-sm text-sea/70 mt-1">
          الأعراس لا تُحجز بدون معاينة — نرتب لك زيارة للقاعة ثم تقفل التاريخ بعربون
          10٪ أونلاين مع عقد PDF واضح.
        </p>
        <a
          className="btn-primary block text-center mt-4"
          href={`https://wa.me/218910000001?text=${encodeURIComponent(
            `أريد معاينة ${listing.titleAr} (${listing.slug})`,
          )}`}
        >
          📅 اطلب موعد معاينة (واتساب)
        </a>
        <p className="text-xs text-sea/50 mt-2 text-center">
          الحجز الذاتي الكامل للقاعات قادم — حاليًا فريق تشاو يرافقك خطوة بخطوة.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-4 sticky top-4 space-y-3">
      <h2 className="font-bold text-sea text-lg">احجز إقامتك</h2>

      {step === "dates" || quote === null ? (
        <>
          <label className="block text-sm font-bold">
            الوصول
            <input
              type="date"
              className="input mt-1"
              value={checkIn}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setCheckIn(e.target.value)}
            />
          </label>
          <label className="block text-sm font-bold">
            المغادرة
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

      {quote ? (
        <div className="rounded-xl bg-sand p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span>
              {quote.nights.length} ليالٍ × {fmtLyd(quote.nights[0]?.price ?? 0)}
            </span>
            <span className="font-bold">{fmtLyd(quote.total)}</span>
          </div>
          <div className="flex justify-between text-sea font-bold text-base">
            <span>العربون الآن (٢٠٪)</span>
            <span>{fmtLyd(quote.deposit)}</span>
          </div>
          <div className="flex justify-between text-sea/70">
            <span>الباقي نقدًا عند الوصول</span>
            <span>{fmtLyd(quote.balanceOnArrival)}</span>
          </div>
          <p className="text-xs text-sea/50 pt-1">
            إذا رفض المضيف أو انتهت مهلة التأكيد، يرجع عربونك كاملًا فورًا كرصيد (+5٪
            هدية) أو تحويلًا بنكيًا.
          </p>
        </div>
      ) : null}

      {step === "dates" && quote ? (
        <button className="btn-amber w-full" onClick={startBooking} disabled={busy}>
          احجز الآن — العربون {fmtLyd(quote.deposit)}
        </button>
      ) : null}

      {step === "phone" ? (
        <div className="space-y-2">
          <label className="block text-sm font-bold">
            رقم هاتفك (يصلك رمز تحقق)
            <input
              dir="ltr"
              className="input mt-1 text-center"
              placeholder="091 2345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <button className="btn-primary w-full" onClick={requestOtp} disabled={busy || phone.replace(/\D/g, "").length < 9}>
            أرسل الرمز
          </button>
        </div>
      ) : null}

      {step === "otp" ? (
        <div className="space-y-2">
          <label className="block text-sm font-bold">
            رمز التحقق
            <input
              dir="ltr"
              inputMode="numeric"
              className="input mt-1 text-center tracking-widest"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
          </label>
          {devCode ? (
            <p className="text-xs text-amber-dark">وضع العرض التجريبي — رمزك: {devCode}</p>
          ) : null}
          <button className="btn-primary w-full" onClick={verifyOtp} disabled={busy || otp.length !== 6}>
            تأكيد
          </button>
        </div>
      ) : null}

      {step === "rail" ? (
        <div className="space-y-2">
          <p className="text-sm font-bold">اختر طريقة دفع العربون:</p>
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
              <span className="text-sm font-bold">{RAIL_AR[r] ?? r}</span>
            </label>
          ))}
          {rail === "sadad" ? (
            <input
              dir="ltr"
              className="input"
              placeholder="سنة الميلاد (لتحقق سداد)"
              value={sadadBirthYear}
              onChange={(e) => setSadadBirthYear(e.target.value)}
            />
          ) : null}
          <button
            className="btn-amber w-full"
            onClick={submitBooking}
            disabled={busy || !rail || (rail === "sadad" && sadadBirthYear.length !== 4)}
          >
            {busy ? "جارٍ الحجز…" : "ادفع العربون واقفل التاريخ"}
          </button>
        </div>
      ) : null}

      {step === "sadad_otp" ? (
        <div className="space-y-2">
          <p className="text-sm">أدخل رمز سداد الذي وصلك برسالة:</p>
          <input
            dir="ltr"
            inputMode="numeric"
            className="input text-center tracking-widest"
            maxLength={6}
            value={sadadOtp}
            onChange={(e) => setSadadOtp(e.target.value)}
          />
          <button className="btn-primary w-full" onClick={confirmSadad} disabled={busy}>
            تأكيد الدفع
          </button>
        </div>
      ) : null}

      {error ? <p className="text-red-700 text-sm font-bold">{error}</p> : null}
    </div>
  );
}
