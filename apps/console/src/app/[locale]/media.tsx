"use client";
/**
 * Image manager — add, remove, reorder, and choose the cover.
 *
 * The first image in the list IS the cover. One ordering concept means the
 * console never has to reconcile a separate "is cover" flag with an order
 * field, and an operator can see the answer without reading a legend.
 *
 * Saving replaces the whole array, so delete and reorder are the same
 * operation and there is no partial state to recover from.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";

interface MediaItem {
  url: string;
  kind?: "photo" | "video";
  alt?: string;
}

/**
 * Reorder buttons are labelled by position, not by arrow direction: in Arabic
 * "earlier" is towards the right and in English towards the left, and the same
 * glyph means opposite things in the two directions. The chevrons themselves
 * are decorative and swap with the copy.
 */
const copy = {
  ar: {
    title: (name: string) => `صور: ${name}`,
    save: "حفظ",
    close: "إغلاق",
    loadFailed: "تعذر تحميل الصور",
    duplicate: "هذه الصورة مضافة بالفعل",
    saved: "✅ حُفظت الصور",
    liveNeedsMedia: "الإعلان منشور — لا يمكن ترك بلا صور. أوقفه مؤقتًا أولًا.",
    saveFailed: "تعذر الحفظ",
    guidance:
      "الصورة الأولى هي صورة الغلاف. رتّبها بالأسهم، واحذف ما لا يمثّل المكان فعلًا — ما يظهر في التطبيق يجب أن يكون هو الموجود على الأرض.",
    empty: "لا توجد صور — لا يمكن نشر الإعلان",
    cover: "الغلاف",
    earlier: "تقديم",
    later: "تأخير",
    earlierGlyph: "›",
    laterGlyph: "‹",
    remove: "حذف",
    addByPath: "إضافة صورة بالمسار",
    add: "إضافة",
    library: (n: number) => `اختر من مكتبة الصور (${n})`,
    footer:
      "الرفع المباشر من الجهاز يصل مع شبكة توصيل الصور (CDN). حتى ذلك الحين تُضاف الصور بمسارها بعد رفعها مع الإصدار، أو تُختار من المكتبة أعلاه.",
  },
  en: {
    title: (name: string) => `Photos: ${name}`,
    save: "Save",
    close: "Close",
    loadFailed: "Could not load the photos",
    duplicate: "That photo is already on the listing",
    saved: "✅ Photos saved",
    liveNeedsMedia: "This listing is live and cannot be left without photos. Pause it first.",
    saveFailed: "Could not save",
    guidance:
      "The first photo is the cover. Reorder with the arrows and remove anything that is not the actual place — what shows in the app has to be what is there on the ground.",
    empty: "No photos — this listing cannot be published",
    cover: "Cover",
    earlier: "Move earlier",
    later: "Move later",
    earlierGlyph: "‹",
    laterGlyph: "›",
    remove: "Remove",
    addByPath: "Add a photo by path",
    add: "Add",
    library: (n: number) => `Pick from the photo library (${n})`,
    footer:
      "Direct upload from the device lands with the image CDN. Until then, add photos by the path they were deployed under, or pick from the library above.",
  },
} satisfies Record<Locale, unknown>;

export function MediaManager({
  listingId,
  title,
  onClose,
  onSaved,
}: {
  listingId: string;
  title: string;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [library, setLibrary] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, lib] = await Promise.all([
        api<{ media: MediaItem[] }>(`/v1/biz/listings/${listingId}/media`),
        api<{ listings: { slug: string; urls: string[] }[] }>("/v1/biz/media/library"),
      ]);
      setMedia(m.media ?? []);
      setLibrary([...new Set(lib.listings.flatMap((l) => l.urls))].sort());
      setDirty(false);
    } catch {
      setMsg(copy[locale].loadFailed);
    }
  }, [listingId, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  function mutate(next: MediaItem[]) {
    setMedia(next);
    setDirty(true);
    setMsg("");
  }

  function add(u: string) {
    const clean = u.trim();
    if (!clean) return;
    if (media.some((m) => m.url === clean)) {
      setMsg(c.duplicate);
      return;
    }
    mutate([...media, { url: clean, kind: "photo" }]);
    setUrl("");
  }

  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= media.length) return;
    const next = [...media];
    [next[i], next[j]] = [next[j]!, next[i]!];
    mutate(next);
  }

  async function save() {
    setBusy(true);
    try {
      await api(`/v1/biz/listings/${listingId}/media`, {
        method: "PUT",
        body: JSON.stringify({ media }),
      });
      setMsg(c.saved);
      setDirty(false);
      await onSaved?.();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : "";
      setMsg(m.includes("live_listing_needs_media") ? c.liveNeedsMedia : c.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-sea-dark/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface w-full sm:max-w-3xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-bubble shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface/95 backdrop-blur border-b border-sand px-4 py-3 flex items-center justify-between gap-2">
          <h2 className="font-bold text-sea truncate text-sm">{c.title(title)}</h2>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="btn-primary !py-1.5 !px-4 !text-sm disabled:opacity-40"
              disabled={!dirty || busy}
              onClick={save}
            >
              {busy ? "…" : c.save}
            </button>
            <button
              onClick={onClose}
              aria-label={c.close}
              className="w-8 h-8 rounded-full bg-sand text-sea font-bold"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-4">
          {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}

          <p className="text-xs text-faint mb-3">{c.guidance}</p>

          {media.length === 0 ? (
            <p className="text-sm text-danger font-bold mb-3">{c.empty}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {media.map((m, i) => (
                <div key={m.url} className="relative rounded-xl overflow-hidden bg-sand group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt="" className="w-full h-24 object-cover" />
                  {i === 0 ? (
                    <span className="absolute top-1 start-1 rounded-full bg-amber px-2 py-0.5 text-[10px] font-bold text-sea-dark">
                      {c.cover}
                    </span>
                  ) : null}
                  <div className="absolute bottom-1 inset-x-1 flex items-center justify-between">
                    <div className="flex gap-1">
                      <button
                        className="w-6 h-6 rounded-full btn-on-photo text-xs font-bold"
                        onClick={() => move(i, -1)}
                        aria-label={c.earlier}
                      >
                        {c.earlierGlyph}
                      </button>
                      <button
                        className="w-6 h-6 rounded-full btn-on-photo text-xs font-bold"
                        onClick={() => move(i, 1)}
                        aria-label={c.later}
                      >
                        {c.laterGlyph}
                      </button>
                    </div>
                    <button
                      className="w-6 h-6 rounded-full bg-red-600/90 text-white text-xs font-bold"
                      onClick={() => mutate(media.filter((_, j) => j !== i))}
                      aria-label={c.remove}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <label className="block text-xs font-bold text-muted">
            {c.addByPath}
            <div className="flex gap-2 mt-1">
              <input
                className="input !py-2 !text-sm"
                dir="ltr"
                placeholder="/media/slug/1.webp"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add(url)}
              />
              <button className="chip shrink-0" onClick={() => add(url)}>
                {c.add}
              </button>
            </div>
          </label>

          {library.length ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-bold text-muted">
                {c.library(library.length)}
              </summary>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-2">
                {library.map((u) => (
                  <button
                    key={u}
                    onClick={() => add(u)}
                    className="rounded-lg overflow-hidden bg-sand ring-1 ring-transparent hover:ring-sea"
                    title={u}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="w-full h-16 object-cover" />
                  </button>
                ))}
              </div>
            </details>
          ) : null}

          <p className="text-[11px] text-faint mt-4 leading-relaxed">{c.footer}</p>
        </div>
      </div>
    </div>
  );
}
