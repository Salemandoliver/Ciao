import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Stars, VerifiedBadge } from "@/components/listing-card";
import { API_URL, fmtLyd } from "@/lib/api";
import type { PublicListing } from "@/lib/types";
import { BookingWidget } from "./booking-widget";
import { TrackEvent } from "@/components/track";

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

const AMENITY_AR: Record<string, string> = {
  generator: "مولّد كهرباء",
  water_tank: "خزان مياه",
  pool: "مسبح",
  bride_suite: "جناح العروس",
  prayer_space: "مصلّى",
  parking: "موقف سيارات",
  kosha: "كوشة",
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
            <div className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth aspect-[16/9] bg-gradient-to-b from-sea-light/40 to-sea/70">
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
            {photos.length > 0 ? (
              <div className="absolute top-3 end-3 chip bg-white/90">
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
              <Stars rating={l.rating} source={l.ratingSource} size="text-base" />
            </div>
            <p className="text-sea/70 mt-1">{l.descriptionAr}</p>
          </div>

          {/* Verification block (§8.5) — personal vetting, not spec-boasting */}
          {l.verified ? (
            <div className="card p-4 border-2 border-sea/15">
              <h2 className="font-bold text-sea mb-2">✓ ماذا يعني «موثّق من تشاو»؟</h2>
              <p className="text-sm text-sea/80">
                فريق تشاو زار هذا المكان بنفسه، تحقق من المالك ومن كل المرافق،
                والتقط الصور بنفسه — لا يُنشر أي مكان قبل أن نعتمده شخصيًا.
                والتوثيق يُجدَّد سنويًا. تفاصيل الفحص كاملة في جدول الحقائق.
              </p>
            </div>
          ) : null}

          {/* Amenity truth-table (§8.5): present/absent/condition — not free text */}
          <div className="card p-4">
            <h2 className="font-bold text-sea mb-3">جدول الحقائق</h2>
            <ul className="divide-y divide-sand">
              {l.amenities.map((a) => (
                <li key={a.key} className="py-2 flex items-start justify-between gap-3">
                  <span className="font-bold">
                    {a.present ? "✅" : "❌"} {AMENITY_AR[a.key] ?? a.key}
                  </span>
                  <span className="text-sm text-sea/70 text-start">
                    {a.detail}
                    {a.verifiedAt ? ` · تحقق ${a.verifiedAt}` : ""}
                  </span>
                </li>
              ))}
              {l.privacy ? (
                <li className="py-2 flex justify-between">
                  <span className="font-bold">🔒 درجة الستر</span>
                  <span className="text-sm text-sea/70">
                    {l.privacy.score}/100
                    {l.privacy.walledPool ? " · مسبح مسوَّر" : ""}
                    {!l.privacy.overlooked ? " · غير مكشوف على الجيران" : ""}
                  </span>
                </li>
              ) : null}
            </ul>
          </div>

          {/* Hall packages — standardised comparable rows (§6.2) */}
          {l.type === "hall" && l.packages?.length ? (
            <div className="card p-4">
              <h2 className="font-bold text-sea mb-3">الباقات</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {l.packages.map((p) => (
                  <div key={p.id} className="border border-sea/15 rounded-xl p-3">
                    <h3 className="font-bold">{p.nameAr}</h3>
                    <p className="text-amber-dark font-bold text-lg">{fmtLyd(p.totalPrice)}</p>
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
              <p className="text-sm text-sea/60 mt-3">
                القاعات تُعاين قبل الحجز — اطلب موعد زيارة وسنرتب لك المعاينة.
              </p>
            </div>
          ) : null}

          {/* Policy in plain Arabic (§8.5) */}
          <div className="card p-4">
            <h2 className="font-bold text-sea mb-1">سياسة الإلغاء</h2>
            <p className="text-sm text-sea/80">{tierAr}</p>
          </div>

          {/* Approximate location (§7.1) */}
          <div className="card p-4">
            <h2 className="font-bold text-sea mb-1">الموقع</h2>
            <p className="text-sm text-sea/80">
              📍 المنطقة: {l.area ?? l.city} — الموقع الدقيق ورقم المضيف يظهران فور دفع
              العربون. هذا يحمي المضيف والضيف معًا.
            </p>
          </div>

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
                      <p className="mt-1 text-sea/60">↩ رد المضيف: {r.hostReply}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-sea/50">
              التقييمات تُقبل فقط من ضيوف أكملوا إقامة مدفوعة العربون — لا تقييمات مزيفة.
            </p>
          )}
        </div>

        {/* Booking widget */}
        <div className="lg:col-span-1">
          <BookingWidget listing={l} />
        </div>
      </div>
    </main>
  );
}
