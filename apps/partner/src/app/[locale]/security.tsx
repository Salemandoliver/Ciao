"use client";
/**
 * Security — the partner's own controls over their account.
 *
 * Two things live here and both are for the same moment: the one where
 * somebody thinks their password has got out. Changing it and signing every
 * device out are the two actions that actually help, so they are on one screen
 * and neither is buried.
 *
 * The device list is the part people underestimate. "Chrome on Android, last
 * seen yesterday, Tripoli" is how an owner notices the phone their former
 * receptionist still has — a thing that happens constantly in this market and
 * that no policy document catches.
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ApiError, api, setTokens, storedRefresh } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { fmtDate } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Pill, Section } from "@/components/panel";

interface Session {
  id: string;
  deviceLabel: string | null;
  ip: string | null;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
}

const copy = {
  ar: {
    firstTitle: "غيّر كلمة السر قبل ما تكمّل",
    firstBody:
      "كلمة السر الحالية أعطاك إياها فريق تشاو، يعني أحد غيرك يعرفها. اختر واحدة تخصّك.",
    changeTitle: "كلمة السر",
    current: "كلمة السر الحالية",
    next: "كلمة السر الجديدة",
    again: "أعدها مرة ثانية",
    show: "أظهر",
    hide: "أخفِ",
    rule: "١٠ حروف أو أكثر. الطول أهم من الرموز.",
    mismatch: "الكلمتان غير متطابقتين.",
    save: "احفظ",
    saving: "جارٍ الحفظ…",
    changed: "تم تغيير كلمة السر، وسجّلنا خروج كل الأجهزة الثانية.",
    wrongCurrent: "كلمة السر الحالية غير صحيحة.",
    devicesTitle: "الأجهزة الداخلة بحسابك",
    devicesHint:
      "إن شفت جهازًا ما تعرفه، أخرجه فورًا وغيّر كلمة السر. ولا تنسَ الأجهزة اللي كانت مع موظفين تركوا الشغل.",
    thisDevice: "هذا الجهاز",
    lastSeen: (d: string) => `آخر استعمال ${d}`,
    signOutOne: "أخرجه",
    signOutAll: "سجّل خروج كل الأجهزة",
    signedOutAll: (n: number) => `تم إخراج ${n} جهاز — أعد الدخول من جديد.`,
    confirmAll: "هذا يخرجك أنت كمان من كل الأجهزة. تكمّل؟",
    none: "ما في أجهزة أخرى.",
    failed: "تعذر التنفيذ.",
  },
  en: {
    firstTitle: "Change your password before you go on",
    firstBody:
      "Your current password was issued by the Ciao team, which means somebody other than you knows it. Choose one that's yours.",
    changeTitle: "Password",
    current: "Current password",
    next: "New password",
    again: "Type it again",
    show: "Show",
    hide: "Hide",
    rule: "10 characters or more. Length beats symbols.",
    mismatch: "Those two don't match.",
    save: "Save",
    saving: "Saving…",
    changed: "Password changed, and every other device has been signed out.",
    wrongCurrent: "That current password isn't right.",
    devicesTitle: "Devices signed in",
    devicesHint:
      "If you see a device you don't recognise, sign it out now and change your password. Don't forget devices that belonged to staff who have left.",
    thisDevice: "This device",
    lastSeen: (d: string) => `Last used ${d}`,
    signOutOne: "Sign out",
    signOutAll: "Sign out all devices",
    signedOutAll: (n: number) => `Signed out ${n} device(s) — please sign in again.`,
    confirmAll: "This signs you out on this device too. Continue?",
    none: "No other devices.",
    failed: "Could not do that.",
  },
} satisfies Record<Locale, unknown>;

export function SecurityTab({ onSignedOut }: { onSignedOut: () => void }) {
  const locale = useLocale();
  const c = copy[locale];
  const params = useSearchParams();
  const first = params.get("first") === "1";

  const [sessions, setSessions] = useState<Session[]>([]);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const refresh = storedRefresh();
      const res = await api<{ items: Session[] }>(
        `/v1/partner/auth/sessions${refresh ? `?current=${encodeURIComponent(refresh)}` : ""}`,
      );
      setSessions(res.items);
    } catch {
      /* the device list is informational; its failure must not block the
         password form, which is the part that matters in an emergency */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (next !== again) return setError(c.mismatch);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await api<{ accessToken: string; refreshToken: string }>(
        "/v1/partner/auth/change-password",
        { method: "POST", body: JSON.stringify({ current, next }) },
      );
      // Changing a password revokes every session including this one, so the
      // server hands back a fresh pair — being logged out for doing the right
      // thing is how people stop doing it.
      setTokens(res.accessToken, res.refreshToken);
      setMessage(c.changed);
      setCurrent("");
      setNext("");
      setAgain("");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        const d = err.detail as { ar?: string; en?: string };
        setError((locale === "en" ? d.en : d.ar) ?? c.wrongCurrent);
      } else {
        setError(c.failed);
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api(`/v1/partner/auth/sessions/${id}`, { method: "DELETE" });
      await load();
    } catch {
      setError(c.failed);
    }
  }

  async function revokeAll() {
    if (!window.confirm(c.confirmAll)) return;
    setBusy(true);
    try {
      const res = await api<{ count: number }>("/v1/partner/auth/sessions/revoke-all", {
        method: "POST",
        body: "{}",
      });
      setMessage(c.signedOutAll(res.count));
      onSignedOut();
    } catch {
      setError(c.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {first ? (
        <div className="card p-4 tone-warn">
          <p className="font-bold text-sea">{c.firstTitle}</p>
          <p className="text-sm text-muted mt-1">{c.firstBody}</p>
        </div>
      ) : null}

      <Section title={c.changeTitle} hint={c.rule}>
        <form onSubmit={changePassword} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className="text-xs font-bold text-muted">{c.current}</span>
            <span className="relative block mt-1">
              <input
                className="input !py-2 !text-sm"
                dir="ltr"
                type={reveal ? "text" : "password"}
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                className="absolute inset-y-0 end-3 my-auto h-5 text-xs font-bold text-link underline"
              >
                {reveal ? c.hide : c.show}
              </button>
            </span>
          </label>
          <label className="text-sm">
            <span className="text-xs font-bold text-muted">{c.next}</span>
            <input
              className="input !py-2 !text-sm mt-1"
              dir="ltr"
              type={reveal ? "text" : "password"}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="text-xs font-bold text-muted">{c.again}</span>
            <input
              className="input !py-2 !text-sm mt-1"
              dir="ltr"
              type={reveal ? "text" : "password"}
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </label>
          <div className="sm:col-span-2">
            <button
              className="btn-primary !py-2 !px-5 !text-sm"
              disabled={busy || !current || next.length < 10}
            >
              {busy ? c.saving : c.save}
            </button>
          </div>
        </form>
      </Section>

      <Section
        title={c.devicesTitle}
        hint={c.devicesHint}
        action={
          <button
            className="text-[11px] font-bold text-[color:rgb(var(--danger))] underline"
            disabled={busy}
            onClick={() => void revokeAll()}
          >
            {c.signOutAll}
          </button>
        }
      >
        {sessions.length === 0 ? (
          <p className="text-sm text-faint">{c.none}</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="rounded-2xl bg-sand p-3 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="font-bold text-sea text-sm">
                    {s.deviceLabel ?? "—"}{" "}
                    {s.current ? <Pill tone="green">{c.thisDevice}</Pill> : null}
                  </p>
                  <p className="text-[11px] text-muted">
                    {c.lastSeen(
                      fmtDate(locale, s.lastSeenAt, {
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      }),
                    )}
                    {s.ip ? ` · ${s.ip}` : ""}
                  </p>
                </div>
                {!s.current ? (
                  <button
                    className="text-xs underline text-faint shrink-0"
                    onClick={() => void revoke(s.id)}
                  >
                    {c.signOutOne}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {message ? <p className="card p-3 mt-3 text-sm font-bold text-sea">{message}</p> : null}
      {error ? (
        <p className="card p-3 mt-3 text-sm font-bold text-[color:rgb(var(--danger))]">{error}</p>
      ) : null}
    </>
  );
}
