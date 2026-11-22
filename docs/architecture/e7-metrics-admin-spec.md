# E7 implementation spec: metrics and admin

> Owner: software-architect · Date: 2026-11-17 · Branch `feat/metrics-admin` (from `main` after #10/#11) · Stories E7-1 to E7-4 (E7-3, E7-4 are Should, included), E5-5 UI, G2
> Inputs: [backlog E7](../product/backlog.md), [mvp-scope §4](../product/mvp-scope.md) (targets), [strategy §7](../product/strategy.md) (definitions), [pricing §3, §7](../product/pricing.md), [ia-and-flows §4 E7](../ux/ia-and-flows.md), [design-direction](../brand/design-direction.md), [e5 spec](e5-trust-safety-spec.md), [e6 spec](e6-privacy-spec.md), [api-contract §7, §11](api-contract.md)
> New ADRs: [0032 events](../decisions/0032-product-events-service-side-flat-props-13-month-purge.md) · [0033 admin role](../decisions/0033-admin-role-profile-flag-and-audited-sql-actions.md) · [0034 metrics in SQL](../decisions/0034-metrics-computed-on-read-by-sql-functions.md) · [0035 energy prices](../decisions/0035-energy-price-versions-append-only-with-30-percent-guard.md)

## 0. Decisions in one screen

| Topic | Decision |
|---|---|
| Events (E7-1) | Already emitted by E2-E5 services in the state-change transaction. E7 adds a DB guard `app.event_props_ok(props)` (CHECK), one typed registry `_shared/domain/events.ts`, and an integration audit that drives all 11 flows. Retention stays in `run_retention` (13 months); `scrub_account` keeps nulling `user_id` (ADR 0032). No new tick step |
| G2 | The 11 E7-1 events are the analytics set. Other state changes are audited in their own tables (`admin_actions`, `consents`, `account_deletions`, `data_requests`, `reliability_events`). Admin writes are never analytics events |
| Metrics (E7-2) | STABLE SQL functions return **counts** for one ISO week (Europe/Bucharest, Monday 00:00 local); `_shared/domain/metrics.ts` turns them into rates, rounding and status vs target/kill. Booking metrics read `bookings`/`rides`, only match rate reads events (ADR 0034) |
| Admin role | `profiles.role = 'admin'` set by SQL only; `requireAdmin` (active + role, re-read per request); lazy `/admin/*` routes in the PWA; every admin write = one SQL function + `admin_actions` row in the same tx (ADR 0033) |
| Reports (E7-3) | Queue with dismiss / suspend / unsuspend, each confirmed and audited. Suspend sends an `account_suspended` email (ground, statement, appeal by reply: DSA Art. 17); unsuspend sends `account_reinstated`. Cascades stay in the tick sweep (ADR 0027) |
| Energy prices (E7-4) | Append-only, forward-only timeline; ±30 % guard on price **and** consumption vs the latest row of that fuel; `overrideLargeChange` audited; unit derived from fuel type (ADR 0035) |
| Not in E7 | Admin export endpoint (ADR 0031 keeps it SQL-only; `GET /admin/users/{id}/export` is dropped from api-contract §7), MFA, role management, rollup tables |

## 1. Migration `supabase/migrations/20261122090000_metrics_admin.sql`

Forward-only, header points here, `SET search_path = app, extensions, pg_catalog` on every function, PUBLIC EXECUTE revoked on every new function, `REVOKE ALL … FROM anon, authenticated` repeated. No new tables.

**Changes:**
- `app.event_props_ok(p jsonb) → boolean` IMMUTABLE: `jsonb_typeof(p) = 'object'`, ≤ 12 keys, every value is string/number/boolean/null, strings ≤ 80 chars, keys ≤ 40 chars and `lower(key)` not in (`lat, lng, lon, latitude, longitude, coordinates, point, geom, geometry, origin, destination, pickup, dropoff, phone, phonee164, plate, email, details, note, firstname, name`). Then `ALTER TABLE app.analytics_events ADD CONSTRAINT analytics_events_props_ok CHECK (app.event_props_ok(props))` (validated: existing rows must pass).
- `admin_actions.action` CHECK re-created: `('suspend','unsuspend','dismiss_report','energy_price_added')`.
- Indexes: `rides_departure_idx (departure_at)` (all statuses), `bookings_requested_idx (requested_at)`, `admin_actions_created_idx (created_at)` (24-month purge), `admin_actions_report_idx (report_id)`.

**Functions:**

| Function | Kind | Behaviour |
|---|---|---|
| `app.admin_suspend_user(p_user_id, p_reason, p_admin_id default null, p_report_id default null, p_reason_code text default 'other')` | invoker | **Drop** the 4-arg E5 version and recreate with the 5th arg (avoids an ambiguous overload; deploy.md calls keep working). Same body; `details = {reason, reasonCode}`. `p_reason_code` CHECK against the `report_reason` labels |
| `app.admin_dismiss_report(p_report_id uuid, p_admin_id uuid, p_note text)` → boolean | invoker | `open` → `dismissed`, `resolved_at/by`; inserts `admin_actions ('dismiss_report', target = reported_id, report_id, {note})`. Not open → false |
| `app.outbox_recipients(p_user_ids uuid[], p_include_suspended boolean)` → `(user_id, email)` | **definer** | New 2-arg overload (no default, so no ambiguity): `status = 'active' or (p_include_suspended and status = 'suspended')`; never `deleted`. Fixes E6 `data_export_ack` to suspended users too |
| `app.metrics_week(p_week date, p_now timestamptz)` → one row of counts (§3) | STABLE, invoker | Raises `22023` when `p_week` is not a Monday. Bounds `from = p_week::timestamp at time zone 'Europe/Bucharest'`, `to = (p_week + 7)::timestamp at time zone …` |
| `app.metrics_match_by_corridor(p_week date)` → `(corridor text, searches int, matched int)` | STABLE | `search_performed` in the week, `coalesce(props->>'corridor','other')`, matched = `(props->>'resultsCount')::int >= 1`. Always returns the 4 corridors (zeros) |
| `app.metrics_seats_series(p_last_week date, p_weeks int)` → `(week date, completed_seats int)` | STABLE | `generate_series` of Mondays, zeros included, `p_weeks` ≤ 26 |
| `app.metrics_high_volume_drivers(p_until timestamptz, p_min int)` → `(driver_id uuid, completed int)` | STABLE | Completed bookings on rides departing in `(p_until − 7 d, p_until]`, `HAVING count > p_min` (pricing §7: 40) |
| `app.admin_cron_runs()` → `(job text, status text, started_at timestamptz)` | **definer** | Last run per `cron.job.jobname` from `cron.job_run_details`; never returns `command`. `undefined_table`/`invalid_schema_name` → empty. EXECUTE for `haide_api` only |

## 2. Events (E7-1, ADR 0032)

Inventory (verified in code, all in the transaction of the state change; `user_id` = actor):

| Event | Emitted in | Props (allow-list) |
|---|---|---|
| `search_performed` | `services/search.ts` → `repo/search.ts` (no state change; own statement) | `resultsCount, fromArea, toArea, windowMin, corridor`. Signed out → `user_id` NULL |
| `ride_published` | `services/rides.ts` publish tx | `rideId, distanceM, seats, isFree, originArea, destinationArea` |
| `booking_requested` | `services/bookings.ts` | `bookingId, rideId, segmentM` |
| `booking_confirmed` / `booking_rejected` | `services/bookings.ts` | `bookingId, rideId, responseSeconds` |
| `booking_expired` | tick step 1 (`services/tick.ts`) | `bookingId, rideId` |
| `booking_cancelled` | `services/bookings.ts` (passenger), `services/cancellations.ts` (ride cascade `driver`; sweep, block, deletion `system`) | `bookingId, rideId, by, late` |
| `ride_completed` | tick step 2 (`services/safety.ts`), outcome `completed` only | `rideId, seats` |
| `no_show_reported` / `rating_submitted` / `report_submitted` | `services/safety.ts`, `services/ratings.ts` | `bookingId, rideId, by` / `bookingId, stars, tagCount, raterRole` / `reason, alsoBlock` |

**Work:** `_shared/domain/events.ts` exports `EVENT_NAMES` (11, same order as the DB CHECK), `EventProps` (a type map per name, the table above) and `eventPropsOk()` mirroring the SQL guard; builders in `bookings.ts`/`safety.ts` move there (re-exported for compatibility), and `repo/search.ts`/`repo/rides.ts` take typed props. api-contract §11 is updated to the props above (it has drifted: `segmentM`, `tagCount`, `raterRole`, `alsoBlock`).

**Privacy (E6 consistency):** lawful basis legitimate interest (DPIA row "Analytics"), server-side only, no device storage or SDK, so no consent prompt (ePrivacy 5(3) not triggered). Area labels only, no IP, no free text (the CHECK blocks `details`, long strings and nested objects). Already covered by E6: `scrub_account` nulls `user_id`, `export_user_data` includes the user's events, `run_retention` deletes > 13 months. **Objection (Art. 21):** by email to support; runbook in deploy.md nulls the user's `user_id` in past events (SQL editor). Metrics outputs are aggregates; the only per-person output is the high-volume driver flag (id + first name, ToS enforcement).

## 3. Metrics (E7-2, ADR 0034)

Week `W` = `[from, to)`. "Accepted" booking = `decided_at IS NOT NULL AND status <> 'rejected'` (confirmed, completed, no_show, or cancelled after approval).

| Metric (mvp-scope §4) | `metrics_week` counts | Formula in `metrics.ts` | Target / kill |
|---|---|---|---|
| Completed shared seats (North Star) | `completed_seats`: bookings `completed` on rides with `departure_at` in W (no-shows excluded by status) | value | ≥ 100 / < 30 |
| Search match rate | from `metrics_match_by_corridor` | matched / searches: overall, launch corridors (south+west+campus, target applies here), per corridor | ≥ 30 % / < 15 % |
| Ride fill rate | `rides_departed` (any status, departure in W), `rides_filled` (≥ 1 accepted booking) | filled / departed | ≥ 25 % / < 10 % |
| Median response time | `requests` (requested in W), `requests_decided`, `requests_expired`, `median_response_s` = `percentile_cont(0.5)` of `decided_at − requested_at` | minutes, 1 decimal | < 15 / > 60 |
| 4-week passenger retention | cohort = passengers whose **first** completed booking departs in W−4; `cohort_retained` = another completed booking departing within 28 d after the first; `cohort_closed` = `p_now ≥ end(W−4) + 28 d` | retained / cohort, shown as "provisional" when not closed | ≥ 40 % / < 20 % |
| Reports per 100 completed rides | `reports` created in W, `rides_completed` (status `completed`, departure in W) | 100 × reports / rides | < 1 / > 3 |
| Cancellation rate | `accepted` on rides departing in W, `cancelled_after_accept` (`cancelled` with `cancelled_by IN ('passenger','driver')`; `system` excluded: safety, not reliability) | cancelled / accepted | < 15 % / > 30 % |

`metrics.ts`: `METRIC_TARGETS` (constants above), `rate(n, d)` → `null` when `d = 0`, 3 decimals; `status(value, target)` → `on_target | between | below_kill | no_data` (direction per metric); `parseIsoWeek('2026-W47')` → Monday date (53-week years, e.g. `2026-W53` valid, `2027-W53` invalid) and `currentIsoWeek(now)` in Europe/Bucharest. Week accepted from `2026-W46` to the current week, else `400 fields.week`. `partial: true` while `now < to`.

## 4. Energy prices (E7-4, ADR 0035)

`services/energyPrices.ts`, one tx: `pg_advisory_xact_lock(hashtext('app.energy_prices'))` → latest row of the fuel (`order by effective_from desc limit 1`) → checks → insert (`created_by` = admin) → `admin_actions ('energy_price_added', details {energyPriceId, fuelType, priceMilli, prevPriceMilli, consumptionCenti, prevConsumptionCenti, effectiveFrom, override})`. Pure rules in `_shared/domain/energyPrices.ts`:

| Rule | Error |
|---|---|
| `priceMilli` 100…50 000, `consumptionCenti` 100…5 000 (integers) | `400 VALIDATION_FAILED` |
| `effectiveFrom` default `now`, truncated to the minute; ≥ now − 5 min and ≤ now + 30 d | `400 fields.effectiveFrom = past / too_far` |
| Later than the latest row of that fuel (forward-only timeline) | `400 fields.effectiveFrom = not_after_latest` |
| `isLargeChange(prev, next)`: `|next − prev| × 100 > 30 × prev` for price **or** consumption (integer math, 30 % exactly passes) and no `overrideLargeChange` | `409 LARGE_CHANGE`, `fields.priceMilli` and/or `fields.consumptionCenti = large_change` |
| `sourceNote` 1…200 chars, required | `400` |

Published rides keep their snapshot; `energyPriceFor()` already picks the row in effect at publish time, so a scheduled row needs no job. A mistaken scheduled row is deleted by the owner in the SQL editor before it takes effect (deploy.md runbook).

## 5. Reports, suspension, unsuspension (E7-3, E5-5)

`services/admin.ts`, each one tx; profile locked `for no key update` (E6 lock-mode lesson).

| Action | Checks → effect |
|---|---|
| Dismiss | report unknown `404`; not `open` `409 INVALID_STATE` → `admin_dismiss_report`. Nobody is emailed |
| Suspend `{reasonCode, statement, reportId?}` | self `400 fields.userId = self`; another admin `400 fields.userId = admin` (also refused by `app.admin_suspend_user`, SQLSTATE 42501); unknown `404`; not `active` (suspended or deleted) `409 INVALID_STATE`; `reportId` about someone else `400 fields.reportId = mismatch`, not open `409` → `admin_suspend_user(…, reasonCode)` (report → `actioned`) + outbox `account_suspended {reasonCode, statement}` (sent to suspended recipients). The tick sweep cancels future rides/bookings with notifications within a minute |
| Unsuspend `{note?}` | not `suspended` `409 INVALID_STATE` → `admin_unsuspend_user` + outbox `account_reinstated {}`. Cancelled items stay cancelled |

Other open reports about a suspended user stay open; the queue shows the reported user's status so the admin can dismiss them. Concurrency: two parallel suspends → one `204`, one `409`.

## 6. API surface (contract `_shared/contracts/admin.ts`; all `requireAdmin`, rate limit `admin {120, 60}`; non-admin `403 FORBIDDEN`)

`AdminUserRef = { id, firstName: string|null, photoUrl, status: 'active'|'suspended'|'deleted', memberSince, ridesCompleted, reports90d }`. For a deleted reported user, `firstName` falls back to `reported_snapshot.firstName`. **No phone, plate, email or coordinates in any admin response** (data-model §5.2).

| Method & path | Request | Response |
|---|---|---|
| `GET /admin/metrics?week=2026-W47` | default current week | `{ week, from, to, partial, northStar, matchRate: {overall, launch, byCorridor[{corridor, value, searches}]}, fillRate, medianResponseMin, retention4w: {…, cohortWeek, closed}, reportsPer100, cancellationRate, series: [{week, completedSeats}] (12 weeks), flags: {highVolumeDrivers: [{user: AdminUserRef, completed7d}]} }`. Each metric `{ value, target, kill, status, n }` (`n` = denominator) |
| `GET /admin/reports?status=open\|dismissed\|actioned\|all&limit&cursor` | default `open`, limit 20 (≤ 50), keyset `(created_at desc, id desc)` | `{ items: [{ id, status, reason, details, createdAt, resolvedAt, reporter: AdminUserRef, reported: AdminUserRef & {openReports}, ride: {id, departureAt, fromArea, toArea} \| null, bookingId, history: [{action, adminFirstName, at, note}] (last 5 for the reported user) }], nextCursor }` |
| `POST /admin/reports/{id}/dismiss` | `{ note?: ≤ 200 }` | `204` |
| `POST /admin/users/{id}/suspend` | `{ reasonCode: report_reason, statement: 10…300 (NFC, trimmed), reportId? }` | `204` |
| `POST /admin/users/{id}/unsuspend` | `{ note?: ≤ 200 }` | `204` |
| `GET /admin/users?status=suspended` | | `{ items: [{ user: AdminUserRef, suspendedAt, reasonCode, statement, adminFirstName }] }` (≤ 100) |
| `GET /admin/energy-prices` | | `{ fuels: [{ fuelType, unit, current: EnergyPrice, scheduled: EnergyPrice \| null }], history: EnergyPrice[] (last 50) }`; `EnergyPrice = {id, fuelType, priceMilli, consumptionCenti, unit, effectiveFrom, sourceNote, createdBy: {id, firstName} \| null, createdAt}` |
| `POST /admin/energy-prices` | `{ fuelType, priceMilli, consumptionCenti, effectiveFrom?, sourceNote, overrideLargeChange? }` (no `unit`) | `201 { item: EnergyPrice }` |
| `GET /admin/ops` | | `{ dbSizeMb, emailsToday, emailCap, outboxPending, outboxFailed24h, routePreviewsToday, errors24h, openReports, openDataRequests, overdueDeletions, cron: [{job, status, startedAt}] }` (`routePreviewsToday` ≈ ORS calls: sum of `ridePreview` rate-limit counts since UTC midnight) |
| `GET /admin/errors?limit=50` | ≤ 100 | `{ items: [{ id, source, message, route, appVersion, createdAt }] }` (no stack, no user hash) |

New in `rules.ts`: `RATE_LIMITS.admin`, `ENERGY_CHANGE_MAX_PCT = 30`, `ENERGY_SCHEDULE_MAX_DAYS = 30`, `METRICS_SERIES_WEEKS = 12`, `HIGH_VOLUME_COMPLETED_7D = 40`, `METRICS_FIRST_WEEK = '2026-W46'`.

## 7. Notifications and i18n

Templates (`_shared/domain/outbox.ts`, `notify/templates.ts`, server `i18n/en.ts`): `account_suspended` — subject "Your Haide account is suspended", body: ground (`reasonCode` → ToS section label), the statement, "A person reviewed this, it was not automatic.", "Your upcoming rides and bookings are cancelled.", "To appeal, reply to this email." `account_reinstated` — "Your Haide account is active again". Dispatcher: `ANY_STATUS_TEMPLATES = {account_suspended, data_export_ack}` use the 2-arg recipients. Payload scan test covers both.

Web keys: `admin.*` namespace, appended to copy.md as "§39 E7 additions". Metric names verbatim from mvp-scope §4. Must-have strings: `admin.suspend.statementHint` "The person will see this. Do not name who reported them." · `admin.energy.largeChange` "This is a {pct}% change from the current price. Check the number before you save." · `admin.energy.override` "I confirm this change is correct" · `admin.energy.hybridHint` "Hybrid cars use the petrol price. Add a hybrid version too." · `admin.metrics.provisional` "Provisional: the 28-day window is still open." · `errors.LARGE_CHANGE`, `errors.FORBIDDEN`.

## 8. Web (`features/admin/`, lazy chunk; tokens only, dark and light, 44 px targets, focus to `h1`, sheets with focus trap; desktop-first but usable at 360 px; initial JS unchanged)

| # | Screen | Route | Behaviour |
|---|---|---|---|
| 7.0 | Entry and shell | Settings row "Admin" when `me.role === 'admin'`; `AdminLayout` | Nav (Metrics, Reports, Suspended, Energy prices, Ops) as a side rail ≥ 1024 px, a scrollable segmented bar below. Route `handle: { wide: true }` lets `Shell` drop the narrow column. Non-admin → `NotFoundScreen` (the server answers 403 anyway) |
| 7.1 | Metrics | `/admin?week=2026-W47` | Week picker (previous / next / This week, label "Week 47 · 16–22 Nov 2026"). North Star card: Sora `numeral` tabular in `text`, target and kill as text, 12-week sparkline (inline SVG, `outline` stroke, `aria-hidden`) with a `<details>` "Show as table". Seven tiles (value, `n`, target, kill, status chip = icon + text, never colour alone). Corridor table. High-volume driver list. "Partial week" notice |
| 7.2 | Reports | `/admin/reports` | Status tabs (Open default). Table ≥ 1024 px, cards below: reporter, reported (status chip, open reports count), reason, details (expand), ride (date + areas, link `/ride/:id`), date, last action lines. Row actions by state: Dismiss (open), Suspend (reported active), Unsuspend (reported suspended). Each opens a Sheet: Dismiss/Unsuspend with optional note; Suspend with reason select (pre-filled from the report), statement textarea (required, hint, counter), destructive outline button. `409` → toast + refetch |
| 7.3 | Suspended | `/admin/users` | List with ground, statement, date, admin; Unsuspend sheet |
| 7.4 | Energy prices | `/admin/energy` | Per fuel: current and scheduled. Form: fuel select, price (RON per l/kWh, 3 decimals → milli), consumption (per 100 km, 2 decimals → centi), "Apply now" or date-time (Europe/Bucharest), source note. Live change % vs current (`energyChange.ts`, UI mirror only); > 30 % shows the warning + required override checkbox; server `LARGE_CHANGE` shows the same. Hybrid hint on petrol. History table |
| 7.5 | Ops | `/admin/ops` | Tiles (DB MB, emails today / cap, outbox, previews, errors 24 h, open reports, data requests, overdue deletions), cron last runs, recent errors list |

No motion beyond the standard fades (reduced-motion: none). Saffron only on the one primary action per screen.

## 9. Tests

| Layer | File | Must cover |
|---|---|---|
| Unit | `_shared/domain/{events,metrics,energyPrices}.test.ts`, `api/admin.test.ts`, `notify/dispatch.test.ts`, `templates.test.ts` | `eventPropsOk` ≡ SQL guard cases; every builder's props pass it; `EVENT_NAMES` order. ISO week parse/format (W01 crossing years, 2026-W53, DST weeks), rates with zero denominators, status per direction at exact thresholds. `isLargeChange` at 29.99/30/30.01 % up and down, consumption-only change, effectiveFrom rules. Gate matrix on every admin route (anon 401, user 403 `FORBIDDEN`, suspended admin 403 `ACCOUNT_SUSPENDED`, admin 200); validation; error mapping; serializer has no `phone*`, `plate`, `email`, `lat`, `lng` keys (recursive). Dispatcher uses the 2-arg recipients for `ANY_STATUS_TEMPLATES` only |
| pgTAP | `supabase/tests/010_metrics_admin.test.sql` | Guard: nested object, array, `lat`, `phoneE164`, `details`, 81-char string, 13 keys rejected; flat props accepted; insert violating it fails. `admin_actions` new action allowed, unknown rejected. `admin_dismiss_report` open → true + audit row, second call false. New `admin_suspend_user` with code (details, report actioned) and the old 4-arg call shape still resolves. `outbox_recipients(ids, false/true)`: suspended only with true, deleted never. Privileges: every new function false for public/anon/authenticated; `admin_cron_runs` true for `haide_api`. **Seeded week with known answers** (hand-computed in the test header): completed seats, a no-show excluded, a `system` cancel excluded, a late-in-week Sunday 23:30 local booking in W and Monday 00:30 local in W+1, the October DST week, retention cohort closed vs open, match by corridor with zeros, high-volume driver at 40 (out) and 41 (in), non-Monday `p_week` raises |
| Integration | `tests/integration/admin.test.ts`, `tests/integration/events.test.ts` | Every admin route 401/403 for anon/user (table-driven). Report → listed → dismiss → `dismissed` + audit. Suspend with report → `actioned`, `account_suspended` outbox row, tick → driver's future ride cancelled and passengers' `ride_cancelled` rows, user gone from search; unsuspend → `account_reinstated`. Parallel suspends → `204` + `409`. Energy: +10 % → `201`, a publish after `effectiveFrom` uses the new `energy_price_id`; +40 % → `409`, with override `201` and `details.override = true`; past date → `400`; two parallel posts → one `201`, one `400 not_after_latest`. Metrics on a seeded week equal the pgTAP answers. Leak scan of every admin JSON for `\+40\d{9}`, plates, emails, `^-?\d{1,3}\.\d{4,}$`. **Event audit:** drive search, publish, request, approve, reject, expire (tick), late cancel, complete (tick), no-show, rating, report → exactly one row per flow, `name` and props keys = §2, recursive forbidden-key scan |
| E2E | `tests/e2e/e7-admin.spec.ts` + `e7-screenshots.spec.ts` (mocked API, 360×800 and 1280×800) | Admin row visible only for admins; non-admin `/admin` → not found. Metrics week navigation and table alternative. Suspend from a report (statement required, toast, row updates), dismiss, unsuspend. Energy > 30 % warning → override → saved. Axe dark and light on 5 screens; reduced motion. Bundle check: initial JS unchanged (± 1 KB), admin chunk lazy. Screenshots in `docs/screenshots/E7/` |

## 10. Work split (one PR, disjoint files)

**backend-dev:** (1) `_shared/contracts/admin.ts` (+ `index.ts`), `rules.ts`. (2) Migration + pgTAP 010. (3) `_shared/domain/{events,metrics,energyPrices}.ts` + tests (move event builders, keep re-exports), outbox templates + `notify/{templates,dispatch}.ts` + server `i18n/en.ts`. (4) `repo/admin.ts`, `repo/metrics.ts`, `repo/energyPrices.ts`, `repo/outbox.ts` (2-arg recipients), typed props in `repo/search.ts`/`repo/rides.ts`, `services/{admin,energyPrices,metrics}.ts`, `serializers/admin.ts`, `routes/admin.ts`, mount in `app.ts`, `api/admin.test.ts`. (5) Integration `admin.test.ts`, `events.test.ts` + factories (`makeAdmin`, `seedMetricsWeek`). (6) Docs: api-contract §7 (this spec, drop the export row) and §11, data-model (§4.2 rules, `admin_actions` actions, event CHECK, indexes, functions), architecture (metrics, admin), DPIA (analytics objection, suspension notice), deploy.md (runbooks: suspend/energy now in the UI, delete a mistaken scheduled price, analytics objection SQL; SQL fallbacks kept).

**frontend-dev:** `src/api/admin.ts` + types (`role` on `Me` if missing), `api/keys.ts`, `features/admin/**` (layout, 5 screens, components `MetricTile`, `NorthStarCard`, `Sparkline`, `WeekPicker`, `ReportCard`, `AdminActionSheet`, `EnergyPriceForm`; utils `isoWeek.ts`, `energyChange.ts` + unit tests), `app/router.tsx` (`admin` lazy children), `app/Shell.tsx` (`handle.wide`), `ProfileScreen.tsx` (Admin row), `i18n/en.json`, copy.md §39, E2E specs, screenshots.

**qa-reviewer:** all layers; CI log: the props CHECK validated on existing rows, the seeded-week answers, the event audit, privileges; leak scan; axe, reduced motion, bundle budget.

## 11. Out of scope and owner input

Out: admin data-request queue and export endpoint (SQL runbook stays), MFA (revisit trigger in ADR 0033), role management UI, weekly rollups, CSV export, alert emails on kill thresholds, automatic fuel-price import. **Owner:** nothing blocks E7. The suspension email wording (statement of reasons) joins the existing pending legal review of the ToS/privacy drafts; the admin account is granted by the existing deploy.md SQL step.
