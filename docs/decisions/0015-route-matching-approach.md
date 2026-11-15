# 0015. Route matching: PostGIS corridor match with linear referencing on stored route polylines

- **Status:** Proposed
- **Date:** 2026-11-15
- **Area:** Architecture
- **Agent:** software-architect

## Context
A ride matches a search when (backlog E3-1): it is published; departure is inside the window (±15/30/60 min); the passenger's origin and destination are each within **1 km walking** of the driver's route (a straight-line ≤ 800 m proxy is allowed); pickup comes before dropoff along the route; the segment is ≥ 1 km; a seat is free; and nobody is blocked. Results are sorted by total walk, then time difference, in under 2 s. Pricing needs the **segment driving distance along the driver's route**. Drivers never detour (mvp-scope Won't). The scale is about 30 rides in any time window.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. **PostGIS linear referencing**: store each ride's route as a LineString (WGS84 + generated UTM 35N copy), filter by time with a B-tree, by corridor with `ST_DWithin` on a GiST index, then `ST_LineLocatePoint` for pickup/dropoff fractions, order and segment length | One SQL function, exact geometry, indexes do the pruning. Segment distance comes from the stored polyline with no routing call. Easy to test with fixture routes | Straight-line walking is a proxy (it ignores rivers and rail lines). Loops can confuse "nearest point" (mitigated, see Decision) | Low |
| B. Grid/H3 cell sets: precompute the cells a route crosses, match by cell intersection in app code | Database-agnostic, cacheable | Cell-size trade-off, extra tables. Order and segment distance still need line geometry | Medium |
| C. Routing-based: per candidate, ask the router for walking distances and detour times | Most accurate walking distance | 2 to 4 router calls per candidate per search breaks the 2,000/day ORS quota and the 2 s budget, and sends every search location to a third party | High, and over quota |

## Decision
Option A, in a single `STABLE` SQL function `app.match_rides(...)`:
1. **Time and state prefilter** (B-tree partial index on `rides(departure_at) WHERE status='published'`): departure within the window, `seats_booked < seats_offered`, driver ≠ searcher, driver active, no block in either direction.
2. **Corridor filter** (GiST on `route_utm`): `ST_DWithin(route_utm, origin_utm, 800)` and the same for the destination. Metres in EPSG:32635 (UTM 35N covers Sibiu at about 24.15° E).
3. **Linear referencing:** `f_p = ST_LineLocatePoint(route, origin)`. `f_d` is located on `ST_LineSubstring(route, f_p, 1)` and rescaled, so the dropoff is always searched after the pickup. This removes most loop errors. Require `f_d > f_p`.
4. **Derived values:** walk distances = distance from each passenger point to its snapped point on the route (≤ 800 m). `segment_m = round(distance_m × (f_d − f_p))` (scaled to the router's distance, so the full route equals the router's number exactly). Require `segment_m ≥ 1000`. Pickup ETA = `departure_at + duration_s × f_p`.
5. **Sort** by `walk_pickup_m + walk_dropoff_m`, then `|departure_at − desired_at|`. Limit 50.

Route polylines are simplified at publish time (`ST_SimplifyPreserveTopology`, 10 m tolerance) to at most about 500 vertices. **Complexity:** with N stored rides, R rides inside the time window and V vertices per route, the cost is O(log N + R) for the index range scan plus O(R·V) for the geometry work. That is about 30 × 500 = 15,000 vertex operations per search at pilot scale, a few milliseconds. The GiST index keeps this sublinear in N as the history grows. The API then prices each result with the TypeScript pricing engine, using the ride's snapshotted rate (ADR 0003). The empty state reuses the same function with a same-day window, outside the requested one, limit 3.

## Consequences
- Positive: one indexed query, deterministic and testable (pgTAP against real Sibiu fixture polylines for trips A, B and C). No routing calls during search. Pricing uses the same `segment_m` the passenger saw, so the quote is stable.
- Negative / accepted risks: 800 m straight-line can be about 1.2 km of real walking across barriers (the Cibin river, rail lines). Accepted for the MVP, and the walk distance is shown so users judge. Repeated probing near a route's end could reveal roughly where a driver starts: mitigated by search rate limits, 50 m rounding of walk distances, 300 m grid rounding of points and route trimming in public views (see the DPIA).
- What would trigger revisiting: user complaints about unrealistic walks (switch to pedestrian-network distance from a self-hosted router), more than 1,000 published rides per window (add H3 pre-bucketing), or multi-city expansion.

## Sources
- [PostGIS ST_LineLocatePoint](https://postgis.net/docs/ST_LineLocatePoint.html) · [ST_LineSubstring](https://postgis.net/docs/ST_LineSubstring.html) · [ST_DWithin](https://postgis.net/docs/ST_DWithin.html)
- `docs/product/backlog.md` E3-1, E3-2 · `docs/product/pricing.md` §2
