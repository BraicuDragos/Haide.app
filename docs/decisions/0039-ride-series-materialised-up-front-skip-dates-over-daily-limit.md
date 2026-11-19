# 0039. Ride series: every instance created up front in one transaction, dates over the daily limit skipped and reported

- **Status:** Proposed
- **Date:** 2026-11-19
- **Area:** Architecture
- **Agent:** software-architect

## Context
E8-1: a driver picks weekdays and an end date (≤ 4 weeks); the server creates individual rides that count toward the 4-rides-per-day limit, can be cancelled one by one or as a series, and are priced per instance. Normal rides may depart at most 14 days ahead. `POST /rides` already serialises publishing per driver with an advisory lock and counts the day's rides inside it. A stored "template" with points and route would be a new location store outside the 90-day coarsening and the pgTAP catalog guard (ADR 0030).

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Materialise all instances (≤ 29) in one transaction under the publish lock; a date over the limit, too soon, or in the DST gap is **skipped and reported**; the whole request fails only when nothing could be created | One lock, race-free limit; the driver sees every instance and every skipped date immediately; no template geometry; searchable and matchable (alerts) at once | Instances up to 28 days ahead (exception to the 14-day lead); energy price snapshot is the one in effect at creation | Low |
| B. Rolling creation: store a template, the tick creates instances 14 days ahead | Keeps the 14-day rule; later instances get later prices | Template must store the route (new geometry store); limit conflicts appear days later, after the driver left; extra tick job | Medium |
| C. All-or-nothing: reject the series if any date breaks the limit | Simple rule | One busy day blocks four weeks of commuting; the driver has to guess which date | Low |

## Decision
Option A. `ride_series` keeps only the schedule (weekdays, local time, start, end, status), no geometry; each ride copies the preview route as a normal publish does. Skips are reported as `{date, code}` with `DAILY_RIDE_LIMIT`, `DEPARTURE_TOO_SOON` or `INVALID_TIME`; when nothing is created the answer is `409 DAILY_RIDE_LIMIT` (or `400 no_dates`). Series cancel cancels every future published instance through the existing ride-cancel cascade. Series rows are deleted 90 days after their end.

## Consequences
- Positive: no new background job; limit and pricing rules are the existing ones; the privacy inventory gains no geometry.
- Negative / accepted risks: rides 15–28 days ahead exist (search allows 30 days, so they are findable); a price update during the 4 weeks does not reach existing instances (pricing §3 updates are monthly, ±30 % guarded).
- Revisit if: drivers ask for open-ended series, or energy prices move > 10 % within a month.

## Sources
- `docs/product/backlog.md` E8-1; ADR 0003 (pricing); ADR 0030 (retention); ADR 0035 (energy price versions)
- Spec: `docs/architecture/e8-liquidity-spec.md` §2
