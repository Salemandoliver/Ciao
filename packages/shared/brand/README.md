# Brand assets

The mark is **design v7, August 2026**: an orange teardrop pin with a white
checkmark, and CIAO in capitals beside it. It replaced the drawn lowercase
`ciao` wordmark outright — there is one logo in this product and this is it.

`ciao-pin.svg` is the symbol on its own. The React component in each app
(`src/components/logo.tsx`) carries the same two paths inline so the logo never
depends on a network fetch — a header whose logo arrives late is a header that
jumps. `scripts/build-icons.py` reads those same constants to generate all nine
app icons, so the symbol exists once and is derived everywhere else.

## The pin is exact. The word is not.

The pin is **geometry, not a trace**: a circle of radius 36 centred at (36, 36)
with its tip at (36, 88), closed by the two lines that are genuinely tangent to
that circle. It is correct at any size and there is nothing to re-trace.

The word is a different matter and the honesty matters more than the
convenience:

> **CIAO is currently set in Inter at weight 800. It is not the designer's
> type.** It was matched by eye from a PNG, because a PNG is what existed.

This repository has been here before. The v5 mark was rebuilt by setting `ciao`
in a font that passed in a screenshot and was wrong in every detail that
mattered, and the note in `logo.tsx` still carries that warning. The difference
now is that the approximation is declared rather than mistaken for artwork.

**To fix it properly:** drop the real vector in here as `ciao-logo-v7.svg`
(`.ai`, `.svg`, or a PDF/EPS with actual paths rather than an embedded raster),
and replace the `<span>CIAO</span>` in `logo.tsx` with its paths. Nothing else
has to change — not the icons, which contain no type at all, and not the
tokens.

## Colours

| Role | Value | Notes |
|---|---|---|
| Pin | `#E8641B` | `--logo-accent`; **never flips** — it is a solid shape and carries its own contrast |
| Check | `#FFFFFF` | except on the business console, where the ground is the orange and the check is cut back to it |
| Wordmark ink | `#0D1B2A` | `--logo-ink`; goes `#F5EEDD` in dark |

`--logo-accent` is deliberately a separate token from `--amber`, even though
both are the same orange today. They answer to different owners: `--amber` is a
UI decision anyone may retune for contrast, and this one is the logo, which
changes only when the logo does.

## Rules

- The pin leads in both languages. The component forces `ltr`; a logo is a
  picture, not a sentence, and mirroring it would make the app look like two
  companies to anyone using the language toggle.
- One size. `logo.tsx` has no `size` prop on purpose — a call site that wants
  it bigger fails to compile rather than drifting quietly.
- Never re-draw the mark to match a screenshot. Ask for the vector.
