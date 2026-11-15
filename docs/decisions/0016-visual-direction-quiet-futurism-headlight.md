# 0016. Visual direction: "Headlight", a dark-first quiet futurism where the route is the light

- **Status:** Accepted
- **Date:** 2026-11-15
- **Area:** Brand
- **Agent:** brand-designer

## Context
Epic E-DM asks us to evolve the decided brand (name, logo, dusk indigo and saffron, ADR 0006 and 0007) into a calm, high-tech, memorable look that does not read as a typical ride app (flat white cards, generic maps, stock illustrations). Constraints from `docs/brand/design-direction.md`: dark-first with a refined light theme, saffron as the single luminous signature, the map as hero, depth with restraint, one icon set, at most one secondary accent, WCAG 2.1 AA, a calm still fallback for every animation, and a motion budget of about 25 KB gzip on top of the 155 KB initial JS. The brief calls for three clearly different explorations before choosing.

## Options considered
| Option | Idea | Pros | Cons | Cost / effort |
|---|---|---|---|---|
| A. **Headlight** | Night city seen from above. The route is a luminous saffron filament with a slow travelling light. Everything else is quiet indigo layers, hairlines and grain | Uses the brand dot as the hero (the dot is the headlight). One memorable thing, the rest is restrained. Works on a plain background as well as on real tiles. The light is cheap (transform and opacity). Easy to explain in one sentence | Dark theme needs saffron text rules (allowed on night surfaces only). Light theme is a translation (indigo line, saffron pulse with a ring) so it is less dramatic | Medium |
| B. Instrument | A calm cockpit: arc dials for price, detents for seats, hairline grids, tick marks, radar-style sweeps | Very "high-tech", precise. Numbers feel engineered | Drifts to dense HUD and monospace-label clichés. Competes with the map instead of serving it. More SVG and more things on screen, against "one action per screen" | High |
| C. Soft Matter | Translucent pebbles and frosted glass layers, soft blobs of indigo and teal light behind them, magnetic physical controls | Tactile, friendly, strong depth | Sits close to the glassmorphism and purple-on-black look the brief rules out. Blur is expensive on mid-range phones. Little connection to routes or to Haide | Medium |

## Decision
We choose **A, "Headlight"**, and borrow two things from the others: tabular, large numerals for price, time and seats (from B) and magnetic spring physics for seats and the match moment (from C).

Rules that define it:
- **Dark first.** Night-indigo layers (`night-950` `#0B0A1E` to `night-600`), never pure black. The default theme is dark for everyone who has made no choice, whatever the OS preference says (decided in E-DM QA: the brief is dark-first and the headlight look is the product). Settings offers Auto (follows the OS, an explicit choice that is stored), Dark and Light; the choice is remembered on the device and applied before first paint (`public/theme-init.js`). Light theme is the refined alternative, same roles, different values. Accepted trade-off: a person whose OS is light and who finds dark hard to read must open Profile, Display once; the switch is reachable signed in or out.
- **Saffron is the only luminous colour.** In dark it is the route, the price numerals and the primary action fill (`action` is saffron with ink label, 10.52:1). Teal appears only for money saved (the one secondary accent). Lilac is for links and outline buttons.
- **The map is the hero.** Low-contrast night map, a three-layer route (aura, halo, core) and a travelling pulse. The route is an overlay (SVG for the line, HTML elements for the light), so it works on MapLibre and on a plain background.
- **Depth with restraint.** Three surface steps, a hairline glass border, one blur level on at most two layers per screen, fine grain at 5% opacity, soft saffron glow only on the route and the primary action. No gradients as decoration.
- **Type does the drama.** Large light-weight numerals for price, time and seats (ADR 0017).
- **Motion tells the Haide story**, departure and momentum, with shared tokens (ADR 0019).

This amends ADR 0007 in two points only: (1) saffron may be text or a stroke on night surfaces (computed 9.4:1 to 11.8:1), it stays forbidden on light surfaces, and (2) dark becomes the primary theme. Name, logo, palette ramps and the saffron-dot idea are unchanged.

## Consequences
- Positive: a screenshot of any screen is recognisable as Haide (a lit route on a calm night map). The look is mostly CSS and a few SVG paths, so it costs little. Tokens carry everything, so the light theme is a value swap.
- Negative / accepted risks: dark-first means every screen must be checked in both themes. Backdrop blur and grain have a cost on low-end phones, so they are limited (one blur layer in the sticky bar or sheet, grain is one static tile) and have fallbacks (`@supports not (backdrop-filter)`, `prefers-reduced-transparency`). Saffron text on dark must never leak into the light theme (policed by `docs/brand/tools/contrast.mjs`).
- What would trigger revisiting: usability tests where users cannot read the map or the price in daylight, a real-tiles map where the overlay clashes, or a measured frame-rate problem on a mid-range Android phone.

## Sources
- [design-direction.md](../brand/design-direction.md) and [preview-motion.html](../brand/preview-motion.html)
- [ADR 0007](0007-visual-identity-dusk-indigo-saffron.md)
- [WCAG 2.1 contrast](https://www.w3.org/TR/WCAG21/#contrast-minimum), computed with `docs/brand/tools/contrast.mjs`
