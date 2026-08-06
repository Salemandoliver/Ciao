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
import { ApiError, api, ensureSession, signOut } from "@/lib/api";
import { hostText, textProps } from "@/lib/content";
import { SecurityTab } from "./security";
import { TodayTab } from "./today";
import { CalendarTab } from "./calendar";
import { JobsTab } from "./jobs";
import { QuotesTab } from "./quotes";
import { ClientsTab } from "./clients";
import { FacebookTab } from "./facebook";
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
  "facebook",
  "money",
  "insights",
  "team",
  "settings",
  "security",
] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TAB_EMOJI: Record<TabKey, string> = {
  today: "☀️",
  calendar: "🗓",
  jobs: "📋",
  quotes: "🧾",
  clients: "👤",
  facebook: "📣",
  money: "💰",
  insights: "📈",
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
   * The Facebook kit is `diary`, not `money`. The person who posts to the page
   * at a Libyan resort is very often the receptionist rather than the owner,
   * and the link is public the moment it is pinned — gating it behind the money
   * screens would stop the right person doing the one thing we most want done.
   * Deciding what a discount costs is a different question, and the offer form
   * inside the tab asks for `money` on its own.
   */
  facebook: "diary",
  money: "money",
  insights: "money",
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
      facebook: "فيسبوك",
      money: "الفلوس",
      insights: "الأرقام",
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
      facebook: "Facebook",
      money: "Money",
      insights: "Numbers",
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
            {activeTab === "facebook" ? <FacebookTab me={me} /> : null}
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
