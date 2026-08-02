"use client";
/**
 * Ciao Partner — the control panel for the people who supply this marketplace.
 *
 * The audience is a man with six chalets and a notebook, a hall with three
 * staff and a Facebook page, and a make-up artist doing four brides on a
 * Thursday morning. Almost none of them has a booking system today. So this is
 * built as a business tool that happens to be connected to a marketplace,
 * rather than as a marketplace's supplier portal — which is why the diary holds
 * their whole book, including the work Ciao had nothing to do with.
 *
 * Two consequences visible on every screen below:
 *
 *  - **Today comes first.** The default tab is the day, not a dashboard. A
 *    make-up artist opening this at seven in the morning wants to know where
 *    she is going and who owes her, and she is standing up while she reads it.
 *  - **The tabs follow the capability, not the role name.** A member of staff
 *    simply does not have money screens; they are absent rather than present
 *    and refusing, because a screen that exists to say no is a screen that
 *    invites someone to find the way around it.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link, useLocale, useRouter } from "@/lib/locale";
import { localePath, type Locale } from "@/lib/i18n";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { ApiError, api, clearTokens, ensureSession } from "@/lib/api";
import { hostText, textProps } from "@/lib/content";
import { TodayTab } from "./today";
import { CalendarTab } from "./calendar";
import { JobsTab } from "./jobs";
import { QuotesTab } from "./quotes";
import { ClientsTab } from "./clients";
import { MoneyTab } from "./money";
import { InsightsTab } from "./insights";
import { TeamTab } from "./team";
import { SettingsTab } from "./settings";
import type { PartnerMe } from "./types";

const TAB_KEYS = [
  "today",
  "calendar",
  "jobs",
  "quotes",
  "clients",
  "money",
  "insights",
  "team",
  "settings",
] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TAB_EMOJI: Record<TabKey, string> = {
  today: "☀️",
  calendar: "🗓",
  jobs: "📋",
  quotes: "🧾",
  clients: "👤",
  money: "💰",
  insights: "📈",
  team: "👥",
  settings: "⚙️",
};

/** Which capability each tab needs. Absent capability, absent tab. */
const TAB_CAPABILITY: Record<TabKey, "diary" | "clients" | "money" | "settings" | "admin"> = {
  today: "diary",
  calendar: "diary",
  jobs: "diary",
  quotes: "diary",
  clients: "clients",
  money: "money",
  insights: "money",
  team: "admin",
  settings: "settings",
};

const copy = {
  ar: {
    brand: "تشاو للشركاء",
    tagline: "كل حجوزاتك في مكان واحد",
    tabs: {
      today: "اليوم",
      calendar: "التقويم",
      jobs: "الحجوزات",
      quotes: "العروض",
      clients: "الزبائن",
      money: "الفلوس",
      insights: "الأرقام",
      team: "الفريق",
      settings: "الإعدادات",
    },
    app: "التطبيق",
    checking: "جارٍ التحقق…",
    loadFailed: "تعذر التحميل — تأكد من الاتصال وأعد المحاولة",
    retry: "أعد المحاولة",
    deniedTitle: "هذه اللوحة لأصحاب الأنشطة",
    deniedBody:
      "ما لقينا نشاطًا مسجّلًا على رقمك. إن كنت صاحب شاليه أو استراحة أو قاعة أو تقدّم خدمة وتبي تنضم لتشاو، كلّمنا ونسجّلك.",
    otherNumber: "الدخول برقم آخر",
    backToApp: "العودة للتطبيق",
    switch: "النشاط",
  },
  en: {
    brand: "Ciao Partners",
    tagline: "Your whole diary in one place",
    tabs: {
      today: "Today",
      calendar: "Calendar",
      jobs: "Bookings",
      quotes: "Quotes",
      clients: "Clients",
      money: "Money",
      insights: "Numbers",
      team: "Team",
      settings: "Settings",
    },
    app: "The app",
    checking: "Checking…",
    loadFailed: "Could not load — check your connection and try again",
    retry: "Try again",
    deniedTitle: "This panel is for businesses",
    deniedBody:
      "We couldn't find a business registered to your number. If you run a chalet, an estiraha, a hall, or offer a service and want to join Ciao, get in touch and we'll set you up.",
    otherNumber: "Sign in with another number",
    backToApp: "Back to the app",
    switch: "Business",
  },
} satisfies Record<Locale, unknown>;

function PartnerConsole() {
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>((params.get("tab") as TabKey) ?? "today");
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [me, setMe] = useState<PartnerMe | null>(null);
  const [partnerId, setPartnerId] = useState<string | undefined>(
    params.get("partnerId") ?? undefined,
  );

  const load = useCallback(async () => {
    setState("loading");
    try {
      const data = await api<PartnerMe>(
        `/v1/partner/me${partnerId ? `?partnerId=${partnerId}` : ""}`,
      );
      setMe(data);
      setState("ready");
    } catch (e) {
      setState(e instanceof ApiError && e.status === 403 ? "denied" : "error");
    }
  }, [partnerId]);

  useEffect(() => {
    ensureSession().then((ok) => {
      if (!ok) return router.push("/login?next=/partner");
      void load();
    });
  }, [router, load]);

  function go(next: TabKey) {
    setTab(next);
    const query = partnerId ? `?tab=${next}&partnerId=${partnerId}` : `?tab=${next}`;
    // Through `localePath`, or an English-reading manager switching tab is
    // silently dropped back onto the Arabic console.
    window.history.replaceState(null, "", localePath(`/partner${query}`, locale));
  }

  const can = (cap: string) => Boolean(me?.capabilities.includes(cap as never));
  const visibleTabs = TAB_KEYS.filter((k) => can(TAB_CAPABILITY[k]));
  // A staff member landing on a URL for a tab they cannot see gets the first
  // one they can, rather than an empty page that looks broken.
  const activeTab = visibleTabs.includes(tab) ? tab : (visibleTabs[0] ?? "today");

  /*
   * The business's own name.
   *
   * Arabic-first with an optional English twin, and marked as whichever it
   * actually is — «لمسة بيوتي» rendered inside an otherwise English page has
   * to declare itself as Arabic, or a screen reader spells it out letter by
   * letter in an English accent and the browser orders it wrongly. Same rule
   * the listing titles follow.
   */
  const businessName = hostText(
    locale,
    me?.profile.businessNameAr ??
      me?.businesses.find((b) => b.partnerId === me?.partnerId)?.nameAr ??
      null,
    me?.profile.businessNameEn,
  );

  return (
    <main className="mx-auto max-w-5xl px-4 pb-20">
      <header className="flex items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/">
            <Logo />
          </Link>
          <div className="min-w-0">
            <h1
              className="font-bold text-sea leading-tight truncate"
              {...(businessName ? textProps(businessName) : {})}
            >
              {businessName?.text ?? c.brand}
            </h1>
            <p className="text-[11px] text-faint truncate">
              {businessName ? c.brand : c.tagline}
            </p>
          </div>
        </div>
        <nav className="flex items-center gap-2 text-xs font-bold text-sea shrink-0">
          <Link href="/" className="chip !text-xs">
            {c.app}
          </Link>
          <LanguageToggle />
        </nav>
      </header>

      {/*
        The business switcher only appears for someone who actually works for
        more than one — a chalet owner should never see a control implying
        there is another business they might be looking at.
      */}
      {me && me.businesses.length > 1 ? (
        <label className="flex items-center gap-2 text-xs text-faint mb-2">
          <span className="font-bold">{c.switch}</span>
          <select
            className="input !py-1.5 !text-sm !w-auto"
            value={me.partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
          >
            {me.businesses.map((b) => (
              <option key={b.partnerId} value={b.partnerId}>
                {b.nameAr ?? (b.isSelf ? c.brand : b.partnerId.slice(0, 8))}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {state === "loading" ? (
        <p className="p-4 text-faint">{c.checking}</p>
      ) : state === "error" ? (
        <div className="card p-6 text-center max-w-lg mx-auto">
          <p className="text-sm text-muted">{c.loadFailed}</p>
          <button className="btn-primary !py-2 !text-sm mt-3" onClick={() => void load()}>
            {c.retry}
          </button>
        </div>
      ) : state === "denied" ? (
        <div className="card p-6 text-center max-w-lg mx-auto">
          <p className="font-bold text-sea">{c.deniedTitle}</p>
          <p className="text-sm text-faint mt-2">{c.deniedBody}</p>
          <div className="flex flex-wrap gap-2 justify-center mt-4">
            <button
              className="btn-primary !py-2 !text-sm"
              onClick={() => {
                clearTokens();
                router.push("/login?next=/partner");
              }}
            >
              {c.otherNumber}
            </button>
            <Link href="/" className="chip">
              {c.backToApp}
            </Link>
          </div>
        </div>
      ) : me ? (
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
            {activeTab === "today" ? <TodayTab me={me} onGo={go} /> : null}
            {activeTab === "calendar" ? <CalendarTab me={me} /> : null}
            {activeTab === "jobs" ? <JobsTab me={me} /> : null}
            {activeTab === "quotes" ? <QuotesTab me={me} /> : null}
            {activeTab === "clients" ? <ClientsTab me={me} /> : null}
            {activeTab === "money" ? <MoneyTab me={me} /> : null}
            {activeTab === "insights" ? <InsightsTab me={me} onReload={load} /> : null}
            {activeTab === "team" ? <TeamTab me={me} /> : null}
            {activeTab === "settings" ? <SettingsTab me={me} onSaved={load} /> : null}
          </div>
        </>
      ) : null}
    </main>
  );
}

export default function PartnerPage() {
  return (
    <Suspense fallback={<p className="p-6 text-faint">…</p>}>
      <PartnerConsole />
    </Suspense>
  );
}
