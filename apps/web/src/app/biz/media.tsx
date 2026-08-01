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

interface MediaItem {
  url: string;
  kind?: "photo" | "video";
  alt?: string;
}

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
      setMsg("تعذر تحميل الصور");
    }
  }, [listingId]);

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
      setMsg("هذه الصورة مضافة بالفعل");
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
      setMsg("✅ حُفظت الصور");
      setDirty(false);
      await onSaved?.();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : "";
      setMsg(
        m.includes("live_listing_needs_media")
          ? "الإعلان منشور — لا يمكن ترك بلا صور. أوقفه مؤقتًا أولًا."
          : "تعذر الحفظ",
      );
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
        className="bg-white w-full sm:max-w-3xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-bubble shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-sand px-4 py-3 flex items-center justify-between gap-2">
          <h2 className="font-bold text-sea truncate text-sm">صور: {title}</h2>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="btn-primary !py-1.5 !px-4 !text-sm disabled:opacity-40"
              disabled={!dirty || busy}
              onClick={save}
            >
              {busy ? "…" : "حفظ"}
            </button>
            <button
              onClick={onClose}
              aria-label="إغلاق"
              className="w-8 h-8 rounded-full bg-sand text-sea font-bold"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-4">
          {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}

          <p className="text-xs text-sea/60 mb-3">
            الصورة الأولى هي صورة الغلاف. رتّبها بالأسهم، واحذف ما لا يمثّل المكان فعلًا — ما
            يظهر في التطبيق يجب أن يكون هو الموجود على الأرض.
          </p>

          {media.length === 0 ? (
            <p className="text-sm text-red-700 font-bold mb-3">لا توجد صور — لا يمكن نشر الإعلان</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {media.map((m, i) => (
                <div key={m.url} className="relative rounded-xl overflow-hidden bg-sand group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt="" className="w-full h-24 object-cover" />
                  {i === 0 ? (
                    <span className="absolute top-1 start-1 rounded-full bg-amber px-2 py-0.5 text-[10px] font-bold text-sea-dark">
                      الغلاف
                    </span>
                  ) : null}
                  <div className="absolute bottom-1 inset-x-1 flex items-center justify-between">
                    <div className="flex gap-1">
                      <button
                        className="w-6 h-6 rounded-full bg-white/90 text-sea text-xs font-bold"
                        onClick={() => move(i, -1)}
                        aria-label="نقل لليمين"
                      >
                        ›
                      </button>
                      <button
                        className="w-6 h-6 rounded-full bg-white/90 text-sea text-xs font-bold"
                        onClick={() => move(i, 1)}
                        aria-label="نقل لليسار"
                      >
                        ‹
                      </button>
                    </div>
                    <button
                      className="w-6 h-6 rounded-full bg-red-600/90 text-white text-xs font-bold"
                      onClick={() => mutate(media.filter((_, j) => j !== i))}
                      aria-label="حذف"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <label className="block text-xs font-bold text-sea/70">
            إضافة صورة بالمسار
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
                إضافة
              </button>
            </div>
          </label>

          {library.length ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-bold text-sea/70">
                اختر من مكتبة الصور ({library.length})
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

          <p className="text-[11px] text-sea/45 mt-4 leading-relaxed">
            الرفع المباشر من الجهاز يصل مع شبكة توصيل الصور (CDN). حتى ذلك الحين تُضاف الصور
            بمسارها بعد رفعها مع الإصدار، أو تُختار من المكتبة أعلاه.
          </p>
        </div>
      </div>
    </div>
  );
}
