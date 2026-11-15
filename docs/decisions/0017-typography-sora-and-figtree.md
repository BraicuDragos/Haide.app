# 0017. Typography: Sora for headings and numerals, Figtree for UI text

- **Status:** Accepted
- **Date:** 2026-11-15
- **Area:** Brand
- **Agent:** brand-designer

## Context
The "Headlight" direction (ADR 0016) makes type a design element: large numerals for price, time and seats, and a heading face with a calm, technical character. Requirements: free, self-hostable (no CDN, ADR 0005), variable, full Latin Extended so Șelimbăr, Țepeș and Păltiniș render in the brand face (ș ț ă â î and capitals), tabular figures, and a small payload. ADR 0007 chose Bricolage Grotesque, whose slightly wobbly human rhythm suits "neighbourly" but not "quiet futurism".

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Keep Bricolage Grotesque + Figtree | No change, already self-hosted | Characterful in a quirky way, reads editorial at light weights, not futuristic. 64 KB for two subsets | None |
| B. **Sora (headings, numerals) + Figtree (UI)** | Geometric, wide, calm. Looks elegant at weight 300 and 400 for big numerals, clean at 600 for titles. Variable (wght 100 to 800), has `tnum`, covers ș ț ă â î (checked in the font files). OFL. 48 KB for latin plus latin-ext, 16 KB less than Bricolage | Wide letterforms, so headings are set about 10% smaller and tighter (tracking -0.02em to -0.03em). Changes a decided brand font | Low: swap two files and font-face rules |
| C. Unbounded or Geologica | Unbounded is very characterful, Geologica very versatile | Unbounded is loud and heavy, against "quiet". Geologica ships 378 KB of axes we would not use | Medium |

We rendered Bricolage, Sora, Geologica, Unbounded, Onest and Schibsted Grotesk side by side on dark with `3.10 RON`, `Șelimbăr → Piața Mare` and `Ștefan Țepeș, Păltiniș, Bâlea Lac, Cisnădie`, and checked glyph coverage with fontkit.

## Decision
**Option B.** Sora is the heading and numeral face (weights 300, 400, 600), Figtree stays for UI text. Scale (also in `design-tokens.json`): numeral 56/56 w300, numeralSm 24/28, display 36/42 w600, h1 28/34, h2 22/28, h3 18/24, price 36/40 w400 tabular, body 16/24. Self-host `sora-latin-wght-normal.woff2` and `sora-latin-ext-wght-normal.woff2` (both already copied to `apps/web/public/fonts/` with `LICENSE-sora.txt`) and use the same `unicode-range` pairs as for Figtree. Both subsets are required (ș and ț are in latin-ext, â and î in latin).

## Consequences
- Positive: numerals look designed, not default. Smaller font payload (48 KB vs 64 KB), after the Bricolage files are removed.
- Negative / accepted risks: wide glyphs need checking at 360 px (longest h1 in copy.md). Existing screens change line breaks. `font-display: swap` shows a fallback first; an optional `size-adjust` fallback face can limit layout shift.
- What would trigger revisiting: a measured layout-shift problem, or Sora failing on a glyph a real Sibiu address needs.

## Sources
- [Sora on Google Fonts](https://fonts.google.com/specimen/Sora) (OFL)
- [Figtree on Google Fonts](https://fonts.google.com/specimen/Figtree)
- [ADR 0007](0007-visual-identity-dusk-indigo-saffron.md)
