import type { Metadata } from "next";
import { Link } from "@/lib/locale";
import { Stars, VerifiedBadge } from "@/components/listing-card";
import { API_URL, fmtLyd } from "@/lib/api";
import type { PublicListing } from "@/lib/types";
import { thumb } from "@/lib/types";
import { BookingWidget } from "./booking-widget";
import { Nearby } from "./nearby";
import { TrackEvent } from "@/components/track";
import { Heart } from "@/components/heart";
import { CardGallery } from "@/components/card-gallery";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { SiteHeader } from "@/components/site-header";
import { TrustButton, TrustStars } from "@/components/trust-dialog";
import { listingDescription, listingTitle, textProps } from "@/lib/content";
import { AMENITIES, AREAS, CITIES, REVIEW_DIMENSIONS, fmtDate, term } from "@/lib/vocab";
import { asLocale, bcp47, type Locale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * Listing-page copy.
 *
 * This page makes the promises the whole marketplace rests on — what the badge
 * means, when the address appears, what happens to the deposit — so the English
 * says exactly what the Arabic says and not one degree more. «الستر» is the
 * privacy the walls and the approach give the women in the party; it is a fact
 * about the property, described as such.
 */
const copy = {
  ar: {
    notFound: "هذا المكان غير متاح حاليًا.",
    browseSimilar: "تصفّح أماكن مشابهة",
    backToSearch: "→ رجوع للبحث",

    verifiedHeading: "✓ ماذا يعني «موثّق من تشاو»؟",
    verifiedService:
      "فريق تشاو قابل هذا المزوّد شخصيًا، تحقق من نشاطه ومن أعماله السابقة، واعتمده — لا يُنشر أي مزوّد قبل أن نعتمده بأنفسنا. والتوثيق يُجدَّد سنويًا.",
    verifiedStay:
      "فريق تشاو زار هذا المكان بنفسه، تحقق من المالك ومن كل المرافق، والتقط الصور بنفسه — لا يُنشر أي مكان قبل أن نعتمده شخصيًا. والتوثيق يُجدَّد سنويًا. تفاصيل الفحص كاملة في جدول الحقائق.",

    serviceIncludes: "ماذا تشمل الخدمة",
    factsTable: "جدول الحقائق",
    checked: (when: string) => ` · تحقق ${when}`,
    privacyScore: "🔒 درجة الستر",
    walledPool: " · مسبح مسوَّر",
    notOverlooked: " · غير مكشوف على الجيران",

    packages: "الباقات",
    packagesNote: "القاعات تُعاين قبل الحجز — اطلب موعد زيارة وسنرتب لك المعاينة.",

    thingsToKnow: "أشياء تعرفها",
    cancellation: "🗓 سياسة الإلغاء",
    cancellationService: "تُحدَّد مع المزوّد في عرض السعر قبل الدفع — بلا شروط مخفية.",
    tiers: {
      flexible: "مرنة: استرجاع كامل للعربون حتى ٤٨ ساعة قبل الوصول",
      moderate: "متوسطة: استرجاع كامل قبل ٧ أيام، ونصفه بعد ذلك",
      strict: "صارمة: عربون قفل التاريخ غير مسترجَع — والتنازل ممكن عبر بورصة تشاو",
    },
    howService: "🔑 كيف تتم الخدمة",
    houseRules: "🔑 قواعد البيت",
    howServiceBody:
      "تتفق مع المزوّد على التفاصيل عبر فريق تشاو، ويُثبَّت السعر كتابيًا قبل أي دفع.",
    houseRulesDefault: "يحددها المضيف عند التأكيد — اسأله في المحادثة.",
    locationPrivacy: "📍 الموقع والخصوصية",
    locationService: (place: string) =>
      `المنطقة: ${place} — بيانات التواصل مع المزوّد تصلك بعد تأكيد الطلب عبر فريق تشاو.`,
    locationStay: (place: string) =>
      `المنطقة: ${place} — العنوان الدقيق ورقم المضيف يظهران فور دفع العربون. هذا يحمي الطرفين.`,

    guestRatings: "تقييم الضيوف",
    distribution: "التوزيع",
    realStays: "تقييمات من إقامات حقيقية",
    hostReply: "↩ رد المضيف:",
    noReviews:
      "التقييمات تُقبل فقط من ضيوف أكملوا إقامة مدفوعة العربون — لا تقييمات مزيفة.",
    allReviews: "⭐ كل التقييمات وسجل الشكاوى",

    similarServices: "مزوّدون مشابهون",
    similarPlaces: "أماكن مشابهة قريبة",
    verifiedShort: "✓ موثّق",
    perNight: (price: string) => ` · ${price}/ليلة`,

    metaFallback: "تشاو",
    metaTitle: (title: string) => `${title} — تشاو`,
    metaVerified: "✓ موثّق من تشاو · ",
    metaPrice: (price: string) => `${price}/ليلة · `,
    metaTail: "احجز بعربون بسيط والباقي عند الوصول",
    siteName: "Ciao — تشاو",
  },
  en: {
    notFound: "This place is not available right now.",
    browseSimilar: "Browse similar places",
    backToSearch: "← Back to search",

    verifiedHeading: "✓ What does «Ciao verified» mean?",
    verifiedService:
      "Someone from Ciao met this provider in person, checked their business and their past work, and approved them — no provider goes live before we approve them ourselves. Verification is renewed every year.",
    verifiedStay:
      "Someone from Ciao visited this place, checked the owner and every facility, and took the photographs themselves — no place goes live before we approve it in person. Verification is renewed every year. The full inspection detail is in the facts table.",

    serviceIncludes: "What the service includes",
    factsTable: "The facts table",
    checked: (when: string) => ` · checked ${when}`,
    privacyScore: "🔒 Privacy score",
    walledPool: " · walled pool",
    notOverlooked: " · not overlooked by neighbours",

    packages: "Packages",
    packagesNote:
      "Halls are viewed before they are booked — ask for a visit and we will arrange it.",

    thingsToKnow: "Things to know",
    cancellation: "🗓 Cancellation policy",
    cancellationService:
      "Agreed with the provider in the quote before you pay — no hidden conditions.",
    tiers: {
      flexible: "Flexible: full refund of the deposit up to 48 hours before check-in",
      moderate: "Moderate: full refund up to 7 days before, half after that",
      strict:
        "Strict: the deposit that holds the date is non-refundable — you can pass the booking on through the Ciao exchange",
    },
    howService: "🔑 How the service works",
    houseRules: "🔑 House rules",
    howServiceBody:
      "You agree the details with the provider through the Ciao team, and the price is fixed in writing before any payment.",
    houseRulesDefault: "The host sets them at confirmation — ask them in the chat.",
    locationPrivacy: "📍 Location and privacy",
    locationService: (place: string) =>
      `Area: ${place} — the provider's contact details reach you once the request is confirmed through the Ciao team.`,
    locationStay: (place: string) =>
      `Area: ${place} — the exact address and the host's number appear the moment the deposit is paid. That protects both sides.`,

    guestRatings: "Guest ratings",
    distribution: "Spread",
    realStays: "Reviews from real stays",
    hostReply: "↩ Host's reply:",
    noReviews:
      "Reviews are only accepted from guests who completed a stay they paid a deposit on — no fake reviews.",
    allReviews: "⭐ All reviews and the complaints record",

    similarServices: "Similar providers",
    similarPlaces: "Similar places nearby",
    verifiedShort: "✓ Verified",
    perNight: (price: string) => ` · ${price}/night`,

    metaFallback: "Ciao",
    metaTitle: (title: string) => `${title} — Ciao`,
    metaVerified: "✓ Ciao verified · ",
    metaPrice: (price: string) => `${price}/night · `,
    metaTail: "Book with a small deposit and pay the rest on arrival",
    siteName: "Ciao — تشاو",
  },
} satisfies Record<Locale, unknown>;

async function getListing(slug: string): Promise<PublicListing | null> {
  try {
    const res = await fetch(`${API_URL}/v1/listings/${slug}`, {
      next: { revalidate: 120 },
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicListing;
  } catch {
    return null;
  }
}

/**
 * WhatsApp/Instagram unfurl cards (§8.1(5)) — distribution IS social shares.
 *
 * The card has to be in the language of the link that was forwarded: a Libyan
 * in Manchester who shares `/en/l/…` into a family group should see the English
 * card, and the Arabic link the Arabic one.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = asLocale(raw);
  const c = copy[locale];
  const l = await getListing(slug);
  if (!l) return { title: c.metaFallback };
  const title = listingTitle(locale, l).text;
  const desc = `${l.verified ? c.metaVerified : ""}${
    l.baseNightly > 0 ? c.metaPrice(fmtLyd(l.baseNightly, locale)) : ""
  }${c.metaTail}`;
  return {
    title: c.metaTitle(title),
    description: desc,
    openGraph: {
      title,
      description: desc,
      type: "website",
      locale: bcp47(locale).replace("-", "_"),
      siteName: c.siteName,
    },
  };
}

export default async function ListingPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: raw, slug } = await params;
  const locale = asLocale(raw);
  const c = copy[locale];
  const l = await getListing(slug);
  if (!l) {
    return (
      <main className="mx-auto max-w-3xl p-8 text-center">
        <p>{c.notFound}</p>
        <Link className="btn-primary inline-block mt-4" href="/search">
          {c.browseSimilar}
        </Link>
      </main>
    );
  }

  const title = listingTitle(locale, l);
  const description = listingDescription(locale, l);
  const houseRules = listingDescription(locale, { descriptionAr: l.houseRulesAr });
  const place = term(AREAS, locale, l.area) || term(CITIES, locale, l.city);
  const tier = c.tiers[l.cancellationTier];

  return (
    /* `max-w-7xl` like the home and search pages: the split below is already
       two thirds and one third, and at 5xl that made the booking panel a
       320px column of numbers on a 1440px screen. */
    <main className="mx-auto max-w-7xl px-4 pb-24">
      <TrackEvent
        name="listing.viewed"
        props={{
          listingId: l.id,
          vertical: l.type,
          city: l.city,
          area: l.area,
          priceNightly: l.baseNightly,
        }}
      />
      <SiteHeader
        centre={
          <Link href="/search" className="text-sm font-bold text-sea">
            {c.backToSearch}
          </Link>
        }
      />

      {/* Photo carousel — our shots (§8.5) */}
      {(() => {
        const photos = l.media
          .filter((m) => m.kind === "photo")
          .sort((a, b) => a.order - b.order);
        return (
          /*
            Sized, not proportioned.

            This was `aspect-[16/9]`, which in a 7xl container is a 720px-tall
            photograph — taller than the usable height of most laptop screens
            once the header is on it. The name of the place, its price and its
            Book Now button were all below the fold on the page whose entire job
            is to sell that place, and a guest had to scroll to find out what
            they were looking at.

            A height rather than a ratio, because the constraint is the screen
            and not the picture: a little under half the viewport, floored so it
            does not collapse on a short window and capped so it does not run
            away on a tall one. `svh` for the same reason the hero uses it — a
            mobile address bar must not be able to push the title off.
          */
          <div className="card relative group h-[45svh] min-h-[220px] max-h-[520px] photo-placeholder">
            {/*
              The same carousel the result cards use, which already solves the
              things this one had not: arrows that say previous and next rather
              than left and right, dots, swipe, and no visible scrollbar. It was
              a bare `overflow-x-auto` strip here, so the desktop had a
              scrollbar under the photograph and no way to advance it without
              dragging one.

              `full` sends the wide encoding — on a card the thumbnail is the
              right economy, on the page the photograph IS the argument. No
              `href`: a tap here is already on the page it would navigate to.
            */}
            <CardGallery photos={photos} alt={title.text} listingId={l.id} full />
            <div className="absolute bottom-3 start-3 flex gap-2">
              {l.verified ? <VerifiedBadge verifiedAt={l.verifiedAt} /> : null}
            </div>
            <div className="absolute bottom-3 end-3">
              <Heart
                listingId={l.id}
                size={40}
                meta={{ vertical: l.type, city: l.city, area: l.area, priceNightly: l.baseNightly }}
              />
            </div>
            {/*
              The count was a label; it is the way into the full-screen viewer
              now. Same chip, same corner — the only difference is that it does
              something, which is what the frames have it doing.
            */}
            {photos.length > 0 ? (
              <div className="absolute top-3 end-3">
                <PhotoLightbox photos={photos} title={title.text} />
              </div>
            ) : null}
          </div>
        );
      })()}

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2 space-y-6">
          <div>
            <h1 className="font-bold text-2xl text-sea" {...textProps(title)}>
              {title.text}
            </h1>
            <div className="mt-1">
              <TrustStars
                listingId={l.id}
                listingTitle={title.text}
                rating={l.rating}
                source={l.ratingSource}
                count={l.reviewCount}
                size="text-base"
              />
            </div>
            {description ? (
              <p className="text-muted mt-1" {...textProps(description)}>
                {description.text}
              </p>
            ) : null}
          </div>

          {/* Verification block (§8.5) — personal vetting, not spec-boasting */}
          {l.verified ? (
            <div className="card p-4 border-2 border-sea/15">
              <h2 className="font-bold text-sea mb-2">{c.verifiedHeading}</h2>
              <p className="text-sm text-sea/80">
                {l.type === "service" ? c.verifiedService : c.verifiedStay}
              </p>
            </div>
          ) : null}

          {/* Amenity truth-table (§8.5): present/absent/condition — not free text */}
          {l.amenities.length > 0 || l.privacy ? (
          <div className="card p-4">
            <h2 className="font-bold text-sea mb-3">
              {l.type === "service" ? c.serviceIncludes : c.factsTable}
            </h2>
            <ul className="divide-y divide-sand">
              {[...l.amenities]
                .sort((a, b) => Number(b.present) - Number(a.present))
                .map((a) => {
                  const detail = a.detail
                    ? listingDescription(locale, { descriptionAr: a.detail })
                    : null;
                  return (
                    <li key={a.key} className="py-2 flex items-start justify-between gap-3">
                      <span
                        className={
                          a.present ? "font-bold" : "font-bold text-faint line-through"
                        }
                      >
                        {a.present ? "✅" : "🚫"} {term(AMENITIES, locale, a.key)}
                      </span>
                      <span className="text-sm text-muted text-start">
                        {a.present && detail ? <span {...textProps(detail)}>{detail.text}</span> : null}
                        {a.present && a.verifiedAt
                          ? c.checked(fmtDate(locale, a.verifiedAt, { month: "long", year: "numeric" }))
                          : ""}
                      </span>
                    </li>
                  );
                })}
              {l.privacy ? (
                <li className="py-2 flex justify-between">
                  <span className="font-bold">{c.privacyScore}</span>
                  <span className="text-sm text-muted">
                    {l.privacy.score}/100
                    {l.privacy.walledPool ? c.walledPool : ""}
                    {!l.privacy.overlooked ? c.notOverlooked : ""}
                  </span>
                </li>
              ) : null}
            </ul>
          </div>
          ) : null}

          {/* Hall packages — standardised comparable rows (§6.2) */}
          {l.type === "hall" && l.packages?.length ? (
            <div className="card p-4">
              <h2 className="font-bold text-sea mb-3">{c.packages}</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {l.packages.map((p) => {
                  // Package and line-item text is written by the host in Arabic
                  // and has no English column yet — so it is shown as Arabic,
                  // marked as Arabic, rather than machine-turned into English.
                  const name = listingTitle(locale, { titleAr: p.nameAr });
                  return (
                    <div key={p.id} className="border border-sea/15 rounded-xl p-3">
                      <h3 className="font-bold" {...textProps(name)}>{name.text}</h3>
                      <p className="text-link font-bold text-lg">{fmtLyd(p.totalPrice, locale)}</p>
                      <ul className="mt-2 space-y-1 text-sm">
                        {p.lineItems.map((li) => {
                          const label = listingTitle(locale, { titleAr: li.labelAr });
                          const detail = li.detailAr
                            ? listingTitle(locale, { titleAr: li.detailAr })
                            : null;
                          return (
                            <li key={li.key}>
                              {li.included ? "✅" : "➕"}{" "}
                              <span {...textProps(label)}>{label.text}</span>
                              {detail ? <span {...textProps(detail)}> — {detail.text}</span> : null}
                              {!li.included && li.extraPrice
                                ? ` (+${fmtLyd(li.extraPrice, locale)})`
                                : ""}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
              <p className="text-sm text-faint mt-3">{c.packagesNote}</p>
            </div>
          ) : null}

          {/* What our agent found around the place. Renders nothing at all
              until someone has actually stood there and written it down. */}
          <Nearby listingId={l.id} neighbours={l.neighbours} verifiedAt={l.verifiedAt} />

          {/* أشياء تعرفها — Airbnb "Things to know" (3 columns) */}
          <div className="card p-4">
            <h2 className="font-bold text-sea mb-3">{c.thingsToKnow}</h2>
            <div className="grid sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="font-bold mb-1">{c.cancellation}</p>
                <p className="text-sea/80">
                  {l.type === "service" ? c.cancellationService : tier}
                </p>
              </div>
              <div>
                <p className="font-bold mb-1">
                  {l.type === "service" ? c.howService : c.houseRules}
                </p>
                {l.type === "service" ? (
                  <p className="text-sea/80">{c.howServiceBody}</p>
                ) : houseRules ? (
                  <p className="text-sea/80" {...textProps(houseRules)}>{houseRules.text}</p>
                ) : (
                  <p className="text-sea/80">{c.houseRulesDefault}</p>
                )}
              </div>
              <div>
                <p className="font-bold mb-1">{c.locationPrivacy}</p>
                <p className="text-sea/80">
                  {l.type === "service" ? c.locationService(place) : c.locationStay(place)}
                </p>
              </div>
            </div>
          </div>

          {/* Ratings breakdown — only when the guest aggregate is real (≥3) */}
          {l.dimensionAverages && l.ratingHistogram ? (
            <div className="card p-4">
              <h2 className="font-bold text-sea mb-3">
                {c.guestRatings} {l.aggregateScore ? `— ${l.aggregateScore} ★` : ""}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-xs text-faint mb-1">{c.distribution}</p>
                  {[5, 4, 3, 2, 1].map((n) => {
                    const counts = l.ratingHistogram!;
                    const max = Math.max(1, ...Object.values(counts));
                    return (
                      <div key={n} className="flex items-center gap-1.5 text-xs">
                        <span className="w-3 text-faint">{n}</span>
                        <div className="flex-1 h-1.5 bg-sand rounded-sm overflow-hidden">
                          <div
                            className="h-full bg-sea"
                            style={{ width: `${((counts[String(n)] ?? 0) / max) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {Object.entries(l.dimensionAverages).map(([k, v]) => (
                  <div key={k}>
                    <p className="text-xs text-faint">{term(REVIEW_DIMENSIONS, locale, k)}</p>
                    <p className="font-extrabold text-sea text-lg" dir="ltr">{v.toFixed(1)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Reviews (§8.8) */}
          {l.reviews?.length ? (
            <div className="card p-4">
              <h2 className="font-bold text-sea mb-2">
                {c.realStays}
                {l.aggregateScore ? ` — ${l.aggregateScore}/5` : ""}
              </h2>
              <ul className="space-y-3">
                {l.reviews.slice(0, 5).map((r, i) => {
                  // Guests write in Arabic; we publish what they wrote.
                  const text = r.text ? listingTitle(locale, { titleAr: r.text }) : null;
                  const reply = r.hostReply
                    ? listingTitle(locale, { titleAr: r.hostReply })
                    : null;
                  return (
                    <li key={i} className="border-b border-sand pb-2 text-sm">
                      {text ? <p {...textProps(text)}>{text.text}</p> : null}
                      {reply ? (
                        <p className="mt-1 text-faint" {...textProps(reply)}>
                          {c.hostReply} {reply.text}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-faint">{c.noReviews}</p>
          )}

          <TrustButton
            listingId={l.id}
            listingTitle={title.text}
            rating={l.rating}
            className="btn-primary w-full sm:w-auto !py-2.5 text-sm"
          >
            {c.allReviews}
          </TrustButton>

          {/* أماكن مشابهة قريبة — Airbnb "More nearby" */}
          {l.similar?.length ? (
            <div>
              <h2 className="font-bold text-sea text-lg mb-3">
                {l.type === "service" ? c.similarServices : c.similarPlaces}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {l.similar.map((sim) => {
                  const cover = sim.media.find((m) => m.kind === "photo");
                  const simTitle = listingTitle(locale, sim);
                  return (
                    <Link key={sim.id} href={`/l/${sim.slug}`} className="card block hover:shadow-md">
                      <div className="relative aspect-[4/3] photo-placeholder">
                        {cover ? (
                          <img
                            src={thumb(cover)}
                            alt={simTitle.text}
                            loading="lazy"
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="p-2">
                        <p className="font-bold text-xs leading-snug" {...textProps(simTitle)}>
                          {simTitle.text}
                        </p>
                        <p className="text-[11px] text-faint mt-0.5">
                          {sim.verified ? c.verifiedShort : ""}
                          {sim.baseNightly > 0 ? c.perNight(fmtLyd(sim.baseNightly, locale)) : ""}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {/* Booking widget */}
        {/*
          The booking panel follows the reader down the page.

          The frames give listing detail a sticky Book Now, and on this page in
          particular it is not decoration: the specs, the amenities, the
          neighbours and the house rules run for several screens, and the
          decision the whole page exists to support was scrolling off the top of
          it. Desktop only — on a phone the panel IS the page at that point, and
          a sticky element on a 390px screen is a lid.
        */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-4">
            <BookingWidget listing={l} catalogue={l.catalogue ?? null} />
          </div>
        </div>
      </div>
    </main>
  );
}
