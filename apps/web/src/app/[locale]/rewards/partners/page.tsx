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
 *
 * Partner names come from the directory in Arabic only, so on the English page
 * they are rendered with `lang`/`dir` rather than transliterated: the name on
 * the shopfront is the name you have to read at the till.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useLocale, useRouter } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { ApiError, api, ensureSession, fmtLyd, hasSession } from "@/lib/api";
import { trackClient } from "@/lib/tracker";
import { AREAS, fmtNum, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

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

/** Operator-written Arabic inside a page that may be English. */
const AR_TEXT = { lang: "ar" as const, dir: "rtl" as const };

const copy = {
  ar: {
    navTerms: "شروط النقاط",
    navPoints: "نقاطي",
    title: "اصرف نقاطك عند شركائنا",
    lead: "قهوة، حلويات، أو وجبة — بنقاط كسبتها من حجوزاتك. اختر الشريك والقيمة، واعرض الكود عند الكاشير.",
    balance: (n: string) => `رصيدك: ${n} نقطة`,
    loadFailed: "تعذر تحميل قائمة الشركاء",
    notEnough: "نقاطك لا تكفي لهذه القيمة",
    disabled: "الصرف عند الشركاء غير مفعّل حاليًا",
    issueFailed: "تعذر إصدار القسيمة",
    disabledNotice:
      "الصرف عند الشركاء غير مفعّل حاليًا. نقاطك تبقى في رصيدك ويمكنك تحويلها إلى رصيد داخل تشاو.",
    inside: "داخل",
    range: (min: string, max: string) => `من ${min} إلى ${max}`,
    empty:
      "لم نضف شركاء بعد. نختارهم بالطريقة نفسها التي نختار بها الأماكن — بالزيارة، لا بالمكالمة.",
    chooseValue: "اختر قيمة القسيمة",
    deduct: (points: string, balance: string | null) => (
      <>
        تُخصم <strong className="text-sea">{points}</strong> نقطة
        {balance ? ` من ${balance}` : ""}
      </>
    ),
    issue: "أصدر القسيمة",
    issueNote: (minutes: number) =>
      `تُخصم النقاط فور الإصدار حتى لا تُصرف مرتين. إن لم تستخدم القسيمة خلال ${minutes} دقيقة، تعود نقاطك تلقائيًا.`,
    showAtTill: "اعرض هذا الكود عند الكاشير",
    expired: "انتهت — نقاطك تعود إليك تلقائيًا",
    validFor: (left: string) => `صالحة ${left}`,
    voucherTerms: "القسيمة لمرة واحدة ولدى هذا الشريك فقط. لا تُستبدل نقدًا ولا يُعاد باقيها.",
    done: "تم",
    categories: {
      cafe: "مقهى",
      restaurant: "مطعم",
      bakery: "مخبز وحلويات",
      spa: "مركز عناية",
      activity: "نشاط ترفيهي",
      shop: "متجر",
    } as Record<string, string>,
  },
  en: {
    navTerms: "Points terms",
    navPoints: "My points",
    title: "Spend your points at our partners",
    lead: "Coffee, sweets or a meal — with points you earned from your bookings. Pick the partner and the value, then show the code at the till.",
    balance: (n: string) => `Your balance: ${n} points`,
    loadFailed: "Could not load the partner list",
    notEnough: "You do not have enough points for this value",
    disabled: "Spending at partners is switched off at the moment",
    issueFailed: "Could not issue the voucher",
    disabledNotice:
      "Spending at partners is switched off at the moment. Your points stay in your balance, and you can convert them to credit inside Ciao.",
    inside: "inside",
    range: (min: string, max: string) => `From ${min} to ${max}`,
    empty:
      "We have not added any partners yet. We choose them the same way we choose places — by visiting, not by phoning.",
    chooseValue: "Choose the voucher value",
    deduct: (points: string, balance: string | null) => (
      <>
        <strong className="text-sea">{points}</strong> points will be taken
        {balance ? ` from ${balance}` : ""}
      </>
    ),
    issue: "Issue the voucher",
    issueNote: (minutes: number) =>
      `The points are taken as soon as the voucher is issued, so it cannot be spent twice. If you do not use it within ${minutes} minutes, your points come back automatically.`,
    showAtTill: "Show this code at the till",
    expired: "Expired — your points come back to you automatically",
    validFor: (left: string) => `Valid ${left}`,
    voucherTerms:
      "The voucher is for one use, at this partner only. It is not exchanged for cash and no change is given.",
    done: "Done",
    categories: {
      cafe: "Café",
      restaurant: "Restaurant",
      bakery: "Bakery & sweets",
      spa: "Beauty & spa",
      activity: "Activity",
      shop: "Shop",
    } as Record<string, string>,
  },
} satisfies Record<Locale, unknown>;

export default function PartnersPage() {
  const locale = useLocale();
  const c = copy[locale];
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
      setMsg(c.loadFailed);
    }
  }, [c]);

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
          ? c.notEnough
          : m.includes("disabled")
            ? c.disabled
            : c.issueFailed,
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
          <Logo />
        </Link>
        <nav className="flex items-center gap-2 text-xs font-bold text-sea">
          <Link href="/rewards" className="chip">{c.navTerms}</Link>
          <Link href="/account?tab=points" className="chip">{c.navPoints}</Link>
        </nav>
      </header>

      <h1 className="font-bold text-xl text-sea">{c.title}</h1>
      <p className="text-sm text-muted mt-1 leading-relaxed">{c.lead}</p>
      {points != null ? (
        <p className="text-sm font-bold text-sea mt-2">{c.balance(fmtNum(locale, points))}</p>
      ) : null}

      {msg ? <p className="text-sm font-bold text-danger mt-3">{msg}</p> : null}

      {dir && !dir.enabled ? (
        <p className="card p-4 mt-4 text-sm text-muted">{c.disabledNotice}</p>
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
                <h3 className="font-bold text-sea truncate" {...AR_TEXT}>
                  {p.nameAr}
                </h3>
                <p className="text-[11px] text-faint">
                  {c.categories[p.category] ?? dir?.categories[p.category] ?? p.category}
                  {p.venueNameAr ? (
                    <>
                      {` · ${c.inside} `}
                      <span {...AR_TEXT}>{p.venueNameAr}</span>
                    </>
                  ) : p.area ? (
                    ` · ${term(AREAS, locale, p.area)}`
                  ) : (
                    ""
                  )}
                </p>
              </div>
            </div>
            {p.descriptionAr ? (
              <p className="text-xs text-muted mt-2 leading-relaxed" {...AR_TEXT}>
                {p.descriptionAr}
              </p>
            ) : null}
            <p className="text-[11px] text-faint mt-2">
              {c.range(fmtLyd(p.minValue, locale), fmtLyd(p.maxValue, locale))}
            </p>
          </button>
        ))}
        {dir && dir.items.length === 0 ? (
          <p className="card p-4 text-sm text-faint sm:col-span-2">{c.empty}</p>
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
            className="bg-surface w-full sm:max-w-md rounded-t-3xl sm:rounded-bubble shadow-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {voucher ? (
              <VoucherView voucher={voucher} onClose={() => setActive(null)} />
            ) : (
              <>
                <h2 className="font-bold text-sea" {...AR_TEXT}>
                  {active.nameAr}
                </h2>
                <p className="text-xs text-faint mt-1">{c.chooseValue}</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {stepsFor(active).map((v) => (
                    <button
                      key={v}
                      className={`chip ${amount === v ? "!bg-sea !text-white" : ""}`}
                      onClick={() => setAmount(v)}
                    >
                      {fmtLyd(v, locale)}
                    </button>
                  ))}
                </div>
                <p className="text-sm text-muted mt-3">
                  {c.deduct(
                    fmtNum(locale, pointsNeeded),
                    points != null ? fmtNum(locale, points) : null,
                  )}
                </p>
                {!affordable ? (
                  <p className="text-sm font-bold text-danger mt-1">{c.notEnough}</p>
                ) : null}
                <button
                  className="btn-primary w-full !py-2 !text-sm mt-4 disabled:opacity-40"
                  disabled={busy || !affordable}
                  onClick={issue}
                >
                  {busy ? "…" : c.issue}
                </button>
                <p className="text-[11px] text-faint mt-2 leading-relaxed">
                  {c.issueNote(dir?.voucherMinutes ?? 30)}
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
  const locale = useLocale();
  const c = copy[locale];
  const [left, setLeft] = useState("");
  useEffect(() => {
    const update = () => {
      const ms = new Date(voucher.expiresAt).getTime() - Date.now();
      if (ms <= 0) return setLeft(c.expired);
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setLeft(c.validFor(`${m}:${String(s).padStart(2, "0")}`));
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [voucher.expiresAt, c]);

  return (
    <div className="text-center">
      <p className="text-xs font-bold text-faint">{c.showAtTill}</p>
      <div
        className="text-4xl font-extrabold text-sea tracking-[0.3em] my-3 tabular-nums"
        dir="ltr"
      >
        {voucher.code}
      </div>
      <p className="font-bold text-sea">
        {fmtLyd(voucher.value, locale)} — <span {...AR_TEXT}>{voucher.partnerName}</span>
      </p>
      <p className="text-sm text-link font-bold mt-1">{left}</p>
      <p className="text-[11px] text-faint mt-3 leading-relaxed">{c.voucherTerms}</p>
      <button className="chip mt-4" onClick={onClose}>
        {c.done}
      </button>
    </div>
  );
}
