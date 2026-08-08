/**
 * Home-page hero images, and the one rule that made them break.
 *
 * ## The bug this exists to fix
 *
 * A hero image was stored as a *path with no width suffix* — `/hero-marina` —
 * and every consumer appended `-800.webp` and `-1600.webp` itself. That is a
 * good convention for assets we ship in the build, where both files exist
 * because a designer made them.
 *
 * It is a broken convention for uploads, because the encoder deliberately
 * never enlarges an image: asking for 1600px from a 760px screenshot yields
 * 760px, and asking for 800px from the same file also yields 760px. Both
 * encodings then land on the same object key, the second overwrites the first,
 * and the only file in the bucket is `-760.webp` — while the app goes on
 * confidently requesting `-800.webp` and `-1600.webp`, both of which 404. The
 * hero renders blank, and the console thumbnail renders blank, and nothing
 * anywhere reports an error, because a 404 on an `<img>` is silent.
 *
 * The fix is to stop inferring the widths and record them. An uploaded image
 * carries `variants` — the exact URL and the exact pixel width of every
 * encoding that actually exists. Anything without `variants` is a build asset
 * and keeps the old convention, so nothing that worked before changes.
 *
 * Refusing to upscale is still right: enlarging a 760px screenshot to 1600px
 * produces a bigger file of the same picture, which is worse on the one
 * connection this product is designed around. The mistake was never the
 * clamp — it was letting a filename claim a width the pixels did not have.
 */

export interface HeroVariant {
  url: string;
  width: number;
}

export interface HeroImage {
  /**
   * For a build asset: the path without the width suffix (`/hero-marina`).
   * For an upload: the shared object prefix, kept so the two encodings can be
   * recognised as one photograph.
   */
  src: string;
  alt: string;
  /** Present only on uploads. The encodings that genuinely exist. */
  variants?: HeroVariant[];
}

/** The widths a build asset is shipped at, by convention. */
export const HERO_WIDTHS = [800, 1600] as const;

/**
 * What to put in `src` and `srcSet` for one hero image.
 *
 * `srcSet` states the true pixel width of each file, so the browser's choice
 * is a real choice. When an upload produced only one encoding — the usual case
 * for a source narrower than 800px — that is simply the only candidate, and
 * the browser scales it rather than fetching a file that is not there.
 */
export function heroSources(img: HeroImage): { src: string; srcSet: string } {
  const variants = (img.variants ?? [])
    .filter((v) => v?.url && Number.isFinite(v.width) && v.width > 0)
    .sort((a, b) => a.width - b.width);

  if (variants.length === 0) {
    const base = img.src;
    return {
      src: `${base}-${HERO_WIDTHS[0]}.webp`,
      srcSet: HERO_WIDTHS.map((w) => `${base}-${w}.webp ${w}w`).join(", "),
    };
  }

  return {
    // The narrowest is the default `src`: it is what a browser without
    // `srcSet` support downloads, and on this market that should be the
    // cheapest file rather than the sharpest.
    src: variants[0]!.url,
    srcSet: variants.map((v) => `${v.url} ${v.width}w`).join(", "),
  };
}

/** A single URL suitable for a thumbnail — the smallest encoding we have. */
export function heroThumb(img: HeroImage): string {
  const variants = (img.variants ?? [])
    .filter((v) => v?.url && Number.isFinite(v.width) && v.width > 0)
    .sort((a, b) => a.width - b.width);
  return variants[0]?.url ?? `${img.src}-${HERO_WIDTHS[0]}.webp`;
}
