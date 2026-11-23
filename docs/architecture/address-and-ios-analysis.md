# Analysis: any house number in address search, and "Leave around" on iOS

Status: analysis written before any implementation. Findings come from reading the code on `main` (f15f3e1) and from measurements described below. Statements about production are marked as such.

## Item 1. Address search must accept any house number

**Current behaviour.** There is **no external geocoder**. `GET /places` calls `searchPlaces` (`supabase/functions/api/repo/places.ts`), a SQL query over our own table `app.places`, loaded from `supabase/seed/gazetteer/places.csv`. That file is built from an OpenStreetMap extract by `scripts/geo/build-gazetteer.ts`. The web picker (`PlacePickerSheet.tsx`) can only choose one of the returned rows, and the ride label sent to the API is simply `place.name`.

**Root cause (verified against the data, not assumed).** The dataset has 22,609 places: 20,177 addresses over 828 streets, only 1,201 street rows (one point each), 1,175 POIs and 56 areas. For Negoveanu the whole dataset holds **one row**: `Strada Negoveanu 4` (45.785588, 24.174657). There is no street row for it at all. Typing "Negoveanu 2" fuzzy-matches that single row, so "4" is the only thing the user can pick. Nothing is "snapped" by the server; the number is missing from the data and the UI has no way to say "my number". The problem is general: 207 street names have addresses but no street row, 91 streets have a single known number, and 2,442 addresses carry a letter or slash suffix (`2A`, `2/B`), so many real numbers will always be absent.

**Proposed fix.**

1. A pure address parser (`_shared/domain/address.ts`): strips street-type words (`str`, `str.`, `strada`, `bd`, `bulevardul`, `calea`, `aleea`, `piata`, `intrarea`, `soseaua`, ...), `nr`, `nr.`, `no`, `#`; reads the number with optional letter or slash suffix (`2`, `2A`, `2/B`, `2 bis`), and optional `bl.`/`sc.`/`ap.` parts, which are kept in the label but do not move the point. Accepts either word order (`2 Negoveanu`). Diacritics are folded for matching only; the label keeps the street's canonical spelling from the data and the number exactly as typed.
2. A server resolver: when the query contains a number, find the street by name (street row and/or the known address points of that street, per locality) and return a **synthetic suggestion** first in the list, only when no exact address row already exists: `Strada Negoveanu 2`, `approximate: true`.
3. Position, best available first: (a) interpolate between the nearest lower and higher known numbers of the same parity (same side of the street) when they are at most 300 m apart; (b) otherwise the nearest known number of that street; (c) otherwise the street's own point. If the data has nothing for that street, no suggestion is invented (we cannot place it); the UI says so and the limitation is documented.
4. **Display text is never replaced**: the label is built from the street plus the typed number and is what gets stored. Coordinates are stored next to it, plus a flag.
5. **Storage (migration, additive, low risk):** `route_previews`, `rides` get `origin_approximate` and `destination_approximate` booleans (default false). Publish carries the flags from the picked `Place`; the owner view returns them. The search criteria keep the flag in the client state. No change to booking columns.
6. **Same component everywhere:** `PlacePickerSheet` is already used by Find and Publish (the only two address inputs); the picker shows an "Approximate position" hint on the synthetic row and after selection.
7. States: debounce (existing), loading, empty, error stay; very short input (below 2 characters) still returns nothing.

**Routing and matching.** Approximate points stay inside the coverage box and a few hundred metres of the true spot. openrouteservice is called once per route preview (cached in `route_previews`); this change adds **no** ORS calls, so its free limits are unaffected. ORS snaps coordinates to the nearest road. Search matching uses an 800 m corridor with walking-distance ordering, so a point within the 300 m interpolation bound does not change which rides match; the ride list shows the label, not the coordinates.

**Providers and terms.** Nothing is scraped and no paid API is added. Options, **for you to decide, not built**: (a) openrouteservice geocoding (Pelias) uses the same OSM data, has a small daily quota (so no per-keystroke use) and would not contain "Negoveanu 2" either; (b) the public Nominatim forbids autocomplete and heavy use; (c) hosted Photon is fair-use with no guarantee; (d) a **"pin on the map"** step (MapLibre is already in the app) is the honest fix for streets absent from the data. I recommend keeping our own gazetteer, shipping the interpolation now, and discussing (d) as a follow-up.

**Risks.** Approximate points are not exact: a pickup could be some tens of metres off, which the UI states. A street with no data cannot be offered. The migration is additive with defaults (low risk). Interpolation across a long, curved street is limited by the 300 m rule.

## Item 2. "Leave around" is too wide on iOS

**Which control.** One control only: `FindScreen.tsx`, the time field (label `find.time` = "Leave around", `id="find-time"`), in a two-column grid next to the day select. The publish screen has a similar pair labelled "Leaving at" (a different label, not the one you named); the repeat-ride "until" field is a native `type="date"`, the other iOS-sensitive input in the app.

**Reproduction attempt (WebKit, 320 / 375 / 390 / 430 px, iPhone 13 profile, with an added `webkit-iphone` Playwright project).**

- Current `main` (custom time button): no horizontal overflow, the time column ends exactly where the From field ends, both columns equal, at all four widths.
- **Live production** (read-only page loads): it serves the **old** build with the native `<input type="time">`. In WebKit it also shows no overflow at the four widths, with and without enlarged text.
- A deploy of PR #28 exists but is **not yet running** (its run is pending on the deploy approval; the earlier run was cancelled by newer merges), so what an iPhone shows today is still the native input.

**Honest conclusion.** I **cannot reproduce** the problem here. Playwright's WebKit is the Safari engine but not an iPhone: it has no native iOS time or date control, so it cannot show iOS's intrinsic input width, which is the usual cause (a native time/date input inside a grid cell with `min-width: auto` can be wider than its column). The old input was exactly that case, and PR #28 already replaced it with a button. I will not claim a fix I cannot see.

**Proposed work (low risk, defensive, all verifiable here).**

1. Harden the layout against the classic iOS causes regardless: two-column rows use `minmax(0, 1fr)` columns, children get `min-width: 0`, native-looking controls (`select`, `date`) get `appearance: none`-style sizing with `width: 100%`, `max-width: 100%`, `box-sizing: border-box`. Apply to Find (day, time), Publish (day, time, "until") and the shared control class.
2. Keep the new WebKit regression spec (`e12-find-width-webkit`): no element outside the viewport, no sideways scroll, "Leave around" aligned with the neighbouring fields, at 320/375/390/430 px, and also run it with a deliberately wide test control to prove the guard catches overflow.
3. Before/after screenshots for the PR (WebKit).
4. **I need your confirmation on a real iPhone** once the pending deploy is approved: if the field is still too wide, send a screenshot and the iOS version and I will fix the exact cause.

**Risks.** Layout CSS touched on shared classes; covered by the Playwright suite (Chromium) and the new WebKit spec. Android/desktop are checked by the existing 360 px suite plus a 1280 px check.
