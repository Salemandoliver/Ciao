"use client";
/**
 * Spend points at a partner.
 *
 * The flow is built around what actually happens at a counter: you are stood
 * in front of someone with a queue behind you. So the code is large, short,
 * and in an alphabet without characters people misread; the countdown is
 * visible; and the points are already gone the moment the code appears, so
 * there is never a moment where the café is exposed to a double-spend.
 *
 * If the guest walks away without using it, the sweep returns the points
 * automatically — they don't have to ask.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/logo";
import { ApiError, api, ensureSession, fmtLyd, hasSession } from "@/lib/api";
import { trackClient } from "@/lib/tracker";

interface Partner {
  id: string;
  nameAr: string;
  category: string;
  city: string | null;
  area: string | null;
  descriptionAr: string | null;
  minValue: number;
  maxValue: number;
  venueNameAr: string | null;
}

interface Directory {
  enabled: boolean;
  pointToDirham: number;
  voucherMinutes: number;
  categories: Record<string, string>;
  items: Partner[];
}

interface Voucher {
  id: string;
  code: string;
  points: number;
  value: number;
  expiresAt: string;
  partnerName: string;
}

const CATEGORY_EMOJI: Record<string, string> = {
  cafe: "☕",
  restaurant: "🍽",
  bakery: "🧁",
  spa: "💆",
  activity: "🎯",
  shop: "🛍",
};

export default function PartnersPage() {
  const router = useRouter();
  const [dir, setDir] = useState<Directory | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [active, setActive] = useState<Partner | null>(null);
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [amount, setAmount] = useState(0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Directory>("/v1/partners");
      setDir(d);
      if (hasSession()) {
        const ok = await ensureSession();
        if (ok) {
          const p = await api<{ balance: number }>("/v1/me/points");
          setPoints(p.balance);
        }
      }
    } catch {
      setMsg("تعذر تحميل قائمة الشركاء");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function open(p: Partner) {
    setActive(p);
    setAmount(p.minValue);
    setVoucher(null);
    setMsg("");
    trackClient("partner.viewed", { partnerId: p.id, category: p.category });
  }

  async function issue() {
    if (!active) return;
    if (!(await ensureSession())) return router.push("/login?next=/rewards/partners");
    setBusy(true);
    setMsg("");
    try {
      const v = await api<Voucher>("/v1/me/vouchers", {
        method: "POST",
        body: JSON.stringify({ partnerId: active.id, value: amount }),
      });
      setVoucher(v);
      setPoints((p) => (p == null ? p : p - v.points));
    } catch (e) {
      const m = e instanceof ApiError ? e.message : "";
      setMsg(
        m.includes("insufficient_points")
          ? "نقاطك لا تكفي لهذه القيمة"
          : m.includes("disabled")
            ? "الصرف عند الشركاء غير مفعّل حاليًا"
            : "تعذر إصدار القسيمة",
      );
    } finally {
      setBusy(false);
    }
  }

  const pointsNeeded = dir ? Math.ceil(amount / dir.pointToDirham) : 0;
  const affordable = points == null || pointsNeeded <= points;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/">
          <Logo size={34} />
        </Link>
        <nav className="flex items-center gap-2 text-xs font-bold text-sea">
          <Link href="/rewards" className="chip">شروط النقاط</Link>
          <Link href="/account?tab=points" className="chip">نقاطي</Link>
        </nav>
      </header>

      <h1 className="font-bold text-xl text-sea">اصرف نقاطك عند شركائنا</h1>
      <p className="text-sm text-sea/70 mt-1 leading-relaxed">
        قهوة، حلويات، أو وجبة — بنقاط كسبتها من حجوزاتك. اختر الشريك والقيمة، واعرض الكود عند
        الكاشير.
      </p>
      {points != null ? (
        <p className="text-sm font-bold text-sea mt-2">
          رصيدك: {points.toLocaleString("ar-LY")} نقطة
        </p>
      ) : null}

      {msg ? <p className="text-sm font-bold text-red-700 mt-3">{msg}</p> : null}

      {dir && !dir.enabled ? (
        <p className="card p-4 mt-4 text-sm text-sea/70">
          الصرف عند الشركاء غير مفعّل حاليًا. نقاطك تبقى في رصيدك ويمكنك تحويلها إلى رصيد داخل
          تشاو.
        </p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        {(dir?.items ?? []).map((p) => (
          <button
            key={p.id}
            onClick={() => open(p)}
            className="card p-4 text-start hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-2">
              <span aria-hidden className="text-xl">{CATEGORY_EMOJI[p.category] ?? "🎁"}</span>
              <div className="min-w-0">
                <h3 className="font-bold text-sea truncate">{p.nameAr}</h3>
                <p className="text-[11px] text-sea/55">
                  {dir?.categories[p.category] ?? p.category}
                  {p.venueNameAr ? ` · داخل ${p.venueNameAr}` : p.area ? ` · ${p.area}` : ""}
                </p>
              </div>
            </div>
            {p.descriptionAr ? (
              <p className="text-xs text-sea/70 mt-2 leading-relaxed">{p.descriptionAr}</p>
            ) : null}
            <p className="text-[11px] text-sea/45 mt-2">
              من {fmtLyd(p.minValue)} إلى {fmtLyd(p.maxValue)}
            </p>
          </button>
        ))}
        {dir && dir.items.length === 0 ? (
          <p className="card p-4 text-sm text-sea/60 sm:col-span-2">
            لم نضف شركاء بعد. نختارهم بالطريقة نفسها التي نختار بها الأماكن — بالزيارة، لا
            بالمكالمة.
          </p>
        ) : null}
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-50 bg-sea-dark/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setActive(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-bubble shadow-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {voucher ? (
              <VoucherView voucher={voucher} onClose={() => setActive(null)} />
            ) : (
              <>
                <h2 className="font-bold text-sea">{active.nameAr}</h2>
                <p className="text-xs text-sea/60 mt-1">اختر قيمة القسيمة</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {stepsFor(active).map((v) => (
                    <button
                      key={v}
                      className={`chip ${amount === v ? "!bg-sea !text-white" : ""}`}
                      onClick={() => setAmount(v)}
                    >
                      {fmtLyd(v)}
                    </button>
                  ))}
                </div>
                <p className="text-sm text-sea/75 mt-3">
                  تُخصم <strong className="text-sea">{pointsNeeded.toLocaleString("ar-LY")}</strong>{" "}
                  نقطة
                  {points != null ? ` من ${points.toLocaleString("ar-LY")}` : ""}
                </p>
                {!affordable ? (
                  <p className="text-sm font-bold text-red-700 mt-1">نقاطك لا تكفي لهذه القيمة</p>
                ) : null}
                <button
                  className="btn-primary w-full !py-2 !text-sm mt-4 disabled:opacity-40"
                  disabled={busy || !affordable}
                  onClick={issue}
                >
                  {busy ? "…" : "أصدر القسيمة"}
                </button>
                <p className="text-[11px] text-sea/45 mt-2 leading-relaxed">
                  تُخصم النقاط فور الإصدار حتى لا تُصرف مرتين. إن لم تستخدم القسيمة خلال{" "}
                  {dir?.voucherMinutes ?? 30} دقيقة، تعود نقاطك تلقائيًا.
                </p>
              </>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}

/** Round values a person would actually ask for at a till. */
function stepsFor(p: Partner): number[] {
  const out: number[] = [];
  for (let v = p.minValue; v <= p.maxValue && out.length < 6; v += 5000) out.push(v);
  if (!out.includes(p.maxValue) && out.length < 6) out.push(p.maxValue);
  return out;
}

function VoucherView({ voucher, onClose }: { voucher: Voucher; onClose: () => void }) {
  const [left, setLeft] = useState("");
  useEffect(() => {
    const update = () => {
      const ms = new Date(voucher.expiresAt).getTime() - Date.now();
      if (ms <= 0) return setLeft("انتهت — نقاطك تعود إليك تلقائيًا");
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setLeft(`صالحة ${m}:${String(s).padStart(2, "0")}`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [voucher.expiresAt]);

  return (
    <div className="text-center">
      <p className="text-xs font-bold text-sea/55">اعرض هذا الكود عند الكاشير</p>
      <div
        className="text-4xl font-extrabold text-sea tracking-[0.3em] my-3 tabular-nums"
        dir="ltr"
      >
        {voucher.code}
      </div>
      <p className="font-bold text-sea">{fmtLyd(voucher.value)} — {voucher.partnerName}</p>
      <p className="text-sm text-amber-dark font-bold mt-1" dir="ltr">{left}</p>
      <p className="text-[11px] text-sea/45 mt-3 leading-relaxed">
        القسيمة لمرة واحدة ولدى هذا الشريك فقط. لا تُستبدل نقدًا ولا يُعاد باقيها.
      </p>
      <button className="chip mt-4" onClick={onClose}>
        تم
      </button>
    </div>
  );
}
