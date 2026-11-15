# Technical backlog: E0–E8 (one PR each)

> Owner: software-architect · Date: 2026-11-15 · Consumes: [backlog.md](../product/backlog.md) (story IDs and acceptance criteria), [mvp-scope.md](../product/mvp-scope.md) §5
> Read first for every epic: [conventions.md](conventions.md), [data-model.md](data-model.md), [api-contract.md](api-contract.md), [architecture.md](architecture.md), UX: [ia-and-flows.md](../ux/ia-and-flows.md), [copy.md](../ux/copy.md), [prototype](../ux/prototype/index.html)

**How to use this file.** Each epic is one branch and one PR, in this order. "Done" means every listed acceptance check passes in CI, plus the product acceptance criteria of the referenced stories. Work split: **BE** = backend-dev, **FE** = frontend-dev, **QA** = qa-reviewer. BE and FE can run in parallel inside an epic once the contract schemas (`_shared/contracts`) for that epic are merged into the branch. BE writes them first.

| # | Branch | Epic | Size | Depends on | Product stories |
|---|---|---|---|---|---|
| E0 | `chore/scaffold` | Scaffold, CI, geo foundations | L | — | G1–G4 groundwork |
| E1 | `feat/accounts` | Accounts, profile, vehicle | M | E0 | E1-1…E1-6, E6-3 (pages) |
| E2 | `feat/rides` | Publish and manage rides + pricing | L | E1 | E2-1…E2-6 |
| E3 | `feat/search` | Search and matching | L | E2 | E3-1…E3-5 |
| E4 | `feat/bookings` | Booking lifecycle + notifications | L | E3 | E4-1…E4-7 |
| E5 | `feat/trust-safety` | Completion, ratings, safety | M | E4 | E5-1…E5-7 |
| E6 | `feat/privacy` | Privacy and compliance | M | E1–E5 | E6-1…E6-4 |
| E7 | `feat/metrics-admin` | Metrics and admin | S–M | E4 | E7-1…E7-4 |
| E8 | `feat/liquidity` | Liquidity boosters | M | E4 | E8-1…E8-6 |

Launch-ready = E0–E7. Phase 7 (deploy, [deploy.md](deploy.md)) follows GATE 3.

---

## E0: Scaffold, CI, geo foundations · `chore/scaffold` (Phase 5)

**Goal:** an empty but deployable-shaped app. Tab shell, API `/health`, database baseline with the gazetteer, green CI.

**BE tasks**
1. pnpm workspace, `tsconfig.base.json`, ESLint (flat config, with `no-restricted-imports` blocking `apps/web` → `_shared/domain`), Prettier, Vitest workspace, root scripts (conventions §2).
2. `supabase init`. `config.toml`: auth email OTP expiry 900 s, site URL `http://localhost:5173`, redirect `/auth/callback`, Google provider stubbed via env, `[functions.api] verify_jwt = false`.
3. Migration `…_baseline.sql`: extensions (postgis, pg_trgm, unaccent, pg_cron, pg_net), schema `app`, `REVOKE` for anon/authenticated, role `haide_api` + grants, `app.immutable_unaccent`, `app.grid_point`, `app.trim_route`, `app.area_for`, `app.rate_limit_hit`, tables `areas`, `places`, `rate_limits`, `app_errors`, `analytics_events`, `outbox`, enum types.
4. `scripts/geo/build-gazetteer.ts` (Overpass, bbox `45.68,23.98,45.86,24.32`): areas via Voronoi of place nodes clipped to localities, places = named streets + POIs + addresses. Output `supabase/seed/gazetteer/*.csv` plus a loader migration. A small sample goes in `seed.sql` for tests.
5. `scripts/geo/build-tiles.sh` → `apps/web/public/tiles/sibiu.pmtiles` (maxzoom 15, fall back to 14 if > 25 MiB) + glyph PBFs (ranges 0-255, 256-511, 512-767) + sprites. Document the refresh in the script header.
6. Edge Function `api`: Hono app, middleware (request id, JSON log, CORS, error envelope, auth via JWKS with a local-dev fallback to the local JWT secret, rate limit), `GET /health`, `GET /places`, `POST /places/reverse`, `POST /telemetry/error`, `POST /internal/tick` (no-op skeleton + secret check). `_shared/env.ts` validates env with zod at boot.
7. `_shared/domain` skeleton with `time.ts` (Europe/Bucharest helpers), `rules.ts` constants, `privacy.ts` (rounding helpers mirrored in SQL), `Clock`. `_shared/contracts` with the error-code enum + envelope schema.
8. `.github/workflows/ci.yml` (jobs `checks` and `integration`, architecture §12), `dependabot.yml`, `keepalive.yml` (disabled until the prod URL exists: `if: vars.PROD_API_URL != ''`), `backup.yml` (same guard), `deploy.yml` (guard `vars.DEPLOY_ENABLED == 'true'`, environment `production`).
9. `.env.example` with every variable from deploy.md §4.

**FE tasks**
1. Vite React TS app, vite-plugin-pwa (`injectManifest`), manifest (name "Haide", icons from `assets/brand/`, theme colour from tokens, `display: standalone`, `start_url: /find`).
2. `scripts/tokens.ts` → `tokens.css`. Tailwind v4 `@theme` wired to tokens. Self-hosted Bricolage Grotesque + Figtree with `latin-ext`.
3. App shell: bottom tab bar (Find, Offer, My rides, Profile) with badges slot, routes per ia-and-flows §2.1, skip link, focus-to-h1 on navigation, document titles, toast live region, error boundary → `/telemetry/error`.
4. i18n setup (`en.json`), `formatRon`, `formatTime`, `formatWalk`.
5. `api/client.ts` (base URL, JWT header, envelope → `ApiError`), TanStack Query provider.
6. Place picker sheet against `/places` (debounced 250 ms, diacritics demo "Selimbar"), "Use my location" (one-shot `getCurrentPosition` → `/places/reverse`).
7. `<RouteMap>` lazy component with PMTiles protocol, `maxBounds` Sibiu, `mode="approximate|exact"`, text alternative.
8. `_headers` (CSP from architecture §15, security headers) and SPA fallback.

**QA**: Playwright config (360×800, Chromium), smoke spec: open `/find`, tab navigation, place picker finds "Șelimbăr" from "Selimbar", axe clean.

**Acceptance checks**
- `pnpm lint && pnpm typecheck && pnpm test` green. `supabase db reset && supabase test db` green (grants test: anon/authenticated cannot read `app.*`).
- CI runs both jobs on the PR in < 12 min.
- `GET /health` 200 locally. `/places?q=selimbar` returns Șelimbăr first. `/places?q=piata mare` returns Piața Mare.
- Lighthouse (CI, mobile) on `/find`: PWA installable, accessibility ≥ 90. Initial JS ≤ 200 KB gzip.

---

## E1: Accounts, profile and vehicle · `feat/accounts`

**Stories:** E1-1…E1-6, plus the policy pages of E6-3 (content placeholders, versioned).

**BE**
1. Migration: `profiles` (+ trigger on `auth.users` insert), `vehicles`, `legal_documents` (seed terms 1.0 and privacy 1.0), `consents`, `reliability_events` (needed for profile counters), `ratings` (table only, for the public rating summary).
2. Gates middleware: `requireAuth`, `requireActive`, `requireConsent`, `requireProfile`, `requireVehicle`, `requireAdmin`.
3. Endpoints: `GET /legal/current`, `GET /me`, `POST /me/consents`, `PATCH /me/profile`, `PUT /me/photo`, `GET|PUT /me/vehicle`, `GET /users/{id}`.
4. Domain: `validation.ts`: first name (Unicode letters 1–30), Romanian mobile phone normalisation (`0721 234 567` → `+40721234567`; reject non-`+407`), plate normalisation, bio ≤ 200. Unit tests with diacritics (Ștefan, Țepeș).
5. Photo pipeline: magic bytes, ≤ 1.5 MB, decode + re-encode 512×512 JPEG (Jimp), upload to `avatars/<uuid>.jpg` with the secret key, delete the previous object. Test: an uploaded JPEG with GPS EXIF comes back without EXIF.

**FE**
1. Screens 1.1–1.7 (sign in, check email, agreement, profile setup, car, public profile, own profile) per the prototype and copy.md.
2. Supabase auth: Google OAuth and magic link (PKCE), `/auth/callback`, session persistence, sign-out clearing the query cache and replacing history (E1-6).
3. Onboarding orchestrator: 3 steps (passenger) or 4 (driver) with return-to-intent (ADR 0010). Decline consent → sign out.
4. Client-side photo resize (≤ 1024 px, canvas re-encode) before upload.
5. Policy pages `/policy/terms`, `/policy/privacy` (versioned placeholders with the controller placeholder), reachable signed out.

**Tests**: integration for every endpoint (including `CONSENT_REQUIRED` after a version bump, `PROFILE_INCOMPLETE`, phone/plate validation). The public profile never contains phone, plate or surname. E2E: magic-link sign-up via the local Inbucket/Mailpit mail catcher → consent → profile → car → sign out → back button shows no protected screen.

**Acceptance checks:** all E1 product AC. "Rating shows only when ≥ 3 ratings" is covered with seeded ratings.

---

## E2: Publish and manage rides + pricing engine · `feat/rides`

**Stories:** E2-1…E2-6.

**BE**
1. Migration: `energy_prices` (immutable, seed v1 from pricing.md §3), `route_previews`, `rides` + indexes (data-model §4.3).
2. **Pricing engine** `_shared/domain/pricing.ts` (architecture §6): `ratePerKmMicro`, `segmentCostMicro`, `seatPriceBani`, `quoteUpTo`, `relock`, `priceTable`, `tripCostBani`. **Tests (E2-5):** (a) trips A, B, C and the mixed-segment example to the exact bani. (b) fast-check: Σ prices ≤ n/(n+1) × trip cost. (c) price ≤ segment cost / 2. (d) always a multiple of 10 bani, rounded down. (e) `relock` never increases. Free ride → 0.
3. `RoutingProvider` interface + `ors.ts` (POST `/v2/directions/driving-car/geojson`, 5 s timeout, key from env, User-Agent "Haide/1.0") + `fixture.ts` (returns stored GeoJSON for known coordinate pairs, else a straight line with distance × 1.3). Route simplified at 10 m in SQL on insert.
4. Endpoints: `POST /rides/preview`, `POST /rides`, `GET /me/rides`, `GET /me/rides/{id}` (owner view, requests and passengers arrays empty until E4), `POST /rides/{id}/cancel`, `GET /rides/{id}` (public view with the trimmed route and 300 m grid points).
5. Rules: departure 15 min to 14 days ahead, seats ≤ vehicle seats, 1–40 km, **max 4 rides per driver per Europe/Bucharest day** (advisory lock + count, test with parallel publishes), vehicle snapshot, rate snapshot. Late cancel within 30 min → `late_cancel` + reliability event.
6. Analytics `ride_published`. Outbox rows for ride cancellation (sent once E4 adds dispatch. The rows are already written now).

**FE**
1. Offer gate (2.1), publish form (2.2) with From/To pickers, route calculation states, distance/duration, price table + "you recover about X of Y RON" line + "The price is set by Haide", day/time, seat stepper (limited to vehicle seats), note, free switch, disabled "Repeat on weekdays · Coming soon".
2. Ride published (2.4), Driving list (2.5) with Upcoming/Past tabs, driver ride detail (2.6) with an exact map, cancel sheet (2.7) with the late warning.
3. Inline errors for every 400/409 code of these endpoints.

**Tests**: pricing unit + properties (coverage ≥ 90 %). Integration: preview → publish → list → cancel. Daily limit (5th rejected). `PREVIEW_EXPIRED`. The public view has no exact origin/destination and no plate. E2E: driver publishes Trip B and sees 3.10 / 2.00 / 1.50 RON.

---

## E3: Search and matching · `feat/search`

**Stories:** E3-1…E3-5.

**BE**
1. Migration: `blocks` table (needed by the match filter), `app.match_rides(...)` (ADR 0015, architecture §5) with the time prefilter, corridor filter, linear referencing, ordering and limit, plus the `ride_id` parameter for single-ride re-checks.
2. pgTAP with fixture routes: Trip A matches a passenger at Shopping City → Piața Mare. The reverse direction does not match. Pickup 900 m away does not match. Segment < 1 km does not match. A loop route picks the dropoff after the pickup. Full ride excluded. Blocked driver excluded. Own ride excluded. Ordering by walk, then time.
3. Endpoints: `POST /search` (+ `nearestOutsideWindow` when empty), `POST /rides/{id}/match`. Price per result with `quoteUpTo` on `segment_m` and the ride's rate snapshot. Walk distances rounded to 50 m, points via `app.grid_point(…, 300)`, ETA rounded to 5 min.
4. `corridors.ts` + analytics `search_performed` (results count, area labels, corridor).
5. Rate limits: search 30/min per user or IP hash.
6. Performance test: 500 synthetic published rides in a window → `POST /search` p95 < 300 ms locally (budget 2 s in production).

**FE**
1. Find (3.1) with hero, From/To, swap, day, time, flexibility chips (±15/30/60, default 30), popular routes (the 3 corridors).
2. Results (3.2): skeleton, cards (time + price on top, route full width, walks, driver, rating, seats), sort note, blocked note, empty state with the nearest rides + a disabled "Notify me" slot (E8), offline error.
3. Ride detail (3.3): approximate map, area labels, walks, driver card → public profile, car without plate (locked row explaining why), note, price table, pay-directly line, sticky "Request seat" with disabled reasons from `/match`. Signed-out tap → onboarding → back to the same ride (E3-4).

**Tests**: integration verifies the response never includes exact coordinates (checked against the stored geometry: every returned point is a grid centre). Signed-out search works. E2E: visitor searches Șelimbăr → ZI Vest, sees the Trip B ride with "Up to 3.10 RON", opens the detail.

---

## E4: Booking lifecycle and notifications · `feat/bookings`

**Stories:** E4-1…E4-7.

**BE**
1. Migration: `bookings` + indexes and constraints (data-model §4.4).
2. Domain `booking.ts`: transition table + guards (exhaustive unit tests for every from/to pair), `expiresAt(requestedAt, departureAt)`, late-cancel rule.
3. Endpoints: `POST /bookings` (Idempotency-Key, match re-check, snapped points, quote), `GET /me/bookings`, `GET /bookings/{id}` (role-based serializer with the 24 h reveal window), `POST /bookings/{id}/approve` (transaction + `FOR UPDATE` + relock), `/reject`, `/cancel` (seat release + relock), `GET /me/summary`, `POST /me/summary/seen`. Fill `requests` and `passengers` in `GET /me/rides/{id}`. Ride cancel (E2) now cancels bookings.
4. `tick`: `app.expire_requests()` + outbox dispatch via `EmailProvider` (Brevo HTTP API; `console` provider in dev/CI writes to the log and to a test table), retry/backoff, daily cap 280, route-preview cleanup. pg_cron schedule migration (pg_net POST to the function URL with the secret from Vault. URL and secret are configured per environment).
5. Email templates (TS + `_shared/i18n/en.json`): new request (driver), approved, rejected, expired (passenger), ride cancelled (passengers), booking cancelled (driver). Labels and times only, plus a link.
6. Analytics: `booking_requested`, `booking_confirmed`, `booking_rejected`, `booking_expired`, `booking_cancelled`.

**FE**
1. Request sheet (4.1): summary, "Up to" price, who decides and until when (clock time), what stays approximate, Send request. Offline → IndexedDB queue with the idempotency key, flushed on `online`.
2. Booking detail (4.2), one screen for all states: banner, timeline, map (approximate ↔ exact), price card with the dropped banner, contact card (Call `tel:`, WhatsApp `https://wa.me/<digits>`), plate, cancel sheet (4.3) with the late warning.
3. Riding list (4.4). Driver ride detail: requests with Accept/Decline, price impact, passengers with contact. Tab badge from `/me/summary` (60 s polling while visible, refetch on focus).

**Tests**: **concurrency test**: 3 pending requests, 1 seat, parallel approvals → exactly 1 `confirmed`, 2 × `409 RIDE_FULL`, `seats_booked = seats_offered`. Price relock: P1 confirmed at 3.90 → P2 confirmed → P1 2.60, P2 1.20 (pricing §5 mixed example). P2 cancels → P1 stays 2.60. Expiry at min(+30 min, departure − 10 min) with an injected clock. Reveal window: phone/plate/exact present for confirmed parties, absent for a requester, a stranger and after departure + 24 h. Emails contain no coordinates, phone or plate (template snapshot tests). E2E: passenger requests, driver approves (two browser contexts), passenger sees the phone and plate.

---

## E5: Completion, ratings and safety · `feat/trust-safety`

**Stories:** E5-1…E5-7 (E5-6 and E5-7 are Should: include them if the PR stays reviewable, else they move to E8).

**BE**
1. Migration: `reports`, `admin_actions`, `share_links`, `app.complete_rides()` + pg_cron every 5 min, `app.admin_suspend_user(uuid, text)` (SQL path until E7).
2. Endpoints: `POST /bookings/{id}/no-show` (both directions, 24 h window, reliability events), `POST /bookings/{id}/ratings` (7-day window, immutable, tags per role, blind visibility in `PublicUser.rating` and the booking view), `POST /reports` (snapshot, optional block), `POST /blocks`, `DELETE /blocks/{userId}`, `GET /me/blocks`, `POST /bookings/{id}/share-link` + `GET /share/{token}` (S).
3. Suspension effects: gates return `ACCOUNT_SUSPENDED`. Future rides and bookings cancelled with notifications. Hidden from search and profiles (404).
4. Completion: confirmed → completed with `final_price_bani = price_locked_bani`, empty rides → `expired`, `ride_completed` event.

**FE**
1. Rate screen (5.1) with star radio group and tags, the blind-rating note, entry points on the booking, driver ride and cards.
2. Report sheet (5.2), block sheet (5.3), blocked people in Settings (6.3), no-show sheet (5.4) both sides, suspended banner (5.7).
3. (S) Share trip sheet (5.5) + public `/s/:token` page. Call 112 button (5.6) from departure − 15 min to + 2 h.

**Tests**: pgTAP for `complete_rides` (state + final price). Integration: rating window, duplicate, no-show booking cannot be rated, blind visibility (the ratee cannot see the rating until both rated or 7 days passed), block hides in both directions in search, profile and booking. Suspension cancels future rides. E2E: completed ride → both rate → ratings visible.

---

## E6: Privacy and compliance · `feat/privacy`

**Stories:** E6-1…E6-4.

**BE**
1. `app.run_retention()` + daily pg_cron: 90-day coarsening of rides and bookings (1 km grid, route NULL, labels → area, plate scrub), purges (events 13 months, reports 12 months, admin actions 24 months, outbox 30 days, errors 14 days, consents of deleted users 3 years, expired share links). **pgTAP proves no exact geometry older than 90 days remains** (E6-2).
2. `DELETE /me` (architecture §9 P6): cancel future rides and bookings with notifications, scrub, immediate coarsening of the user's history, null `analytics_events.user_id`, delete the avatar object and push subscriptions, `auth.admin.deleteUser`. Ratings by and about the user remain under a "Deleted user" tombstone. Reports kept.
3. `POST /me/data-export-request` (S) and `GET /admin/users/{id}/export` (S): JSON of profile, vehicle, rides, bookings, ratings given/received, consents, reports filed.
4. Legal documents v1 final text structure (controller placeholder, purposes, lawful bases P1, processors P8 from the DPIA, retention P5, rights, ANSPDCP), with the re-acceptance flow tested on a version bump.

**FE**
1. Settings (6.1), delete account screen (6.4) with 3 consequence lines, request-my-data row (6.5), final policy pages (6.2).

**Tests**: integration: after deletion, `GET /users/{id}` shows "Deleted user", counterpart bookings are cancelled with an email queued, no phone/photo/vehicle remains, sign-in fails. Retention pgTAP with a time-travelled fixture. E2E: delete account → signed out → profile URL shows "Deleted user".

---

## E7: Metrics and admin · `feat/metrics-admin`

**Stories:** E7-1…E7-4 (E7-1 events are already written since E2–E5. This epic verifies completeness and builds the views).

**BE**
1. SQL views/functions per ISO week (Europe/Bucharest): North Star (completed bookings), match rate overall and per corridor (`search_performed` with results > 0), fill rate, median response time (`decided_at − requested_at`), 4-week passenger retention cohort, reports per 100 completed rides, cancellation rate. Monitoring flag: drivers with > 40 completed bookings in 7 days (pricing §7).
2. Endpoints: `GET /admin/metrics`, `GET /admin/ops`, `GET /admin/reports`, dismiss/suspend/unsuspend (audited), `GET|POST /admin/energy-prices` (±30 % guard with override), `GET /admin/errors`.
3. Event audit test: each E7-1 event is emitted by its flow, and no event payload contains keys named `lat`, `lng`, `phone`, `plate` or `email` (recursive check).

**FE**
1. `/admin` (desktop-first, ia-and-flows §4 E7): metrics page (week selector, North Star with sparkline + table alternative, seven tiles with value, target and kill threshold), ops tile, reports queue with confirm dialogs, energy prices form with the large-change warning.

**Tests**: metrics SQL against a seeded week with known answers. Admin routes return 403 for normal users. E2E: admin suspends a reported user.

---

## E8: Liquidity boosters · `feat/liquidity` (Should, after launch if not ready)

**Stories:** E8-1…E8-6.

**BE**
1. Migrations: `ride_series`, `ride_alerts`, `push_subscriptions`, `rides.auto_accept` (column may already exist).
2. `POST /ride-series` (creates instances, each checked against the daily limit, reports skipped dates) + series cancel.
3. Alerts: `POST /alerts`, `GET /me/alerts`, `DELETE /alerts/{id}`. On `ride_published`, match active alerts (reuse `match_rides` logic in reverse: the alert's points against the new ride) and enqueue a notification within 5 min. Max 5 active, 14-day expiry.
4. Auto-accept in `POST /bookings` (eligible: not blocked, rating ≥ 4.0 or "New"). The overbooking guard still applies.
5. Web push: VAPID keys, `PUT/DELETE /me/push-subscription`, push channel in `tick` (web-push protocol via npm `web-push` or a minimal VAPID implementation). Email stays the fallback.
6. (C) `GET /me/stats/month`. Ride-wanted posts only if time allows (new table + endpoint, ADR first).

**FE**
1. Enable "Repeat on weekdays" (weekday chips + end date ≤ 4 weeks), the series cancel option.
2. "Notify me" on the empty state + alerts list in Settings.
3. Auto-accept switch on publish and the driver ride.
4. Push opt-in prompt only after the first booking or ride. Settings toggle. Service worker push handler.
5. (C) "This month you shared X RON of fuel costs" line.

**Tests**: series creation respects the 4/day limit. An alert fires once for a matching new ride and not for a non-matching one. Auto-accept under concurrency. Push payloads contain labels only.
