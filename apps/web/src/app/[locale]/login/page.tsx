"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link, useLocale, useRouter } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { api, setTokens, ApiError } from "@/lib/api";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: {
    title: "الدخول برقم الهاتف",
    phonePlaceholder: "091 2345678",
    sendCode: "أرسل رمز التحقق",
    sendFailed: "تعذر إرسال الرمز",
    demoCode: (code: string) => `وضع العرض التجريبي — رمزك: ${code}`,
    signIn: "دخول",
    wrongCode: "رمز غير صحيح",
    passkeyCancelled: "أُلغيت العملية",
    noPasskey: "لا يوجد مفتاح دخول على هذا الجهاز — ادخل برقمك ثم فعّله من الأمان",
    or: "أو",
    passkeySignIn: "🔐 الدخول بالبصمة",
    passkeyNote: "أسرع، ومجاني، ويشتغل حتى بدون شبكة — فعّله مرة واحدة من إعدادات الأمان.",
    noPasswords: "لا كلمات مرور ولا بريد إلكتروني — رقمك هو حسابك.",
  },
  en: {
    title: "Sign in with your phone",
    phonePlaceholder: "091 2345678",
    sendCode: "Send the code",
    sendFailed: "Could not send the code",
    demoCode: (code: string) => `Demo mode — your code is ${code}`,
    signIn: "Sign in",
    wrongCode: "That code is not right",
    passkeyCancelled: "Cancelled",
    noPasskey:
      "There is no passkey on this device — sign in with your number, then turn one on under Security",
    or: "or",
    passkeySignIn: "🔐 Sign in with your fingerprint",
    passkeyNote:
      "Faster, free, and it works with no signal — set it up once from your security settings.",
    noPasswords: "No passwords and no email — your number is your account.",
  },
} satisfies Record<Locale, unknown>;

function LoginForm() {
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/my";
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeyReady, setPasskeyReady] = useState(false);

  // Only offer the passkey path where the browser can actually do it —
  // a button that fails is worse than no button.
  useEffect(() => {
    setPasskeyReady(typeof window !== "undefined" && Boolean(window.PublicKeyCredential));
  }, []);

  /**
   * Passkey sign-in. No phone number is asked for first: prompting for one
   * would leak whether a given number has an account. The device's resident
   * key tells the server who it is after the fingerprint, not before.
   */
  async function passkeyLogin() {
    setBusy(true);
    setError("");
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const options = await api<Record<string, unknown>>("/v1/auth/passkey/options", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const response = await startAuthentication({ optionsJSON: options as never });
      const r = await api<{ accessToken: string; refreshToken: string }>(
        "/v1/auth/passkey/verify",
        { method: "POST", body: JSON.stringify({ response }) },
      );
      setTokens(r.accessToken, r.refreshToken);
      // `next` stays a bare path — the wrapped router puts the language on.
      router.push(next);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setError(name === "NotAllowedError" ? c.passkeyCancelled : c.noPasskey);
    } finally {
      setBusy(false);
    }
  }

  async function request() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ devCode?: string }>("/v1/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      if (r.devCode) setDevCode(r.devCode);
      setStage("otp");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : c.sendFailed);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ accessToken: string; refreshToken: string }>(
        "/v1/auth/otp/verify",
        { method: "POST", body: JSON.stringify({ phone, code }) },
      );
      setTokens(r.accessToken, r.refreshToken);
      router.push(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : c.wrongCode);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6 space-y-4">
      <h1 className="font-bold text-xl text-sea">{c.title}</h1>
      {stage === "phone" ? (
        <>
          {/* Numbers stay in the local 09… form in both languages — this is
              the number the person hands to a taxi driver. */}
          <input
            dir="ltr"
            className="input text-center"
            placeholder={c.phonePlaceholder}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button className="btn-primary w-full" onClick={request} disabled={busy || phone.replace(/\D/g, "").length < 9}>
            {c.sendCode}
          </button>
        </>
      ) : (
        <>
          <input
            dir="ltr"
            inputMode="numeric"
            maxLength={6}
            className="input text-center tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {devCode ? <p className="text-xs text-link">{c.demoCode(devCode)}</p> : null}
          <button className="btn-primary w-full" onClick={verify} disabled={busy || code.length !== 6}>
            {c.signIn}
          </button>
        </>
      )}
      {error ? <p className="text-danger text-sm font-bold">{error}</p> : null}

      {passkeyReady && stage === "phone" ? (
        <>
          <div className="flex items-center gap-2 text-xs text-faint">
            <span className="h-px flex-1 bg-sea/15" />
            {c.or}
            <span className="h-px flex-1 bg-sea/15" />
          </div>
          <button
            className="w-full rounded-bubble border border-sea/20 py-3 font-bold text-sea active:bg-sand"
            onClick={passkeyLogin}
            disabled={busy}
          >
            {c.passkeySignIn}
          </button>
          <p className="text-[11px] text-faint text-center">{c.passkeyNote}</p>
        </>
      ) : null}

      <p className="text-xs text-faint">{c.noPasswords}</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/"><Logo /></Link>
        <LanguageToggle />
      </header>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
