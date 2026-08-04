# Brand assets

`ciao-wordmark.svg` is the mark the apps render, traced from the
founder-supplied `ciao_logo1.eps` (4 August 2026). The React component in each
app (`src/components/logo.tsx`) carries the same two paths inline so the logo
never depends on a network fetch — a header whose logo arrives late is a header
that jumps.

## The source is a bitmap, not vector

The supplied EPS was produced by ImageMagick from a PNG intermediate. Inside a
2000×977 pt canvas the artwork occupies roughly 317×172 px, and the wordmark
itself is **241×108 px**. That is the whole of the resolution that exists.

The paths here were recovered by estimating each pixel's coverage of navy and
amber against the cream ground, supersampling 8×, smoothing, and tracing. At
the sizes the apps actually draw the mark (34 px tall, so ~100 px on a 3×
phone) the result is indistinguishable from the original. Enlarged past a few
hundred pixels the contours show a faint organic wobble that is not in the
designer's original — it is the pixel grid, amplified.

So: **for anything large — signage, print, a hero, an OG image, a vehicle —
get the real vector from whoever drew it** (`.ai`, `.svg`, `.pdf`, or an EPS
with actual paths rather than an embedded raster). Drop it in here and retrace
is unnecessary; the paths can be lifted straight out.

## Colours

| Role | Value | Notes |
|---|---|---|
| Wordmark ink | `#0D1B2A` | `--logo-ink`; flips to `#F3F2EC` in dark |
| Leading dot | `#E8A020` | `--logo-dot`; never flips |
| Ground | `#F3F2EC` | the cream the artwork was supplied on |

The wordmark navy is considerably darker than the app's `sea` (`#1B4F72`).
That gap is the artwork's and is kept deliberately — see the note in
`logo.tsx`. Whether the palette should follow the logo is a brand decision to
take once, everywhere.
