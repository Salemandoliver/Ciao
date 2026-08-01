"use client";
/**
 * The inbox.
 *
 * WhatsApp is still how people here actually get told things — this is not a
 * replacement for it. What the inbox adds is a durable record: the message that
 * survives a wiped phone, a changed SIM, or a dispute six weeks later where
 * what was promised at the door is exactly what's in question (§11.6).
 *
 * Pre-deposit, phone numbers and links are stripped server-side (§8.7). The UI
 * says so rather than letting it look like a glitch.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { fmtDateTime, fmtNum } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: {
    loading: "جارٍ التحميل…",
    loadFailed: "تعذر تحميل الرسائل",
    markAllRead: (n: string) => `تعليم الكل كمقروء (${n})`,
    emptyTitle: "لا رسائل بعد",
    emptyBody:
      "هنا تصلك رسائل المضيفين ومزوّدي الخدمات وفريق تشاو. التأكيدات المهمة تصلك أيضًا على واتساب — هذه نسخة محفوظة لا تضيع لو تغيّر هاتفك.",
    masked: "الأرقام والروابط مخفية إلى أن يُدفع العربون — حمايةً للطرفين.",
  },
  en: {
    loading: "Loading…",
    loadFailed: "Could not load your messages",
    markAllRead: (n: string) => `Mark all as read (${n})`,
    emptyTitle: "No messages yet",
    emptyBody:
      "This is where messages from hosts, service providers and the Ciao team arrive. The important confirmations also reach you on WhatsApp — this is the saved copy that survives a change of phone.",
    masked: "Numbers and links stay hidden until the deposit is paid — it protects both sides.",
  },
} satisfies Record<Locale, unknown>;

interface Inbox {
  unread: number;
  items: {
    id: string;
    body: string;
    kind: string;
    from: string;
    bookingCode: string | null;
    read: boolean;
    at: string;
  }[];
}

export function InboxTab({ onRead }: { onRead: () => void | Promise<void> }) {
  const locale = useLocale();
  const c = copy[locale];
  const [data, setData] = useState<Inbox | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Inbox>("/v1/me/messages"));
    } catch {
      setErr(c.loadFailed);
    }
  }, [c]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAllRead() {
    await api("/v1/me/messages/read", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
    await load();
    await onRead();
  }

  if (err) return <p className="p-4 text-danger font-bold">{err}</p>;
  if (!data) return <p className="p-4 text-faint">{c.loading}</p>;

  return (
    <div className="space-y-3">
      {data.unread ? (
        <button className="chip" onClick={markAllRead}>
          {c.markAllRead(fmtNum(locale, data.unread))}
        </button>
      ) : null}

      {data.items.length === 0 ? (
        <div className="card p-5 text-center">
          <p className="font-bold text-sea text-sm">{c.emptyTitle}</p>
          <p className="text-xs text-faint mt-1 leading-relaxed">{c.emptyBody}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {data.items.map((m) => (
            <li
              key={m.id}
              className={`card p-3 ${m.read ? "" : "ring-1 ring-amber"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sea text-sm">{m.from}</span>
                <span className="text-[11px] text-faint" dir="ltr">
                  {fmtDateTime(locale, m.at)}
                </span>
              </div>
              {m.bookingCode ? (
                <span className="chip !text-[11px] !py-0 mt-1" dir="ltr">
                  {m.bookingCode}
                </span>
              ) : null}
              {/* `dir="auto"` because a host writes in Arabic whatever
                  language the reader has chosen — and a mis-ordered address
                  is the one that gets you lost. */}
              <p
                className="text-sm text-sea/80 mt-1.5 leading-relaxed whitespace-pre-wrap"
                dir="auto"
              >
                {m.body}
              </p>
              {m.body.includes("•••") ? (
                <p className="text-[11px] text-faint mt-1">{c.masked}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
