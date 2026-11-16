# 0027. Suspension: a status flag set by SQL, with cascades done by a tick safety sweep

- **Status:** Proposed
- **Date:** 2026-11-16
- **Area:** Architecture
- **Agent:** software-architect

## Context
E5-5: a suspended user cannot use protected actions, their future rides are cancelled with passengers notified, and they are hidden from search. Until E7 an admin suspends through SQL (deploy.md: `select app.admin_suspend_user(...)`). The gates already return `ACCOUNT_SUSPENDED` and `match_rides` already requires an active driver. What remains is the cascade, which needs the same ride-cancel and booking-cancel logic, emails and analytics as E4. The same "eventually cancel what must not exist" need appears with blocks (ADR 0028).

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. `app.admin_suspend_user` does everything in SQL: status, cancel rides and bookings, outbox rows | Immediate and atomic | Duplicates the cancel cascade, the price relock and the email payloads in plpgsql | High |
| B. `app.admin_suspend_user` only flips `profiles.status` and writes `admin_actions`. A **safety sweep** step in the tick cancels, through the existing TS services, future rides of suspended drivers, active bookings of suspended passengers and active bookings between blocked pairs (50 of each per run) | One cascade implementation. Works the same for the SQL console now and the E7 admin endpoint later. Idempotent and self-healing | Up to about 1 minute of lag (gates block the user at once) | Low |
| C. Only an admin API endpoint now | Synchronous | Pulls E7 admin auth and UI work into E5. Console suspensions would still need a cascade | Medium |

## Decision
Option B. Sweep cancellations use `cancelled_by = 'system'`, never count as late cancellations and create no reliability events. Passengers of a cancelled ride get the `ride_cancelled` email in its neutral "system" wording. The driver gets `booking_cancelled` only for a confirmed seat. Nobody is told why. `app.admin_unsuspend_user` restores `active` and leaves cancelled items cancelled.

## Consequences
- Positive: suspension and blocking converge through one tested code path. The sweep also repairs any race in which a booking slipped through.
- Negative / accepted risks: for up to a minute, a suspended driver's rides may still show in search (`match_rides` already hides them through the driver status check, so the real exposure is only a ride detail that is already open).
- What would trigger revisiting: a need for an instant, auditable cascade from the E7 admin UI (the endpoint can call the sweep function for one user synchronously).

## Sources
- `docs/product/backlog.md` E5-5
- `docs/architecture/deploy.md` (operations table)
- ADR 0022, ADR 0024
