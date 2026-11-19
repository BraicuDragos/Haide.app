# 0037. Auto-accept: eligibility checked and the seat confirmed inside the request transaction, under the ride lock

- **Status:** Proposed
- **Date:** 2026-11-19
- **Area:** Architecture
- **Agent:** software-architect

## Context
E8-3: with auto-accept on, an eligible request (requester not blocked, rating ≥ 4.0 or "New") is confirmed immediately, and the E4-2 overbooking protection still applies. E4 serialises every writer of a ride with a row lock on `rides` (ADR 0021) and keeps `seats_booked` equal to the accepted bookings, with the `rides_seats_booked_range` CHECK as backstop. Approve already relocks every confirmed price (only downwards). The rating shown publicly counts visible ratings only (ADR 0025).

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. In `POST /bookings`: after the existing guards and insert, still under the ride lock, evaluate eligibility and run the confirm routine extracted from approve (guarded update, seat +1, relock) | Same lock, same code path as a manual approve, so overbooking and pricing rules are reused, not duplicated; the passenger gets the answer in the same response | `createBooking` grows; the response may now be `confirmed` (FE must handle it) | Low |
| B. Insert as `requested`, then a tick step auto-approves pending requests on auto-accept rides | Request path unchanged | Up to a minute of "pending" for an "instant" feature; a second writer on the ride; the driver may manually act in between | Low–medium |
| C. Database trigger on booking insert | Atomic | Business rules (rating, relock, outbox, events) inside a trigger; untestable from the domain layer | Medium |

## Decision
Option A, with `confirmLocked()` in `services/bookingConfirm.ts` shared by approve and auto-accept. Eligibility is a pure function: fewer than 3 visible ratings, or a visible average ≥ 4.0. `BLOCKED`, `RIDE_FULL` and `NO_LONGER_MATCHES` keep failing before any insert. The driver receives `booking_auto_confirmed` instead of `booking_requested`; `bookings.auto_confirmed` and the `auto` prop on `booking_confirmed` record it. Switching auto-accept on never confirms requests that are already pending.

## Consequences
- Positive: concurrency guarantee is the E4 one (tested: two parallel requests for the last seat give one confirmation and one `RIDE_FULL`); no new background job.
- Negative / accepted risks: "New" users are trusted by default (product rule); median response time (E7) now includes 0-second confirmations, which is the passenger's real experience.
- Revisit if: no-shows or reports on auto-confirmed bookings exceed those on manual ones, then add "no reliability event in 90 days" to eligibility.

## Sources
- `docs/product/backlog.md` E8-3, E4-2; ADR 0021 (ride row lock); ADR 0025 (visible ratings)
- Spec: `docs/architecture/e8-liquidity-spec.md` §4
