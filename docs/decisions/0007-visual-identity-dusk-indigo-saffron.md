# 0007. Visual identity: dusk indigo, saffron dot, Bricolage Grotesque and Figtree

- **Status:** Proposed
- **Date:** 2026-11-15
- **Area:** Brand
- **Agent:** brand-designer

## Context
Haide needs a logo, palette, typography and token set that feels neighbourly and local, stands apart from Bolt (green), Uber (black) and BlaBlaCar (blue), meets WCAG AA, and supports Romanian characters (ă â î ș ț). The MVP is mobile-first, built on free tiers, so assets must be simple SVG and fonts must be free and self-hostable. The brand-guide has the full rationale, ratios and rules ([brand-guide](../brand/brand-guide.md)); tokens live in [design-tokens.json](../brand/design-tokens.json).

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. **Dusk indigo + saffron dot + teal for savings**, soft monoline shapes, Bricolage Grotesque headings and Figtree body | Distinct in the category, warm, tied to the city (old town at dusk, the Cibin). One signature element (the saffron dot). All text pairs pass AA. Both fonts are OFL with Latin Extended | Indigo is less obviously "mobility". Saffron cannot be used as text on light backgrounds, so rules must be followed | Done |
| B. Green and white, rounded pin and car icon | Instantly reads as "ride app", low risk | Same as Bolt, Wirgo and every eco-startup. Car clichés. Forgettable | Low |
| C. Black, white and one neon accent, condensed type | Bold, trendy | Same as Uber and many AI-generated pages. Cold, at odds with neighbourly cost-sharing | Low |

## Decision
We choose **Option A**: primary `#5043C6` (dusk indigo), accent `#FFC21A` (saffron, fill only, always with ink text), secondary `#118A92` and `#0B6F78` (Cibin teal, for savings), violet-tinted grays, ink `#1B1A2E`; logo is a rounded tile with a monoline "h" route and one saffron dot, wordmark `haide` in drawn monoline letters; fonts are Bricolage Grotesque (headings, prices) and Figtree (body), self-hosted with the `latin-ext` subset. Light theme ships in the MVP, dark theme tokens are provided but optional. `docs/brand/design-tokens.json` is the single source of truth (the duplicate in `assets/brand/` was removed).

## Consequences
- Positive: a recognisable look at 24 px and on the store shelf, accessible by construction (computed ratios for 28 light and 28 dark pairs, all passing after one dark-pressed fix), no font licence cost, no CDN calls, dark theme can be added later without redesign.
- Negative / accepted risks: saffron-as-text is forbidden and must be policed in review. Self-hosting fonts adds a small bundle size. The mono logo uses an SVG mask, which a few legacy tools ignore (export a flat PNG or path version if needed).
- What would trigger revisiting this decision: user testing showing the brand reads as untrustworthy or unclear, a trademark or colour collision with a competitor, or accessibility findings from QA.

## Sources
- [Figtree on Google Fonts](https://fonts.google.com/specimen/Figtree)
- [Bricolage Grotesque on Google Fonts](https://fonts.google.com/specimen/Bricolage+Grotesque)
- [WCAG 2.x contrast definition](https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio)
- [Strategy: positioning and personas](../product/strategy.md)
