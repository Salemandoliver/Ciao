import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Stars, VerifiedBadge } from "@/components/listing-card";
import { API_URL, fmtLyd } from "@/lib/api";
import type { PublicListing } from "@/lib/types";
import { BookingWidget } from "./booking-widget";
import { TrackEvent } from "@/components/track";
import { Heart } from "@/components/heart";
import { TrustButton, TrustStars } from "@/components/trust-dialog";

export const dynamic = "force-dynamic";

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

/** WhatsApp/Instagram unfurl cards (§8.1(5)) — distribution IS social shares. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const l = await getListing(slug);
  if (!l) return { title: "تشاو" };
  const desc = `${l.verified ? "✓ موثّق من تشاو · " : ""}${
    l.baseNightly > 0 ? `${Math.round(l.baseNightly / 1000)} د.ل/ليلة · ` : ""
  }احجز بعربون بسيط والباقي عند الوصول`;
  return {
    title: `${l.titleAr} — تشاو`,
    description: desc,
    openGraph: {
      title: l.titleAr,
      description: desc,
      type: "website",
      locale: "ar_LY",
      siteName: "Ciao — تشاو",
    },
  };
}

const DIMENSION_AR: Record<string, string> = {
  cleanliness: "النظافة",
  accuracy: "المطابقة",
  privacy: "الخصوصية والستر",
  communication: "التواصل",
  value: "القيمة",
};

const AMENITY_AR: Record<string, string> = {
  // stays & halls
  generator: "مولّد كهرباء",
  water_tank: "خزان مياه",
  pool: "مسبح",
  bride_suite: "جناح العروس",
  prayer_space: "مصلّى",
  parking: "موقف سيارات",
  kosha: "كوشة",
  // services
  tasting: "تذوق قبل التعاقد",
  delivery_setup: "توصيل وتجهيز",
  service_staff: "طاقم خدمة",
  menu_fixed: "قائمة وأسعار مكتوبة",
  photo_video: "تصوير فوتو وفيديو",
  female_staff: "طاقم نسائي",
  printed_album: "ألبوم مطبوع",
  delivery_time: "مدة التسليم",
  trial: "تجربة قبل الموعد",
  home_visit: "خدمة في البيت",
  original_products: "منتجات أصلية",
  female_only: "نسائي بالكامل",
  bridal: "تسريحات عرايس",
  appointment: "بالموعد فقط",
  privacy: "خصوصية تامة",
  female_hours: "أوقات نسائية",
  female_trainer: "مدربة سيدة",
  equipment: "أجهزة حديثة",
  membership: "اشتراكات",
  tiered_cake: "كيك متعدد الطوابق",
  custom_design: "تصميم حسب الطلب",
};

export default async function ListingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const l = await getListing(slug);
  if (!l) {
    return (
      <main className="mx-auto max-w-3xl p-8 text-center">
        <p>هذا المكان غير متاح حاليًا.</p>
        <Link className="btn-primary inline-block mt-4" href="/search">
          تصفّح أماكن مشابهة
        </Link>
      </main>
    );
  }

  const tierAr = {
    flexible: "مرنة: استرجاع كامل للعربون حتى ٤٨ ساعة قبل الوصول",
    moderate: "متوسطة: استرجاع كامل قبل ٧ أيام، ونصفه بعد ذلك",
    strict: "صارمة: عربون قفل التاريخ غير مسترجَع — والتنازل ممكن عبر بورصة تشاو",
  }[l.cancellationTier];

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24">
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
      <header className="flex items-center justify-between py-4">
        <Link href="/">
          <Logo size={36} />
        </Link>
        <Link href="/search" className="text-sm font-bold text-sea">
          → رجوع للبحث
        </Link>
      </header>

      {/* Photo carousel — our shots (§8.5); horizontal snap-scroll, lazy after first */}
      {(() => {
        const photos = l.media
          .filter((m) => m.kind === "photo")
          .sort((a, b) => a.order - b.order);
        return (
          <div className="card relative">
            <div className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth aspect-[16/9] photo-placeholder">
              {photos.length > 0 ? (
                photos.map((m, i) => (
                  <img
                    key={m.url}
                    src={m.url}
                    alt={`${l.titleAr} — صورة ${i + 1}`}
                    loading={i === 0 ? "eager" : "lazy"}
                    fetchPriority={i === 0 ? "high" : undefined}
                    className="h-full w-full flex-shrink-0 snap-center object-cover"
                  />
                ))
              ) : (
                <div className="h-full w-full" />
              )}
            </div>
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
            {photos.length > 0 ? (
              <div className="absolute top-3 end-3 chip-on-photo">
                📷 {photos.length} صور · تصويرنا — اسحب للمزيد
              </div>
            ) : null}
          </div>
        );
      })()}

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2 space-y-6">
          <div>
            <h1 className="font-bold text-2xl text-sea">{l.titleAr}</h1>
            <div className="mt-1">
              <TrustStars
                listingId={l.id}
                listingTitle={l.titleAr}
                rating={l.rating}
                source={l.ratingSource}
                count={l.reviewCount}
                size="text-base"
              />
            </div>
            <p className="text-muted mt-1">{l.descriptionAr}</p>
          </div>

          {/* Verification block (§8.5) — personal vetting, not spec-boasting */}
          {l.verified ? (
            <div className="card p-4 border-2 border-sea/15">
              <h2 className="font-bold text-sea mb-2">✓ ماذا يعني «موثّق من تشاو»؟</h2>
              <p className="text-sm text-sea/80">
                {l.type === "service"
                  ? "فريق تشاو قابل هذا المزوّد شخصيًا، تحقق من نشاطه ومن أعماله السابقة، واعتمده — لا يُنشر أي مزوّد قبل أن نعتمده بأنفسنا. والتوثيق يُجدَّد سنويًا."
                  : "فريق تشاو زار هذا المكان بنفسه، تحقق من المالك ومن كل المرافق، والتقط الصور بنفسه — لا يُنشر أي مكان قبل أن نعتمده شخصيًا. والتوثيق يُجدَّد سنويًا. تفاصيل الفحص كاملة في جدول الحقائق."}
              </p>
            </div>
          ) : null}

          {/* Amenity truth-table (§8.5): present/absent/condition — not free text */}
          {l.amenities.length > 0 || l.privacy ? (
          <div className="card p-4">
            <h2 className="font-bold text-sea mb-3">
              {l.type === "service" ? "ماذا تشمل الخدمة" : "جدول الحقائق"}
            </h2>
            <ul className="divide-y divide-sand">
              {[...l.amenities]
                .sort((a, b) => Number(b.present) - Number(a.present))
                .map((a) => (
                  <li key={a.key} className="py-2 flex items-start justify-between gap-3">
                    <span
                      className={
                        a.present ? "font-bold" : "font-bold text-faint line-through"
                      }
                    >
                      {a.present ? "✅" : "🚫"} {AMENITY_AR[a.key] ?? a.key}
                    </span>
                    <span className="text-sm text-muted text-start">
                      {a.present ? a.detail : null}
                      {a.present && a.verifiedAt ? ` · تحقق ${a.verifiedAt}` : ""}
                    </span>
                  </li>
                ))}
              {l.privacy ? (
                <li className="py-2 flex justify-between">
                  <span className="font-bold">🔒 درجة الستر</span>
                  <span className="text-sm text-muted">
                    {l.privacy.score}/100
                    {l.privacy.walledPool ? " · مسبح مسوَّر" : ""}
                    {!l.privacy.overlooked ? " · غير مكشوف على الجيران" : ""}
                  </span>
                </li>
              ) : null}
            </ul>
          </div>
          ) : null}

          {/* Hall packages — standardised comparable rows (§6.2) */}
          {l.type === "hall" && l.packages?.length ? (
            <div className="card p-4">
              <h2 className="font-bold text-sea mb-3">الباقات</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {l.packages.map((p) => (
                  <div key={p.id} className="border border-sea/15 rounded-xl p-3">
                    <h3 className="font-bold">{p.nameAr}</h3>
                    <p className="text-link font-bold text-lg">{fmtLyd(p.totalPrice)}</p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {p.lineItems.map((li) => (
                        <li key={li.key}>
                          {li.included ? "✅" : "➕"} {li.labelAr}
                          {li.detailAr ? ` — ${li.detailAr}` : ""}
                          {!li.included && li.extraPrice ? ` (+${fmtLyd(li.extraPrice)})` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="text-sm text-faint mt-3">
                القاعات تُعاين قبل الحجز — اطلب موعد زيارة وسنرتب لك المعاينة.
              </p>
            </div>
          ) : null}

          {/* أشياء تعرفها — Airbnb "Things to know" (3 columns) */}
          <div className="card p-4">
            <h2 className="font-bold text-sea mb-3">أشياء تعرفها</h2>
            <div className="grid sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="font-bold mb-1">🗓 سياسة الإلغاء</p>
                <p className="text-sea/80">
                  {l.type === "service"
                    ? "تُحدَّد مع المزوّد في عرض السعر قبل الدفع — بلا شروط مخفية."
                    : tierAr}
                </p>
              </div>
              <div>
                <p className="font-bold mb-1">
                  {l.type === "service" ? "🔑 كيف تتم الخدمة" : "🔑 قواعد البيت"}
                </p>
                <p className="text-sea/80">
                  {l.type === "service"
                    ? "تتفق مع المزوّد على التفاصيل عبر فريق تشاو، ويُثبَّت السعر كتابيًا قبل أي دفع."
                    : (l.houseRulesAr ?? "يحددها المضيف عند التأكيد — اسأله في المحادثة.")}
                </p>
              </div>
              <div>
                <p className="font-bold mb-1">📍 الموقع والخصوصية</p>
                <p className="text-sea/80">
                  {l.type === "service"
                    ? `المنطقة: ${l.area ?? l.city} — بيانات التواصل مع المزوّد تصلك بعد تأكيد الطلب عبر فريق تشاو.`
                    : `المنطقة: ${l.area ?? l.city} — العنوان الدقيق ورقم المضيف يظهران فور دفع العربون. هذا يحمي الطرفين.`}
                </p>
              </div>
            </div>
          </div>

          {/* Ratings breakdown — only when the guest aggregate is real (≥3) */}
          {l.dimensionAverages && l.ratingHistogram ? (
            <div className="card p-4">
              <h2 className="font-bold text-sea mb-3">
                تقييم الضيوف {l.aggregateScore ? `— ${l.aggregateScore} ★` : ""}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-xs text-faint mb-1">التوزيع</p>
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
                    <p className="text-xs text-faint">{DIMENSION_AR[k] ?? k}</p>
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
                تقييمات من إقامات حقيقية
                {l.aggregateScore ? ` — ${l.aggregateScore}/5` : ""}
              </h2>
              <ul className="space-y-3">
                {l.reviews.slice(0, 5).map((r, i) => (
                  <li key={i} className="border-b border-sand pb-2 text-sm">
                    <p>{r.text}</p>
                    {r.hostReply ? (
                      <p className="mt-1 text-faint">↩ رد المضيف: {r.hostReply}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-faint">
              التقييمات تُقبل فقط من ضيوف أكملوا إقامة مدفوعة العربون — لا تقييمات مزيفة.
            </p>
          )}

          <TrustButton
            listingId={l.id}
            listingTitle={l.titleAr}
            rating={l.rating}
            className="btn-primary w-full sm:w-auto !py-2.5 text-sm"
          >
            ⭐ كل التقييمات وسجل الشكاوى
          </TrustButton>

          {/* أماكن مشابهة قريبة — Airbnb "More nearby" */}
          {l.similar?.length ? (
            <div>
              <h2 className="font-bold text-sea text-lg mb-3">{l.type === "service" ? "مزوّدون مشابهون" : "أماكن مشابهة قريبة"}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {l.similar.map((sim) => {
                  const cover = sim.media.find((m) => m.kind === "photo");
                  return (
                    <Link key={sim.id} href={`/l/${sim.slug}`} className="card block hover:shadow-md">
                      <div className="relative aspect-[4/3] photo-placeholder">
                        {cover ? (
                          <img
                            src={cover.url}
                            alt={sim.titleAr}
                            loading="lazy"
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="p-2">
                        <p className="font-bold text-xs leading-snug">{sim.titleAr}</p>
                        <p className="text-[11px] text-faint mt-0.5">
                          {sim.verified ? "✓ موثّق" : ""}
                          {sim.baseNightly > 0
                            ? ` · ${fmtLyd(sim.baseNightly)}/ليلة`
                            : ""}
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
        <div className="lg:col-span-1">
          <BookingWidget listing={l} />
        </div>
      </div>
    </main>
  );
}
