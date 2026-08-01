"use client";
/**
 * Home hero rotator.
 *
 * The photographs are the argument — Libyans have not seen their own coast
 * and their own city presented as a place worth booking. So the hero cycles
 * through them rather than picking one.
 *
 * Three constraints shaped this:
 *  - **No layout shift.** All frames are absolutely positioned inside a fixed
 *    aspect box, so the search pill never jumps while photos load.
 *  - **Cheap on Libyan 3G (§12.3).** Only the first frame is eager and
 *    high-priority; the rest load lazily and the rotation waits until the next
 *    image has actually decoded before crossfading to it.
 *  - **Respects reduced motion.** Users who ask the OS for stillness get the
 *    first frame and no timers at all.
 *
 * The image list comes from the platform control plane, so the business
 * console can add or remove hero photos without a deploy.
 */
import { useEffect, useRef, useState } from "react";

export interface HeroImage {
  src: string;
  alt: string;
}

export function HeroRotator({
  images,
  intervalMs = 6000,
}: {
  images: HeroImage[];
  intervalMs?: number;
}) {
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState<Set<number>>(() => new Set([0]));
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const imgs = useRef<(HTMLImageElement | null)[]>([]);

  /**
   * The page is server-rendered, so images routinely finish decoding before
   * React hydrates and `onLoad` never fires for them. Without this sweep the
   * rotator would sit on frame one forever, waiting for load events that
   * already happened.
   */
  useEffect(() => {
    setReady((prev) => {
      const next = new Set(prev);
      imgs.current.forEach((el, i) => {
        if (el?.complete && el.naturalWidth > 0) next.add(i);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [images.length]);

  useEffect(() => {
    if (images.length < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const id = window.setInterval(() => {
      setActive((cur) => {
        // Advance only to a frame that has decoded — a half-loaded photo
        // fading in over a good one looks like a bug, not a slideshow.
        for (let step = 1; step <= images.length; step++) {
          const next = (cur + step) % images.length;
          if (readyRef.current.has(next)) return next;
        }
        return cur;
      });
    }, Math.max(2500, intervalMs));
    return () => window.clearInterval(id);
  }, [images.length, intervalMs]);

  const markReady = (i: number) =>
    setReady((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));

  return (
    <div className="absolute inset-0" aria-hidden={false}>
      {images.map((img, i) => (
        <img
          key={img.src}
          ref={(el) => {
            imgs.current[i] = el;
          }}
          src={`${img.src}-800.webp`}
          srcSet={`${img.src}-800.webp 800w, ${img.src}-1600.webp 1600w`}
          sizes="(max-width: 640px) 100vw, 1024px"
          alt={i === active ? img.alt : ""}
          loading={i === 0 ? "eager" : "lazy"}
          fetchPriority={i === 0 ? "high" : "low"}
          decoding="async"
          onLoad={() => markReady(i)}
          onError={() => markReady(i)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ease-in-out ${
            i === active ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}

      {/* Progress dots — also the affordance that says "there is more here" */}
      {images.length > 1 ? (
        <div className="absolute bottom-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 flex gap-1.5 z-10">
          {images.map((img, i) => (
            <button
              key={img.src}
              onClick={() => setActive(i)}
              aria-label={`الصورة ${i + 1}`}
              aria-current={i === active}
              className={`h-1.5 rounded-full transition-all ${
                i === active ? "w-5 bg-white" : "w-1.5 bg-white/50 hover:bg-white/80"
              }`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
