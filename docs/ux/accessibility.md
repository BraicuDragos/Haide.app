# Accessibility: WCAG 2.1 AA audit and checklist

> Owner: ux-designer · Date: 2026-11-15 · Target: WCAG 2.1 AA · Subject: [prototype/index.html](prototype/index.html) (22 screen states at 360 and 390 px, plus a 1280 px desktop view) · Tokens: [design-tokens.json](../brand/design-tokens.json)
>
> **Method.** (1) Contrast ratios computed with the WCAG relative-luminance formula for every foreground and background pair the prototype uses. (2) A scripted DOM audit in headless Chrome over 22 screen states: touch-target size, accessible names, form labels, duplicate ids, heading count, minimum font size. (3) Manual review of keyboard order, focus handling, live regions and semantics against the source. (4) Visual review of screenshots. **Not done:** real screen-reader runs (VoiceOver, TalkBack, NVDA) and a 200% zoom pass on a device. Both are in the QA checklist in section 7 and belong to `qa-reviewer` before launch.

## 1. Summary

| | Result |
|---|---|
| Issues found in the first prototype build | 10 |
| Fixed in the prototype | 10 |
| Open, with an owner | 3 (section 6) |
| Contrast pairs checked | 40 pass, 0 fail |
| Screen states scripted | 22. One `h1` each, 0 duplicate ids, 0 unlabelled controls, 0 targets under 44 px after fixes (switch and checkbox targets are the whole row label) |

## 2. Issues found and fixes applied

| # | Issue | WCAG | Severity | Fix applied |
|---|---|---|---|---|
| 1 | Radio and checkbox chips showed the native control next to the custom chip, so there were two visual states | 1.4.1, 3.3.2 | Minor | Native input kept for keyboard and screen readers but visually hidden. The chip shows a check mark and a tint when selected. Focus ring drawn on the chip with `:has(input:focus-visible)` |
| 2 | Checkboxes were 24 px with a text-width label, so the tap area was smaller than 44 px | 2.5.5 | Major | Label fills the row (min height 44 px). Same for switches (row min height 48 px) |
| 3 | Name link in the contact card was 24 px high | 2.5.5 | Major | Links inside rows are 44 px high |
| 4 | Map labels were 11 px | 1.4.4 | Minor | 12 px (caption token). The map is `role="img"` with an aria-label, and every label also exists as text in the page |
| 5 | The hidden photo file input had no visible focus | 2.4.7 | Major | The visible label button gets the 3 px focus ring when the input is focused |
| 6 | “Up to” and the amount were read together as “Up to3.80 RON” | 1.3.1 | Minor | A real space between them |
| 7 | Placeholder colour was the browser default | 1.4.3 | Minor | Placeholder uses `text-subtle` (#6B6B8A, 5.13:1 on white) |
| 8 | Seat stepper count changes were silent | 4.1.3 | Minor | `<output aria-live="polite">` |
| 9 | Ride cards at 360 px squeezed the route into a narrow third column, so labels wrapped to 4 lines | 1.4.10 | Major | Card restructured: time and price on the first row, route full width below |
| 10 | Prototype top bar wrapped on 360 px and its focus ring (indigo on near-black) was too faint | 1.4.10, 1.4.11 | Minor | No wrap. Lilac focus ring on the dark bar. Prototype chrome only, not part of the product |

## 3. Checklist (design-time rules for `frontend-dev`)

### Perceivable

| Criterion | Rule | Status |
|---|---|---|
| 1.1.1 Non-text content | Decorative SVG is `aria-hidden`. Informative SVG (map, avatar) has `role="img"` and a label. Photos use `alt=""` when the name is next to them | Pass |
| 1.3.1 Info and relationships | One `h1` per screen. Real `ul`, `ol`, `table` (price table has `caption` and `th scope="row"`), `dl`. Labels use `label for`. Groups use `fieldset` and `legend` | Pass |
| 1.3.2 Meaningful sequence | DOM order equals visual order. The sticky CTA is last | Pass |
| 1.3.4 Orientation | Portrait first, nothing locked | Pass |
| 1.3.5 Input purpose | `autocomplete` on email, given-name, tel | Pass |
| 1.4.1 Use of colour | Status chips and banners always pair colour with an icon and words. Selected chips show a check mark. The price drop shows text, not only the pulsing dot | Pass |
| 1.4.3 Contrast (text) | 4.5:1, see section 4 | Pass |
| 1.4.4 Resize text | Layout reflows, no fixed heights on text containers | Pass by review, device test open |
| 1.4.10 Reflow | No horizontal scroll at 320 px. Tables are 2 columns | Pass |
| 1.4.11 Non-text contrast | 3:1 for borders, focus ring, icons, route line. Saffron is never the only cue: it always has a `primary-700` ring | Pass |
| 1.4.12 Text spacing | Containers grow, no clipping expected | Pass by review |
| 1.4.13 Content on hover or focus | No hover-only content | Pass |

### Operable

| Criterion | Rule | Status |
|---|---|---|
| 2.1.1 Keyboard | Every control is a `button`, `a`, `input`, `select` or `textarea`. Tabs support arrow keys, Home and End. Sheets close on Esc | Pass |
| 2.1.2 No keyboard trap | The sheet traps Tab on purpose (it is modal) and always has a close button and Esc | Pass |
| 2.2.1 Timing adjustable | The only timer is the request expiry, shown as a clock time and not a ticking countdown. Toasts last 5 s and every toast message is also in the page or the live region | Pass |
| 2.3.1 Three flashes | None. The price-drop pulse is one 800 ms scale | Pass |
| 2.4.1 Bypass blocks | “Skip to main content” is the first focusable element | Pass |
| 2.4.2 Page titled | `document.title` updates on every route | Pass |
| 2.4.3 Focus order | After navigation focus moves to the screen `h1`. After a sheet closes, focus returns to the opener. After a form error, focus moves to the first invalid field | Pass |
| 2.4.6 Headings and labels | Descriptive. Sheet titles name the action | Pass |
| 2.4.7 Focus visible | 3 px `focus-ring` outline with 2 px offset on every interactive element | Pass |
| 2.5.1 Pointer gestures | No swipe-only or drag actions | Pass |
| 2.5.3 Label in name | Visible label text is part of the accessible name. Icon buttons have aria-labels | Pass |
| 2.5.5 Target size (AAA in 2.1, we follow it) | 44 × 44 px minimum, controls 48 px, tab bar 64 px | Pass |

### Understandable

| Criterion | Rule | Status |
|---|---|---|
| 3.1.1 Language | `<html lang="en">`. Romanian place names are proper nouns and not marked up | Pass |
| 3.2.1, 3.2.2 Predictable | No navigation on focus. No auto-submit on change | Pass |
| 3.3.1 Error identification | Inline text error under the field plus `aria-invalid="true"` and `aria-describedby`. Focus moves to the first error | Pass |
| 3.3.2 Labels or instructions | Every field has a visible label. Format hints (phone, plate, photo size) are text, not placeholder | Pass |
| 3.3.3 Error suggestion | Errors say how to fix: “Enter a Romanian mobile number, like 0721 234 567.” | Pass |
| 3.3.4 Error prevention | Cancel, delete and block use a confirm step that names the consequence. The rating screen says ratings can’t be changed before sending | Pass |

### Robust

| Criterion | Rule | Status |
|---|---|---|
| 4.1.2 Name, role, value | Switches use `role="switch"`. Tabs use `role="tab"` and `aria-selected`. The timeline uses `aria-current="step"`. The tab bar uses `aria-current="page"`. Dialogs use `role="dialog"`, `aria-modal` and `aria-labelledby`, and the page behind is `inert` | Pass |
| 4.1.3 Status messages | One polite live region for toasts and route titles. Inline status banners use `role="status"`, errors use `role="alert"` | Pass |

## 4. Colour contrast (computed from the hex values used)

Text needs 4.5:1. UI components and graphics need 3:1. Pairs come from the theme tokens, so the same pairs hold in the build when it uses role tokens.

| Element | Foreground | Background | Ratio | Required | Result |
|---|---|---|---|---|---|
| Body text on page | #1B1A2E | #F7F7FB | 15.93:1 | 4.5:1 | Pass |
| Muted text on card | #55556F | #FFFFFF | 7.20:1 | 4.5:1 | Pass |
| Muted text on page | #55556F | #F7F7FB | 6.74:1 | 4.5:1 | Pass |
| Muted text on subtle surface (neutral status chip) | #55556F | #EFEFF6 | 6.29:1 | 4.5:1 | Pass |
| Placeholder and subtle text on card | #6B6B8A | #FFFFFF | 5.13:1 | 4.5:1 | Pass |
| Link on page | #4639B0 | #F7F7FB | 7.95:1 | 4.5:1 | Pass |
| Primary button label | #FFFFFF | #5043C6 | 7.10:1 | 4.5:1 | Pass |
| Primary button pressed | #FFFFFF | #382E92 | 10.64:1 | 4.5:1 | Pass |
| Secondary button label on card | #382E92 | #FFFFFF | 10.64:1 | 4.5:1 | Pass |
| Tonal button label | #382E92 | #F1F0FC | 9.43:1 | 4.5:1 | Pass |
| Danger button label | #FFFFFF | #A8232F | 7.13:1 | 4.5:1 | Pass |
| Danger outline label on page | #A8232F | #F7F7FB | 6.67:1 | 4.5:1 | Pass |
| Hero subtitle on hero | #C9C5F2 | #1E1A52 | 9.63:1 | 4.5:1 | Pass |
| Hero title on hero | #FFFFFF | #1E1A52 | 15.85:1 | 4.5:1 | Pass |
| Saffron badge label | #1B1A2E | #FFC21A | 10.52:1 | 4.5:1 | Pass |
| Success banner | #12703C | #E6F5EC | 5.47:1 | 4.5:1 | Pass |
| Warning banner and offline bar | #8A4B00 | #FFF3D6 | 6.17:1 | 4.5:1 | Pass |
| Error banner | #A8232F | #FDECEE | 6.25:1 | 4.5:1 | Pass |
| Inline error on page | #A8232F | #F7F7FB | 6.67:1 | 4.5:1 | Pass |
| Info banner | #1B4F9E | #E8F1FD | 6.93:1 | 4.5:1 | Pass |
| Savings text (teal) on card | #0B6F78 | #FFFFFF | 5.90:1 | 4.5:1 | Pass |
| Savings text (teal) on page | #0B6F78 | #F7F7FB | 5.52:1 | 4.5:1 | Pass |
| Active tab label | #382E92 | #FFFFFF | 10.64:1 | 4.5:1 | Pass |
| Inactive tab label | #55556F | #FFFFFF | 7.20:1 | 4.5:1 | Pass |
| “Waiting for answer” chip | #8A4B00 | #FFF3D6 | 6.17:1 | 4.5:1 | Pass |
| Tint banner | #382E92 | #F1F0FC | 9.43:1 | 4.5:1 | Pass |
| Avatar initial, indigo | #2B2373 | #E3E1F9 | 10.31:1 | 4.5:1 | Pass |
| Avatar initial, teal | #0A5960 | #E6F6F6 | 7.23:1 | 4.5:1 | Pass |
| Avatar initial, amber | #5B3A00 | #FFEFB8 | 8.92:1 | 4.5:1 | Pass |
| Toast text | #FFFFFF | #1B1A2E | 17.02:1 | 4.5:1 | Pass |
| Rating star (warning-700) on card | #8A4B00 | #FFFFFF | 6.80:1 | 3:1 | Pass |
| Input border on card | #6B6B8A | #FFFFFF | 5.13:1 | 3:1 | Pass |
| Focus ring on page | #5043C6 | #F7F7FB | 6.64:1 | 3:1 | Pass |
| Focus ring on dark (prototype top bar) | #BDB7F0 | #1E1A52 | 8.45:1 | 3:1 | Pass |
| Route line on map | #382E92 | #EFEFF6 | 9.29:1 | 3:1 | Pass |
| Pickup ring on white | #382E92 | #FFFFFF | 10.64:1 | 3:1 | Pass |
| Saffron dot against its ring | #382E92 | #FFC21A | 6.58:1 | 3:1 | Pass |
| Selected chip border on tint | #5043C6 | #F1F0FC | 6.29:1 | 3:1 | Pass |
| Switch off track on page | #6B6B8A | #F7F7FB | 4.80:1 | 3:1 | Pass |
| Empty star outline on page | #6B6B8A | #F7F7FB | 4.80:1 | 3:1 | Pass |

Rules that keep it passing:
- Saffron `#FFC21A` is a fill only. Text on it is ink (10.52:1). It is never text or an icon on white (1.62:1).
- Never use `primary-400`, `secondary-500` or `warning-500` for text. Use the 600 and 700 steps.
- Dark theme is out of the MVP. Its tokens already pass (brand-guide §5.3).

## 5. Keyboard, focus and screen-reader behaviour

### Keyboard

| Element | Tab | Enter or Space | Esc | Arrow keys |
|---|---|---|---|---|
| Skip link | First stop | Moves focus to main | | |
| Tab bar | One stop per tab | Go to tab | | |
| Place field button | Stop | Opens the picker sheet, focus in the search input | | |
| Place picker (sheet) | Search input, then rows | Choose place and close | Close, focus returns to the field | |
| Flexibility chips (radio) | One stop for the group | Select | | Left and right change selection |
| Tag chips (checkbox) | One stop per chip | Toggle | | |
| Riding or Driving, Upcoming or Past | One stop per group | Select | | Left, right, Home, End |
| Seat stepper | Two buttons | Change count (announced) | | |
| Star rating | One stop (radio group) | Select | | Left and right change value |
| Request, cancel, report, block sheets | Cycles inside the sheet | Activate | Close, focus returns to opener | |
| Forms | Visual order | Enter submits | | |

### Screen reader

| Element | Announced as | Note |
|---|---|---|
| Ride card (link) | “07:25, Today, Cisnădie Măgurii area, 150 m walk to pickup, Piața Mare, 100 m walk from drop-off, Up to 3.80 RON, Drops if others join, Radu, rated 4.8 from 23 ratings, 2 seats left, link” | One stop per ride |
| Route rail | Pickup and drop-off names prefixed with hidden “Pickup:” and “Drop-off:” | The rail graphic is decoration |
| Map | “Map of the route. Pickup and drop-off are shown as approximate areas.” | Approximate or exact is also stated in text next to the map |
| Price table | Table with caption “Price per passenger, by number of passengers on the ride” | |
| Status chips | Text only: “Accepted”, “Waiting for answer” | |
| Tab bar badge | “My rides, 2 updates” | The visual badge is `aria-hidden`, hidden text carries the count |
| Toast | Announced once through the live region | |
| Timeline | Ordered list, current step marked `aria-current="step"` | |

## 6. Open items

| # | Item | Severity | Owner |
|---|---|---|---|
| 1 | Test with VoiceOver (iOS Safari), TalkBack (Android Chrome) and NVDA. Check sheet focus and the `inert` page behind it | Major, before launch | `qa-reviewer` |
| 2 | The prototype map is a drawing. The real map must keep the text alternative, give all information in text too, and not trap keyboard focus | Major for the build | `frontend-dev` |
| 3 | The native time input shows 12 h on some desktop locales. On Romanian phones it follows the device (24 h). If testing shows mistakes, replace it with two selects (hour, minute) | Minor | `frontend-dev` after the first usability test |

## 7. QA checklist (run on the real build)

1. Keyboard only: publish, search, request, accept and rate without a mouse. Focus is always visible and never lost.
2. Screen reader: sign-in, the ride card, the request sheet, a booking status change, the star rating.
3. Zoom to 200% and set the OS text size to the largest: no clipped text, no horizontal scroll at 320 px.
4. Reduced motion on: skeleton shimmer, sheet rise and the price-drop pulse are off.
5. Greyscale: every state is still distinguishable (statuses have words and icons).
6. Forms: submit empty. Each error is announced and focus lands on the first invalid field.
7. Touch: 44 px targets on a 360 px phone, one-handed. Primary actions sit in the lower half.
8. Automated: axe or Lighthouse in CI on the main routes, as a floor and not as proof.
