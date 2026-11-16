# E6 implementation spec: privacy and compliance

> Owner: software-architect · Date: 2026-11-17 · Branch `feat/privacy` (from `feat/trust-safety`) · Stories E6-1 to E6-4 (E6-4 is Should, included)
> Inputs: [backlog E6](../product/backlog.md), [strategy §9](../product/strategy.md) (P1, P5-P7, P10), [e5 spec](e5-trust-safety-spec.md) (template, sweep, cancellations), [data-model §6](data-model.md), [DPIA](privacy-impact-assessment.md) §2.1/§5, [copy](../ux/copy.md) §30-§32, ADR [0005](../decisions/0005-location-privacy-baseline.md)
> New ADRs: [0029 account deletion](../decisions/0029-account-deletion-immediate-tombstone-and-purge-queue.md) · [0030 retention in the tick](../decisions/0030-retention-in-tick-coarsening-and-definer-purge.md) · [0031 data requests](../decisions/0031-data-access-requests-by-email-and-sql-export.md)

## 0. Decisions in one screen

| Topic | Decision |
|---|---|
| Deletion | `DELETE /me`: **one transaction** cancels future rides/bookings (E5 cancellation services, `by = 'system'`) and scrubs the profile to a tombstone. Storage object and auth user are removed after commit, retried by the tick from `app.account_deletions` until done (ADR 0029). No grace period |
| Who may delete | Any authenticated account: active, suspended, or one that has not accepted new terms. Already deleted → `204` |
| Kept after deletion | Ratings (both directions, "Deleted user"), reports about the user **with** `reported_snapshot` (incl. phone) until 12 months after the report, `admin_actions` 24 months, consents 3 years, incoming blocks (the blocker's own data) |
| Coarsening | `app.coarsen_locations(now, 500)` runs **every tick**. Rides and bookings whose ride departed > 90 days ago: points → `app.grid_point(p, 1000)`, `route` NULL, ride labels → area name, `note` NULL, plate removed from `vehicle_snapshot`, `idempotency_key` NULL (ADR 0030) |
| Row purges | `app.run_retention()` (SECURITY DEFINER, uses `now()`, no clock parameter) in the hourly housekeeping. It is the only path that deletes from `consents`, `reports`, `admin_actions`. It replaces the planned daily `retention` pg_cron job |
| Proof | `app.location_retention_violations(now)` returns every ride/booking older than 90 days that still has exact geometry, checked **by geometry**, not by the flag. pgTAP + integration assert it is empty. A catalog guard fails CI when a new `geometry` column appears in `app` without a retention rule |
| Legal | The versioning and `CONSENT_REQUIRED` gate already exist (E1). E6 ships real text as v1.1 (web content files), `consent.reaccept` on `/me`, an "updated terms" mode of the consent screen, and a Shell redirect at sign-in |
| Data request | `POST /me/data-export-request` → `data_requests` row + email to `EMAIL_SUPPORT_TO` + acknowledgement to the user. Admin runs `app.export_user_data(uuid)` in the SQL editor. No export endpoint (ADR 0031) |

## 1. Migration `supabase/migrations/20261121090000_privacy.sql`

Forward-only, header points here, `SET search_path = app, extensions, pg_catalog` on every function, PUBLIC EXECUTE revoked on every new function, `REVOKE ALL … FROM anon, authenticated` repeated.

**New tables** (RLS on, no policies):
- `app.account_deletions`: `user_id uuid PK` (FK → profiles), `requested_at`, `photo_path text NULL` (same regex as `profiles.photo_path`), `storage_done_at`, `auth_done_at`, `attempts smallint NOT NULL DEFAULT 0`, `next_attempt_at timestamptz NOT NULL`, `last_error text CHECK (char_length <= 200)`, `completed_at`. `account_deletions_completed_meta CHECK ((completed_at IS NOT NULL) = (storage_done_at IS NOT NULL AND auth_done_at IS NOT NULL))`. Partial index `(next_attempt_at) WHERE completed_at IS NULL`. `REVOKE DELETE` from `haide_api` (proof of erasure).
- `app.data_requests`: `id uuid PK`, `user_id` (FK → profiles, NOT NULL), `kind text NOT NULL CHECK (kind = 'export')`, `requested_at`, `fulfilled_at`, `note text CHECK (<= 200)`. Index `(user_id, requested_at desc)`. `REVOKE DELETE` from `haide_api`.

**Changes:** `admin_actions.report_id` FK re-created `ON DELETE SET NULL` (so the 12-month report purge works on the append-only table). Indexes `reports_created_idx (created_at)`, `analytics_events_occurred_idx (occurred_at)`, `profiles_deleted_idx (deleted_at) WHERE status = 'deleted'`. Insert `legal_documents` `('terms','1.1','2026-11-21T00:00:00Z','/policy/terms')` and `('privacy','1.1', …,'/policy/privacy')`.

**Functions:**

| Function | Kind | Behaviour |
|---|---|---|
| `app.coarsen_locations(p_now timestamptz, p_limit int)` → `(rides int, bookings int)` | VOLATILE, invoker | Rides `WHERE coarsened_at IS NULL AND departure_at < p_now − 90 d ORDER BY departure_at LIMIT p_limit FOR UPDATE SKIP LOCKED`. Bookings `WHERE b.coarsened_at IS NULL AND b.created_at < cutoff AND r.departure_at < cutoff` (the `created_at` prefilter uses `bookings_coarsen_idx`, valid because a booking is always created before departure). SET lists in §0. Keeps distance, duration, prices, fractions, walk and segment metres, status and every timestamp (`updated_at` untouched). Idempotent. Shares one internal helper with `scrub_account` |
| `app.scrub_account(p_user uuid, p_now timestamptz)` → void | VOLATILE, invoker | Called last in the `DELETE /me` transaction: insert `account_deletions` (`photo_path`, `storage_done_at = p_now` when no photo, `next_attempt_at = p_now`) `ON CONFLICT DO NOTHING` · profile: `first_name, phone_e164, bio, photo_path, last_seen_summary_at = NULL`, `role = 'user'`, `status = 'deleted'`, `deleted_at = p_now` · delete the vehicle · every ride of the user: `vehicle_snapshot = {fuelType}` only, then coarsen **all** the user's rides and own bookings regardless of age · delete outgoing blocks, the user's `reliability_events`, `share_links` of bookings where the user is passenger or driver, `pending` outbox rows to the user · `analytics_events.user_id = NULL` |
| `app.location_retention_violations(p_now timestamptz)` → setof `(kind text, id uuid)` | STABLE, invoker | Rides past the cutoff with `coarsened_at IS NULL`, `route IS NOT NULL`, `note IS NOT NULL`, `vehicle_snapshot ? 'plate'` or a point where `NOT ST_Equals(p, app.grid_point(p, 1000))`. Bookings (by ride departure) with a non-grid point or no `coarsened_at`. Also used as a production check in deploy.md |
| `app.run_retention()` → jsonb counts | VOLATILE, **SECURITY DEFINER**, `now()` only | Deletes in batches of 5 000: `rate_limits` > 2 d, `app_errors` > 14 d, non-pending `outbox` > 30 d, `analytics_events` > 13 months, `reports` > 12 months (whole row, snapshot included), `admin_actions` > 24 months, `consents` of profiles deleted > 3 y, `account_deletions` completed > 3 y, `data_requests` fulfilled > 3 y. EXECUTE for `haide_api` only |
| `app.export_user_data(p_user uuid)` → jsonb | STABLE, **SECURITY DEFINER** (reads `auth.users` email) | Content in §5. EXECUTE revoked from `public`, `anon`, `authenticated` **and `haide_api`** (SQL editor only) |

## 2. `DELETE /me` (E6-1, ADR 0029)

`routes/privacy.ts`, gate = authenticated + account loaded (no `requireActive`, no consent), rate limit `account`. Body `{ confirm: 'DELETE' }`, else `400 CONFIRMATION_REQUIRED`.

1. **Tx** (`services/accountDeletion.ts`): `SELECT … FROM app.profiles WHERE id = $1 FOR UPDATE`. Already `deleted` → commit, go to step 2. Rides `published`, `departure_at > now`, driver = user, by id: `cancelRideTx(tx, id, now, 'system')` → `ride_cancelled (by: system)` to each passenger. Bookings `requested`/`confirmed` of the user on rides not departed: `systemCancelBookingTx(tx, id, now, 'account_deleted')` → `booking_cancelled` to the driver (confirmed only, as E5). Then `select app.scrub_account($user, $now)`. Payload names are read before the scrub in the same transaction. Lock order: profile, then rides (backend-dev confirms no path locks a ride and then a profile). `40P01` → retry once, then `503`.
2. **After commit:** `purgeAccount(deps, userId)` (`services/accountPurge.ts`): `storage.removeStrict(photo_path)` (new: throws on non-2xx except 404) and `authAdmin.deleteUser(id)` (new injected dep, `DELETE /auth/v1/admin/users/{id}` with the secret key, 404 = done). Each success sets its `*_done_at`; both → `completed_at`. A failure sets `attempts + 1`, `last_error` (scrubbed), `next_attempt_at` = +1 min, 5 min, 30 min, 2 h, 12 h, then daily. Never fails the response. → `204`.

| Situation | Behaviour |
|---|---|
| Double tap / second device | Profile lock serialises; the second call sees `deleted` and answers `204`. One `account_deletions` row (PK) |
| Suspended user | May delete. `deleted` overrides `suspended`; `admin_unsuspend_user` stays a no-op on it. Reports and admin actions about them are kept |
| Old access token after deletion | Valid until expiry, but every gate answers `403 ACCOUNT_DELETED`. Auth deletion revokes refresh tokens |
| Sign-in while the auth deletion is pending | Same auth id, profile `deleted` → `ACCOUNT_DELETED` → web signs out. After purge, the same email creates a new account with a new id |
| In-flight write racing the delete | The safety sweep (E5 step 3) now matches `p.status IN ('suspended','deleted')` in all three queries (`repo/sweep.ts`), so a booking or ride that slipped in is cancelled at the next tick |
| Ride departed, not completed | Not cancelled. Completion still runs. The phone disappears from the reveal at once (accepted) |
| Ratings | Kept. `PublicUser` of a deleted user: `firstName`, `photoUrl`, `bio` and the rating summary are `null`. The counterpart can still rate a tombstone inside the 7-day window (E5) |
| Avatar caching | Upload `cache-control` drops from 1 year to `max-age=604800` (7 days), so browser and CDN copies age out inside the 30-day promise |

## 3. Coarsening and the location inventory (E6-2, ADR 0030)

| Where | Holds | Rule |
|---|---|---|
| `rides.origin/destination/route/route_utm`, `origin_label/destination_label`, `note`, `vehicle_snapshot.plate` | exact points, street labels, free text, plate | coarsened 90 days after departure (every tick, batch 500) or at account deletion |
| `bookings.pickup/dropoff`, `idempotency_key` | exact snapped points | same, keyed on the ride's `departure_at` |
| `route_previews.*` | exact, short TTL | deleted at `expires_at` (tick step 5, unchanged) |
| `share_links` | token hash, no coordinates | deleted at `expires_at` (≤ departure + 24 h) and at account deletion |
| `outbox.payload`, `analytics_events.props` | area labels only (payload scan tests) | 30 days / 13 months |
| `reports.details` | free text | 12 months |
| `areas`, `places` | public gazetteer | not personal |

**Catalog guard (pgTAP):** `SELECT f_table_name, f_geometry_column FROM geometry_columns WHERE f_table_schema = 'app'` must set-equal the classified list above (`areas.geom`, `areas.centroid`, `places.geom`, `route_previews.{origin,destination,route}`, `rides.{origin,destination,route,route_utm}`, `bookings.{pickup,dropoff}`).

## 4. Legal documents (E6-3)

- **Server:** `GET /me` adds `consent.reaccept: boolean` (a required kind has an older accepted version). `POST /me/consents`: `age18` becomes optional when an `age_18` row exists (else `fields.age18 = required`); versions must still be current. `GET /legal/current` adds `publishedAt` per kind.
- **Rule:** a published version's text never changes. Any edit = new version + migration row + web content file. Filling the controller identity before launch is v1.2 (deploy step, GATE 3).
- **Web content:** `apps/web/src/features/policy/content/{terms,privacy}.en.ts` = `{ version, effectiveDate, changes: string[], sections: { id, title, body: string[] }[] }`, lazy chunk, locale suffix keeps it i18n-ready. Text drafted from the outlines below and marked "pending owner/counsel review".
- **ToS sections:** what Haide is (connects people, not a transport operator, no payments, not a party to the agreement) · eligibility (18+, one account, true details; drivers: valid licence, RCA insurance, roadworthy car) · **cost-sharing** (the driver's own trip they would make anyway; the price is computed by Haide as a share of fuel or energy cost; no profit; passengers pay at most the shown amount, directly; no extra payments, surcharges or demanded tips; free rides allowed) · **ride limits** (≤ 4 rides a day, ≤ 4 passengers, Sibiu area) · bookings, cancellations, no-shows, blind ratings · conduct, reports, blocks, 112, suspension · liability and consumer law [counsel placeholder] · account deletion · changes and re-acceptance · Romanian law, contact.
- **Privacy sections:** controller **[placeholder, owner need #1]** + `privacy@` contact · data we collect (DPIA §2.1) · purposes and lawful bases (P1: contract; legitimate interest for safety, fraud, security, analytics; consent for device location) · who sees what (P3, P4) · processors (DPIA §5) and transfers · retention (P5 + §1 `run_retention` periods + "deleted accounts erased within 30 days; ratings stay as Deleted user; reports 12 months") · rights (access, rectification, erasure, restriction, portability, objection, withdraw consent; in-app deletion, "Request my data", reply within one month) · complaint to **ANSPDCP** (B-dul G-ral. Gheorghe Magheru 28-30, Sector 1, 010336 București, anspdcp@dataprotection.ro, dataprotection.ro) · no ads, no tracking, no automated decisions with legal effect · local storage is functional only · 18+ · changes.

## 5. Request my data (E6-4, ADR 0031)

`POST /me/data-export-request`: authenticated, `active` or `suspended` (deleted → `403 ACCOUNT_DELETED`), rate limit `dataRequest {3, 86400}`. An unfulfilled request from the last 30 days → `202` with it, no new emails. Else one tx: insert `data_requests`, outbox `data_export_requested` (`user_id` = requester, routed by the dispatcher to `EMAIL_SUPPORT_TO`, payload `{requestId, userId, requestedAt}`), outbox `data_export_ack` to the user. `202 { requestId, requestedAt, dueBy }` (`+30 d`).

`export_user_data` returns `{ schemaVersion: 1, exportedAt, account {id, email, createdAt, lastSignInAt, status}, profile, vehicle, consents[], rides[] (GeoJSON while not coarsened, labels, times, rate snapshot, status), bookings[] (own points, labels, prices, status, times), ratingsGiven[] (bookingId, stars, tags, date), ratingsReceived[] (stars, tags, date; visible_at <= now, no rater), reliabilityEvents[], blocksOutgoing[], reportsFiled[] (reason, details, status, date; no snapshot), dataRequests[], analyticsEvents[] }`. Excluded: reports about the user, counterparts' phones and points. The runbook goes in deploy.md: run it, send the JSON from `privacy@` to the account email, set `fulfilled_at`.

## 6. API surface (contract `_shared/contracts/privacy.ts`, additive in `account.ts`, `system.ts`)

| Method & path | Gate, rate limit | Request | Response | Errors |
|---|---|---|---|---|
| `DELETE /me` | authenticated (any status), `account` | `{ confirm: 'DELETE' }` | `204` (idempotent) | `400 CONFIRMATION_REQUIRED`, `503` |
| `POST /me/data-export-request` | authenticated, not deleted, `dataRequest` | `{}` | `202 { requestId, requestedAt, dueBy }` | `403 ACCOUNT_DELETED` |
| `GET /me` (changed) | unchanged | | `consent.reaccept` | |
| `POST /me/consents` (changed) | unchanged | `age18?` | `204` | `400` (`fields.age18`) |
| `GET /legal/current` (changed) | public | | `+ publishedAt` | |

New constants in `rules.ts`: `COARSEN_AFTER_DAYS = 90`, `COARSEN_GRID_M = 1000`, `COARSEN_BATCH = 500`, `PURGE_BATCH = 10`, `PURGE_BACKOFF_MIN = [1, 5, 30, 120, 720, 1440]`, `PURGE_OVERDUE_DAYS = 7`, `DATA_REQUEST_DUE_DAYS = 30`. `RATE_LIMITS.dataRequest`.

## 7. `POST /internal/tick` (order)

1 expire · 2 complete · 3 safety sweep (now also `deleted`) · 4 dispatch (support routing for `data_export_requested`) · 5 purge previews and share links · **6 coarsen** `app.coarsen_locations(now, COARSEN_BATCH)` · **7 account purge** (≤ `PURGE_BATCH` due rows) · **8 hourly housekeeping**: `select app.run_retention()` (replaces the body of `purgeHousekeeping`), plus one `app_errors` row `account_purge_overdue` per open deletion older than 7 days. `TickResponse` adds `coarsened` (rides + bookings) and `accountsPurged`. Each step keeps its own try/catch.

## 8. Notifications and i18n

New templates: `data_export_requested` (to support, subject "Data request {requestId}", body names the user id and the SQL to run) and `data_export_ack` (to the user: "We got your request for a copy of your data" / "We’ll email it to this address within 30 days. If you didn’t ask for this, reply to this email."). Deletion reuses `ride_cancelled (by: system)` and `booking_cancelled` with no hint of the deletion. The payload scan test covers both new templates.

Web keys (append to copy.md as "§38 E6 additions"): `consent.update.title` "We’ve updated our terms" · `consent.update.body` "Read what changed, then accept to keep using Haide." · `consent.update.changes` "What changed" · `consent.update.accept` "I accept the updated Terms of use and Privacy policy" · `consent.update.delete` "I’d rather delete my account" · `delete.error` "We couldn’t delete your account. Try again." · `errors.ACCOUNT_DELETED` "This account was deleted." · `errors.CONFIRMATION_REQUIRED` "Confirm to continue." · `settings.data.pending` "Request sent on {date}. We’ll reply by {due}." · `policy.toc` "Contents".

## 9. Web (tokens only, dark and light, 44 px targets, reduced-motion fallbacks, initial JS ≤ 200 KB gzip)

| # | Screen | Route / entry | Behaviour |
|---|---|---|---|
| 6.1 | Settings, "Privacy and data" group | `ProfileScreen` | Privacy policy, Terms, "Request a copy of my data", Delete account (error-token label) |
| 6.4 | **Delete account** | `/delete` (lazy, full screen) | Copy §31, focus on the heading. Red **outline** "Delete account" + "Keep my account". Confirm → `DELETE /me {confirm}` → clear the query cache, `haide.share.*`, the consent draft → sign out → `/` → toast `delete.toast`. Error → inline `delete.error`. Reachable when suspended (`OPEN_TO_SUSPENDED` + a link on `SuspendedScreen`) and from the consent update mode |
| 6.5 | Request my data | Settings row | `POST` → toast `settings.data.toast` (or `settings.data.pending` with the returned dates) |
| 6.2 | Policy pages | `/policy/terms`, `/policy/privacy` (signed out OK) | Version + effective date from the content file, contents list with anchor links, sections, controller line |
| 1.3b | Consent, update mode | `/auth/consent` when `me.consent.reaccept` | "What changed" list, links to both documents, one checkbox (no age box), Accept → `POST /me/consents` without `age18`. Secondary: Sign out, `consent.update.delete` → `/delete` |
| — | Shell | boot / sign-in | `me.consent.reaccept` → redirect to `/auth/consent?returnTo=…` on every route except `/policy/*`, `/auth/*`, `/delete`. `ACCOUNT_DELETED` from `/me` → sign out + toast `errors.ACCOUNT_DELETED` |

## 10. Tests

| Layer | File | Must cover |
|---|---|---|
| Unit | `_shared/domain/privacy.test.ts`, `api/privacy.test.ts`, `api/tick.test.ts`, `services/accountPurge.test.ts` | Confirm body; gate matrix (active, suspended, deleted, consent missing); purge backoff schedule and `completed_at` only when both sides done; `removeStrict` 404 = done; tick order 1-8 with a fake clock, housekeeping only at minute 0, a failing purge does not stop housekeeping; dedupe window of data requests; support routing in the dispatcher |
| pgTAP | `supabase/tests/009_privacy.test.sql` | Tables, constraints, indexes, RLS, no `anon`/`authenticated` access. `has_function_privilege`: 5 functions false for public roles; `run_retention` true and `export_user_data` **false** for `haide_api`; `haide_api` cannot DELETE `account_deletions`, `data_requests`, `consents`, `reports`. **Coarsening:** fixture rides at −91 d and −89 d (street labels, note, plate, route) with bookings → `coarsen_locations` → `location_retention_violations(now())` is empty, −91 d points equal `grid_point(…, 1000)` and labels equal the area name, −89 d rows byte-identical, distance/prices/status/timestamps unchanged, second call returns `(0, 0)`, `p_limit` respected. `grid_point` idempotent on 50 points. **Catalog guard** (§3). `scrub_account`: every field in §1, the user's rides and bookings coarsened at any age, incoming block kept, ratings kept. `run_retention`: each period at boundary −1 d / +1 d, report with an `admin_actions` row → `report_id` NULL, consents kept for an active user and for one deleted 2 y ago. `export_user_data`: keys present, received ratings with `visible_at > now` absent, no other user's phone |
| Integration | `tests/integration/privacy.test.ts` (factory `ageRide(rideId, days)` via `INT_DB_URL`) | Driver with a future ride (1 confirmed, 1 requested) deletes → passengers' `ride_cancelled` outbox rows, ride `cancelled`, `seats_booked = 0`. Passenger deletes → driver's `booking_cancelled`, seat freed. Then `GET /users/{id}` shows `firstName: null`, `GET /me` `403 ACCOUNT_DELETED`, a second `DELETE` `204`, the storage object `404`, the auth user gone, a DB leak scan finds no phone, photo path, bio, vehicle row or plate. Suspended user can delete. Counterpart booking view shows "Deleted user", ratings still count. **Coarsening via tick:** age a completed ride + booking to −91 d, call the tick, `location_retention_violations` empty, `GET /bookings/{id}` has approx points and `route: null`; −89 d untouched. **Legal:** insert v1.2 → `consent.reaccept` true, gated route `403 CONSENT_REQUIRED`, `DELETE /me` still allowed, `POST /me/consents` without `age18` → `204`; `/legal/current` versions equal the web content files. **Data request:** `202`, row, 2 outbox rows (support + ack), repeat dedupes. **Concurrency:** D1 delete in parallel with a booking request on the driver's ride, then one tick → no active booking. D2 two parallel deletes → both `204`, one row |
| E2E | `tests/e2e/e6-privacy.spec.ts` + `e6-screenshots.spec.ts` (mocked API, 360×800) | Settings → Delete → Keep (no call) and Delete (signed out, toast). Request data toast. Policy pages signed out with contents anchors. Consent update mode on `reaccept` and redirect from a protected route. Suspended screen link to delete. Axe dark and light on 4 screens. Screenshots in `docs/screenshots/E6/` |

## 11. Work split (one PR, disjoint files)

**backend-dev:** (1) contracts (`privacy.ts`, `account.ts`, `system.ts`), `rules.ts`. (2) Migration + pgTAP 009. (3) `_shared/domain/privacy.ts` + tests, templates + server i18n, dispatcher support routing. (4) `repo/privacy.ts`, `repo/sweep.ts` (deleted status), `repo/outbox.ts` (`purgeHousekeeping` → `run_retention`), `services/{accountDeletion,accountPurge,authAdmin}.ts`, `services/storage.ts` (`removeStrict`, cache-control), `services/cancellations.ts` (`account_deleted` reason), `services/tick.ts`, `types.ts` (`authAdmin`), `routes/privacy.ts`, `routes/account.ts` (consents, `reaccept`, `publishedAt`), `serializers/users.ts`. (5) Integration tests + factories. (6) Docs: data-model §6, api-contract §3, architecture jobs table (no separate `retention` cron), DPIA checklist, deploy.md (export runbook, overdue purge check, `location_retention_violations` monitor, v1.2 controller step, disable the Auth audit log in the database if the setting exists, else add `auth.audit_log_entries` > 30 d to `run_retention`).

**frontend-dev:** `src/api/privacy.ts` + types (`reaccept`, `publishedAt`), `features/privacy/{DeleteAccountScreen,PrivacyRows}.tsx`, `features/policy/content/*.en.ts` + `PolicyScreen.tsx`, `ConsentScreen.tsx` update mode, `app/Shell.tsx`, `app/router.tsx` (`/delete`), `ProfileScreen.tsx` (row group), `SuspendedScreen.tsx`, `i18n/en.json`, copy.md §38, E2E specs and screenshots.

**qa-reviewer:** all layers; in CI logs check the coarsening + catalog guard assertions, the leak scan, D1/D2, privileges on the definer functions; axe, reduced motion, bundle budget.

## 12. Out of scope
Admin export endpoint and data-request queue UI (E7, calling the same function), push-subscription deletion (E8 adds it to `scrub_account`), a phone blocklist against suspended users re-registering, ride alerts retention (E8), legal review of the drafted texts (owner).
