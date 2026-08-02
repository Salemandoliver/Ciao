"use client";
/**
 * The photo carousel on a search-result card.
 *
 * Three constraints shaped this more than the interaction did.
 *
 * **Data.** A search page shows six cards. Loading every photo of every card
 * would multiply the page's heaviest payload by however many pictures a
 * property has, on connections where that is measured in real money and real
 * seconds (§12.3). So the strip is a native scroll-snap container and every
 * photo after the first is `loading="lazy"`: the browser only fetches an image
 * once it scrolls into the strip's own viewport, which means a card nobody
 * touches costs exactly what it costs today. Once someone does touch a card,
 * that card's remaining photos are promoted to eager so the second press is
 * instant rather than a blank frame.
 *
 * **Direction.** Arrows are "previous" and "next", never "left" and "right".
 * In Arabic the next photo is to the left, and scrolling is done through
 * `scrollIntoView` rather than arithmetic on `scrollLeft`, whose sign in RTL
 * is a browser-by-browser argument nobody should have to win.
 *
 * **Touch.** Scroll-snap gives swipe for free, which is how this is actually
 * used on a phone. The arrows exist for the desktop case and for
 * discoverability — a photo you cannot tell is swipeable is a photo nobody
 * swipes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { trackClient } from "@/lib/tracker";
import { useLocale, useRouter } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: {
    prev: "الصورة السابقة",
    next: "الصورة التالية",
    photoOf: (i: number, n: number) => `صورة ${i} من ${n}`,
    goTo: (i: number) => `اذهب إلى الصورة ${i}`,
  },
  en: {
    prev: "Previous photo",
    next: "Next photo",
    photoOf: (i: number, n: number) => `Photo ${i} of ${n}`,
    goTo: (i: number) => `Go to photo ${i}`,
  },
} satisfies Record<Locale, unknown>;

export interface GalleryPhoto {
  url: string;
}

export function CardGallery({
  photos,
  alt,
  listingId,
  href,
}: {
  photos: GalleryPhoto[];
  alt: string;
  listingId: string;
  /** Where a tap on the photograph goes. A drag goes nowhere. */
  href: string;
}) {
  const router = useRouter();
  const locale = useLocale();
  const c = copy[locale];
  const stripRef = useRef<HTMLDivElement>(null);
  /** Where a pointer went down, so a drag can be told from a tap. */
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState(0);
  /**
   * Flipped the first time a pointer comes near this particular card.
   *
   * `loading="lazy"` was the first attempt and it does not work here: an image
   * scrolled out of a *horizontal* strip that is itself on screen still counts
   * as near-viewport, so Chrome fetched every photo of every card on page load
   * — thirty requests for a six-card page, exactly what this was meant to
   * avoid. Measured, not assumed; there is a check for it in
   * tools/gallery-check.mjs.
   *
   * So the second photo has no `src` at all until someone hovers, touches or
   * tabs to the card. Those all precede a click by enough milliseconds that
   * the fetch is already in flight when the arrow is actually pressed, and a
   * card nobody goes near costs exactly what it cost before this feature
   * existed.
   */
  const [activated, setActivated] = useState(false);
  const prime = useCallback(() => setActivated(true), []);

  const count = photos.length;

  const goTo = useCallback(
    (next: number, source: "arrow" | "dot") => {
      const strip = stripRef.current;
      if (!strip) return;
      const clamped = Math.max(0, Math.min(count - 1, next));
      const child = strip.children[clamped] as HTMLElement | undefined;
      if (!child) return;
      setActivated(true);
      /*
       * `scrollBy` on the strip, from a delta measured off the rendered
       * rectangles — not `scrollIntoView`, which also scrolled the *page*
       * vertically and made a list of cards leap away from the finger that
       * pressed "next".
       *
       * Measuring the delta rather than computing `index * width` also sides
       * neatly around RTL: a physical pixel offset means the same thing in
       * both directions, whereas `scrollLeft` is negative in Arabic on some
       * engines and positive on others.
       */
      const delta = child.getBoundingClientRect().left - strip.getBoundingClientRect().left;
      strip.scrollBy({
        left: delta,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
      setIndex(clamped);
      trackClient("listing.gallery_swiped", { listingId, photoIndex: clamped, source });
    },
    [count, listingId],
  );

  /*
   * Keep the dots honest when the strip is swiped rather than clicked. Reading
   * the scroll position is the only way to know where a finger left it, and
   * the alternative — assuming the index only changes via our buttons — is
   * wrong on every phone.
   */
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || count < 2) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = strip.clientWidth || 1;
        // `scrollLeft` is negative in RTL on some engines and positive on
        // others; its magnitude is consistent, which is all we need.
        const at = Math.round(Math.abs(strip.scrollLeft) / width);
        setIndex((prev) => (prev === at ? prev : Math.max(0, Math.min(count - 1, at))));
        if (at > 0) setActivated(true);
      });
    };
    strip.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      strip.removeEventListener("scroll", onScroll);
    };
  }, [count]);

  if (count === 0) {
    return <div className="absolute inset-0" aria-hidden />;
  }

  return (
    <>
      <div
        ref={stripRef}
        onPointerEnter={prime}
        onTouchStart={prime}
        onFocus={prime}
        onPointerDown={(e) => {
          pressRef.current = { x: e.clientX, y: e.clientY };
        }}
        onClick={(e) => {
          /*
           * The strip sits above the card's stretched link so that swiping
           * works, which means it has to carry the navigation itself. A tap
           * opens the property; a drag of more than a few pixels was someone
           * changing the photo and must not navigate — getting this wrong
           * means every swipe on a phone bounces you into a listing.
           */
          const start = pressRef.current;
          pressRef.current = null;
          if (!start) return;
          const moved =
            Math.abs(e.clientX - start.x) > 8 || Math.abs(e.clientY - start.y) > 8;
          if (moved) return;
          e.preventDefault();
          router.push(href);
        }}
        // `contain` is the belt to that fix's braces: a horizontal scroll that
        // reaches the end of this strip stops there instead of moving the page.
        style={{ touchAction: "pan-x pan-y", overscrollBehaviorX: "contain" }}
        className="absolute inset-0 flex overflow-x-auto snap-x snap-mandatory no-scrollbar cursor-pointer"
        // A photo strip is decoration inside a card that is itself a link; a
        // screen reader gets the title and the count, not six scroll stops.
        aria-roledescription="carousel"
        aria-label={c.photoOf(index + 1, count)}
      >
        {photos.map((p, i) => (
          <img
            key={p.url}
            src={i === 0 || activated ? p.url : undefined}
            alt={i === 0 ? alt : `${alt} — ${c.photoOf(i + 1, count)}`}
            loading={i === 0 ? "lazy" : "eager"}
            decoding="async"
            /*
             * `flex-[0_0_100%]`, not `w-full flex-shrink-0`. A photo with no
             * `src` yet has no intrinsic width, so with an auto basis the
             * strip had nothing to scroll to at the instant "next" was
             * pressed — and a scroll a container cannot satisfy chains to its
             * ancestors, which is why the whole page slid 80px every time.
             * A fixed basis gives every slot its full width whether the image
             * has arrived or not.
             */
            className="h-full flex-[0_0_100%] snap-center object-cover"
            draggable={false}
          />
        ))}
      </div>

      {count > 1 ? (
        <>
          {/*
            Logical `start`/`end`, so in Arabic "previous" sits on the right
            without a single line of direction-checking code.
          */}
          <NavButton
            side="start"
            label={c.prev}
            glyph="‹"
            disabled={index === 0}
            onActivate={() => goTo(index - 1, "arrow")}
          />
          <NavButton
            side="end"
            label={c.next}
            glyph="›"
            disabled={index === count - 1}
            onActivate={() => goTo(index + 1, "arrow")}
          />
          <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1 pointer-events-none">
            {photos.map((p, i) => (
              <button
                key={p.url}
                type="button"
                aria-label={c.goTo(i + 1)}
                aria-current={i === index}
                onClick={(e) => {
                  // The card is a link; a dot is not a navigation.
                  e.preventDefault();
                  e.stopPropagation();
                  goTo(i, "dot");
                }}
                className={`pointer-events-auto h-1.5 rounded-full transition-all ${
                  i === index ? "w-4 bg-white" : "w-1.5 bg-white/60 hover:bg-white/90"
                }`}
                style={{ boxShadow: "0 0 2px rgb(0 0 0 / 0.4)" }}
              />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function NavButton({
  side,
  label,
  glyph,
  disabled,
  onActivate,
}: {
  side: "start" | "end";
  label: string;
  glyph: string;
  disabled: boolean;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        /*
         * The whole card navigates to the listing. Without both of these, a
         * tap on "next photo" opens the property instead — the single most
         * annoying bug this component could ship with.
         */
        e.preventDefault();
        e.stopPropagation();
        onActivate();
      }}
      /*
       * Visible by default rather than on hover. A control that only appears
       * under a mouse pointer does not exist on a phone, and the phone is the
       * device this is used on. It fades up on hover and focus, and disappears
       * entirely at the ends of the strip so there is never a dead button.
       */
      className={`btn-on-photo absolute top-1/2 -translate-y-1/2 ${
        side === "start" ? "start-1.5" : "end-1.5"
      } w-7 h-7 rounded-full grid place-items-center text-lg leading-none shadow
        opacity-85 group-hover:opacity-100 focus-visible:opacity-100
        disabled:opacity-0 disabled:pointer-events-none transition-opacity`}
    >
      {/* The glyph is a direction, and direction is the one thing that must
          flip with the page — so it inherits `dir` rather than being drawn. */}
      <span aria-hidden>{glyph}</span>
    </button>
  );
}
