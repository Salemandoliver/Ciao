"use client";
/**
 * The member account.
 *
 * Signing up is never a toll gate: everything in Ciao is bookable with a phone
 * number and an OTP. This screen is what an account *adds* — a wallet, points,
 * an inbox, a fingerprint instead of an SMS code, and preferences we were told
 * rather than inferred.
 *
 * It is one screen with tabs rather than six pages because the person opening
 * it is usually checking one number on a bad connection, and every extra
 * navigation is another round trip on Libyan 3G (§12.3).
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link, useHref, useLocale, useRouter } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { ApiError, api, ensureSession, fmtLyd, fmtLydPrecise } from "@/lib/api";
import { fmtDate, fmtNum } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { WalletTab } from "./wallet";
import { PointsTab } from "./points";
import { InboxTab } from "./inbox";
import { SettingsTab } from "./settings";
import { SecurityTab } from "./security";

export interface AccountData {
  id: string;
  phone: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  memberSince: string;
  completedStays: number;
  wallet: { creditBalance: number };
  loyalty: {
    points: number;
    worthDirhams: number;
    minRedeem: number;
    rules: Record<string, number>;
  };
  preferences: {
    locale: string;
    theme: string;
    preferredRail: string | null;
    notifyWhatsapp: boolean;
    notifySms: boolean;
    notifyInApp: boolean;
    marketingOptIn: boolean;
    earlyAccessOptIn: boolean;
    favouriteAreas: string[];
  };
  passkeys: number;
  unreadMessages: number;
}

const TABS = [
  ["overview", "🪪"],
  ["wallet", "👛"],
  ["points", "⭐"],
  ["inbox", "✉️"],
  ["security", "🔐"],
  ["settings", "⚙️"],
] as const;

type TabKey = (typeof TABS)[number][0];

const copy = {
  ar: {
    myBookings: "حجوزاتي",
    wishlist: "المفضلة",
    loadFailed: "تعذر تحميل الحساب",
    offline: "تعذر الاتصال",
    loading: "جارٍ التحميل…",
    welcome: "أهلًا بك في تشاو",
    tabs: {
      overview: "حسابي",
      wallet: "المحفظة",
      points: "النقاط والدعوات",
      inbox: "الرسائل",
      security: "الأمان",
      settings: "التفضيلات",
    } as Record<TabKey, string>,
    walletBalance: "رصيد المحفظة",
    yourPoints: "نقاطك",
    staysDone: "إقامات مكتملة",
    emailTitle: "وثّق بريدك الإلكتروني",
    emailBody: (pts: number) =>
      `قناة تصلك حتى لو غيّرت رقمك أو ضاعت شريحتك — واكسب ${pts} نقطة.`,
    emailAction: "أضف البريد",
    passkeyTitle: "فعّل الدخول بالبصمة",
    passkeyBody:
      "بدل انتظار رمز يصل برسالة — البصمة تشتغل حتى بدون شبكة، وهي أأمن لمحفظتك.",
    passkeyAction: "فعّل البصمة",
    redeemTitle: "نقاطك تكفي للتحويل",
    redeemBody: (points: string, worth: string) =>
      `عندك ${points} نقطة — تساوي ${worth} رصيدًا في محفظتك.`,
    redeemAction: "حوّل النقاط",
    unreadTitle: (n: number) => `عندك ${n} رسالة غير مقروءة`,
    unreadBody: "رسائل من المضيفين أو من فريق تشاو.",
    unreadAction: "افتح الرسائل",
    doneTitle: "حسابك مكتمل ✅",
    doneBody: (since: string) =>
      `البصمة مفعّلة، بريدك موثّق، ولا رسائل تنتظرك. عضويتك منذ ${since}.`,
    earnTitle: "كيف تكسب النقاط",
    earnStay: "إتمام إقامة",
    earnReview: "كتابة تقييم بعد الإقامة",
    earnReferral: "صديق دعوته أتمّ أول حجز",
    earnEmail: "توثيق البريد الإلكتروني",
    earnNote:
      "كل ١٠٠٠ نقطة = ١ د.ل رصيد. النقاط تُكتسب بما تفعله فعلًا — لا نمنح نقاطًا مقابل التسجيل وحده حتى لا تُستغل بحسابات وهمية.",
  },
  en: {
    myBookings: "My bookings",
    wishlist: "Saved",
    loadFailed: "Could not load your account",
    offline: "Could not connect",
    loading: "Loading…",
    welcome: "Welcome to Ciao",
    tabs: {
      overview: "Account",
      wallet: "Wallet",
      points: "Points & invites",
      inbox: "Messages",
      security: "Security",
      settings: "Preferences",
    } as Record<TabKey, string>,
    walletBalance: "Wallet balance",
    yourPoints: "Your points",
    staysDone: "Completed stays",
    emailTitle: "Verify your email",
    emailBody: (pts: number) =>
      `A way to reach you even if you change your number or lose your SIM — and it earns you ${pts} points.`,
    emailAction: "Add email",
    passkeyTitle: "Turn on fingerprint sign-in",
    passkeyBody:
      "No waiting for a code by message — a fingerprint works with no signal at all, and it is safer for your wallet.",
    passkeyAction: "Turn it on",
    redeemTitle: "You have enough points to convert",
    redeemBody: (points: string, worth: string) =>
      `You have ${points} points — worth ${worth} of credit in your wallet.`,
    redeemAction: "Convert points",
    unreadTitle: (n: number) => `You have ${n} unread message${n === 1 ? "" : "s"}`,
    unreadBody: "Messages from hosts or from the Ciao team.",
    unreadAction: "Open messages",
    doneTitle: "Your account is all set ✅",
    doneBody: (since: string) =>
      `Fingerprint on, email verified, nothing waiting for you. A member since ${since}.`,
    earnTitle: "How you earn points",
    earnStay: "Completing a stay",
    earnReview: "Writing a review after your stay",
    earnReferral: "A friend you invited finishes their first booking",
    earnEmail: "Verifying your email",
    earnNote:
      "Every 1,000 points = 1 LYD of credit. Points come from things you actually do — signing up on its own earns nothing, so the scheme cannot be farmed with fake accounts.",
  },
} satisfies Record<Locale, unknown>;

function AccountScreen() {
  const locale = useLocale();
  const c = copy[locale];
  const href = useHref();
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>((params.get("tab") as TabKey) ?? "overview");
  const [data, setData] = useState<AccountData | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<AccountData>("/v1/me/account"));
    } catch (e) {
      setErr(e instanceof ApiError ? c.loadFailed : c.offline);
    }
  }, [c]);

  useEffect(() => {
    ensureSession().then((ok) => {
      if (!ok) return router.push("/login?next=/account");
      void load();
    });
  }, [router, load]);

  function go(next: TabKey) {
    setTab(next);
    // Hand-written URL, so it needs the locale prefix put back on: a shared
    // English link that drops the `/en` sends the reader into Arabic.
    window.history.replaceState(null, "", href(`/account?tab=${next}`));
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/">
          <Logo />
        </Link>
        <nav className="flex items-center gap-2 text-xs font-bold text-sea">
          <Link href="/my" className="chip">{c.myBookings}</Link>
          <Link href="/wishlist" className="chip">{c.wishlist}</Link>
          <LanguageToggle className="!text-xs" />
        </nav>
      </header>

      {err ? <p className="p-4 text-danger font-bold">{err}</p> : null}
      {!data && !err ? <p className="p-4 text-faint">{c.loading}</p> : null}

      {data ? (
        <>
          <div className="card p-4 mb-3">
            <h1 className="font-bold text-lg text-sea">{data.displayName || c.welcome}</h1>
            <p className="text-xs text-faint mt-0.5" dir="ltr">
              {data.phone}
            </p>
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              <MiniStat
                label={c.walletBalance}
                value={fmtLyd(data.wallet.creditBalance, locale)}
              />
              <MiniStat label={c.yourPoints} value={fmtNum(locale, data.loyalty.points)} />
              <MiniStat label={c.staysDone} value={fmtNum(locale, data.completedStays)} />
            </div>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
            {TABS.map(([key, emoji]) => (
              <button
                key={key}
                onClick={() => go(key)}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  tab === key ? "bg-sea text-white" : "bg-surface text-muted hover:bg-sand"
                }`}
              >
                <span aria-hidden>{emoji}</span>
                {c.tabs[key]}
                {key === "inbox" && data.unreadMessages ? (
                  <span className="rounded-full bg-amber text-sea-dark px-1.5 text-[10px]">
                    {data.unreadMessages}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="mt-3">
            {tab === "overview" ? <Overview data={data} onGo={go} /> : null}
            {tab === "wallet" ? <WalletTab /> : null}
            {tab === "points" ? <PointsTab onChange={load} /> : null}
            {tab === "inbox" ? <InboxTab onRead={load} /> : null}
            {tab === "security" ? <SecurityTab data={data} onChange={load} /> : null}
            {tab === "settings" ? <SettingsTab data={data} onChange={load} /> : null}
          </div>
        </>
      ) : null}
    </main>
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

/** The overview earns its place by telling you what to do next, not by repeating numbers. */
function Overview({ data, onGo }: { data: AccountData; onGo: (t: TabKey) => void }) {
  const locale = useLocale();
  const c = copy[locale];
  const todo: { title: string; body: string; action: string; go: TabKey }[] = [];

  if (!data.email || !data.emailVerified)
    todo.push({
      title: c.emailTitle,
      body: c.emailBody(data.loyalty.rules.email_verified),
      action: c.emailAction,
      go: "settings",
    });
  if (data.passkeys === 0)
    todo.push({
      title: c.passkeyTitle,
      body: c.passkeyBody,
      action: c.passkeyAction,
      go: "security",
    });
  if (data.loyalty.points >= data.loyalty.minRedeem)
    todo.push({
      title: c.redeemTitle,
      body: c.redeemBody(
        fmtNum(locale, data.loyalty.points),
        fmtLydPrecise(data.loyalty.worthDirhams, locale),
      ),
      action: c.redeemAction,
      go: "points",
    });
  if (data.unreadMessages)
    todo.push({
      title: c.unreadTitle(data.unreadMessages),
      body: c.unreadBody,
      action: c.unreadAction,
      go: "inbox",
    });

  return (
    <div className="space-y-3">
      {todo.length ? (
        todo.map((t) => (
          <div key={t.title} className="card p-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-sea text-sm">{t.title}</h3>
              <p className="text-xs text-muted mt-1 leading-relaxed">{t.body}</p>
            </div>
            <button className="chip shrink-0 !bg-amber !text-sea-dark" onClick={() => onGo(t.go)}>
              {t.action}
            </button>
          </div>
        ))
      ) : (
        <div className="card p-4">
          <p className="font-bold text-sea text-sm">{c.doneTitle}</p>
          <p className="text-xs text-muted mt-1">{c.doneBody(fmtDate(locale, data.memberSince))}</p>
        </div>
      )}

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm">{c.earnTitle}</h3>
        <ul className="text-xs text-muted mt-2 space-y-1">
          {[
            [c.earnStay, data.loyalty.rules.stay_completed],
            [c.earnReview, data.loyalty.rules.review_written],
            [c.earnReferral, data.loyalty.rules.referral_qualified],
            [c.earnEmail, data.loyalty.rules.email_verified],
          ].map(([label, pts]) => (
            <li key={String(label)} className="flex items-center justify-between">
              <span>{label}</span>
              <span className="font-bold text-sea tabular-nums">+{pts}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-faint mt-2 leading-relaxed">{c.earnNote}</p>
      </div>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<p className="p-6 text-faint">…</p>}>
      <AccountScreen />
    </Suspense>
  );
}
