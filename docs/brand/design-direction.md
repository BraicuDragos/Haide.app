# Haide — Design & Motion Direction (epic "E-DM")

> Instructions for the Orchestrator: this file is the brief for a new epic "E-DM", inserted right
> after E1 and before E2. Do NOT touch the E1 branch. Start only after the E1 PR is merged: pull
> main, then create branch `feat/design-motion`. One epic, one PR. Record decisions as new ADRs
> (0016+). Pass this file's path to brand-designer, ux-designer, frontend-dev and qa-reviewer.
> Don't ask the owner about it; follow it. This file is new and untracked: include it in the E-DM PR.
> Also fix the two outdated file paths in `.claude/agents/frontend-dev.md`.

## Context
- Product: Haide, the Sibiu carpooling PWA. The brand is already decided (name, logo,
  dusk-indigo + saffron). Do NOT rename or replace it. EVOLVE it into a distinctive, futuristic,
  calm look.
- First read: docs/brand/brand-guide.md, assets/brand/design-tokens.json,
  docs/ux/prototype/index.html, docs/ux/copy.md, docs/ux/accessibility.md, ADRs 0001-0015.

## Goal
Make Haide look and feel like a calm, high-tech, futuristic product that clearly stands out from
typical ride apps (flat white cards, generic maps, stock illustrations). Simple, not cluttered,
genuinely beautiful, memorable within 10 seconds of use.

## Concept: "quiet futurism" built on the existing palette
- "Haide" means "let's go": the motion language is about departure and momentum.
- Dark-first, with a refined light theme. Deep dusk-indigo base (tinted, never pure black).
  Saffron is the single luminous signature: routes, key actions, the price. At most one secondary
  accent, taken from the existing palette.
- The map is the hero. Routes are glowing saffron lines with a travelling pulse of light over a
  low-contrast, minimal map. It must feel alive.
- Depth with restraint: soft translucent layers, subtle blur, fine grain, gentle glows. No heavy
  glassmorphism, no neon overload, no rainbow gradients, no purple-on-black cliche.
- Typography is a design element: one characterful variable font for headings, one highly legible
  font for UI text, large type for key moments (price, time, seats). Generous whitespace.
- One consistent icon set. No emoji as icons. No stock illustrations.
- One primary action per screen. If a screen feels busy, remove things.

## Signature motion (6-8 moments, specified in docs/ux/motion.md)
For each: purpose, duration, easing, reduced-motion fallback.
1. Route draw-in: a ride's path draws itself with a travelling light pulse.
2. Match moment: a passenger's request and a fitting ride visually "snap" together.
3. Seat selection: tactile, spring-based seats with a magnetic feel.
4. Shared-element transitions list -> ride details -> booking (View Transitions API or equivalent).
5. Price reveal: the cost-share price animates in so the tiny price feels good.
6. Live trip state: a calm ambient animation of the car approaching, no clutter.
7. The "Haide!" moment: the main Publish / Join action launches with a short, satisfying animation.
8. Loading and empty states are small branded animations, not spinners.

Rules: purposeful, never decorative noise; 150-400 ms for most transitions; one shared set of
easing curves and durations defined as motion tokens in design-tokens.json; 60 fps on a mid-range
phone.

## Hard constraints
- Mobile-first (360-430 px), then tablet/desktop. Stay an installable PWA.
- Performance: initial JS is about 148 KB gzip against a 200 KB budget, so motion code may add at
  most about 25 KB gzip. Prefer CSS, Web Animations API and View Transitions. Add a JS animation
  library only if justified in an ADR. WebGL only for one hero moment and only if it fits the
  budget. Animate transform and opacity only.
- Map: real tiles are not verified yet. The route glow must be an SVG/canvas overlay that works
  with the existing map component and degrades gracefully on a plain background.
- Accessibility: keep the Lighthouse accessibility score at 100, WCAG 2.1 AA contrast, full
  prefers-reduced-motion support (every animation needs a calm still fallback), visible focus,
  touch targets of at least 44 px.
- Fonts: free, with full Latin Extended support so Romanian place names such as Șelimbăr render
  correctly (ș, ț, ă, â, î).
- CI stays green. Existing unit and Playwright tests keep passing. Deploy stays locked
  (DEPLOY_ENABLED unchanged).
- No dark patterns, no autoplaying sound. Haptics only where supported and optional.

## Process
1. brand-designer (frontend-design skill): explore 3 clearly different directions for this
   concept, pick the strongest yourself, record it in an ADR. Produce
   docs/brand/preview-motion.html with working animated demos of at least 3 signature moments.
   GitHub does not render HTML, so ALSO commit short recordings (GIF or MP4, max 5 MB each) in
   docs/screenshots/design-motion/ and embed them in the PR description so the owner can watch
   them on a phone.
2. ux-designer: update the clickable prototype with the same motion language, write
   docs/ux/motion.md, update copy.md. Run design:design-critique and design:accessibility-review
   and fix the findings.
3. frontend-dev: implement from tokens only (colors, spacing, easing, durations, shadows), apply
   to the existing screens (app shell, 4 tabs, place picker, and the E1 screens). Verify every
   screen with Playwright at a mobile viewport and update screenshots.
4. qa-reviewer: check reduced-motion behavior, contrast, bundle budget, accessibility 100,
   animation performance (no layout thrashing).

## Deliverables
docs/brand/design-direction.md (this file, kept current), docs/brand/preview-motion.html,
docs/ux/motion.md, updated assets/brand/design-tokens.json with motion tokens, the implemented
UI in apps/web/src, recordings in docs/screenshots/design-motion/.

## Make it permanent
- Add a short section "Design direction" to CLAUDE.md (max 5 lines): all brand, UX and UI work
  must follow docs/brand/design-direction.md, and qa-reviewer must check reduced-motion, contrast
  and the bundle budget against it.
- In .claude/agents/brand-designer.md, ux-designer.md, frontend-dev.md and qa-reviewer.md add one
  first line: "Read docs/brand/design-direction.md before any design or UI work."
- Include these changes in the E-DM PR. Do not paste this whole brief into CLAUDE.md.

## Quality bar
If a screenshot of any screen could belong to any other app, redesign it.


---

# Addendum: the chosen design system (brand-designer, E-DM step 1)

> Decisions: ADR [0016](../decisions/0016-visual-direction-quiet-futurism-headlight.md) (direction), [0017](../decisions/0017-typography-sora-and-figtree.md) (type), [0018](../decisions/0018-icon-set-lucide-vendored.md) (icons), [0019](../decisions/0019-motion-no-js-animation-library.md) (motion). Tokens: [design-tokens.json](design-tokens.json) v1.1.0 (the only tokens file). Live demos: [preview-motion.html](preview-motion.html). Recordings: `docs/screenshots/design-motion/`. Screenshots of the built screens (`docs/screenshots/E0`, `E1`) are `.jpg` since E-DM (dark and light variants); the old `.png` names no longer exist.

## 1. The direction in one sentence

**Headlight:** a calm night city where the route is the only light. Saffron (the brand dot) is the headlight: the route, the price and the primary action. Everything else is quiet indigo.

Three directions were explored (Headlight, Instrument, Soft Matter). Headlight won because it makes the existing brand dot the hero, depends on cheap transform and opacity motion, and works with real tiles and on a plain background. Details in ADR 0016.

## 2. Palette and roles (dark first)

| Layer or role | Dark | Light | Use |
|---|---|---|---|
| `bg-deep` / `map-bg` | #0E0D26 | #EFEFF6 | Map and deepest layer |
| `bg` | #12112A | #F7F7FB | Page |
| `surface` | #1C1B3D | #FFFFFF | Cards, sheets |
| `surface-subtle` | #26254D | #EFEFF6 | Raised, tonal, seat tokens |
| `surface-glass` | rgba(28,27,61,.78) | rgba(255,255,255,.82) | The one blurred layer (sheet or bar) |
| `text` / `text-muted` | #F2F1FB / #B4B3D0 | #1B1A2E / #55556F | Text |
| `action` (hover, pressed) | #FFC21A (#FFD04F, #F2AC00), ink label | #5043C6 (#4639B0, #382E92), white label | Primary action, one per screen |
| `outline` / `on-outline` | #A9A2E8 / #C9C5F2 | #5043C6 / #382E92 | Secondary buttons |
| `price` | #FFC21A | #1B1A2E | Price numerals |
| `savings` (the one secondary accent) | #5BC1C6 | #0B6F78 | Money saved, confirmation tick |
| `route`, `route-core`, `route-glow` | #FFC21A, #FFE08A, rgba(255,194,26,.30) | #382E92, #5043C6, rgba(80,67,198,.22) | Route layers |
| `pulse`, `pulse-ring` | #FFF8E1, rgba(255,194,26,.55) | #FFC21A, #382E92 | Travelling light and pickup dot ring |
| `map-water`, `map-park`, `map-road`, `map-building`, `map-label` | #0F2A3C, #12203A, #262552, #191840, #9F9DC8 | #C5EBEC, #E6F6F6, #FFFFFF, #E0E0EC, #55556F | Minimal map style (replaces ramp colours in `RouteMap.tsx`) |

New ramps: `night` (950 #0B0A1E, 900, 800, 700, 600, 500) and `mist` (50, 200) name the dark values. Brand rules that change from the brand guide: saffron may be **text or stroke on night surfaces only**; the dark theme is the default for everyone with no stored choice, even when the OS prefers light (Settings has Auto, Dark, Light); dark `action` is saffron with an ink label. Saffron on light surfaces stays a fill with ink text, or a dot with an indigo ring.

## 3. Depth, glow, grain

| Token | Value | Rule |
|---|---|---|
| `depth.blur.sm / md / lg` | 8 / 16 / 28 px | `backdrop-filter` on at most two layers per screen. Fallback to opaque `surface` with `@supports not` and `prefers-reduced-transparency` |
| `depth.grain` | tile 160 px, opacity .05 | One static tile on the page and map frame. Never animated |
| `shadow.glass`, `edge` | inset highlight plus deep soft shadow | Sheets and cards in dark. Light uses `card` |
| `shadow.glow-cta`, `glow-soft` | saffron, 40% and 28% | Primary action and selected seats, dark only, static (never animate box-shadow; animate a ring element's opacity and transform) |
| Route strokes | aura 20 px, halo 9 px, core 3 px (+ 1.2 px spark) | Stacked strokes give the glow. No blur filter |
| Radius | adds `xl` 28 px | Sheets and hero cards. Primary action is a full pill, 56 px high (`sizing.ctaHeight`) |

## 4. Type

Sora (headings, numerals) and Figtree (UI). Scale: numeral 56/56 w300 tabular, display 36/42, h1 28/34, h2 22/28, h3 18/24, price 36/40 w400 tabular, numeralSm 24/28, then body 16, label 16 w600, bodySm 14, caption 12. Large light numerals carry the key moments: price, time, seats. No all caps, no eyebrow labels, no monospace. Test string: `Ștefan Țepeș, Șelimbăr, Păltiniș, Bâlea, Cisnădie` (glyphs checked in both Sora subsets).

## 5. Signature motion

Shared tokens (`motion.duration`, `motion.easing`, `motion.distance`, `motion.stagger`, `motion.scale`):

| Duration | ms | Easing | Character |
|---|---|---|---|
| instant, fast, base | 80, 120, 200 | standard | Default UI change |
| moderate, slow | 300, 400 | enter, exit | Decelerate in, accelerate out |
| reveal, draw, launch | 700, 900, 900 | momentum | Gathers speed, glides in (route draw) |
| pulse, ambient | 2400, 6000 | departure | Accelerates away (launch) |
| | | spring, magnet | `linear()` springs, 8% and 20% overshoot, with cubic-bezier fallbacks |

| # | Moment | Purpose | Time and easing | Reduced-motion fallback | Demo |
|---|---|---|---|---|---|
| 1 | Route draw-in | Show the ride's path and make the map feel alive | 900 ms draw (momentum) with the light leading the drawing, then a 2.4 s travelling light (linear, sine-eased along the path). Aura breathes over 4.8 s | Route fully drawn, one still light mid-route, no loop | Built |
| 2 | Match | A request and a fitting ride snap together | 520 ms magnet snap, 240 ms glow of the shared stretch, ring ripples at both points, chip springs in | Already aligned, shared stretch lit, chip visible | Built |
| 3 | Seat selection | Tactile choice | 80 ms press, 520 ms magnet spring, 40 ms stagger, digits roll, mouse lean up to 7 px | Seats fill instantly, no lean, numbers swap | Built |
| 4 | Shared element: list, details, booking | Keep orientation | 300 ms standard via View Transitions, `view-transition-name` on route line and price | Instant navigation | Spec only (ux-designer, frontend-dev) |
| 5 | Price reveal | Make a tiny price feel good | 700 ms digit roll (spring), 40 ms stagger. On a drop: one 700 ms ring pulse on the saffron dot and the roll down | Numbers swap, dot static, the text line still explains the drop | Built |
| 6 | Live trip state | Calm "car is coming" | 6 s ambient loop: light travels the street toward the pickup, ETA digits roll | Still light at current position, ETA text | Spec only (same loop helper as 1 and 8) |
| 7 | The Haide moment | The main action leaves | 900 ms: 80 ms press, label out 160 ms, the brand dot travels the button (departure, 440 ms) wiping it to the confirmed state, ring flash, confirmation springs in. Optional haptic where supported | Label changes to the confirmed text, no travel | Built (Request seat) |
| 8 | Loading and empty | Branded, no spinner | 1.8 s loop, one light on a tiny route. Empty: route waits, one dot breath every 4 s | Still route with one light | Built |

Rules: transform and opacity only (route draw-in is the one `stroke-dashoffset` exception); 150 to 400 ms for most transitions; every animation has the calm still fallback above and the base CSS is the final state; no sound; haptics optional. Copy stays in the brand voice: the launch confirms with "Seat requested", not with an exclamation mark. "Haide" is the name of the moment, not on-screen text.

## 6. Map overlay contract (for frontend-dev)

The glow is an overlay, not a map layer: an absolutely positioned SVG (aura, halo, core, spark with `pathLength="1"`) above the MapLibre canvas, plus an HTML layer for the light (`transform: translate` keyframes sampled from the projected path). On `load`, move end and resize, re-project the coordinates with `map.project()` and recompute the path and samples (the map is static under cooperative gestures, so this is rare). On a plain background (tiles missing) the same overlay draws over `map-bg` with a fixed viewBox, so the feature degrades without the map. Use the `map-*` roles in `buildStyle()` instead of ramp colours. The map stays `role="img"` with the text description, the overlay is `aria-hidden`.

## 7. Performance and budget

- Motion code measured on the demos: helpers about 2.7 KB raw (about 1.3 KB gzip unminified), component CSS about 4 KB gzip. Estimate with per-screen orchestration: **5 to 10 KB gzip** against the 25 KB allowance. No JS animation library (ADR 0019).
- Fonts: Sora 48 KB (latin plus latin-ext) replaces Bricolage 64 KB.
- Compositor-only: the light, sheets, chips, digits, seats, buttons. Paint-only exceptions: route draw-in (once) and SVG ring pings on tiny shapes.
- Infinite loops pause when off screen (IntersectionObserver) and when the tab is hidden.
- QA check: no long tasks over 50 ms during any moment, no layout work in the Performance trace while animating.

## 8. Contrast (computed, WCAG 2.1 AA)

Computed by `node docs/brand/tools/contrast.mjs` from the tokens (exit code 1 on any failure). Translucent glass is composited over the worst backdrop (the saffron route in dark, the indigo route in light). Text needs 4.5:1, graphics 3:1. Pairs marked info are decorative.

### dark theme

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| Body text on bg | #F2F1FB | #12112A | 16.46:1 | 4.5:1 | Pass |
| Muted text on bg | #B4B3D0 | #12112A | 9.04:1 | 4.5:1 | Pass |
| Body text on surface | #F2F1FB | #1C1B3D | 14.72:1 | 4.5:1 | Pass |
| Muted text on surface | #B4B3D0 | #1C1B3D | 8.09:1 | 4.5:1 | Pass |
| Body text on surface-subtle | #F2F1FB | #26254D | 12.89:1 | 4.5:1 | Pass |
| Muted text on surface-subtle | #B4B3D0 | #26254D | 7.08:1 | 4.5:1 | Pass |
| Body text on bg-deep | #F2F1FB | #0E0D26 | 16.98:1 | 4.5:1 | Pass |
| Muted text on bg-deep | #B4B3D0 | #0E0D26 | 9.33:1 | 4.5:1 | Pass |
| Subtle text and placeholder on surface | #B4B3D0 | #1C1B3D | 8.09:1 | 4.5:1 | Pass |
| Subtle text and placeholder on surface-subtle | #B4B3D0 | #26254D | 7.08:1 | 4.5:1 | Pass |
| Subtle text and placeholder on bg-deep | #B4B3D0 | #0E0D26 | 9.33:1 | 4.5:1 | Pass |
| Link on surface | #A9A2E8 | #1C1B3D | 7.08:1 | 4.5:1 | Pass |
| Link on bg | #A9A2E8 | #12112A | 7.92:1 | 4.5:1 | Pass |
| Price on bg | #FFC21A | #12112A | 11.40:1 | 4.5:1 | Pass |
| Price on surface | #FFC21A | #1C1B3D | 10.19:1 | 4.5:1 | Pass |
| Price on map-bg (glass-free overlay) | #FFC21A | #0E0D26 | 11.76:1 | 4.5:1 | Pass |
| Savings on surface | #5BC1C6 | #1C1B3D | 7.76:1 | 4.5:1 | Pass |
| Savings on bg | #5BC1C6 | #12112A | 8.68:1 | 4.5:1 | Pass |
| Body text on glass (over #FFC21A) | #F2F1FB | #4E4035 | 8.89:1 | 4.5:1 | Pass |
| Muted text on glass (over #FFC21A) | #B4B3D0 | #4E4035 | 4.88:1 | 4.5:1 | Pass |
| Price on glass (over #FFC21A) | #FFC21A | #4E4035 | 6.16:1 | 4.5:1 | Pass |
| Body text on glass (over #0E0D26) | #F2F1FB | #191838 | 15.26:1 | 4.5:1 | Pass |
| Primary button label on action | #1B1A2E | #FFC21A | 10.52:1 | 4.5:1 | Pass |
| Primary button label on action-hover | #1B1A2E | #FFD04F | 11.66:1 | 4.5:1 | Pass |
| Primary button label on action-pressed | #1B1A2E | #F2AC00 | 8.65:1 | 4.5:1 | Pass |
| Outline button label on surface | #C9C5F2 | #1C1B3D | 10.01:1 | 4.5:1 | Pass |
| Outline button border on surface (UI) | #A9A2E8 | #1C1B3D | 7.08:1 | 3:1 | Pass |
| Primary button fill vs bg (UI) | #FFC21A | #12112A | 11.40:1 | 3:1 | Pass |
| Tonal label on tint | #C9C5F2 | #26254D | 8.77:1 | 4.5:1 | Pass |
| Label on accent | #1B1A2E | #FFC21A | 10.52:1 | 4.5:1 | Pass |
| Focus ring vs bg (UI) | #BDB7F0 | #12112A | 9.83:1 | 3:1 | Pass |
| Focus ring vs surface (UI) | #BDB7F0 | #1C1B3D | 8.79:1 | 3:1 | Pass |
| Input border vs surface (UI) | #7472A8 | #1C1B3D | 3.70:1 | 3:1 | Pass |
| Route line vs map-bg (UI) | #FFC21A | #0E0D26 | 11.76:1 | 3:1 | Pass |
| Route core vs map-bg (UI) | #FFE08A | #0E0D26 | 14.74:1 | 3:1 | Pass |
| Pulse vs map-bg (UI) | #FFF8E1 | #0E0D26 | 17.90:1 | 3:1 | Pass |
| Pulse ring vs map-bg (UI) | rgba(255,194,26,0.55) | #0E0D26 | 4.16:1 | info | Pass |
| Pulse vs its ring (UI) (over #0E0D26) | #FFF8E1 | #93711F | 4.28:1 | info | Pass |
| Map labels on map-bg | #9F9DC8 | #0E0D26 | 7.36:1 | 4.5:1 | Pass |
| success text on success-bg | #5FD08A | #12301F | 7.41:1 | 4.5:1 | Pass |
| warning text on warning-bg | #FFC266 | #3A2A0A | 8.68:1 | 4.5:1 | Pass |
| error text on error-bg | #FF8A94 | #40161C | 6.90:1 | 4.5:1 | Pass |
| info text on info-bg | #8DB8FF | #14284A | 7.28:1 | 4.5:1 | Pass |

### light theme

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| Body text on bg | #1B1A2E | #F7F7FB | 15.93:1 | 4.5:1 | Pass |
| Muted text on bg | #55556F | #F7F7FB | 6.74:1 | 4.5:1 | Pass |
| Body text on surface | #1B1A2E | #FFFFFF | 17.02:1 | 4.5:1 | Pass |
| Muted text on surface | #55556F | #FFFFFF | 7.20:1 | 4.5:1 | Pass |
| Body text on surface-subtle | #1B1A2E | #EFEFF6 | 14.87:1 | 4.5:1 | Pass |
| Muted text on surface-subtle | #55556F | #EFEFF6 | 6.29:1 | 4.5:1 | Pass |
| Body text on bg-deep | #1B1A2E | #EFEFF6 | 14.87:1 | 4.5:1 | Pass |
| Muted text on bg-deep | #55556F | #EFEFF6 | 6.29:1 | 4.5:1 | Pass |
| Subtle text and placeholder on surface | #666684 | #FFFFFF | 5.53:1 | 4.5:1 | Pass |
| Subtle text and placeholder on surface-subtle | #666684 | #EFEFF6 | 4.83:1 | 4.5:1 | Pass |
| Subtle text and placeholder on bg-deep | #666684 | #EFEFF6 | 4.83:1 | 4.5:1 | Pass |
| Link on surface | #4639B0 | #FFFFFF | 8.49:1 | 4.5:1 | Pass |
| Link on bg | #4639B0 | #F7F7FB | 7.95:1 | 4.5:1 | Pass |
| Price on bg | #1B1A2E | #F7F7FB | 15.93:1 | 4.5:1 | Pass |
| Price on surface | #1B1A2E | #FFFFFF | 17.02:1 | 4.5:1 | Pass |
| Price on map-bg (glass-free overlay) | #1B1A2E | #EFEFF6 | 14.87:1 | 4.5:1 | Pass |
| Savings on surface | #0B6F78 | #FFFFFF | 5.90:1 | 4.5:1 | Pass |
| Savings on bg | #0B6F78 | #F7F7FB | 5.52:1 | 4.5:1 | Pass |
| Body text on glass (over #382E92) | #1B1A2E | #DBD9EB | 12.27:1 | 4.5:1 | Pass |
| Muted text on glass (over #382E92) | #55556F | #DBD9EB | 5.19:1 | 4.5:1 | Pass |
| Price on glass (over #382E92) | #1B1A2E | #DBD9EB | 12.27:1 | 4.5:1 | Pass |
| Body text on glass (over #EFEFF6) | #1B1A2E | #FCFCFD | 16.60:1 | 4.5:1 | Pass |
| Primary button label on action | #FFFFFF | #5043C6 | 7.10:1 | 4.5:1 | Pass |
| Primary button label on action-hover | #FFFFFF | #4639B0 | 8.49:1 | 4.5:1 | Pass |
| Primary button label on action-pressed | #FFFFFF | #382E92 | 10.64:1 | 4.5:1 | Pass |
| Outline button label on surface | #382E92 | #FFFFFF | 10.64:1 | 4.5:1 | Pass |
| Outline button border on surface (UI) | #5043C6 | #FFFFFF | 7.10:1 | 3:1 | Pass |
| Primary button fill vs bg (UI) | #5043C6 | #F7F7FB | 6.64:1 | 3:1 | Pass |
| Tonal label on tint | #382E92 | #F1F0FC | 9.43:1 | 4.5:1 | Pass |
| Label on accent | #1B1A2E | #FFC21A | 10.52:1 | 4.5:1 | Pass |
| Focus ring vs bg (UI) | #5043C6 | #F7F7FB | 6.64:1 | 3:1 | Pass |
| Focus ring vs surface (UI) | #5043C6 | #FFFFFF | 7.10:1 | 3:1 | Pass |
| Input border vs surface (UI) | #6B6B8A | #FFFFFF | 5.13:1 | 3:1 | Pass |
| Route line vs map-bg (UI) | #382E92 | #EFEFF6 | 9.29:1 | 3:1 | Pass |
| Route core vs map-bg (UI) | #5043C6 | #EFEFF6 | 6.20:1 | 3:1 | Pass |
| Pulse vs map-bg (UI) | #FFC21A | #EFEFF6 | 1.41:1 | info | Pass |
| Pulse ring vs map-bg (UI) | #382E92 | #EFEFF6 | 9.29:1 | 3:1 | Pass |
| Pulse vs its ring (UI) | #FFC21A | #382E92 | 6.58:1 | 3:1 | Pass |
| Map labels on map-bg | #55556F | #EFEFF6 | 6.29:1 | 4.5:1 | Pass |
| success text on success-bg | #12703C | #E6F5EC | 5.47:1 | 4.5:1 | Pass |
| warning text on warning-bg | #8A4B00 | #FFF3D6 | 6.17:1 | 4.5:1 | Pass |
| error text on error-bg | #A8232F | #FDECEE | 6.25:1 | 4.5:1 | Pass |
| info text on info-bg | #1B4F9E | #E8F1FD | 6.93:1 | 4.5:1 | Pass |

Closest calls: muted text on glass over a saffron route 4.88:1; input border on surface in dark 3.70:1. Rule: never put body text directly on the route line; the glass layer keeps it above 4.5:1. QA fix (E-DM): light `text-subtle` was #6B6B8A, which is 4.48:1 on `bg-deep` and `surface-subtle` (#EFEFF6); it is now #666684 (4.83:1 there, 5.53:1 on white) and the pair is checked for all four layers in `contrast.mjs`. The token is not used by any screen yet.

## 9. Tools

| File | What |
|---|---|
| `docs/brand/tools/build-preview-motion.mjs` and `preview-motion.template.html` | Builds `docs/brand/preview-motion.html` from the tokens (fonts embedded, works offline) |
| `docs/brand/tools/contrast.mjs` | The contrast table above, usable in CI |
| `docs/brand/tools/record-motion.mjs` | Frame-exact GIFs by stepping WAAPI `currentTime` (no ffmpeg). Needs `gifenc` and `pngjs` installed outside the repo, see the file header |

## 10. Handoff notes and open items

- `apps/web/scripts/tokens.ts` was extended: it emits `--tk-blur-*`, `--tk-grain-*`, `--tk-travel-*`, `--tk-stagger-*`, `--tk-scale-*`, and a `linear()` spring inside `@supports` with a cubic-bezier fallback. `tokens.css` was not regenerated (it is under `src`); `pnpm --filter @haide/web tokens` does it, and `build` already runs it.
- frontend-dev (done): dark is the default theme (`public/theme-init.js` before paint, a file because of the CSP; stored `system` is the explicit Auto choice that follows `prefers-color-scheme`), update `theme-color`, replace the Bricolage `@font-face` with Sora (files already in `apps/web/public/fonts`), restyle Button variants with the `outline` and `on-outline` roles (the current secondary variant uses `text-primary-700`, which fails in dark), and use the `map-*` roles in `RouteMap.tsx`.
- ux-designer: the primary action in dark is saffron, so check "one primary action per screen" on every screen; keep exclamation marks out of copy.
- Open: real tiles are not verified, so the overlay is only tested on the stylised demo map. Real-device 60 fps is not measured (no phone here); the recorder proves the animations are deterministic, not fast. GIFs are 20 fps with grain off (grain turns into noise in 256 colours).
