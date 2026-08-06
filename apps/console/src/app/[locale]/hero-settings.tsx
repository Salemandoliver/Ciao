"use client";
/**
 * Home hero images — add, remove, reorder.
 *
 * This is the first thing anyone sees of Ciao, so it gets its own panel with
 * live thumbnails rather than being buried as a JSON field. Order is display
 * order; the first image is what loads instantly on a slow connection, so it
 * should be the strongest photograph, not an afterthought.
 *
 * ## One path, two files
 *
 * A hero image is stored as a path with no suffix, and both the marketplace
 * and this panel append `-800.webp` or `-1600.webp` themselves. That is what
 * puts a real `srcSet` on the home page: a phone downloads the 800px file and
 * a laptop the 1600px one from a single stored value, which on a full-bleed
 * photograph is the largest single saving available anywhere in the product.
 *
 * It is also why uploaded heroes cannot be keyed by their content the way
 * listing photographs are — the two encodings have different bytes and so
 * different hashes, and would not share a prefix. Both uploads therefore carry
 * one fingerprint taken from the original file, and the API returns the shared
 * base to store.
 *
 * The thumbnails here were previously broken for the same reason every
 * thumbnail in the console was: `/hero-marina-800.webp` is an asset of the
 * *marketplace* build, and resolving it against the console's own origin finds
 * nothing. They now resolve against the base the API reports.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";
import { ApiError, api, mediaSrc } from "@/lib/api";
import { encodeWidths, fileFingerprint, isSupportedImage, toBase64 } from "@/lib/encode-image";
import { Pill, Section } from "./lib";

interface HeroImage {
  src: string;
  alt: string;
}
interface HeroValue {
  intervalMs: number;
  images: HeroImage[];
}
interface MediaConfig {
  uploads: boolean;
  missing: string[];
  maxBytes: number;
  base: string;
}

const copy = {
  ar: {
    title: "صور الواجهة الرئيسية",
    overridden: "مُعدّلة",
    default: "افتراضي",
    intro:
      "تتبدّل هذه الصور تلقائيًا في أعلى الصفحة الرئيسية. الصورة الأولى هي التي تُحمَّل فورًا على الشبكات البطيئة — اجعلها الأقوى.",
    duplicate: "هذه الصورة مضافة بالفعل",
    keepOne: "يجب أن تبقى صورة واحدة على الأقل",
    defaultAlt: "صورة من ليبيا",
    first: "الأولى",
    earlier: "تقديم",
    later: "تأخير",
    earlierGlyph: "›",
    laterGlyph: "‹",
    remove: "حذف",
    altPlaceholder: "وصف الصورة (للقارئ الصوتي)",
    add: "+ إضافة صورة",
    interval: "مدة عرض كل صورة (ثانية)",
    drop: "اسحب صورة هنا أو اختر من الجهاز",
    choose: "اختر صورة من الجهاز",
    dropHint:
      "نصغّر الصورة في المتصفح ونحفظ نسختين — 800 و1600 بكسل — فالهاتف يحمّل الأخف واللابتوب الأوضح.",
    uploading: (done: number, total: number) => `جاري الرفع… ${done} من ${total}`,
    uploadFailed: (name: string) => `تعذر رفع ${name}`,
    notImage: (name: string) => `${name} ليست صورة`,
    uploadedOk: (n: number) => `✅ رُفعت ${n} صورة — لا تنسَ الحفظ`,
    uploadsOff: "الرفع من الجهاز غير مفعّل بعد",
    uploadsOffWhy: (missing: string) =>
      `مساحة تخزين الصور غير مهيأة. الناقص: ${missing}.`,
    altLabel: "وصف الصورة",
    orByPath: "أو أضف صورة بمسارها",
    footer:
      "يُكتب المسار بدون اللاحقة: النظام يطلب تلقائيًا نسختي 800 و1600 بكسل بصيغة WebP، فيصل للهاتف على شبكة ضعيفة أخفّ ملف ممكن.",
  },
  en: {
    title: "Home page hero images",
    overridden: "Overridden",
    default: "Default",
    intro:
      "These images rotate at the top of the home page. The first one is what loads immediately on a slow connection — make it the strongest photograph.",
    duplicate: "That image is already in the rotation",
    keepOne: "At least one image has to remain",
    defaultAlt: "A photograph from Libya",
    first: "First",
    earlier: "Move earlier",
    later: "Move later",
    earlierGlyph: "‹",
    laterGlyph: "›",
    remove: "Remove",
    altPlaceholder: "Image description (for screen readers)",
    add: "+ Add image",
    interval: "Seconds per image",
    drop: "Drag an image here, or choose one from this device",
    choose: "Choose an image from this device",
    dropHint:
      "Images are shrunk in your browser and stored at two sizes — 800px and 1600px — so a phone loads the lighter file and a laptop the sharper one.",
    uploading: (done: number, total: number) => `Uploading… ${done} of ${total}`,
    uploadFailed: (name: string) => `Could not upload ${name}`,
    notImage: (name: string) => `${name} is not an image`,
    uploadedOk: (n: number) => `✅ Uploaded ${n} image${n === 1 ? "" : "s"} — remember to save`,
    uploadsOff: "Uploading from this device is not switched on yet",
    uploadsOffWhy: (missing: string) => `Photo storage is not configured. Missing: ${missing}.`,
    altLabel: "Image description",
    orByPath: "Or add an image by path",
    footer:
      "Write the path without the suffix: the app requests the 800px and 1600px WebP variants itself, so a phone on a weak network gets the smallest file that will do.",
  },
} satisfies Record<Locale, unknown>;

export function HeroSettings({
  row,
  value,
  isAdmin,
  onChange,
}: {
  row?: { overridden: boolean };
  value: unknown;
  isAdmin: boolean;
  onChange: (v: HeroValue) => void;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const [src, setSrc] = useState("");
  const [alt, setAlt] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [cfg, setCfg] = useState<MediaConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const v = (value as HeroValue) ?? { intervalMs: 6000, images: [] };
  const images = v.images ?? [];

  const update = (next: Partial<HeroValue>) => onChange({ ...v, ...next });

  const loadConfig = useCallback(async () => {
    setCfg(await api<MediaConfig>("/v1/biz/media/config").catch(() => null));
  }, []);
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  /**
   * Upload the images an admin dropped or picked.
   *
   * Each one becomes two uploads sharing a fingerprint taken from the original
   * file, so the stored path can carry both sizes. Sequential for the same
   * reason the catalogue uploader is: on a connection that drops, predictable
   * progress beats parallel speed.
   */
  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    if (!cfg?.uploads) {
      setErr(c.uploadsOffWhy((cfg?.missing ?? []).join(", ") || "—"));
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: files.length });
    const added: HeroImage[] = [];
    const failures: string[] = [];

    for (const [i, file] of files.entries()) {
      try {
        if (!isSupportedImage(file)) {
          failures.push(c.notImage(file.name));
          continue;
        }
        const group = await fileFingerprint(file);
        const [wide, narrow] = await encodeWidths(file, [1600, 800]);
        const results = await Promise.all(
          [wide!, narrow!].map(async (enc) =>
            api<{ base?: string; url: string }>("/v1/biz/media/upload", {
              method: "POST",
              body: JSON.stringify({
                kind: "hero",
                group,
                contentType: enc.contentType,
                width: enc.width,
                data: await toBase64(enc.blob),
              }),
            }),
          ),
        );
        const base = results[0]?.base;
        if (!base) throw new Error("no_base");
        if (!images.some((x) => x.src === base) && !added.some((x) => x.src === base))
          // The filename is a far better starting point for alt text than a
          // generic placeholder, and the admin can correct it in place.
          added.push({ src: base, alt: file.name.replace(/\.[a-z0-9]+$/i, "") || c.defaultAlt });
      } catch (e) {
        failures.push(
          e instanceof ApiError && e.message ? `${file.name}: ${e.message}` : c.uploadFailed(file.name),
        );
      } finally {
        setProgress({ done: i + 1, total: files.length });
      }
    }

    if (added.length) update({ images: [...images, ...added] });
    setProgress(null);
    setBusy(false);
    setErr(failures.join(" · "));
    // Saving is a separate, deliberate act on this screen — the panel edits a
    // settings value that is written when the operator presses save — so a
    // successful upload has to say so, or it looks like nothing happened.
    setNote(added.length ? c.uploadedOk(added.length) : "");
  }

  function add() {
    const clean = src.trim().replace(/-(800|1600)\.webp$/, "");
    if (!clean) return;
    if (images.some((i) => i.src === clean)) {
      setErr(c.duplicate);
      return;
    }
    setErr("");
    update({ images: [...images, { src: clean, alt: alt.trim() || c.defaultAlt }] });
    setSrc("");
    setAlt("");
  }

  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= images.length) return;
    const next = [...images];
    [next[i], next[j]] = [next[j]!, next[i]!];
    update({ images: next });
  }

  function remove(i: number) {
    if (images.length <= 1) {
      setErr(c.keepOne);
      return;
    }
    setErr("");
    update({ images: images.filter((_, j) => j !== i) });
  }

  return (
    <Section
      title={c.title}
      action={
        row?.overridden ? (
          <Pill tone="amber">{c.overridden}</Pill>
        ) : (
          <Pill tone="slate">{c.default}</Pill>
        )
      }
    >
      <p className="text-xs text-faint mb-3 leading-relaxed">{c.intro}</p>

      {err ? <p className="text-sm font-bold text-danger mb-2">{err}</p> : null}
      {note ? <p className="text-sm font-bold text-sea mb-2">{note}</p> : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {images.map((img, i) => (
          <div key={img.src} className="rounded-xl overflow-hidden bg-sand">
            <div className="relative">
            {/*
              Resolved against the base the API reports rather than this app's
              own origin. These files are assets of the marketplace build, so
              rendering the stored path directly here found nothing and every
              hero thumbnail was a broken image.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaSrc(`${img.src}-800.webp`, cfg?.base ?? "")}
              alt={img.alt}
              loading="lazy"
              className="w-full h-24 object-cover"
            />
            {i === 0 ? (
              <span className="absolute top-1 start-1 rounded-full bg-amber px-2 py-0.5 text-[10px] font-bold text-sea-dark">
                {c.first}
              </span>
            ) : null}
            {isAdmin ? (
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
                  onClick={() => remove(i)}
                  aria-label={c.remove}
                >
                  ✕
                </button>
              </div>
            ) : null}
            </div>
            {/*
              Alt text is editable in place. An uploaded image starts with its
              filename, which is a better guess than a generic placeholder and
              a worse one than a sentence — and previously alt could only be
              set at the moment of adding, so an image with poor description
              could never be corrected without deleting it.
            */}
            {isAdmin ? (
              <input
                className="w-full bg-surface text-[11px] px-2 py-1 border-0 focus:outline-none focus:ring-1 focus:ring-sea"
                aria-label={c.altLabel}
                placeholder={c.altPlaceholder}
                value={img.alt}
                onChange={(e) =>
                  update({
                    images: images.map((x, j) =>
                      j === i ? { ...x, alt: e.target.value } : x,
                    ),
                  })
                }
              />
            ) : null}
          </div>
        ))}
      </div>

      {/*
        The drop zone. Disabled rather than hidden when object storage is not
        configured, with the missing variables named — the person who can add
        them is usually not the person looking at this screen.
      */}
      {isAdmin ? (
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
          className={`rounded-2xl border-2 border-dashed p-4 text-center mt-3 transition-colors ${
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
      ) : null}

      {isAdmin ? (
        <>
        <p className="text-xs font-bold text-muted mt-3">{c.orByPath}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
          <input
            className="input !py-2 !text-sm"
            dir="ltr"
            placeholder="/hero-marina"
            value={src}
            onChange={(e) => setSrc(e.target.value)}
          />
          <input
            className="input !py-2 !text-sm"
            placeholder={c.altPlaceholder}
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
          />
          <button className="chip justify-center" onClick={add}>
            {c.add}
          </button>
        </div>
        </>
      ) : null}

      <label className="block text-xs font-bold text-muted mt-3">
        {c.interval}
        <input
          className="input !py-1.5 !text-sm mt-1 max-w-[110px]"
          inputMode="numeric"
          disabled={!isAdmin}
          value={Math.round((v.intervalMs ?? 6000) / 1000)}
          onChange={(e) => update({ intervalMs: Math.max(3, Number(e.target.value || 6)) * 1000 })}
        />
      </label>

      <p className="text-[11px] text-faint mt-3 leading-relaxed">{c.footer}</p>
    </Section>
  );
}
