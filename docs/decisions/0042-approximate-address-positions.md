# 0042. Any house number in address search: own gazetteer plus synthetic, flagged approximate addresses

- **Status:** Proposed (owner to confirm the geocoder alternatives below)
- **Date:** 2026-11-23
- **Area:** Architecture
- **Agent:** backend-dev

## Context
Address search is our own table `app.places` (OpenStreetMap extract, `supabase/seed/gazetteer/places.csv`), not an external geocoder. It holds only the house numbers OSM knows: for "Negoveanu" there is one row, "Strada Negoveanu 4", so a user who types "Negoveanu 2" could only pick 4. 207 street names have addresses but no street row, 91 streets have a single known number and 2,442 addresses carry a letter or slash suffix, so missing numbers are the normal case. The label shown and stored must be what the user typed; the point only feeds routing and matching (800 m corridor, 300 m grid for other people), and the price and route never depend on a surveyed point.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Keep the gazetteer; add synthetic "approximate" suggestions for the typed number, placed from the street's known numbers (this ADR) | Works for every street we have data for; no new provider, no new quota, no extra routing call; label is exactly what was typed; honest flag | Position can be tens of metres off; a street with no data cannot be offered | Low (pure module, one query, two flags) |
| B. openrouteservice geocoding (Pelias) | Same vendor already used for routing | Same OSM data (would not contain "Negoveanu 2" either); small daily quota, so no per-keystroke use | Medium, adds a quota risk |
| C. Public Nominatim | Real geocoder | Autocomplete and heavy use are forbidden by its usage policy | Not allowed |
| D. Hosted Photon | Autocomplete friendly | Fair use only, no guarantee, third-party dependency for every keystroke | Medium |
| E. "Pin on the map" step (MapLibre is already in the app) | The honest fix for streets absent from the data; exact point | New UI flow, needs design | Medium (follow-up) |

## Decision
Option A now; B, C, D are **not adopted** and E is proposed as a follow-up. The owner is asked to confirm that no external geocoder or paid API should be added.

Rules (pure module `_shared/domain/address.ts`, SQL only fetches rows):
- **Parse** the query: street-type words and number markers removed (`str`, `strada`, `bd`, `calea`, `aleea`, `piata`, `nr`, `no`, `#` ...), diacritics folded for matching only, either word order, number with optional suffix (`2`, `2A`, `2 A`, `2/B`, `12 bis`; `2-4` counts as 2), `bl.`/`sc.`/`ap.` kept for the label and never moving the point.
- **Suggest** only when the query has a number and a street key of at least 3 letters, one synthetic place per locality (at most 2 localities), placed **first**, only when the street has no address with exactly that number and suffix, and only when the street has any data (a known number or its own point). With no evidence nothing is invented.
- **Position**, best first: the same number with another suffix; interpolation between the nearest lower and higher known numbers of the **same parity** when they are at most **300 m** apart; otherwise the nearest known number (same parity preferred, never extrapolated); otherwise the street's own point.
- **Label** = canonical street name from the data + the number exactly as typed (+ `, bl. B5, sc. 2` extras), at most 80 characters (extras are dropped first). The server never replaces it, and reverse geocoding is unchanged.
- **Contract:** `Place.approximate?: true` on synthetic places (id `approx:<base64url>`, deterministic). Preview takes `originApproximate` / `destinationApproximate`; they are stored on `route_previews` and copied to `rides` on publish; the owner view returns `origin.approximate` and `destination.approximate`.
- **Routing:** no extra ORS call. ORS snaps each coordinate to the nearest road within its default 350 m radius (error 2010 beyond it); an estimate that sits on or next to its street stays inside that radius.

## Consequences
- Positive: any number can be typed for any known street; the stored label is the user's own; additive migration with defaults; no new vendor, quota or cost.
- Negative / accepted risks: an approximate point can be some tens of metres off (the UI says so); the nearest-number fallback can be farther when a street is long and sparsely numbered; a street absent from the data cannot be offered; "9 Mai 3" style names that begin with a digit are read by the same rules (number last wins).
- Revisit when: pilot feedback shows wrong pickups, a street gap pattern appears, or the owner chooses E (pin on the map) or a geocoder.

## Sources
- `docs/architecture/address-and-ios-analysis.md` (item 1)
- openrouteservice error codes 2009 and 2010 and the default snapping radius (docs: Directions API, `radiuses`)
