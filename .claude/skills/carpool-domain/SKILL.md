---
name: carpool-domain
description: Domain knowledge for the intra-city carpooling app — glossary, cost-sharing pricing principles, route matching concepts, trust & safety, and legal/privacy checkpoints. Use when working on product scope, pricing, matching, data model or booking logic.
user-invocable: false
---

# Carpool domain knowledge

## Glossary (use these names in code and docs)
| Term (code) | UI label | Meaning |
|---|---|---|
| `User` | user | Account; can act as driver and/or passenger |
| `Vehicle` | vehicle | Car owned by a driver (seats, fuel type, consumption) |
| `Ride` | ride / route | A trip published by a driver: origin, destination, optional waypoints, departure time, seats offered |
| `Booking` | booking | A passenger's seat(s) on a Ride; states: `requested → confirmed → completed` / `cancelled` / `rejected` |
| `Stop` | stop | Pickup/dropoff point along a Ride |
| `Rating` | rating | Mutual rating after a completed Ride |

## Pricing principles (cost-sharing)
- The driver **shares costs**, not makes profit. This is what keeps carpooling distinct from paid
  transport (taxi/ride-hailing), which is licensed. **The product-strategist must verify the current
  Romanian/EU legal position and cite sources** — treat this as an assumption until verified.
- Baseline formula to evaluate (strategist finalises it):
  `trip_cost = distance_km × consumption_l_per_100km / 100 × fuel_price_ron_per_l (+ parking/tolls if any)`
  `price_per_seat = trip_cost / (passengers + 1)` — the driver pays a share too.
- Consider: minimum price floor (payment fees), cap = trip_cost / (passengers + 1) so the driver can
  never earn more than their share, rounding to 0.50 RON, platform fee options.
- Fuel price changes → never hard-code; make it configurable / periodically updated.
- Prices are computed **server-side only**.

## Route matching concepts
- A passenger request = (origin, destination, desired time window). A Ride matches if:
  1. departure time within the window;
  2. pickup and dropoff are within a max **detour** of the driver's route (e.g. distance from point to route
     polyline, or extra time added) — tolerance is a product decision;
  3. pickup comes before dropoff along the route direction;
  4. seats are available.
- Intra-city trips are short (2–15 km): detour tolerance must be small; walking to a pickup point is acceptable.
- Geospatial indexing (e.g. PostGIS, geohash) is an architect decision.

## Trust & safety (MVP candidates)
Phone verification, profile photo, ratings, cancellation rules, share-trip-status link, report/block user,
clear meeting point. Strategist decides what's MVP.

## Privacy (GDPR — General Data Protection Regulation)
- Location data is personal data: collect the minimum, show exact addresses only to confirmed booking parties,
  define retention, provide account deletion.
- Store consent; document data flows in architecture docs.
