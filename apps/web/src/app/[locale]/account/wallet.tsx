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

/** Ledger memos are written for operators; guests deserve their own language. */
const MEMO_AR: Record<string, string> = {
  "refund to credit": "استرجاع إلى رصيدك",
  "loyalty redemption": "تحويل نقاط إلى رصيد",
  review_loyalty_credit: "مكافأة كتابة تقييم",
  host_timeout_goodwill: "تعويض: المضيف لم يردّ في الوقت",
  host_cancel_goodwill: "تعويض: المضيف ألغى الحجز",
  "deposit allocated": "خُصم كعربون حجز",
};

function memoAr(memo: string | null): string {
  if (!memo) return "حركة على الرصيد";
  return MEMO_AR[memo] ?? memo;
}

export function WalletTab() {
  const [data, setData] = useState<Wallet | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Wallet>("/v1/me/wallet"));
    } catch {
      setErr("تعذر تحميل المحفظة");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (err) return <p className="p-4 text-danger font-bold">{err}</p>;
  if (!data) return <p className="p-4 text-faint">جارٍ التحميل…</p>;

  return (
    <div className="space-y-3">
      <div className="card p-5 text-center">
        <div className="text-xs font-bold text-faint">رصيدك في تشاو</div>
        <div className="text-3xl font-extrabold text-sea mt-1">{fmtLyd(data.balance)}</div>
        <p className="text-xs text-faint mt-2 leading-relaxed">
          يُستخدم تلقائيًا لخصم عربون حجزك القادم. لا ينتهي ولا تنقص قيمته بمرور الوقت.
        </p>
      </div>

      {!data.topUpEnabled ? (
        <div className="card p-4">
          <h3 className="font-bold text-sea text-sm">شحن الرصيد — قريبًا</h3>
          <p className="text-xs text-muted mt-1 leading-relaxed">
            رصيدك اليوم يأتي من الاسترجاعات والتعويضات وتحويل النقاط. شحن الرصيد بأموالك مباشرة
            نعمل عليه، ولن نفعّله قبل استكمال الجانب التنظيمي — لأن حفظ أموال العملاء مسؤولية لا
            نتعامل معها باستخفاف.
          </p>
        </div>
      ) : null}

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm mb-2">سجلّ الحركات</h3>
        {data.transactions.length === 0 ? (
          <p className="text-sm text-faint">لا حركات بعد.</p>
        ) : (
          <ul className="divide-y divide-sand">
            {data.transactions.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-sea truncate">{memoAr(t.memo)}</div>
                  <div className="text-[11px] text-faint" dir="ltr">
                    {new Date(t.at).toLocaleString("ar-LY")}
                  </div>
                </div>
                <div
                  className={`shrink-0 font-bold tabular-nums text-sm ${
                    t.direction === "in" ? "text-success" : "text-muted"
                  }`}
                >
                  {t.direction === "in" ? "+" : "−"} {fmtLyd(Math.abs(t.amount))}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-faint mt-3 leading-relaxed">
          كل حركة هنا قيد محاسبي في دفترنا — ما تراه أنت هو نفسه ما يراه محاسبنا، لا نسخة منه.
        </p>
      </div>
    </div>
  );
}
