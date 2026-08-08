/**
 * The brand band — the sentence under the trust strip that says why any of
 * this matters.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * This file is duplicated byte-for-byte in apps/web and apps/console.
 * Change one, run `node tools/component-drift.mjs`, copy it across.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The duplication is deliberate and is the same trade the logo makes.
 * `@ciao/shared` is consumed by the API, so it cannot hold JSX; and the one
 * thing this component must never do is disagree with itself, because the
 * whole point of the composer in Ciao Business is that an operator sees what
 * she is about to publish. A preview that renders *approximately* the page is
 * worse than no preview: it will be trusted, and it will be wrong on the day
 * somebody schedules a headline three words longer than the one they tested.
 *
 * So there is no `variant` prop, no `preview` boolean, nothing the console can
 * pass to make it render differently. The console renders the marketplace's
 * component, at the marketplace's width, and the only honest way to guarantee
 * that is for the file to be the same file.
 *
 * What the design is doing:
 *
 *  - The claim leads and the reasoning follows behind a rule, because the
 *    second half *supports* the first — a hierarchy a centred block flattens.
 *  - The rule is `border-s`, never `border-l`. On the English page the whole
 *    band mirrors, and a hard-coded left border lands on the wrong side.
 *  - The picture is small and beside the words rather than behind them. It is
 *    decoration — a crescent, a lantern — and text over a photograph is a
 *    contrast problem that has to be re-solved for every image anybody ever
 *    uploads. Beside it, no upload can make the sentence unreadable.
 *  - There is no `size` prop and no colour prop. A band that can be tuned per
 *    call site is a band that drifts, and this one appears on two apps.
 */
import type { RenderedBrandMessage } from "@ciao/shared";

/**
 * Text that may be Arabic on an English page.
 *
 * Undeclared Arabic is announced letter by letter by a screen reader and laid
 * out in the wrong direction by the browser; `tools/locale-audit.mjs` fails the
 * build over it. The flag comes from `renderBrandMessage`, which is the only
 * thing that knows whether a field fell back.
 */
function langProps(ar: boolean) {
  return ar ? ({ lang: "ar", dir: "rtl" } as const) : {};
}

export function BrandBand({
  message,
  onCtaClick,
}: {
  message: RenderedBrandMessage;
  /** Fires the `brand.message_clicked` half of the pair. */
  onCtaClick?: () => void;
}) {
  const { overline, headline, accent, body, imageUrl, imageAlt, ctaLabel, ctaHref } = message;
  return (
    <section className="mt-10 sm:flex sm:items-center sm:gap-8">
      {imageUrl ? (
        /*
         * Fixed square, cropped, and `alt=""` when nobody wrote alt text.
         *
         * An empty alt is the correct markup for an image that carries no
         * information a sighted reader would not already have from the
         * sentence next to it — it tells a screen reader to skip it, which is
         * kinder than announcing a filename. `flex-shrink-0` because a long
         * headline must squeeze the text column, never the picture into an
         * oval.
         */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={imageAlt ?? ""}
          width={96}
          height={96}
          loading="lazy"
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover flex-shrink-0 mb-3 sm:mb-0"
        />
      ) : null}

      <div className="sm:flex-1">
        {overline ? (
          <p className="text-link font-bold text-sm" {...langProps(overline.ar)}>
            {overline.text}
          </p>
        ) : null}
        <h2 className="font-bold text-2xl sm:text-3xl leading-snug mt-1 text-sea">
          <span {...langProps(headline.ar)}>{headline.text}</span>
          {accent ? (
            <>
              {" "}
              <span className="text-amber-dark" {...langProps(accent.ar)}>
                {accent.text}
              </span>
            </>
          ) : null}
        </h2>
        {ctaLabel && ctaHref ? (
          <a
            href={ctaHref}
            onClick={onCtaClick}
            className="inline-block mt-3 text-link font-bold text-sm hover:underline"
            {...langProps(ctaLabel.ar)}
          >
            {/*
              `arrow-onward` mirrors the glyph against the element's own
              inherited direction — see the comment on the class in tokens.css
              for why Tailwind's `rtl:` variant is the wrong tool here.
            */}
            {ctaLabel.text}{" "}
            <span aria-hidden className="arrow-onward">
              ←
            </span>
          </a>
        ) : null}
      </div>

      {body ? (
        <p
          className="text-muted text-sm mt-3 sm:mt-0 sm:max-w-xs sm:border-s sm:border-sea/15 sm:ps-6"
          {...langProps(body.ar)}
        >
          {body.text}
        </p>
      ) : null}
    </section>
  );
}
