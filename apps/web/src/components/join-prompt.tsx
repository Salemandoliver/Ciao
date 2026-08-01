"use client";
/**
 * The sign-up moment.
 *
 * It appears *after* a booking succeeds, never before. Asking someone to create
 * an account in order to book is how you lose the person who is booking on
 * behalf of their father and just wants the date held. Asking once the date is
 * already held is a different conversation: the work is done, and here is what
 * you get for keeping the relationship.
 *
 * It also dismisses permanently. A prompt that reappears every booking is an
 * advert, and this product's whole argument is that it doesn't behave like one.
 */
import { useEffect, useState } from "react";
import { ApiError, api, hasSession } from "@/lib/api";
import { trackClient } from "@/lib/tracker";
import { useLocale } from "@/lib/locale";
import { fmtNum } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

const DISMISS_KEY = "ciao_join_dismissed";

const copy = {
  ar: {
    joinFailed: "تعذر إنشاء العضوية",
    connectFailed: "تعذر الاتصال",
    welcome: "أهلًا بك في عضوية تشاو 🎉",
    earned: (points: string) => `كسبت ${points} نقطة. كودك للدعوات`,
    earnedTail: "— كل صديق يكمل أول حجز يكسبك نقاطًا أكثر.",
    openAccount: "افتح حسابك",
    title: "تحب نحفظ لك كل هذا؟",
    booked: "حجزك مؤكد. ",
    body: "العضوية مجانية: محفظة يدخلها أي استرجاع، نقاط على كل إقامة وتقييم، رسائل المضيفين محفوظة، ودخول ببصمتك بدل انتظار الرمز.",
    later: "لاحقًا",
    namePlaceholder: "اسمك (اختياري)",
    codePlaceholder: "كود دعوة (اختياري)",
    join: "أنشئ عضويتي",
    note: "الحجز لا يحتاج عضوية أبدًا — هذه إضافة، لا شرط.",
  },
  en: {
    joinFailed: "Could not create the membership",
    connectFailed: "Could not connect",
    welcome: "Welcome to Ciao membership 🎉",
    earned: (points: string) => `You earned ${points} points. Your invite code is`,
    earnedTail: "— every friend who completes a first booking earns you more.",
    openAccount: "Open your account",
    title: "Shall we keep all this for you?",
    booked: "Your booking is confirmed. ",
    body: "Membership is free: a wallet any refund goes into, points on every stay and review, host messages kept, and sign-in with your fingerprint instead of waiting for a code.",
    later: "Later",
    namePlaceholder: "Your name (optional)",
    codePlaceholder: "Invite code (optional)",
    join: "Create my membership",
    note: "Booking never needs a membership — this is an extra, not a requirement.",
  },
} satisfies Record<Locale, unknown>;

export function JoinPrompt({ bookingCode }: { bookingCode?: string }) {
  const locale = useLocale();
  const c = copy[locale];
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [done, setDone] = useState<{ points: number; referralCode: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!hasSession()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      /* private mode — showing once is fine */
    }
    // Already a member? The account call tells us without a second endpoint.
    api<{ displayName: string | null; loyalty: { points: number } }>("/v1/me/account")
      .then((a) => {
        if (!a.displayName) setShow(true);
      })
      .catch(() => {});
    // An invite code in the URL survives into the prompt so the friend who
    // shared it actually gets credited.
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref) setCode(ref.toUpperCase());
      else setCode(localStorage.getItem("ciao_ref") ?? "");
    } catch {
      /* ignore */
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  async function join() {
    setBusy(true);
    setErr("");
    try {
      const res = await api<{ pointsEarned: number; referralCode: string }>("/v1/me/join", {
        method: "POST",
        body: JSON.stringify({
          displayName: name || undefined,
          referralCode: code || undefined,
        }),
      });
      setDone({ points: res.pointsEarned, referralCode: res.referralCode });
      trackClient("account.joined", { withReferral: Boolean(code) });
    } catch (e) {
      setErr(e instanceof ApiError ? c.joinFailed : c.connectFailed);
    } finally {
      setBusy(false);
    }
  }

  if (!show) return null;

  if (done)
    return (
      <div className="card p-4 mt-4 bg-amber/15 ring-1 ring-amber">
        <h3 className="font-bold text-sea">{c.welcome}</h3>
        <p className="text-sm text-muted mt-1 leading-relaxed">
          {c.earned(fmtNum(locale, done.points))}{" "}
          <strong dir="ltr">{done.referralCode}</strong> {c.earnedTail}
        </p>
        <a href="/account" className="btn-primary !py-2 !text-sm inline-block mt-3">
          {c.openAccount}
        </a>
      </div>
    );

  return (
    <div className="card p-4 mt-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-sea">{c.title}</h3>
          <p className="text-sm text-muted mt-1 leading-relaxed">
            {bookingCode ? c.booked : ""}
            {c.body}
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label={c.later}
          className="w-7 h-7 rounded-full bg-sand text-sea font-bold shrink-0"
        >
          ✕
        </button>
      </div>

      {err ? <p className="text-sm text-danger font-bold mt-2">{err}</p> : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
        <input
          className="input !py-2 !text-sm"
          placeholder={c.namePlaceholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input !py-2 !text-sm"
          dir="ltr"
          placeholder={c.codePlaceholder}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button className="btn-primary !py-2 !text-sm" onClick={join} disabled={busy}>
          {busy ? "…" : c.join}
        </button>
        <button className="chip" onClick={dismiss}>
          {c.later}
        </button>
      </div>
      <p className="text-[11px] text-faint mt-2">{c.note}</p>
    </div>
  );
}
