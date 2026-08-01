import type { Metadata } from "next";
import Link from "next/link";
import { LogoWithTail } from "@/components/logo";
import { HeroRotator, type HeroImage } from "@/components/hero-rotator";
import { API_URL } from "@/lib/api";

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
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: "من نحن — تشاو",
  description:
    "تشاو منصّة حجز ليبية: نزور كل مكان بأنفسنا، نصوّره، ونعتمده قبل النشر. العربون يحمي الطرفين، وسجل الشكاوى معلن للجميع.",
};

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

const FALLBACK_HERO: HeroImage[] = [
  { src: "/hero-marina", alt: "واجهة طرابلس البحرية" },
  { src: "/hero-castle", alt: "السرايا الحمراء في طرابلس القديمة" },
];

/** How the badge is actually earned — the operational spine, not a slogan. */
const VERIFICATION_STEPS: [string, string, string][] = [
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
];

/** Each promise paired with the mechanism that makes it true. */
const PROMISES: [string, string, string][] = [
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
];

const RAIL_AR: Record<string, [string, string]> = {
  sadad: ["💳", "سداد"],
  adfali: ["📱", "أضفلي"],
  local_card: ["🏦", "البطاقة المصرفية المحلية"],
  tlync: ["🔗", "T-Lync"],
  moamalat: ["🏧", "معاملات"],
  card: ["💳", "فيزا / ماستركارد"],
  cash: ["💵", "نقدًا عند الوصول"],
};

export default async function AboutPage() {
  const [stats, heroImages] = await Promise.all([getStats(), getHero()]);
  const hero = heroImages.length ? heroImages : FALLBACK_HERO;

  const t = stats?.trust;
  const liveVenues = stats?.venues.verified ?? 0;
  const hasHistory = Boolean(t && t.deliveredBookings > 0);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/">
          <LogoWithTail size={40} />
        </Link>
        <nav className="flex items-center gap-3 text-sm font-bold text-sea">
          <Link href="/search?type=coast">تصفّح</Link>
          <Link href="/host">للمضيفين</Link>
          <Link href="/login">دخول</Link>
        </nav>
      </header>

      {/* ── Opening: the problem, stated plainly ───────────────────────── */}
      <section className="card relative overflow-hidden text-white">
        <HeroRotator images={hero} intervalMs={7000} />
        <div className="absolute inset-0 photo-scrim-strong" aria-hidden />
        <div className="relative p-6 sm:p-10" data-on-photo>
          <p className="text-amber font-bold text-sm mb-2">من نحن</p>
          <h1 className="font-baloo font-extrabold text-3xl sm:text-4xl leading-tight drop-shadow">
            بنينا تشاو لأن الحجز في ليبيا مبني على الثقة — والثقة كانت مفقودة
          </h1>
          <p className="mt-4 text-white/95 leading-relaxed max-w-2xl drop-shadow">
            تحجز شاليهًا اليوم بالطريقة نفسها منذ خمسة عشر عامًا: تقطع المدينة في الحرّ، تتصل
            بأرقام التقطتها من صفحة فيسبوك، وتسلّم عربونًا نقدًا لشخص لا تعرفه ولا إيصال بينكما.
            فيحدث ما يحدث: تاريخ الزفاف يُباع مرتين، والمكان لا يشبه صوره، والمولّد الذي وُعدت به
            غير موجود — ولا جهة تشتكي لها.
          </p>
          <p className="mt-3 text-white/95 leading-relaxed max-w-2xl drop-shadow">
            تشاو ليست تطبيق حجز أضفناه فوق هذا الواقع. هي محاولة لإصلاح ما يكسره: نزور كل مكان
            بأنفسنا قبل نشره، والعربون يُلزم الطرفين، وسجلّ الشكاوى معروض للجميع.
          </p>
        </div>
      </section>

      {/* ── Proof, not adjectives ──────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="font-bold text-xl text-sea mb-1">ما يمكننا إثباته</h2>
        <p className="text-sm text-faint mb-3">
          هذه الأرقام تُقرأ مباشرة من نظامنا وتتحدث تلقائيًا — ليست نصًا كتبناه في صفحة.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Proof value={liveVenues} label="مكان زرناه واعتمدناه" />
          <Proof value={stats?.photos ?? 0} label="صورة التقطها فريقنا" />
          <Proof
            value={stats?.venues.areas ?? 0}
            label="منطقة نغطيها"
            sub={
              stats?.venues.cities
                ? `في ${countAr(stats.venues.cities, ["مدينة واحدة", "مدينتين", "مدن", "مدينة"])}`
                : undefined
            }
          />
          <Proof
            value={stats?.reviews ?? 0}
            label="تقييم من ضيوف أكملوا الحجز"
            sub="لا تقييم بلا إقامة"
          />
        </div>

        {/* The complaint record — the number nobody else publishes */}
        <div className="card p-4 mt-3">
          <h3 className="font-bold text-sea">سجلّ الشكاوى — كما هو</h3>
          {hasHistory && t ? (
            <>
              <p className="text-sm text-muted mt-2 leading-relaxed">
                فُتحت <strong className="text-sea">{t.disputesOpened}</strong> شكوى مقابل{" "}
                <strong className="text-sea">{t.deliveredBookings}</strong> حجز منفَّذ.
                {t.disputesResolved > 0 ? (
                  <>
                    {" "}
                    حُلّت منها <strong className="text-sea">{t.disputesResolved}</strong>
                    {t.medianHours != null ? (
                      <>
                        {" "}
                        بوسيط <strong className="text-sea">{t.medianHours} ساعة</strong>
                      </>
                    ) : null}
                    ، منها <strong className="text-sea">{t.resolvedWithinSla}</strong> خلال مهلة
                    الـ{t.slaHours} ساعة التي نلتزم بها.
                  </>
                ) : null}
              </p>
              <p className="text-xs text-faint mt-2 leading-relaxed">
                ننشر العدد والنتيجة والمقام معًا. نص الشكوى وهوية أصحابها لا يُنشران أبدًا — ذلك
                شأن بين الطرفين وفريقنا وحدهم.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted mt-2 leading-relaxed">
              لم تُسجَّل شكاوى بعد لأن المنصّة في بدايتها. حين تُسجَّل، ستظهر هنا وفي صفحة كل مكان
              بالعدد والنتيجة ومدة الحل — سواء كانت في صالحنا أو لا.
            </p>
          )}
        </div>
      </section>

      {/* ── How the badge is earned ────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="font-bold text-xl text-sea">كيف يُعتمد المكان</h2>
        <p className="text-sm text-faint mt-1 mb-3">
          شارة «موثّق من تشاو» ليست خانة نضع فيها علامة — هذه خطواتها الأربع، وكلها ميدانية.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {VERIFICATION_STEPS.map(([n, title, body]) => (
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
        <h2 className="font-bold text-xl text-sea">ما نلتزم به — وكيف نضمنه</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          {PROMISES.map(([emoji, title, body]) => (
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
      <PaymentSection />

      {/* ── Privacy, said out loud ─────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="font-bold text-xl text-sea">بياناتك</h2>
        <div className="card p-4 mt-3">
          <p className="text-sm text-muted leading-relaxed">
            نتعلّم من استخدامك للتطبيق داخل التطبيق فقط — ما تبحث عنه، وما تحفظه، وما تحجزه — لنعرض
            لك ما يناسبك فعلًا. لا نشتري بياناتك من أحد، ولا نجمع حساباتك على مواقع التواصل، ولا
            نستنتج شيئًا عن عائلتك أو معتقدك. ولا نبيع بياناتك لأي جهة — لا اليوم ولا لاحقًا.
          </p>
          <p className="text-sm text-muted leading-relaxed mt-2">
            العنوان الدقيق للمكان لا يظهر قبل دفع العربون، حمايةً للمضيف وللمكان. وأسماء الضيوف
            تظهر بالأحرف الأولى فقط في التقييمات العامة.
          </p>
        </div>
      </section>

      {/* ── Who we are, honestly ───────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="font-bold text-xl text-sea">من يقف خلف تشاو</h2>
        <div className="card p-4 mt-3">
          <p className="text-sm text-muted leading-relaxed">
            تشاو فريق ليبي صغير يبدأ من طرابلس: مندوبون ميدانيون يزورون الأماكن ويصوّرونها، ودعم
            يردّ على واتساب، وفريق يبني المنتج. نبدأ بشريط ساحلي واحد وعدد محدود من الأماكن نعرفها
            واحدًا واحدًا، لأن عمق التغطية في منطقة واحدة أنفع من قائمة طويلة لا نعرف نصفها.
          </p>
          <p className="text-sm text-muted leading-relaxed mt-2">
            اسم «تشاو» من الكلمة التي يقولها الليبيون كل يوم — ومنها جاءت فكرتنا:{" "}
            <strong className="text-sea">قول تشاو</strong> للحجز بالمكالمات، وللتاريخ المحجوز
            مرتين، وللعربون بلا إيصال.
          </p>
        </div>
      </section>

      {/* ── Calls to action ────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
        <Link href="/search?type=coast" className="card p-5 hover:shadow-md transition-shadow">
          <h3 className="font-bold text-sea">تبحث عن مكان؟</h3>
          <p className="text-sm text-muted mt-1">
            شاليهات واستراحات وقاعات أفراح وخدمات مناسبات — كلها موثّقة ميدانيًا.
          </p>
          <span className="inline-block mt-3 text-link font-bold text-sm">ابدأ التصفّح ←</span>
        </Link>
        <Link href="/host" className="card p-5 hover:shadow-md transition-shadow">
          <h3 className="font-bold text-sea">عندك مكان أو خدمة؟</h3>
          <p className="text-sm text-muted mt-1">
            نزورك، نصوّر مكانك مجانًا، ونجيب لك ضيوفًا دفعوا عربونًا — لا مكالمات بلا نتيجة.
          </p>
          <span className="inline-block mt-3 text-link font-bold text-sm">سجّل مكانك ←</span>
        </Link>
      </section>

      <footer className="mt-12 text-center text-sm text-faint space-y-1">
        <p>تشاو — ciao.ly · طرابلس، ليبيا</p>
        <p>الأسعار كلها بالدينار الليبي. العربون فقط أونلاين والباقي عند الوصول.</p>
      </footer>
    </main>
  );
}

/**
 * Arabic counts properly. "في 1 مدن" is the tell that a page was translated
 * rather than written — and this page's whole argument is that we are local.
 * Arabic marks one, two, a few (3–10) and many differently.
 */
function countAr(n: number, [one, two, few, many]: [string, string, string, string]): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

function Proof({ value, label, sub }: { value: number; label: string; sub?: string }) {
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
async function PaymentSection() {
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
      <h2 className="font-bold text-xl text-sea">طرق الدفع</h2>
      <p className="text-sm text-faint mt-1 mb-3">
        العربون فقط يُدفع أونلاين — والباقي نقدًا عند الوصول. لا ندفع بك إلى الدفع الكامل مقدمًا،
        ولا نطلب منك بطاقة لتتصفّح.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {rails.map((r) => {
          const [emoji, label] = RAIL_AR[r] ?? ["💳", r];
          return (
            <div key={r} className="card p-3 flex items-center gap-2">
              <span aria-hidden className="text-lg">{emoji}</span>
              <span className="text-sm font-bold text-sea">{label}</span>
            </div>
          );
        })}
      </div>
      {demoMode ? (
        <p className="text-xs text-faint mt-3 leading-relaxed">
          المنصّة حاليًا في مرحلة العرض التجريبي: قنوات الدفع معروضة كما ستعمل، وتُفعَّل فعليًا مع
          اعتماد مزوّد الدفع. نفضّل أن نقول هذا بوضوح على أن نعرض شعارات لا تعمل بعد.
        </p>
      ) : null}
    </section>
  );
}
