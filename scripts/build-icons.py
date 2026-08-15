#!/usr/bin/env python3
"""
Regenerate every app icon from the logo component, and check the mark has not
drifted between the three apps.

The icon and the in-app logo are the same mark; the only way to keep them that
way through a redesign is to build one from the other. Run this after any
change to components/logo.tsx:

    python3 scripts/build-icons.py

The marketplace, the partner console and the business console each ship their
own copy of the component — they are separate Next apps and `@ciao/shared` is
consumed by the API too, so it cannot hold JSX. Three copies of a logo is
exactly how a brand ends up with three logos, so this script fails loudly if
they stop being byte-identical rather than waiting for someone to notice a
different mark on partners.ciao.ly.

## v7: the icon is the pin, and only the pin

Until v6 this script fitted the whole horizontal lockup into the square. That
was the right call when the mark *was* the word — there was nothing else to
use. The v7 mark has a symbol, so the icon is the symbol: a 2.25:1 lockup
squeezed into a square leaves a stamp floating in a lot of nothing, and at
48px on a home screen the letters were never legible anyway.

The word is deliberately not here for a second reason. In the component it is
set in Inter, which the page has loaded; a standalone SVG on a home screen has
no such guarantee and would render the wordmark in whatever the launcher
happens to have. Shipping the pin alone means the icons contain no type at all
and cannot be wrong about it.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

CANONICAL = ROOT / "apps/web/src/components/logo.tsx"
COPIES = [
    ROOT / "apps/partner/src/components/logo.tsx",
    ROOT / "apps/console/src/components/logo.tsx",
]
comp = CANONICAL.read_text(encoding="utf-8")
drifted = [p for p in COPIES if p.read_text(encoding="utf-8") != comp]
if drifted:
    for p in drifted:
        print(f"logo drift: {p.relative_to(ROOT)} differs from apps/web", file=sys.stderr)
    print("copy the marketplace component over them and re-run.", file=sys.stderr)
    raise SystemExit(1)


def path_const(name: str) -> str:
    """Pull `export const NAME = "…";` out of the component."""
    m = re.search(rf'export const {name} =\s*"(.+?)";', comp, re.S)
    if not m:
        raise SystemExit(f"build-icons: {name} not found in logo.tsx")
    return m.group(1)


def num_const(name: str) -> float:
    m = re.search(rf"export const {name} = (-?[\d.]+);", comp)
    if not m:
        raise SystemExit(f"build-icons: {name} not found in logo.tsx")
    return float(m.group(1))


def box_const(name: str) -> dict:
    body = re.search(rf"export const {name} = {{(.+?)}};", comp, re.S).group(1)
    return {k: float(re.search(rf"\b{k}:\s*(-?[\d.]+)", body).group(1)) for k in "xywh"}


PIN = path_const("PIN")
CHECK = path_const("CHECK")
CHECK_WIDTH = num_const("CHECK_WIDTH")
VB = box_const("PIN_VB")

NAVY, CREAM, ORANGE, WHITE = "#0d1b2a", "#fdf7ec", "#e8641b", "#ffffff"

# One family, three unmistakable members.
#
# The operator who runs the company plausibly has all three on one phone, and a
# partner and a guest very often will. Two icons differing only in a shade are
# two icons somebody opens the wrong one of at seven in the morning. So the
# ground changes completely between them while the mark does not change shape
# at all.
#
# The business console is the one place the pin may not stay orange: its ground
# IS the orange, and an orange pin on it would be invisible. There the pin goes
# cream and the check is cut back to the ground colour, so the mark reads as
# stencilled out of the accent rather than drawn on top of it.
APPS = {
    "web": (NAVY, ORANGE, WHITE),      # guests — the marketplace
    "partner": (CREAM, ORANGE, WHITE),  # hosts and providers — reversed ground
    "console": (ORANGE, CREAM, ORANGE),  # us — the ground is the accent
}


def icon(size: int, ground: str, pin: str, check: str, maskable: bool = False) -> str:
    """
    Fit the pin to height and centre it horizontally.

    The pin is taller than it is wide (72x88), which is the opposite of the
    lockup this script used to place, so the fit is by height now. Maskable
    icons take a much larger pad and a full-bleed ground: Android crops them to
    whatever shape the launcher fancies, and only the middle 80% is guaranteed
    to survive.

    The optical centre of a teardrop sits above its geometric centre — the bulb
    carries the weight and the tip is empty space — so the mark is nudged up by
    a small fraction of its height. Without it the pin looks like it is sliding
    out of the bottom of the tile.
    """
    pad = size * (0.30 if maskable else 0.20)
    scale = (size - 2 * pad) / VB["h"]
    tx = (size - VB["w"] * scale) / 2 - VB["x"] * scale
    ty = pad - VB["y"] * scale - VB["h"] * scale * 0.04
    ground_el = (
        f'<rect width="{size}" height="{size}" fill="{ground}"/>'
        if maskable
        else f'<rect width="{size}" height="{size}" rx="{round(size * 0.22)}" fill="{ground}"/>'
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">
  <!-- Generated by scripts/build-icons.py from components/logo.tsx. Do not hand-edit. -->
  {ground_el}
  <g transform="translate({tx:.2f} {ty:.2f}) scale({scale:.4f})">
    <path d="{PIN}" fill="{pin}"/>
    <path d="{CHECK}" fill="none" stroke="{check}" stroke-width="{CHECK_WIDTH:g}" stroke-linecap="butt" stroke-linejoin="miter"/>
  </g>
</svg>
"""


for app, (ground, pin, check) in APPS.items():
    out = ROOT / f"apps/{app}/public"
    if not out.is_dir():
        print(f"skipping {app}: no public/ directory", file=sys.stderr)
        continue
    for s in (192, 512):
        (out / f"icon-{s}.svg").write_text(icon(s, ground, pin, check), encoding="utf-8")
    (out / "icon-maskable.svg").write_text(
        icon(512, ground, pin, check, maskable=True), encoding="utf-8"
    )
    print(f"{app}: icon-192.svg, icon-512.svg, icon-maskable.svg")
