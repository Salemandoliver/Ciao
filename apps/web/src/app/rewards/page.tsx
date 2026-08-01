import type { Metadata } from "next";
import Link from "next/link";
import { LogoWithTail } from "@/components/logo";
import { API_URL } from "@/lib/api";

/**
 * Reward points — the terms, in plain Arabic.
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
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: "نقاط المكافآت — شروط البرنامج | تشاو",
  description:
    "كيف تكسب نقاط تشاو، وكيف تستخدمها، ومتى تنتهي صلاحيتها — بلغة واضحة وأرقام محدّثة من النظام مباشرة.",
};

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

const EARN_AR: Record<string, string> = {
  signup: "إنشاء العضوية",
  email_verified: "توثيق بريدك الإلكتروني",
  stay_completed: "إتمام إقامة أو خدمة",
  review_written: "كتابة تقييم بعد الإقامة",
  referral_qualified: "صديق دعوته أتمّ أول حجز له",
  referred_welcome: "انضمامك بدعوة صديق وإتمام أول حجز",
};

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

export default async function RewardsPage() {
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
          <Link href="/account?tab=points">نقاطي</Link>
          <Link href="/about">من نحن</Link>
        </nav>
      </header>

      <section className="card p-5">
        <h1 className="font-baloo font-extrabold text-2xl text-sea">نقاط تشاو</h1>
        <p className="text-sm text-sea/75 mt-2 leading-relaxed">
          تكسب نقاطًا حين تستخدم تشاو فعلًا — لا مقابل التسجيل وحده. تحوّلها إلى رصيد يخصم من
          عربون حجزك القادم، أو تصرفها عند أحد شركائنا: مقهى داخل المنتجع، مخبز، أو مطعم قريب.
        </p>
        <p className="text-sm text-sea/75 mt-2 leading-relaxed">
          وضعنا القيم على قاعدة بسيطة: <strong className="text-sea">إقامة واحدة مكتملة تكفي
          لقهوة عند أحد شركائنا</strong>. النقاط التي لا تتحول إلى شيء ملموس ليست مكافأة.
        </p>
        <p className="text-xs text-sea/55 mt-3 leading-relaxed">
          الأرقام في هذه الصفحة تُقرأ مباشرة من نظامنا، فهي دائمًا مطابقة لما يحسبه التطبيق فعلًا.
        </p>
      </section>

      {/* The awkward parts, first */}
      <section className="card p-5 mt-4 ring-1 ring-amber/50">
        <h2 className="font-bold text-sea">ثلاثة أشياء نقولها من البداية</h2>
        <ol className="text-sm text-sea/80 mt-3 space-y-3 leading-relaxed">
          <li>
            <strong className="text-sea">١. النقاط ليست نقودًا.</strong> لا تُصرف نقدًا ولا
            تُحوَّل لشخص آخر، وليست وديعة لدينا. هي مكافأة على استخدامك للتطبيق، تتحول إلى رصيد
            داخل تشاو حين تختار ذلك.
          </li>
          <li>
            <strong className="text-sea">
              ٢. {cfg.expiryMonths > 0 ? "للنقاط مدة صلاحية." : "النقاط لا تنتهي صلاحيتها."}
            </strong>{" "}
            {cfg.expiryMonths > 0 ? (
              <>
                كل نقطة تنتهي بعد{" "}
                <strong className="text-sea">{cfg.expiryMonths} شهرًا</strong> من كسبها. تاريخ
                انتهاء كل مكافأة يظهر في سجل نقاطك، ولا نغيّر تاريخ نقاط كسبتها بالفعل حتى لو
                غيّرنا المدة لاحقًا.
              </>
            ) : (
              "لن تفقد نقاطك بمرور الوقت."
            )}
          </li>
          <li>
            <strong className="text-sea">٣. قد نغيّر قيم المكافآت.</strong> نسب الكسب وقيمة
            النقطة قابلة للتعديل، وأي تعديل يسري على ما تكسبه بعده — لا على ما في رصيدك.
          </li>
        </ol>
      </section>

      <section className="mt-4">
        <h2 className="font-bold text-xl text-sea mb-2">كيف تكسب</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(cfg.earnRules)
                .filter(([k]) => EARN_AR[k])
                .map(([k, v]) => (
                  <tr key={k} className="border-b border-sand last:border-0">
                    <td className="p-3 text-sea/80">{EARN_AR[k]}</td>
                    <td className="p-3 text-end font-bold text-sea tabular-nums whitespace-nowrap">
                      +{v}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-sea/55 mt-2 leading-relaxed">
          مكافأة الدعوة تُصرف حين يُتمّ صديقك أول حجز فعليًا، لا عند تسجيله — حتى لا يُستغل
          البرنامج بحسابات وهمية. لكل حساب دعوة واحدة فقط، ولا يمكنك استخدام كودك أنت.
        </p>
      </section>

      <section className="mt-4">
        <h2 className="font-bold text-xl text-sea mb-2">كيف تستخدمها</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="font-bold text-sea">١. رصيد داخل تشاو</h3>
            <p className="text-sm text-sea/75 mt-1 leading-relaxed">
              كل <strong className="text-sea">{perDinar}</strong> نقطة = ١ دينار رصيد، يُخصم
              تلقائيًا من عربون حجزك القادم. أقل مبلغ للتحويل{" "}
              <strong className="text-sea">{cfg.minRedeem}</strong> نقطة (
              {minRedeemLyd.toLocaleString("ar-LY", { maximumFractionDigits: 2 })} د.ل).
            </p>
          </div>
          <div className="card p-4">
            <h3 className="font-bold text-sea">٢. عند شركائنا</h3>
            <p className="text-sm text-sea/75 mt-1 leading-relaxed">
              {cfg.partnersEnabled
                ? "اختر شريكًا وقيمة القسيمة، فتظهر لك بكود قصير تعرضه عند الكاشير. تُخصم النقاط فور إصدار القسيمة، وإن لم تستخدمها خلال مدتها تعود نقاطك إليك تلقائيًا."
                : "الصرف عند الشركاء غير مفعّل حاليًا."}
            </p>
            {cfg.partnersEnabled ? (
              <Link href="/rewards/partners" className="text-amber-dark font-bold text-sm mt-2 inline-block">
                شاهد الشركاء ←
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mt-4">
        <h2 className="font-bold text-xl text-sea mb-2">الشروط بالتفصيل</h2>
        <div className="card p-5 text-sm text-sea/80 space-y-3 leading-relaxed">
          <p>
            <strong className="text-sea">من يستحق:</strong> أي عضو في تشاو برقم هاتف موثّق. النقاط
            شخصية ومرتبطة بحسابك، ولا تُنقل إلى حساب آخر ولا تُورَّث ولا تُباع.
          </p>
          <p>
            <strong className="text-sea">متى تُضاف:</strong> بعد إتمام الحدث المستحق — إتمام
            الإقامة، أو نشر التقييم، أو إتمام صديقك لأول حجز. لا تُضاف عند الطلب أو عند الدفع، لأن
            الحجز قد يُلغى.
          </p>
          <p>
            <strong className="text-sea">عند الإلغاء أو الاسترجاع:</strong> إن أُلغيت الإقامة التي
            مُنحت عنها النقاط، يجوز لنا سحب النقاط المقابلة لها.
          </p>
          <p>
            <strong className="text-sea">سوء الاستخدام:</strong> الحسابات المتعددة لنفس الشخص،
            والدعوات الوهمية، ومحاولات التحايل على البرنامج — كلها تؤدي إلى سحب النقاط وإيقاف
            المشاركة في البرنامج.
          </p>
          <p>
            <strong className="text-sea">إغلاق الحساب:</strong> النقاط تسقط عند إغلاق الحساب. حوّل
            رصيدك قبل الإغلاق.
          </p>
          <p>
            <strong className="text-sea">القسائم لدى الشركاء:</strong> القسيمة صالحة لدى الشريك
            المحدد فقط، ولمرة واحدة، وخلال المدة الظاهرة عليها. لا تُستبدل نقدًا ولا يُعاد باقيها.
            الشريك مسؤول عن جودة ما يقدّمه، وأي خلاف بشأن الخدمة نفسها يُحل معه — ونحن نساعد.
          </p>
          <p>
            <strong className="text-sea">التعديل والإيقاف:</strong> يجوز لنا تعديل البرنامج أو
            إيقافه بإشعار مسبق معقول. عند الإيقاف، تبقى النقاط التي في رصيدك قابلة للتحويل خلال
            المدة التي نعلنها.
          </p>
          <p className="text-xs text-sea/55">
            هذه الشروط جزء من شروط استخدام تشاو، وتخضع للقانون الليبي. آخر تحديث: أغسطس ٢٠٢٦.
          </p>
        </div>
      </section>

      <div className="flex flex-wrap gap-2 mt-6">
        <Link href="/account?tab=points" className="btn-primary !py-2 !text-sm">
          افتح نقاطي
        </Link>
        {cfg.partnersEnabled ? (
          <Link href="/rewards/partners" className="chip">
            شركاء الصرف
          </Link>
        ) : null}
      </div>

      <footer className="mt-12 text-center text-sm text-sea/60">
        <p>تشاو — ciao.ly · طرابلس، ليبيا</p>
      </footer>
    </main>
  );
}
