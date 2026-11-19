# 0036. Ride alerts: matched in the tick by reversing the search match, once per ride, deleted at expiry

- **Status:** Proposed
- **Date:** 2026-11-19
- **Area:** Architecture
- **Agent:** software-architect

## Context
E8-2: a passenger saves an alert (origin, destination, date or weekdays, time ± window) and must be notified within 5 minutes when a matching ride is published; max 5 active alerts, 14-day expiry. The match must mean exactly what search means (ADR 0015: walk ≤ 800 m, pickup before dropoff, segment ≥ 1 km, blocks, active driver), or users get alerts for rides that search would not show. Publishing must stay fast and must not fail because of alerts. Alert points are location data (E6 owes a retention rule, e6 spec §12), and a series can publish up to 29 rides at once.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Synchronous in the `POST /rides` transaction: find alerts for the new ride and insert outbox rows | Immediate | Adds latency and a failure mode to publish; a series multiplies it; the driver's request does work for other users | Low |
| B. Tick step: new rides carry `alerts_checked_at IS NULL`; `app.match_ride_alerts(now, 50)` marks them, prefilters alerts with GiST `ST_DWithin` of both alert points to the route, applies the time rule, confirms each candidate with `app.match_rides(…, p_ride_id)`, and inserts `ride_alert_hits (alert_id, ride_id)` with `ON CONFLICT DO NOTHING` | Publish untouched; one source of truth for matching; PK makes "once per ride" structural, also under overlapping ticks; hits from one run are grouped per alert (series → one message); ≤ 60 s + dispatch, inside 5 min | One more tick step; a ride locked by a booking writer waits one tick (`SKIP LOCKED`) | Low–medium |
| C. Database trigger on `rides` insert calling the match | No app code | Hidden logic in a trigger, same latency as A, hard to test and to group | Medium |

## Decision
Option B. Only alerts created **before** the ride count (an alert announces new supply). Notifications are push-first with email fallback (ADR 0038). Alerts are **deleted** (not coarsened) at `expires_at` by `run_retention` and at once by `scrub_account`; the hits cascade. Complexity per tick: R ≤ 50 new rides × (log A + k) index probes, k = alerts whose origin lies within 800 m of the route, then one single-ride `match_rides` per surviving candidate (O(1) geometry on a ≤ 40 km line).

## Consequences
- Positive: alerts and search can never disagree; no extra load on the publish path; the privacy rule is simple (nothing older than 14 days).
- Negative / accepted risks: a weekly alert whose window crosses midnight does not wrap (rare at the pilot); a busy corridor could send several alerts a day (no per-alert cap yet); expired alerts vanish from the list instead of showing "expired".
- Revisit if: a user receives more than 3 alert messages a day for one alert, or tick step 4 takes more than 5 s.

## Sources
- `docs/product/backlog.md` E8-2; ADR 0015 (route matching); ADR 0030 (retention in the tick)
- [PostGIS ST_DWithin (index-assisted)](https://postgis.net/docs/ST_DWithin.html)
- Spec: `docs/architecture/e8-liquidity-spec.md` §1, §3
