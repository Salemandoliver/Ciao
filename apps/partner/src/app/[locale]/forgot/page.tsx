"use client";
/**
 * Password recovery, by OTP to the phone on record.
 *
 * This is why the OTP machinery stays even though sign-in no longer uses it:
 * an SMS or WhatsApp message to a Libyan business owner's number is the one
 * channel that reliably reaches them. Email barely exists here, and a security
 * question is a second password nobody remembers.
 *
 * Step one always claims to have sent a code, whether or not the number
 * belongs to a partner. That is not politeness — a form that answers "no such
 * account" is a way of asking which businesses are on Ciao, and the answer is
 * worth money to a competitor.
 */
import { useState } from "react";
import { Link, useLocale, useRouter } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { ApiError, api } from "@/lib/api";

const copy = {
  ar: {
    title: "استعادة كلمة السر",
    lead: "اكتب رقم تلفونك ونرسل لك رمزًا. الرمز يروح للرقم المسجّل عندنا فقط.",
    phone: "رقم تلفونك",
    send: "أرسل الرمز",
    sending: "جارٍ الإرسال…",
    sentTitle: "أرسلنا الرمز",
    sentBody:
      "إن كان الرقم مسجّلًا عندنا، وصلك رمز من ٦ أرقام. صالح ٥ دقائق — ولا تعطيه لأحد، حتى لو اتصل بك أحد باسم تشاو.",
    code: "الرمز",
    verify: "تحقق",
    verifying: "جارٍ التحقق…",
    bad: "الرمز غير صحيح أو انتهت صلاحيته.",
    offline: "ما قدرنا نتصل بالخادم — أعد المحاولة.",
    back: "رجوع للدخول",
    devCode: (code: string) => `رمز التجربة: ${code}`,
  },
  en: {
    title: "Reset your password",
    lead: "Enter your phone number and we'll send a code. It only ever goes to the number we hold for you.",
    phone: "Your phone number",
    send: "Send the code",
    sending: "Sending…",
    sentTitle: "Code sent",
    sentBody:
      "If that number is registered, a 6-digit code is on its way. It's valid for 5 minutes — never give it to anyone, even someone who rings claiming to be from Ciao.",
    code: "Code",
    verify: "Verify",
    verifying: "Checking…",
    bad: "That code is wrong or has expired.",
    offline: "We couldn't reach the server — please try again.",
    back: "Back to sign in",
    devCode: (code: string) => `Demo code: ${code}`,
  },
} satisfies Record<Locale, unknown>;

export default function ForgotPage() {
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ ok: boolean; devCode?: string }>("/v1/partner/auth/forgot", {
        method: "POST",
        retry: false,
        body: JSON.stringify({ phone }),
      });
      // Demo mode echoes the code so a walkthrough works without a live BSP.
      if (res.devCode) setDevCode(res.devCode);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : c.offline);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ token: string }>("/v1/partner/auth/forgot/verify", {
        method: "POST",
        retry: false,
        body: JSON.stringify({ phone, code }),
      });
      // The code buys a short-lived set-password token; the actual password is
      // chosen on the same screen a new partner uses, so there is one form to
      // maintain and one place the rules live.
      router.replace(`/set-password?token=${encodeURIComponent(res.token)}`);
    } catch (err) {
      setError(err instanceof ApiError ? c.bad : c.offline);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm px-4 pb-16">
      <header className="flex items-center justify-between py-6">
        <Logo />
        <LanguageToggle />
      </header>

      <div className="card p-6">
        <h1 className="text-lg font-extrabold text-sea">{c.title}</h1>

        {step === "phone" ? (
          <>
            <p className="text-sm text-faint mt-1">{c.lead}</p>
            <form onSubmit={request} className="mt-4">
              <label className="block text-sm">
                <span className="text-xs font-bold text-muted">{c.phone}</span>
                <input
                  className="input mt-1"
                  dir="ltr"
                  inputMode="tel"
                  autoComplete="username"
                  placeholder="0912345678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <button className="btn-primary w-full mt-4" disabled={busy || !phone.trim()}>
                {busy ? c.sending : c.send}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="font-bold text-sea text-sm mt-2">{c.sentTitle}</p>
            <p className="text-sm text-faint mt-1">{c.sentBody}</p>
            {devCode ? (
              <p className="chip mt-3 font-inter font-bold" dir="ltr">
                {c.devCode(devCode)}
              </p>
            ) : null}
            <form onSubmit={verify} className="mt-4">
              <label className="block text-sm">
                <span className="text-xs font-bold text-muted">{c.code}</span>
                <input
                  className="input mt-1 tracking-[0.4em] text-center font-inter"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              <button className="btn-primary w-full mt-4" disabled={busy || code.length !== 6}>
                {busy ? c.verifying : c.verify}
              </button>
            </form>
          </>
        )}

        {error ? (
          <p
            className="mt-3 text-sm font-bold text-[color:rgb(var(--danger))]"
            role="alert"
            aria-live="polite"
          >
            {error}
          </p>
        ) : null}
      </div>

      <p className="text-center mt-4">
        <Link href="/login" className="text-sm text-link font-bold underline">
          {c.back}
        </Link>
      </p>
    </main>
  );
}
