"use client";
/**
 * Points and invitations.
 *
 * Two deliberate choices show up here. Points are earned for things that
 * actually happened — a completed stay, a written review, an invited friend who
 * turned up — not for signing up, because paying for signups in a market this
 * size is paying for SIM cards. And the invite text is pre-written for the
 * language the sender is reading, because this gets pasted into WhatsApp, not
 * emailed: the Arabic comes from the server, the English is written here.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd, fmtLydPrecise } from "@/lib/api";
import { Link, useLocale } from "@/lib/locale";
import { fmtDate, fmtNum } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

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

const copy = {
  ar: {
    loading: "جارٍ التحميل…",
    loadFailed: "تعذر التحميل",
    redeemed: (amount: string) => `✅ أُضيف ${amount} إلى محفظتك`,
    minRedeem: (n: string) => `أقل مبلغ للتحويل ${n} نقطة`,
    redeemFailed: "تعذر التحويل",
    claimed: "✅ سُجّلت الدعوة — تُصرف المكافأة بعد أول إقامة تكملها",
    unknownCode: "الكود غير صحيح",
    alreadyReferred: "حسابك مرتبط بدعوة سابقة",
    ownCode: "لا يمكنك استخدام كودك أنت",
    claimFailed: "تعذر تسجيل الدعوة",
    shareTitle: "تشاو",
    shareCopied: "✅ نُسخت الدعوة — الصقها في واتساب",
    yourPoints: "نقاطك",
    worth: (amount: string) => `تساوي ${amount} رصيدًا`,
    convert: "حوّل نقاطك إلى رصيد",
    needMore: (n: string) => `تحتاج ${n} نقطة للتحويل`,
    inviteTitle: "ادعُ أصدقاءك",
    inviteBody: (n: string) =>
      `تكسب ${n} نقطة عن كل صديق يكمل أول حجز له — لا عند تسجيله فقط. وهو أيضًا يكسب نقاطًا ترحيبية.`,
    share: "شارك",
    invited: "دعوات",
    joined: "انضموا",
    rewarded: "مكافآت مصروفة",
    privacyNote: "لا نعرض لك أسماء من قبِل دعوتك — نعرض العدد فقط، احترامًا لخصوصيتهم.",
    haveCode: "عندك كود دعوة؟",
    register: "تسجيل",
    spendTitle: "اصرف نقاطك",
    terms: "شروط البرنامج ←",
    spendBody:
      "حوّلها إلى رصيد داخل تشاو، أو اصرفها عند أحد شركائنا — مقهى داخل المنتجع، مخبز، أو مطعم.",
    spendCta: "☕ اصرف عند شريك",
    history: "سجلّ النقاط",
    noHistory: "لا حركات بعد.",
  },
  en: {
    loading: "Loading…",
    loadFailed: "Could not load your points",
    redeemed: (amount: string) => `✅ ${amount} added to your wallet`,
    minRedeem: (n: string) => `The least you can convert is ${n} points`,
    redeemFailed: "Could not convert your points",
    claimed: "✅ Invite registered — the reward is paid after your first completed stay",
    unknownCode: "That code is not right",
    alreadyReferred: "Your account is already linked to an earlier invite",
    ownCode: "You cannot use your own code",
    claimFailed: "Could not register the invite",
    shareTitle: "Ciao",
    shareCopied: "✅ Invite copied — paste it into WhatsApp",
    yourPoints: "Your points",
    worth: (amount: string) => `Worth ${amount} in credit`,
    convert: "Convert your points to credit",
    needMore: (n: string) => `You need ${n} points to convert`,
    inviteTitle: "Invite your friends",
    inviteBody: (n: string) =>
      `You earn ${n} points for every friend who completes their first booking — not for signing up alone. They get welcome points too.`,
    share: "Share",
    invited: "Invited",
    joined: "Joined",
    rewarded: "Rewards paid",
    privacyNote:
      "We never show you who accepted your invite — only how many, out of respect for their privacy.",
    haveCode: "Got an invite code?",
    register: "Register",
    spendTitle: "Spend your points",
    terms: "Programme terms →",
    spendBody:
      "Turn them into Ciao credit, or spend them with one of our partners — a café at the resort, a bakery, a restaurant.",
    spendCta: "☕ Spend with a partner",
    history: "Points history",
    noHistory: "Nothing yet.",
  },
} satisfies Record<Locale, unknown>;

/** The invite as it will land in a WhatsApp thread, in the sender's language. */
function shareText(locale: Locale, ref: Referrals): string {
  if (locale === "ar") return ref.shareTextAr;
  return `I book chalets, estirahas and wedding halls on Ciao — every place is visited and verified in person. Use my code ${ref.code} and we both earn points: ${ref.shareUrl}`;
}

export function PointsTab({ onChange }: { onChange: () => void | Promise<void> }) {
  const locale = useLocale();
  const c = copy[locale];
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
      setMsg(c.loadFailed);
    }
  }, [c]);

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
      setMsg(c.redeemed(fmtLyd(res.dirhams, locale)));
      await load();
      await onChange();
    } catch (e) {
      setMsg(
        e instanceof ApiError && e.message.includes("min_redeem")
          ? c.minRedeem(fmtNum(locale, points.minRedeem))
          : c.redeemFailed,
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
      setMsg(c.claimed);
      setClaimCode("");
      await load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : "";
      setMsg(
        m.includes("unknown_code")
          ? c.unknownCode
          : m.includes("already_referred")
            ? c.alreadyReferred
            : m.includes("yourself")
              ? c.ownCode
              : c.claimFailed,
      );
    }
  }

  async function share() {
    if (!ref) return;
    const text = shareText(locale, ref);
    const payload = { title: c.shareTitle, text, url: ref.shareUrl };
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
    await navigator.clipboard?.writeText(text).catch(() => {});
    setMsg(c.shareCopied);
  }

  if (!points || !ref) return <p className="p-4 text-faint">{c.loading}</p>;

  const canRedeem = points.balance >= points.minRedeem;

  return (
    <div className="space-y-3">
      {msg ? <p className="text-sm font-bold text-sea">{msg}</p> : null}

      <div className="card p-5 text-center">
        <div className="text-xs font-bold text-faint">{c.yourPoints}</div>
        <div className="text-3xl font-extrabold text-sea mt-1 tabular-nums">
          {fmtNum(locale, points.balance)}
        </div>
        <div className="text-xs text-faint mt-1">
          {c.worth(fmtLydPrecise(points.worthDirhams, locale))}
        </div>
        <button
          className="btn-primary !py-2 !text-sm mt-3 disabled:opacity-40"
          disabled={!canRedeem || busy}
          onClick={redeem}
        >
          {busy ? "…" : canRedeem ? c.convert : c.needMore(fmtNum(locale, points.minRedeem))}
        </button>
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm">{c.inviteTitle}</h3>
        <p className="text-xs text-muted mt-1 leading-relaxed">
          {c.inviteBody(fmtNum(locale, ref.pointsPerReferral))}
        </p>
        <div className="flex items-center gap-2 mt-3">
          <code className="flex-1 rounded-xl bg-sand px-3 py-2 font-bold text-sea text-center tracking-widest" dir="ltr">
            {ref.code}
          </code>
          <button className="btn-amber !py-2 !px-4 !text-sm shrink-0" onClick={share}>
            {c.share}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          <MiniStat label={c.invited} value={fmtNum(locale, ref.invited)} />
          <MiniStat label={c.joined} value={fmtNum(locale, ref.joined)} />
          <MiniStat label={c.rewarded} value={fmtNum(locale, ref.rewarded)} />
        </div>
        <p className="text-[11px] text-faint mt-2">{c.privacyNote}</p>
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm">{c.haveCode}</h3>
        <div className="flex gap-2 mt-2">
          <input
            className="input !py-2 !text-sm"
            dir="ltr"
            placeholder="CIAOXXXXXX"
            value={claimCode}
            onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
          />
          <button className="chip shrink-0" onClick={claim} disabled={claimCode.length < 4}>
            {c.register}
          </button>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold text-sea text-sm">{c.spendTitle}</h3>
          <Link href="/rewards" className="text-[11px] font-bold text-link">
            {c.terms}
          </Link>
        </div>
        <p className="text-xs text-muted mt-1 leading-relaxed">{c.spendBody}</p>
        <Link href="/rewards/partners" className="btn-amber !py-2 !text-sm inline-block mt-3">
          {c.spendCta}
        </Link>
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm mb-2">{c.history}</h3>
        {points.history.length === 0 ? (
          <p className="text-sm text-faint">{c.noHistory}</p>
        ) : (
          <ul className="divide-y divide-sand">
            {points.history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-sea truncate">{h.label}</div>
                  <div className="text-[11px] text-faint" dir="ltr">
                    {fmtDate(locale, h.at, { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                </div>
                <span
                  className={`shrink-0 font-bold tabular-nums text-sm ${
                    h.delta > 0 ? "text-success" : "text-muted"
                  }`}
                >
                  {h.delta > 0 ? "+" : ""}
                  {fmtNum(locale, h.delta)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-sand/60 p-2">
      <div className="text-[11px] font-bold text-faint">{label}</div>
      <div className="font-extrabold text-sea tabular-nums">{value}</div>
    </div>
  );
}
