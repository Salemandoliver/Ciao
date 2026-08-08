"use client";
/**
 * Image manager — upload, add, remove, reorder, and choose the cover.
 *
 * The first image in the list IS the cover. One ordering concept means the
 * console never has to reconcile a separate "is cover" flag with an order
 * field, and an operator can see the answer without reading a legend.
 *
 * Saving replaces the whole array, so delete and reorder are the same
 * operation and there is no partial state to recover from.
 *
 * ## Uploading
 *
 * Photographs arrive on WhatsApp during a field visit and have to be on the
 * listing before the operator leaves. Previously the only way in was to commit
 * a file to the repository and ship a release, so this dialog offered a text
 * box for a path — which is a reasonable thing to hand an engineer and an
 * absurd thing to hand a supply team.
 *
 * Files are re-encoded in this browser before they are sent (see
 * `lib/encode-image.ts`): a twelve-megabyte phone photograph becomes about two
 * hundred kilobytes, which is the difference between a field visit that
 * finishes and one that stalls on a bar of signal. Each photograph uploads as
 * two independent requests — the full size and a thumbnail — so a dropped
 * connection costs one small retry rather than the whole batch.
 *
 * The path box stays. It is how the eight original demo listings were built,
 * it is the escape hatch when somebody has already deployed an asset, and
 * removing a working tool because a better one arrived is how you strand the
 * one person who needed it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, mediaSrc } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";
import { encodeImage, isSupportedImage, toBase64 } from "@/lib/encode-image";

interface MediaItem {
  url: string;
  thumbUrl?: string;
  kind?: "photo" | "video";
  alt?: string;
}

interface MediaConfig {
  uploads: boolean;
  missing: string[];
  maxBytes: number;
  base: string;
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
    addByPath: "أو أضف صورة بالمسار",
    add: "إضافة",
    library: (n: number) => `اختر من مكتبة الصور (${n})`,
    drop: "اسحب الصور هنا أو اختر من الجهاز",
    choose: "اختر صورًا من الجهاز",
    dropHint:
      "نصغّر الصور في المتصفح قبل رفعها، فالصورة من الهاتف تنزل من ١٢ ميغابايت إلى حوالي ٢٠٠ كيلوبايت — ترفع أسرع وتفتح أسرع عند الزبون.",
    uploading: (done: number, total: number) => `جاري الرفع… ${done} من ${total}`,
    uploadFailed: (name: string) => `تعذر رفع ${name}`,
    notImage: (name: string) => `${name} ليست صورة`,
    tooLarge: (name: string) => `${name} كبيرة جدًا حتى بعد التصغير`,
    uploadedOk: (n: number) => `✅ رُفعت ${n} صورة — اضغط حفظ`,
    uploadsOff: "الرفع من الجهاز غير مفعّل بعد",
    uploadsOffWhy: (missing: string) =>
      `مساحة تخزين الصور غير مهيأة. الناقص: ${missing}. أضفها في إعدادات الخادم ثم أعد المحاولة — حتى ذلك الحين أضف الصور بمسارها أو من المكتبة.`,
    footer: "الصورة الأولى هي ما يراه الزبون في نتائج البحث.",
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
    addByPath: "Or add a photo by path",
    add: "Add",
    library: (n: number) => `Pick from the photo library (${n})`,
    drop: "Drag photos here, or choose them from this device",
    choose: "Choose photos from this device",
    dropHint:
      "Photos are shrunk in your browser before they upload, so a 12MB phone photo becomes about 200KB — faster to send, and much faster for a guest to load.",
    uploading: (done: number, total: number) => `Uploading… ${done} of ${total}`,
    uploadFailed: (name: string) => `Could not upload ${name}`,
    notImage: (name: string) => `${name} is not an image`,
    tooLarge: (name: string) => `${name} is too large even after shrinking`,
    uploadedOk: (n: number) => `✅ Uploaded ${n} photo${n === 1 ? "" : "s"} — press Save`,
    uploadsOff: "Uploading from this device is not switched on yet",
    uploadsOffWhy: (missing: string) =>
      `Photo storage is not configured. Missing: ${missing}. Add these to the server settings and try again — until then, add photos by path or from the library.`,
    footer: "The first photo is what a guest sees in search results.",
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
  const [base, setBase] = useState("");
  const [cfg, setCfg] = useState<MediaConfig | null>(null);
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [m, lib, conf] = await Promise.all([
        api<{ media: MediaItem[]; base?: string }>(`/v1/biz/listings/${listingId}/media`),
        api<{ listings: { slug: string; urls: string[] }[]; base?: string }>(
          "/v1/biz/media/library",
        ),
        api<MediaConfig>("/v1/biz/media/config").catch(() => null),
      ]);
      setMedia(m.media ?? []);
      setLibrary([...new Set(lib.listings.flatMap((l) => l.urls))].sort());
      setBase(m.base ?? lib.base ?? "");
      setCfg(conf);
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

  /**
   * Upload the files an operator dropped or picked.
   *
   * Sequential rather than parallel: on a connection that is already the
   * bottleneck, eight simultaneous uploads make all eight slow and turn one
   * drop into eight failures, and the progress counter would stop meaning
   * anything. One at a time is slower on a good connection and far more
   * predictable on a bad one, which is the connection this is for.
   *
   * Files that fail are reported by name and the rest continue. A batch where
   * one photograph was corrupt should not cost the other eleven.
   */
  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    if (!cfg?.uploads) {
      setMsg(c.uploadsOffWhy((cfg?.missing ?? []).join(", ") || "—"));
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: files.length });
    const added: MediaItem[] = [];
    const failures: string[] = [];

    for (const [i, file] of files.entries()) {
      try {
        if (!isSupportedImage(file)) {
          failures.push(c.notImage(file.name));
          continue;
        }
        const { full, thumb } = await encodeImage(file);
        if (full.blob.size > cfg.maxBytes) {
          failures.push(c.tooLarge(file.name));
          continue;
        }
        const [fullRes, thumbRes] = await Promise.all([
          api<{ url: string }>("/v1/biz/media/upload", {
            method: "POST",
            body: JSON.stringify({
              listingId,
              contentType: full.contentType,
              width: full.width,
              data: await toBase64(full.blob),
            }),
          }),
          api<{ url: string }>("/v1/biz/media/upload", {
            method: "POST",
            body: JSON.stringify({
              listingId,
              contentType: thumb.contentType,
              width: thumb.width,
              data: await toBase64(thumb.blob),
            }),
          }),
        ]);
        added.push({ url: fullRes.url, thumbUrl: thumbRes.url, kind: "photo" });
      } catch (e) {
        failures.push(
          e instanceof ApiError && e.message ? `${file.name}: ${e.message}` : c.uploadFailed(file.name),
        );
      } finally {
        setProgress({ done: i + 1, total: files.length });
      }
    }

    // Duplicates are possible and harmless — the same photograph hashes to the
    // same key — but a listing showing the same picture twice looks careless.
    const fresh = added.filter((a) => !media.some((m) => m.url === a.url));
    if (fresh.length) mutate([...media, ...fresh]);
    setProgress(null);
    setBusy(false);
    setMsg(
      [fresh.length ? c.uploadedOk(fresh.length) : "", ...failures].filter(Boolean).join(" · "),
    );
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
                  <img
                    src={mediaSrc(m.thumbUrl ?? m.url, base)}
                    alt=""
                    loading="lazy"
                    className="w-full h-24 object-cover"
                  />
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

          {/*
            The drop zone. Disabled rather than hidden when storage is not
            configured, with the reason spelled out — the operator who needs to
            know is not the person who can fix it, so the message has to be
            something they can forward.
          */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (cfg?.uploads) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void uploadFiles(Array.from(e.dataTransfer.files));
            }}
            className={`rounded-2xl border-2 border-dashed p-5 text-center transition-colors ${
              dragging ? "border-sea bg-sand" : "border-sand"
            } ${cfg && !cfg.uploads ? "opacity-70" : ""}`}
          >
            {cfg && !cfg.uploads ? (
              <>
                <p className="text-sm font-bold text-sea">{c.uploadsOff}</p>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  {c.uploadsOffWhy(cfg.missing.join(", ") || "—")}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-sea">{c.drop}</p>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void uploadFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <button
                  className="btn-primary !py-1.5 !px-4 !text-sm mt-3 disabled:opacity-40"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {progress ? c.uploading(progress.done, progress.total) : c.choose}
                </button>
                <p className="text-[11px] text-faint mt-2 leading-relaxed">{c.dropHint}</p>
              </>
            )}
          </div>

          <label className="block text-xs font-bold text-muted mt-4">
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
                    <img
                      src={mediaSrc(u, base)}
                      alt=""
                      loading="lazy"
                      className="w-full h-16 object-cover"
                    />
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
