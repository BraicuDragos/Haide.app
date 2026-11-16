# PROGRESS — the team's shared memory

> Updated by the Orchestrator after every step. Read at the start of every session.

## Current state
- **Phase:** 6 — features. E-DM, E1, E2, E3 merged; E4 (bookings) QA-approved, PR on `feat/bookings`
- **Open PRs:** E4 PR (feat/bookings)
- **Approved gates:** GATE 1 (PR #1), GATE 2 (PR #2); merged: E0 #3, E1 #5, E-DM #6, E2 #7, E3 #8

## Done
- [x] Phases 1–4: strategy, brand "Haide", UX + prototype, architecture (ADRs 0001–0015)
- [x] Phase 5 — E0 scaffold + CI (PR #3, merged; CI green incl. integration)
- [x] E-DM — "Headlight" dark-first design + motion (ADRs 0016–0020): Sora, Lucide, motion tokens, route glow, price roll, seat picker, launch moment, Reduce-motion + Theme settings; QA APPROVED (383 unit, 68 Playwright, Lighthouse a11y 100, JS 152.6 KB gzip)
- [x] E1 — accounts (PR #5 merged), profile, vehicle: migration `20261116090000_accounts.sql` (6 tables, RLS), gates middleware, account endpoints, photo pipeline (Jimp), JWT iss check, bodyLimit; auth + onboarding + profile screens, policy pages. QA: APPROVED (292 unit tests, 30 mocked Playwright, initial JS 155 KB gzip)
- [x] E2 - publish and manage rides + pricing engine (`feat/rides`, working tree): migration `20261117090000_rides.sql` (energy_prices v1, route_previews, rides, route helpers), pricing.ts (integer bani, trips A/B/C + mixed example verified to the bani), ORS + fixture routing, 6 ride endpoints (preview, publish, list, owner view, cancel, public view), daily limit via advisory lock; offer form, published, driving list/detail, cancel sheet. QA: see below
- [x] E3 - search and matching (`feat/search`, working tree): migration `20261118090000_search.sql` (`app.blocks` with RLS and no policies, `app.match_rides`: pickup then dropoff by linear referencing, 800 m corridor, segment >= 1 km, walk-then-time order, loops, own/full/blocked/cancelled/departed excluded, PUBLIC EXECUTE revoked), `POST /search` (30/min, signed-out OK) and `POST /rides/{id}/match`, 404 for blocked pairs on `GET /rides/{id}` and `/match`, price per result from the ride rate snapshot (`quoteUpTo` on the segment; Selimbar to ZI Vest = 3.10 RON checked by hand), analytics `search_performed` without coordinates; Results, empty state, ride detail, Request seat gate with return-to-intent, shared-element transition, search kept in sessionStorage (no coordinates in URLs). QA: APPROVED after fixes (595 unit + 161 web unit, 107 Playwright passed twice, initial JS 156.1 kB gzip, audit clean)
- [x] E4 - booking lifecycle and notifications (`feat/bookings`): ADRs 0021-0023, spec `docs/architecture/e4-bookings-spec.md`, migration `20261119090000_bookings.sql` (bookings, ride-row lock, expire_requests, outbox, call_tick via pg_cron), request/approve/reject/cancel/summary endpoints, Brevo outbox emails, reveal rules; request sheet, booking detail, riding list, driver requests, badges. QA: APPROVED (748 server + 185 web unit, 145 mocked Playwright, initial JS ~158 kB gzip)

## Next step
- Owner merges E4 PR → E5 (ratings, no-show, reliability), then E6…E8. E-DM leftovers: match moment + live trip + shared-element ride morphs land with E3/E4 screens; real-phone fps, real tiles, screen readers unverified

## Not verified locally in E1 — CI must confirm
- Migration + pgTAP 004, `deno check/lint`, integration tests incl. Storage upload, real magic-link E2E, CI assumptions (`supabase seed buckets`, `supabase status -o env` keys, HS256 local JWT).
- Production later: create `avatars` bucket on hosted project, pin CSP `img-src` to the project host.

## Not verified locally in E2 - CI must confirm
- Migration 20261117090000 + pgTAP 005 (55 assertions, count checked by reading), `deno check/lint`, integration tests `tests/integration/rides.test.ts` (incl. parallel publish: 4 of 6), SQL in `api/repo/rides.ts` (for update of r, keyset cursor, generated route_utm). CI api.env already sets ROUTING_PROVIDER=fixture.
- Real ORS routing and key (fixture only so far). Lighthouse not run (not installed); axe 360x800 dark + light clean on every E2 screen.
- Energy price consumptions are assumptions (pricing.md section 3); electric price to verify before launch.
- Carry-forward: purge expired route_previews in tick (E4); activePassengerIds, pendingRequests and requests/passengers arrays are stubs until E4.

## Not verified locally in E3 - CI must confirm
- No Docker, Supabase CLI, Deno or psql on the review machine: migration `20261118090000_search.sql` + pgTAP 006 (53 assertions, count checked by reading), `deno check/lint`, `tests/integration/search.test.ts` (incl. the 500-ride perf run) and the SQL in `api/repo/search.ts` have only been read, never executed. CI sets `SEARCH_P95_MS=1000` for the perf gate (local default 300 ms) and `INT_DB_URL` defaults to the `supabase start` DB on 127.0.0.1:54322.
- Lighthouse not run (not installed); axe 360x800 dark + light clean on Results, empty, error and detail in the mocked Playwright specs. Real MapLibre tiles and a real phone are still unverified; the detail map shows its text fallback without tiles.
- Carry-forward: `nearestOutsideWindow` re-sorts the 50 best-by-walk same-day rides by time (a busy day could hide a closer-in-time ride); `hiddenBlockedCount` shares the 50-row limit with visible rides; the Request seat tap shows a "coming soon" toast until E4.

## Carry-forward findings (non-blocking)
- E1: imagescript replaced by pure-JS Jimp 1.6.1 (lazy import; native codec failed on Deno Edge Runtime); `PHOTO_MAX_PIXELS` lowered to 8 MP.
- E4: retention/cleanup for `app.rate_limits` and `app.app_errors` via `/internal/tick`.
- Every new migration must revoke PUBLIC EXECUTE on new `app` functions.
- E5 refines rating visibility (7-day / counter-rating); E6 adds `DELETE /me`.
- No Lighthouse step in CI yet. conventions.md says MapLibre 5; code uses v6. PMTiles offline caching TODO in `sw.ts` (E3).

## Blockers / what the owner needs to provide
- Nothing before Gate 3 (batch in `docs/architecture/deploy.md` §3). `haide.ro`/`haide.app` are taken; `haide.city`, `gohaide.app` look free — brand-guide domain advice needs updating.
- `gh` is at `C:\Program Files\GitHub CLI\gh.exe`; `pnpm` not on PATH locally (use `npx pnpm`).

## Not verified locally in E4 - CI must confirm
- No Docker/psql/Deno: migration, pgTAP 007 (78 assertions, counted), `tests/integration/bookings.test.ts` (concurrency C1-C6), pg_cron/pg_net/Vault path, real Brevo. Lighthouse not run; real tiles/phone unverified.
- Low findings: same Idempotency-Key + ride with different points replays the booking (spec says 400); list pill shows Ride cancelled when passenger cancelled first (needs cancelledBy on BookingListItem); BLOCKED reveals a block exists.
- Production: Vault secrets api_tick_url, cron_secret; EMAIL_PROVIDER=brevo + BREVO_API_KEY; disable Brevo open/click tracking; verify sender domain.
