"use client";
/**
 * Security — passkeys, and the honest framing of why.
 *
 * The pitch to a Libyan user is not "passwords are weak" (there are no
 * passwords) — it is that a code sent by message needs signal, costs us money,
 * and fails during the outages that happen here every week. A fingerprint works
 * with no network at all. That argument is made in the copy, because a security
 * feature nobody understands is a security feature nobody turns on.
 *
 * The word is "passkey" and "fingerprint" in both languages. "WebAuthn" is the
 * name of a specification, not of a thing a person does with their thumb.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { fmtDate } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import type { AccountData } from "./page";

interface Passkey {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

const copy = {
  ar: {
    device: "جهاز",
    loadFailed: "تعذر تحميل مفاتيح الدخول",
    added: "✅ فُعّل الدخول بالبصمة على هذا الجهاز",
    cancelled: "أُلغيت العملية — جرّب مرة أخرى",
    addFailed: "تعذر تفعيل البصمة على هذا الجهاز",
    confirmRemove: "حذف مفتاح الدخول من هذا الجهاز؟",
    title: "الدخول بالبصمة أو الوجه",
    body: "بدل انتظار رمز يصل برسالة: بصمتك محفوظة على جهازك وحده، ولا تغادره أبدًا — نحن نحتفظ بالجزء العلني منها فقط. تشتغل حتى وقت انقطاع الشبكة، وهي الطريقة الآمنة لحماية محفظتك.",
    unsupported: "متصفحك لا يدعم هذه الميزة — جرّب من متصفح الهاتف.",
    enable: "فعّل على هذا الجهاز",
    devices: (n: string) => `الأجهزة المفعّلة (${n})`,
    noDevices: "لا أجهزة بعد.",
    lastUsed: (when: string) => `آخر استخدام ${when}`,
    neverUsed: "لم يُستخدم بعد",
    remove: "حذف",
    phoneTitle: "رقمك هو هويتك",
  },
  en: {
    device: "Device",
    loadFailed: "Could not load your passkeys",
    added: "✅ Fingerprint sign-in is on for this device",
    cancelled: "Cancelled — try again",
    addFailed: "Could not set up a passkey on this device",
    confirmRemove: "Remove the passkey from this device?",
    title: "Sign in with your fingerprint or face",
    body: "Instead of waiting for a code by message: your fingerprint stays on your device alone and never leaves it — we hold only the public half of it. It works during a network outage, and it is the safer way to protect your wallet.",
    unsupported: "Your browser does not support this — try your phone's browser.",
    enable: "Turn it on for this device",
    devices: (n: string) => `Devices set up (${n})`,
    noDevices: "No devices yet.",
    lastUsed: (when: string) => `Last used ${when}`,
    neverUsed: "Not used yet",
    remove: "Remove",
    phoneTitle: "Your number is your identity",
  },
} satisfies Record<Locale, unknown>;

/** A label the user will recognise later, without asking them to type one. */
function guessDeviceLabel(fallback: string): string {
  if (typeof navigator === "undefined") return fallback;
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iPhone"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac/i.test(ua)
          ? "Mac"
          : fallback;
  const browser = /Chrome/i.test(ua)
    ? "Chrome"
    : /Safari/i.test(ua)
      ? "Safari"
      : /Firefox/i.test(ua)
        ? "Firefox"
        : "";
  return [os, browser].filter(Boolean).join(" · ");
}

export function SecurityTab({
  data,
  onChange,
}: {
  data: AccountData;
  onChange: () => void | Promise<void>;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const [items, setItems] = useState<Passkey[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Passkey[] }>("/v1/me/passkeys")).items);
    } catch {
      setMsg(c.loadFailed);
    }
  }, [c]);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && Boolean(window.PublicKeyCredential));
    void load();
  }, [load]);

  async function addPasskey() {
    setBusy(true);
    setMsg("");
    try {
      // Loaded on demand: the passkey browser helper has no business on the
      // critical path of a listing page over 3G.
      const { startRegistration } = await import("@simplewebauthn/browser");
      const options = await api<Record<string, unknown>>("/v1/me/passkeys/options", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const response = await startRegistration({ optionsJSON: options as never });
      await api("/v1/me/passkeys", {
        method: "POST",
        body: JSON.stringify({ response, deviceLabel: guessDeviceLabel(c.device) }),
      });
      setMsg(c.added);
      await load();
      await onChange();
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setMsg(name === "NotAllowedError" ? c.cancelled : c.addFailed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(c.confirmRemove)) return;
    await api(`/v1/me/passkeys/${id}`, { method: "DELETE" }).catch(() => {});
    await load();
    await onChange();
  }

  return (
    <div className="space-y-3">
      {msg ? <p className="text-sm font-bold text-sea">{msg}</p> : null}

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm">{c.title}</h3>
        <p className="text-xs text-muted mt-1 leading-relaxed">{c.body}</p>
        {!supported ? (
          <p className="text-xs text-link font-bold mt-2">{c.unsupported}</p>
        ) : (
          <button
            className="btn-primary !py-2 !text-sm mt-3"
            onClick={addPasskey}
            disabled={busy}
          >
            {busy ? "…" : c.enable}
          </button>
        )}
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm mb-2">{c.devices(String(data.passkeys))}</h3>
        {items.length === 0 ? (
          <p className="text-sm text-faint">{c.noDevices}</p>
        ) : (
          <ul className="divide-y divide-sand">
            {items.map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-sea truncate">
                    {p.deviceLabel ?? c.device}
                  </div>
                  <div className="text-[11px] text-faint">
                    {p.lastUsedAt
                      ? c.lastUsed(
                          fmtDate(locale, p.lastUsedAt, {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          }),
                        )
                      : c.neverUsed}
                  </div>
                </div>
                <button className="chip !text-[11px] shrink-0" onClick={() => remove(p.id)}>
                  {c.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm">{c.phoneTitle}</h3>
        {/* The number is interpolated mid-sentence, so each language builds
            the sentence around it rather than around a translated fragment. */}
        <p className="text-xs text-muted mt-1 leading-relaxed" dir="auto">
          {locale === "en" ? (
            <>
              Your account is tied to <strong dir="ltr">{data.phone}</strong>. A passkey sits on
              top of that, it does not replace it — your number is always the first proof of who
              you are.
            </>
          ) : (
            <>
              حسابك مرتبط بالرقم <strong dir="ltr">{data.phone}</strong>. البصمة إضافة فوقه لا بديل
              عنه — أول إثبات لهويتك يبقى دائمًا عبر رقمك.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
