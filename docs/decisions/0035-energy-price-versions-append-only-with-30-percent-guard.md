# 0035. Energy price versions: append-only rows on a forward-only timeline, ±30 % guard with an audited override

- **Status:** Proposed
- **Date:** 2026-11-17
- **Area:** Architecture
- **Agent:** software-architect

## Context
E7-4 lets an admin add an energy-price version with `effective_from` without a deploy; the value must stay within ±30 % of the previous one unless explicitly overridden. Since E2, `app.energy_prices` rows are immutable (no UPDATE or DELETE for `haide_api`), `UNIQUE (fuel_type, effective_from)`, and every ride snapshots the version in effect at publish time, so a later change never alters a published ride. Pricing is server-side only (G1); a wrong price makes every new ride mispriced, which is a legal risk under the cost-sharing model.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Append-only, forward-only: `effective_from` between now (−5 min skew) and now + 30 days and later than every existing row of that fuel type; the guard compares price **and** reference consumption with the latest row of that fuel; `overrideLargeChange` lets it through and is stored in `admin_actions`; one advisory lock serialises inserts | Keeps E2 invariants; "previous value" is unambiguous; the guard is a pure TS function shared by service and tests; backdating is impossible, so published history never changes meaning | A mistaken scheduled row cannot be deleted from the UI (fix: owner deletes it in the SQL editor before it takes effect, runbook in deploy.md) | Low |
| B. Editable "current" row plus a history table | Simple form | Breaks the immutability that ride snapshots rely on (`rides.energy_price_id` FK) | Medium, high risk |
| C. Automatic import from a fuel-price site | No manual work | No free official API; scraping is fragile and may breach the site's terms; still needs the guard | Medium |

## Decision
Option A. The unit (`l` or `kWh`) is derived from the fuel type, not sent by the client. The boundary is inclusive: |new − prev| × 100 ≤ 30 × prev passes. Hybrid keeps its own row (petrol price, lower consumption); the form reminds the admin to update it when petrol changes.

## Consequences
- Positive: no deploy for price updates (pricing §3 update rule, monthly or > 3 % move); every change is attributable and explainable; a typo such as 98.10 instead of 9.81 is stopped.
- Negative / accepted risks: a real shock above 30 % needs the override (one extra checkbox); only one future row per fuel can be meaningfully scheduled at a time.
- Revisit if: prices move several times a month or the pilot adds regions with different prices.

## Sources
- `docs/product/pricing.md` §3 (update rule), §5 (worked examples)
- [PostgreSQL advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
- Spec: `docs/architecture/e7-metrics-admin-spec.md` §4. Related: ADR 0003 (pricing formula)
