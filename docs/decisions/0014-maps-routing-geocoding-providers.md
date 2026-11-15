# 0014. Maps, routing and geocoding: self-hosted Sibiu vector tiles, openrouteservice routing, own Postgres gazetteer

- **Status:** Proposed
- **Date:** 2026-11-15
- **Area:** Architecture
- **Agent:** software-architect

## Context
We need three things. (1) A basemap on 4–5 screens. (2) Car routing once per published ride, for the polyline, distance and duration. (3) Address autocomplete with a Sibiu bias that ignores diacritics ("Selimbar" must find "Șelimbăr"), plus reverse geocoding to neighbourhood labels. Labels are used everywhere: cards, emails, analytics, 90-day coarsening. Constraints: free at pilot scale, OSM-based preferred, few third parties seeing user location (ADR 0005, strategy P8), and no policy violations. The public Nominatim server **forbids autocomplete** and caps traffic at 1 request/second. The public OSRM demo is **non-commercial only, 1 request/second, no guarantees**.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Freemium commercial APIs (MapTiler tiles + geocoding, Geoapify or LocationIQ) | Good quality, quick to integrate | Every keystroke and map view sends user IPs and locations to another processor. Daily quotas. API keys exposed in the browser. Terms change | 0 at pilot scale, more processors |
| B. Public OSM community services (OSM tiles, Nominatim, OSRM demo) | No accounts | Nominatim forbids autocomplete. The OSRM demo is non-commercial. OSM tile policy discourages app use. No SLA anywhere | 0, but policy breaches |
| C. **Hybrid**: **MapLibre GL JS + a self-hosted Protomaps PMTiles extract of the Sibiu area** served from our own Pages origin. **openrouteservice** (HeiGIT, Germany) for routing, called server-side only. A **local gazetteer in Postgres** (OSM streets, POIs, addresses and neighbourhoods for the Sibiu metro bounding box) with `unaccent` + `pg_trgm` for autocomplete and PostGIS for reverse geocoding | Map views and address searches never leave our infrastructure. Diacritics-insensitive search falls out of `unaccent`. No rate limits on the hot paths. Routing volume is tiny (fewer than 100 calls/day vs 2,000/day free) | We maintain two data builds (tiles and gazetteer, refreshed quarterly by script). OSM house-number coverage in Sibiu may be partial: the user refines with the map pin. One API key (ORS) | 0 RON. Medium one-time effort |

## Decision
Option C.
- **Tiles:** `scripts/geo/build-tiles.sh` runs `pmtiles extract` on the latest Protomaps daily build with bbox `23.98,45.68,24.32,45.86` and maxzoom 15. The output is served at `/tiles/sibiu.pmtiles` with self-hosted glyphs, including the `512-767` range for ș and ț, and sprites. Fallback (env switch `VITE_MAP_STYLE_URL`): the OpenFreeMap public style (no key, no cookies, commercial use allowed with attribution). Attribution is "© OpenStreetMap contributors, Protomaps".
- **Routing:** openrouteservice `driving-car` (Standard plan: 2,000 directions/day, 40/minute) from the API only, sending coordinates without any user identifier. Results are cached in `route_previews` (30 min). For local dev and CI only, a fixture router (`ROUTING_PROVIDER=fixture`). The OSRM demo is allowed only as a manual dev fallback, never in production.
- **Geocoding:** tables `areas` (neighbourhood polygons: Voronoi cells of OSM `place=suburb|quarter|neighbourhood` nodes clipped to localities) and `places` (streets, POIs, addresses). Built by `scripts/geo/build-gazetteer.ts` from one Overpass export and loaded as seed data under ODbL. Endpoints: `GET /places?q=` and `POST /places/reverse`.

## Consequences
- Positive: zero per-user third-party location exposure for maps and search. No quota on the hot paths. Fast autocomplete (under 50 ms in the database). Labels and coarsening use the same `areas` table, so they are consistent.
- Negative / accepted risks: quarterly data refresh (a documented script, about 15 minutes). Extract size is an estimate (under 25 MiB expected; if larger, drop to maxzoom 14 and overzoom). ORS has no SLA: if it is down, publishing shows "Route service unavailable, try again" while search and booking keep working.
- What would trigger revisiting: expansion beyond Sibiu (switch to a provider or a self-hosted Photon/Valhalla), ORS quota above 1,500/day, or users reporting missing addresses (add Photon as a server-side fallback).

## Sources
- [Nominatim usage policy (max 1 req/s, no autocomplete), checked 2026-11-15](https://operations.osmfoundation.org/policies/nominatim/)
- [OSRM demo server policy (1 req/s, non-commercial, no guarantees), checked 2026-11-15](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server)
- [openrouteservice plans (Standard: directions 2,000/day, 40/min), checked 2026-11-15](https://openrouteservice.org/plans/)
- [OpenFreeMap (no limits, no keys, no cookies, commercial use with attribution), checked 2026-11-15](https://openfreemap.org)
- [pmtiles CLI (extract by bbox, maxzoom)](https://docs.protomaps.com/pmtiles/cli) · [Protomaps basemap downloads](https://docs.protomaps.com/basemaps/downloads)
