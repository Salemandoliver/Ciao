"use client";
/**
 * Home hero images — add, remove, reorder.
 *
 * This is the first thing anyone sees of Ciao, so it gets its own panel with
 * live thumbnails rather than being buried as a JSON field. Order is display
 * order; the first image is what loads instantly on a slow connection, so it
 * should be the strongest photograph, not an afterthought.
 */
import { useState } from "react";
import { useLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";
import { Pill, Section } from "./lib";

interface HeroImage {
  src: string;
  alt: string;
}
interface HeroValue {
  intervalMs: number;
  images: HeroImage[];
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

  const v = (value as HeroValue) ?? { intervalMs: 6000, images: [] };
  const images = v.images ?? [];

  const update = (next: Partial<HeroValue>) => onChange({ ...v, ...next });

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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {images.map((img, i) => (
          <div key={img.src} className="relative rounded-xl overflow-hidden bg-sand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${img.src}-800.webp`} alt={img.alt} className="w-full h-24 object-cover" />
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
        ))}
      </div>

      {isAdmin ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
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
