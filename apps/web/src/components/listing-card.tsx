import Link from "next/link";
import type { PublicListing } from "@/lib/types";
import { fmtLyd } from "@/lib/api";

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
      <div className="relative aspect-[4/3] bg-sea/10">
        {cover ? (
          // Real deployment serves CDN WebP; placeholder gradient keeps dev honest.
          <div
            className="absolute inset-0 bg-gradient-to-b from-sea-light/30 to-sea/60 flex items-end justify-start p-2"
            aria-label={l.titleAr}
          />
        ) : null}
        <div className="absolute top-2 start-2 flex flex-col gap-1 items-start">
          {l.verified ? <VerifiedBadge /> : null}
          {l.familyOnly ? <span className="chip bg-white/90">عائلات فقط</span> : null}
        </div>
      </div>
      <div className="p-3 space-y-1.5">
        <h3 className="font-bold text-base leading-snug">{l.titleAr}</h3>
        <p className="text-sm text-sea/70">
          {AREA_AR[l.area ?? ""] ?? l.area} · {CITY_AR[l.city] ?? l.city}
        </p>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {l.privacy && l.privacy.score >= 80 ? <span className="chip">🔒 ستر عالي</span> : null}
          {generator ? <span className="chip">⚡ {generator.detail ?? "مولّد"}</span> : null}
          {l.bedrooms ? <span className="chip">🛏 {l.bedrooms} غرف</span> : null}
          {l.capacityWomens ? <span className="chip">👥 {l.capacityWomens} ضيفة</span> : null}
        </div>
        <p className="pt-1 font-bold text-sea text-lg">
          {l.type === "hall" && l.packages?.length
            ? `باقات من ${fmtLyd(Math.min(...l.packages.map((p) => p.totalPrice)))}`
            : l.baseNightly > 0
              ? `${fmtLyd(l.baseNightly)} / ليلة`
              : "حسب الباقة"}
          {l.dayUsePrice ? (
            <span className="text-sm font-normal text-sea/60"> · يومي {fmtLyd(l.dayUsePrice)}</span>
          ) : null}
        </p>
      </div>
    </Link>
  );
}
