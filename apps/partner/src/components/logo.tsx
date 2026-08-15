/**
 * The logo — design v7, August 2026: the pin.
 *
 * Founder direction, replacing the drawn lowercase `ciao` wordmark of v6
 * entirely. There is one logo in this app and this is it.
 *
 * ## What the mark is
 *
 * An orange teardrop pin with a white checkmark cut into it, and CIAO set in
 * capitals beside it. It says the two things the business is: a place, and a
 * place someone has actually been to and checked. The old mark's joke — a
 * square "stop" ahead of the word, reading as `.ciao` — is gone with it; a
 * domain pun does not survive the company having a symbol.
 *
 * ## The pin is drawn, the word is set — and that difference matters
 *
 * The pin below is geometry, not a trace. Its outline is a circle of radius R
 * centred on the origin with a tip at distance T, joined by the two lines that
 * are actually tangent to that circle — so the silhouette is exact at any size
 * and has no hand-fitted curve to go soft when someone scales it. The numbers
 * are derived in `PIN` rather than pasted, which is why they carry decimals.
 *
 * The word is a different matter, and honesty about it is the point:
 *
 *   THIS IS INTER AT 800, NOT THE DESIGNER'S TYPE.
 *
 * v5 of the old mark was rebuilt by setting `ciao` in a font that looked close
 * in a screenshot, and every detail that mattered was wrong. That warning still
 * stands and this file is not exempt from it — the difference is that this
 * approximation is *declared* instead of being mistaken for the real artwork.
 * When `ciao-logo-v7.svg` exists, replace the `<span>` below with its paths and
 * delete this paragraph. Nothing else has to change.
 *
 * ## Rules carried over from v6, because they were right
 *
 *  - **The pin stays on the left in both languages.** The wrapper is forced to
 *    `ltr`. A logo is a picture, not a sentence; mirroring it in Arabic would
 *    make the app look like two companies to anyone who uses the toggle.
 *  - **One size, everywhere.** There is deliberately no `size` prop. That
 *    absence is the guard: a call site that wants this bigger fails to compile
 *    rather than drifting quietly, which is how the logo once ended up at five
 *    sizes across twenty screens.
 *  - **The pin never inverts.** On a dark ground the lettering goes cream and
 *    the pin stays orange — a solid shape carries its own contrast, and an
 *    inverted pin is not a colourway in the logo pack.
 */

/* ------------------------------------------------------------------ the pin
 * Circle of radius R at (R, R); tip directly below at distance T from the
 * centre. The tangent points fall at angle α from the centre→tip line, where
 * cos α = R / T — so the straight edges meet the bulb without a crease, which
 * is the whole difference between a pin and a raindrop.
 *
 * Kept as literals rather than computed at render: this file is parsed by
 * `scripts/build-icons.py` to generate every app icon, and a build script
 * should not have to evaluate TypeScript to find out what shape the logo is.
 *   R = 36, T = 52  ->  α = 46.186°, tangents at (61.98, 60.92) / (10.02, 60.92)
 */
export const PIN = "M36 88L61.98 60.92A36 36 0 1 0 10.02 60.92Z";

/**
 * The check, as a stroked polyline rather than a filled outline.
 *
 * A stroke keeps the two arms exactly equal in weight at every size; an
 * outline traced by hand does not, and at 24px in a header a check whose arms
 * differ by half a pixel reads as a smudge. Butt caps and a mitred elbow give
 * the angular terminals the artwork has — round caps would make it a tick in a
 * checkbox rather than part of a mark.
 */
export const CHECK = "M17 35L30 48L57 20";
export const CHECK_WIDTH = 11;

/** The pin's own box. No padding baked in, so callers can space it. */
export const PIN_VB = { x: 0, y: 0, w: 72, h: 88 };

/** Height of the pin in a header. The word is sized from it, never separately. */
const LOGO_HEIGHT = 36;
/* Measured off the artwork: cap height is 45% of the pin, and Inter's caps are
 * 0.727 of its em, so the em that produces those caps is 0.45/0.727 of the pin. */
const WORD_SIZE = Math.round(LOGO_HEIGHT * (0.45 / 0.727));
const GAP = Math.round(LOGO_HEIGHT * 0.28);

export function Logo({
  /**
   * For placement on a photograph or a coloured panel, where the theme tokens
   * do not apply because the surface underneath is the same in both themes.
   */
  onDark = false,
}: {
  onDark?: boolean;
}) {
  const ink = onDark ? "#f5eedd" : "rgb(var(--logo-ink))";
  return (
    <span
      role="img"
      aria-label="Ciao"
      style={{
        // `ltr` so the pin leads in Arabic too — see the note above.
        direction: "ltr",
        display: "inline-flex",
        alignItems: "center",
        gap: `${GAP}px`,
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      <svg
        viewBox={`${PIN_VB.x} ${PIN_VB.y} ${PIN_VB.w} ${PIN_VB.h}`}
        height={LOGO_HEIGHT}
        width={(LOGO_HEIGHT * PIN_VB.w) / PIN_VB.h}
        aria-hidden
        style={{ display: "block", flexShrink: 0 }}
      >
        {/* The pin keeps its colour on every ground; only the word inverts. */}
        <path d={PIN} fill="rgb(var(--logo-accent))" />
        <path
          d={CHECK}
          fill="none"
          stroke="#ffffff"
          strokeWidth={CHECK_WIDTH}
          strokeLinecap="butt"
          strokeLinejoin="miter"
        />
      </svg>
      <span
        style={{
          color: ink,
          fontFamily: "var(--font-inter), Inter, system-ui, -apple-system, sans-serif",
          fontWeight: 800,
          fontSize: `${WORD_SIZE}px`,
          letterSpacing: "0.005em",
          // The word is four capitals; nothing here should ever be translated,
          // hyphenated or wrapped.
          whiteSpace: "nowrap",
        }}
      >
        CIAO
      </span>
    </span>
  );
}
