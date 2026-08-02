"use client";
import { Link, useLocale } from "@/lib/locale";
import type { PublicListing } from "@/lib/types";
import { fmtLyd } from "@/lib/api";
import { Heart } from "./heart";
import { CardGallery } from "./card-gallery";
import { listingTitle, textProps } from "@/lib/content";
import { AMENITIES, SERVICE_CATEGORY_LABELS, fmtDate, placeLabel, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: {
    familyOnly: "عائلات فقط",
    verified: "موثّق من تشاو",
    inspected: (when: string) => `· فُحص ${when}`,
    reviews: "تقييم",
    ciaoRating: "تقييم تشاو",
    highPrivacy: "🔒 ستر عالي",
    generator: "⚡ مولّد",
    bedrooms: (n: number) => `🛏 ${n} غرف`,
    womenGuests: (n: number) => `👥 ${n} ضيفة`,
    quoteOnRequest: "الأسعار حسب الطلب — اطلب عرض سعر",
    packagesFrom: (price: string) => `باقات من ${price}`,
    perNight: (price: string) => `${price} / ليلة`,
    byPackage: "حسب الباقة",
    dayUse: (price: string) => ` · يومي ${price}`,
  },
  en: {
    familyOnly: "Families only",
    verified: "Ciao verified",
    inspected: (when: string) => `· inspected ${when}`,
    reviews: "reviews",
    ciaoRating: "Ciao inspection",
    highPrivacy: "🔒 High privacy",
    generator: "⚡ Generator",
    bedrooms: (n: number) => `🛏 ${n} bedrooms`,
    womenGuests: (n: number) => `👥 ${n} women guests`,
    quoteOnRequest: "Priced on request — ask for a quote",
    packagesFrom: (price: string) => `Packages from ${price}`,
    perNight: (price: string) => `${price} / night`,
    byPackage: "By package",
    dayUse: (price: string) => ` · day use ${price}`,
  },
} satisfies Record<Locale, unknown>;

/** Star rating — guest aggregate when real, otherwise the Ciao inspection rating. */
export function Stars({
  rating,
  source,
  count,
  size = "text-sm",
}: {
  rating?: number;
  source?: "ciao" | "guests";
  count?: number;
  size?: string;
}) {
  const locale = useLocale();
  const c = copy[locale];
  if (!rating) return null;
  const full = Math.min(5, Math.floor(rating + 0.25)); // conservative fill
  return (
    <span className={`inline-flex items-center gap-1 ${size}`}>
      <span className="text-link tracking-tight" dir="ltr" aria-hidden>
        {"★".repeat(full)}
        <span className="opacity-25">{"★".repeat(5 - full)}</span>
      </span>
      <span className="font-bold text-sea">{rating.toFixed(1)}</span>
      <span className="text-faint text-xs">
        {count && count > 0
          ? `· ${count} ${source === "guests" ? c.reviews : c.ciaoRating}`
          : `· ${c.ciaoRating}`}
      </span>
    </span>
  );
}

export function VerifiedBadge({ verifiedAt }: { verifiedAt?: string }) {
  const locale = useLocale();
  const c = copy[locale];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sea text-white px-2.5 py-0.5 text-xs font-bold">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {c.verified}
      {verifiedAt ? (
        <span className="font-normal opacity-80">
          {c.inspected(fmtDate(locale, verifiedAt, { month: "long", year: "numeric" }))}
        </span>
      ) : null}
    </span>
  );
}

export function ListingCard({ l }: { l: PublicListing }) {
  const locale = useLocale();
  const c = copy[locale];
  const title = listingTitle(locale, l);
  const generator = l.amenities.find((a) => a.key === "generator" && a.present);
  const photos = l.media.filter((m) => m.kind === "photo");
  /*
   * The card used to be one big `<Link>` with a button inside it. That was
   * already invalid HTML and an unusable link for a screen reader; adding photo
   * arrows and dots would have made it three buttons inside an anchor. So the
   * card is now a plain container, the anchor wraps the title, and
   * `.card-link::after` stretches it across the whole card — the standard
   * pattern, and the one that lets a tap on "next photo" mean next photo while
   * a tap anywhere else still opens the property.
   */
  return (
    <div className="card group relative block hover:shadow-md transition-shadow">
      <div className="relative aspect-[4/3] photo-placeholder card-controls">
        <CardGallery photos={photos} alt={title.text} listingId={l.id} href={`/l/${l.slug}`} />
        <div className="absolute top-2 start-2 flex flex-col gap-1 items-start pointer-events-none">
          {l.verified ? <VerifiedBadge /> : null}
          {l.familyOnly ? <span className="chip-on-photo">{c.familyOnly}</span> : null}
        </div>
        <div className="absolute top-2 end-2">
          <Heart
            listingId={l.id}
            meta={{ vertical: l.type, city: l.city, area: l.area, priceNightly: l.baseNightly }}
          />
        </div>
      </div>
      <div className="p-3 space-y-1.5">
        {/* `lang`/`dir` so an untranslated Arabic title still reads correctly
            inside an English page — and is spoken, not spelled, by a reader. */}
        <h3 className="font-bold text-base leading-snug" {...textProps(title)}>
          <Link href={`/l/${l.slug}`} className="card-link">
            {title.text}
          </Link>
        </h3>
        <Stars rating={l.rating} source={l.ratingSource} count={l.reviewCount} />
        <p className="text-sm text-muted">{placeLabel(locale, l.city, l.area)}</p>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {l.privacy && l.privacy.score >= 80 ? <span className="chip">{c.highPrivacy}</span> : null}
          {generator ? <span className="chip">{c.generator}</span> : null}
          {l.bedrooms ? <span className="chip">{c.bedrooms(l.bedrooms)}</span> : null}
          {l.capacityWomens ? <span className="chip">{c.womenGuests(l.capacityWomens)}</span> : null}
          {l.serviceCategory ? (
            <span className="chip">{term(SERVICE_CATEGORY_LABELS, locale, l.serviceCategory)}</span>
          ) : null}
        </div>
        <p className="pt-1 font-bold text-sea text-lg">
          {l.type === "service"
            ? c.quoteOnRequest
            : l.type === "hall" && l.packages?.length
              ? c.packagesFrom(fmtLyd(Math.min(...l.packages.map((p) => p.totalPrice)), locale))
              : l.baseNightly > 0
                ? c.perNight(fmtLyd(l.baseNightly, locale))
                : c.byPackage}
          {l.dayUsePrice ? (
            <span className="text-sm font-normal text-faint">
              {c.dayUse(fmtLyd(l.dayUsePrice, locale))}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

/** Re-exported so pages can render an amenity name without importing vocab. */
export function amenityLabel(locale: Locale, key: string): string {
  return term(AMENITIES, locale, key);
}
