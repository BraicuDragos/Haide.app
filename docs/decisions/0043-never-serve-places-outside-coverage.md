# 0043. Never serve places outside coverage; curated routes may carry a display label

- **Status:** Accepted
- **Date:** 2026-11-23
- **Area:** Architecture
- **Agent:** backend-dev

## Context
The curated popular route Cisnădie to Centrul Istoric handed the app the gazetteer row "Cisnădie" (the whole locality, 45.6396, 24.0886). That point is south of `COVERAGE_BBOX` (`south 45.68`), which `POST /search` and publishing enforce, so opening the route answered `400 VALIDATION_FAILED, fields.from = outside_coverage` and the user saw "We couldn't load rides". Ten locality-level `area` rows of the gazetteer are outside coverage (Cisnădie, Sadu, Tălmaciu, Avrig, Orlat, Rășinari, Racovița, Gura Râului, Șura Mare, Ocna Sibiului), so the autocomplete led to the same wall.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. The API never returns a place outside coverage; curated ends use an in-coverage sub-area under a display label (this ADR) | Every offered place is usable; one rule for every endpoint; no data change | A whole town can no longer be picked, only its sub-areas | Low |
| B. Widen `COVERAGE_BBOX` to include the localities | Nothing is hidden | The box is shared with ORS routing, map tiles and the gazetteer build; the 10 rows are locality centroids, so searches would still be 8 to 10 km from the city | High, wide blast radius |
| C. Let the web client filter | No API change | Every client must repeat it; the popular-routes list could still be short | Medium |

## Decision
Option A. B is rejected.
- Pure helper `inCoverage(point)` (`_shared/domain/privacy.ts`, inclusive on the edges) and `COVERAGE_ENVELOPE` (`rules.ts`, the same box in `ST_MakeEnvelope` order, bound as SQL parameters, filtered with `geom && envelope`).
- `GET /places` (autocomplete, synthetic addresses), `POST /places/reverse` (nearby and area fallback), the popular-route place lookups and the curated lookup return no point outside the box. Ranking and the synthetic-address logic are unchanged. Typing "Cisnădie" still finds its sub-areas (Centru, Piața Nouă, ...).
- `mergePopularRoutes` drops any route, real or curated, with an end outside coverage; real routes are filtered before counting so the curated fill-up still reaches 3.
- Curated ends are `{ name, locality?, label? }`. Route 1 is `Centru` in `Cisnădie`, shown as `Cisnădie`: the Place keeps the id and point of Centru, `name` is the label and `secondary` keeps the real name ("Centru").
- Guards: a test that every curated end exists in `places.csv` as an `area` inside coverage, and an integration test that posts every `GET /popular-routes` item to `POST /search` and expects 200.

## Consequences
- A user can no longer pick a whole outlying town; the sub-areas replace it. Widening coverage later is one change to `COVERAGE_BBOX` (the SQL follows it).
- The coverage filter adds one envelope test (`&&`) per query; the volume (22,609 rows) makes this negligible.
- Display labels apply only to curated routes.
