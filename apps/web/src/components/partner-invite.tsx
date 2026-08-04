"use client";
/**
 * «خلّ مكانك جزءاً من حكاياتهم» — the invitation to list a place, and the
 * fifteen-second form behind it.
 *
 * Supply is still acquired by agents in the field (§14.2). This is not a
 * self-serve listing route and must not grow into one: what it captures is a
 * name and a number, and everything after that is a phone call. The design
 * follows from that. A hall owner sees Ciao because a cousin forwarded a
 * listing into a family WhatsApp group, and the moment where she thinks "mine
 * is better than that" lasts about as long as it takes to scroll past. A form
 * asking for the venue name, the city, the capacity and four photographs
 * converts that moment into an abandoned form. Two fields does not.
 *
 * The phone is verified with a one-time code before anything is written. That
 * is a real cost — it turns one tap into three — and it is paid deliberately:
 * an ops queue where half the numbers are invented is a queue the team stops
 * opening, and a lead nobody rings is worse than a lead never captured. The
 * code also means the number in the queue is provably reachable, which is the
 * only property that matters when an agent is planning a morning of calls.
 *
 * Note what happens on a number that already left a lead: exactly the same
 * thing. The API updates the name and answers success either way, so this
 * screen cannot be used to find out who has already put their hand up.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { trackClient } from "@/lib/tracker";
import { useLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: {
    over: "عندك مكان يستاهل الناس تعرفه؟",
    head: "خلّ مكانك جزءاً من حكاياتهم",
    cta: "اعرض مكانك",
    title: "اعرض مكانك على تشاو",
    lede: "اترك اسمك ورقمك، ويتواصل معك فريق تشاو لترتيب زيارة وتصوير المكان. ما فيش رسوم على التسجيل.",
    name: "الاسم",
    namePlaceholder: "مثلًا محمد الفيتوري",
    phone: "رقم الهاتف",
    phonePlaceholder: "091 2345678",
    sendCode: "أرسل رمز التأكيد",
    codeLabel: "الرمز اللي وصلك",
    codeHint: (p: string) => `أرسلنا رمزًا من ٦ أرقام إلى ${p}`,
    confirm: "تأكيد وإرسال",
    back: "رجوع",
    demoCode: (code: string) => `رمز التجربة: ${code}`,
    sendFailed: "تعذّر إرسال الرمز. حاول مرة أخرى.",
    wrongCode: "الرمز غير صحيح أو انتهت صلاحيته.",
    doneHead: "وصلنا طلبك",
    doneBody: "يتواصل معك فريق تشاو خلال يومين عمل على نفس الرقم.",
    close: "إغلاق",
    why: "نطلب الرقم مرتين عشان نتأكد إنه يوصلك — الزيارة تترتب بمكالمة.",
  },
  en: {
    over: "Got a place people should know about?",
    head: "Make your place part of their stories",
    cta: "List your place",
    title: "List your place on Ciao",
    lede: "Leave your name and number and the Ciao team will call to arrange a visit and photograph the place. Listing costs nothing.",
    name: "Name",
    namePlaceholder: "e.g. Mohammed Elfituri",
    phone: "Phone number",
    phonePlaceholder: "091 2345678",
    sendCode: "Send confirmation code",
    codeLabel: "The code you received",
    codeHint: (p: string) => `We sent a 6-digit code to ${p}`,
    confirm: "Confirm and send",
    back: "Back",
    demoCode: (code: string) => `Demo code: ${code}`,
    sendFailed: "We couldn't send the code. Try again.",
    wrongCode: "That code is wrong or has expired.",
    doneHead: "We've got it",
    doneBody: "The Ciao team will call you on this number within two working days.",
    close: "Close",
    why: "We ask for the number twice so we know it reaches you — the visit gets arranged by phone.",
  },
} satisfies Record<Locale, unknown>;

/** Where the invitation was tapped, so we can tell which one earns its space. */
export type LeadSurface = "home" | "about" | "listing";

export function PartnerInvite({ surface = "home" }: { surface?: LeadSurface }) {
  const locale = useLocale();
  const c = copy[locale];
  const [open, setOpen] = useState(false);

  return (
    <>
      {/*
        A deep navy panel in BOTH themes — `bg-sea` is dark in light mode and
        re-points to a lighter navy in dark mode, but it is never light. So the
        type on it cannot follow `--ink`, exactly as with `.chip-on-photo` and
        the hero scrim: `--ink` is navy in the light theme, which put a navy
        headline on a navy panel and made it disappear entirely. Fixed cream,
        the same value the wordmark uses on dark ground.
      */}
      <section className="card p-6 sm:p-8 mt-6 bg-sea text-center sm:text-start">
        <div className="sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div>
            <p className="text-amber font-bold text-sm">{c.over}</p>
            <h2 className="font-bold text-2xl sm:text-3xl mt-1 text-[#f5eedd]">{c.head}</h2>
          </div>
          <button
            className="btn-amber mt-4 sm:mt-0 shrink-0 !py-2.5 !text-base"
            onClick={() => {
              trackClient("lead.opened", { surface });
              setOpen(true);
            }}
          >
            {c.cta} <span aria-hidden>↗</span>
          </button>
        </div>
      </section>
      {open ? <InviteDialog surface={surface} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function InviteDialog({ surface, onClose }: { surface: LeadSurface; onClose: () => void }) {
  const locale = useLocale();
  const c = copy[locale];
  const [stage, setStage] = useState<"details" | "code" | "done">("details");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  // Same modal discipline as the trust dialog: Escape closes, the page behind
  // does not scroll while this is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    firstField.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const ready = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 9;

  const request = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ devCode?: string }>("/v1/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      if (r.devCode) setDevCode(r.devCode);
      setStage("code");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : c.sendFailed);
    } finally {
      setBusy(false);
    }
  }, [phone, c.sendFailed]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await api("/v1/partner-leads", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), phone, code, surface, locale }),
      });
      setStage("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : c.wrongCode);
    } finally {
      setBusy(false);
    }
  }, [name, phone, code, surface, locale, c.wrongCode]);

  return (
    <div
      className="fixed inset-0 z-50 bg-sea-dark/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={c.title}
    >
      <div
        className="bg-surface w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-bubble shadow-xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {stage === "done" ? (
          <>
            <h2 className="font-bold text-xl text-sea">{c.doneHead}</h2>
            <p className="text-muted text-sm">{c.doneBody}</p>
            <button className="btn-primary w-full" onClick={onClose}>
              {c.close}
            </button>
          </>
        ) : (
          <>
            <h2 className="font-bold text-xl text-sea">{c.title}</h2>
            {stage === "details" ? (
              <>
                <p className="text-muted text-sm">{c.lede}</p>
                <label className="block text-xs font-bold text-muted">
                  {c.name}
                  <input
                    ref={firstField}
                    className="input mt-1"
                    placeholder={c.namePlaceholder}
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="block text-xs font-bold text-muted">
                  {c.phone}
                  {/* The local 09… form in both languages — this is the number
                      someone reads off to a taxi driver. */}
                  <input
                    dir="ltr"
                    inputMode="tel"
                    className="input mt-1 text-center"
                    placeholder={c.phonePlaceholder}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <p className="text-xs text-faint">{c.why}</p>
                <button
                  className="btn-primary w-full"
                  onClick={request}
                  disabled={busy || !ready}
                >
                  {c.sendCode}
                </button>
              </>
            ) : (
              <>
                <p className="text-muted text-sm">{c.codeHint(phone)}</p>
                <input
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  aria-label={c.codeLabel}
                  className="input text-center tracking-widest"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
                {devCode ? <p className="text-xs text-link">{c.demoCode(devCode)}</p> : null}
                <button
                  className="btn-primary w-full"
                  onClick={submit}
                  disabled={busy || code.length !== 6}
                >
                  {c.confirm}
                </button>
                <button
                  className="btn-secondary w-full !py-2 !text-base"
                  onClick={() => {
                    setStage("details");
                    setCode("");
                    setError("");
                  }}
                >
                  {c.back}
                </button>
              </>
            )}
            {error ? <p className="text-danger text-sm font-bold">{error}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
