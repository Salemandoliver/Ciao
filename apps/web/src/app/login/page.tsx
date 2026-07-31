"use client";
import { Suspense, useState } from "react";
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
            placeholder="+2189XXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button className="btn-primary w-full" onClick={request} disabled={busy || phone.length < 10}>
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
          {devCode ? <p className="text-xs text-amber-dark">وضع التطوير — الرمز: {devCode}</p> : null}
          <button className="btn-primary w-full" onClick={verify} disabled={busy || code.length !== 6}>
            دخول
          </button>
        </>
      )}
      {error ? <p className="text-red-700 text-sm font-bold">{error}</p> : null}
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
