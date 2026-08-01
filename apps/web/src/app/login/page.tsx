"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/logo";
import { api, setTokens, ApiError } from "@/lib/api";

function LoginForm() {
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
      router.push(next);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setError(
        name === "NotAllowedError"
          ? "أُلغيت العملية"
          : "لا يوجد مفتاح دخول على هذا الجهاز — ادخل برقمك ثم فعّله من الأمان",
      );
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
      setError(e instanceof ApiError ? e.message : "تعذر إرسال الرمز");
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
      setError(e instanceof ApiError ? e.message : "رمز غير صحيح");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6 space-y-4">
      <h1 className="font-bold text-xl text-sea">الدخول برقم الهاتف</h1>
      {stage === "phone" ? (
        <>
          <input
            dir="ltr"
            className="input text-center"
            placeholder="091 2345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button className="btn-primary w-full" onClick={request} disabled={busy || phone.replace(/\D/g, "").length < 9}>
            أرسل رمز التحقق
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
          {devCode ? <p className="text-xs text-amber-dark">وضع العرض التجريبي — رمزك: {devCode}</p> : null}
          <button className="btn-primary w-full" onClick={verify} disabled={busy || code.length !== 6}>
            دخول
          </button>
        </>
      )}
      {error ? <p className="text-red-700 text-sm font-bold">{error}</p> : null}

      {passkeyReady && stage === "phone" ? (
        <>
          <div className="flex items-center gap-2 text-xs text-sea/40">
            <span className="h-px flex-1 bg-sea/15" />
            أو
            <span className="h-px flex-1 bg-sea/15" />
          </div>
          <button
            className="w-full rounded-bubble border border-sea/20 py-3 font-bold text-sea active:bg-sand"
            onClick={passkeyLogin}
            disabled={busy}
          >
            🔐 الدخول بالبصمة
          </button>
          <p className="text-[11px] text-sea/45 text-center">
            أسرع، ومجاني، ويشتغل حتى بدون شبكة — فعّله مرة واحدة من إعدادات الأمان.
          </p>
        </>
      ) : null}

      <p className="text-xs text-sea/50">
        لا كلمات مرور ولا بريد إلكتروني — رقمك هو حسابك.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-4 pb-16">
      <header className="py-4">
        <Link href="/"><Logo size={36} /></Link>
      </header>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
