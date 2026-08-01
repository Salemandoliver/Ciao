"use client";
/** Personalized "for you" strip — transparent: each card says WHY (because). */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, hasSession, fmtLyd } from "@/lib/api";

interface Rec {
  id: string;
  slug: string;
  titleAr: string;
  area?: string;
  baseNightly: number;
  media: { url: string; kind: string }[];
  because: string;
}

export function RecsStrip() {
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
      <h2 className="font-bold text-xl text-sea mb-3">مقترحة لك ✨</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {items.map((r) => {
          const cover = r.media.find((m) => m.kind === "photo");
          return (
            <Link key={r.id} href={`/l/${r.slug}`} className="card block hover:shadow-md">
              <div className="relative aspect-[4/3] bg-sea/10">
                {cover ? (
                  <img src={cover.url} alt={r.titleAr} loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="p-3">
                <h3 className="font-bold text-sm">{r.titleAr}</h3>
                <p className="text-xs text-link font-bold mt-0.5">{r.because}</p>
                {r.baseNightly > 0 ? (
                  <p className="text-sm text-sea font-bold mt-1">{fmtLyd(r.baseNightly)} / ليلة</p>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
