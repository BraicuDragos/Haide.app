# Motion spec: eight signature moments

> Owner: ux-designer · Date: 2026-11-15 · Epic E-DM · Direction: "Headlight" ([ADR 0016](../decisions/0016-visual-direction-quiet-futurism-headlight.md)) · No JS animation library ([ADR 0019](../decisions/0019-motion-no-js-animation-library.md)) · Tokens: [design-tokens.json](../brand/design-tokens.json) v1.1.0 `motion.*` · Reference build: [prototype/index.html](prototype/index.html) (source in `prototype/src/motion.js` and `styles.css`) · Brand demos: [preview-motion.html](../brand/preview-motion.html)
>
> **How to use this file.** Each moment lists its purpose, timing in **token names** (never typed milliseconds in the app), the reduced-motion fallback, where it is used, and what `frontend-dev` needs to know. The prototype implements all eight. `prototype/src/motion.js` (about 4 KB gzip before minifying, about 3 KB minified) is the reference for the helpers and can be ported as is.

## 0. Rules that apply to every moment

1. **Transform and opacity only.** One exception: the one-shot route draw-in animates `stroke-dashoffset` on a small SVG path (about 900 ms, once per route). No animated blur, filter, box-shadow, width, height, top or left. Glows are static box-shadows or stacked strokes, and a ring element animates `transform` and `opacity` instead of a shadow.
2. **Tokens, not numbers.** Durations `instant` 80, `fast` 120, `base` 200, `moderate` 300, `slow` 400, `reveal` 700, `draw` 900, `launch` 900, `pulse` 2400, `ambient` 6000 ms. Easings `standard`, `enter`, `exit`, `momentum`, `departure`, `linear`, `spring`, `magnet` (both springs are `linear()` curves with a `cubic-bezier` fallback emitted by `tokens.ts`). Distances `nudge` 4, `rise` 12, `sheet` 24, `far` 48 px. Stagger `step` 40 ms, `max` 240 ms. Scale `press` 0.97, `pop` 1.04. Helpers read these from CSS custom properties (`--tk-dur-*`, `--tk-ease-*`, `--tk-travel-*`, `--tk-stagger-*`, `--tk-scale-*`).
3. **The base CSS is the calm final state.** Reduced motion (the OS setting **or** the in-app switch, `html[data-motion=reduced]`) means: do not start the animation. No keyframe is needed to reach the final look, so a failed animation never leaves a broken screen.
4. **Purposeful.** A moment must tell the user something: where, what changed, that it worked. 150 to 400 ms for most transitions. The longer ones (draw, reveal, launch, ambient) happen at most once per screen visit or run slowly in the background.
5. **Loops are ambient and polite.** Every infinite animation pauses when its element is off screen (`IntersectionObserver`) and when the tab is hidden. At most two loops run on a screen (the route light and one breathing aura).
6. **No sound.** Haptics (`navigator.vibrate(12)`) only on the launch moment, only where supported, never with reduced motion, and the app must work identically without it.
7. **Compositor layers.** `will-change` only on the travelling light and the digit strips. Backdrop blur on at most two layers per screen (the bottom bar or CTA bar, plus the sheet or the match chip), with `@supports not (backdrop-filter)` and `prefers-reduced-transparency` fallbacks to the opaque `surface`. Grain is one static tile.
8. **60 fps target on a mid-range phone.** Not measured here (no device). qa-reviewer: no long task over 50 ms during any moment, no layout work in the Performance trace while animating.

## 1. Summary

| # | Moment | Purpose | Duration and easing (tokens) | Reduced-motion fallback |
|---|---|---|---|---|
| 1 | Route draw-in | Show where the ride goes and make the map feel alive | `draw` with `momentum`, light leads; then `pulse` loop with `linear` (sine-eased along the path); aura breathes over 2x `pulse` | Route fully drawn, one still light mid-route, no loop |
| 2 | Match | The request and a fitting ride visibly snap together | 520 ms `magnet` snap, `slow` ring ripples, `moderate` glow, chip `slow` `spring` | Already aligned, shared stretch lit, chip visible |
| 3 | Seat selection | Tactile choice of free seats | `instant` press, 520 ms `magnet` spring, `step` stagger, digits roll `reveal` `spring`, mouse lean up to 7 px | Seats fill instantly, no lean, numbers swap |
| 4 | Shared element | Keep orientation from list to details to booking | `moderate` `standard` via View Transitions on time, route and price; root crossfade `fast` out, `moderate` in | Instant navigation |
| 5 | Price reveal | Make a very small price feel good, and explain a drop | `reveal` `spring` digit roll, `step` stagger; drop: ring pulse `reveal` plus roll down | Numbers swap, dot static, the sentence still says "Price dropped to X" |
| 6 | Live trip state | Calm, honest "the ride is about to happen" | `ambient` loop `linear`, ETA digits roll `reveal` `spring` once per minute | Still light at the pickup approach, ETA text |
| 7 | The Haide moment | The main action leaves | about 900 ms to the confirmed state: `instant` press, label out `fast`, dot and wipe 380 ms `departure`, "Haide!" 400 ms, confirmed text `slow` `spring`, ring `slow` | Label changes to the confirmed text, nothing travels, no "Haide!" |
| 8 | Loading and empty | Branded, no spinners | Loader: one light on a tiny route, `pulse` x 0.75 loop `linear`. Empty: one dot breath every 4 s `standard` | Still route with one light, no loop |

## 2. The moments

### 1. Route draw-in and travelling light

- **What it looks like.** Aura (20 px), halo (9 px), core (3 px) and a 1.2 px spark are stacked strokes in the `route-*` roles. A bright head light leads the draw, the start marker springs in with a ripple, the end marker springs in at 45% of the draw. After the draw, three trailing lights and one ambient head travel the path every `pulse`. The aura layer breathes between 70% and 100% opacity.
- **Duration and easing.** `draw` + `momentum` for the dash offset and the head light; `pulse` + `linear` for the loop (the loop itself eases with a sine along the path, travelling for 62% of the cycle and resting for 38%).
- **Where.** Ride details map (every visit), booking map, driver ride map, Offer done map (all draw in); the Find hero route draws in **once per session** (`data-once`), then only the ambient light moves.
- **Reduced motion.** Full route, one `.pl.still` light at 50% of the path, nothing loops.
- **Implementation notes.**
  - The glow is an **overlay**, not a map layer (map overlay contract in design-direction §6): an absolutely positioned SVG above the MapLibre canvas (aura, halo, core, spark with `pathLength="1"`) plus an HTML layer for the lights. The light is an element moved with `transform: translate()` keyframes sampled from the SVG path (`getPointAtLength`, 48 to 64 points), so it stays on the compositor. Scale the HTML layer with `--k = clientWidth / viewBoxWidth`; with MapLibre, re-project with `map.project()` on `load`, `moveend` and `resize` and recompute the path and samples (the map is static under cooperative gestures, so this is rare).
  - On a plain background (tiles missing) the same overlay draws over `map-bg` with a fixed viewBox.
  - Map stays `role="img"` with the text alternative. The overlay and the lights are `aria-hidden`. The labels "Pickup" and "Drop-off" also exist as text next to the map.
  - Pause loops when off screen; `maps()` in `motion.js` shows how.

### 2. Match

- **What it looks like.** On ride details, the passenger's path (walk to pickup, walk from drop-off, dashed lilac with the two `you` points) arrives slightly off and rotated (14 px, 22 px, 3 degrees, 50% opacity), then snaps onto the ride's pickup and drop-off with a magnetic overshoot. Rings ripple at both points and a glass chip springs in: "Fits your route. 150 m walk to pickup."
- **Duration and easing.** 520 ms `magnet` snap (the one place a raw number is used: it is the `magnet` curve's natural settle time, to move to a token `match` in the signature group if one is added), rings `slow` + 100 ms `standard`, shared stretch glow `moderate` `standard`, chip `slow` `spring`. It starts after the draw has begun (700 ms) so the route is visible first.
- **Where.** Ride details only (first view per visit). Results cards show the same facts as text.
- **Reduced motion.** Aligned from the start, chip visible.
- **Notes.** The chip is a **sibling** of the `role="img"` map, not a child, so its text is in the accessibility tree. Place it in the corner that does not hold a marker (per route: top for routes that start bottom-left, bottom otherwise). It is one of the two blurred layers on that screen (the other is the CTA bar).

### 3. Seat selection

- **What it looks like.** Seats are 72 px tokens (armchair icon). Pressing one scales it to `press` (0.97) for `instant`; the chosen count fills left to right with a 520 ms `magnet` spring and a `step` stagger, so the seat "drops into place". Seats that turn off do a small `base` relax. With a mouse, tokens lean up to 7 px toward the pointer within 120 px (touch has no hover, it only gets the spring). The count and the "each pays when full" price roll as digits.
- **Where.** Offer a ride (driver picks free seats; the max is the car's seats). On ride details and the driver's ride screen a **read-only seat strip** shows taken seats filled (tinted) and free seats dashed, and the tokens spring in once on arrival. The words ("2 seats left of 3") carry the meaning, the strip is `aria-hidden`.
- **Why not on the passenger side.** The MVP books exactly one seat per request (ADR 0004, 0009). If multi-seat requests come later, the same component serves the passenger.
- **Reduced motion.** Tokens switch state instantly, no lean, digits swap.
- **Notes.** A radio group (`fieldset` + `legend`, native `input[type=radio]` hidden behind the token, focus ring drawn on the token with `input:focus-visible + .mag .face`). Update the readout and price table **in place** (do not re-render the form) or the spring is cut. Selected seats use `shadow.glow-soft` (dark only, static).

### 4. Shared-element transition: list, details, booking

- **What it looks like.** The tapped ride's **time**, **route rail** and **price** morph into their larger versions on the details screen (names `ride-time`, `ride-route`, `ride-price`), then into the same elements on the booking screen after "Send request". Going back reverses it. The page itself crossfades (`fast` out, `moderate` in).
- **Duration and easing.** `moderate` + `standard` on every `::view-transition-group(*)`; root `vt-out` `fast` `exit`, `vt-in` `moderate` `enter`. Opacity and transform only (the group morph is the browser's).
- **Where.** My rides card to booking and results card to ride details to booking, and back (browser back included).
- **Reduced motion and fallback.** Instant navigation: `if (!document.startViewTransition || reducedMotion) update()` (see `M.transition`). Support: Chrome 111, Safari 18, Firefox 144. Older browsers navigate instantly, which is fine.
- **Implementation notes for frontend-dev.**
  1. Wrap the router's state change: `document.startViewTransition(() => { navigate(); })` (with React Router, `viewTransition` on `<Link>`/`navigate`, or `flushSync` in the callback). The callback must leave the new DOM in place synchronously.
  2. **Names must be unique per state or the whole transition is skipped.** The list card in play gets `view-transition-name` set inline when it is clicked (clear all names first) and when you return to the list (tag the card whose route you came from). Details and booking carry the names statically. The prototype's `markShared()` and the click handler show the pattern.
  3. Named elements that exist in only one state simply fade (for example the booking price on a list with no price). That is expected.
  4. Wait for `updateCallbackDone` before moving focus or opening a sheet (`finishOnboarding` in the prototype). Focus still goes to the screen `h1` after navigation.
  5. Keep persistent chrome named (`tabbar`, `cta`) so it does not flash. Do not name large scrolling containers.
  6. `@media (prefers-reduced-motion: reduce)` and the in-app switch set `::view-transition-*` animations to `none` as a second layer.

### 5. Price reveal

- **What it looks like.** Digits are clipped strips of 0 to 9; they roll to the final value with the `spring` curve, `step` stagger left to right. "Up to 3.80 RON" appears this way on ride details and in the booking price card. When a passenger joins and the price drops, the digits roll **down from where they are** (3.10 to 1.90), one saffron ring on the price dot pulses once (`reveal`, scale 1 to 3.4, opacity to 0), and a plain sentence confirms it: "Price dropped to 1.90 RON because another passenger joined." Lists show the price as static text (no roll in lists: too noisy).
- **Reduced motion.** Numbers swap. The dot stays. The sentence still explains the drop (colour or motion is never the only cue).
- **Notes.** Tabular numerals (`font-feature-settings: "tnum"`, Sora). The visual roll is `aria-hidden`; a `sr-only` span holds "3.80 RON". Money formatting stays in the single helper; the roll only animates digits, it does not format. Never animate the number as a counting-up integer (it implies a total that is not true).

### 6. Live trip state (ride day)

- **What it looks like.** On the passenger's booking screen on ride day, a card shows a short street with the pickup point waiting at its end (a soft ring ripples every `ambient` / 2), and one calm light with a short trail glides toward it every `ambient`. Big light numerals show "10 min" (digits roll when the minute changes, once a minute, never a ticking seconds countdown), the caption "Radu leaves at 07:25.", the instruction "Be at the pickup point 5 minutes early." and the honest note: "The light follows the route, not the car. Haide doesn't track drivers."
- **Honesty rule (important).** Live GPS tracking is **out of the MVP** (ADR 0005, mvp-scope). The light is driven by the **schedule**, not by a position. The text carries the facts; the card says it does not track the car. When tracking is added (post-MVP, ADR 0005 revisited), the same component takes a real `progress` value (0 to 1 along the route) instead of the loop, and `live.note` is replaced. Do not show a car icon or imply a real position until then.
- **Duration and easing.** `ambient` + `linear` (sine along the path), digit roll `reveal` + `spring`.
- **Where.** Passenger booking screen when confirmed and the clock is within the ride day. The driver's ride screen can reuse the card ("2 passengers are waiting at 07:25") in the build; the prototype shows the passenger side only.
- **Reduced motion.** One still light 75% along the street, no ripple, the ETA text only.
- **Notes.** The card is `section` with its caption as `aria-labelledby`; the visual ETA is `aria-hidden` and a `sr-only` paragraph says "Leaves in 10 min". No live region on the minute change (calm, ADR 0009). Update the ETA at minute resolution with `aria-live` off.

### 7. The Haide moment

- **What it looks like.** The main action leaves like a departure. On press the button gives (`press`), the label slides out, the brand dot (ink on saffron) travels the button left to right with `departure` (accelerates away) while a tint wipe follows it, a ring flashes once around the button, the wordmark **"Haide!"** appears for about 400 ms in Sora 600, then the confirmed text springs in ("Seat requested" with a teal check). The sheet closes and the booking screen takes over with the shared-element transition (moment 4). Total about 900 ms to the confirmed state, about 1.05 s until navigation.
- **Duration and easing.** Token `launch` (900 ms) with `departure`; settle `spring`. Individual parts: press `instant` + 60, label out `fast` + 40 `exit`, dot and wipe 380 ms `departure`, wordmark 400 ms `standard`, confirmed text `slow` `spring`, ring `slow` + 100 `standard`.
- **Where.** **Request seat** (Join) in the request sheet and **Publish ride** on Offer. Only these two. One saffron primary per screen: the launch button is that primary.
- **"Haide!" rules** ([ADR 0020](../decisions/0020-haide-wordmark-sanctioned-exclamation.md)): the only exclamation mark in the product. Transient, `aria-hidden`, decorative, only when the action really left (not when queued offline: that shows "Request saved" with no wordmark), never in a toast, status line, error or the announcement. The announcement and toast are plain: "Seat requested".
- **Reduced motion.** The label changes to the confirmed text; nothing travels; no "Haide!"; the booking screen follows after 350 ms with no transition.
- **Implementation notes.**
  - Structure: `<button class="btn primary cta">` with `.wipe`, `.dotl` (the dot), three absolutely positioned labels (`.l1` label, `.l2` confirmed text with check, `.l3` the wordmark) and a sibling `.cta-ring`. `.is-done` is the calm confirmed state in CSS, so the animations only decorate.
  - Disable double submit: set `aria-disabled="true"` and ignore clicks once `.is-done`. Set `aria-label` to the confirmed text so the name matches the state. Announce "Sending request" at the start (live region), and the toast says "Seat requested".
  - Run the animation **while** the request is in flight, navigate when both the animation and the response are done. Never make the user wait longer than the animation. On failure: cancel the animations, restore the label, show the error inline (no wordmark).
  - Haptic: `navigator.vibrate?.(12)` after the press, only when motion is allowed.

### 8. Loading and empty states

- **Loading.** A tiny route (`160 x 70` viewBox) with a start and end point and one saffron light with a 3-step trail, looping every `pulse` x 0.75, with the line "Looking for rides on your route" as a `role="status"` heading. Below it two quiet dashed placeholder cards (no shimmer) keep the layout stable. A 56 px mini version sits inline next to "Working out your route" on Offer.
- **Empty.** The same route as a dashed line with the start dot breathing (scale 1 to 1.35) once every 4 s, then a title, one sentence and the one primary action ("Find a ride", "Offer a ride", "Notify me about this route"). Used on results, My rides (both roles), and the visitor states of My rides and Profile.
- **Reduced motion.** Still route with one light at 50%, no loop, no breath.
- **Notes.** No spinners anywhere in the product. `aria-busy="true"` on the page while loading; the status text is the message. Loops pause off screen.

## 3. Implementation checklist for `frontend-dev`

| Item | Detail |
|---|---|
| Helpers | Port `M` from `prototype/src/motion.js`: `run` (WAAPI with `fill: backwards`), `sample`, `ride`, `loop`, `rollInit` / `rollSet`, `launch`, `maps`, `match`, `live`, `ambient`, `transition`, `setReduced`. Read durations and easings from the CSS custom properties |
| Reduced motion hook | One source of truth: `matchMedia('(prefers-reduced-motion: reduce)')` plus an optional in-app switch writing `html[data-motion]`. Both gate JS (`reduced()`) and CSS (`html[data-motion=reduced] *{animation:none;transition-duration:.01ms}`) |
| Springs | `--tk-ease-spring` and `--tk-ease-magnet` are `linear()` inside `@supports` with `cubic-bezier` fallbacks (already emitted by `tokens.ts`). Springs are used in WAAPI via `easing: getComputedStyle(...)` |
| Fill mode | Entrance animations use `fill: backwards` so the element returns to its CSS state. Use `fill: both` only for the light that must stay where it ends |
| Cleanup | Cancel animations on unmount (`getAnimations({subtree:true})`). Disconnect the `IntersectionObserver` per screen |
| Map overlay | Contract in design-direction §6. Reproject on `moveend` and `resize` |
| Bundle | Budget 25 KB gzip for all motion code; estimate here 5 to 10 KB (about 3 KB JS minified, about 4 KB component CSS). No library |
| Do not | Animate layout properties, animate box-shadow or blur, add a second easing curve, start a loop that cannot pause, show "Haide!" anywhere else |

## 4. QA checks for `qa-reviewer`

1. Toggle OS reduced motion and the in-app switch on every screen: every moment shows its still version, no animation runs, no content is missing.
2. DevTools Performance: no long tasks over 50 ms, no layout or paint storms during route draw-in, price roll, seats, launch. Only the route draw-in and tiny SVG rings may paint.
3. Throttle CPU 4x: the launch and seat springs stay smooth enough to read; if not, drop the trail lights first.
4. Off-screen and hidden tab: loops pause (`document.getAnimations()` shows `paused`).
5. View transitions: forward and back on results to details to booking, no console warning about duplicate `view-transition-name`; works with the browser Back button; navigation is instant in Firefox before 144.
6. Request Seat and Publish ride: "Haide!" shows once, is not read by a screen reader, is absent offline and on error, and `grep '!' ` over the i18n resources finds only `launch.haide`.
7. Light and dark theme both checked; the `still` light is visible in light theme (saffron with an indigo ring).
