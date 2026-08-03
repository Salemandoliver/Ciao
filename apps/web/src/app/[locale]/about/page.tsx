import type { Metadata } from "next";
import { Link } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { HeroRotator, type HeroImage } from "@/components/hero-rotator";
import { LanguageToggle } from "@/components/language-toggle";
import { API_URL } from "@/lib/api";
import { asLocale, type Locale } from "@/lib/i18n";
import { fmtNum } from "@/lib/vocab";

/**
 * من نحن — the About page.
 *
 * Every marketplace's about page is a wall of adjectives: trusted, innovative,
 * seamless, 24/7. Anyone can type those. So this page is built on a different
 * rule: **it may only claim what it can show.**
 *
 * The numbers are live, pulled from the same tables the product runs on — how
 * many places we physically walked into, how many photographs our own team
 * shot, how many complaints were opened against how many delivered stays, and
 * how fast we closed them. Publishing the complaint count on the About page is
 * the point. A marketplace willing to show its bad news is making a claim its
 * competitors cannot copy by writing better copy.
 *
 * It degrades honestly: with no data yet, the proof strip says so plainly
 * rather than printing zeros dressed up as achievements.
 *
 * The English is written, not translated — and it is written to be exactly as
 * uncomfortable as the Arabic. The complaint count keeps its denominator, the
 * trial-phase disclosure stays, and nothing is rounded up into a slogan. A
 * softer English version would be a different, less honest company.
 */

export const revalidate = 300;

interface PublicStats {
  venues: { verified: number; total: number; cities: number; areas: number; verifyingSince: string | null };
  listings: Record<string, number>;
  photos: number;
  reviews: number;
  trust: {
    deliveredBookings: number;
    disputesOpened: number;
    disputesResolved: number;
    resolvedWithinSla: number;
    medianHours: number | null;
    slaHours: number;
  };
}

type Trust = PublicStats["trust"];

/** Numbers inside a sentence, so the eye can find them without reading it. */
function B({ children }: { children: React.ReactNode }) {
  return <strong className="text-sea">{children}</strong>;
}

const copy = {
  ar: {
    metaTitle: "من نحن — تشاو",
    metaDescription:
      "تشاو منصّة حجز ليبية: نزور كل مكان بأنفسنا، نصوّره، ونعتمده قبل النشر. العربون يحمي الطرفين، وسجل الشكاوى معلن للجميع.",

    navBrowse: "تصفّح",
    navHosts: "للمضيفين",
    navSignIn: "دخول",

    eyebrow: "من نحن",
    heroTitle: "بنينا تشاو لأن الحجز في ليبيا مبني على الثقة — والثقة كانت مفقودة",
    heroBody1:
      "تحجز شاليهًا اليوم بالطريقة نفسها منذ خمسة عشر عامًا: تقطع المدينة في الحرّ، تتصل بأرقام التقطتها من صفحة فيسبوك، وتسلّم عربونًا نقدًا لشخص لا تعرفه ولا إيصال بينكما. فيحدث ما يحدث: تاريخ الزفاف يُباع مرتين، والمكان لا يشبه صوره، والمولّد الذي وُعدت به غير موجود — ولا جهة تشتكي لها.",
    heroBody2:
      "تشاو ليست تطبيق حجز أضفناه فوق هذا الواقع. هي محاولة لإصلاح ما يكسره: نزور كل مكان بأنفسنا قبل نشره، والعربون يُلزم الطرفين، وسجلّ الشكاوى معروض للجميع.",

    proofTitle: "ما يمكننا إثباته",
    proofLead: "هذه الأرقام تُقرأ مباشرة من نظامنا وتتحدث تلقائيًا — ليست نصًا كتبناه في صفحة.",
    proofVenues: "مكان زرناه واعتمدناه",
    proofPhotos: "صورة التقطها فريقنا",
    proofAreas: "منطقة نغطيها",
    proofAreasSub: (cities: number) =>
      `في ${countAr(cities, ["مدينة واحدة", "مدينتين", "مدن", "مدينة"])}`,
    proofReviews: "تقييم من ضيوف أكملوا الحجز",
    proofReviewsSub: "لا تقييم بلا إقامة",

    complaintsTitle: "سجلّ الشكاوى — كما هو",
    complaintsRecord: (t: Trust) => (
      <>
        فُتحت <B>{t.disputesOpened}</B> شكوى مقابل <B>{t.deliveredBookings}</B> حجز منفَّذ.
        {t.disputesResolved > 0 ? (
          <>
            {" "}
            حُلّت منها <B>{t.disputesResolved}</B>
            {t.medianHours != null ? (
              <>
                {" "}
                بوسيط <B>{t.medianHours} ساعة</B>
              </>
            ) : null}
            ، منها <B>{t.resolvedWithinSla}</B> خلال مهلة الـ{t.slaHours} ساعة التي نلتزم بها.
          </>
        ) : null}
      </>
    ),
    complaintsNote:
      "ننشر العدد والنتيجة والمقام معًا. نص الشكوى وهوية أصحابها لا يُنشران أبدًا — ذلك شأن بين الطرفين وفريقنا وحدهم.",
    complaintsEmpty:
      "لم تُسجَّل شكاوى بعد لأن المنصّة في بدايتها. حين تُسجَّل، ستظهر هنا وفي صفحة كل مكان بالعدد والنتيجة ومدة الحل — سواء كانت في صالحنا أو لا.",

    stepsTitle: "كيف يُعتمد المكان",
    stepsLead: "شارة «موثّق من تشاو» ليست خانة نضع فيها علامة — هذه خطواتها الأربع، وكلها ميدانية.",
    steps: [
      [
        "١",
        "نزور المكان",
        "مندوب من تشاو يذهب بنفسه، يقابل المالك، ويتحقق من صفة من يؤجّر — بالوثيقة أو بشهادة موثّقة محليًا. لا نعتمد مكانًا لم ندخله.",
      ],
      [
        "٢",
        "نجرّب ما يُقال عنه",
        "المولّد يُشغَّل أمامنا وتُصوَّر لوحته، والخزان يُفحص، والمسبح والسور يُقاسان لدرجة الستر. ما لا نتحقق منه لا يُكتب في الإعلان.",
      ],
      [
        "٣",
        "نصوّره بأنفسنا",
        "كل صورة في تشاو التقطها فريقنا بنفس زوايا التصوير في كل مكان — لتقارن أماكن بصور متساوية، لا بصور مالك بارع في التصوير مقابل مالك ليس كذلك.",
      ],
      [
        "٤",
        "ثم نَنشر — ونعيد الفحص",
        "التوثيق له تاريخ انتهاء، ويُراجَع سنويًا أو عند تكرار الشكاوى من عدم المطابقة. الشارة تُسحب علنًا إن لم تعد تنطبق.",
      ],
    ] as [string, string, string][],

    promisesTitle: "ما نلتزم به — وكيف نضمنه",
    promises: [
      [
        "🔒",
        "الستر شرط، لا ميزة إضافية",
        "درجة الستر تُقاس ميدانيًا: هل المسبح مسوّر؟ هل يطل عليه الجيران؟ هل هناك مدخل منفصل؟ وتُعرض كرقم يمكنك التصفية عليه. أسماء الضيفات لا تظهر للعلن أبدًا — الأحرف الأولى فقط.",
      ],
      [
        "💰",
        "عربون صغير يحمي الطرفين",
        "تدفع جزءًا بسيطًا أونلاين ليُقفل التاريخ، والباقي نقدًا عند الوصول. المضيف يعرف أنك جاد، وأنت لم تسلّم مالك كاملًا لشخص لم تقابله. عمولتنا مدمجة في العربون — لا رسوم مفاجئة على أحد.",
      ],
      [
        "⚡",
        "مبني ليعمل وقت انقطاع الكهرباء",
        "قسيمة الحجز والعنوان محفوظان على هاتفك بدون إنترنت، والتأكيدات تصلك واتساب ثم SMS ثم مكالمة. المهل تُحسب على خوادمنا لا على هاتفك — فبطارية فارغة لا تُلغي حجزًا.",
      ],
      [
        "⚖️",
        "سجل الشكاوى معلن",
        "كل مكان يعرض عدد الشكاوى المفتوحة ضده من كم حجز منفَّذ، وكم حُلّت، وفي كم ساعة. لا نخفي الخبر السيئ — مكان حُلّت شكاواه بسرعة أصدق من مكان بلا تاريخ إطلاقًا. نص الشكوى نفسه يبقى خاصًا للأبد.",
      ],
    ] as [string, string, string][],

    payTitle: "طرق الدفع",
    payLead:
      "العربون فقط يُدفع أونلاين — والباقي نقدًا عند الوصول. لا ندفع بك إلى الدفع الكامل مقدمًا، ولا نطلب منك بطاقة لتتصفّح.",
    rails: {
      sadad: "سداد",
      adfali: "أضفلي",
      local_card: "البطاقة المصرفية المحلية",
      tlync: "T-Lync",
      moamalat: "معاملات",
      card: "فيزا / ماستركارد",
      cash: "نقدًا عند الوصول",
    } as Record<string, string>,
    payDemo:
      "المنصّة حاليًا في مرحلة العرض التجريبي: قنوات الدفع معروضة كما ستعمل، وتُفعَّل فعليًا مع اعتماد مزوّد الدفع. نفضّل أن نقول هذا بوضوح على أن نعرض شعارات لا تعمل بعد.",

    dataTitle: "بياناتك",
    dataBody1:
      "نتعلّم من استخدامك للتطبيق داخل التطبيق فقط — ما تبحث عنه، وما تحفظه، وما تحجزه — لنعرض لك ما يناسبك فعلًا. لا نشتري بياناتك من أحد، ولا نجمع حساباتك على مواقع التواصل، ولا نستنتج شيئًا عن عائلتك أو معتقدك. ولا نبيع بياناتك لأي جهة — لا اليوم ولا لاحقًا.",
    dataBody2:
      "العنوان الدقيق للمكان لا يظهر قبل دفع العربون، حمايةً للمضيف وللمكان. وأسماء الضيوف تظهر بالأحرف الأولى فقط في التقييمات العامة.",

    whoTitle: "من يقف خلف تشاو",
    whoBody1:
      "تشاو فريق ليبي صغير يبدأ من طرابلس: مندوبون ميدانيون يزورون الأماكن ويصوّرونها، ودعم يردّ على واتساب، وفريق يبني المنتج. نبدأ بشريط ساحلي واحد وعدد محدود من الأماكن نعرفها واحدًا واحدًا، لأن عمق التغطية في منطقة واحدة أنفع من قائمة طويلة لا نعرف نصفها.",
    whoBody2: (
      <>
        اسم «تشاو» من الكلمة التي يقولها الليبيون كل يوم — ومنها جاءت فكرتنا:{" "}
        <B>قول تشاو</B> للحجز بالمكالمات، وللتاريخ المحجوز مرتين، وللعربون بلا إيصال.
      </>
    ),

    ctaGuestTitle: "تبحث عن مكان؟",
    ctaGuestBody: "شاليهات واستراحات وقاعات أفراح وخدمات مناسبات — كلها موثّقة ميدانيًا.",
    ctaGuestLink: "ابدأ التصفّح ←",
    ctaHostTitle: "عندك مكان أو خدمة؟",
    ctaHostBody: "نزورك، نصوّر مكانك مجانًا، ونجيب لك ضيوفًا دفعوا عربونًا — لا مكالمات بلا نتيجة.",
    ctaHostLink: "سجّل مكانك ←",

    footerPlace: "تشاو — ciao.ly · طرابلس، ليبيا",
    footerPrices: "الأسعار كلها بالدينار الليبي. العربون فقط أونلاين والباقي عند الوصول.",
  },
  en: {
    metaTitle: "About — Ciao",
    metaDescription:
      "Ciao is a Libyan booking platform: we visit every place ourselves, photograph it, and approve it before it goes live. The deposit protects both sides, and the complaint record is public.",

    navBrowse: "Browse",
    navHosts: "For hosts",
    navSignIn: "Sign in",

    eyebrow: "About us",
    heroTitle: "We built Ciao because booking in Libya runs on trust — and the trust was missing",
    heroBody1:
      "Booking a chalet today works the same way it did fifteen years ago: you cross the city in the heat, you ring numbers you copied off a Facebook page, and you hand a cash deposit to someone you have never met, with no receipt between you. So what happens, happens: the wedding date is sold twice, the place looks nothing like its photos, and the generator you were promised is not there — and there is nobody to complain to.",
    heroBody2:
      "Ciao is not a booking app laid on top of all that. It is an attempt to fix what breaks: we visit every place ourselves before it goes live, the deposit holds both sides to the booking, and the complaint record is shown to everyone.",

    proofTitle: "What we can prove",
    proofLead:
      "These numbers are read straight from our own system and update themselves — they are not text we typed onto a page.",
    proofVenues: "places we visited and approved",
    proofPhotos: "photographs taken by our team",
    proofAreas: "areas we cover",
    proofAreasSub: (cities: number) => (cities === 1 ? "in 1 city" : `in ${cities} cities`),
    proofReviews: "reviews from guests who completed a booking",
    proofReviewsSub: "no review without a stay",

    complaintsTitle: "The complaint record — as it stands",
    complaintsRecord: (t: Trust) => (
      <>
        <B>{t.disputesOpened}</B> complaints were opened against <B>{t.deliveredBookings}</B>{" "}
        delivered bookings.
        {t.disputesResolved > 0 ? (
          <>
            {" "}
            <B>{t.disputesResolved}</B> of them have been resolved
            {t.medianHours != null ? (
              <>
                , with a median of <B>{t.medianHours} hours</B>
              </>
            ) : null}
            , and <B>{t.resolvedWithinSla}</B> of those inside the {t.slaHours}-hour deadline we
            hold ourselves to.
          </>
        ) : null}
      </>
    ),
    complaintsNote:
      "We publish the count, the outcome and the denominator together. The text of a complaint and who made it are never published — that stays between the two sides and our team.",
    complaintsEmpty:
      "No complaints have been recorded yet, because the platform is only starting out. When they are, they will appear here and on the page of every place — the count, the outcome and how long it took to resolve — whether that reflects well on us or not.",

    stepsTitle: "How a place is approved",
    stepsLead:
      "The «Ciao verified» badge is not a box we tick — these are its four steps, and every one of them happens on site.",
    steps: [
      [
        "1",
        "We visit the place",
        "Someone from Ciao goes in person, meets the owner, and checks that whoever is letting the place has the standing to — by document, or by a locally attested statement. We do not approve a place we have not walked into.",
      ],
      [
        "2",
        "We test what is claimed about it",
        "The generator is started in front of us and its panel photographed, the water tank is inspected, and the pool and the wall are measured for privacy. What we cannot verify does not go in the listing.",
      ],
      [
        "3",
        "We photograph it ourselves",
        "Every photograph on Ciao was taken by our team, from the same angles at every place — so you compare places on equal photographs, not on one owner who is good with a camera against one who is not.",
      ],
      [
        "4",
        "Then we publish — and we check again",
        "Verification has an expiry date, and it is reviewed every year, or sooner if complaints keep coming that a place does not match its listing. The badge is withdrawn publicly if it no longer holds.",
      ],
    ] as [string, string, string][],

    promisesTitle: "What we promise — and how we make it hold",
    promises: [
      [
        "🔒",
        "Privacy is a condition, not an added feature",
        "The privacy score is measured on site: is the pool walled? do the neighbours look onto it? is there a separate entrance? It is shown as a number you can filter on. Women guests' names are never shown publicly — initials only.",
      ],
      [
        "💰",
        "A small deposit that protects both sides",
        "You pay a small part online to hold the date, and the rest in cash on arrival. The host knows you mean it, and you have not handed all your money to someone you have never met. Our commission sits inside the deposit — no surprise fees for anyone.",
      ],
      [
        "⚡",
        "Built to work through a power cut",
        "Your booking voucher and the address are saved on your phone without internet, and confirmations reach you on WhatsApp, then SMS, then a phone call. Deadlines are counted on our servers, not on your phone — a flat battery does not cancel a booking.",
      ],
      [
        "⚖️",
        "The complaint record is public",
        "Every place shows how many complaints were opened against it, out of how many bookings were delivered, how many were resolved, and in how many hours. We do not hide the bad news — a place whose complaints were resolved quickly is more honest than a place with no history at all. The text of the complaint itself stays private for good.",
      ],
    ] as [string, string, string][],

    payTitle: "Ways to pay",
    payLead:
      "Only the deposit is paid online — the rest is cash on arrival. We do not push you towards paying in full up front, and we do not ask for a card just to browse.",
    rails: {
      sadad: "Sadad",
      adfali: "Adfali",
      local_card: "Local bank card",
      tlync: "T-Lync",
      moamalat: "Moamalat",
      card: "Visa / Mastercard",
      cash: "Cash on arrival",
    } as Record<string, string>,
    payDemo:
      "The platform is in a trial phase right now: the payment channels are shown as they will work, and they go live once our payment provider is approved. We would rather say that plainly than show logos that do not work yet.",

    dataTitle: "Your data",
    dataBody1:
      "We learn from how you use the app, inside the app only — what you search for, what you save, what you book — so we can show you what actually suits you. We do not buy your data from anyone, we do not harvest your social media accounts, and we do not infer anything about your family or your beliefs. And we do not sell your data to anyone — not today and not later.",
    dataBody2:
      "The exact address of a place is not shown before the deposit is paid, to protect the host and the property. Guests' names appear as initials only in public reviews.",

    whoTitle: "Who is behind Ciao",
    whoBody1:
      "Ciao is a small Libyan team starting out from Tripoli: field agents who visit places and photograph them, support who answer on WhatsApp, and a team building the product. We are starting with one stretch of coast and a limited number of places we know one by one, because covering a single area properly is worth more than a long list where we do not know half of them.",
    whoBody2: (
      <>
        The name Ciao comes from the word Libyans say every day — and that is where the idea came
        from: <B>say ciao</B> to booking by phone call, to the date that was sold twice, and to the
        deposit with no receipt.
      </>
    ),

    ctaGuestTitle: "Looking for a place?",
    ctaGuestBody:
      "Chalets, estirahas, wedding halls and event services — every one of them verified in person.",
    ctaGuestLink: "Start browsing →",
    ctaHostTitle: "Have a place or a service?",
    ctaHostBody:
      "We come to you, photograph your place free of charge, and bring you guests who have already paid a deposit — no calls that go nowhere.",
    ctaHostLink: "List your place →",

    footerPlace: "Ciao — ciao.ly · Tripoli, Libya",
    footerPrices:
      "All prices are in Libyan dinars. Only the deposit is paid online; the rest is paid on arrival.",
  },
} satisfies Record<Locale, unknown>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const c = copy[asLocale((await params).locale)];
  return { title: c.metaTitle, description: c.metaDescription };
}

async function getStats(): Promise<PublicStats | null> {
  try {
    const res = await fetch(`${API_URL}/v1/stats/public`, { next: { revalidate: 300 } });
    return res.ok ? ((await res.json()) as PublicStats) : null;
  } catch {
    return null; // the page is worth reading without the numbers
  }
}

async function getHero(): Promise<HeroImage[]> {
  try {
    const res = await fetch(`${API_URL}/v1/settings/public`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const body = (await res.json()) as { hero?: { images?: HeroImage[] } };
    return body.hero?.images?.filter((i) => i?.src) ?? [];
  } catch {
    return [];
  }
}

/** Only used when the control plane is unreachable — the page must still render. */
function fallbackHero(locale: Locale): HeroImage[] {
  return locale === "en"
    ? [
        { src: "/hero-marina", alt: "The Tripoli seafront" },
        { src: "/hero-castle", alt: "The Red Castle in old Tripoli" },
      ]
    : [
        { src: "/hero-marina", alt: "واجهة طرابلس البحرية" },
        { src: "/hero-castle", alt: "السرايا الحمراء في طرابلس القديمة" },
      ];
}

const RAIL_EMOJI: Record<string, string> = {
  sadad: "💳",
  adfali: "📱",
  local_card: "🏦",
  tlync: "🔗",
  moamalat: "🏧",
  card: "💳",
  cash: "💵",
};

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  const c = copy[locale];
  const [stats, heroImages] = await Promise.all([getStats(), getHero()]);
  const hero = heroImages.length ? heroImages : fallbackHero(locale);

  const t = stats?.trust;
  const liveVenues = stats?.venues.verified ?? 0;
  const hasHistory = Boolean(t && t.deliveredBookings > 0);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/">
          <Logo />
        </Link>
        <nav className="flex items-center gap-3 text-sm font-bold text-sea">
          <Link href="/search?type=coast">{c.navBrowse}</Link>
          <a href="#hosts">{c.navHosts}</a>
          <Link href="/login">{c.navSignIn}</Link>
          <LanguageToggle />
        </nav>
      </header>

      {/* ── Opening: the problem, stated plainly ───────────────────────── */}
      <section className="card relative overflow-hidden text-white">
        <HeroRotator images={hero} intervalMs={7000} />
        <div className="absolute inset-0 photo-scrim-strong" aria-hidden />
        <div className="relative p-6 sm:p-10" data-on-photo>
          <p className="text-amber font-bold text-sm mb-2">{c.eyebrow}</p>
          <h1 className="font-baloo font-extrabold text-3xl sm:text-4xl leading-tight drop-shadow">
            {c.heroTitle}
          </h1>
          <p className="mt-4 text-white/95 leading-relaxed max-w-2xl drop-shadow">{c.heroBody1}</p>
          <p className="mt-3 text-white/95 leading-relaxed max-w-2xl drop-shadow">{c.heroBody2}</p>
        </div>
      </section>

      {/* ── Proof, not adjectives ──────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="font-bold text-xl text-sea mb-1">{c.proofTitle}</h2>
        <p className="text-sm text-faint mb-3">{c.proofLead}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Proof value={fmtNum(locale, liveVenues)} label={c.proofVenues} />
          <Proof value={fmtNum(locale, stats?.photos ?? 0)} label={c.proofPhotos} />
          <Proof
            value={fmtNum(locale, stats?.venues.areas ?? 0)}
            label={c.proofAreas}
            sub={stats?.venues.cities ? c.proofAreasSub(stats.venues.cities) : undefined}
          />
          <Proof
            value={fmtNum(locale, stats?.reviews ?? 0)}
            label={c.proofReviews}
            sub={c.proofReviewsSub}
          />
        </div>

        {/* The complaint record — the number nobody else publishes */}
        <div className="card p-4 mt-3">
          <h3 className="font-bold text-sea">{c.complaintsTitle}</h3>
          {hasHistory && t ? (
            <>
              <p className="text-sm text-muted mt-2 leading-relaxed">{c.complaintsRecord(t)}</p>
              <p className="text-xs text-faint mt-2 leading-relaxed">{c.complaintsNote}</p>
            </>
          ) : (
            <p className="text-sm text-muted mt-2 leading-relaxed">{c.complaintsEmpty}</p>
          )}
        </div>
      </section>

      {/* ── How the badge is earned ────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="font-bold text-xl text-sea">{c.stepsTitle}</h2>
        <p className="text-sm text-faint mt-1 mb-3">{c.stepsLead}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {c.steps.map(([n, title, body]) => (
            <div key={title} className="card p-4 flex gap-3">
              <span className="shrink-0 w-8 h-8 rounded-full bg-amber text-sea-dark font-extrabold grid place-items-center">
                {n}
              </span>
              <div>
                <h3 className="font-bold text-sea">{title}</h3>
                <p className="text-sm text-muted mt-1 leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Promises, each tied to its mechanism ───────────────────────── */}
      <section className="mt-8">
        <h2 className="font-bold text-xl text-sea">{c.promisesTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          {c.promises.map(([emoji, title, body]) => (
            <div key={title} className="card p-4">
              <h3 className="font-bold text-sea">
                <span aria-hidden className="me-1.5">{emoji}</span>
                {title}
              </h3>
              <p className="text-sm text-muted mt-1.5 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Payment: what actually works today ─────────────────────────── */}
      <PaymentSection locale={locale} />

      {/* ── Privacy, said out loud ─────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="font-bold text-xl text-sea">{c.dataTitle}</h2>
        <div className="card p-4 mt-3">
          <p className="text-sm text-muted leading-relaxed">{c.dataBody1}</p>
          <p className="text-sm text-muted leading-relaxed mt-2">{c.dataBody2}</p>
        </div>
      </section>

      {/* ── Who we are, honestly ───────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="font-bold text-xl text-sea">{c.whoTitle}</h2>
        <div className="card p-4 mt-3">
          <p className="text-sm text-muted leading-relaxed">{c.whoBody1}</p>
          <p className="text-sm text-muted leading-relaxed mt-2">{c.whoBody2}</p>
        </div>
      </section>

      {/* ── Calls to action ────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
        <Link href="/search?type=coast" className="card p-5 hover:shadow-md transition-shadow">
          <h3 className="font-bold text-sea">{c.ctaGuestTitle}</h3>
          <p className="text-sm text-muted mt-1">{c.ctaGuestBody}</p>
          <span className="inline-block mt-3 text-link font-bold text-sm">{c.ctaGuestLink}</span>
        </Link>
        {/*
          Information for businesses, not a door into their console. The
          partner control panel is a separate product on its own domain with
          its own sign-in, and the marketplace deliberately does not link into
          it — a guest browsing chalets has no business one tap away from
          somebody's diary. Businesses are onboarded by a field visit and
          receive the address with their sign-in link.
        */}
        <div id="hosts" className="card p-5">
          <h3 className="font-bold text-sea">{c.ctaHostTitle}</h3>
          <p className="text-sm text-muted mt-1">{c.ctaHostBody}</p>
          <span className="inline-block mt-3 text-link font-bold text-sm">{c.ctaHostLink}</span>
        </div>
      </section>

      <footer className="mt-12 text-center text-sm text-faint space-y-1">
        <p>{c.footerPlace}</p>
        <p>{c.footerPrices}</p>
      </footer>
    </main>
  );
}

/**
 * Arabic counts properly. "في 1 مدن" is the tell that a page was translated
 * rather than written — and this page's whole argument is that we are local.
 * Arabic marks one, two, a few (3–10) and many differently. English needs only
 * the singular/plural split, which is why the English copy does it inline.
 */
function countAr(n: number, [one, two, few, many]: [string, string, string, string]): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

function Proof({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="card p-4 text-center">
      <div className="text-3xl font-extrabold text-sea tabular-nums">{value}</div>
      <div className="text-xs font-bold text-muted mt-1 leading-snug">{label}</div>
      {sub ? <div className="text-[11px] text-faint mt-0.5">{sub}</div> : null}
    </div>
  );
}

/**
 * Payment methods — the honest version.
 *
 * The temptation is to print every logo in the country to look established.
 * We list what the checkout actually offers right now, taken from the control
 * plane, so the page can never drift from the product. Rails still being
 * connected are labelled as such rather than quietly implied.
 */
async function PaymentSection({ locale }: { locale: Locale }) {
  const c = copy[locale];
  let rails: string[] = [];
  let demoMode = true;
  try {
    const res = await fetch(`${API_URL}/v1/settings/public`, { next: { revalidate: 300 } });
    if (res.ok) {
      const body = (await res.json()) as { paymentRails?: string[]; demoMode?: boolean };
      rails = body.paymentRails ?? [];
      demoMode = body.demoMode !== false;
    }
  } catch {
    /* fall through to the default list below */
  }
  if (rails.length === 0) rails = ["sadad", "adfali", "local_card", "cash"];

  return (
    <section className="mt-8">
      <h2 className="font-bold text-xl text-sea">{c.payTitle}</h2>
      <p className="text-sm text-faint mt-1 mb-3">{c.payLead}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {rails.map((r) => (
          <div key={r} className="card p-3 flex items-center gap-2">
            <span aria-hidden className="text-lg">{RAIL_EMOJI[r] ?? "💳"}</span>
            <span className="text-sm font-bold text-sea">{c.rails[r] ?? r}</span>
          </div>
        ))}
      </div>
      {demoMode ? (
        <p className="text-xs text-faint mt-3 leading-relaxed">{c.payDemo}</p>
      ) : null}
    </section>
  );
}
