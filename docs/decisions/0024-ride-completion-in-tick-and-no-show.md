# 0024. Ride completion runs as a step of the per-minute tick; accepted seats include completed and no-show

- **Status:** Proposed
- **Date:** 2026-11-16
- **Area:** Architecture
- **Agent:** software-architect

## Context
E5-1 completes rides at departure + 2 h: rides with confirmed bookings become `completed` (bookings too, with the final price frozen), rides without become `expired`. Completion must queue rating-prompt emails and a `ride_completed` analytics event in the same transaction (conventions §9), and those payloads are built by typed TS builders (ADR 0022). architecture.md planned a separate pg_cron job every 5 minutes. E5-2 adds `no_show`, which can happen before or after completion (departure to departure + 24 h), and E4 states the invariant `seats_booked = count(confirmed)`, which completion would break.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. SQL function `app.complete_rides(now, cutoff, limit)` called as a step of `POST /internal/tick`; it locks rides `FOR UPDATE SKIP LOCKED` and returns what changed, and TS writes the outbox and analytics rows in the same transaction | One scheduler, one entry point, pgTAP-testable SQL, emails reuse the TS template builders, at most 1 min lag | Tick does more work per run (bounded by a batch limit) | Low |
| B. Separate pg_cron job running pure SQL every 5 min (architecture.md) | Independent from the API being up | Outbox payloads would be built in SQL, duplicating the TS builders. A second cron job to monitor | Medium |
| C. Lazy completion when a booking or ride is read | No job at all | Metrics and emails never fire for rides nobody opens | Low, but wrong |

## Decision
Option A. The tick runs expire → **complete** → safety sweep → dispatch, so a ride's open requests are always expired before it completes. The seat invariant becomes `rides.seats_booked = count(bookings WHERE status IN ('confirmed','completed','no_show'))` ("accepted seats"): completion and no-show never touch `seats_booked`, and a cancelled ride still holds 0. Every no-show write locks the ride row first (ADR 0021), so it serialises with completion. A no-show is refused once either party has rated the booking, and a rating locks the booking row, so "no ratings between parties of a no-show booking" holds under concurrency.

## Consequences
- Positive: one scheduler and one place to test time-driven transitions. The E4 invariant tests keep working (completed and no-show only exist after departure).
- Negative / accepted risks: if the API is down, completion waits for the next successful tick (emails are late, not lost). A ride whose only passengers were marked no-show before +2 h ends `expired`; one marked after +2 h stays `completed`. Profile counters read bookings, so this does not distort them.
- What would trigger revisiting: tick runtime above about 20 s, or a need for completion without the API.

## Sources
- `docs/product/backlog.md` E5-1, E5-2
- ADR 0021 (ride row lock), ADR 0022 (outbox and tick)
- `docs/architecture/e5-trust-safety-spec.md` §3, §4
