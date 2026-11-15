---
name: brand-kit
description: Checklist and quality bar for creating the app's brand identity — name exploration and availability checks, SVG logo rules, accessible color palette with computed contrast ratios, typography with full Latin Extended support, tone of voice and design tokens.
user-invocable: false
---

# Brand kit — checklist

## 1. Name
- Generate 8–12 candidates, shortlist 3–5 with rationale (meaning, sound in RO and EN, memorability).
- Criteria: ≤ 2 syllables ideal, easy to spell after hearing it, works in English, no negative meaning in Romanian (pilot city is Sibiu),
  not confusingly similar to existing mobility brands.
- Availability check via WebSearch: existing apps with that name in app stores, obvious trademark conflicts,
  `.ro` / `.app` domain hints. Report what you checked; you can't guarantee legal clearance.
- Pick one. ADR it.

## 2. Logo (SVG, hand-written)
- `logo.svg` (mark + wordmark), `logo-mark.svg` (symbol only, square viewBox), `logo-mono.svg` (single color).
- Simple geometric shapes; must read at 24×24 px (app icon / favicon). Max ~3 colors.
- Valid SVG: `viewBox` set, no external fonts — wordmark letters as paths or a widely available font stack.
- Concept should hint at shared rides / route / connection, without clichés like a generic car silhouette.

## 3. Color palette
- Roles: `primary`, `secondary`, `accent`, neutrals (`gray-50 … gray-900`), semantic `success`, `warning`, `error`, `info`.
- For each text/background pair actually used, **compute** WCAG contrast ratio with a small script
  (Node or Python) — don't eyeball. Text ≥ 4.5:1, large text/UI elements ≥ 3:1.
- Provide light theme; dark theme optional for MVP (say so).

## 4. Typography
- Google Fonts (free), must support Latin Extended so Romanian user names/addresses render correctly (ă â î ș ț).
- Type scale (e.g. 12/14/16/20/24/32), weights, line-heights.

## 5. Tone of voice
- 3 adjectives, do/don't examples in English (button labels, error message, push notification).

## 6. Design tokens — `assets/brand/design-tokens.json`
```json
{
  "color": { "primary": { "500": "#......" }, "...": {} },
  "font": { "family": { "base": "...", "heading": "..." }, "size": { "sm": "14px" } },
  "radius": { "sm": "6px", "md": "12px", "full": "9999px" },
  "space": { "1": "4px", "2": "8px", "3": "12px", "4": "16px" },
  "shadow": { "card": "..." }
}
```

## 7. Preview page
`docs/brand/preview.html` — self-contained, mobile-friendly; shows logos on light/dark, swatches with
hex + contrast ratio, type scale, two sample cards (a Ride card and a Booking confirmation).
