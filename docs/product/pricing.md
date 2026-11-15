# Pricing — cost-sharing formula

> Owner: product-strategist · Date: 2026-11-15 · ADR: [0003](../decisions/0003-cost-sharing-pricing-formula.md)
> All prices are computed **server-side**. The driver can lower a price (down to free) but can never raise it.

## 1. Principles

1. **Split the fuel cost, never cover more than it.** The driver is always one of the people paying.
2. **Same car type, same price.** Passengers compare rides on time and convenience, not price.
3. **No inputs that drivers can game.** Drivers do not enter fuel consumption. They pick a fuel type, and the platform uses a reference consumption for it.
4. **The price can only go down after you book.** If more passengers join, everyone pays less. If someone cancels, nobody pays more.
5. **No money flows through the platform in the MVP.** The passenger pays the driver directly (cash or bank transfer / Revolut) the amount shown in the app.

## 2. Formula

```
rate_per_km[fuel]  = ref_consumption[fuel] / 100 × energy_price[fuel]        (RON/km)
segment_cost_i     = segment_km_i × rate_per_km[fuel]                       (RON)
raw_price_i        = segment_cost_i / (n_confirmed + 1)                      (+1 = the driver)
price_i            = floor_to_0.10( raw_price_i )                            (always round DOWN)
locked_price_i     = min( price_i at confirmation, price_i now )             (can only go down)
final_price_i      = locked_price_i evaluated at departure time
```

| Symbol | Definition |
|---|---|
| `segment_km_i` | Driving distance from passenger *i*'s pickup point to their dropoff point along the driver's route, from the routing service |
| `n_confirmed` | Number of confirmed passengers on the ride (all segments, max 4) |
| `fuel` | Fuel type of the driver's vehicle: `petrol`, `diesel`, `lpg`, `hybrid`, `electric` |
| `energy_price` | Platform config value with an effective date. **Never hard-coded.** |

The price shown in search results and at booking time assumes the passenger is the first one (`n_confirmed + 1` including them). It is labelled "up to X RON — drops if others join".

## 3. Reference rates (config v1, effective 2026-11-15)

| Fuel | Reference consumption | Energy price | Rate (RON/km) | Source / status |
|---|---|---|---|---|
| Petrol (standard) | 7.0 l/100 km | 9.81 RON/l | **0.687** | Price: national average on 10 Nov 2026 ([Playtech / PretCarburant.ro](https://playtech.ro/2026/benzina-si-motorina-s-au-ieftinit-in-romania-orasele-in-care-soferii-gasesc-cele-mai-mici-preturi/)). Consumption: **assumption** (typical urban compact car) |
| Diesel (standard) | 6.0 l/100 km | 10.85 RON/l | **0.651** | Same source. Consumption: **assumption** |
| LPG | 9.0 l/100 km | 4.76 RON/l | **0.428** | Same source. Consumption: **assumption** (LPG burns about 25% more volume than petrol) |
| Hybrid (petrol) | 5.0 l/100 km | 9.81 RON/l | **0.491** | Consumption: **assumption** |
| Electric | 17 kWh/100 km | 1.40 RON/kWh | **0.238** | **Assumption**: blended home and public charging price. Verify before launch |

**Why we use the national average and not the Sibiu minimum:** it is one public, citable number. Sibiu minimums on the same date (9.76 petrol, 10.78 diesel) are within 1% of it.

**Update rule:** the maintainer updates `energy_price` when the national average moves by more than 3% since the last update, checking at least monthly. Each ride stores the config version in effect **when it was published**, so later changes never alter a ride's price.

## 4. Caps, floors, rounding

| Rule | Value | Why |
|---|---|---|
| Rounding | **Down** to the nearest 0.10 RON | Rounding down guarantees mathematically that the cap holds. 10-bani coins exist, and bank transfers take any amount |
| Floor | **None.** A computed price can be as low as 0.00 | A floor (for example 1 RON) would break the cost cap on very short trips. The MVP has no card fees to cover |
| Driver "free ride" toggle | Driver may set price = 0 for a ride | Goodwill and community. Also legally cleanest |
| Driver price override upward | **Not possible** | Core legal guardrail |
| Max passengers per ride | 4 | Ordinary car. Keeps far below the 9-seat threshold used in transport licensing ([OG 27/2011 summary](https://WWW.RATBV.RO/uploads/documents/og27din2011.pdf)) |
| Ride-level cap (invariant, tested) | Σ final_price_i ≤ n/(n+1) × trip_cost ≤ 80% of trip fuel cost | The driver always pays at least 1/(n+1) of the fuel |
| Per-passenger cap (invariant, tested) | final_price_i ≤ segment_cost_i / 2 | Never more than half the fuel cost of your own segment |
| Minimum bookable segment | 1.0 km | Shorter trips should be walked. Avoids noise |

**Proof sketch of the ride-level cap:** each `segment_km_i ≤ route_km`. So Σ segment_cost_i/(n+1) ≤ n × trip_cost/(n+1). Rounding down and the `min()` lock only lower the sum.

## 5. Worked examples: three real Sibiu trips

Distances are driving distances from the OSRM public router (OpenStreetMap data), queried 2026-11-15 ([router.project-osrm.org](https://router.project-osrm.org)). Coordinates are approximate neighbourhood points.

### Trip A: Cisnădie (Str. Măgurii) to Piața Mare. 11.5 km, about 17 min, petrol car

`trip_cost = 11.514 × 0.687 = 7.91 RON`

| Passengers confirmed | Raw price each | **Price each** | Driver receives | Driver's share of fuel |
|---|---|---|---|---|
| 1 | 3.95 | **3.90 RON** | 3.90 | 51% |
| 2 | 2.64 | **2.60 RON** | 5.20 | 34% |
| 3 | 1.98 | **1.90 RON** | 5.70 | 28% |

**Mixed segments, same ride:** passenger P1 rides the full route. Passenger P2 boards at Shopping City (Șelimbăr), 5.39 km to Piața Mare. n = 2:
- P1: 7.91 / 3 = 2.64, so **2.60 RON**
- P2: 5.390 × 0.687 = 3.70, then 3.70 / 3 = 1.23, so **1.20 RON**
- The driver collects 3.80 RON, which is 48% of the trip's fuel. Cap: 3.80 ≤ 5.27 ✔

### Trip B: Șelimbăr (Shopping City) to Zona Industrială Vest (Str. Salzburg area). 9.6 km, about 17 min, diesel car

`trip_cost = 9.588 × 0.651 = 6.24 RON`

| Passengers | Raw | **Price each** | Driver receives |
|---|---|---|---|
| 1 | 3.12 | **3.10 RON** | 3.10 |
| 2 | 2.08 | **2.00 RON** | 4.00 |
| 3 | 1.56 | **1.50 RON** | 4.50 |

### Trip C: Hipodrom to the old town (Str. Cetății, near ULBS rectorate). 4.2 km, about 7 min, petrol car

`trip_cost = 4.234 × 0.687 = 2.91 RON`

| Passengers | Raw | **Price each** | Driver receives |
|---|---|---|---|
| 1 | 1.45 | **1.40 RON** | 1.40 |
| 2 | 0.97 | **0.90 RON** | 1.80 |
| 3 | 0.73 | **0.70 RON** | 2.10 |

### Comparison with alternatives (one person, same trips)

| Trip | Our app (1 passenger) | Tursib bus | Taxi (4.00 start + 4.00/km) | Bolt (per-km part only, ~3.04/km) |
|---|---|---|---|---|
| A: Cisnădie to centre, 11.5 km | **3.90** | 3.50* | ~50.10 | ~35 |
| B: Șelimbăr to ZI Vest, 9.6 km | **3.10** | 3.50* | ~42.40 | ~29 |
| C: Hipodrom to centre, 4.2 km | **1.40** | 3.50 | ~20.90 | ~13 |

\* Tursib 60-minute ticket of 3.5 RON (Tursib website, undated). Metropolitan lines and transfers may cost more: **assumption**. Taxi tariff: [taxi-calculator.com](https://www.taxi-calculator.com/taxi-rate-sibiu/1048), valid since 2025-01-01. Bolt rate is indicative and not Sibiu-specific: [bento.travel](https://www.bento.travel/compare/romania/bolt-ro-vs-speed-taxi-app-ro), Aug 2026.

**Takeaway:** we are priced at or below the bus and **10 to 15 times cheaper than a taxi**. Our edge over the bus is time and directness, not price.

## 6. Platform fee

| Phase | Fee | Mechanics |
|---|---|---|
| **MVP (pilot)** | **None** | No payments in the app. Zero fiscal and payment-licensing exposure (see [strategy.md §6](strategy.md#6-business-model-and-monetization)) |
| Later (only after liquidity targets and a legal review) | Optional **passenger booking fee**, flat, charged **on top** of the cost share and paid to the platform | Shown as a separate line. It never comes out of the driver's share and never goes to the driver, so the driver's take stays ≤ cost |
| Preferred later revenue | B2B (employers, campus, municipality) | See strategy §6. Does not touch the per-seat price |

## 7. Why drivers cannot turn this into a profit business

| Guardrail | Effect |
|---|---|
| Divisor includes the driver: n/(n+1) | Even a full car (4 passengers on the whole route) returns at most **80% of fuel** |
| Fuel-only cost basis (no depreciation, parking or time) | The most conservative cost basis. Anything above fuel would need justification |
| Reference consumption per fuel type, not driver-entered | No inflated "15 l/100 km" claims. LPG and EV drivers get their own lower rates, so cheap fuel cannot create a margin |
| Server-side price, no upward override | Drivers cannot set their own price |
| Price lock: can only go down | No surge, no renegotiation |
| Max 4 passengers, **max 4 published rides per driver per day**, publish ≥ 15 min before departure | Rules out taxi-like, on-demand operation. A ride is the driver's own pre-planned trip |
| Passengers can only join published rides (no "request a car to X") | No hailing. The driver chooses the route, passengers adapt |
| ToS: asking for more than the shown price is forbidden; "asked for extra money" is a report reason | Enforcement by community reporting and suspension |
| Monitoring flag | Admin review if a driver exceeds 40 completed bookings in 7 days |

**Earnings ceiling, illustrated.** A commuter drives Trip A twice a day for 22 working days, always with 3 passengers. Collected: 2 × 22 × 5.70 = **250.80 RON/month**. Fuel spent: 2 × 22 × 7.91 = **348.04 RON/month**. The driver is still **97 RON out of pocket**, with no profit possible by construction. For comparison, the same distance on Bolt grosses roughly 1,500+ RON. This is the gap that separates cost-sharing from paid transport.
