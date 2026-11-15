# 0003. Pricing: fuel-only cost split with the driver, reference consumption per fuel type, round down

- **Status:** Proposed
- **Date:** 2026-11-15
- **Area:** Business
- **Agent:** product-strategist

## Context
Prices must be very low and provably below cost, so that carpooling stays cost-sharing rather than paid transport. They must also be simple to explain and impossible for drivers to inflate. Fuel was 9.81 RON/l (petrol) and 10.85 RON/l (diesel), national averages on 10 Nov 2026. Intra-city trips are 4–12 km. The MVP has no in-app payments.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Fixed price per seat = route cost / (seats offered + 1) | Price never changes. Simple | 1 passenger in a 4-seat car pays 1/5, so drivers get very little exactly when liquidity is low. Drivers game the seat count | Low |
| B. Segment cost / (confirmed passengers + 1), reference consumption per fuel type, round down to 0.10, price can only go down | True cost split. Meaningful contribution with 1 passenger. Provable cap (≤ 80% of fuel). No driver-entered consumption | Price varies with occupancy (mitigated by the lock) | Medium |
| C. Driver sets the price within a cap (BlaBlaCar style) | Driver flexibility | Drivers push to the cap, which weakens the non-commercial argument and adds UI and validation | Medium |

## Decision
Option B: `price_i = floor_0.10(segment_km × rate[fuel] / (n_confirmed + 1))`, locked so it never rises after confirmation. The rate is reference consumption × energy price from versioned config (petrol 0.687, diesel 0.651, LPG 0.428, hybrid 0.491, electric 0.238 RON/km). No floor and no platform fee in the MVP. Drivers may lower to free, never raise. Guardrails: max 4 passengers, max 4 rides per driver per day, publish ≥ 15 min ahead.

## Consequences
- Positive: typical prices are 1–4 RON (at or below the 3.5 RON bus ticket, 10–15 times below a taxi). The driver always pays ≥ 1/(n+1) of the fuel. Easy to unit-test.
- Negative / accepted risks: drivers recover at most 80% of fuel, so motivation is non-monetary. Reference consumption may differ from a given car. Electricity price and consumption values are assumptions.
- What would trigger revisiting: a legal review allowing a wider cost basis (e.g. wear), driver supply failing because the contribution is too low, or energy prices moving > 3% (config update only, not a new ADR).

## Sources
- [Fuel prices 10 Nov 2026 (Playtech / PretCarburant.ro)](https://playtech.ro/2026/benzina-si-motorina-s-au-ieftinit-in-romania-orasele-in-care-soferii-gasesc-cele-mai-mici-preturi/)
- [Sibiu taxi tariff (taxi-calculator.com)](https://www.taxi-calculator.com/taxi-rate-sibiu/1048)
- [OSRM router for worked-example distances](https://router.project-osrm.org)
- Full formula and worked examples: `docs/product/pricing.md`
