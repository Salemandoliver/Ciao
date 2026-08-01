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
  const [data, setData] = useState<Inbox | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Inbox>("/v1/me/messages"));
    } catch {
      setErr("تعذر تحميل الرسائل");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAllRead() {
    await api("/v1/me/messages/read", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
    await load();
    await onRead();
  }

  if (err) return <p className="p-4 text-red-700 font-bold">{err}</p>;
  if (!data) return <p className="p-4 text-sea/60">جارٍ التحميل…</p>;

  return (
    <div className="space-y-3">
      {data.unread ? (
        <button className="chip" onClick={markAllRead}>
          تعليم الكل كمقروء ({data.unread})
        </button>
      ) : null}

      {data.items.length === 0 ? (
        <div className="card p-5 text-center">
          <p className="font-bold text-sea text-sm">لا رسائل بعد</p>
          <p className="text-xs text-sea/60 mt-1 leading-relaxed">
            هنا تصلك رسائل المضيفين ومزوّدي الخدمات وفريق تشاو. التأكيدات المهمة تصلك أيضًا على
            واتساب — هذه نسخة محفوظة لا تضيع لو تغيّر هاتفك.
          </p>
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
                <span className="text-[11px] text-sea/50" dir="ltr">
                  {new Date(m.at).toLocaleString("ar-LY")}
                </span>
              </div>
              {m.bookingCode ? (
                <span className="chip !text-[11px] !py-0 mt-1" dir="ltr">
                  {m.bookingCode}
                </span>
              ) : null}
              <p className="text-sm text-sea/80 mt-1.5 leading-relaxed whitespace-pre-wrap">
                {m.body}
              </p>
              {m.body.includes("•••") ? (
                <p className="text-[11px] text-sea/45 mt-1">
                  الأرقام والروابط مخفية إلى أن يُدفع العربون — حمايةً للطرفين.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
