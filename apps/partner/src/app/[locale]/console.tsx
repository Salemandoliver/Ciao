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
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link, useLocale, useRouter } from "@/lib/locale";
import { localePath, type Locale } from "@/lib/i18n";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { ApiError, api, ensureSession, signOut } from "@/lib/api";
import { hostText, textProps } from "@/lib/content";
import { SecurityTab } from "./security";
import { TodayTab } from "./today";
import { CalendarTab } from "./calendar";
import { JobsTab } from "./jobs";
import { QuotesTab } from "./quotes";
import { ClientsTab } from "./clients";
import { MoneyTab } from "./money";
import { InsightsTab } from "./insights";
import { TeamTab } from "./team";
import { SettingsTab } from "./settings";
import { CatalogueTab } from "./catalogue";
import { OffersTab } from "./offers";
import { PlusTab } from "./plus";
import type { PartnerMe } from "./types";

/*
 * Twelve tabs, in four groups.
 *
 * The console outgrew a flat list the moment it stopped being a diary: a
 * partner now has their work, their customers, their price list and their
 * business in here, and eleven undifferentiated chips is a menu nobody reads
 * past the fourth item. Grouping costs no extra taps — every tab is still one
 * press — and gives the eye somewhere to land.
 *
 * The order inside each group is by frequency, not by importance. Today is
 * first because that is the screen someone opens standing up at seven in the
 * morning; Security is last because the day you need it you will look for it.
 */
const TAB_GROUPS = [
  { key: "work", tabs: ["today", "calendar", "jobs", "quotes"] },
  { key: "customers", tabs: ["clients", "catalogue", "offers"] },
  { key: "business", tabs: ["money", "insights", "plus"] },
  { key: "account", tabs: ["team", "settings", "security"] },
] as const;

const TAB_KEYS = TAB_GROUPS.flatMap((g) => g.tabs);
type TabKey = (typeof TAB_GROUPS)[number]["tabs"][number];

const TAB_EMOJI: Record<TabKey, string> = {
  today: "☀️",
  calendar: "🗓",
  jobs: "📋",
  quotes: "🧾",
  clients: "👤",
  catalogue: "🏷",
  offers: "🎁",
  money: "💰",
  insights: "📈",
  plus: "★",
  team: "👥",
  settings: "⚙️",
  security: "🔒",
};

/** Which capability each tab needs. Absent capability, absent tab. */
const TAB_CAPABILITY: Record<TabKey, "diary" | "clients" | "money" | "settings" | "admin"> = {
  today: "diary",
  calendar: "diary",
  jobs: "diary",
  quotes: "diary",
  clients: "clients",
  /*
   * The catalogue is `settings`, not `diary`: a price list is commercially
   * sensitive in a way a Thursday booking is not, and a receptionist reading
   * the corporate rate is how it reaches a competitor. Offers sit with it for
   * the same reason — they are pricing decisions wearing a different hat.
   */
  catalogue: "settings",
  offers: "settings",
  money: "money",
  insights: "money",
  /* Buying a year commits the business's money — owner-level, like the payout
     destination and the team. */
  plus: "admin",
  team: "admin",
  settings: "settings",
  /*
   * Everyone gets Security — including a member of staff. It is where they
   * change their own password and see the devices holding their own session,
   * and gating that behind a business capability would mean the person least
   * able to get help is the one who cannot lock their account.
   */
  security: "diary",
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
      catalogue: "ما أقدّمه",
      offers: "عروضي",
      money: "الفلوس",
      insights: "الأرقام",
      plus: "بلس",
      team: "الفريق",
      settings: "الإعدادات",
      security: "الأمان",
    },
    signOut: "خروج",
    checking: "جارٍ التحقق…",
    loadFailed: "تعذر التحميل — تأكد من الاتصال وأعد المحاولة",
    retry: "أعد المحاولة",
    deniedTitle: "حسابك ما هو مربوط بنشاط",
    deniedBody:
      "دخلت بنجاح، لكن ما في نشاط مربوط برقمك بعد. إن كنت صاحب شاليه أو استراحة أو قاعة أو تقدّم خدمة، كلّم فريق تشاو وإحنا نربطه لك.",
    otherNumber: "الدخول برقم آخر",
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
      catalogue: "What I offer",
      offers: "My offers",
      money: "Money",
      insights: "Numbers",
      plus: "Plus",
      team: "Team",
      settings: "Settings",
      security: "Security",
    },
    signOut: "Sign out",
    checking: "Checking…",
    loadFailed: "Could not load — check your connection and try again",
    retry: "Try again",
    deniedTitle: "Your account isn't linked to a business",
    deniedBody:
      "You're signed in, but no business is attached to your number yet. If you run a chalet, an estiraha, a hall or a service, talk to the Ciao team and we'll link it.",
    otherNumber: "Sign in with another number",
    switch: "Business",
  },
} satisfies Record<Locale, unknown>;

function PartnerConsole() {
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>((params.get("tab") as TabKey) ?? "today");
  const tabBar = useRef<HTMLDivElement | null>(null);
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
      if (!ok) return router.replace("/login");
      void load();
    });
  }, [router, load]);

  async function doSignOut() {
    await signOut();
    router.replace("/login");
  }

  function go(next: TabKey) {
    setTab(next);
    const query = partnerId ? `?tab=${next}&partnerId=${partnerId}` : `?tab=${next}`;
    // Through `localePath`, or an English-reading manager switching tab is
    // silently dropped back onto the Arabic console.
    window.history.replaceState(null, "", localePath(`/${query}`, locale));
  }

  /*
   * Scroll the active chip into view.
   *
   * With twelve tabs the strip is wider than a phone, and landing on a tab
   * whose chip is off-screen leaves a partner reading a page with no visible
   * indication of where they are — which reads as the app having lost its
   * place rather than theirs. Runs on tab change and on first paint, because
   * the deep link from a teaser is exactly the case that lands off-screen.
   */
  useEffect(() => {
    const el = tabBar.current?.querySelector<HTMLElement>('[aria-current="page"]');
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [tab, state]);

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
          {/*
            No link to the marketplace. This is a separate product on its own
            domain — a partner in the middle of their Thursday has no use for a
            door into a holiday-booking site, and the two sessions are
            deliberately unable to reach each other anyway.
          */}
          <button className="chip !text-xs font-bold" onClick={() => void doSignOut()}>
            {c.signOut}
          </button>
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
            <button className="btn-primary !py-2 !text-sm" onClick={() => void doSignOut()}>
              {c.otherNumber}
            </button>
          </div>
        </div>
      ) : me ? (
        <>
          <div ref={tabBar} className="flex items-center gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
            {TAB_GROUPS.map((group, gi) => {
              const tabs = group.tabs.filter((k) => visibleTabs.includes(k));
              if (tabs.length === 0) return null;
              return (
                <div key={group.key} className="flex items-center gap-1.5 shrink-0">
                  {/* A hairline, not a heading: the groups are there to give the
                      eye a rhythm, and naming them would cost a line of vertical
                      space on the screen with the least of it. */}
                  {gi > 0 ? (
                    <span className="h-4 w-px bg-sea/15 mx-0.5 shrink-0" aria-hidden />
                  ) : null}
                  {tabs.map((key) => (
                    <button
                      key={key}
                      onClick={() => go(key)}
                      aria-current={activeTab === key ? "page" : undefined}
                      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                        activeTab === key
                          ? "bg-sea text-white"
                          : "bg-surface text-muted hover:bg-sand"
                      }`}
                    >
                      <span aria-hidden>{TAB_EMOJI[key]}</span>
                      {c.tabs[key]}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="mt-3">
            {activeTab === "today" ? <TodayTab me={me} onGo={go} /> : null}
            {activeTab === "calendar" ? <CalendarTab me={me} /> : null}
            {activeTab === "jobs" ? <JobsTab me={me} /> : null}
            {activeTab === "quotes" ? <QuotesTab me={me} /> : null}
            {activeTab === "clients" ? <ClientsTab me={me} /> : null}
            {activeTab === "catalogue" ? <CatalogueTab me={me} /> : null}
            {activeTab === "offers" ? <OffersTab me={me} onGoPlus={() => go("plus")} /> : null}
            {activeTab === "plus" ? <PlusTab me={me} /> : null}
            {activeTab === "money" ? <MoneyTab me={me} /> : null}
            {activeTab === "insights" ? <InsightsTab me={me} onReload={load} /> : null}
            {activeTab === "team" ? <TeamTab me={me} /> : null}
            {activeTab === "settings" ? <SettingsTab me={me} onSaved={load} /> : null}
            {activeTab === "security" ? <SecurityTab onSignedOut={() => void doSignOut()} /> : null}
          </div>
        </>
      ) : null}
    </main>
  );
}

export default function PartnerConsolePage() {
  return (
    <Suspense fallback={<p className="p-6 text-faint">…</p>}>
      <PartnerConsole />
    </Suspense>
  );
}
