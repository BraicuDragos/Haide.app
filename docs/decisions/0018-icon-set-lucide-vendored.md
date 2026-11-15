# 0018. Icon set: Lucide, vendored per icon as inline SVG, stroke 1.75

- **Status:** Accepted
- **Date:** 2026-11-15
- **Area:** Brand
- **Agent:** brand-designer

## Context
The brief demands one consistent icon set and no emoji as icons. Today `apps/web/src/ui/Icon.tsx` holds 17 hand-drawn 24 px monoline icons (stroke 2). The new screens need more (clock, armchair for seats, route, sun and moon, footprints for walking distance, shield-check). Icons must match the monoline logo, cost almost nothing in bundle size, and be free for commercial use.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Keep extending the hand-drawn set | Zero dependency, already in place | We would draw every new icon and keep geometry consistent by hand. Easy to drift | Medium, ongoing |
| B. **Lucide, vendored: copy only the used icons' path data into `Icon.tsx`** | Monoline, round caps, 24 px grid, matches the logo. ISC licence. About 200 bytes per icon, no runtime dependency, no tree-shaking worry. Consistent geometry for any future icon | The current 17 icons need a one-off swap (most already match Lucide shapes) | Low |
| C. Phosphor (light weight) | Several weights, large set | Heavier set to vendor, light weight at 24 px looks thin on dark, extra choice to police | Low to medium |

## Decision
**Option B.** Lucide is the single icon set. Icons are inline SVG path data in `Icon.tsx`, added only when used, stroke width from the token `sizing.iconStroke` (1.75), `stroke-linecap` and `stroke-linejoin` round, 24 px (16 px small). Mapping used in the preview: `route`, `map-pin`, `clock`, `check`, `rotate-ccw`, `armchair` (seat), `sun`, `moon`, `user`, `search`, `footprints`. No emoji and no second set. The ISC licence text goes into `apps/web/public/` third-party notices when the icons ship.

## Consequences
- Positive: consistent look with the logo, tiny payload, an easy rule for contributors ("if Lucide has it, copy its paths").
- Negative / accepted risks: a handful of existing icons change slightly. Icon-only buttons still need an `aria-label` (unchanged rule).
- What would trigger revisiting: a needed icon that Lucide does not have and that cannot be composed from existing ones.

## Sources
- [Lucide](https://lucide.dev) (ISC licence)
- `docs/brand/tools/build-preview-motion.mjs` (vendored path data used by the preview)
