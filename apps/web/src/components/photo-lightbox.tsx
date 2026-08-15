"use client";
/**
 * The full-screen photo viewer — screen 6 of the design.
 *
 * The page already has a snap-scrolling carousel, and that is right on a phone
 * where the photograph is the width of the screen anyway. On anything larger it
 * is a 16:9 letterbox in a column, and the venue photography is the strongest
 * argument this marketplace has (§3.2). This is where it gets the whole screen.
 *
 * Additive on purpose: the carousel stays server-rendered exactly as it was,
 * and the photo-count chip that already sits on it becomes the way in. Nothing
 * about the page changes for someone who never opens this.
 *
 * ## Dark in both themes
 *
 * Like the footer, and for a sharper reason: a photograph shown against white
 * is a photograph you are reading through a glare. Every gallery worth the name
 * is black, the design's is black, and the theme has no opinion worth hearing
 * on the subject.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/locale";
import { dirOf, type Locale } from "@/lib/i18n";
import { fmtNum } from "@/lib/vocab";

const copy = {
  ar: {
    count: (n: string) => `${n} صور`,
    open: "افتح معرض الصور",
    close: "إغلاق",
    prev: "الصورة السابقة",
    next: "الصورة التالية",
    all: "كل الصور",
    position: (i: string, n: string) => `${i} / ${n}`,
  },
  en: {
    count: (n: string) => `${n} photos`,
    open: "Open photo gallery",
    close: "Close",
    prev: "Previous photo",
    next: "Next photo",
    all: "All photos",
    position: (i: string, n: string) => `${i} / ${n}`,
  },
} satisfies Record<Locale, unknown>;

export function PhotoLightbox({
  photos,
  title,
}: {
  photos: { url: string }[];
  title: string;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const rtl = dirOf(locale) === "rtl";
  const [index, setIndex] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const open = index !== null;
  const total = photos.length;

  const step = useCallback(
    (delta: number) => setIndex((i) => (i === null ? i : (i + delta + total) % total)),
    [total],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIndex(null);
        return;
      }
      /*
       * The arrows are physical, so they follow the screen rather than the
       * language: pressing the key on the right moves to the picture on the
       * right, which in Arabic is the previous one. Getting this backwards is
       * the sort of thing that only ever gets noticed by the people the app is
       * actually for.
       */
      if (e.key === "ArrowRight") step(rtl ? -1 : 1);
      if (e.key === "ArrowLeft") step(rtl ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while a full-screen viewer is open.
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prior;
    };
  }, [open, rtl, step]);

  // Return the reader to the control they opened this from, not to the top.
  useEffect(() => {
    if (!open) openerRef.current?.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (total === 0) return null;

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={() => setIndex(0)}
        aria-label={c.open}
        className="chip-on-photo cursor-pointer hover:brightness-95 transition"
      >
        {c.count(fmtNum(locale, total))}
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex flex-col outline-none"
          style={{ background: "#0b0b0f" }}
          onClick={(e) => {
            // Only the ground closes it; a click on the picture is not a miss.
            if (e.target === e.currentTarget) setIndex(null);
          }}
        >
          <div className="flex items-center justify-between gap-4 px-4 py-3 shrink-0">
            <button
              type="button"
              onClick={() => setIndex(null)}
              aria-label={c.close}
              className="h-10 w-10 rounded-full grid place-items-center text-xl"
              style={{ background: "rgb(255 255 255 / .12)", color: "#f5f2eb" }}
            >
              ✕
            </button>
            <span
              className="text-sm font-bold tabular-nums"
              style={{ color: "#f5f2eb" }}
              dir="ltr"
            >
              {c.position(fmtNum(locale, index + 1), fmtNum(locale, total))}
            </span>
            {/* Balances the close button so the counter sits truly centred. */}
            <span className="h-10 w-10" aria-hidden />
          </div>

          <div className="flex-1 min-h-0 flex items-center justify-center px-4">
            <img
              src={photos[index]!.url}
              alt={`${title} — ${index + 1}`}
              className="max-h-full max-w-full object-contain"
            />
          </div>

          <div className="shrink-0 px-4 pb-4 pt-3">
            <p
              className="text-[11px] font-bold uppercase tracking-widest mb-2"
              style={{ color: "#aaa091" }}
            >
              {c.all}
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photos.map((p, i) => (
                <button
                  key={p.url}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`${title} — ${i + 1}`}
                  aria-current={i === index}
                  className="shrink-0 h-14 w-20 rounded-lg overflow-hidden"
                  style={{
                    outline: i === index ? "2px solid #e8641b" : "none",
                    outlineOffset: "1px",
                    opacity: i === index ? 1 : 0.55,
                  }}
                >
                  <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
