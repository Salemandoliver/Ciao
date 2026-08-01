"use client";
/** المفضلة — saved places. Server list when signed in; local hearts otherwise. */
import { useEffect, useState } from "react";
import { Link, useLocale } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { api, ensureSession, fmtLyd, hasSession } from "@/lib/api";
import { Heart } from "@/components/heart";
import { localWishlistIds, onWishlistChange } from "@/lib/wishlist";
import { listingTitle, textProps } from "@/lib/content";
import { placeLabel } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

interface Saved {
  id: string;
  slug: string;
  titleAr: string;
  titleEn?: string | null;
  area?: string;
  city: string;
  baseNightly: number;
  media: { url: string; kind: string }[];
  verified?: boolean;
}

const copy = {
  ar: {
    title: "المفضلة 🤍",
    loading: "جارٍ التحميل…",
    emptyBody: "اضغط القلب على أي مكان يعجبك — يُحفظ هنا لتقارن وتقرر لاحقًا.",
    emptyCta: "ابدأ التصفح",
    localOnly: "قائمتك محفوظة على هذا الجهاز — سجّل دخولك لتبقى معك على كل أجهزتك.",
    perNight: (price: string) => `${price} / ليلة`,
  },
  en: {
    title: "Saved 🤍",
    loading: "Loading…",
    emptyBody: "Tap the heart on any place you like — it is kept here so you can compare and decide later.",
    emptyCta: "Start browsing",
    localOnly: "Your list is saved on this device — sign in to keep it with you on every device.",
    perNight: (price: string) => `${price} / night`,
  },
} satisfies Record<Locale, unknown>;

export default function WishlistPage() {
  const locale = useLocale();
  const c = copy[locale];
  const [items, setItems] = useState<Saved[] | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  async function load() {
    if (await ensureSession()) {
      setSignedIn(true);
      const r = await api<{ items: Saved[] }>("/v1/wishlist");
      setItems(r.items);
    } else {
      // Anonymous: hydrate cards for locally-hearted ids from the public list.
      const ids = new Set(localWishlistIds());
      if (ids.size === 0) return setItems([]);
      const all: Saved[] = [];
      for (const type of ["coast", "hall"]) {
        try {
          const r = await api<{ items: Saved[] }>(`/v1/listings?type=${type}&limit=50`);
          all.push(...r.items);
        } catch {
          /* offline */
        }
      }
      setItems(all.filter((l) => ids.has(l.id)));
    }
  }

  useEffect(() => {
    void load();
    return onWishlistChange(() => void load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/"><Logo /></Link>
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-sea">{c.title}</h1>
          <LanguageToggle />
        </div>
      </header>

      {items === null ? (
        <p className="text-faint">{c.loading}</p>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center space-y-3">
          <p className="text-3xl">🤍</p>
          <p className="text-muted">{c.emptyBody}</p>
          <Link href="/search" className="btn-primary inline-block">{c.emptyCta}</Link>
        </div>
      ) : (
        <>
          {!signedIn && !hasSession() ? (
            <p className="text-xs text-faint mb-3">{c.localOnly}</p>
          ) : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {items.map((l) => {
              const cover = l.media.find((m) => m.kind === "photo");
              const title = listingTitle(locale, l);
              return (
                <Link key={l.id} href={`/l/${l.slug}`} className="card block hover:shadow-md">
                  <div className="relative aspect-[4/3] bg-sea/10">
                    {cover ? (
                      <img
                        src={cover.url}
                        alt={title.text}
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : null}
                    <div className="absolute top-2 end-2">
                      <Heart listingId={l.id} />
                    </div>
                  </div>
                  <div className="p-3">
                    <h3 className="font-bold text-sm" {...textProps(title)}>
                      {title.text}
                    </h3>
                    <p className="text-xs text-faint">{placeLabel(locale, l.city, l.area)}</p>
                    {l.baseNightly > 0 ? (
                      <p className="text-sm font-bold text-sea mt-1">
                        {c.perNight(fmtLyd(l.baseNightly, locale))}
                      </p>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
