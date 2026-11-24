# Analysis: Find screen polish, swipe between tabs, "choose on map", popular route fix

Written before implementation, from the code on `main` (f178f4b) and from measurements against the live API. Production claims are marked.

## 1. A popular route opens "We couldn't load rides"

**Reproduced against the live API.** `GET /popular-routes` returns the curated route Cisnădie to Centrul Istoric. Sending the exact `POST /search` body the app builds for it returns **HTTP 400 `VALIDATION_FAILED`, `fields.from = outside_coverage`** ("Both points must be in the Sibiu area"). The results screen shows only the generic "We couldn't load rides".

**Root cause.** The gazetteer row "Cisnădie" is the whole locality; its point (45.6396, 24.0886) is south of the coverage box (`south: 45.68`, `COVERAGE_BBOX`), which search and publish enforce. Measured over the whole gazetteer: **10 of 22,609 rows are outside coverage, all locality-level areas** (Cisnădie, Sadu, Tălmaciu, Avrig, Orlat, Rășinari, Racovița, Gura Râului, Șura Mare, Ocna Sibiului). So a user who picks "Cisnădie" in the autocomplete hits the same wall. The other two curated routes are inside coverage (checked) and work.

**Fix.**

1. Curated route 1 starts from the **centre of Cisnădie** (the gazetteer area "Centru", 45.7145, 24.1520, inside coverage) but is **displayed as "Cisnădie"** (a display label on the curated entry).
2. The server never offers a place the app cannot use: `searchPlaces`, the popular-route place lookups and the curated lookup skip points outside `COVERAGE_BBOX`; the popular-route merge drops a route whose end is outside coverage.
3. Typing "Cisnădie" still finds the usable sub-areas of Cisnădie (Centru, Piața Nouă, Stejarul...).
4. The results error says what is wrong ("That place is outside the area we cover") when the API reports `outside_coverage`, instead of the generic message.
5. Guards: a unit test that every curated end is inside coverage (against the gazetteer seed), and an **integration test that takes each popular route from `GET /popular-routes` and posts it to `POST /search`, expecting 200**. After deploy I repeat that check on the live API.

**Risks.** Low. Hiding the 10 locality rows removes a way to pick a whole town; the sub-areas replace it.

## 2. A more impressive hero on Find

**Current.** `RouteArt` draws one glowing road with a travelling headlight over a faint street grid (PR #28), all SVG with the shared motion helpers.
**Plan.** A small "night city" scene in the same technology (SVG, transform/opacity animation, no canvas and no libraries): three street layers with a gentle parallax that follows the finger or tilt, the main route drawing in with a glow trail, a few lights travelling at different speeds (some on side streets), pickup and drop-off pins that drop in with a ripple and pulse, a soft sweep of light across the headline once on load, and a calm idle loop. Honours both the OS and the in-app Reduce-motion settings (a still, finished picture), pauses when off screen or in a hidden tab, tokens only, fixed height (no layout shift), entry chunk budget kept. **"More wow" is subjective:** I will deliver it and show frames; tell me what to push further or tone down.

## 3. Swipe between pages

**Current.** Four root tabs in `Shell`/`TabBar`: Find, Offer, My rides, Profile; tab changes use a View Transition.
**Plan.** One gesture hook on the shell, active only on those four root screens. Tuned thresholds: horizontal travel of at least 64 px (or a fling above 0.45 px/ms over at least 32 px), mostly horizontal (|dx| at least 1.7 x |dy|), decided after the first 10 px so vertical scrolling is never blocked, a start zone that ignores the outer 24 px of the screen (Android back gesture and the iOS edge swipe), and no swipe when it begins on something that scrolls or drags sideways (map, wheel pickers, sliders, the cropper, text fields, open dialogs, anything marked `data-no-swipe`). Swiping left goes to the next tab, right to the previous one; it stops at the ends (no wrap). The change reuses the existing View Transition, with a direction-aware slide, and is instant with reduced motion. The constants are exported and unit tested; keyboard and the tab bar are unchanged. **Risk:** gesture feel can only be judged on a real phone; I will say so and keep the constants in one place so they are easy to tune.

## 4 and 5. Day and "Leave around": same size, alarm-style wheels

**Current.** Day is a native `<select>`, "Leave around" is the custom button from PR #28. On iOS a native select is taller than a button, hence the mismatch you see. The day list is the phone's default picker.
**Plan.** One shared `PickerField` trigger (identical height, icon, label and large value) for **both** fields, so they cannot differ on any platform, and one shared **wheel sheet** like an alarm clock: scroll-snap columns with a highlighted centre band, a soft fade at the top and bottom, a tick of feedback where supported. Day: one wheel (Today, Tomorrow, Mon 25 Nov...). Time: two wheels (hours 00-23, minutes in 5-minute steps), past times for today greyed and skipped. Keyboard and screen reader: each wheel is a labelled listbox with arrow keys, Home/End and type-ahead; a "Set" and a "Cancel" button; values stay `YYYY-MM-DD` and `HH:MM`, so forms and the API do not change. Used in Find, Publish (day and time) and the repeat "until" date, replacing the native select and date input. **Risks:** custom wheels need care on touch (scroll momentum, snap) and accessibility; covered by unit, keyboard and WebKit/Chromium layout tests, but real-phone feel is unverified.

## 6. Choose on the map (Find and Offer)

**Current.** No such option. The map stack exists and **is deployed**: MapLibre with a self-hosted Sibiu PMTiles file (6.2 MB, served from `/tiles/sibiu.pmtiles`, verified live), glyphs and sprites, and `POST /places/reverse` (nearest street, POI or address within 500 m, else the area). The place picker offers search and "Use my location" only.
**Plan.** A "Choose on map" button in the place picker (so Find and Offer both get it) opens a full-screen map limited to the Sibiu coverage box: a fixed centre pin, drag and zoom the map under it, a live address line from the reverse lookup (debounced), "Confirm" and "Cancel". Outside coverage the pin turns off and Confirm is disabled with a message. The result is a normal `Place`: the chosen coordinates (exact, not flagged approximate) and a label from the reverse lookup (the nearest address when within about 60 m, otherwise "Pin near Strada X" or the area name), at most 80 characters and never silently replaced. No new tile source and no new third party. If tiles fail to load it says so and offers search instead. Keyboard: arrow keys pan, plus/minus zoom, a labelled Confirm. **Risks:** map gestures on real phones, tile loading on slow networks, and the privacy note that the reverse lookup sends the pin to our own API only (not a third party).

## Needs your confirmation (my defaults in brackets)

1. "Wow" hero direction (night-city scene above; push or tone down after you see it).
2. Swipe order = tab bar order, stops at the ends, [no wrap].
3. Map label rule for a dropped pin [nearest address within about 60 m, else "Pin near ..."].
