"use client";
/**
 * The wallet.
 *
 * Every row here is a posting in the same double-entry ledger the accountant
 * closes the books from — not a separate "wallet balance" column that can
 * drift. When a guest and our finance screen look at the same refund, they are
 * literally reading the same record.
 *
 * Top-up is shown as coming, not hidden. Pretending the feature doesn't exist
 * would be tidier; saying plainly why it isn't live yet is the same posture
 * the rest of the product takes about payment rails and demo mode.
 */
import { useCallback, useEffect, useState } from "react";
import { api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { fmtDateTime } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

interface Wallet {
  balance: number;
  topUpEnabled: boolean;
  transactions: {
    id: string;
    amount: number;
    direction: "in" | "out";
    memo: string | null;
    bookingId: string | null;
    at: string;
  }[];
}

/**
 * Ledger memos are written for operators; guests deserve their own language —
 * in both languages. The keys are the raw memo strings the ledger writes, so
 * an unknown memo falls through and is shown verbatim rather than blanked.
 */
const MEMOS: Record<Locale, Record<string, string>> = {
  ar: {
    "refund to credit": "استرجاع إلى رصيدك",
    "loyalty redemption": "تحويل نقاط إلى رصيد",
    review_loyalty_credit: "مكافأة كتابة تقييم",
    host_timeout_goodwill: "تعويض: المضيف لم يردّ في الوقت",
    host_cancel_goodwill: "تعويض: المضيف ألغى الحجز",
    "deposit allocated": "خُصم كعربون حجز",
  },
  en: {
    "refund to credit": "Refunded to your credit",
    "loyalty redemption": "Points converted to credit",
    review_loyalty_credit: "Reward for writing a review",
    host_timeout_goodwill: "Goodwill: the host did not reply in time",
    host_cancel_goodwill: "Goodwill: the host cancelled",
    "deposit allocated": "Used as a booking deposit",
  },
};

const copy = {
  ar: {
    loading: "جارٍ التحميل…",
    loadFailed: "تعذر تحميل المحفظة",
    balance: "رصيدك في تشاو",
    balanceNote:
      "يُستخدم تلقائيًا لخصم عربون حجزك القادم. لا ينتهي ولا تنقص قيمته بمرور الوقت.",
    topUpTitle: "شحن الرصيد — قريبًا",
    topUpBody:
      "رصيدك اليوم يأتي من الاسترجاعات والتعويضات وتحويل النقاط. شحن الرصيد بأموالك مباشرة نعمل عليه، ولن نفعّله قبل استكمال الجانب التنظيمي — لأن حفظ أموال العملاء مسؤولية لا نتعامل معها باستخفاف.",
    history: "سجلّ الحركات",
    empty: "لا حركات بعد.",
    otherMovement: "حركة على الرصيد",
    ledgerNote:
      "كل حركة هنا قيد محاسبي في دفترنا — ما تراه أنت هو نفسه ما يراه محاسبنا، لا نسخة منه.",
  },
  en: {
    loading: "Loading…",
    loadFailed: "Could not load your wallet",
    balance: "Your Ciao credit",
    balanceNote:
      "Used automatically towards the deposit on your next booking. It does not expire and does not lose value over time.",
    topUpTitle: "Topping up — coming soon",
    topUpBody:
      "Your credit today comes from refunds, goodwill payments and converted points. Adding your own money is something we are building, and we will not switch it on before the regulatory side is finished — holding customers' money is not a responsibility we treat lightly.",
    history: "Transactions",
    empty: "Nothing yet.",
    otherMovement: "Credit movement",
    ledgerNote:
      "Every line here is an entry in our ledger — what you see is the same record our accountant sees, not a copy of it.",
  },
} satisfies Record<Locale, unknown>;

function memoLabel(locale: Locale, memo: string | null): string {
  if (!memo) return copy[locale].otherMovement;
  return MEMOS[locale][memo] ?? MEMOS.ar[memo] ?? memo;
}

export function WalletTab() {
  const locale = useLocale();
  const c = copy[locale];
  const [data, setData] = useState<Wallet | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Wallet>("/v1/me/wallet"));
    } catch {
      setErr(c.loadFailed);
    }
  }, [c]);

  useEffect(() => {
    void load();
  }, [load]);

  if (err) return <p className="p-4 text-danger font-bold">{err}</p>;
  if (!data) return <p className="p-4 text-faint">{c.loading}</p>;

  return (
    <div className="space-y-3">
      <div className="card p-5 text-center">
        <div className="text-xs font-bold text-faint">{c.balance}</div>
        <div className="text-3xl font-extrabold text-sea mt-1">{fmtLyd(data.balance, locale)}</div>
        <p className="text-xs text-faint mt-2 leading-relaxed">{c.balanceNote}</p>
      </div>

      {!data.topUpEnabled ? (
        <div className="card p-4">
          <h3 className="font-bold text-sea text-sm">{c.topUpTitle}</h3>
          <p className="text-xs text-muted mt-1 leading-relaxed">{c.topUpBody}</p>
        </div>
      ) : null}

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm mb-2">{c.history}</h3>
        {data.transactions.length === 0 ? (
          <p className="text-sm text-faint">{c.empty}</p>
        ) : (
          <ul className="divide-y divide-sand">
            {data.transactions.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-sea truncate">
                    {memoLabel(locale, t.memo)}
                  </div>
                  <div className="text-[11px] text-faint" dir="ltr">
                    {fmtDateTime(locale, t.at)}
                  </div>
                </div>
                <div
                  className={`shrink-0 font-bold tabular-nums text-sm ${
                    t.direction === "in" ? "text-success" : "text-muted"
                  }`}
                >
                  {t.direction === "in" ? "+" : "−"} {fmtLyd(Math.abs(t.amount), locale)}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-faint mt-3 leading-relaxed">{c.ledgerNote}</p>
      </div>
    </div>
  );
}
