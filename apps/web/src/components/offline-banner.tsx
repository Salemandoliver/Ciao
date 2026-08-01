"use client";
import { useEffect, useState } from "react";
import { useLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: { offline: "لا يوجد اتصال — تعرض لك النسخة المحفوظة، وحجوزاتك بأمان على الخادم" },
  en: {
    offline:
      "No connection — you are seeing the saved copy, and your bookings are safe on the server",
  },
} satisfies Record<Locale, unknown>;

/** §12.2: no lying UIs — say plainly when we're offline. */
export function OfflineBanner() {
  const c = copy[useLocale()];
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return <div className="offline-banner">{c.offline}</div>;
}
