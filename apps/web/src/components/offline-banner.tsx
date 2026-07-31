"use client";
import { useEffect, useState } from "react";

/** §12.2: no lying UIs — say plainly when we're offline. */
export function OfflineBanner() {
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
  return (
    <div className="offline-banner">
      لا يوجد اتصال — تعرض لك النسخة المحفوظة، وحجوزاتك بأمان على الخادم
    </div>
  );
}
