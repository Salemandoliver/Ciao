"use client";
/**
 * Security — passkeys, and the honest framing of why.
 *
 * The pitch to a Libyan user is not "passwords are weak" (there are no
 * passwords) — it is that a code sent by message needs signal, costs us money,
 * and fails during the outages that happen here every week. A fingerprint works
 * with no network at all. That argument is made in the copy, because a security
 * feature nobody understands is a security feature nobody turns on.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AccountData } from "./page";

interface Passkey {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** A label the user will recognise later, without asking them to type one. */
function guessDeviceLabel(): string {
  if (typeof navigator === "undefined") return "جهاز";
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iPhone"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac/i.test(ua)
          ? "Mac"
          : "جهاز";
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
  const [items, setItems] = useState<Passkey[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Passkey[] }>("/v1/me/passkeys")).items);
    } catch {
      setMsg("تعذر تحميل مفاتيح الدخول");
    }
  }, []);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && Boolean(window.PublicKeyCredential));
    void load();
  }, [load]);

  async function addPasskey() {
    setBusy(true);
    setMsg("");
    try {
      // Loaded on demand: the WebAuthn browser helper has no business on the
      // critical path of a listing page over 3G.
      const { startRegistration } = await import("@simplewebauthn/browser");
      const options = await api<Record<string, unknown>>("/v1/me/passkeys/options", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const response = await startRegistration({ optionsJSON: options as never });
      await api("/v1/me/passkeys", {
        method: "POST",
        body: JSON.stringify({ response, deviceLabel: guessDeviceLabel() }),
      });
      setMsg("✅ فُعّل الدخول بالبصمة على هذا الجهاز");
      await load();
      await onChange();
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setMsg(
        name === "NotAllowedError"
          ? "أُلغيت العملية — جرّب مرة أخرى"
          : "تعذر تفعيل البصمة على هذا الجهاز",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("حذف مفتاح الدخول من هذا الجهاز؟")) return;
    await api(`/v1/me/passkeys/${id}`, { method: "DELETE" }).catch(() => {});
    await load();
    await onChange();
  }

  return (
    <div className="space-y-3">
      {msg ? <p className="text-sm font-bold text-sea">{msg}</p> : null}

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm">الدخول بالبصمة أو الوجه</h3>
        <p className="text-xs text-sea/70 mt-1 leading-relaxed">
          بدل انتظار رمز يصل برسالة: بصمتك محفوظة على جهازك وحده، ولا تغادره أبدًا — نحن نحتفظ
          بالجزء العلني منها فقط. تشتغل حتى وقت انقطاع الشبكة، وهي الطريقة الآمنة لحماية محفظتك.
        </p>
        {!supported ? (
          <p className="text-xs text-amber-dark font-bold mt-2">
            متصفحك لا يدعم هذه الميزة — جرّب من متصفح الهاتف.
          </p>
        ) : (
          <button
            className="btn-primary !py-2 !text-sm mt-3"
            onClick={addPasskey}
            disabled={busy}
          >
            {busy ? "…" : "فعّل على هذا الجهاز"}
          </button>
        )}
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm mb-2">
          الأجهزة المفعّلة ({data.passkeys})
        </h3>
        {items.length === 0 ? (
          <p className="text-sm text-sea/50">لا أجهزة بعد.</p>
        ) : (
          <ul className="divide-y divide-sand">
            {items.map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-sea truncate">
                    {p.deviceLabel ?? "جهاز"}
                  </div>
                  <div className="text-[11px] text-sea/50">
                    {p.lastUsedAt
                      ? `آخر استخدام ${new Date(p.lastUsedAt).toLocaleDateString("ar-LY")}`
                      : "لم يُستخدم بعد"}
                  </div>
                </div>
                <button className="chip !text-[11px] shrink-0" onClick={() => remove(p.id)}>
                  حذف
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm">رقمك هو هويتك</h3>
        <p className="text-xs text-sea/70 mt-1 leading-relaxed" dir="auto">
          حسابك مرتبط بالرقم <strong dir="ltr">{data.phone}</strong>. البصمة إضافة فوقه لا بديل
          عنه — أول إثبات لهويتك يبقى دائمًا عبر رقمك.
        </p>
      </div>
    </div>
  );
}
