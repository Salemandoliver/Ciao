"use client";
/**
 * Ciao Business — the internal console.
 *
 * One place to run the company: what needs attention today, the supply
 * catalogue and how new businesses join it, the money, the people, the imagery
 * and settings that steer the public app, and the trail of who changed what.
 *
 * The role shown here is decoded from the access token for display only —
 * every endpoint re-checks the role server-side, so a tampered token buys
 * nothing but a differently-shaped screen.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link, useLocale, useRouter } from "@/lib/locale";
import { localePath, type Locale } from "@/lib/i18n";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { localPhone } from "@ciao/shared";
import { ApiError, api, clearTokens, ensureSession, sessionClaims, sessionRole } from "@/lib/api";
import { OverviewTab } from "./overview";
import { CatalogueTab } from "./catalogue";
import { FinanceTab } from "./finance";
import { PeopleTab } from "./people";
import { SettingsTab } from "./settings";
import { AuditTab } from "./audit";
import { LoyaltyTab } from "./loyalty";
import { PromosTab } from "./promos";

const TAB_KEYS = [
  "overview",
  "catalogue",
  "finance",
  "people",
  "loyalty",
  "promos",
  "settings",
  "audit",
] as const;

type TabKey = (typeof TAB_KEYS)[number];

const TAB_EMOJI: Record<TabKey, string> = {
  overview: "📊",
  catalogue: "🏝",
  finance: "💰",
  people: "👥",
  loyalty: "⭐",
  promos: "🎟",
  settings: "⚙️",
  audit: "📜",
};

/**
 * Console copy.
 *
 * This is an internal tool, so the English is the register an operations team
 * actually uses with each other: short labels, no reassurance, no marketing.
 * The access-denied text says plainly what privilege is missing and who can
 * grant it, because the alternative is a support message.
 */
const copy = {
  ar: {
    tabs: {
      overview: "نظرة عامة",
      catalogue: "الأنشطة",
      finance: "المالية",
      people: "المستخدمون",
      loyalty: "النقاط والشركاء",
      promos: "أكواد الخصم",
      settings: "الإعدادات",
      audit: "سجل التدقيق",
    },
    brand: "تشاو بزنس",
    tagline: "النظام الداخلي لإدارة المنصّة",
    ops: "لوحة العمليات",
    app: "التطبيق",
    checking: "جارٍ التحقق من الصلاحية…",
    deniedTitle: "هذه المنطقة لفريق تشاو الداخلي",
    signedInAs: (phone: string) => (
      <>
        أنت داخل بالرقم{" "}
        <span className="font-bold text-sea" dir="ltr">
          {phone}
        </span>{" "}
        — وهذا الحساب ليس من الفريق.
      </>
    ),
    deniedBody:
      "تحتاج صلاحية «عمليات» أو «مدير». ادخل برقم من الفريق، أو اطلب من المدير رفع صلاحية رقمك من شاشة «المستخدمون».",
    otherNumber: "الدخول برقم آخر",
    backToApp: "العودة للتطبيق",
  },
  en: {
    tabs: {
      overview: "Overview",
      catalogue: "Businesses",
      finance: "Finance",
      people: "Users",
      loyalty: "Points & partners",
      promos: "Promo codes",
      settings: "Settings",
      audit: "Audit log",
    },
    brand: "Ciao Business",
    tagline: "Internal platform administration",
    ops: "Ops board",
    app: "The app",
    checking: "Checking your access…",
    deniedTitle: "This area is for the Ciao internal team",
    signedInAs: (phone: string) => (
      <>
        You are signed in as{" "}
        <span className="font-bold text-sea" dir="ltr">
          {phone}
        </span>{" "}
        — that account is not on the team.
      </>
    ),
    deniedBody:
      "You need the Operations or Admin role. Sign in with a team number, or ask an admin to raise your number's role from the Users screen.",
    otherNumber: "Sign in with another number",
    backToApp: "Back to the app",
  },
} satisfies Record<Locale, unknown>;

function BizConsole() {
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>((params.get("tab") as TabKey) ?? "overview");
  const [state, setState] = useState<"loading" | "ready" | "denied">("loading");
  const [role, setRole] = useState("");
  const [signedInAs, setSignedInAs] = useState("");

  useEffect(() => {
    ensureSession().then(async (ok) => {
      if (!ok) return router.push("/login?next=/biz");
      try {
        // The overview is the cheapest ops-gated call — use it as the probe so
        // an under-privileged user gets one clear message, not six failures.
        await api("/v1/biz/overview?days=1");
        setState("ready");
        setRole(sessionRole());
      } catch (e) {
        setSignedInAs(sessionClaims().phone ?? "");
        setState(e instanceof ApiError && e.status === 403 ? "denied" : "ready");
      }
    });
  }, [router]);

  function go(next: TabKey) {
    setTab(next);
    // Through `localePath`, or an English operator switching tab is silently
    // dropped back onto the Arabic console.
    window.history.replaceState(null, "", localePath(`/biz?tab=${next}`, locale));
  }

  const isAdmin = role === "admin";

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Logo />
          </Link>
          <div>
            <h1 className="font-bold text-sea leading-tight">{c.brand}</h1>
            <p className="text-[11px] text-faint">{c.tagline}</p>
          </div>
        </div>
        <nav className="flex items-center gap-2 text-xs font-bold text-sea">
          <Link href="/ops" className="chip">
            {c.ops}
          </Link>
          <Link href="/" className="chip">
            {c.app}
          </Link>
          <LanguageToggle />
        </nav>
      </header>

      {state === "loading" ? (
        <p className="p-4 text-faint">{c.checking}</p>
      ) : state === "denied" ? (
        <div className="card p-6 text-center max-w-lg mx-auto">
          <p className="font-bold text-sea">{c.deniedTitle}</p>
          {signedInAs ? (
            <p className="text-sm text-faint mt-2">{c.signedInAs(localPhone(signedInAs))}</p>
          ) : null}
          <p className="text-sm text-faint mt-2">{c.deniedBody}</p>
          {/* A dead end with no way out is a support ticket. Give them the door. */}
          <div className="flex flex-wrap gap-2 justify-center mt-4">
            <button
              className="btn-primary !py-2 !text-sm"
              onClick={() => {
                clearTokens();
                router.push("/login?next=/biz");
              }}
            >
              {c.otherNumber}
            </button>
            <Link href="/" className="chip">
              {c.backToApp}
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
            {TAB_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => go(key)}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  tab === key ? "bg-sea text-white" : "bg-surface text-muted hover:bg-sand"
                }`}
              >
                <span aria-hidden>{TAB_EMOJI[key]}</span>
                {c.tabs[key]}
              </button>
            ))}
          </div>

          <div className="mt-3">
            {tab === "overview" ? <OverviewTab /> : null}
            {tab === "catalogue" ? <CatalogueTab /> : null}
            {tab === "finance" ? <FinanceTab /> : null}
            {tab === "people" ? <PeopleTab isAdmin={isAdmin} /> : null}
            {tab === "loyalty" ? <LoyaltyTab isAdmin={isAdmin} /> : null}
            {tab === "promos" ? <PromosTab isAdmin={isAdmin} /> : null}
            {tab === "settings" ? <SettingsTab isAdmin={isAdmin} /> : null}
            {tab === "audit" ? <AuditTab /> : null}
          </div>
        </>
      )}
    </main>
  );
}

export default function BizPage() {
  return (
    <Suspense fallback={<p className="p-6 text-faint">…</p>}>
      <BizConsole />
    </Suspense>
  );
}
