# 0032. Product events: written by services in the state-change transaction, flat allow-listed props guarded by a CHECK, purged after 13 months

- **Status:** Proposed
- **Date:** 2026-11-17
- **Area:** Architecture
- **Agent:** software-architect

## Context
E7-1 needs 11 product events for the North Star and supporting metrics, with user ids and area labels only, never coordinates or phones, deleted after 13 months (G2). The table `app.analytics_events` (CHECK on `name`) exists since E0, every event is already written by E2-E5 services, and `app.run_retention()` already deletes rows older than 13 months (ADR 0030). What is missing is a guarantee that holds for future code: today only reviews and a few unit tests keep payloads clean, and the "every state change logs an event" rule (G2) has no completeness check.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Keep service-side emission in the same transaction (conventions §9), add a DB CHECK `app.event_props_ok(props)` (flat object, scalar values, strings ≤ 80 chars, forbidden keys) and an integration audit that drives every flow | Already built and tested; an event commits or rolls back with its state change; the CHECK makes a coordinate, phone or free-text leak fail at insert time whatever the code path | Two places to keep in sync (TS builders and the CHECK); a new event name is a migration | Low |
| B. Postgres triggers on `rides`, `bookings`, `ratings`, `reports` emit events | Cannot be forgotten by a new code path, works for the SQL console too | `search_performed` has no table; `late`, `by`, `responseSeconds` and area labels need context the trigger lacks or must re-derive; duplicates E2-E5 logic; harder to unit test | Medium |
| C. Third-party product analytics (PostHog EU, Plausible) | Dashboards for free | A client SDK and a new processor (DPIA, CSP, consent for device access under ePrivacy Art. 5(3)), against conventions §6.7 and the privacy baseline (ADR 0005) | Medium, recurring privacy cost |

## Decision
Option A. Events stay first-party, server-side and transactional; the database rejects any `props` that is not a flat map of short scalars or that carries a key such as `lat`, `lng`, `phone`, `plate`, `email`, `details`. Retention stays in `run_retention` (13 months) and `scrub_account` keeps nulling `user_id` on deletion. G2 is read as: the 11 E7-1 events are the product-analytics set; other state changes are already recorded in their own audit tables (`admin_actions`, `consents`, `account_deletions`, `data_requests`, `reliability_events`).

## Consequences
- Positive: a leak needs both a code bug and a schema change; lawful basis stays legitimate interest with no client-side tracking and no consent banner; no new processor.
- Negative / accepted risks: an event-less new flow is caught only by the integration audit, not by the DB; `ride_completed.seats` counts confirmed bookings at completion and can overstate after a late no-show (metrics read the bookings table instead, ADR 0034).
- Revisit if: product questions need funnels the 11 events cannot answer, or event volume makes the 13-month table a cost issue (then roll up weekly aggregates, which are not personal data).

## Sources
- [ePrivacy Directive 2002/58/EC, Art. 5(3) (storage on terminal equipment)](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32002L0058)
- [GDPR Art. 6(1)(f) and Art. 21 (legitimate interest, right to object)](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- Spec: `docs/architecture/e7-metrics-admin-spec.md` §1, §2. Related: ADR 0005, 0030
