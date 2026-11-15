# Engineering conventions

> Owner: software-architect · Date: 2026-11-15 · Applies to every PR. Deviations need an ADR or the architect's sign-off.
> Related: [architecture.md](architecture.md) · [data-model.md](data-model.md) · [api-contract.md](api-contract.md)

## 1. Repository layout (pnpm workspace)

```
/
├─ apps/
│  └─ web/                         # React PWA (Vite)
│     ├─ public/                   # icons, manifest assets, fonts/, glyphs/, tiles/sibiu.pmtiles, _headers, _redirects
│     ├─ src/
│     │  ├─ app/                   # App.tsx, router.tsx, providers (QueryClient, i18n, auth)
│     │  ├─ api/                   # client.ts (fetch + error envelope), keys.ts, one file per resource (rides.ts, bookings.ts…)
│     │  ├─ auth/                  # supabase-js auth only, session hook, return-to-intent
│     │  ├─ features/<feature>/    # find, results, ride, offer, rides, booking, profile, settings, admin
│     │  │   ├─ screens/           # route-level components (one per screen in ia-and-flows §4)
│     │  │   ├─ components/
│     │  │   └─ hooks/
│     │  ├─ ui/                    # design-system primitives: Button, Sheet, Field, Chip, Badge, Toast, RouteRail, RouteMap
│     │  ├─ i18n/en.json           # all UI strings (keys from docs/ux/copy.md)
│     │  ├─ styles/                # tokens.css (generated), globals.css (Tailwind v4 @theme)
│     │  ├─ lib/                   # format (money, time, distance), offline queue, geolocation
│     │  └─ sw.ts                  # service worker (vite-plugin-pwa injectManifest)
│     └─ tests/                    # component/unit tests live next to code; this holds setup + MSW handlers
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/                  # YYYYMMDDHHMMSS_<snake_name>.sql, forward-only
│  ├─ seed.sql                     # energy prices v1, legal docs v1, small gazetteer sample for tests
│  ├─ seed/gazetteer/              # areas.csv, places.csv (full Sibiu build, ODbL), loaded by a migration helper
│  ├─ tests/                       # pgTAP: *.test.sql + fixtures/routes/*.geojson
│  └─ functions/
│     ├─ deno.json                 # import map: hono, zod, postgres, jose, imagescript
│     ├─ api/
│     │  ├─ index.ts               # Hono app, mounts routes, Deno.serve
│     │  ├─ middleware/            # auth.ts, cors.ts, errors.ts, logging.ts, rateLimit.ts, gates.ts
│     │  ├─ routes/                # places.ts, search.ts, rides.ts, bookings.ts, me.ts, admin.ts, internal.ts…
│     │  ├─ services/              # use cases + transactions
│     │  ├─ repo/                  # SQL only
│     │  └─ serializers/           # role-based output shaping
│     └─ _shared/
│        ├─ domain/                # PURE TS: pricing.ts, booking.ts, rules.ts, time.ts, privacy.ts, corridors.ts, validation.ts
│        ├─ contracts/             # zod request/response schemas + error codes (imported by apps/web via alias @contracts)
│        ├─ providers/             # routing/{ors,fixture}.ts, email/{brevo,console}.ts, clock.ts
│        ├─ i18n/en.json           # email strings
│        └─ db.ts, env.ts, errors.ts, log.ts
├─ tests/
│  ├─ integration/                 # Vitest, black-box against the local stack
│  └─ e2e/                         # Playwright specs per epic
├─ scripts/
│  ├─ geo/build-tiles.sh           # PMTiles extract
│  ├─ geo/build-gazetteer.ts       # Overpass → areas.csv, places.csv
│  └─ tokens.ts                    # docs/brand/design-tokens.json → apps/web/src/styles/tokens.css
├─ .github/workflows/              # ci.yml, deploy.yml, backup.yml, keepalive.yml; dependabot.yml
├─ .env.example                    # every variable, no values
├─ package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.js, .prettierrc, vitest.workspace.ts
└─ docs/
```

**Why `_shared/domain` and `_shared/contracts` live under `supabase/functions/`:** Edge Functions can only reliably import files inside `supabase/functions/`, and the web app can import from anywhere through a Vite/TS path alias. The web app imports **only** `contracts` (schemas, types, error codes), never `domain`. Pricing is server-only (G1). An ESLint `no-restricted-imports` rule enforces this.

## 2. Tooling and versions

- Node **24 LTS**, pnpm **10**, Deno 2 (the Supabase Edge Runtime version). TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- Pin exact versions in the lockfile. Use the latest stable majors at scaffold time: React 19, Vite, Tailwind CSS 4, TanStack Query 5, React Router 7, zod 4, Hono 4, MapLibre GL JS 5, Vitest, Playwright, postgres.js 3. Check current APIs with context7 before coding.
- Scripts (root `package.json`): `dev`, `build`, `lint`, `typecheck`, `test` (unit), `test:db` (`supabase test db`), `test:int`, `test:e2e`, `tokens`, `db:reset`, `fn:serve`.
- Domain code under `_shared/domain` must use **explicit `.ts` import extensions** and no runtime APIs (no `Deno.*`, no `process.*`, no `fetch`, no `Date.now()`; inject a `Clock`). It runs in both Node (Vitest) and Deno.
- New runtime dependency: justify it in the PR description (size, maintenance, licence). No UI kits. Allowed primitives: `@radix-ui/react-dialog` for sheets if the native `<dialog>` falls short.

## 3. Naming

| Thing | Convention | Example |
|---|---|---|
| DB tables, columns | snake_case, plural tables | `bookings.price_locked_bani` |
| JSON fields, TS variables | camelCase | `priceLockedBani` |
| TS types, React components | PascalCase | `BookingView`, `RideCard.tsx` |
| Hooks | `useX` in camelCase files | `useRide.ts` |
| Non-component files | camelCase | `pricing.ts`, `rateLimit.ts` |
| Error codes | UPPER_SNAKE | `RIDE_FULL` |
| i18n keys | dot.path, lower camel | `booking.status.confirmed`, `errors.RIDE_FULL` |
| Env vars | UPPER_SNAKE. Browser-exposed ones start with `VITE_` | `VITE_API_BASE_URL` |
| Migrations | timestamp + snake summary | `20261120093000_create_bookings.sql` |
| Branches / commits | per CLAUDE.md: `feat/<epic>`, Conventional Commits | `feat(bookings): approve with seat lock` |
| Domain glossary | `User`, `Vehicle`, `Ride`, `Booking`, `Stop`, `Rating` (carpool-domain skill). UI words per copy.md (never "fare", "earn") | |

Units are always in the name: `distanceM`, `durationS`, `priceBani`, `rateMicroPerKm`, `windowMin`, `*At` for timestamps.

## 4. Error handling

- **API:** throw `AppError(code, httpStatus, message, fields?)` from services and domain guards. The `errors.ts` middleware renders the envelope from api-contract §1.1. Unknown errors → `500 INTERNAL`, logged with `reqId`, and written to `app_errors` (message truncated, no request body).
- **Domain:** pure functions return values. Rule violations throw `DomainError(code)`, which the API maps one-to-one to an `AppError`.
- **Validation:** zod `safeParse` at the route boundary only. Inside services, types are trusted.
- **DB errors:** map unique violations to meaningful codes (`bookings_one_active_uidx` → `ALREADY_REQUESTED`) and check violations on `seats_booked` → `RIDE_FULL`. Never leak SQL text.
- **Upstream (ORS, Brevo):** 5 s timeout, one retry with jitter for idempotent calls. Then `ROUTING_UNAVAILABLE` / outbox retry.
- **Web:** `api/client.ts` throws `ApiError {code, status, fields}`. Screens show `t('errors.' + code)` with a fallback `errors.generic`. Field errors map onto form fields (`aria-invalid`, focus the first one, per accessibility.md). A global error boundary shows a retry screen and posts to `/telemetry/error`.
- Every screen implements **empty / loading / error / success** states (ia-and-flows §4).

## 5. Database rules

- All schema changes via migrations. `supabase db reset` must pass from zero.
- Every table: `ENABLE ROW LEVEL SECURITY`, no policies, and grants to `haide_api` only (data-model §5.1).
- Use constraints for invariants (CHECK, UNIQUE, partial unique) in addition to service checks.
- Multi-row state changes run in **one transaction** (`sql.begin`). Lock the ride row (`FOR UPDATE`) before changing seats or prices.
- Connection: `postgres(API_DB_URL, { prepare: false, max: 1 })` (transaction-mode pooler on port 6543), created once per isolate.
- No `SELECT *` in repositories. List columns explicitly, so new PII columns are never leaked by accident.
- Geometry in via `ST_SetSRID(ST_MakePoint($lng, $lat), 4326)`. Geometry out via `ST_AsGeoJSON` or `ST_X/ST_Y`, rounded in SQL (5 decimals exact, grid functions for approximate).

## 6. Privacy rules for code (checked in review)

1. Exact coordinates, phone numbers and plates leave the API **only** through the serializers that implement data-model §5.2. Integration tests assert their absence for every non-entitled role.
2. Never log request bodies, coordinates, phones, plates, emails or tokens. Log route templates, not raw URLs.
3. Location goes in POST bodies, never in query strings.
4. Analytics props: ids, area labels, counts and booleans only.
5. Emails: first names, area labels, times and a link. Nothing else.
6. Geolocation API only on an explicit user tap (`getCurrentPosition`), never `watchPosition`.
7. No third-party scripts, fonts, analytics or CDNs in the web app (CSP enforces this).

## 7. Testing rules

| Rule | Detail |
|---|---|
| Domain coverage | ≥ 90 % lines for `_shared/domain` (CI-enforced). Pricing invariants as fast-check properties (≥ 1,000 runs) |
| Every endpoint | Integration tests: happy path, unauthenticated, wrong user (404), validation error, and each documented business error code |
| DB | pgTAP for constraints, `match_rides`, jobs (expiry, completion, retention) and grants |
| Determinism | Inject `Clock`. No real network (`ROUTING_PROVIDER=fixture`, `EMAIL_PROVIDER=console`). Seeded randomness in property tests |
| E2E | One happy-path Playwright spec per epic at 360×800 + an axe scan of the screens touched. Selectors by role/label (`getByRole`), never CSS classes |
| Test location | Unit tests next to the code (`pricing.test.ts`). Integration in `tests/integration/<resource>.test.ts`. E2E in `tests/e2e/<epic>.spec.ts`. pgTAP in `supabase/tests/<topic>.test.sql` |
| Speed | Unit suite < 30 s. Total CI < 12 min |
| Fixtures | Real Sibiu route polylines (trips A, B, C from pricing.md) as GeoJSON. Factories for users, vehicles, rides, bookings |

## 8. Frontend rules

- Design tokens only (generated `tokens.css`, consumed via Tailwind `@theme`). No hard-coded colours, spacing or radii.
- Mobile-first: build at 360 px, check 390 and 430, then desktop (centred column with a max width). Touch targets ≥ 44 px. Primary action in the lower half.
- Accessibility per `docs/ux/accessibility.md` §3 and §5: one `h1` per screen, focus to `h1` on navigation, sheets with focus trap + Esc + return focus, `aria-live` for toasts, never colour alone.
- All strings via `t()`. Money via `formatRon(bani)` → `3.90 RON`. Times via `formatTime(iso)` in Europe/Bucharest, 24 h. Distances via `formatWalk(m)` → `150 m`.
- Server state via TanStack Query only. No global client store beyond auth and the offline queue. Invalidate the related queries after mutations.
- The map component is lazy-loaded and always paired with a text description of what it shows.
- `prefers-reduced-motion` disables the shimmer, sheet animation and price-drop pulse.

## 9. API rules

- One route file per resource. Each handler: parse → gates → service → serializer → JSON. Handlers stay at 25 lines or fewer.
- Gates as composable middleware: `requireAuth`, `requireActive`, `requireConsent`, `requireProfile`, `requireVehicle`, `requireAdmin`.
- Every state-changing service writes its analytics event and outbox rows **in the same transaction**.
- Time comes from the injected `Clock`. Business time rules (15 min, 14 days, 10 min, 30 min, 24 h, 7 days, the Europe/Bucharest calendar day) live in `_shared/domain/time.ts` and `rules.ts` as named constants.

## 10. PR checklist (qa-reviewer uses this)

- [ ] Lint, typecheck, unit, pgTAP, integration and E2E all pass in CI
- [ ] Acceptance criteria of the epic's stories met (backlog.md + backlog-technical.md)
- [ ] No new PII in logs, events, emails or unentitled responses (tests prove it)
- [ ] New env vars added to `.env.example` and deploy.md
- [ ] Migrations forward-only, reset cleanly, constraints and indexes as per data-model.md
- [ ] UI strings in `en.json`. Screens at 360 px have empty/loading/error/success states. Screenshots in `docs/screenshots/<epic>/`
- [ ] Docs updated if the contract or schema changed (api-contract.md, data-model.md)
