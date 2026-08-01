"use client";
/**
 * Ops console — §8.1(4): bookings ledger, overrides, rails, reconciliation,
 * concierge intake (Phase A workflow = the disaster-mode fallback, §12.6).
 *
 * Internal tooling, so the English is terse: an operator scanning this screen
 * during an incident wants the noun, not a sentence.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useLocale, useRouter } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { api, ensureSession, fmtLyd, ApiError } from "@/lib/api";
import { PAYMENT_RAILS, accountLabel, fmtNum, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
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

const copy = {
  ar: {
    opsUnit: "وحدة العمليات",
    forbidden: "هذه الصفحة لفريق العمليات فقط",
    loadFailed: "تعذر التحميل",
    payLink: "💳 Pay-by-link (أرسله واتساب):",
    railHealth: "حالة قنوات الدفع",
    reconTitle: "التسوية اليومية",
    balanced: "— متوازنة ✓",
    unbalanced: (n: string) => `— ${n} قيود غير متوازنة!`,
    conciergeTitle: "حجز كونسيرج (واتساب)",
    guestName: "اسم الضيف",
    createBooking: "أنشئ الحجز + رابط الدفع",
    conciergeCreated: (code: string) => `حجز كونسيرج ${code} أُنشئ ✓`,
    createFailed: "تعذر الإنشاء",
    refundFraction: "نسبة الاسترجاع (0–1):",
    refundReason: "السبب:",
    refunded: "تم الاسترجاع كرصيد ✓",
    latestBookings: "آخر الحجوزات",
    thCode: "الكود",
    thState: "الحالة",
    thCheckIn: "الوصول",
    thDeposit: "العربون",
    thAction: "إجراء",
    refund: "استرجاع",
  },
  en: {
    opsUnit: "Operations",
    forbidden: "This page is for the operations team only",
    loadFailed: "Could not load",
    payLink: "💳 Pay-by-link (send it on WhatsApp):",
    railHealth: "Payment rail health",
    reconTitle: "Daily reconciliation",
    balanced: "— balanced ✓",
    unbalanced: (n: string) => `— ${n} unbalanced entries!`,
    conciergeTitle: "Concierge booking (WhatsApp)",
    guestName: "Guest name",
    createBooking: "Create booking + payment link",
    conciergeCreated: (code: string) => `Concierge booking ${code} created ✓`,
    createFailed: "Could not create it",
    refundFraction: "Refund fraction (0–1):",
    refundReason: "Reason:",
    refunded: "Refunded as credit ✓",
    latestBookings: "Latest bookings",
    thCode: "Code",
    thState: "State",
    thCheckIn: "Check-in",
    thDeposit: "Deposit",
    thAction: "Action",
    refund: "Refund",
  },
} satisfies Record<Locale, unknown>;

export default function OpsPage() {
  const locale = useLocale();
  const c = copy[locale];
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
      setMsg(e instanceof ApiError && e.status === 403 ? c.forbidden : c.loadFailed);
    }
  }, [c]);

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
      setMsg(c.conciergeCreated(r.code));
      if (r.payment.redirectUrl) setPayLink(r.payment.redirectUrl);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : c.createFailed);
    }
  }

  async function refund(id: string) {
    const fraction = Number(prompt(c.refundFraction, "1") ?? "0");
    const reason = prompt(c.refundReason) ?? "";
    if (!fraction || !reason) return;
    await api(`/v1/ops/bookings/${id}/refund`, {
      method: "POST",
      body: JSON.stringify({ fraction, method: "credit", reason }),
    });
    setMsg(c.refunded);
    await load();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/"><Logo size={36} /></Link>
        <div className="flex items-center gap-3">
          <span className="chip">{c.opsUnit}</span>
          <LanguageToggle />
        </div>
      </header>
      {msg ? <p className="card p-3 mb-4 text-sm font-bold text-sea">{msg}</p> : null}
      {payLink ? (
        <p className="card p-3 mb-4 text-sm break-all" dir="ltr">
          {c.payLink} {payLink}
        </p>
      ) : null}

      <InsightsPanels />

      {/* Rail health (§10.8) */}
      <section className="mb-6">
        <h2 className="font-bold text-lg text-sea mb-2">{c.railHealth}</h2>
        <div className="flex flex-wrap gap-2">
          {rails.map((r) => (
            <button
              key={r.rail}
              onClick={() => toggleRail(r)}
              className={`chip ${r.healthy ? "badge-success" : "badge-danger"}`}
            >
              {r.healthy ? "🟢" : "🔴"} {term(PAYMENT_RAILS, locale, r.rail)}
            </button>
          ))}
        </div>
      </section>

      {/* Reconciliation (§10.4) */}
      {recon ? (
        <section className="mb-6">
          <h2 className="font-bold text-lg text-sea mb-2">
            {c.reconTitle}{" "}
            {recon.unbalancedTransactions === 0 ? (
              <span className="text-success text-sm">{c.balanced}</span>
            ) : (
              <span className="text-danger text-sm">
                {c.unbalanced(fmtNum(locale, recon.unbalancedTransactions))}
              </span>
            )}
          </h2>
          <div className="card p-3 text-sm">
            {recon.accounts.map((a) => (
              <div key={a.account} className="flex justify-between py-0.5">
                <span>{accountLabel(locale, a.account)}</span>
                <span className="font-bold">{fmtLyd(a.balance, locale)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Concierge intake (Phase A §17.2) */}
      <section className="mb-6 card p-4 space-y-2">
        <h2 className="font-bold text-lg text-sea">{c.conciergeTitle}</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <input dir="ltr" className="input !py-2 text-sm" placeholder="Listing ID"
            value={concierge.listingId}
            onChange={(e) => setConcierge((x) => ({ ...x, listingId: e.target.value }))} />
          <input dir="ltr" className="input !py-2 text-sm" placeholder="091 2345678"
            value={concierge.guestPhone}
            onChange={(e) => setConcierge((x) => ({ ...x, guestPhone: e.target.value }))} />
          <input className="input !py-2 text-sm" placeholder={c.guestName}
            value={concierge.guestName}
            onChange={(e) => setConcierge((x) => ({ ...x, guestName: e.target.value }))} />
          <div className="flex gap-2">
            <input type="date" className="input !py-2 text-sm"
              value={concierge.checkIn}
              onChange={(e) => setConcierge((x) => ({ ...x, checkIn: e.target.value }))} />
            <input type="date" className="input !py-2 text-sm"
              value={concierge.checkOut}
              onChange={(e) => setConcierge((x) => ({ ...x, checkOut: e.target.value }))} />
          </div>
        </div>
        <button className="btn-primary !py-2 text-sm" onClick={createConcierge}>
          {c.createBooking}
        </button>
      </section>

      {/* Bookings ledger */}
      <section>
        <h2 className="font-bold text-lg text-sea mb-2">{c.latestBookings}</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sand text-sea">
              <tr>
                <th className="p-2 text-start">{c.thCode}</th>
                <th className="p-2 text-start">{c.thState}</th>
                <th className="p-2 text-start">{c.thCheckIn}</th>
                <th className="p-2 text-start">{c.thDeposit}</th>
                <th className="p-2 text-start">{c.thAction}</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-t border-sand">
                  <td className="p-2 font-inter font-bold" dir="ltr">
                    {b.code} {b.concierge ? "👤" : ""}
                  </td>
                  {/* The raw state-machine name on purpose: it is the string ops
                      quote to each other and grep the logs for. */}
                  <td className="p-2"><span className="chip" dir="ltr">{b.state}</span></td>
                  <td className="p-2">{b.checkIn}</td>
                  <td className="p-2">{fmtLyd(b.depositAmount, locale)}</td>
                  <td className="p-2">
                    <button className="underline text-sea" onClick={() => refund(b.id)}>
                      {c.refund}
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
