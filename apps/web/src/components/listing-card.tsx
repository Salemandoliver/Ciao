import Link from "next/link";
import type { PublicListing } from "@/lib/types";
import { fmtLyd } from "@/lib/api";
import { Heart } from "./heart";
import { SERVICE_AR } from "@/lib/services";

const AREA_AR: Record<string, string> = {
  janzour: "جنزور",
  tajoura: "تاجوراء",
  ain_zara: "عين زارة",
  airport_road: "طريق المطار",
};
const CITY_AR: Record<string, string> = {
  tripoli: "طرابلس",
  misrata: "مصراتة",
  benghazi: "بنغازي",
};

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
          ? `· ${count} ${source === "guests" ? "تقييم" : "تقييم تشاو"}`
          : "· تقييم تشاو"}
      </span>
    </span>
  );
}

export function VerifiedBadge({ verifiedAt }: { verifiedAt?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sea text-white px-2.5 py-0.5 text-xs font-bold">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      موثّق من تشاو
      {verifiedAt ? (
        <span className="font-normal opacity-80">
          · فُحص {new Date(verifiedAt).toLocaleDateString("ar-LY", { month: "long", year: "numeric" })}
        </span>
      ) : null}
    </span>
  );
}

export function ListingCard({ l }: { l: PublicListing }) {
  const generator = l.amenities.find((a) => a.key === "generator" && a.present);
  const cover = l.media.find((m) => m.kind === "photo");
  return (
    <Link href={`/l/${l.slug}`} className="card block hover:shadow-md transition-shadow">
      <div className="relative aspect-[4/3] photo-placeholder">
        {cover ? (
          <img
            src={cover.url}
            alt={l.titleAr}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
        <div className="absolute top-2 start-2 flex flex-col gap-1 items-start">
          {l.verified ? <VerifiedBadge /> : null}
          {l.familyOnly ? <span className="chip-on-photo">عائلات فقط</span> : null}
        </div>
        <div className="absolute top-2 end-2">
          <Heart
            listingId={l.id}
            meta={{ vertical: l.type, city: l.city, area: l.area, priceNightly: l.baseNightly }}
          />
        </div>
      </div>
      <div className="p-3 space-y-1.5">
        <h3 className="font-bold text-base leading-snug">{l.titleAr}</h3>
        <Stars rating={l.rating} source={l.ratingSource} count={l.reviewCount} />
        <p className="text-sm text-muted">
          {AREA_AR[l.area ?? ""] ?? l.area} · {CITY_AR[l.city] ?? l.city}
        </p>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {l.privacy && l.privacy.score >= 80 ? <span className="chip">🔒 ستر عالي</span> : null}
          {generator ? <span className="chip">⚡ مولّد</span> : null}
          {l.bedrooms ? <span className="chip">🛏 {l.bedrooms} غرف</span> : null}
          {l.capacityWomens ? <span className="chip">👥 {l.capacityWomens} ضيفة</span> : null}
          {l.serviceCategory ? (
            <span className="chip">{SERVICE_AR[l.serviceCategory] ?? l.serviceCategory}</span>
          ) : null}
        </div>
        <p className="pt-1 font-bold text-sea text-lg">
          {l.type === "service"
            ? "الأسعار حسب الطلب — اطلب عرض سعر"
            : l.type === "hall" && l.packages?.length
            ? `باقات من ${fmtLyd(Math.min(...l.packages.map((p) => p.totalPrice)))}`
            : l.baseNightly > 0
              ? `${fmtLyd(l.baseNightly)} / ليلة`
              : "حسب الباقة"}
          {l.dayUsePrice ? (
            <span className="text-sm font-normal text-faint"> · يومي {fmtLyd(l.dayUsePrice)}</span>
          ) : null}
        </p>
      </div>
    </Link>
  );
}
