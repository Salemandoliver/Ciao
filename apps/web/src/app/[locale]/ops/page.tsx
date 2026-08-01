"use client";
/**
 * Ops console — §8.1(4): bookings ledger, overrides, rails, reconciliation,
 * concierge intake (Phase A workflow = the disaster-mode fallback, §12.6).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/logo";
import { api, ensureSession, fmtLyd, ApiError } from "@/lib/api";
import { InsightsPanels } from "./insights";

interface OpsBooking {
  id: string;
  code: string;
  state: string;
  checkIn?: string;
  depositAmount: number;
  concierge: boolean;
  createdAt: string;
}
interface Rail { rail: string; healthy: boolean; lastFailureAt?: string; note?: string }
interface Recon { accounts: { account: string; balance: number }[]; unbalancedTransactions: number }

export default function OpsPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<OpsBooking[]>([]);
  const [rails, setRails] = useState<Rail[]>([]);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [msg, setMsg] = useState("");
  const [concierge, setConcierge] = useState({
    listingId: "",
    guestPhone: "",
    guestName: "",
    checkIn: "",
    checkOut: "",
  });
  const [payLink, setPayLink] = useState("");

  const load = useCallback(async () => {
    try {
      const [b, r, rec] = await Promise.all([
        api<{ items: OpsBooking[] }>("/v1/ops/bookings?limit=50"),
        api<{ items: Rail[] }>("/v1/ops/rails"),
        api<Recon>("/v1/ops/reconciliation"),
      ]);
      setBookings(b.items);
      setRails(r.items);
      setRecon(rec);
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 403 ? "هذه الصفحة لفريق العمليات فقط" : "تعذر التحميل");
    }
  }, []);

  useEffect(() => {
    ensureSession().then((ok) => {
      if (!ok) return router.push("/login?next=/ops");
      load();
    });
  }, [router, load]);

  async function toggleRail(rail: Rail) {
    await api(`/v1/ops/rails/${rail.rail}`, {
      method: "POST",
      body: JSON.stringify({ healthy: !rail.healthy, note: "toggled from console" }),
    });
    await load();
  }

  async function createConcierge() {
    setMsg("");
    setPayLink("");
    try {
      const r = await api<{ code: string; payment: { redirectUrl?: string } }>(
        "/v1/ops/bookings/concierge",
        { method: "POST", body: JSON.stringify(concierge) },
      );
      setMsg(`حجز كونسيرج ${r.code} أُنشئ ✓`);
      if (r.payment.redirectUrl) setPayLink(r.payment.redirectUrl);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "تعذر الإنشاء");
    }
  }

  async function refund(id: string) {
    const fraction = Number(prompt("نسبة الاسترجاع (0–1):", "1") ?? "0");
    const reason = prompt("السبب:") ?? "";
    if (!fraction || !reason) return;
    await api(`/v1/ops/bookings/${id}/refund`, {
      method: "POST",
      body: JSON.stringify({ fraction, method: "credit", reason }),
    });
    setMsg("تم الاسترجاع كرصيد ✓");
    await load();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/"><Logo size={36} /></Link>
        <span className="chip">وحدة العمليات</span>
      </header>
      {msg ? <p className="card p-3 mb-4 text-sm font-bold text-sea">{msg}</p> : null}
      {payLink ? (
        <p className="card p-3 mb-4 text-sm break-all" dir="ltr">
          💳 Pay-by-link (أرسله واتساب): {payLink}
        </p>
      ) : null}

      <InsightsPanels />

      {/* Rail health (§10.8) */}
      <section className="mb-6">
        <h2 className="font-bold text-lg text-sea mb-2">حالة قنوات الدفع</h2>
        <div className="flex flex-wrap gap-2">
          {rails.map((r) => (
            <button
              key={r.rail}
              onClick={() => toggleRail(r)}
              className={`chip ${r.healthy ? "badge-success" : "badge-danger"}`}
            >
              {r.healthy ? "🟢" : "🔴"} {r.rail}
            </button>
          ))}
        </div>
      </section>

      {/* Reconciliation (§10.4) */}
      {recon ? (
        <section className="mb-6">
          <h2 className="font-bold text-lg text-sea mb-2">
            التسوية اليومية{" "}
            {recon.unbalancedTransactions === 0 ? (
              <span className="text-success text-sm">— متوازنة ✓</span>
            ) : (
              <span className="text-danger text-sm">
                — {recon.unbalancedTransactions} قيود غير متوازنة!
              </span>
            )}
          </h2>
          <div className="card p-3 text-sm">
            {recon.accounts.map((a) => (
              <div key={a.account} className="flex justify-between py-0.5">
                <span className="font-inter" dir="ltr">{a.account}</span>
                <span className="font-bold">{fmtLyd(a.balance)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Concierge intake (Phase A §17.2) */}
      <section className="mb-6 card p-4 space-y-2">
        <h2 className="font-bold text-lg text-sea">حجز كونسيرج (واتساب)</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <input dir="ltr" className="input !py-2 text-sm" placeholder="Listing ID"
            value={concierge.listingId}
            onChange={(e) => setConcierge((c) => ({ ...c, listingId: e.target.value }))} />
          <input dir="ltr" className="input !py-2 text-sm" placeholder="091 2345678"
            value={concierge.guestPhone}
            onChange={(e) => setConcierge((c) => ({ ...c, guestPhone: e.target.value }))} />
          <input className="input !py-2 text-sm" placeholder="اسم الضيف"
            value={concierge.guestName}
            onChange={(e) => setConcierge((c) => ({ ...c, guestName: e.target.value }))} />
          <div className="flex gap-2">
            <input type="date" className="input !py-2 text-sm"
              value={concierge.checkIn}
              onChange={(e) => setConcierge((c) => ({ ...c, checkIn: e.target.value }))} />
            <input type="date" className="input !py-2 text-sm"
              value={concierge.checkOut}
              onChange={(e) => setConcierge((c) => ({ ...c, checkOut: e.target.value }))} />
          </div>
        </div>
        <button className="btn-primary !py-2 text-sm" onClick={createConcierge}>
          أنشئ الحجز + رابط الدفع
        </button>
      </section>

      {/* Bookings ledger */}
      <section>
        <h2 className="font-bold text-lg text-sea mb-2">آخر الحجوزات</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sand text-sea">
              <tr>
                <th className="p-2 text-start">الكود</th>
                <th className="p-2 text-start">الحالة</th>
                <th className="p-2 text-start">الوصول</th>
                <th className="p-2 text-start">العربون</th>
                <th className="p-2 text-start">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-t border-sand">
                  <td className="p-2 font-inter font-bold" dir="ltr">
                    {b.code} {b.concierge ? "👤" : ""}
                  </td>
                  <td className="p-2"><span className="chip">{b.state}</span></td>
                  <td className="p-2">{b.checkIn}</td>
                  <td className="p-2">{fmtLyd(b.depositAmount)}</td>
                  <td className="p-2">
                    <button className="underline text-sea" onClick={() => refund(b.id)}>
                      استرجاع
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
