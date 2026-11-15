# Haide brand guide

> Owner: brand-designer · Date: 2026-11-15 · Status: Proposed (accepted when the Phase 1+2 PR is merged)
> Related: ADRs [0006 name](../decisions/0006-brand-name-haide.md) and [0007 visual identity](../decisions/0007-visual-identity-dusk-indigo-saffron.md) · tokens: [design-tokens.json](design-tokens.json) (single source of truth) · live preview: [preview.html](preview.html) · logos: `assets/brand/`
>
> **E-DM update (2026-11-15):** the visual direction was evolved in [design-direction.md](design-direction.md) (addendum) with ADRs [0016](../decisions/0016-visual-direction-quiet-futurism-headlight.md) to [0019](../decisions/0019-motion-no-js-animation-library.md). Where this guide disagrees, the addendum wins: dark theme is primary and default, **Sora replaces Bricolage Grotesque** for headings and numerals (Figtree stays), saffron may be text or a stroke on night surfaces only, dark `action` is saffron with an ink label, motion tokens and the type scale in section 6 are superseded by `design-tokens.json` v1.1.0. Name, logo, ramps and the saffron-dot idea are unchanged. Motion demos: [preview-motion.html](preview-motion.html).
>
> **Evidence convention** (same as the strategy docs): **[V]** verified by a search or a computation, **[A]** assumption. Contrast ratios below are computed with the WCAG 2.x relative-luminance formula from the hex values in `design-tokens.json`.

## 1. Brand idea in one paragraph

Haide is the neighbourly way across Sibiu. It is not a taxi and not a startup performing "disruption": it is a neighbour saying "come on, I'm going that way anyway." The look comes from the city itself: **indigo dusk** over the old town roofs, a **saffron headlight** for the one thing that matters on screen, and **Cibin teal** (the river) for money saved. Shapes are soft and monoline, like a route drawn with one finger on a map.

## 2. Name

### 2.1 Candidates explored (12)

Haide, Hopa, Tandem, Tura, Alături, Pe drum, Colea, Hai-hai, Împreună, Dealu', Sibi Ride, CoRide.

Dropped without a search because they fail the criteria: **Alături** and **Împreună** (diacritics in the name, long, hard to spell for English speakers), **Pe drum** (two words, generic), **Colea** (means "over there", no energy, awkward in English), **Hai-hai** (reads as a joke), **Dealu'** (apostrophe, local slang, not portable), **Sibi Ride** and **CoRide** (generic "ride" names that sound like Bolt/Uber/BlaBlaCar and tie us to one city).

### 2.2 Shortlist (4) and availability checks

| Name | Meaning and sound | RO / EN check | App-store and web check (WebSearch, 2026-11-15) | Verdict |
|---|---|---|---|---|
| **Haide** | Romanian interjection "come on / let's go", an invitation to come along. Borrowed from Ottoman Turkish, first attested 1675 [V] ([Wiktionary mirror](https://kaweah.freedombox.rocks/kiwix/wiktionary_en_all_maxi_2023-04/haide), [Babel Free](https://babelfree.com/dictionary/ro/meaning-of-haide)). 2 syllables, "HIGH-deh" | Every Romanian knows it and it is warm and colloquial. In English it is spellable after hearing it, but some will say "hayd". Fixed with a pronunciation line in the guide and store listing | No app named Haide in the Romanian mobility or carpool results (Wirgo, BlaBlaCar, Bolt, Uber, XRide, Free Now, Blue appear, not Haide) [V]. No `haide.ro` page found. Near-neighbours that are not mobility: **haidihai.ro** (an SRL, different domain), **HAID** fitness app (`haid.app`), an open-source landing-page template at `haide.io` on GitHub, **Haiho** loyalty app. No EUIPO/OSIM hit for "Haide" found in Nice classes 9, 39, 42 (search engines index trademark registers poorly, so this is **not** clearance) | **Chosen** |
| Hopa | "Hop in" feel. 2 syllables. In Romanian it also reads as the interjection "hopa!" ("whoa, ta-da"), playful | Fun in RO, but "Hopa" is also a town in Turkey, it is a playful exclamation rather than an invitation, and it carries no link to the shared-ride idea | No Romanian carpool app found under the name [V], but weaker meaning and more generic | Runner-up |
| Tandem | Two riding together on one bike. 2 syllables, perfect in English | Meaningless in Romanian, the idea is lost on the local audience | **Conflicts:** the Tandem language-exchange app (10M+ downloads, Berlin) ([Wikipedia](https://en.wikipedia.org/wiki/Tandem_(app))), Tandem Mobility bike-share (Movatic) and RideTandem (employer ride-booking) [V]. Crowded in the very category we would sit in | Rejected |
| Tura | "Tură" is a Romanian "round / shift / lap", also "tour" | Understood by Romanians but the diacritic-free spelling "Tura" reads as a person's surname or a place (Tura in Hungary/India) | No carpool app named Tura in the results [V], but no distinct meaning for the product | Rejected |

Not checked, and not checkable by us: WHOIS for domains, live App Store and Google Play name collision at submission time, OSIM and EUIPO register searches. These need the owner or an IP lawyer (see section 11). **Legal clearance is not guaranteed.**

### 2.3 Decision

**Haide** (pronounced "HIGH-deh", from Romanian "come on, let's go").

Rationale: it is the invitation that starts every shared ride, it is instantly Romanian and local to Sibiu, it is two syllables and easy to type, and no mobility product with that name turned up. It also fits the cost-sharing positioning: a neighbour inviting you along, not a platform selling you a seat. ADR [0006](../decisions/0006-brand-name-haide.md).

Usage:

- Write **Haide** (capital H) in running text. The logo wordmark is lowercase **haide**.
- Never write "HAIDE" in capitals, "Haide!" with an exclamation as a name, or "Haide App".
- Tagline: **The neighbourly way across Sibiu.** (taken from the positioning in [strategy §3](../product/strategy.md)). Store subtitle: "Share a ride across Sibiu".
- Pronunciation helper for store listings and onboarding: "Haide (HIGH-deh) is Romanian for 'come on, let's go'."

## 3. Visual direction

Choices made against the default look of a mobility app (black plus neon green, or generic blue with a car icon):

| Axis | Choice | Why it fits Haide |
|---|---|---|
| Colour | Indigo dusk (primary), saffron (accent), Cibin teal (secondary), violet-tinted grays | Evening commute light and the old town. Indigo is far from Bolt green, Uber black and BlaBlaCar blue. Saffron is warm like a headlight |
| Shape | Monoline strokes, round caps, 12 px card radius, 20 px for sheets, full radius for pills | A route drawn with a finger. Friendly without being childish |
| Type | Bricolage Grotesque for headings and prices, Figtree for everything else | Heading face has character and a slight human wobble. Body face is open and very legible on small phone screens |
| Mark | Lowercase "h" built as a stem plus an arch (a route that leaves the road) ending in one saffron dot | Hints at a shared route and a pickup point, with no car silhouette |
| Imagery | Simple route lines, Sibiu street names, real prices. No stock photos of smiling people in cars | Trust comes from specifics (a pickup point, a plate, a price), not from imagery |

The one memorable thing: **the saffron dot**. It appears in the mark and over the "i" in the wordmark, and in the UI it marks the one thing that matters on a screen (the pickup point on a route line, the price that dropped). Everything else stays quiet.

## 4. Logo

Files in `assets/brand/` (hand-written SVG, no fonts, valid `viewBox`):

| File | Use |
|---|---|
| `logo.svg` | Primary lockup: mark tile + wordmark `haide`. Light backgrounds. 250 x 80 viewBox |
| `logo-mark.svg` | Mark only, 64 x 64 viewBox (rounded tile, white "h" route, saffron dot). Favicon, avatar, small spaces. Reads at 24 x 24 px |
| `logo-mono.svg` | Single colour via `currentColor` (set the CSS `color`). Stamps, one-colour print, watermarks. The glyph is cut out of the tile with a mask |
| `logo-reversed.svg` | For dark backgrounds (ink `#1B1A2E` and `#1E1A52` or darker). Lilac tile, white wordmark |
| `app-icon.svg` | 1024 x 1024 full-bleed square for iOS and Android adaptive icon. The OS applies its own mask. Glyph sits inside the adaptive-icon safe zone |

Rules:

- **Clear space:** at least 1/4 of the tile width (16 units in `logo-mark.svg`) on every side.
- **Minimum size:** mark 16 px (24 px preferred), full logo 96 px wide.
- **Backgrounds:** `logo.svg` on white, `gray-50` to `gray-200` and `primary-50`. `logo-reversed.svg` on `ink` (`#1B1A2E`) and `primary-900`. On photos or any other colour, use `logo-mono.svg` in white or ink after checking 4.5:1.
- **Contrast of the logo parts (computed):** white glyph on the primary tile 7.10:1. Saffron dot on the primary tile 4.39:1 (needs 3:1 for graphics). Wordmark ink on white 17.02:1. Reversed: lilac tile on ink 7.31:1, saffron dot on ink 10.52:1, white wordmark on ink 17.02:1.
- **Do not:** recolour the tile outside the palette, stretch or rotate, add shadows or outlines, replace the saffron dot with another colour, place the full-colour logo on saffron, set the wordmark in a font, or put the mark inside another shape.

## 5. Colour

### 5.1 Roles

| Role | Colour | Hex | Where it appears |
|---|---|---|---|
| **Primary** (Dusk indigo) | `primary-500` | `#5043C6` | Buttons, active tab, links (use `primary-600`), the logo tile |
| **Secondary** (Cibin teal) | `secondary-600` | `#0B6F78` | Money saved, positive "you save" lines, secondary icons. Text uses `secondary-600` or darker |
| **Accent** (Saffron) | `accent-400` | `#FFC21A` | The dot, a highlighted price or pickup point, a count badge. **Only as a fill with ink text, never as text** |
| **Ink** | `gray-900` | `#1B1A2E` | Body text, wordmark |
| Neutrals | `gray-50` to `gray-900` | `#F7F7FB`, `#EFEFF6`, `#E0E0EC`, `#C8C8DA`, `#9B9BB5`, `#6B6B8A`, `#55556F`, `#403F58`, `#2C2B41`, `#1B1A2E` | Page, surface, borders, text. Violet-tinted so they sit with the indigo |
| Success | `success-700` on `success-50` | `#12703C` / `#E6F5EC` | Booking confirmed, ride completed |
| Warning | `warning-700` on `warning-50` | `#8A4B00` / `#FFF3D6` | Price changed, late cancellation window |
| Error | `error-700` on `error-50` | `#A8232F` / `#FDECEE` | Failed request, declined booking |
| Info | `info-700` on `info-50` | `#1B4F9E` / `#E8F1FD` | Neutral notices |

Full ramps (primary 50-900, secondary 50-900, accent 50-600, gray 50-900, semantic 50/500/700) are in [design-tokens.json](design-tokens.json) and shown as swatches with ratios in [preview.html](preview.html). Semantic colours are never the only cue: always pair with an icon and words.

Ramp steps that are **not** safe for text: `primary-400` (4.48:1 with ink, large text and UI only), `secondary-500` (4.14:1 with white, UI only), `warning-500` (4.42:1 with white, UI only), all accent steps on a light background.

### 5.2 Contrast ratios, light theme (computed)

Text needs 4.5:1. Graphics and UI components need 3:1.

| Pair | Foreground | Background | Ratio | Required | Result |
|---|---|---|---|---|---|
| Body text on page | #1B1A2E | #F7F7FB | 15.93:1 | 4.5:1 | Pass |
| Body text on card | #1B1A2E | #FFFFFF | 17.02:1 | 4.5:1 | Pass |
| Muted text on card | #55556F | #FFFFFF | 7.20:1 | 4.5:1 | Pass |
| Muted text on page | #55556F | #F7F7FB | 6.74:1 | 4.5:1 | Pass |
| Muted text on subtle surface | #55556F | #EFEFF6 | 6.29:1 | 4.5:1 | Pass |
| Subtle text on card | #6B6B8A | #FFFFFF | 5.13:1 | 4.5:1 | Pass |
| Subtle text on page | #6B6B8A | #F7F7FB | 4.80:1 | 4.5:1 | Pass |
| Link on card | #4639B0 | #FFFFFF | 8.49:1 | 4.5:1 | Pass |
| Link on page | #4639B0 | #F7F7FB | 7.95:1 | 4.5:1 | Pass |
| Button label on action | #FFFFFF | #5043C6 | 7.10:1 | 4.5:1 | Pass |
| Button label on action hover | #FFFFFF | #4639B0 | 8.49:1 | 4.5:1 | Pass |
| Button label on action pressed | #FFFFFF | #382E92 | 10.64:1 | 4.5:1 | Pass |
| Label on accent | #1B1A2E | #FFC21A | 10.52:1 | 4.5:1 | Pass |
| Label on primary tint | #382E92 | #F1F0FC | 9.43:1 | 4.5:1 | Pass |
| Label on secondary tint | #0A5960 | #E6F6F6 | 7.23:1 | 4.5:1 | Pass |
| Success text on success bg | #12703C | #E6F5EC | 5.47:1 | 4.5:1 | Pass |
| Success text on card | #12703C | #FFFFFF | 6.16:1 | 4.5:1 | Pass |
| Warning text on warning bg | #8A4B00 | #FFF3D6 | 6.17:1 | 4.5:1 | Pass |
| Warning text on card | #8A4B00 | #FFFFFF | 6.80:1 | 4.5:1 | Pass |
| Error text on error bg | #A8232F | #FDECEE | 6.25:1 | 4.5:1 | Pass |
| Error text on card | #A8232F | #FFFFFF | 7.13:1 | 4.5:1 | Pass |
| Info text on info bg | #1B4F9E | #E8F1FD | 6.93:1 | 4.5:1 | Pass |
| Info text on card | #1B4F9E | #FFFFFF | 7.90:1 | 4.5:1 | Pass |
| Focus ring vs page (UI) | #5043C6 | #F7F7FB | 6.64:1 | 3:1 | Pass |
| Focus ring vs card (UI) | #5043C6 | #FFFFFF | 7.10:1 | 3:1 | Pass |
| Input border vs card (UI) | #6B6B8A | #FFFFFF | 5.13:1 | 3:1 | Pass |
| Action fill vs page (UI) | #5043C6 | #F7F7FB | 6.64:1 | 3:1 | Pass |

**Forbidden pairs (fail by design):** saffron `#FFC21A` as text or icon on white is 1.62:1 and on `gray-50` 1.51:1. Saffron always carries ink text (10.52:1) or sits next to a `primary-700` ring.

### 5.3 Contrast ratios, dark theme (computed)

Dark theme is **optional for the MVP**. Tokens are provided so it can ship later without a redesign. One value was corrected during this pass: dark `action-pressed` moved from `#8076DB` (4.18:1 with its label, fail) to `#8E85E0` (4.97:1).

| Pair | Foreground | Background | Ratio | Required | Result |
|---|---|---|---|---|---|
| Body text on page | #F2F1FB | #12112A | 16.46:1 | 4.5:1 | Pass |
| Body text on card | #F2F1FB | #1C1B3D | 14.72:1 | 4.5:1 | Pass |
| Muted text on card | #B4B3D0 | #1C1B3D | 8.09:1 | 4.5:1 | Pass |
| Muted text on page | #B4B3D0 | #12112A | 9.04:1 | 4.5:1 | Pass |
| Muted text on subtle surface | #B4B3D0 | #26254D | 7.08:1 | 4.5:1 | Pass |
| Link on card | #A9A2E8 | #1C1B3D | 7.08:1 | 4.5:1 | Pass |
| Link on page | #A9A2E8 | #12112A | 7.92:1 | 4.5:1 | Pass |
| Button label on action | #1E1A52 | #A9A2E8 | 6.81:1 | 4.5:1 | Pass |
| Button label on action hover | #1E1A52 | #BDB7F0 | 8.45:1 | 4.5:1 | Pass |
| Button label on action pressed | #1E1A52 | #8E85E0 | 4.97:1 | 4.5:1 | Pass |
| Label on accent | #1B1A2E | #FFC21A | 10.52:1 | 4.5:1 | Pass |
| Label on primary tint | #C9C5F2 | #26254D | 8.77:1 | 4.5:1 | Pass |
| Label on secondary tint | #92D8DB | #0A3438 | 8.37:1 | 4.5:1 | Pass |
| Success text on success bg | #5FD08A | #12301F | 7.41:1 | 4.5:1 | Pass |
| Warning text on warning bg | #FFC266 | #3A2A0A | 8.68:1 | 4.5:1 | Pass |
| Error text on error bg | #FF8A94 | #40161C | 6.90:1 | 4.5:1 | Pass |
| Info text on info bg | #8DB8FF | #14284A | 7.28:1 | 4.5:1 | Pass |
| Focus ring vs page (UI) | #BDB7F0 | #12112A | 9.83:1 | 3:1 | Pass |
| Input border vs card (UI) | #7472A8 | #1C1B3D | 3.70:1 | 3:1 | Pass |

## 6. Typography

| Role | Typeface | Source | Weights | Why |
|---|---|---|---|---|
| Headings, prices | **Bricolage Grotesque** | [Google Fonts](https://fonts.google.com/specimen/Bricolage+Grotesque), OFL | 600, 700 | Characterful grotesque with a slightly human, uneven rhythm. Gives prices ("3.10 RON") a confident look |
| Body, UI, labels | **Figtree** | [Google Fonts](https://fonts.google.com/specimen/Figtree), OFL | 400, 500, 600, 700 | Open, friendly geometric sans, very legible at 14-16 px on phones |

**Romanian and Latin Extended.** Both families ship a Latin Extended subset on Google Fonts, which includes the comma-below letters **ș ț** (U+0219, U+021B) and **ă â î** (U+0103, U+00E2, U+00EE) and their capitals **Ș Ț Ă Â Î**. Self-hosted font files **must include the `latin-ext` subset** (do not subset down to basic Latin). Test string for QA and the preview: `Ștefan Țepeș, Șelimbăr, Cisnădie, Păltiniș, Bâlea, Mihai Viteazu, Zona Industrială Vest`.

**Self-host the fonts** (bundled in the app or served from our own origin) instead of calling the Google Fonts CDN. This avoids sending users' IP addresses to a third party, which is the privacy posture in [ADR 0005](../decisions/0005-location-privacy-baseline.md), and it works offline. Fallback stacks are in `font.family` in the tokens. The preview page embeds both fonts so it renders the same offline.

Type scale (also in `font.scale`):

| Style | Family | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| display | heading | 40 / 44 | 700 | -0.02em | Splash, empty-state hero |
| h1 | heading | 32 / 38 | 700 | -0.015em | Screen titles |
| h2 | heading | 24 / 30 | 700 | -0.01em | Section titles |
| h3 | heading | 20 / 26 | 600 | 0 | Card titles |
| price | heading | 32 / 36 | 700, tabular numbers | -0.01em | Price per seat |
| bodyLg | base | 18 / 28 | 400 | 0 | Intro text |
| body | base | 16 / 24 | 400 | 0 | Default text (never below 16 px for inputs, so iOS does not zoom) |
| label | base | 16 / 20 | 600 | 0 | Buttons, field labels |
| bodySm | base | 14 / 20 | 400 | 0 | Secondary text |
| caption | base | 12 / 16 | 500 | 0.01em | Timestamps, hints. Never for essential information |

Rules: sentence case everywhere, no all-caps labels, keep lines under about 70 characters, use tabular numbers for money and times, show money as `3.90 RON` (amount, space, `RON`, two decimals) and time in 24 h `07:30`.

## 7. Tone of voice

**Three adjectives: neighbourly, plain, dependable.**

- **Neighbourly:** we talk like a person from your city who is also going that way. Warm, never gushing.
- **Plain:** short sentences, everyday verbs, the exact thing that happens. No jargon, no hype.
- **Dependable:** specific times, places and prices. Errors say what happened and what to do. We never apologise with "oops" and never overpromise.

| Situation | Say | Do not say |
|---|---|---|
| Primary button | Request seat | Submit |
| Publish a ride | Publish ride | Create new ride listing |
| Booking accepted (push) | Andrei accepted. Pickup is Str. Principală 118 at 07:30. | Great news! Your amazing ride is booked! |
| Price changed (push) | Price changed to 2.00 RON because a second passenger joined. | Oops, something changed with your fare. |
| Error: no network | No connection. We'll send your request when you're back online. | Something went wrong. |
| Error: ride full | This ride is full. See 3 other rides at 07:30 to 08:00. | Sorry, unavailable. |
| Empty search | No rides yet on this route. Tell us when you travel and we'll let you know. | Nothing found. |
| Late cancel | Cancelling within 30 minutes of departure counts as a late cancellation on your profile. | Warning! Penalties apply! |
| Safety | Share trip link | Stay safe out there! |

Naming: the same action keeps the same word all the way through (the button "Request seat" produces the message "Seat requested"). Say **ride**, **driver**, **passenger**, **seat**, **pickup point**. Never say "fare", "order", "booking fee", "trip request", or "Uber-style" (see pricing and legal framing in [pricing.md](../product/pricing.md)). Costs are **shared**, never "earned": a driver "recovers fuel costs", never "earns". No emoji in UI text. English only in the MVP, strings in resource files, Romanian place names and user names kept as typed (UTF-8).

## 8. Shape, spacing, motion

From the tokens (see [design-tokens.json](design-tokens.json)):

- **Radius:** `sm` 6 (chips, inputs inner), `md` 12 (cards, buttons), `lg` 20 (sheets), `full` (pills, avatars).
- **Spacing:** 4 px base: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Page padding 16, card padding 16-20.
- **Elevation:** `card` and `raised` shadows are tinted indigo (not neutral gray) so they sit with the palette. Prefer a 1 px `border` plus `card` shadow on light backgrounds.
- **Touch targets:** at least 44 px, controls 48 px high.
- **Motion:** 120 / 200 / 400 ms with one easing (`cubic-bezier(0.2, 0, 0, 1)`). Motion only answers an action (a request is sent, a price drops). One signature moment: when a price drops, the saffron dot pulses once. Respect `prefers-reduced-motion`.
- **Focus:** 3 px ring in `focus-ring` colour on every interactive element.

## 9. Design tokens

**Single source of truth: [`docs/brand/design-tokens.json`](design-tokens.json).** There is no copy in `assets/brand/` (an earlier duplicate was removed so the two cannot drift). The preview page is generated from these values. Structure: `color` (ramps and semantic), `theme.light` and `theme.dark` (named role tokens such as `action`, `on-action`, `text-muted`, `focus-ring`), `font`, `space`, `radius`, `shadow`, `motion`, `breakpoint`, `sizing`.

Implementation hint for `frontend-dev` (to be confirmed in the architecture phase): consume `theme.*` role tokens, not raw ramp steps, in components. This keeps dark theme a one-line switch later.

## 10. Preview

[`docs/brand/preview.html`](preview.html) is one self-contained page (fonts and logos embedded, works offline and on a phone) with: logo variants on light and dark, swatches with hex and computed ratio, approved pairs for both themes, type scale, voice do/don't, and two sample UI cards (a ride card and a booking confirmation).

## 11. Owner-only needs

Nothing blocks Phases 3 to 6. Before **public launch (Gate 3)**, only the owner can do these, and they can be batched with the other launch items in [strategy §13](../product/strategy.md):

1. **Register the domain.** Primary: `haide.ro`. If taken: `haide.app`, then `gohaide.ro`. We could not check WHOIS from the research tools. A `.ro` registration is typically a few tens of RON per year **[A]**. Point it to the hosting chosen in the architecture phase.
2. **Reserve the store names** when creating the developer accounts: "Haide" and the subtitle "Share a ride across Sibiu". If either store rejects the bare name, use "Haide: Sibiu Carpool".
3. **Trademark (optional, recommended before any paid marketing):** a basic knock-out search and, if clear, an OSIM national filing (or EUIPO) for the word mark "Haide" in classes 9, 39 and 42. This can be part of the same 1-hour lawyer consult already recommended in the strategy. Estimated cost beyond the consult: fees only **[A]**.
4. **Social handles** (`@haide`, `@haide.sibiu` as fallback) on Instagram and Facebook, for the founding-driver outreach in the strategy's liquidity plan.
5. **Support and privacy contact email** on the new domain (already needed for the privacy policy).

## Sources

- Meaning and etymology of "haide": [Wiktionary mirror](https://kaweah.freedombox.rocks/kiwix/wiktionary_en_all_maxi_2023-04/haide) · [Babel Free](https://babelfree.com/dictionary/ro/meaning-of-haide) · [Romanian hortative "hai"](https://elon.io/grammar/romanian/verbs/imperative/let-us-hortative)
- Competitor and name-collision checks: [Wirgo (App Store)](https://apps.apple.com/us/app/-/id6670219309) · [Romania Insider on ridesharing apps](https://www.romania-insider.com/life/ridesharing-apps-romania-january-2022) · [Tandem (app), Wikipedia](https://en.wikipedia.org/wiki/Tandem_(app)) · [haide.io template repo](https://github.com/amihantech/haide.io) · [HAID fitness app](https://play.google.com/store/apps/details?id=app.haid)
- Fonts: [Figtree](https://fonts.google.com/specimen/Figtree) · [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque)
- Contrast method: WCAG 2.x relative luminance, computed with a Node script over `design-tokens.json`
