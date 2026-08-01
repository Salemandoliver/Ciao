"use client";
/** Personalized "for you" strip — transparent: each card says WHY (because). */
import { useEffect, useState } from "react";
import { Link, useLocale } from "@/lib/locale";
import { api, hasSession, fmtLyd } from "@/lib/api";
import { listingTitle, textProps } from "@/lib/content";
import type { Locale } from "@/lib/i18n";

/**
 * The recommendation reason is written server-side in Arabic and there is no
 * English column for it — it is generated prose («لأنك تبحث كثيرًا في جنزور»),
 * not a fixed phrase we could keep in vocab. So an English reader gets the
 * Arabic, marked as Arabic, exactly as they do for a listing title that has
 * not been written in English yet.
 */
const copy = {
  ar: {
    heading: "مقترحة لك ✨",
    perNight: (price: string) => `${price} / ليلة`,
  },
  en: {
    heading: "Picked for you ✨",
    perNight: (price: string) => `${price} / night`,
  },
} satisfies Record<Locale, unknown>;

interface Rec {
  id: string;
  slug: string;
  titleAr: string;
  titleEn?: string;
  area?: string;
  baseNightly: number;
  media: { url: string; kind: string }[];
  because: string;
}

export function RecsStrip() {
  const locale = useLocale();
  const c = copy[locale];
  const [items, setItems] = useState<Rec[]>([]);
  const [personalized, setPersonalized] = useState(false);

  useEffect(() => {
    if (!hasSession()) return; // cold visitors see the curated sections instead
    api<{ personalized: boolean; items: Rec[] }>("/v1/recs/home")
      .then((r) => {
        if (r.personalized) {
          setItems(r.items.slice(0, 3));
          setPersonalized(true);
        }
      })
      .catch(() => {});
  }, []);

  if (!personalized || items.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="font-bold text-xl text-sea mb-3">{c.heading}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {items.map((r) => {
          const cover = r.media.find((m) => m.kind === "photo");
          const title = listingTitle(locale, r);
          const because = listingTitle(locale, { titleAr: r.because });
          return (
            <Link key={r.id} href={`/l/${r.slug}`} className="card block hover:shadow-md">
              <div className="relative aspect-[4/3] bg-sea/10">
                {cover ? (
                  <img src={cover.url} alt={title.text} loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="p-3">
                <h3 className="font-bold text-sm" {...textProps(title)}>{title.text}</h3>
                <p className="text-xs text-link font-bold mt-0.5" {...textProps(because)}>
                  {because.text}
                </p>
                {r.baseNightly > 0 ? (
                  <p className="text-sm text-sea font-bold mt-1">
                    {c.perNight(fmtLyd(r.baseNightly, locale))}
                  </p>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
