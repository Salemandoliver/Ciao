import type { Metadata } from "next";
import { Link } from "@/lib/locale";
import { LogoWithTail } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { API_URL } from "@/lib/api";
import { asLocale, type Locale } from "@/lib/i18n";
import { fmtNum } from "@/lib/vocab";

/**
 * Reward points — the terms, in plain Arabic and plain English.
 *
 * Loyalty terms are usually written to be technically true and practically
 * unreadable, which is how customers end up surprised when points vanish. This
 * page does the opposite: the numbers are read live from the same control
 * plane the programme actually runs on, so it cannot drift from reality, and
 * the awkward parts — expiry, that points are not money, that we can change
 * the rates — are stated first rather than buried in a final clause.
 *
 * That is the same posture as the dispute record on the About page. A
 * programme willing to print its own catch is more believable than one that
 * hides it.
 *
 * The English keeps that bluntness word for word. This is a document a
 * customer has to be able to act on, so it says "withdrawn" where the Arabic
 * says withdrawn and "forfeited" where the Arabic says forfeited; a gentler
 * translation would be a different promise.
 */

export const revalidate = 300;

interface PublicSettings {
  loyalty?: {
    enabled: boolean;
    earnRules: Record<string, number>;
    pointToDirham: number;
    minRedeem: number;
    expiryMonths: number;
    partnersEnabled: boolean;
  };
}

const FALLBACK = {
  enabled: true,
  earnRules: {
    signup: 1000,
    email_verified: 500,
    stay_completed: 5000,
    review_written: 2000,
    referral_qualified: 10000,
    referred_welcome: 5000,
  },
  pointToDirham: 1,
  minRedeem: 5000,
  expiryMonths: 24,
  partnersEnabled: true,
};

/** Numbers inside a sentence, so the eye can find them without reading it. */
function B({ children }: { children: React.ReactNode }) {
  return <strong className="text-sea">{children}</strong>;
}

const copy = {
  ar: {
    metaTitle: "نقاط المكافآت — شروط البرنامج | تشاو",
    metaDescription:
      "كيف تكسب نقاط تشاو، وكيف تستخدمها، ومتى تنتهي صلاحيتها — بلغة واضحة وأرقام محدّثة من النظام مباشرة.",

    navPoints: "نقاطي",
    navAbout: "من نحن",

    title: "نقاط تشاو",
    intro1:
      "تكسب نقاطًا حين تستخدم تشاو فعلًا — لا مقابل التسجيل وحده. تحوّلها إلى رصيد يخصم من عربون حجزك القادم، أو تصرفها عند أحد شركائنا: مقهى داخل المنتجع، مخبز، أو مطعم قريب.",
    intro2: (
      <>
        وضعنا القيم على قاعدة بسيطة:{" "}
        <B>إقامة واحدة مكتملة تكفي لقهوة عند أحد شركائنا</B>. النقاط التي لا تتحول إلى شيء ملموس
        ليست مكافأة.
      </>
    ),
    introNote:
      "الأرقام في هذه الصفحة تُقرأ مباشرة من نظامنا، فهي دائمًا مطابقة لما يحسبه التطبيق فعلًا.",

    awkwardTitle: "ثلاثة أشياء نقولها من البداية",
    awkwardNotMoney: (
      <>
        <B>١. النقاط ليست نقودًا.</B> لا تُصرف نقدًا ولا تُحوَّل لشخص آخر، وليست وديعة لدينا. هي
        مكافأة على استخدامك للتطبيق، تتحول إلى رصيد داخل تشاو حين تختار ذلك.
      </>
    ),
    awkwardExpiry: (months: number) => (
      <>
        <B>٢. {months > 0 ? "للنقاط مدة صلاحية." : "النقاط لا تنتهي صلاحيتها."}</B>{" "}
        {months > 0 ? (
          <>
            كل نقطة تنتهي بعد <B>{months} شهرًا</B> من كسبها. تاريخ انتهاء كل مكافأة يظهر في سجل
            نقاطك، ولا نغيّر تاريخ نقاط كسبتها بالفعل حتى لو غيّرنا المدة لاحقًا.
          </>
        ) : (
          "لن تفقد نقاطك بمرور الوقت."
        )}
      </>
    ),
    awkwardRates: (
      <>
        <B>٣. قد نغيّر قيم المكافآت.</B> نسب الكسب وقيمة النقطة قابلة للتعديل، وأي تعديل يسري على
        ما تكسبه بعده — لا على ما في رصيدك.
      </>
    ),

    earnTitle: "كيف تكسب",
    earn: {
      signup: "إنشاء العضوية",
      email_verified: "توثيق بريدك الإلكتروني",
      stay_completed: "إتمام إقامة أو خدمة",
      review_written: "كتابة تقييم بعد الإقامة",
      referral_qualified: "صديق دعوته أتمّ أول حجز له",
      referred_welcome: "انضمامك بدعوة صديق وإتمام أول حجز",
    } as Record<string, string>,
    earnNote:
      "مكافأة الدعوة تُصرف حين يُتمّ صديقك أول حجز فعليًا، لا عند تسجيله — حتى لا يُستغل البرنامج بحسابات وهمية. لكل حساب دعوة واحدة فقط، ولا يمكنك استخدام كودك أنت.",

    useTitle: "كيف تستخدمها",
    useCreditTitle: "١. رصيد داخل تشاو",
    useCreditBody: (perDinar: string, minPoints: string, minLyd: string) => (
      <>
        كل <B>{perDinar}</B> نقطة = ١ دينار رصيد، يُخصم تلقائيًا من عربون حجزك القادم. أقل مبلغ
        للتحويل <B>{minPoints}</B> نقطة ({minLyd} د.ل).
      </>
    ),
    usePartnersTitle: "٢. عند شركائنا",
    usePartnersOn:
      "اختر شريكًا وقيمة القسيمة، فتظهر لك بكود قصير تعرضه عند الكاشير. تُخصم النقاط فور إصدار القسيمة، وإن لم تستخدمها خلال مدتها تعود نقاطك إليك تلقائيًا.",
    usePartnersOff: "الصرف عند الشركاء غير مفعّل حاليًا.",
    usePartnersLink: "شاهد الشركاء ←",

    termsTitle: "الشروط بالتفصيل",
    termsWhoLabel: "من يستحق:",
    termsWho:
      "أي عضو في تشاو برقم هاتف موثّق. النقاط شخصية ومرتبطة بحسابك، ولا تُنقل إلى حساب آخر ولا تُورَّث ولا تُباع.",
    termsWhenLabel: "متى تُضاف:",
    termsWhen:
      "بعد إتمام الحدث المستحق — إتمام الإقامة، أو نشر التقييم، أو إتمام صديقك لأول حجز. لا تُضاف عند الطلب أو عند الدفع، لأن الحجز قد يُلغى.",
    termsCancelLabel: "عند الإلغاء أو الاسترجاع:",
    termsCancel: "إن أُلغيت الإقامة التي مُنحت عنها النقاط، يجوز لنا سحب النقاط المقابلة لها.",
    termsAbuseLabel: "سوء الاستخدام:",
    termsAbuse:
      "الحسابات المتعددة لنفس الشخص، والدعوات الوهمية، ومحاولات التحايل على البرنامج — كلها تؤدي إلى سحب النقاط وإيقاف المشاركة في البرنامج.",
    termsCloseLabel: "إغلاق الحساب:",
    termsClose: "النقاط تسقط عند إغلاق الحساب. حوّل رصيدك قبل الإغلاق.",
    termsVouchersLabel: "القسائم لدى الشركاء:",
    termsVouchers:
      "القسيمة صالحة لدى الشريك المحدد فقط، ولمرة واحدة، وخلال المدة الظاهرة عليها. لا تُستبدل نقدًا ولا يُعاد باقيها. الشريك مسؤول عن جودة ما يقدّمه، وأي خلاف بشأن الخدمة نفسها يُحل معه — ونحن نساعد.",
    termsChangeLabel: "التعديل والإيقاف:",
    termsChange:
      "يجوز لنا تعديل البرنامج أو إيقافه بإشعار مسبق معقول. عند الإيقاف، تبقى النقاط التي في رصيدك قابلة للتحويل خلال المدة التي نعلنها.",
    termsLegal: "هذه الشروط جزء من شروط استخدام تشاو، وتخضع للقانون الليبي. آخر تحديث: أغسطس ٢٠٢٦.",

    ctaPoints: "افتح نقاطي",
    ctaPartners: "شركاء الصرف",

    footerPlace: "تشاو — ciao.ly · طرابلس، ليبيا",
  },
  en: {
    metaTitle: "Reward points — programme terms | Ciao",
    metaDescription:
      "How you earn Ciao points, how you use them, and when they expire — in plain language, with the figures read straight from the system.",

    navPoints: "My points",
    navAbout: "About",

    title: "Ciao points",
    intro1:
      "You earn points when you actually use Ciao — not simply for signing up. You turn them into credit that comes off the deposit on your next booking, or you spend them at one of our partners: a café inside the resort, a bakery, or a restaurant nearby.",
    intro2: (
      <>
        We set the values on one simple rule:{" "}
        <B>one completed stay is enough for a coffee at one of our partners</B>. Points that never
        turn into something real are not a reward.
      </>
    ),
    introNote:
      "The figures on this page are read straight from our system, so they always match what the app actually calculates.",

    awkwardTitle: "Three things we say up front",
    awkwardNotMoney: (
      <>
        <B>1. Points are not money.</B> They are not paid out in cash, they cannot be transferred to
        anyone else, and they are not a deposit we hold for you. They are a reward for using the
        app, and they become credit inside Ciao when you choose to convert them.
      </>
    ),
    awkwardExpiry: (months: number) => (
      <>
        <B>2. {months > 0 ? "Points expire." : "Points do not expire."}</B>{" "}
        {months > 0 ? (
          <>
            Every point expires <B>{months} months</B> after you earn it. The expiry date of each
            reward is shown in your points history, and we do not change the date on points you have
            already earned, even if we change the period later.
          </>
        ) : (
          "You will not lose your points as time passes."
        )}
      </>
    ),
    awkwardRates: (
      <>
        <B>3. We may change the reward values.</B> The earning rates and the value of a point can be
        adjusted, and any change applies to what you earn after it — not to what is already in your
        balance.
      </>
    ),

    earnTitle: "How you earn",
    earn: {
      signup: "Creating your membership",
      email_verified: "Verifying your email address",
      stay_completed: "Completing a stay or a service",
      review_written: "Writing a review after your stay",
      referral_qualified: "A friend you invited completes their first booking",
      referred_welcome: "Joining on a friend's invite and completing your first booking",
    } as Record<string, string>,
    earnNote:
      "The invite reward is paid when your friend actually completes a first booking, not when they sign up — so the programme cannot be worked with fake accounts. Each account can use one invite only, and you cannot use your own code.",

    useTitle: "How you use them",
    useCreditTitle: "1. Credit inside Ciao",
    useCreditBody: (perDinar: string, minPoints: string, minLyd: string) => (
      <>
        Every <B>{perDinar}</B> points = 1 dinar of credit, taken off the deposit on your next
        booking automatically. The smallest amount you can convert is <B>{minPoints}</B> points (
        {minLyd} LYD).
      </>
    ),
    usePartnersTitle: "2. At our partners",
    usePartnersOn:
      "Pick a partner and a voucher value, and you get a short code to show at the till. The points are taken the moment the voucher is issued, and if you do not use it within its window your points come back to you automatically.",
    usePartnersOff: "Spending at partners is switched off at the moment.",
    usePartnersLink: "See the partners →",

    termsTitle: "The terms in full",
    termsWhoLabel: "Who qualifies:",
    termsWho:
      "Any Ciao member with a verified phone number. Points are personal and tied to your account; they are not moved to another account, not inherited, and not sold.",
    termsWhenLabel: "When they are added:",
    termsWhen:
      "After the qualifying event is complete — the stay finished, the review published, or your friend's first booking completed. They are not added when you request a booking or when you pay, because a booking can still be cancelled.",
    termsCancelLabel: "On cancellation or refund:",
    termsCancel:
      "If the stay the points were awarded for is cancelled, we may withdraw the points awarded for it.",
    termsAbuseLabel: "Misuse:",
    termsAbuse:
      "Several accounts for the same person, fake invites, and attempts to work around the programme all lead to the points being withdrawn and to being stopped from taking part in the programme.",
    termsCloseLabel: "Closing your account:",
    termsClose:
      "Points are forfeited when the account is closed. Convert your balance before you close it.",
    termsVouchersLabel: "Partner vouchers:",
    termsVouchers:
      "A voucher is valid at the named partner only, once, and within the window shown on it. It is not exchanged for cash and no change is given. The partner is responsible for the quality of what they provide, and any dispute about the service itself is settled with them — and we help.",
    termsChangeLabel: "Changing or ending the programme:",
    termsChange:
      "We may change the programme or stop it with reasonable prior notice. If we stop it, the points in your balance stay convertible for the period we announce.",
    termsLegal:
      "These terms are part of Ciao's terms of use, and are governed by Libyan law. Last updated: August 2026.",

    ctaPoints: "Open my points",
    ctaPartners: "Where to spend",

    footerPlace: "Ciao — ciao.ly · Tripoli, Libya",
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

async function getConfig() {
  try {
    const res = await fetch(`${API_URL}/v1/settings/public`, { next: { revalidate: 300 } });
    if (!res.ok) return FALLBACK;
    const body = (await res.json()) as PublicSettings;
    return body.loyalty ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export default async function RewardsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  const c = copy[locale];
  const cfg = await getConfig();
  const perDinar = Math.round(1000 / cfg.pointToDirham);
  const minRedeemLyd = (cfg.minRedeem * cfg.pointToDirham) / 1000;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/">
          <LogoWithTail size={40} />
        </Link>
        <nav className="flex items-center gap-3 text-sm font-bold text-sea">
          <Link href="/account?tab=points">{c.navPoints}</Link>
          <Link href="/about">{c.navAbout}</Link>
          <LanguageToggle />
        </nav>
      </header>

      <section className="card p-5">
        <h1 className="font-baloo font-extrabold text-2xl text-sea">{c.title}</h1>
        <p className="text-sm text-muted mt-2 leading-relaxed">{c.intro1}</p>
        <p className="text-sm text-muted mt-2 leading-relaxed">{c.intro2}</p>
        <p className="text-xs text-faint mt-3 leading-relaxed">{c.introNote}</p>
      </section>

      {/* The awkward parts, first */}
      <section className="card p-5 mt-4 ring-1 ring-amber/50">
        <h2 className="font-bold text-sea">{c.awkwardTitle}</h2>
        <ol className="text-sm text-sea/80 mt-3 space-y-3 leading-relaxed">
          <li>{c.awkwardNotMoney}</li>
          <li>{c.awkwardExpiry(cfg.expiryMonths)}</li>
          <li>{c.awkwardRates}</li>
        </ol>
      </section>

      <section className="mt-4">
        <h2 className="font-bold text-xl text-sea mb-2">{c.earnTitle}</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(cfg.earnRules)
                .filter(([k]) => c.earn[k])
                .map(([k, v]) => (
                  <tr key={k} className="border-b border-sand last:border-0">
                    <td className="p-3 text-sea/80">{c.earn[k]}</td>
                    <td className="p-3 text-end font-bold text-sea tabular-nums whitespace-nowrap">
                      +{fmtNum(locale, v)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-faint mt-2 leading-relaxed">{c.earnNote}</p>
      </section>

      <section className="mt-4">
        <h2 className="font-bold text-xl text-sea mb-2">{c.useTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="font-bold text-sea">{c.useCreditTitle}</h3>
            <p className="text-sm text-muted mt-1 leading-relaxed">
              {c.useCreditBody(
                fmtNum(locale, perDinar),
                fmtNum(locale, cfg.minRedeem),
                fmtNum(locale, minRedeemLyd, { maximumFractionDigits: 2 }),
              )}
            </p>
          </div>
          <div className="card p-4">
            <h3 className="font-bold text-sea">{c.usePartnersTitle}</h3>
            <p className="text-sm text-muted mt-1 leading-relaxed">
              {cfg.partnersEnabled ? c.usePartnersOn : c.usePartnersOff}
            </p>
            {cfg.partnersEnabled ? (
              <Link href="/rewards/partners" className="text-link font-bold text-sm mt-2 inline-block">
                {c.usePartnersLink}
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mt-4">
        <h2 className="font-bold text-xl text-sea mb-2">{c.termsTitle}</h2>
        <div className="card p-5 text-sm text-sea/80 space-y-3 leading-relaxed">
          <p>
            <B>{c.termsWhoLabel}</B> {c.termsWho}
          </p>
          <p>
            <B>{c.termsWhenLabel}</B> {c.termsWhen}
          </p>
          <p>
            <B>{c.termsCancelLabel}</B> {c.termsCancel}
          </p>
          <p>
            <B>{c.termsAbuseLabel}</B> {c.termsAbuse}
          </p>
          <p>
            <B>{c.termsCloseLabel}</B> {c.termsClose}
          </p>
          <p>
            <B>{c.termsVouchersLabel}</B> {c.termsVouchers}
          </p>
          <p>
            <B>{c.termsChangeLabel}</B> {c.termsChange}
          </p>
          <p className="text-xs text-faint">{c.termsLegal}</p>
        </div>
      </section>

      <div className="flex flex-wrap gap-2 mt-6">
        <Link href="/account?tab=points" className="btn-primary !py-2 !text-sm">
          {c.ctaPoints}
        </Link>
        {cfg.partnersEnabled ? (
          <Link href="/rewards/partners" className="chip">
            {c.ctaPartners}
          </Link>
        ) : null}
      </div>

      <footer className="mt-12 text-center text-sm text-faint">
        <p>{c.footerPlace}</p>
      </footer>
    </main>
  );
}
