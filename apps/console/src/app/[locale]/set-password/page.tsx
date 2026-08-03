"use client";
/**
 * Choose a password.
 *
 * Reached from a one-time link — either the welcome message after a field
 * visit, or the last step of a reset. It is the only way a partner account
 * gains a password; nobody at Ciao ever sets or sees one.
 *
 * The strength guidance is length-first and says why. A rule demanding a
 * capital, a digit and a symbol produces `Password1!` and a note stuck to the
 * monitor; ten characters of anything is meaningfully harder to grind, and
 * that is the honest thing to tell someone.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link, useLocale, useRouter } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { ApiError, api } from "@/lib/api";

const copy = {
  ar: {
    title: "اختر كلمة سرّك",
    lead: "هذي كلمة سرّك أنت — ما نعرفها ولا أحد في تشاو يقدر يشوفها.",
    password: "كلمة السر",
    confirm: "أعدها مرة ثانية",
    show: "أظهر",
    hide: "أخفِ",
    rule: "١٠ حروف أو أكثر. الطول أهم من الرموز — «شاليه_جنزور_٢٠٢٦» أقوى من «P@ss1».",
    mismatch: "الكلمتان غير متطابقتين.",
    save: "احفظ وادخل",
    saving: "جارٍ الحفظ…",
    doneTitle: "تمت — كلمة سرّك جاهزة",
    doneBody: "ادخل الحين برقم تلفونك وكلمة السر الجديدة.",
    goLogin: "الدخول",
    invalidTitle: "الرابط ما عاد صالح",
    invalidBody:
      "روابط اختيار كلمة السر تُستعمل مرة واحدة وتنتهي بعد مدة. اطلب رابطًا جديدًا من «نسيت كلمة السر»، أو كلّم فريق تشاو.",
    forgot: "استعادة كلمة السر",
    checking: "لحظة…",
    failed: "تعذر الحفظ — أعد المحاولة.",
    weak: "كلمة السر ضعيفة",
    strengthWeak: "ضعيفة",
    strengthOk: "مقبولة",
    strengthGood: "قوية",
  },
  en: {
    title: "Choose your password",
    lead: "This is yours — we never see it, and nobody at Ciao can look it up.",
    password: "Password",
    confirm: "Type it again",
    show: "Show",
    hide: "Hide",
    rule: "10 characters or more. Length beats symbols — \"janzour_chalet_2026\" is stronger than \"P@ss1\".",
    mismatch: "Those two don't match.",
    save: "Save and sign in",
    saving: "Saving…",
    doneTitle: "Done — your password is set",
    doneBody: "Sign in now with your phone number and your new password.",
    goLogin: "Sign in",
    invalidTitle: "This link is no longer valid",
    invalidBody:
      "Set-password links work once and expire. Ask for a new one from \"Forgotten your password\", or talk to the Ciao team.",
    forgot: "Reset your password",
    checking: "One moment…",
    failed: "Couldn't save that — please try again.",
    weak: "That password is too weak",
    strengthWeak: "Weak",
    strengthOk: "Fine",
    strengthGood: "Strong",
  },
} satisfies Record<Locale, unknown>;

/**
 * A three-step meter, not a score out of a hundred.
 *
 * The precision of a percentage is a lie — nothing here knows how guessable a
 * particular phrase is — and the only decision it informs is "is this long
 * enough to keep". Three states is the honest resolution.
 */
function strength(pw: string): 0 | 1 | 2 {
  if (pw.length < 10) return 0;
  if (pw.length >= 16 || /\s/.test(pw)) return 2;
  return 1;
}

function SetPasswordForm() {
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [state, setState] = useState<"checking" | "ready" | "invalid" | "done">("checking");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const check = useCallback(async () => {
    if (!token) return setState("invalid");
    try {
      const res = await api<{ valid: boolean }>(
        `/v1/biz/auth/set-password/check?token=${encodeURIComponent(token)}`,
        { retry: false },
      );
      setState(res.valid ? "ready" : "invalid");
    } catch {
      setState("invalid");
    }
  }, [token]);

  useEffect(() => {
    void check();
  }, [check]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) return setError(c.mismatch);
    setBusy(true);
    setError("");
    try {
      await api("/v1/biz/auth/set-password", {
        method: "POST",
        retry: false,
        body: JSON.stringify({ token, password }),
      });
      setState("done");
    } catch (err) {
      // The server explains a weak password in the reader's language; that
      // sentence is far more useful than a generic refusal, so it wins.
      if (err instanceof ApiError) {
        const d = err.detail as { ar?: string; en?: string };
        setError((locale === "en" ? d.en : d.ar) ?? c.failed);
      } else {
        setError(c.failed);
      }
      setBusy(false);
    }
  }

  const s = strength(password);

  return (
    <main className="mx-auto max-w-sm px-4 pb-16">
      <header className="flex items-center justify-between py-6">
        <Logo />
        <LanguageToggle />
      </header>

      {state === "checking" ? (
        <p className="p-4 text-faint">{c.checking}</p>
      ) : state === "invalid" ? (
        <div className="card p-6">
          <p className="font-bold text-sea">{c.invalidTitle}</p>
          <p className="text-sm text-faint mt-2">{c.invalidBody}</p>
          <Link href="/forgot" className="btn-primary !py-2 !text-sm inline-block mt-4">
            {c.forgot}
          </Link>
        </div>
      ) : state === "done" ? (
        <div className="card p-6 tone-good">
          <p className="font-bold text-sea">{c.doneTitle}</p>
          <p className="text-sm text-muted mt-2">{c.doneBody}</p>
          <button
            className="btn-primary !py-2 !text-sm mt-4"
            onClick={() => router.replace("/login")}
          >
            {c.goLogin}
          </button>
        </div>
      ) : (
        <div className="card p-6">
          <h1 className="text-lg font-extrabold text-sea">{c.title}</h1>
          <p className="text-sm text-faint mt-1">{c.lead}</p>

          <form onSubmit={submit} className="mt-4">
            <label className="block text-sm">
              <span className="text-xs font-bold text-muted">{c.password}</span>
              <span className="relative block mt-1">
                <input
                  className="input"
                  dir="ltr"
                  type={reveal ? "text" : "password"}
                  autoComplete="new-password"
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

            {/* The meter carries a word as well as a colour — a bar alone is
                invisible in sunlight on a cheap screen. */}
            <div className="flex items-center gap-2 mt-2">
              <span className="flex-1 h-1.5 rounded-full bg-sand overflow-hidden">
                <span
                  className={`block h-full rounded-full transition-all ${
                    s === 0 ? "w-1/3 bg-danger" : s === 1 ? "w-2/3 bg-amber" : "w-full bg-success"
                  }`}
                />
              </span>
              <span className="text-[11px] font-bold text-muted w-14 text-end">
                {password
                  ? s === 0
                    ? c.strengthWeak
                    : s === 1
                      ? c.strengthOk
                      : c.strengthGood
                  : ""}
              </span>
            </div>
            <p className="text-[11px] text-faint mt-1">{c.rule}</p>

            <label className="block text-sm mt-3">
              <span className="text-xs font-bold text-muted">{c.confirm}</span>
              <input
                className="input mt-1"
                dir="ltr"
                type={reveal ? "text" : "password"}
                autoComplete="new-password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
              />
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

            <button
              className="btn-primary w-full mt-5"
              disabled={busy || password.length < 10 || !again}
              type="submit"
            >
              {busy ? c.saving : c.save}
            </button>
          </form>
        </div>
      )}
    </main>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<p className="p-6 text-faint">…</p>}>
      <SetPasswordForm />
    </Suspense>
  );
}
