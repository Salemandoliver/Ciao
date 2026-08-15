---
name: ciao-brand
description: Enforces the Ciao booking app brand rules — logo, colours, typography, spacing, cards, responsive layout, Mapbox map styling, and RTL/Arabic readiness. Use whenever creating or editing ANY Ciao user interface, in Figma or in code — screens, components, pages, styles, Tailwind classes, pins, badges, or map rendering anywhere under apps/web, apps/console, or apps/partner.
---

# Ciao Brand Guidelines

Follow these rules whenever creating or editing designs for the Ciao booking app. Ciao is a Libyan booking platform for chalets, estirahas, and wedding halls, with a premium, photography-first aesthetic.

## Logo

- **Never recreate, redraw, or modify the Ciao logo.** Always use the existing logo components in the file.
- **Two variants exist:**
  - **Ciao Logo** — for light backgrounds. Orange pin + dark "CIAO" wordmark (original image).
  - **Ciao Logo Dark** — for dark backgrounds and over photos. Orange pin + white "CIAO" wordmark.
- Place as component instances — never as shapes, text, or a re-illustration.
- Use the correct variant based on background: light bg → Ciao Logo, dark bg → Ciao Logo Dark.
- Minimum clear space: the height of the pin icon on all sides.

## Color Palette

### Light Mode
- **Background primary:** `#FDF7EC` (warm cream)
- **Surface/cards:** `#FFFFFF`
- **Text primary:** `#0D1B2A` (dark navy)
- **Text secondary:** `#7A6A52` (warm muted)
- **Text body:** `#5A4832` (warm brown)
- **Brand orange (CTAs/accents):** `#E8641B`
- **Accent link:** `#9A5F0A` (warm amber)
- **Borders:** `#DCD2C3`

### Dark Mode
- **Background primary:** `#121218`
- **Surface/cards:** `#1C1C24`
- **Elevated surfaces:** `#2C2C34`
- **Text primary:** `#F5F2EB` (warm off-white)
- **Text secondary:** `#AAA091`
- **Brand orange:** `#E8641B` (same as light)
- **Accent link:** `#DCA55A`
- **Borders:** `#373741`

Use the "Ciao Theme" variable collection in the file — it has Light and Dark modes with all semantic tokens.

## Typography

- **Font family:** Inter — no other fonts, no exceptions.
- **Headings:** Inter Bold
- **Body text:** Inter Regular
- **Key sizes (mobile):** 24px (hero), 19px (section headings), 15px (subheads), 13px (body), 12px (captions/labels), 11px (badges)
- **Key sizes (desktop):** 40px (hero), 28px (section headings), 18px (subheads), 16px (body), 14px (captions/labels), 12px (badges)
- **No decorative or display fonts.** The photography carries the visual weight, not the type.

## Design Principles

### Photography-First / Image-Led
- Hero photos should occupy at least 60% of the screen on landing/discovery screens.
- Listing cards should dedicate 70% of their area to the venue photo.
- Use full-bleed images wherever possible — never small thumbnails as the primary visual.
- All venue photos are professionally shot — design the UI to showcase them.
- Use frosted glass / semi-transparent overlays for UI elements over photos.

### Ciao Verified Badge
- Always display "Ciao Verified" on verified listings.
- Style: pill shape, green or brand-orange background, white checkmark + text.
- Position: overlaid on the venue photo, top-left corner.

### Cards
- Corner radius: 20px for cards, 999px for pills/badges.
- Subtle shadow on light mode, subtle border on dark mode.
- Card body padding: 12-14px (mobile), 16-20px (desktop).

## Responsive Layout

### Mobile (390px)
- Single-column layout
- Bottom navigation bar
- Full-width cards
- Hero occupies 60%+ of viewport height
- Bottom card strip on map screen

### Desktop (1440px)
- Top navigation bar with logo left, search center, user avatar right
- Multi-column grids: 3-column for listing cards, 2-column split for detail page
- Sidebar layout for map screen (map left, venue list right)
- Full footer with site links organized in columns
- Frosted-glass centered login card over full-bleed background

## RTL / Arabic Readiness

- Keep layouts **symmetric and centered** where possible.
- Avoid hard-coded left-alignment — use flexible/centered layouts.
- Icons and navigation should work in both LTR and RTL directions.
- Avoid directional icons (arrows) that don't flip naturally.
- Text containers should support both Latin and Arabic scripts.
- Test with longer Arabic text — it often runs wider than English.

## Mapbox Map Integration

### Map Pins — Ciao Brand Pins
- Shape: Orange (#E8641B) teardrop pin with a white checkmark inside (matching the Ciao logo pin icon)
- Price label: White text on orange pill, showing price in LYD (e.g. "1,200 LYD")
- Dark mode pins get a subtle orange glow halo
- Pin tap syncs with card/list; card/list tap highlights pin

### Light Mode Map
- Base: `mapbox://styles/mapbox/light-v11` with warm overrides
- Water: `#C4B9A0`, Land: `#F5EDD8`, Roads: `#D4C9B5` (warm orange-toned)
- Labels: `#0D1B2A`
- City label "TRIPOLI" in dark navy

### Dark Mode Map
- Base: `mapbox://styles/mapbox/dark-v11` with custom overrides
- Land: `#121218`, Water: `#0A0E1A`
- **Orange road glow effect:** `line-color: #E8641B` at 30-50% opacity, `line-blur: 2-4px`
- Labels: `#F5F2EB`
- City label "TRIPOLI" in warm white

### Map Interaction
- Default zoom: 11-13, centered on Tripoli coast
- Mobile: bottom card strip, horizontally scrollable venue previews (280px wide, snap scroll)
- Desktop: right sidebar with scrollable venue list and filter chips

## Spacing System

Use the "Ciao Spacing" variable collection:
- xs: 4px, sm: 8px, md: 12px, lg: 16px, xl: 24px, 2xl: 32px
- Radius: sm 8px, md 12px, lg 16px, xl 20px, full 999px

## Component Library

Reuse these local components (do not recreate):
- **Ciao Logo** — the master logo for light backgrounds, never modify
- **Ciao Logo Dark** — white wordmark variant for dark backgrounds
- **Verified Badge** — "Ciao verified" pill
- **Listing Card** — photo + details card
- **Trust Card** — trust/safety messaging card
- **Section Header** — title + "See all" link
- **Service Tile** — category icon tile

## Screen Inventory

The file contains these canonical screens:

### Mobile (390px) — Light and Dark Mode
1. **Login** — full-bleed photo bg, frosted form, social login
2. **Home** — image-led hero, search overlay, category photo tiles
3. **Search Results** — large photo cards, filter chips, Ciao Verified badges
4. **Listing Detail** — photo gallery, specs, sticky Book Now CTA
5. **Map Search** — Mapbox map with Ciao brand pins (orange teardrop + checkmark), price labels in LYD
6. **Photo Gallery** — immersive full-screen viewer, thumbnail strip

### Desktop (1440px) — Light and Dark Mode
1. **Login** — full-bleed dual-photo bg, centered frosted-glass login card (dark card on dark mode), social login
2. **Home** — top nav bar, full-width hero with search overlay, 3-column category tiles, 3-column featured venues grid, full footer
3. **Search Results** — top nav with search summary, filter chips, 3-column × 2-row listing card grid, Map view toggle, footer
4. **Listing Detail** — top nav, split layout (60% photo gallery with thumbnail grid / 40% venue info panel with Book Now CTA)
5. **Map Search** — top nav, Mapbox map with Ciao brand pins + price labels, right sidebar with filter chips and scrollable venue cards
6. **Photo Gallery** — immersive dark lightbox, large centered photo, 8-thumbnail strip, navigation arrows, photo counter
