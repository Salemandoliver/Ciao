/**
 * The wordmark — design v5, August 2026.
 *
 * What changed from v4 and why.
 *
 * The Greeting Bubble is gone. It did a job — it made "ciao" read as a
 * greeting rather than a word — but it also made the mark a *container*, and
 * containers date. The new mark is the word itself: `.ciao`, flat, tight, with
 * the full stop carried in the accent colour. Flatter is not a fashion here,
 * it is what survives being 24px on a bad screen.
 *
 * Three details are the whole design:
 *
 *  - **The stop is the brand.** It is the only element that changes colour
 *    between themes — amber on cream, cream on navy — so the mark reads as one
 *    object with one spark in it rather than as two-tone lettering.
 *  - **Square dots.** The i-dot and the stop are squares, not circles. Baloo's
 *    own i-dot is round, so a square in the same fill is drawn over it: at any
 *    size the squares are what stops this reading as a generic rounded sans.
 *  - **The stop stays on the left in both languages.** A logo is a picture,
 *    not a sentence, and mirroring it in Arabic would make the app look like
 *    two different companies. It also happens to read as `.ciao` — which,
 *    given the domain, is a joke worth keeping.
 *
 * Still drawn as vector paths from Baloo Bhaijaan 2 ExtraBold rather than set
 * in live text: identical proportions at every size, on every device, with no
 * font to wait for and no reflow when it arrives.
 */

/** c-i-a, from Baloo Bhaijaan 2 ExtraBold. The `o` is drawn separately. */
const CIA_PATH =
  "M32.6 -36.7L32.6 -36.7L32.6 -36.7Q27.6 -36.7 23.95 -33.5Q20.3 -30.3 20.3 -24.1L20.3 -24.1Q20.3 -17.9 23.8 -14.9Q27.3 -11.9 32.5 -11.9L32.5 -11.9Q35.5 -11.9 37.85 -12.65Q40.2 -13.4 41.8 -14.2L41.8 -14.2Q43.7 -12.8 44.65 -11.2Q45.6 -9.6 45.6 -7.3L45.6 -7.3Q45.6 -3.3 41.65 -0.9Q37.7 1.5 30.4 1.5L30.4 1.5Q22.1 1.5 15.95 -1.4Q9.8 -4.3 6.45 -10.05Q3.1 -15.8 3.1 -24.1L3.1 -24.1Q3.1 -32.9 6.8 -38.65Q10.5 -44.4 16.6 -47.25Q22.7 -50.1 29.9 -50.1L29.9 -50.1Q37 -50.1 40.95 -47.5Q44.9 -44.9 44.9 -40.8L44.9 -40.8Q44.9 -38.9 44 -37.25Q43.1 -35.6 41.9 -34.4L41.9 -34.4Q40.2 -35.2 37.8 -35.95Q35.4 -36.7 32.6 -36.7M53.7 -62.1L53.7 -62.1L53.7 -62.1Q53.7 -65.9 56.3 -68.5Q58.9 -71.1 63 -71.1L63 -71.1Q67.1 -71.1 69.7 -68.5Q72.3 -65.9 72.3 -62.1L72.3 -62.1Q72.3 -58.4 69.7 -55.75Q67.1 -53.1 63 -53.1L63 -53.1Q58.9 -53.1 56.3 -55.75Q53.7 -58.4 53.7 -62.1M54.5 -7.2L54.5 -26.4L71.5 -26.4L71.5 -0.1Q70.4 0.2 68.35 0.5Q66.3 0.8 63.9 0.8L63.9 0.8Q59 0.8 56.75 -0.9Q54.5 -2.6 54.5 -7.2L54.5 -7.2M71.5 -40.8L71.5 -17.5L54.5 -17.5L54.5 -47.9Q55.6 -48.2 57.65 -48.5Q59.7 -48.8 62.1 -48.8L62.1 -48.8Q67.1 -48.8 69.3 -47.15Q71.5 -45.5 71.5 -40.8L71.5 -40.8M103.1 -10.8L103.1 -10.8L103.1 -10.8Q104.8 -10.8 106.85 -11.15Q108.9 -11.5 109.9 -12.1L109.9 -12.1L109.9 -20.1L102.7 -19.5Q99.9 -19.3 98.1 -18.3Q96.3 -17.3 96.3 -15.3L96.3 -15.3Q96.3 -13.3 97.85 -12.05Q99.4 -10.8 103.1 -10.8M102.3 -50.1L102.3 -50.1L102.3 -50.1Q113.2 -50.1 119.75 -45.65Q126.3 -41.2 126.3 -31.8L126.3 -31.8L126.3 -9.4Q126.3 -6.8 124.85 -5.15Q123.4 -3.5 121.4 -2.3L121.4 -2.3Q118.2 -0.4 113.6 0.6Q109 1.6 103.1 1.6L103.1 1.6Q92.6 1.6 86.25 -2.45Q79.9 -6.5 79.9 -14.7L79.9 -14.7Q79.9 -21.6 84.05 -25.3Q88.2 -29 96.7 -29.9L96.7 -29.9L109.8 -31.3L109.8 -32Q109.8 -34.9 107.25 -36.15Q104.7 -37.4 99.9 -37.4L99.9 -37.4Q96.2 -37.4 92.55 -36.6Q88.9 -35.8 86 -34.6L86 -34.6Q84.7 -35.5 83.8 -37.35Q82.9 -39.2 82.9 -41.2L82.9 -41.2Q82.9 -46 88 -48L88 -48Q90.9 -49.1 94.85 -49.6Q98.8 -50.1 102.3 -50.1";

/** Square side, shared by the i-dot and the stop so they read as a pair. */
const SQUARE = 19.6;
/** The round i-dot this square covers: centre (63, -62.1), radius ~9.3. */
const I_DOT = { x: 63 - SQUARE / 2, y: -62.1 - SQUARE / 2 };
/** The stop, sitting on the baseline ahead of the `c`. */
const STOP = { x: -26, y: -SQUARE };

const VB = { x: -43, y: -76, w: 245, h: 82 };

/**
 * One mark, one size, everywhere — the rule from v4, kept.
 *
 * There is deliberately no `size` prop. That absence is the guard: a call site
 * that wants this bigger fails to compile rather than quietly drifting, which
 * is how the old logo ended up at five different sizes across twenty screens.
 */
const LOGO_HEIGHT = 40;

export function Logo({
  /**
   * For placement on a photograph or an amber panel, where the theme tokens
   * do not apply because the surface underneath is the same in both themes.
   */
  onDark = false,
}: {
  onDark?: boolean;
}) {
  const ink = onDark ? "#f5eedd" : "rgb(var(--logo-ink))";
  const accent = onDark ? "#e8a020" : "rgb(var(--logo-accent))";
  return (
    <svg
      viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
      height={LOGO_HEIGHT}
      width={(LOGO_HEIGHT * VB.w) / VB.h}
      role="img"
      aria-label="Ciao"
      style={{ display: "block", flexShrink: 0 }}
    >
      <g fill={ink}>
        <path d={CIA_PATH} />
        {/* The `o`, as a ring rather than the solid amber sun of v4. Drawn
            with a stroke so the counter stays true at any size. */}
        <circle cx="160.78" cy="-24.25" r="17.88" fill="none" stroke={ink} strokeWidth="11.8" />
        {/* Square i-dot, laid over Baloo's round one. */}
        <rect x={I_DOT.x} y={I_DOT.y} width={SQUARE} height={SQUARE} />
      </g>
      <rect x={STOP.x} y={STOP.y} width={SQUARE} height={SQUARE} fill={accent} />
    </svg>
  );
}
