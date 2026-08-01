"use client";
/**
 * Points and invitations.
 *
 * Two deliberate choices show up here. Points are earned for things that
 * actually happened — a completed stay, a written review, an invited friend who
 * turned up — not for signing up, because paying for signups in a market this
 * size is paying for SIM cards. And the invite share text is pre-written in
 * Libyan-plain Arabic, because this gets pasted into WhatsApp, not emailed.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd, fmtLydPrecise } from "@/lib/api";

interface Points {
  balance: number;
  worthDirhams: number;
  minRedeem: number;
  history: { delta: number; reason: string; label: string; at: string }[];
}

interface Referrals {
  code: string;
  invited: number;
  joined: number;
  rewarded: number;
  pointsPerReferral: number;
  shareUrl: string;
  shareTextAr: string;
}

export function PointsTab({ onChange }: { onChange: () => void | Promise<void> }) {
  const [points, setPoints] = useState<Points | null>(null);
  const [ref, setRef] = useState<Referrals | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [claimCode, setClaimCode] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        api<Points>("/v1/me/points"),
        api<Referrals>("/v1/me/referrals"),
      ]);
      setPoints(p);
      setRef(r);
    } catch {
      setMsg("تعذر التحميل");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function redeem() {
    if (!points) return;
    setBusy(true);
    setMsg("");
    try {
      // Convert everything above the floor, rounded to whole dinars so the
      // resulting balance is a number a person would say out loud.
      const usable = Math.floor(points.balance / 1000) * 1000;
      const res = await api<{ dirhams: number }>("/v1/me/points/redeem", {
        method: "POST",
        body: JSON.stringify({ points: usable }),
      });
      setMsg(`✅ أُضيف ${fmtLyd(res.dirhams)} إلى محفظتك`);
      await load();
      await onChange();
    } catch (e) {
      setMsg(
        e instanceof ApiError && e.message.includes("min_redeem")
          ? `أقل مبلغ للتحويل ${points.minRedeem} نقطة`
          : "تعذر التحويل",
      );
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    setMsg("");
    try {
      await api("/v1/me/referrals/claim", {
        method: "POST",
        body: JSON.stringify({ code: claimCode }),
      });
      setMsg("✅ سُجّلت الدعوة — تُصرف المكافأة بعد أول إقامة تكملها");
      setClaimCode("");
      await load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : "";
      setMsg(
        m.includes("unknown_code")
          ? "الكود غير صحيح"
          : m.includes("already_referred")
            ? "حسابك مرتبط بدعوة سابقة"
            : m.includes("yourself")
              ? "لا يمكنك استخدام كودك أنت"
              : "تعذر تسجيل الدعوة",
      );
    }
  }

  async function share() {
    if (!ref) return;
    const payload = { title: "تشاو", text: ref.shareTextAr, url: ref.shareUrl };
    // Web Share hands the invite straight to WhatsApp on Android, which is
    // where it is going anyway. Clipboard is the fallback, never a dead end.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch {
        /* user dismissed — fall through to copy */
      }
    }
    await navigator.clipboard?.writeText(ref.shareTextAr).catch(() => {});
    setMsg("✅ نُسخت الدعوة — الصقها في واتساب");
  }

  if (!points || !ref) return <p className="p-4 text-sea/60">جارٍ التحميل…</p>;

  const canRedeem = points.balance >= points.minRedeem;

  return (
    <div className="space-y-3">
      {msg ? <p className="text-sm font-bold text-sea">{msg}</p> : null}

      <div className="card p-5 text-center">
        <div className="text-xs font-bold text-sea/55">نقاطك</div>
        <div className="text-3xl font-extrabold text-sea mt-1 tabular-nums">
          {points.balance.toLocaleString("ar-LY")}
        </div>
        <div className="text-xs text-sea/60 mt-1">
          تساوي {fmtLydPrecise(points.worthDirhams)} رصيدًا
        </div>
        <button
          className="btn-primary !py-2 !text-sm mt-3 disabled:opacity-40"
          disabled={!canRedeem || busy}
          onClick={redeem}
        >
          {busy ? "…" : canRedeem ? "حوّل نقاطك إلى رصيد" : `تحتاج ${points.minRedeem} نقطة للتحويل`}
        </button>
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm">ادعُ أصدقاءك</h3>
        <p className="text-xs text-sea/70 mt-1 leading-relaxed">
          تكسب {ref.pointsPerReferral} نقطة عن كل صديق يكمل أول حجز له — لا عند تسجيله فقط. وهو
          أيضًا يكسب نقاطًا ترحيبية.
        </p>
        <div className="flex items-center gap-2 mt-3">
          <code className="flex-1 rounded-xl bg-sand px-3 py-2 font-bold text-sea text-center tracking-widest" dir="ltr">
            {ref.code}
          </code>
          <button className="btn-amber !py-2 !px-4 !text-sm shrink-0" onClick={share}>
            شارك
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          <MiniStat label="دعوات" value={ref.invited} />
          <MiniStat label="انضموا" value={ref.joined} />
          <MiniStat label="مكافآت مصروفة" value={ref.rewarded} />
        </div>
        <p className="text-[11px] text-sea/45 mt-2">
          لا نعرض لك أسماء من قبِل دعوتك — نعرض العدد فقط، احترامًا لخصوصيتهم.
        </p>
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm">عندك كود دعوة؟</h3>
        <div className="flex gap-2 mt-2">
          <input
            className="input !py-2 !text-sm"
            dir="ltr"
            placeholder="CIAOXXXXXX"
            value={claimCode}
            onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
          />
          <button className="chip shrink-0" onClick={claim} disabled={claimCode.length < 4}>
            تسجيل
          </button>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm mb-2">سجلّ النقاط</h3>
        {points.history.length === 0 ? (
          <p className="text-sm text-sea/50">لا حركات بعد.</p>
        ) : (
          <ul className="divide-y divide-sand">
            {points.history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-sea truncate">{h.label}</div>
                  <div className="text-[11px] text-sea/50" dir="ltr">
                    {new Date(h.at).toLocaleDateString("ar-LY")}
                  </div>
                </div>
                <span
                  className={`shrink-0 font-bold tabular-nums text-sm ${
                    h.delta > 0 ? "text-emerald-700" : "text-sea/70"
                  }`}
                >
                  {h.delta > 0 ? "+" : ""}
                  {h.delta}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-sand/60 p-2">
      <div className="text-[11px] font-bold text-sea/55">{label}</div>
      <div className="font-extrabold text-sea tabular-nums">{value}</div>
    </div>
  );
}
