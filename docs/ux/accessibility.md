# Accessibility: WCAG 2.1 AA audit and checklist

> Owner: ux-designer · Date: 2026-11-15 (E-DM update, dark-first with motion) · Target: WCAG 2.1 AA · Subject: [prototype/index.html](prototype/index.html) · Tokens: [design-tokens.json](../brand/design-tokens.json) v1.1.0 · Contrast of every token pair: [design-direction.md §8](../brand/design-direction.md) (computed by `node docs/brand/tools/contrast.mjs`) · Motion: [motion.md](motion.md)
>
> **Method.** (1) The `design:accessibility-review` checklist applied to the E-DM prototype, plus a `design:design-critique` pass over screenshots in both themes. (2) A scripted audit, [prototype/tools/audit.mjs](prototype/tools/audit.mjs), in headless Chrome over **36 screen states** (every route, sheets, errors, loading, empty, every booking state, ride day, driver screens): horizontal overflow, 44 px touch targets, accessible names, duplicate ids, one `h1`, one primary action, minimum text size, **text contrast computed from the rendered colours** (alpha composited), keyboard focus ring on the first six tab stops, Romanian glyphs on both fonts. Run in five configurations: dark 360, light 360, dark 320, light 430, dark 360 with reduced motion. (3) Manual review of keyboard order, focus handling, live regions and semantics. **Not done:** real screen readers (VoiceOver, TalkBack, NVDA), a 200% zoom pass on a device, Lighthouse on the prototype (it runs in CI on the real build), real-device frame rate. All are in section 8 and belong to `qa-reviewer`.

## 1. Summary

| | Result |
|---|---|
| Issues found in this pass (E-DM) | 14, all fixed in the prototype (section 2) |
| Issues from the first prototype build (light only) | 10, all fixed earlier and still fixed |
| Scripted audit after fixes | 36 states x 5 configurations: **0 findings**, 0 page errors |
| Tightest measured text contrast in the prototype | 6.74:1 (muted text in light), about 7.1:1 in dark. Needs 4.5:1 |
| Tokens: every pair, both themes | All pass, see design-direction §8 (closest calls: muted text on glass over a saffron route 4.88:1, input border in dark 3.70:1) |
| Open, with an owner | 5 (section 7) |
| One primary action per screen | Checked on all 36 states by the script (max 1 visible `.btn.primary`) |

## 2. Issues found in the E-DM pass and fixes applied

| # | Issue | WCAG | Severity | Fix applied |
|---|---|---|---|---|
| 1 | The "Haide!" flash used the on-action ink colour on the dark tint wipe, about 1.5:1 while it was readable for 400 ms | 1.4.3 | Major | Text uses `on-tint`; it appears after the wipe has covered the button (timing moved to 500 ms); it is decorative and `aria-hidden`, so the confirmed text (10+:1) is what is announced |
| 2 | Moving focus to the screen `h1` after navigation drew a focus box around the heading | 2.4.7 (noise) | Minor | Programmatic focus on `h1[tabindex=-1]` and `main` shows no ring. Interactive controls keep the 3 px ring |
| 3 | The match chip covered the pickup marker and the "You" label on the map | 1.4.1, 1.3.1 | Major | The chip sits in the corner that holds no marker, chosen per route. It is a sibling of the `role="img"` map, so its text is in the accessibility tree |
| 4 | Hero subtitle overlapped the basemap river label ("Cibin"): text on text | 1.4.3 | Major | The river label moved from the shared base map into the detail maps. Rule kept: body text never sits on the route line or a label |
| 5 | Day select clipped its value at 360 px ("Today, Mc"): the wider Sora and Figtree fields share a row with the time field | 1.4.10 | Major | Day and time wrap to two rows below 344 px of content (`flex: 1 1 180px` and `1 1 152px`) |
| 6 | The toast covered the primary button on "Ride published" and duplicated the page title | 1.4.4, 3.3 | Minor | Toasts moved to the top, below the app bar. No toast on Publish done (the page confirms) |
| 7 | Consent label was a flex container, so its two inline links became 24 px flex items and the sentence broke oddly at wider widths | 2.5.5, 1.3.2 | Major | The label is a block with padding, links stay inline (inline-text exception), the row is 44 px |
| 8 | The seat readout repeated "Free seats" (legend and readout), so a screen reader heard it twice | 1.3.1 | Minor | One legend; the readout is `aria-hidden` and the polite status says "2 seats" |
| 9 | With a saffron primary in dark, the driver screen showed two "Accept" and, after the ride, two "Rate" primaries | One action per screen (design-direction) | Major | The next one to answer is primary, the rest are outline; Decline is a ghost button |
| 10 | "Call 112" was a solid red fill and read as a second primary | Usability, 1.4.1 | Minor | Red outline button; red label and border on the surface (above 6.9:1 in dark) |
| 11 | Copy bug: "Pays 3.10 RON with 1 passengers" | 3.1 (language) | Minor | Uses `driverRide.request.pays.one` ("Pays 3.10 RON if alone") when it is the first |
| 12 | Tab bar focus ring was a sharp rectangle that clipped the pill icon | 2.4.7 | Minor | Rounded to `radius.lg` |
| 13 | A native select arrow and the native time clock do not follow the theme | 1.4.11 | Minor | Selects get an inline chevron icon (`currentColor`); `color-scheme` follows the theme so the time picker is legible |
| 14 | The selected seat tokens (84 px saffron blocks) outweighed the one primary action below them | Hierarchy | Minor | 72 px max, still the sanctioned `glow-soft` selected state |

First-build issues (radio chips, 24 px checkboxes, 24 px name link, 11 px map labels, hidden photo input focus, "Up to3.80", placeholder colour, silent seat count, 3-column card, prototype bar wrap) were fixed earlier and the script re-checks them (targets, names, font size, overflow).

## 3. Design critique (design:design-critique), summary

| Dimension | Finding | Action |
|---|---|---|
| First impression | A lit saffron route on a calm night map is the first thing seen on Find, ride details and booking. Recognisable as Haide, not like a stock ride app | Keep |
| Hierarchy | Time as a large light numeral, price in saffron, one saffron button: the eye order is time, price, action. The booking screen on ride day was long (banner, steps, live card, map, details, price, contact) | Duplicate "be at the pickup point" line removed from the banner when the live card is shown. Order kept: status, steps, live card, map |
| Consistency | Radius, shadow, glass and focus come from tokens. Two things drifted: a hero route hidden under the search card, and chips colliding with markers | Hero route moved above the card. Chip placement per route |
| Usability | Seat tokens and the launch moment feel good but must never block: the launch runs during the request, never longer than the animation, and offers no extra step | Documented in motion.md moment 7 |
| Accessibility | Contrast and targets pass in both themes. Saffron on light surfaces is never text (only a dot with an indigo ring) | Policed by `contrast.mjs` and the script |
| What works | Branded loading and empty states, the shared route rail across list, details and booking, the honest live-trip note, plain confirmation text under the "Haide!" flash | Keep |

## 4. Checklist (design-time rules for `frontend-dev`)

### Perceivable

| Criterion | Rule | Status |
|---|---|---|
| 1.1.1 Non-text content | The map is `role="img"` with a text alternative, route overlay, lights and rings are `aria-hidden`, labels exist as text too. Icons are `aria-hidden`, icon-only buttons have `aria-label`. The seat strip and the loader art are `aria-hidden` (the words carry the meaning) | Pass |
| 1.3.1 Info and relationships | One `h1` per screen. Real `ul`, `ol`, `table` (caption, `th scope="row"`), `dl`, `fieldset`/`legend`. The seat group is a radio group with a legend | Pass |
| 1.3.2 Meaningful sequence | DOM order equals visual order. CTA bar last. Animated parts are decoration and sit outside the reading order | Pass |
| 1.3.4 Orientation, 1.3.5 Input purpose | Nothing locked. `autocomplete` on email, given-name, tel | Pass |
| 1.4.1 Use of colour | Status chips pair colour with an icon and words. Selected chips show a check. A price drop says "Price dropped to X". The route is never the only carrier: pickup and drop-off are also text | Pass |
| 1.4.3 Contrast (text) | 4.5:1 (3:1 for 24 px and up). Dark and light, see section 5 | Pass (script and tokens) |
| 1.4.4 Resize text, 1.4.10 Reflow | No horizontal scroll at 320 px in any of 36 states (script). Wider Sora headings wrap (`overflow-wrap: anywhere`). Day and time wrap | Pass by script at 320 and 360, device zoom open |
| 1.4.11 Non-text contrast | Focus ring 8.8:1 to 9.8:1 dark, 6.6:1 to 7.1:1 light. Route line 11.8:1 on the night map, 9.3:1 indigo on the light map. Saffron is a fill, never text on light | Pass |
| 1.4.12 Text spacing | Containers grow, no fixed text heights | Pass by review |
| 1.4.13 Content on hover or focus | No hover-only content. The seat lean is cosmetic | Pass |

### Operable

| Criterion | Rule | Status |
|---|---|---|
| 2.1.1 Keyboard | Every control is a native `button`, `a`, `input`, `select`, `textarea`. Seat tokens are radios. Tabs support arrow keys, Home and End. Sheets close on Esc | Pass |
| 2.1.2 No keyboard trap | The sheet traps Tab on purpose, has a close button and Esc. The page behind is `inert` | Pass |
| 2.2.1 Timing adjustable | The only timer is the request expiry, shown as a clock time. Toasts last 5 s and every toast message also lives in the page or the live region | Pass |
| 2.2.2 Pause, stop, hide | Moving light and breathing are ambient, auto-start, and last longer than 5 s. They pause off screen, stop with reduced motion (OS setting, plus an in-app switch that the build must add under Settings, open item 4). They carry no information. Informational motion (price drop, launch) runs once | Pass once the switch exists |
| 2.3.1 Three flashes | None. Fastest pulse is one ring per reveal (700 ms). The launch ring flashes once | Pass |
| 2.3.3 Animation from interactions (AAA, followed) | Every moment has a still version; reduced motion is honoured by CSS and JS; View Transitions off | Pass |
| 2.4.1, 2.4.2, 2.4.3, 2.4.6 | Skip link first. Title updates per route. Focus moves to the `h1` after navigation, returns to the opener after a sheet, goes to the first invalid field | Pass |
| 2.4.7 Focus visible | 3 px `focus-ring` outline, 3 px offset, on every interactive element including chips, seats and the launch button. Checked on the first six tab stops in 36 states | Pass |
| 2.5.1, 2.5.2 Pointer | No swipe-only or drag actions. The launch and seats work on pointer up/tap | Pass |
| 2.5.3 Label in name | Visible text is in the accessible name. After the launch the button's `aria-label` is the confirmed text | Pass |
| 2.5.5 Target size (AAA, followed) | 44 px minimum, 48 px controls, 56 px primary, 64 px tab bar. Inline links in sentences are exempt | Pass (script) |

### Understandable

| Criterion | Rule | Status |
|---|---|---|
| 3.1.1 Language | `<html lang="en">`. Romanian place names are proper nouns. `Haide!` is a brand word, decorative and `aria-hidden` | Pass |
| 3.2.1, 3.2.2 | No navigation on focus. No auto-submit on change (seat change updates in place, it does not submit) | Pass |
| 3.3.1 to 3.3.4 | Inline text error under the field, `aria-invalid`, `aria-describedby`, focus to the first error, correction hints, confirm step with consequence for destructive actions | Pass |

### Robust

| Criterion | Rule | Status |
|---|---|---|
| 4.1.2 Name, role, value | `role="switch"`, `role="tab"` with `aria-selected`, `aria-current` on the tab bar and timeline step, dialogs with `aria-modal` and `aria-labelledby`, loaders as `role="status"` with text | Pass |
| 4.1.3 Status messages | One polite live region for toasts, route titles, "Sending request", "Publishing ride". Inline banners `role="status"` or `role="alert"`. The price roll and the minute roll are silent; the sentence or the `sr-only` text carries the change | Pass |

## 5. Colour contrast

All token pairs, both themes, including translucent glass over the worst backdrop: [design-direction.md §8](../brand/design-direction.md). Prototype-specific additions, measured from the rendered page (`audit.mjs`) or computed from tokens:

| Element | Foreground | Background | Ratio | Required | Result |
|---|---|---|---|---|---|
| Body text (dark) | #F2F1FB | #12112A | 16.46:1 | 4.5:1 | Pass |
| Muted text (dark) | #B4B3D0 | #1C1B3D | 8.09:1 | 4.5:1 | Pass |
| Price numerals (dark) | #FFC21A | #1C1B3D | 10.19:1 | 4.5:1 | Pass |
| Primary button label (dark) | #1B1A2E | #FFC21A | 10.52:1 | 4.5:1 | Pass |
| Primary button label (light) | #FFFFFF | #5043C6 | 7.10:1 | 4.5:1 | Pass |
| Outline button label (dark) | #C9C5F2 | #1C1B3D | 10.01:1 | 4.5:1 | Pass |
| Outline button border (dark) | #A9A2E8 | #1C1B3D | 7.08:1 | 3:1 | Pass |
| Seat token, selected (dark): icon on fill | #1B1A2E | #FFC21A | 10.52:1 | 3:1 | Pass |
| Seat token, taken: icon on tint (dark) | #C9C5F2 | #26254D | 8.77:1 | 3:1 | Pass |
| "Haide!" wordmark on the tint wipe (dark, decorative) | #C9C5F2 | #26254D | 8.77:1 | 4.5:1 (not required, `aria-hidden`) | Pass |
| Confirmed text "Seat requested" (dark) | #C9C5F2 | #26254D | 8.77:1 | 4.5:1 | Pass |
| Savings and check (dark) | #5BC1C6 | #1C1B3D | 7.76:1 | 4.5:1 | Pass |
| Saved/success, warning, error, info text on their backgrounds | see §8 | | 5.5:1 to 8.7:1 | 4.5:1 | Pass |
| Map label on night map | #9F9DC8 | #0E0D26 | 7.36:1 | 4.5:1 | Pass |
| Route core on map (dark / light) | #FFC21A / #382E92 | #0E0D26 / #EFEFF6 | 11.76:1 / 9.29:1 | 3:1 | Pass |

Rules that keep it passing:
- Saffron `#FFC21A` is text, stroke or fill **on night surfaces**. On light surfaces it is a fill with ink text, or a dot with an indigo ring, never text or an icon alone.
- Body text never sits directly on the route line; the glass layer or a card keeps it above 4.5:1.
- Never use `primary-400`, `secondary-500` or `warning-500` for text. Use the 600 and 700 steps (light) or the dark role tokens.

## 6. Keyboard, focus and screen-reader behaviour

### Keyboard

| Element | Tab | Enter or Space | Esc | Arrow keys |
|---|---|---|---|---|
| Skip link | First stop | Moves focus to main | | |
| Tab bar | One stop per tab | Go to tab | | |
| Place field button | Stop | Opens the picker sheet, focus in the search input | | |
| Place picker, request, cancel, report, block sheets | Cycles inside the sheet | Activate | Close, focus returns to the opener | |
| Flexibility chips (radio) | One stop for the group | Select | | Left and right change selection |
| **Seat tokens (radio group)** | One stop for the group | Select | | Left and right change the count; the readout and price table update in place |
| Riding or Driving, Upcoming or Past | One stop per group | Select | | Left, right, Home, End |
| Star rating | One stop (radio group) | Select | | Left and right change value |
| **Launch button (Send request, Publish ride)** | Stop | Starts the moment once; afterwards `aria-disabled` | | |
| Forms | Visual order | Enter submits | | |

### Screen reader

| Element | Announced as | Note |
|---|---|---|
| Ride card (link) | "07:25, Today, Cisnădie Măgurii area, 150 m walk to pickup, Piața Mare, 100 m walk from drop-off, Up to 3.80 RON, Drops if others join, Radu, rated 4.8 from 23 ratings, 2 seats left, link" | One stop per ride |
| Map | "Map of the route. Pickup and drop-off are shown as approximate areas." | Overlay, lights and rings are silent. "Fits your route. 150 m walk to pickup." is a real text chip next to it |
| Price (details, booking) | "Up to 3.80 RON" (visual roll is `aria-hidden`, a `sr-only` span holds the value) | A drop: "Price dropped to 1.90 RON because another passenger joined." |
| Seat group | "Free seats" group with radios "1 seat", "2 seats", "3 seats", then a polite "2 seats" on change | Strip tokens on details are `aria-hidden`; "2 seats left of 3" is text |
| Launch | "Sending request" (polite), then "Seat requested". The button's name becomes "Seat requested" | "Haide!" is never read |
| Loader | "Looking for rides on your route" (`role="status"`) | The light is silent |
| Live trip card | Region "Radu leaves at 07:25", "Leaves in 10 min", "Be at the pickup point 5 minutes early.", note about no tracking | No live region on the minute change |
| Status chips, tab badge, timeline, toast | As before: text only; "My rides, 2 updates"; ordered list with `aria-current="step"`; toast once through the live region | |

## 7. Open items

| # | Item | Severity | Owner |
|---|---|---|---|
| 1 | Test with VoiceOver (iOS Safari), TalkBack (Android Chrome) and NVDA. Check sheet focus, the `inert` page behind it, the seat radio group, the launch announcement and the live trip card | Major, before launch | `qa-reviewer` |
| 2 | The map overlay is only tested on the stylised drawing. With real MapLibre tiles keep the text alternative, keep all information in text, do not trap keyboard focus, and re-check the glass chip contrast over real tiles | Major for the build | `frontend-dev` |
| 3 | Real-device frame rate and View Transitions behaviour (Safari 18, Firefox 144) are not measured here | Minor | `qa-reviewer` |
| 4 | Add an in-app **Reduce motion** switch in Settings (default follows the OS) so people who cannot change the OS setting can stop the ambient light (WCAG 2.2.2). The prototype has it in the demo controls | Major, before launch | `frontend-dev` |
| 5 | The native time input shows 12 h on some desktop locales (24 h on Romanian phones). If testing shows mistakes, replace it with two selects | Minor | `frontend-dev` after the first usability test |

## 8. QA checklist (run on the real build)

1. Keyboard only: publish with seat tokens, search, request, accept and rate without a mouse. Focus is always visible and never lost, also during view transitions.
2. Screen reader: sign-in, the ride card, the request sheet and launch, a booking status change, the star rating, the seat group.
3. Zoom to 200% and set the OS text size to the largest: no clipped text, no horizontal scroll at 320 px. Check the Sora headings.
4. **Reduced motion** (OS setting and the in-app switch) on every screen: still route with one light, no loops, instant navigation, no "Haide!", numbers swap.
5. Greyscale: every state is still distinguishable (statuses have words and icons, selected chips have a check).
6. Light and dark theme, and the OS theme change while the app is open.
7. Forms: submit empty. Each error is announced and focus lands on the first invalid field.
8. Touch: 44 px targets on a 360 px phone, one-handed. The primary action sits in the lower half.
9. Automated: `node docs/ux/prototype/tools/audit.mjs` against the prototype for design regressions; axe and Lighthouse (score 100) in CI on the main routes of the real build, as a floor and not as proof.
