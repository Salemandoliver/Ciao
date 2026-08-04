import type { Metadata } from "next";
import { Link } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { Eyebrow } from "@/components/brand";
import { TrackEvent } from "@/components/track";
import { HostContact } from "@/components/host-contact";
import { API_URL } from "@/lib/api";
import { asLocale, type Locale } from "@/lib/i18n";

/**
 * للمضيفين — the page a host lands on from «اعرض مكانك».
 *
 * It exists because the supply band was writing a cheque the product could not
 * cash. There is no self sign-up: an account is opened after somebody from
 * Ciao has stood in the place. A button promising "list your place" that
 * dropped a host into a registration form would be a lie discovered on the
 * second screen, and a button that dropped them into an anchor halfway down
 * the About page would read as an accident.
 *
 * So the page says the true thing early and makes it sound like what it is —
 * an advantage. A marketplace that visits every venue is slower to fill and
 * much harder to fake, and the host reading this is the person who loses most
 * to a listings site full of places nobody checked.
 *
 * What it deliberately does NOT do is take a booking-style form. Collecting a
 * name and a phone number here would create a queue nothing empties, and a
 * host whose enquiry sat unanswered for three weeks is worse off than one who
 * never wrote. WhatsApp is where this conversation actually happens in Libya,
 * so WhatsApp is the button — and when no number is configured the button
 * disappears rather than opening a dead chat.
 */

export const revalidate = 300;

const copy = {
  ar: {
    nav: "الرئيسية",
    eyebrow: "عندك مكان يستاهل الناس تعرفه؟",
    head: "خلّ مكانك جزءًا من",
    headAccent: "حكاياتهم",
    lead: "شاليه، استراحة، قاعة، أو خدمة تكمّل المناسبة — إذا كان مكانك يستاهل، نجيك ونشوفه بأنفسنا، ونصوّره، وندخّله للناس اللي يدوّروا عليه.",
    howTitle: "كيف تمشي الأمور",
    how: [
      [
        "١",
        "تكلّمنا",
        "رسالة واتساب فيها اسم المكان وموقعه تكفي للبداية. ما في استمارة طويلة ولا وثائق من أول يوم.",
      ],
      [
        "٢",
        "نجي نزورك",
        "مندوب من تشاو يجي للمكان، يشوفه، يفحص الأساسيات — المولّد، المياه، الخصوصية — ويصوّره بنفسه. الصور اللي تنشر هي صورنا، مش صور مأخوذة من الإنترنت.",
      ],
      [
        "٣",
        "نفتح لك حسابك",
        "نجهّز صفحتك وندّيك حساب في تطبيق «تشاو للشركاء» — تقويمك وحجوزاتك وفلوسك في مكان واحد، وتقدر تديره من التلفون.",
      ],
    ],
    whyTitle: "ليش تشاو",
    why: [
      [
        "كل حجوزاتك، مش بس اللي جاتك مننا",
        "التطبيق يمسك دفترك كامل. الحجز اللي جاك من قريب أو من واتساب يظل حجزك: بدون عمولة، وما نكلّم زبونك أبدًا. وتسجيله يقفل التاريخ عندنا تلقائيًا فما يجيك حجزين على نفس اليوم.",
      ],
      [
        "عربون يوصلك، مش وعد",
        "الزبون يدفع ٢٠٪ أونلاين باش يقفل التاريخ. تعرف إنه جاد قبل ما تحجز له، والباقي نقدًا عند الوصول زي ما تعوّدت.",
      ],
      [
        "التوثيق يشتغل لصالحك",
        "زيارتنا وصورنا وشارة التوثيق هي اللي تفرّق مكانك عن إعلان في مجموعة. المكان الموثّق يظهر أول، والترتيب عندنا ما ينشرى.",
      ],
      [
        "تعرف السوق مش تخمّنه",
        "أسعار المنطقة، أوقات الذروة، ومن وين يجوك الزبائن — أرقامك مجانية دائمًا، وأرقام السوق مفتوحة في اشتراك تشاو بلس.",
      ],
    ],
    honestTitle: "الكلام الصريح",
    honestBody:
      "تشاو لسه في بدايتها ونشتغل على شريط ساحلي واحد وعدد محدود من الأماكن نعرفها واحدًا واحدًا. يعني الزيارة تاخد وقت، وممكن ما نقدرش نوصلك هالأسبوع. بس ما نكتب عن مكان ما شفناه — وهذا نفس السبب اللي يخلّي الناس تثق في اللي مكتوب عن مكانك.",
    ctaTitle: "كلّمنا",
    ctaBody: "رسالة واحدة تكفي: اسم المكان، وين، وكم يستوعب.",
    ctaButton: "راسلنا واتساب",
    noContact:
      "خط المضيفين مقفول مؤقتًا. جرّب مرة ثانية قريبًا، أو كلّم أي مندوب من تشاو تعرفه.",
    partnerNote:
      "عندك حساب شريك من قبل؟ تطبيق الشركاء له رابطه الخاص اللي وصلك مع بيانات الدخول.",
    back: "رجوع للرئيسية",
  },
  en: {
    nav: "Home",
    eyebrow: "Got a place people should know about?",
    head: "Make it part of their",
    headAccent: "story",
    lead: "A chalet, an estiraha, a hall, or a service that completes the occasion — if your place is worth it, we come and see it ourselves, photograph it, and put it in front of the people looking for exactly that.",
    howTitle: "How it works",
    how: [
      [
        "1",
        "Talk to us",
        "A WhatsApp message with the name of the place and where it is, is enough to start. No long form and no paperwork on day one.",
      ],
      [
        "2",
        "We come and visit",
        "Someone from Ciao comes to the place, looks at it, checks the things that decide a stay — the generator, the water, the privacy — and photographs it. The pictures we publish are ours, not pulled off the internet.",
      ],
      [
        "3",
        "We open your account",
        "We build your page and give you an account in the Ciao Partners app — your calendar, your bookings and your money in one place, run from your phone.",
      ],
    ],
    whyTitle: "Why Ciao",
    why: [
      [
        "Your whole diary, not just what we send you",
        "The app holds your entire book. A booking that came from a cousin or a WhatsApp thread stays yours: no commission, and we never contact your customer. Recording it also takes the date off our calendar, so you never get double-booked.",
      ],
      [
        "A deposit that actually arrives",
        "Guests pay 20% online to hold the date. You know they mean it before you turn anyone else away, and the balance is cash on arrival, the way you already work.",
      ],
      [
        "Verification works in your favour",
        "Our visit, our photographs and the verified badge are what separate your place from a post in a group. Verified places rank first, and ranking is not for sale.",
      ],
      [
        "Know the market instead of guessing it",
        "Prices in your area, when demand peaks, and where your customers come from — your own numbers are free forever, and the market's are open with Ciao Plus.",
      ],
    ],
    honestTitle: "The honest part",
    honestBody:
      "Ciao is early, and we are working one coastal strip and a small number of places we know one by one. That means a visit takes time and we may not reach you this week. But we do not write about a place we have not seen — which is the same reason people will believe what is written about yours.",
    ctaTitle: "Get in touch",
    ctaBody: "One message is enough: the name of the place, where it is, and how many it holds.",
    ctaButton: "Message us on WhatsApp",
    noContact:
      "The hosts line is temporarily closed. Try again shortly, or speak to any Ciao agent you already know.",
    partnerNote:
      "Already have a partner account? The Partners app has its own address, sent to you with your sign-in details.",
    back: "Back to home",
  },
} satisfies Record<Locale, unknown>;

/**
 * The contact number is a control-plane value, so the page reads it at request
 * time rather than baking it into the bundle. It is also allowed to be absent:
 * see `contact.hostsWhatsapp` in the settings module for why a missing number
 * removes the button instead of rendering a broken one.
 */
async function getWhatsapp(): Promise<string> {
  try {
    const res = await fetch(`${API_URL}/v1/settings/public`, { next: { revalidate: 60 } });
    if (!res.ok) return "";
    const body = (await res.json()) as { contact?: { hostsWhatsapp?: string } };
    return (body.contact?.hostsWhatsapp ?? "").replace(/[^\d]/g, "");
  } catch {
    return "";
  }
}

export default async function HostsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  const c = copy[locale];
  const whatsapp = await getWhatsapp();

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16">
      <TrackEvent name="supply.page_viewed" props={{ ref: "direct" }} />

      <header className="flex items-center justify-between py-4">
        <Logo />
        <nav className="flex items-center gap-3 text-sm font-bold text-sea">
          <Link href="/">{c.nav}</Link>
          <LanguageToggle />
        </nav>
      </header>

      <section className="card p-6 sm:p-10">
        <Eyebrow>{c.eyebrow}</Eyebrow>
        <h1 className="font-baloo font-extrabold text-3xl sm:text-5xl leading-tight text-sea mt-3">
          {c.head} <span className="text-link">{c.headAccent}</span>
        </h1>
        <p className="mt-4 text-muted sm:text-lg leading-relaxed max-w-2xl">{c.lead}</p>
      </section>

      <section className="mt-8">
        <h2 className="font-bold text-xl text-sea mb-3">{c.howTitle}</h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {c.how.map(([step, title, body]) => (
            <li key={step} className="card p-5">
              {/* The numeral takes `sea`, not `link`. Amber-on-amber-tint is
                  the pairing that keeps failing AA in dark, where `link`
                  relaxes back toward the brand and lands at 3.8:1 on its own
                  15% wash. `sea` inverts with the theme and clears the tint in
                  both. */}
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber/20 font-extrabold text-sea">
                {step}
              </span>
              <h3 className="font-bold text-sea mt-3">{title}</h3>
              <p className="text-sm text-muted mt-1 leading-relaxed">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8">
        <h2 className="font-bold text-xl text-sea mb-3">{c.whyTitle}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {c.why.map(([title, body]) => (
            <div key={title} className="card p-5">
              <h3 className="font-bold text-sea">{title}</h3>
              <p className="text-sm text-muted mt-1 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The catch, published rather than buried — the same device the About
          page uses. A host who is told the awkward part up front has a reason
          to believe the flattering parts. */}
      <section className="card p-5 mt-8 tone-warn">
        <h2 className="font-bold text-sea">{c.honestTitle}</h2>
        <p className="text-sm text-muted mt-1 leading-relaxed">{c.honestBody}</p>
      </section>

      <HostContact
        whatsapp={whatsapp}
        title={c.ctaTitle}
        body={c.ctaBody}
        button={c.ctaButton}
        unavailable={c.noContact}
      />

      <p className="text-xs text-faint mt-6 text-center max-w-xl mx-auto leading-relaxed">
        {c.partnerNote}
      </p>

      <footer className="mt-10 text-center">
        <Link href="/" className="text-link font-bold text-sm">
          {c.back}
        </Link>
      </footer>
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const c = copy[asLocale((await params).locale)];
  return { title: `${c.head} ${c.headAccent} — Ciao`, description: c.lead };
}
