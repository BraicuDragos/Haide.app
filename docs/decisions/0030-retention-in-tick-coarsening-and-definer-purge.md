# 0030. Retention runs inside the tick: coarsening every minute, row purges through one SECURITY DEFINER function

- **Status:** Proposed
- **Date:** 2026-11-17
- **Area:** Architecture
- **Agent:** software-architect

## Context
E6-2 requires exact ride and booking coordinates to be coarsened at least daily once the ride is 90 days old, and a test that proves no exact coordinates older than 90 days remain. Other periods (reports 12 months, admin actions 24 months, consents 3 years after deletion, analytics 13 months) need deletes on tables where `haide_api` has no DELETE grant on purpose (append-only proof). The architecture planned a separate daily `retention` pg_cron job; since E5, every scheduled step runs in the per-minute `haide-tick` (ADR 0024).

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Separate daily pg_cron SQL job `app.run_retention()` (original plan) | Pure SQL, independent of the API | A second scheduler path with its own failure handling and no `app_errors` record. A missed run delays everything by a day. Integration tests cannot trigger it through the API | Low |
| B. Tick steps: `app.coarsen_locations(now, 500)` every tick (invoker), `app.run_retention()` hourly (SECURITY DEFINER, uses `now()` only) | One scheduler, same error handling as E4/E5. Coarsening lag is minutes. The definer function is the only delete path for append-only tables, and it takes no clock argument, so a compromised API cannot purge early. Integration tests drive it with aged fixtures | Coarsening query runs every minute (a partial-index range scan, negligible) | Low-medium |
| C. All retention in TypeScript repos | Same language as the rest | Needs DELETE grants on consents, reports and admin actions for `haide_api`, which weakens the append-only guarantees. Harder to prove in pgTAP | Medium |

## Decision
Option B. Proof does not trust the `coarsened_at` flag: `app.location_retention_violations(now)` checks every ride and booking past the cutoff **by geometry** (a point must equal its own 1 km grid centre, no route, no note, no plate). pgTAP and integration tests assert it is empty, and deploy.md uses it as a production check. A pgTAP catalog guard compares every `geometry` column in schema `app` with the classified inventory, so a new location column fails CI until it gets a retention rule.

## Consequences
- Positive: one scheduler. Privacy-critical coarsening is minutes behind the 90-day mark, not up to a day. Append-only tables stay append-only for the API role.
- Negative / accepted risks: if pg_cron or the tick stops, retention stops with it (already true for expiry and dispatch; the uptime check covers it). Retention tests age the data rather than the clock.
- What would trigger revisiting: tick duration nearing the 1-minute budget, or table sizes where hourly batched deletes fall behind.

## Sources
- [EDPB Guidelines 01/2020 on connected vehicles (location minimisation and retention)](https://edpb.europa.eu/sites/default/files/consultation/edpb_guidelines_202001_connectedvehicles.pdf)
- [PostgreSQL: SECURITY DEFINER functions and search_path](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)
- Supersedes the `retention` cron row in `docs/architecture/architecture.md` (jobs table). Spec: `docs/architecture/e6-privacy-spec.md` §1, §3, §7
