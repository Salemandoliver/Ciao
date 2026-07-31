"use client";
/**
 * Host PWA — §8.3 MVP: bookings + confirm/decline, calendar blocks,
 * payout statement, reliability coaching.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/logo";
import { api, ensureSession, fmtLyd, ApiError } from "@/lib/api";

interface HostBooking {
  id: string;
  code: string;
  state: string;
  checkIn?: string;
  checkOut?: string;
  payoutAmount: number;
  balanceOnArrival: number;
  confirmationDeadline?: string;
}
interface HostListing { id: string; titleAr: string; status: string; verified: boolean }
interface Payout { id: string; amount: number; status: string; releaseAfter: string }

export default function HostDashboard() {
  const router = useRouter();
  const [bookings, setBookings] = useState<HostBooking[]>([]);
  const [listings, setListings] = useState<HostListing[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [reliability, setReliability] = useState<{ score: number; coaching: string } | null>(null);
  const [blockInput, setBlockInput] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [b, l, p, r] = await Promise.all([
      api<{ items: HostBooking[] }>("/v1/host/bookings"),
      api<{ items: HostListing[] }>("/v1/host/listings"),
      api<{ items: Payout[] }>("/v1/host/payouts"),
      api<{ score: number; coaching: string }>("/v1/host/reliability"),
    ]);
    setBookings(b.items);
    setListings(l.items);
    setPayouts(p.items);
    setReliability(r);
  }, []);

  useEffect(() => {
    ensureSession().then((ok) => {
      if (!ok) return router.push("/login?next=/host");
      load().catch(() => setMsg("تعذر التحميل"));
    });
  }, [router, load]);

  async function respond(id: string, decision: "confirm" | "decline") {
    try {
      await api(`/v1/bookings/${id}/host-response`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "تعذر التنفيذ");
    }
  }

  async function checkin(id: string) {
    try {
      await api(`/v1/bookings/${id}/checkin`, { method: "POST", body: "{}" });
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "تعذر التنفيذ");
    }
  }

  async function block(listingId: string) {
    const days = (blockInput[listingId] ?? "")
      .split(/[,\s]+/)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (days.length === 0) return setMsg("أدخل تواريخ بصيغة 2026-08-15");
    await api(`/v1/host/listings/${listingId}/block`, {
      method: "POST",
      body: JSON.stringify({ days, action: "block" }),
    });
    setMsg(`تم حجب ${days.length} يوم`);
  }

  const pending = bookings.filter((b) => b.state === "payment_held");

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/"><Logo size={36} /></Link>
        {reliability ? (
          <span className="chip">⭐ موثوقيتك: {reliability.score}/100</span>
        ) : null}
      </header>

      {reliability ? (
        <p className="text-sm text-sea/70 mb-4">{reliability.coaching}</p>
      ) : null}
      {msg ? <p className="card p-3 mb-4 text-sm font-bold text-sea">{msg}</p> : null}

      {pending.length > 0 ? (
        <section className="mb-6">
          <h2 className="font-bold text-lg text-amber-dark mb-2">
            ⏰ طلبات تنتظر ردّك ({pending.length})
          </h2>
          {pending.map((b) => (
            <div key={b.id} className="card p-4 mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="font-inter font-bold" dir="ltr">{b.code}</p>
                <p className="text-sm text-sea/70">{b.checkIn} → {b.checkOut}</p>
                <p className="text-sm font-bold text-sea">
                  حصتك من العربون: {fmtLyd(b.payoutAmount)} + {fmtLyd(b.balanceOnArrival)} نقدًا
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <button className="btn-primary !py-2 !px-4 text-sm" onClick={() => respond(b.id, "confirm")}>
                  أكّد
                </button>
                <button className="text-sm text-sea/60 underline" onClick={() => respond(b.id, "decline")}>
                  ارفض
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="font-bold text-lg text-sea mb-2">حجوزاتك</h2>
        {bookings.length === 0 ? (
          <p className="text-sea/60 text-sm">لا حجوزات بعد.</p>
        ) : (
          <ul className="space-y-2">
            {bookings.map((b) => (
              <li key={b.id} className="card p-3 flex justify-between items-center text-sm">
                <span className="font-inter font-bold" dir="ltr">{b.code}</span>
                <span>{b.checkIn}</span>
                <span className="chip">{b.state}</span>
                {["confirmed", "pre_arrival_reconfirmed"].includes(b.state) ? (
                  <button className="underline text-sea font-bold" onClick={() => checkin(b.id)}>
                    وصل الضيف ✓
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <h2 className="font-bold text-lg text-sea mb-2">تقويمك — احجب أيامك المحجوزة خارج تشاو</h2>
        {listings.map((l) => (
          <div key={l.id} className="card p-3 mb-2">
            <p className="font-bold text-sm mb-2">
              {l.titleAr} {l.verified ? "✓" : ""}
            </p>
            <div className="flex gap-2">
              <input
                dir="ltr"
                className="input !py-2 text-sm"
                placeholder="2026-08-15, 2026-08-16"
                value={blockInput[l.id] ?? ""}
                onChange={(e) => setBlockInput((s) => ({ ...s, [l.id]: e.target.value }))}
              />
              <button className="btn-primary !py-2 !px-4 text-sm shrink-0" onClick={() => block(l.id)}>
                احجب
              </button>
            </div>
          </div>
        ))}
        <p className="text-xs text-sea/50">
          حجب أيامك المحجوزة خارج المنصة يحميك من الحجز المزدوج — ويرفع ترتيبك.
        </p>
      </section>

      <section>
        <h2 className="font-bold text-lg text-sea mb-2">مستحقاتك</h2>
        <ul className="space-y-1 text-sm">
          {payouts.map((p) => (
            <li key={p.id} className="card p-3 flex justify-between">
              <span className="font-bold">{fmtLyd(p.amount)}</span>
              <span className="chip">
                {p.status === "queued"
                  ? `يُحرَّر ${new Date(p.releaseAfter).toLocaleDateString("ar-LY")}`
                  : p.status === "released"
                    ? "قيد التحويل"
                    : p.status}
              </span>
            </li>
          ))}
          {payouts.length === 0 ? <p className="text-sea/60">لا مستحقات بعد.</p> : null}
        </ul>
      </section>
    </main>
  );
}
