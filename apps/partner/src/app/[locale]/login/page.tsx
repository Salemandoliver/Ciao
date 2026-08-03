"use client";
/**
 * Sign in.
 *
 * The whole app is behind this screen, so it is written for the least
 * favourable moment: a phone in bright sun, one hand, a slow connection, and
 * someone who has typed their password wrong twice.
 *
 * A few decisions that look small and are not.
 *
 * **The failure message never distinguishes a wrong number from a wrong
 * password.** The server refuses to tell them apart, and this screen must not
 * undo that by phrasing them differently — otherwise the form becomes a way of
 * asking which Libyan businesses are on Ciao.
 *
 * **There is no sign-up link,** because there is no sign-up. Businesses join
 * after a field visit and receive a link to choose a password. A "create
 * account" button here would be a promise the product does not keep, and the
 * screen says plainly what to do instead.
 *
 * **The password field can be revealed.** Hiding it by default is right;
 * refusing to ever show it means someone with a long password on a phone
 * keyboard simply cannot get in.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link, useLocale, useRouter } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { ApiError, api, ensureSession, setTokens } from "@/lib/api";

const copy = {
  ar: {
    brand: "تشاو للشركاء",
    tagline: "كل حجوزاتك في مكان واحد",
    phone: "رقم تلفونك",
    password: "كلمة السر",
    show: "أظهر",
    hide: "أخفِ",
    signIn: "دخول",
    signingIn: "جارٍ الدخول…",
    forgot: "نسيت كلمة السر؟",
    // One message for every wrong-credential case, on purpose.
    bad: "الرقم أو كلمة السر غير صحيحة.",
    locked: "حاولت مرات كثيرة. انتظر ربع ساعة، أو استعد كلمة السر.",
    offline: "ما قدرنا نتصل بالخادم — تأكد من الشبكة وأعد المحاولة.",
    noAccount: "ما عندك حساب؟",
    noAccountBody:
      "الحسابات تُفتح بعد زيارة فريق تشاو للمكان. كلّمنا وإحنا نسجّلك ونرسل لك رابط تختار منه كلمة سرّك.",
    checking: "لحظة…",
  },
  en: {
    brand: "Ciao Partners",
    tagline: "Your whole diary in one place",
    phone: "Your phone number",
    password: "Password",
    show: "Show",
    hide: "Hide",
    signIn: "Sign in",
    signingIn: "Signing in…",
    forgot: "Forgotten your password?",
    bad: "That number or password isn't right.",
    locked: "Too many attempts. Wait fifteen minutes, or reset your password.",
    offline: "We couldn't reach the server — check your connection and try again.",
    noAccount: "No account?",
    noAccountBody:
      "Accounts are opened after a Ciao agent has visited the place. Get in touch and we'll set you up and send a link to choose your own password.",
    checking: "One moment…",
  },
} satisfies Record<Locale, unknown>;

function LoginForm() {
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);

  // Someone already signed in who lands here — a bookmark, a shared link —
  // should go where they were going, not be asked to log in again.
  useEffect(() => {
    ensureSession()
      .then((ok) => (ok ? router.replace(next) : setChecking(false)))
      .catch(() => setChecking(false));
  }, [router, next]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      const res = await api<{
        accessToken: string;
        refreshToken: string;
        mustChangePassword: boolean;
      }>("/v1/partner/auth/login", {
        method: "POST",
        // No refresh attempt on a 401 here: a failed login is not an expired
        // session, and retrying would burn the rate limit twice as fast.
        retry: false,
        body: JSON.stringify({ phone, password }),
      });
      setTokens(res.accessToken, res.refreshToken);
      /*
       * A password ops issued is one somebody else knows, so `mustChange`
       * lands them on Security with the banner explaining why. Security is a
       * tab on the console, not a route of its own — sending them to
       * "/security" produced a 404, which is a poor first impression of a
       * product you have just been handed.
       *
       * Deliberately a landing and a banner rather than a hard block: refusing
       * a partner their Thursday-morning diary until they invent a password is
       * worse for them than the day of residual risk, and the residual risk is
       * bounded by ops having issued the password minutes earlier.
       */
      router.replace(res.mustChangePassword ? "/?tab=security&first=1" : next);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 429 || err.code.includes("4292") ? c.locked : c.bad);
      } else {
        setError(c.offline);
      }
      setBusy(false);
    }
  }

  if (checking) return <p className="p-6 text-faint">{c.checking}</p>;

  return (
    <main className="mx-auto max-w-sm px-4 pb-16">
      <header className="flex items-center justify-between py-6">
        <Logo />
        <LanguageToggle />
      </header>

      <div className="card p-6">
        <h1 className="text-xl font-extrabold text-sea">{c.brand}</h1>
        <p className="text-sm text-faint mb-5">{c.tagline}</p>

        <form onSubmit={submit}>
          <label className="block text-sm">
            <span className="text-xs font-bold text-muted">{c.phone}</span>
            <input
              className="input mt-1"
              dir="ltr"
              inputMode="tel"
              autoComplete="username"
              name="username"
              placeholder="0912345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>

          <label className="block text-sm mt-3">
            <span className="text-xs font-bold text-muted">{c.password}</span>
            <span className="relative block mt-1">
              <input
                className="input"
                dir="ltr"
                type={reveal ? "text" : "password"}
                autoComplete="current-password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                className="absolute inset-y-0 end-3 my-auto h-6 text-xs font-bold text-link underline"
              >
                {reveal ? c.hide : c.show}
              </button>
            </span>
          </label>

          {error ? (
            <p
              className="mt-3 text-sm font-bold text-[color:rgb(var(--danger))]"
              role="alert"
              aria-live="polite"
            >
              {error}
            </p>
          ) : null}

          <button className="btn-primary w-full mt-5" disabled={busy} type="submit">
            {busy ? c.signingIn : c.signIn}
          </button>
        </form>

        <p className="text-center mt-4">
          <Link href="/forgot" className="text-sm text-link font-bold underline">
            {c.forgot}
          </Link>
        </p>
      </div>

      <div className="card p-5 mt-4">
        <p className="font-bold text-sea text-sm">{c.noAccount}</p>
        <p className="text-sm text-faint mt-1">{c.noAccountBody}</p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="p-6 text-faint">…</p>}>
      <LoginForm />
    </Suspense>
  );
}
