/**
 * The wordmark — design v6, August 2026.
 *
 * This is Salem's own artwork, not a reconstruction of it.
 *
 * v5 rebuilt the mark by setting `ciao` in Baloo Bhaijaan 2 ExtraBold and
 * drawing the `o` as a stroked circle, which was close enough to pass in a
 * screenshot and wrong in every detail that matters: the real mark is drawn,
 * not typeset. Its letters are kerned until they collide — the `c` and the `i`
 * fuse into a single `d`-like shape, the `a` leans into the `o` — and that
 * collision *is* the design. A font at tight tracking does not produce it.
 * The paths below come from `ciao-logo-light.eps`, so what ships is the file
 * the designer signed off rather than something that resembles it.
 *
 * Three things carried over from v5 because they were right:
 *
 *  - **The stop is the brand.** One square of accent colour ahead of the word.
 *    It reads as `.ciao`, which given the domain is a joke worth keeping.
 *  - **The stop stays on the left in both languages.** A logo is a picture,
 *    not a sentence; mirroring it in Arabic would make the app look like two
 *    different companies to anyone who uses the language toggle.
 *  - **One size, everywhere.** There is deliberately no `size` prop. That
 *    absence is the guard: a call site that wants this bigger fails to compile
 *    rather than drifting quietly, which is how the old logo ended up at five
 *    different sizes across twenty screens.
 *
 * What v5 got backwards, and this fixes: on a dark ground the lettering is
 * **cream and the stop is amber** — the same way round as on a light ground.
 * v5 inverted them, so the dark theme showed an amber word with a cream stop,
 * which is not a colourway in the logo pack at all.
 */

/** `ciao`, drawn. Counters are cut by winding, so this is one filled path. */
const LETTERS =
  "M93.5 68.898 C86.398 70.898 81.199 74.199 77 79.5 C66 93.398 65.898 138.602 76.898 153.602 C84.297 163.602 103.5 168.203 124.5 164.801 C128.398 164.199 139.898 163.801 150.301 163.902 L169 164.203 L169 151.504 L170.898 154.605 C177.898 166.004 197.699 169.207 218.598 162.207 L227.398 159.207 L231.5 161.809 C235.102 164.207 236.699 164.508 246.801 164.809 L258 165.207 L258 158.605 C258 155.004 258.199 152.004 258.5 152.004 C258.801 152.004 260.602 153.504 262.5 155.402 C277.5 170.402 318.699 169.402 331.301 153.703 C336 148.004 337.699 144.305 339.602 136.305 C341.5 128.105 341.801 107.105 340.203 98.605 C337.703 85.906 331.504 76.805 322.102 72.105 C314.703 68.406 307.902 67.004 296.602 67.004 C272.102 67.004 259.402 74.605 253.703 92.703 L251.305 100.203 L250.605 94.305 C249.105 80.703 243.707 73.105 232.906 69.406 C222.906 65.906 187.605 67.207 172.805 71.605 C171.504 72.004 171.004 73.207 171.004 75.906 C171.004 81.906 172.203 92.008 172.902 91.605 C173.203 91.406 181.902 90.707 192.203 90.004 C218.203 88.504 222.004 89.805 222.004 100.203 C222.004 105.703 223.203 105.305 202.504 107.004 C195.305 107.605 187.703 108.504 185.504 109.105 C179.902 110.605 173.305 114.605 171.203 117.805 C169.602 120.305 169.504 119.605 169.004 95.004 L168.504 69.504 L152.504 69.402 C143.703 69.301 133.004 68.703 128.703 68.102 C117.102 66.5 100.602 66.801 93.504 68.902 Z M304.602 91.598 C309.301 93.797 311.703 99.496 312.5 109.996 C313.301 119.695 311.699 133.195 309.5 136.695 C306.699 140.895 303.199 142.395 296 142.395 C287.699 142.395 284.602 140.594 281.699 134.195 C279.898 130.297 279.598 127.496 279.5 117.496 C279.5 110.895 279.898 103.797 280.301 101.797 C281.199 97.598 285.199 92.297 288.402 90.996 C291.902 89.598 301.004 89.895 304.602 91.598 Z M136.301 92.598 L140 93.297 L140 139.695 L130.801 140.395 C109.102 141.895 103.902 140.496 99.902 132.395 C97.902 128.094 97.602 126.094 97.602 115.996 C97.703 102.695 99.203 98.098 104.902 94.297 C108.004 92.195 109.402 91.996 120.402 91.996 C127.102 91.996 134.203 92.297 136.301 92.598 Z M222 131.898 L222 141.797 L215.5 143.398 C208.898 145.098 202.398 145.5 199.5 144.398 C197.102 143.398 195 138.598 195 134 C195 127.801 198.801 124.398 206.602 123.5 C209.801 123.199 213.402 122.801 214.5 122.602 C215.602 122.402 217.699 122.203 219.301 122.102 L222 122 Z M254.301 143.898 C254.199 144.098 253.402 143.699 252.5 143 C251.5 142.199 251 140.102 251.102 136.602 L251.203 131.5 L252.902 137.5 C253.801 140.801 254.504 143.699 254.301 143.898 Z M254.301 143.898";

/*
 * The two squares, redrawn as rectangles.
 *
 * In the EPS these are traced outlines with corners that wander by a few
 * hundredths of a unit — invisible at poster size, and at 24px in a header the
 * difference between a crisp square and a slightly soft one is the difference
 * between a logo and a smudge. Their measured boxes, drawn true.
 */
const I_DOT = { x: 140, y: 32.2, w: 29.1, h: 22.8 };
const STOP = { x: 40.16, y: 134.13, w: 29.94, h: 29.94 };

/** The artwork's own bounding box: no padding baked in, so callers can space it. */
const VB = { x: 40.16, y: 32.18, w: 301.08, h: 133.91 };

/**
 * Chosen so the mark's cap height matches what v4 and v5 occupied in the
 * header. The viewBox is a tight crop, so this number is the height of the
 * lettering itself rather than of a box containing it.
 */
const LOGO_HEIGHT = 36;

export function Logo({
  /**
   * For placement on a photograph or an amber panel, where the theme tokens do
   * not apply because the surface underneath is the same in both themes.
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
        <path d={LETTERS} />
        <rect x={I_DOT.x} y={I_DOT.y} width={I_DOT.w} height={I_DOT.h} />
      </g>
      <rect x={STOP.x} y={STOP.y} width={STOP.w} height={STOP.h} fill={accent} />
    </svg>
  );
}
