"use client";
/**
 * Ciao Business — the standalone internal console.
 *
 * The root of this origin is the console itself: everyone who reaches it is
 * either signed in and working, or gets sent to the sign-in screen. One place
 * to run the company — what needs attention today, the supply catalogue, the
 * money, the people, the imagery and settings that steer the public app, the
 * audit trail, and each operator's own account security.
 *
 * The role shown here is decoded from the access token for display only —
 * every endpoint re-checks the capability server-side, so a tampered token
 * buys nothing but a differently-shaped screen. Which tabs appear follows the
 * same shared matrix the server enforces (`bizCapabilitiesFor`), so the screen
 * never advertises a door the API would slam.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useRouter } from "@/lib/locale";
import { localePath, type Locale } from "@/lib/i18n";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { bizCapabilitiesFor, type BizCapability } from "@ciao/shared";
import { ensureSession, sessionRole, signOut } from "@/lib/api";
import { OverviewTab } from "./overview";
import { CatalogueTab } from "./catalogue";
import { LeadsTab } from "./leads";
import { WaitlistTab } from "./waitlist";
import { FinanceTab } from "./finance";
import { PeopleTab } from "./people";
import { SettingsTab } from "./settings";
import { AuditTab } from "./audit";
import { LoyaltyTab } from "./loyalty";
import { PromosTab } from "./promos";
import { MessagingTab } from "./messaging";
import { SecurityTab } from "./security";
import { BrandMessageTab } from "./brand-message";

const TAB_KEYS = [
  "overview",
  "catalogue",
  "leads",
  "waitlist",
  "finance",
  "people",
  "loyalty",
  "promos",
  "brandMessage",
  "messaging",
  "settings",
  "audit",
  "security",
] as const;

type TabKey = (typeof TAB_KEYS)[number];

const TAB_EMOJI: Record<TabKey, string> = {
  overview: "📊",
  catalogue: "🏝",
  leads: "📇",
  waitlist: "⏳",
  finance: "💰",
  people: "👥",
  loyalty: "⭐",
  promos: "🎟",
  brandMessage: "✨",
  messaging: "📨",
  settings: "⚙️",
  audit: "📜",
  security: "🔒",
};

/**
 * Which capability opens which tab. `security` is deliberately absent: every
 * signed-in person can change their own password and see their own devices —
 * gating that would mean the person least able to get help is the one who
 * cannot lock their own account.
 */
const TAB_CAPABILITY: Record<Exclude<TabKey, "security">, BizCapability> = {
  overview: "overview",
  catalogue: "catalogue",
  // A lead is supply before it is anything else, and it carries a phone
  // number — so it sits with the catalogue and stays out of finance's reach.
  leads: "catalogue",
  // Unmet demand is a supply fact — which venue to sign next, which owner to
  // ring about opening dates — and it carries phone numbers too. Same door.
  waitlist: "catalogue",
  finance: "finance",
  people: "people",
  loyalty: "marketing",
  promos: "marketing",
  // Words on the home page. A wrong one is embarrassing until it is fixed
  // and nothing else, so it sits with the other marketing screens rather
  // than behind `govern` — which would only guarantee the greeting goes up
  // late, the one way a greeting can actually fail.
  brandMessage: "marketing",
  messaging: "settings",
  settings: "settings",
  audit: "audit",
};

const copy = {
  ar: {
    tabs: {
      overview: "نظرة عامة",
      catalogue: "الأنشطة",
      leads: "طلبات الأماكن",
      waitlist: "قائمة الانتظار",
      finance: "المالية",
      people: "المستخدمون",
      loyalty: "النقاط والشركاء",
      promos: "أكواد الخصم",
      brandMessage: "رسالة الواجهة",
      messaging: "رسائل واتساب",
      settings: "الإعدادات",
      audit: "سجل التدقيق",
      security: "الأمان",
    },
    brand: "تشاو بزنس",
    tagline: "النظام الداخلي لإدارة المنصّة",
    signOut: "خروج",
    checking: "جارٍ التحقق من الصلاحية…",
    roles: { admin: "مدير", ops: "عمليات", finance: "مالية" } as Record<string, string>,
  },
  en: {
    tabs: {
      overview: "Overview",
      catalogue: "Businesses",
      leads: "Place requests",
      waitlist: "Waitlist",
      finance: "Finance",
      people: "Users",
      loyalty: "Points & partners",
      promos: "Promo codes",
      brandMessage: "Home message",
      messaging: "WhatsApp messages",
      settings: "Settings",
      audit: "Audit log",
      security: "Security",
    },
    brand: "Ciao Business",
    tagline: "Internal platform administration",
    signOut: "Sign out",
    checking: "Checking your access…",
    roles: { admin: "Admin", ops: "Operations", finance: "Finance" } as Record<string, string>,
  },
} satisfies Record<Locale, unknown>;

function BizConsole() {
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>((params.get("tab") as TabKey) ?? "overview");
  const [state, setState] = useState<"loading" | "ready">("loading");
  const [role, setRole] = useState("");

  useEffect(() => {
    ensureSession().then((ok) => {
      /*
       * Not signed in → the console's own login, never the marketplace's.
       * There is no "denied" screen on this product: an account that can sign
       * in here holds a console role by construction, because login itself
       * refuses anyone who does not.
       */
      if (!ok) return router.push("/login");
      setRole(sessionRole());
      setState("ready");
    });
  }, [router]);

  const caps = new Set(bizCapabilitiesFor(role));
  const visibleTabs = TAB_KEYS.filter(
    (key) => key === "security" || caps.has(TAB_CAPABILITY[key]),
  );

  // A tab the role cannot see (a saved URL, a demotion since the bookmark) —
  // fall back to the first tab this role does have.
  const activeTab = visibleTabs.includes(tab) ? tab : (visibleTabs[0] ?? "security");

  function go(next: TabKey) {
    setTab(next);
    // Through `localePath`, or an English operator switching tab is silently
    // dropped back onto the Arabic console.
    window.history.replaceState(null, "", localePath(`/?tab=${next}`, locale));
  }

  async function onSignOut() {
    await signOut();
    router.push("/login");
  }

  const isAdmin = role === "admin";

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="font-bold text-sea leading-tight">{c.brand}</h1>
            <p className="text-[11px] text-faint">
              {c.tagline}
              {role ? ` · ${c.roles[role] ?? role}` : ""}
            </p>
          </div>
        </div>
        <nav className="flex items-center gap-2 text-xs font-bold text-sea">
          <button className="chip" onClick={onSignOut}>
            {c.signOut}
          </button>
          <LanguageToggle />
        </nav>
      </header>

      {state === "loading" ? (
        <p className="p-4 text-faint">{c.checking}</p>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
            {visibleTabs.map((key) => (
              <button
                key={key}
                onClick={() => go(key)}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  activeTab === key ? "bg-sea text-white" : "bg-surface text-muted hover:bg-sand"
                }`}
              >
                <span aria-hidden>{TAB_EMOJI[key]}</span>
                {c.tabs[key]}
              </button>
            ))}
          </div>

          <div className="mt-3">
            {activeTab === "overview" ? <OverviewTab /> : null}
            {activeTab === "catalogue" ? <CatalogueTab /> : null}
            {activeTab === "leads" ? <LeadsTab /> : null}
            {activeTab === "waitlist" ? <WaitlistTab /> : null}
            {activeTab === "finance" ? <FinanceTab /> : null}
            {activeTab === "people" ? <PeopleTab isAdmin={isAdmin} /> : null}
            {activeTab === "loyalty" ? <LoyaltyTab isAdmin={isAdmin} /> : null}
            {activeTab === "promos" ? <PromosTab isAdmin={isAdmin} /> : null}
            {activeTab === "brandMessage" ? <BrandMessageTab /> : null}
            {activeTab === "messaging" ? <MessagingTab isAdmin={isAdmin} /> : null}
            {activeTab === "settings" ? <SettingsTab isAdmin={isAdmin} /> : null}
            {activeTab === "audit" ? <AuditTab /> : null}
            {activeTab === "security" ? <SecurityTab onSignedOut={onSignOut} /> : null}
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
