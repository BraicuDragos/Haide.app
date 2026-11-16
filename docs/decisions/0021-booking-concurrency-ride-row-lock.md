# 0021. Booking concurrency: the ride row lock is the single serialization point

- **Status:** Proposed
- **Date:** 2026-11-16
- **Area:** Architecture
- **Agent:** software-architect

## Context
E4 adds several writers that touch the same ride: passenger request, driver approve and reject, passenger cancel, driver ride cancel (E2), and the per-minute expiry in `tick`. Approve must never overbook (E4-2, a test is required). Approve and cancel also recompute every confirmed passenger's locked price, which only goes down (E4-7). That computation needs a stable set of confirmed bookings. The stack is one Edge Function using postgres.js against Supabase Free, at pilot scale (a few hundred rides a day, at most 4 seats per ride).

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. `SELECT … FROM rides WHERE id = $1 FOR UPDATE` first in every transaction that changes a ride's bookings, then guarded `UPDATE`s. Keep the `rides_seats_booked_range` CHECK as a backstop | One rule that is easy to review. Gives the relock a stable confirmed set. Fixed lock order (ride, then bookings) means no deadlocks. Already used by the E2 ride cancel | Serializes writes per ride, which costs nothing at 4 seats and pilot volume | Low |
| B. Lock-free conditional `UPDATE rides SET seats_booked = seats_booked + 1 WHERE seats_booked < seats_offered` | No explicit lock, one statement | Still needs a lock or a retry to read a consistent confirmed set for the relock. Two ways of doing the same thing | Low to medium |
| C. `SERIALIZABLE` isolation with retry on `40001` | Correct for every interleaving without lock discipline | Needs a retry wrapper around every booking endpoint. Failures are harder to test and explain. postgres.js `begin` retries are hand-written | Medium |

## Decision
Option A. Every transaction that changes a ride's bookings or seats takes the ride row lock first (request, approve, reject, passenger cancel, ride cancel). Booking rows are changed only by guarded statements (`… WHERE id = $1 AND status = 'requested'`). The expiry job changes only `requested` rows, never seats or prices, so it takes no ride lock. The guard and the `expires_at > now()` check inside approve make expiry and approve mutually exclusive. A `23514` violation of `rides_seats_booked_range` maps to `409 RIDE_FULL`.

## Consequences
- Positive: no overbooking by construction, plus a CHECK backstop. Price relock runs on a consistent snapshot. Same pattern as E2. Concurrency tests are simple to write (`Promise.all` of approvals).
- Negative / accepted risks: writes to one ride are serialized (milliseconds each). A slow transaction holds the lock, so a statement timeout of 5 s is set on the API role's transactions in the booking service.
- What would trigger revisiting: lock waits showing up in p95 latency, or rides with many more seats (for example vans), which are out of scope by law.

## Sources
- [PostgreSQL 17: Explicit locking, row-level locks](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS)
- `docs/architecture/architecture.md` section 8 (approve sequence), `docs/product/backlog.md` E4-2, E4-7
