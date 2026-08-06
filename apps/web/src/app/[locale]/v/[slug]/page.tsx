import type { Metadata } from "next";
import { Link } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { VerifiedBadge } from "@/components/listing-card";
import { API_URL, fmtLyd } from "@/lib/api";
import { TrackEvent } from "@/components/track";
import { AMENITIES, AREAS, CITIES, term } from "@/lib/vocab";
import { asLocale, type Locale } from "@/lib/i18n";
import { UnitList } from "./units";

export const dynamic = "force-dynamic";

/**
 * The venue storefront — `ciao.ly/v/<slug>`.
 *
 * This page is the answer to how this market actually sells, and it was worth
 * building the moment we looked properly at a single Facebook conversation.
 *
 * Every venue here already has an audience. Lancaster Al Salam has forty-four
 * thousand followers; the halls on Airport Road have tens of thousands each.
 * What they do not have is anywhere to send them. The price list is a
 * photograph of a poster. Availability is a reply, eventually. Booking is a
 * phone call to an office that opens at eleven and shuts at five, and is
 * frequently in a different building from the property. A family scrolling at
 * eleven at night can want a place very much and still not be able to do
 * anything about it until Sunday.
 *
 * So this is not a listing page with a different URL. It is a shopfront the
 * venue owns and pins to the page they already run, and it is built for
 * exactly one visitor: somebody who tapped a link in a post, on a phone, on
 * mobile data, who has never heard of Ciao and does not care about Ciao. Three
 * consequences, and each one is a rule:
 *
 *  - **No wall.** No sign-in, no "create an account to see prices", no
 *    interstitial. A link that asks for something before it gives anything is
 *    a link nobody pins a second time.
 *  - **The price and the availability above everything else.** They came to
 *    find out two things. The verification badge, the neighbours, the facility
 *    list are all reasons to trust the answer — but they are underneath it.
 *  - **The venue's name is the headline, not ours.** Our logo is in the corner
 *    where it belongs. A partner will not pin a page that looks like an
 *    advertisement for somebody else.
 *
 * `?src=` rides in from whichever button the partner copied, and is carried
 * through to the booking, so "what is my Facebook page actually worth" stops
 * being a feeling and becomes a number on their own screen.
 */

const copy = {
  ar: {
    notFound: "هذا المكان غير متاح حاليًا.",
    browse: "تصفّح الأماكن",
    from: "يبدأ من",
    perNight: "/ الليلة",
    allBooked: "كل الوحدات محجوزة حاليًا",
    allBookedBody:
      "المكان كامل العدد في الوقت الحالي. سجّل رقمك على الوحدة اللي تناسبك ونتصل بك أول ما تتفرّغ.",
    units: "الوحدات المتاحة",
    unitsOne: "الوحدة",
    facilities: "مرافق المكان",
    officeHours: (from: string, to: string) => `مكتب الحجوزات يرد يوميًا من ${from} إلى ${to}`,
    officeHoursNote:
      "تقدر تحجز من هنا في أي وقت — الحجز يوصلهم فورًا ويأكدوه في أول وقت دوام.",
    alwaysOpen: "الحجز متاح على مدار اليوم",
    verified: "موثّق من تشاو",
    verifiedBody:
      "فريق تشاو زار المكان بنفسه وتحقق من المرافق والتقط الصور. ما ننشر مكان قبل ما نعتمده.",
    offerTitle: "عرض خاص",
    offerBody: (pct: string, code: string) =>
      `خصم ${pct}٪ برمز ${code} — استعمله عند الحجز.`,
    offerEnds: "ينتهي",
    board: "الإقامة",
    nearby: "قريب من المكان",
    poweredBy: "الحجز والتأكيد عبر تشاو",
    poweredByBody:
      "تشاو تتحقق من كل مكان ميدانيًا، وتحفظ لك التاريخ بعربون، وتتابع أي مشكلة. الباقي يتدفع عند الوصول.",
    share: "شارك المكان",
  },
  en: {
    notFound: "This place isn't available right now.",
    browse: "Browse places",
    from: "From",
    perNight: "/ night",
    allBooked: "Every unit is booked at the moment",
    allBookedBody:
      "The property is full for now. Leave your number on the unit you want and we'll call you the moment it frees up.",
    units: "Available units",
    unitsOne: "The unit",
    facilities: "What's here",
    officeHours: (from: string, to: string) => `The reservations office answers ${from}–${to}, daily`,
    officeHoursNote:
      "You can book here at any hour — the request reaches them straight away and they confirm it when the office opens.",
    alwaysOpen: "Booking is open around the clock",
    verified: "Verified by Ciao",
    verifiedBody:
      "The Ciao team visited this place, checked the facilities and took the photographs. Nothing is published before we've seen it.",
    offerTitle: "Special offer",
    offerBody: (pct: string, code: string) => `${pct}% off with code ${code} — use it at checkout.`,
    offerEnds: "Ends",
    board: "Board",
    nearby: "Nearby",
    poweredBy: "Booked and confirmed through Ciao",
    poweredByBody:
      "Ciao verifies every place in person, holds your date with a deposit, and stands behind it if something goes wrong. The balance is paid on arrival.",
    share: "Share this place",
  },
} satisfies Record<Locale, unknown>;

interface VenueUnit {
  id: string;
  slug: string;
  titleAr: string;
  titleEn?: string | null;
  unitKind?: string | null;
  maxGuests?: number | null;
  includedGuests?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  boardBasis?: string | null;
  minNights?: number | null;
  media?: { url: string }[];
  fromNightly: number;
  soldOut: boolean;
}

interface VenuePage {
  id: string;
  slug: string;
  type: string;
  nameAr: string;
  nameEn?: string | null;
  city: string;
  area?: string | null;
  amenities?: { key: string; present: boolean; detail?: string }[];
  neighbours?: { kind: string; nameAr: string; walkMinutes?: number }[];
  verified: boolean;
  officeHours?: { from: string; to: string } | null;
  units: VenueUnit[];
  fromNightly: number | null;
  allSoldOut: boolean;
  offer?: {
    code: string;
    kind: string;
    value: number;
    descriptionAr?: string | null;
    endsAt?: string | null;
  } | null;
}

async function fetchVenue(slug: string): Promise<VenuePage | null> {
  try {
    const res = await fetch(`${API_URL}/v1/venues/${encodeURIComponent(slug)}`, {
      // A shopfront on a Facebook post gets hammered in bursts and its content
      // barely moves; 60 seconds of cache is the difference between surviving
      // a viral evening and not.
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as VenuePage;
  } catch {
    return null;
  }
}

/**
 * The unfurl card.
 *
 * On Facebook and in a WhatsApp forward this is most of the impression the
 * link makes — often the only part anyone reads before deciding to tap. It
 * carries the venue's name and its cheapest live price, because those are the
 * two things that decide whether the tap happens.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = asLocale(raw);
  const venue = await fetchVenue(slug);
  if (!venue) return { title: "Ciao" };
  const name = locale === "en" ? (venue.nameEn ?? venue.nameAr) : venue.nameAr;
  const place = `${term(CITIES, locale, venue.city)}${venue.area ? ` · ${term(AREAS, locale, venue.area)}` : ""}`;
  const price =
    venue.fromNightly != null
      ? locale === "en"
        ? `From ${fmtLyd(venue.fromNightly, locale)} a night`
        : `يبدأ من ${fmtLyd(venue.fromNightly, locale)} لليلة`
      : "";
  const description = [place, price].filter(Boolean).join(" — ");
  const image = venue.units.find((u) => u.media?.length)?.media?.[0]?.url;
  return {
    title: `${name} — ${locale === "en" ? "book on Ciao" : "احجز على تشاو"}`,
    description,
    openGraph: {
      title: name,
      description,
      type: "website",
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

export default async function VenuePageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw, slug } = await params;
  const locale = asLocale(raw);
  const c = copy[locale];
  const sp = await searchParams;
  const src = typeof sp.src === "string" ? sp.src : "direct";

  const venue = await fetchVenue(slug);
  if (!venue) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-muted">{c.notFound}</p>
        <Link href="/search?type=coast" className="btn-primary inline-block mt-4">
          {c.browse}
        </Link>
      </main>
    );
  }

  const name = locale === "en" ? (venue.nameEn ?? venue.nameAr) : venue.nameAr;
  const hero = venue.units.find((u) => u.media?.length)?.media?.[0]?.url;
  const present = (venue.amenities ?? []).filter((a) => a.present);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      {/*
        Our mark is small and in the corner on purpose. A partner will not pin
        a page to their own audience if it reads as somebody else's
        advertisement — the venue's name is the headline here, and Ciao is the
        thing that makes the booking work.
      */}
      <header className="flex items-center justify-between py-3">
        <Link href="/" aria-label="Ciao">
          <Logo />
        </Link>
        <LanguageToggle />
      </header>

      <TrackEvent name="venue.opened" props={{ venueId: venue.id, src }} />

      <section className="card overflow-hidden">
        {hero ? (
          <div className="relative h-56 sm:h-72">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={hero} alt={name} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 photo-scrim-soft" />
            <div className="absolute bottom-0 inset-x-0 p-4">
              <h1 className="text-2xl sm:text-3xl font-bold text-white">{name}</h1>
              <p className="text-white/90 text-sm mt-1">
                {term(CITIES, locale, venue.city)}
                {venue.area ? ` · ${term(AREAS, locale, venue.area)}` : ""}
              </p>
            </div>
          </div>
        ) : (
          <div className="p-5">
            <h1 className="text-2xl font-bold text-sea">{name}</h1>
            <p className="text-muted text-sm mt-1">{term(CITIES, locale, venue.city)}</p>
          </div>
        )}

        <div className="p-4 flex flex-wrap items-center gap-3 justify-between">
          <div>
            {venue.fromNightly != null ? (
              <p>
                <span className="text-xs text-faint">{c.from}</span>{" "}
                <span className="text-2xl font-bold text-sea">
                  {fmtLyd(venue.fromNightly, locale)}
                </span>
                <span className="text-xs text-faint"> {c.perNight}</span>
              </p>
            ) : (
              <p className="font-bold text-sea">{c.allBooked}</p>
            )}
          </div>
          {venue.verified ? <VerifiedBadge /> : null}
        </div>
      </section>

      {/*
        A live offer, stated once and loudly.
        This is the thing the partner announced on Facebook; a visitor who
        arrived because of it must not have to hunt for it.
      */}
      {venue.offer ? (
        <section className="card p-4 mt-4 bg-amber text-sea-dark">
          <p className="font-bold">🎟 {c.offerTitle}</p>
          <p className="mt-1">
            {c.offerBody(
              venue.offer.kind === "percent"
                ? String(Math.round(venue.offer.value / 100))
                : fmtLyd(venue.offer.value, locale),
              venue.offer.code,
            )}
          </p>
          {venue.offer.descriptionAr ? (
            <p className="text-sm mt-1" lang="ar" dir="rtl">
              {venue.offer.descriptionAr}
            </p>
          ) : null}
        </section>
      ) : null}

      {venue.allSoldOut ? (
        <p className="text-muted text-sm mt-4">{c.allBookedBody}</p>
      ) : null}

      {/*
        The units. A resort is one property with several products at several
        prices — Lancaster sells chalets, villas and a duplex from one gate —
        and until this page existed our search showed them as three unrelated
        cards with no way to tell they shared a beach.
      */}
      <UnitList
        units={venue.units}
        venueId={venue.id}
        src={src}
        offerCode={venue.offer?.code ?? null}
        heading={venue.units.length === 1 ? c.unitsOne : c.units}
      />

      {present.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-bold text-lg text-sea mb-2">{c.facilities}</h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {present.map((a) => (
              <li key={a.key} className="chip justify-start">
                {term(AMENITIES, locale, a.key)}
                {a.detail ? <span className="text-faint text-xs"> · {a.detail}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        Opening hours, said out loud, with the reassurance attached.
        A resort desk that runs 11:00–17:00 is not a problem for a guest
        booking here at midnight — the request lands instantly and the
        countdown does not start until somebody could answer it — but only if
        we say so. Silence reads as "nobody is coming".
      */}
      <section className="card p-4 mt-8">
        <p className="font-bold text-sea">
          {venue.officeHours
            ? c.officeHours(venue.officeHours.from, venue.officeHours.to)
            : c.alwaysOpen}
        </p>
        {venue.officeHours ? (
          <p className="text-sm text-muted mt-1">{c.officeHoursNote}</p>
        ) : null}
      </section>

      {venue.verified ? (
        <section className="card p-4 mt-4">
          <p className="font-bold text-sea">✓ {c.verified}</p>
          <p className="text-sm text-muted mt-1">{c.verifiedBody}</p>
        </section>
      ) : null}

      <section className="card p-4 mt-4">
        <p className="font-bold text-sea">{c.poweredBy}</p>
        <p className="text-sm text-muted mt-1">{c.poweredByBody}</p>
      </section>

      <footer className="mt-10 text-center text-sm text-faint space-y-1">
        <p>
          <Link href="/about" className="font-bold text-sea/80 hover:text-sea">
            {locale === "en" ? "Who we are" : "من نحن"}
          </Link>
        </p>
        <p>
          {locale === "en"
            ? "Ciao — ciao.ly · Made with Love in Libya"
            : "تشاو — ciao.ly · صُنع بحب في ليبيا"}
        </p>
      </footer>
    </main>
  );
}
