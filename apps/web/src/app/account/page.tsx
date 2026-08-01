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
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/logo";
import { ApiError, api, ensureSession, fmtLyd, fmtLydPrecise } from "@/lib/api";
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
  ["overview", "🪪", "حسابي"],
  ["wallet", "👛", "المحفظة"],
  ["points", "⭐", "النقاط والدعوات"],
  ["inbox", "✉️", "الرسائل"],
  ["security", "🔐", "الأمان"],
  ["settings", "⚙️", "التفضيلات"],
] as const;

type TabKey = (typeof TABS)[number][0];

function AccountScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>((params.get("tab") as TabKey) ?? "overview");
  const [data, setData] = useState<AccountData | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<AccountData>("/v1/me/account"));
    } catch (e) {
      setErr(e instanceof ApiError ? "تعذر تحميل الحساب" : "تعذر الاتصال");
    }
  }, []);

  useEffect(() => {
    ensureSession().then((ok) => {
      if (!ok) return router.push("/login?next=/account");
      void load();
    });
  }, [router, load]);

  function go(next: TabKey) {
    setTab(next);
    window.history.replaceState(null, "", `/account?tab=${next}`);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/">
          <Logo size={34} />
        </Link>
        <nav className="flex items-center gap-2 text-xs font-bold text-sea">
          <Link href="/my" className="chip">حجوزاتي</Link>
          <Link href="/wishlist" className="chip">المفضلة</Link>
        </nav>
      </header>

      {err ? <p className="p-4 text-red-700 font-bold">{err}</p> : null}
      {!data && !err ? <p className="p-4 text-sea/60">جارٍ التحميل…</p> : null}

      {data ? (
        <>
          <div className="card p-4 mb-3">
            <h1 className="font-bold text-lg text-sea">
              {data.displayName || "أهلًا بك في تشاو"}
            </h1>
            <p className="text-xs text-sea/55 mt-0.5" dir="ltr">
              {data.phone}
            </p>
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              <MiniStat label="رصيد المحفظة" value={fmtLyd(data.wallet.creditBalance)} />
              <MiniStat label="نقاطك" value={data.loyalty.points.toLocaleString("ar-LY")} />
              <MiniStat label="إقامات مكتملة" value={String(data.completedStays)} />
            </div>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
            {TABS.map(([key, emoji, label]) => (
              <button
                key={key}
                onClick={() => go(key)}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  tab === key ? "bg-sea text-white" : "bg-white text-sea/70 hover:bg-sand"
                }`}
              >
                <span aria-hidden>{emoji}</span>
                {label}
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
      <div className="text-[11px] font-bold text-sea/55">{label}</div>
      <div className="font-extrabold text-sea tabular-nums">{value}</div>
    </div>
  );
}

/** The overview earns its place by telling you what to do next, not by repeating numbers. */
function Overview({ data, onGo }: { data: AccountData; onGo: (t: TabKey) => void }) {
  const todo: { title: string; body: string; action: string; go: TabKey }[] = [];

  if (!data.email || !data.emailVerified)
    todo.push({
      title: "وثّق بريدك الإلكتروني",
      body: `قناة تصلك حتى لو غيّرت رقمك أو ضاعت شريحتك — واكسب ${data.loyalty.rules.email_verified} نقطة.`,
      action: "أضف البريد",
      go: "settings",
    });
  if (data.passkeys === 0)
    todo.push({
      title: "فعّل الدخول بالبصمة",
      body: "بدل انتظار رمز يصل برسالة — البصمة تشتغل حتى بدون شبكة، وهي أأمن لمحفظتك.",
      action: "فعّل البصمة",
      go: "security",
    });
  if (data.loyalty.points >= data.loyalty.minRedeem)
    todo.push({
      title: "نقاطك تكفي للتحويل",
      body: `عندك ${data.loyalty.points.toLocaleString("ar-LY")} نقطة — تساوي ${fmtLydPrecise(
        data.loyalty.worthDirhams,
      )} رصيدًا في محفظتك.`,
      action: "حوّل النقاط",
      go: "points",
    });
  if (data.unreadMessages)
    todo.push({
      title: `عندك ${data.unreadMessages} رسالة غير مقروءة`,
      body: "رسائل من المضيفين أو من فريق تشاو.",
      action: "افتح الرسائل",
      go: "inbox",
    });

  return (
    <div className="space-y-3">
      {todo.length ? (
        todo.map((t) => (
          <div key={t.title} className="card p-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-sea text-sm">{t.title}</h3>
              <p className="text-xs text-sea/70 mt-1 leading-relaxed">{t.body}</p>
            </div>
            <button className="chip shrink-0 !bg-amber !text-sea-dark" onClick={() => onGo(t.go)}>
              {t.action}
            </button>
          </div>
        ))
      ) : (
        <div className="card p-4">
          <p className="font-bold text-sea text-sm">حسابك مكتمل ✅</p>
          <p className="text-xs text-sea/70 mt-1">
            البصمة مفعّلة، بريدك موثّق، ولا رسائل تنتظرك. عضويتك منذ{" "}
            {new Date(data.memberSince).toLocaleDateString("ar-LY")}.
          </p>
        </div>
      )}

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm">كيف تكسب النقاط</h3>
        <ul className="text-xs text-sea/70 mt-2 space-y-1">
          {[
            ["إتمام إقامة", data.loyalty.rules.stay_completed],
            ["كتابة تقييم بعد الإقامة", data.loyalty.rules.review_written],
            ["صديق دعوته أتمّ أول حجز", data.loyalty.rules.referral_qualified],
            ["توثيق البريد الإلكتروني", data.loyalty.rules.email_verified],
          ].map(([label, pts]) => (
            <li key={String(label)} className="flex items-center justify-between">
              <span>{label}</span>
              <span className="font-bold text-sea tabular-nums">+{pts}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-sea/45 mt-2 leading-relaxed">
          كل ١٠٠٠ نقطة = ١ د.ل رصيد. النقاط تُكتسب بما تفعله فعلًا — لا نمنح نقاطًا مقابل التسجيل
          وحده حتى لا تُستغل بحسابات وهمية.
        </p>
      </div>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sea/60">…</p>}>
      <AccountScreen />
    </Suspense>
  );
}
