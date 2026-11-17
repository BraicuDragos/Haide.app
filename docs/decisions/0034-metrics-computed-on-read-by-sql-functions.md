# 0034. Metrics are computed on read by SQL functions from the domain tables, events only where no table exists

- **Status:** Proposed
- **Date:** 2026-11-17
- **Area:** Architecture
- **Agent:** software-architect

## Context
E7-2 needs seven weekly metrics (mvp-scope §4) per ISO week in Europe/Bucharest time, with targets and kill thresholds. Pilot scale is hundreds of rides a week. The bookings and rides tables keep status and every timestamp forever (coarsening only removes geometry, ADR 0030), while events are deleted after 13 months and `ride_completed.seats` can overstate when a no-show is marked after completion. Searches leave no row anywhere except `search_performed`.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. STABLE SQL functions return **counts** for one week (`metrics_week`, `metrics_match_by_corridor`, `metrics_seats_series`, `metrics_high_volume_drivers`); a pure TS module turns counts into rates, rounding and target status | Always consistent with the source of truth (no-shows, late cancels, deletions); pgTAP can assert exact counts on a seeded week; no job, no extra table; rates and thresholds unit-tested in TS | Recomputed on every page view (cheap at pilot scale, indexed by week); search history limited to 13 months | Low |
| B. Weekly rollup table filled by the tick | Fast reads, history survives the event purge | A second copy that drifts when a no-show or cancellation lands after the rollup; needs backfill and recompute logic | Medium |
| C. Compute in TypeScript from raw rows | One language | Moves thousands of rows over the pooler per view; ISO-week and DST logic duplicated; harder to prove | Medium |

## Decision
Option A. Booking metrics are attributed to the week of the ride's `departure_at`, response time to the week of `requested_at`, reports to `created_at`, searches to `occurred_at`, all with week bounds `(monday::timestamp at time zone 'Europe/Bucharest')` so DST weeks are 167 or 169 hours. Only the search match rate reads `analytics_events`.

## Consequences
- Positive: one definition per metric, in the database, tested with known answers; the admin page cannot disagree with the data.
- Negative / accepted risks: a page view runs about five indexed queries; the match-rate history ends at 13 months.
- Revisit if: the metrics call exceeds 500 ms p95 or history beyond 13 months is needed; then add option B as a cache of the same functions.

## Sources
- [PostgreSQL: AT TIME ZONE and date_trunc](https://www.postgresql.org/docs/current/functions-datetime.html)
- [PostgreSQL: ordered-set aggregates (percentile_cont)](https://www.postgresql.org/docs/current/functions-aggregate.html#FUNCTIONS-ORDEREDSET-TABLE)
- Spec: `docs/architecture/e7-metrics-admin-spec.md` §2. Product definitions: `docs/product/strategy.md` §7, `docs/product/mvp-scope.md` §4
