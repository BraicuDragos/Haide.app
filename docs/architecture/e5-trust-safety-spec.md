# E5 implementation spec: completion, ratings and safety

> Owner: software-architect · Date: 2026-11-16 · Branch `feat/trust-safety` · Stories E5-1 to E5-7 (E5-6 and E5-7 are Should, both included)
> Inputs: [backlog E5](../product/backlog.md), [e4-bookings-spec](e4-bookings-spec.md) (template and E4 behaviour), [data-model](data-model.md) §4.4/§4.5/§5.2, [api-contract](api-contract.md) §5/§6/§10, [copy](../ux/copy.md) §21-§27, [ia-and-flows](../ux/ia-and-flows.md) F6-F8 and screens 5.1-5.6/6.3, [design-direction](../brand/design-direction.md)
> New ADRs: [0024 completion in tick](../decisions/0024-ride-completion-in-tick-and-no-show.md) · [0025 blind ratings](../decisions/0025-blind-ratings-stored-visible-at.md) · [0026 share link](../decisions/0026-share-trip-link-hashed-token.md) · [0027 suspension sweep](../decisions/0027-suspension-flag-and-tick-safety-sweep.md) · [0028 block cascade](../decisions/0028-block-cancels-active-bookings.md)

## 0. Decisions in one screen

| Topic | Decision |
|---|---|
| Completion | `app.complete_rides(now, cutoff, limit)` runs as a **tick step** after expiry. Rides are locked with `FOR UPDATE SKIP LOCKED`. Confirmed → `completed` with `final_price_bani = price_locked_bani`. A ride is `completed` if at least one booking was completed, else `expired`. No separate cron job (ADR 0024) |
| Seat invariant | `rides.seats_booked = count(bookings WHERE status IN ('confirmed','completed','no_show'))` (accepted seats). Completion and no-show never touch seats. E4 tests still hold before departure |
| No-show | `confirmed`/`completed` → `no_show`, window `[departure, departure + 24 h)`. The caller's role sets `no_show_by`. One reliability event for the party who did not show. `final_price_bani = NULL`. Ride lock first. **Refused once either party has rated** (`INVALID_STATE`) |
| Ratings | Only on `completed` bookings, until `ride.completed_at + 7 d`, one per rater. The ratee is always the counterpart. Tags are checked per ratee role. Stored `visible_at` (ADR 0025): `completed_at + 7 d`, pulled to `now` for both ratings when the counter-rating arrives. Every rating summary counts `visible_at <= now` only |
| Blocks | `POST /blocks` commits the block, **then** cancels active bookings between the pair on rides not yet departed (`cancelled_by = 'system'`, no penalty). The tick sweep repeats it (ADR 0028). The list shows outgoing blocks only. Unblock restores nothing |
| Reports | Stored with a `{firstName, phoneE164}` snapshot. Optional `alsoBlock`. Each active admin gets an email with the report id and reason only. The reported user is never told |
| Suspension | `app.admin_suspend_user(user, reason, admin?, report?)` flips the status and writes `admin_actions`. Gates already answer `ACCOUNT_SUSPENDED`. The tick **safety sweep** cancels future rides and active bookings of suspended users (ADR 0027) |
| Share link | Passenger only. 128-bit base64url token, only its SHA-256 stored, one per booking (POST rotates, DELETE revokes), expires at `departure + 24 h`. The page shows the driver's first name and photo, the car with its plate, the passenger's **own segment**, area labels and times (ADR 0026) |
| Call 112 | Server computes `call112Window = [departure − 15 min, departure + 2 h)` for confirmed/completed parties. The client toggles the button at the boundaries without a refetch. `tel:112`, red **outline** button |
| Error codes | No new codes. Uses `WINDOW_CLOSED`, `ALREADY_RATED`, `INVALID_STATE`, `VALIDATION_FAILED` (`fields`), `404` |
| Carry-forward | PUBLIC EXECUTE revoked on the 3 new functions. `BookingListItem.cancelledBy` added. Rating visibility refined. `rate_limits`/`app_errors` cleanup already ships in the E4 hourly housekeeping (checked); expired share links are added to it |

## 1. Migration `supabase/migrations/20261120090000_trust_safety.sql`

Forward-only. The header comment points to this spec. Every function uses `SET search_path = app, extensions, pg_catalog`.

### 1.1 New tables (RLS enabled, no policies)

**`app.reports`**: `id uuid PK`, `reporter_id` and `reported_id` (FK → profiles, NOT NULL), `ride_id` (FK → rides, NULL), `booking_id` (FK → bookings, NULL), `reason app.report_reason NOT NULL`, `details text CHECK (char_length(details) <= 500)`, `reported_snapshot jsonb NOT NULL` (`{firstName, phoneE164}`), `status app.report_status NOT NULL DEFAULT 'open'`, `created_at`, `resolved_at`, `resolved_by` (FK → profiles). Named constraints: `reports_not_self` (`reporter_id <> reported_id`), `reports_other_has_details` (`reason <> 'other' OR char_length(details) >= 1`), `reports_resolved_meta` (`(status = 'open') = (resolved_at IS NULL)`). Indexes `(status, created_at)` and `(reported_id, created_at)`. `REVOKE DELETE` from `haide_api` (the E6 retention job gets its own path).

**`app.admin_actions`**: `id uuid PK`, `admin_id` (FK → profiles, NULL = SQL console), `action text NOT NULL CHECK (action IN ('suspend','unsuspend','dismiss_report'))`, `target_user_id` (FK → profiles), `report_id` (FK → reports, NULL), `details jsonb NOT NULL DEFAULT '{}'`, `created_at`. Index `(target_user_id, created_at)`. `REVOKE UPDATE, DELETE` from `haide_api` (append-only).

**`app.share_links`**: `id uuid PK`, `booking_id uuid NOT NULL UNIQUE` (FK → bookings), `token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32)`, `created_by` (FK → profiles, NOT NULL), `expires_at timestamptz NOT NULL`, `created_at`, `CHECK (expires_at > created_at)`. Index `(expires_at)`.

### 1.2 Changes to existing tables
- `ratings`: `ADD COLUMN visible_at timestamptz`, then `UPDATE … SET visible_at = created_at`, then `SET NOT NULL`. `ratings_tags_allowed CHECK (tags <@ ARRAY['punctual','friendly','safe_driving','clean_car','respectful','on_time_at_pickup']::text[])`. Index `ratings_ratee_visible_idx (ratee_id, visible_at)`. **`GRANT UPDATE (visible_at) ON app.ratings TO haide_api`** (the table-level UPDATE stays revoked: stars and tags are immutable).
- `rides`: `rides_completed_has_time CHECK (status <> 'completed' OR completed_at IS NOT NULL)`.
- `bookings`: `bookings_no_show_meta CHECK ((status = 'no_show') = (no_show_at IS NOT NULL AND no_show_by IS NOT NULL))` and `bookings_final_only_completed CHECK (final_price_bani IS NULL OR status = 'completed')`.
- `reliability_events`: `CREATE UNIQUE INDEX reliability_events_booking_kind_uidx ON app.reliability_events (booking_id, kind) WHERE booking_id IS NOT NULL` (backstop against double counting).
- Repeat `REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated` (and sequences).

### 1.3 Functions

| Function | Kind | Behaviour |
|---|---|---|
| `app.complete_rides(p_now timestamptz, p_cutoff timestamptz, p_limit int)` | VOLATILE plpgsql. Returns setof `(ride_id, driver_id, driver_first_name, departure_at, outcome app.ride_status, booking_ids uuid[], passenger_ids uuid[])` | `FOR r IN SELECT … FROM app.rides WHERE status = 'published' AND departure_at <= p_cutoff ORDER BY departure_at LIMIT p_limit FOR UPDATE SKIP LOCKED`: `UPDATE bookings SET status = 'completed', final_price_bani = price_locked_bani, passenger_event_at = p_now, updated_at = p_now WHERE ride_id = r.id AND status = 'confirmed' RETURNING id, passenger_id`, then `UPDATE rides SET status = CASE WHEN n > 0 THEN 'completed' ELSE 'expired' END, completed_at = CASE WHEN n > 0 THEN p_now END, updated_at = p_now`. `p_cutoff = now − COMPLETE_AFTER_H` is passed in by the API (constant stays in `rules.ts`). Idempotent. Leaves `requested` rows alone (the expiry step that runs just before has already handled them) |
| `app.admin_suspend_user(p_user_id uuid, p_reason text, p_admin_id uuid DEFAULT NULL, p_report_id uuid DEFAULT NULL)` | VOLATILE plpgsql, invoker. Returns boolean | `UPDATE profiles SET status = 'suspended' WHERE id = p_user_id AND status = 'active'`. If a row changed: insert `admin_actions('suspend', details = {reason})`, and with `p_report_id` set that report to `actioned`, `resolved_at`, `resolved_by`. Returns whether anything changed. `deleted` stays `deleted` |
| `app.admin_unsuspend_user(p_user_id uuid, p_note text, p_admin_id uuid DEFAULT NULL)` | same | `suspended` → `active` + `admin_actions('unsuspend')`. Cancelled items stay cancelled |

```sql
revoke all on function app.complete_rides(timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke all on function app.admin_suspend_user(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function app.admin_unsuspend_user(uuid, text, uuid) from public, anon, authenticated;
-- haide_api keeps EXECUTE through the default privileges (E7 admin endpoints call the same functions)
```
No new cron job: completion and the sweep run inside `haide-tick` (ADR 0024).

## 2. State machine (E5 additions)

`BOOKING_TRANSITIONS` in `_shared/domain/bookings.ts` becomes: `requested → confirmed | rejected | expired | cancelled`, `confirmed → cancelled | completed | no_show`, `completed → no_show`, every other state terminal. Every write stays a guarded `UPDATE … WHERE id = $1 AND status IN (<from>)` under the ride lock (ADR 0021). Zero rows → re-read → `INVALID_STATE`.

| Action (actor) | From → to | Guards (in order) | Side effects (same transaction) | Outbox → recipient | Analytics |
|---|---|---|---|---|---|
| Complete (tick) | confirmed → completed. Ride published → completed/expired | `departure_at <= now − 2 h` | `final_price_bani = locked`, `passenger_event_at`, `rides.completed_at` | `rating_prompt` → each passenger. `rating_prompt_driver` → driver (one per ride) | `ride_completed` (`rideId`, `seats` = completed bookings), only for `completed` rides |
| Mark no-show (driver) | confirmed/completed → no_show | caller is the ride driver (else 404) · status (`INVALID_STATE`) · `departure <= now < departure + 24 h` (`WINDOW_CLOSED`) · no rating on the booking (`INVALID_STATE`) | `no_show_by = 'driver'`, `no_show_at`, `final_price_bani = NULL`, `passenger_event_at`, `reliability_events(no_show)` **for the passenger** | `no_show_reported` → passenger | `no_show_reported` (`by: driver`) |
| Driver didn't show (passenger) | same | caller is the passenger, same guards | `no_show_by = 'passenger'`, reliability event **for the driver** | `no_show_reported` → driver | `no_show_reported` (`by: passenger`) |
| Block cascade (system) | requested/confirmed → cancelled | pair blocked either way · ride not departed | `cancelled_by = 'system'`, `late_cancel = false`, no reliability event, confirmed: `seats_booked − 1` + relock (never up) | blocker = passenger: `booking_cancelled` → driver (confirmed only). Blocker = driver: `booking_rejected` → passenger (+ `passenger_event_at`) | `booking_cancelled` (`by: system`, `late: false`) |
| Suspended passenger (sweep) | requested/confirmed → cancelled | passenger `suspended` · ride not departed | as block cascade | `booking_cancelled` → driver (confirmed only) | same |
| Suspended driver (sweep) | ride published → cancelled, bookings → cancelled | driver `suspended` · ride not departed | E4 ride-cancel cascade with `by = 'system'`: `late_cancel = false`, no reliability event, `seats_booked = 0` | `ride_cancelled` (`by: 'system'`) → each passenger | `booking_cancelled` (`by: system`) per booking |

No-show sketch (`repo/safety.ts`, inside `sql.begin`):
```sql
select r.id, r.driver_id, r.departure_at from app.rides r join app.bookings b on b.ride_id = r.id
 where b.id = $booking and (r.driver_id = $caller or b.passenger_id = $caller) for update of r;   -- 404 if none
select b.status, b.passenger_id from app.bookings b where b.id = $booking for update;              -- serialises with ratings
select exists (select 1 from app.ratings where booking_id = $booking) as rated;
update app.bookings set status = 'no_show', no_show_at = $now, no_show_by = $by, final_price_bani = null, updated_at = $now,
       passenger_event_at = case when $by = 'driver' then $now else passenger_event_at end
 where id = $booking and status in ('confirmed', 'completed') returning id;
insert into app.reliability_events (user_id, kind, booking_id, ride_id, occurred_at) values ($absentee, 'no_show', $booking, $ride, $now);
```

Timeline (`buildTimeline`): adds `completed` (at `rides.completed_at`) and `no_show` (at `no_show_at`). It shows `ride_cancelled` when `rideStatus = 'cancelled'` and `cancelledBy <> 'passenger'`, else `cancelled`. `TimelineInput` gains `rideStatus`, `completedAt` and `noShowAt`. The same rule drives the list pill (fixes the E4 low finding).

## 3. Ratings (`_shared/domain/ratings.ts`)

```ts
RATING_TAGS = { driver: ['punctual','friendly','safe_driving','clean_car'],          // tags a passenger gives a driver
                passenger: ['punctual','friendly','respectful','on_time_at_pickup'] } // tags a driver gives a passenger
assertCanRate({ status, completedAt, alreadyRated, rateeRole, tags }, clock)
  // status !== 'completed' → INVALID_STATE · now >= completedAt + 7 d → WINDOW_CLOSED · alreadyRated → ALREADY_RATED
  // tags ⊄ RATING_TAGS[rateeRole] or duplicates → DomainError VALIDATION_FAILED (fields.tags = invalid)
rateUntil(completedAt) = completedAt + RATING_WINDOW_DAYS
initialVisibleAt(completedAt, counterRated, now) = counterRated ? now : rateUntil(completedAt)
```
Rating transaction: `SELECT … FROM bookings b JOIN rides r … WHERE b.id = $1 FOR UPDATE OF b` (party check → 404) → guards → `SELECT 1 FROM ratings WHERE booking_id = $1 AND rater_id = $ratee` → `INSERT … (visible_at, created_at = now)` → if the counter-rating exists: `UPDATE ratings SET visible_at = least(visible_at, $now) WHERE booking_id = $1 AND rater_id = $ratee`. Unique violation `ratings_booking_id_rater_id_key` → `ALREADY_RATED`. The ratee may be deleted or suspended (the rating is still accepted). Ratings between a blocked pair on a completed ride are allowed (they are blind).

**One summary fragment** (`repo/ratingSummary.ts`) replaces the four copies in `repo/accounts.ts` and `repo/search.ts` and in the booking and owner-view repos:
```sql
(select count(*)::int    from app.ratings r where r.ratee_id = p.id and r.visible_at <= $now) as rating_count,
(select avg(r.stars)::float8 from app.ratings r where r.ratee_id = p.id and r.visible_at <= $now) as rating_avg,
((select count(*)::int from app.bookings b where b.passenger_id = p.id and b.status = 'completed')
 + (select count(*)::int from app.rides x where x.driver_id = p.id and x.status = 'completed')) as rides_completed
```
`toPublicUser` uses `rides_completed` (it is `0` today).

## 4. Reports, blocks, suspension

**Report** (`POST /reports`, `requireActive`): self → `400` (`fields.reportedUserId = self`). Unknown user → `404` (any status is accepted otherwise, so a suspension is not leaked). With `bookingId`, the booking's parties must be exactly `{caller, reported}`; with only `rideId`, both must be parties of the ride (driver or holder of any booking). Otherwise `404`. With `bookingId`, `ride_id` is derived from the booking. Transaction: insert with the snapshot (`first_name`, `phone_e164` read in SQL), `report_submitted` (`reason`), one `report_received` outbox row per active admin (`role = 'admin'`), and the block insert when `alsoBlock`. After the commit, run the block cascade (below).

**Block** (`POST /blocks`, `requireActive`): self → `400` (`fields.userId = self`), unknown → `404`. Tx 1: `INSERT … ON CONFLICT DO NOTHING`, commit. From that point concurrent requests and approvals see the block and fail with `BLOCKED` (they check under the ride lock). Tx 2, one per ride in ride-id order: `cancelBlockedPair(tx, a, b, now)` → lock the ride → guarded cancel of `requested`/`confirmed` bookings between the pair where `departure_at > now` → `seats_booked` / relock → outbox per §2. If tx 2 fails, still answer `204`: the sweep finishes the job. `DELETE /blocks/{userId}` deletes the caller's own row and is idempotent (`204` also when there is nothing). `GET /me/blocks` lists outgoing blocks only, newest first, max 200, each with `PublicUser` (deleted users included).

**Shared cancellation service** `api/services/cancellations.ts` (extracted from E4 `services/bookings.ts` and `services/rides.ts`, not rewritten): `cancelRideTx(tx, rideId, now, by: 'driver' | 'system')` and `systemCancelBookingTx(tx, bookingId, now, reason: 'blocked_by_passenger' | 'blocked_by_driver' | 'suspended_passenger')`. The E2/E4 endpoints call the same functions with `by = 'driver'` / `'passenger'`.

**Safety sweep** (tick step 3, each query `LIMIT SWEEP_BATCH = 50`, one transaction per ride):
1. Rides `published`, `departure_at > now`, driver `suspended` → `cancelRideTx(…, 'system')`.
2. Bookings `requested`/`confirmed`, ride not departed, passenger `suspended` → `systemCancelBookingTx(…, 'suspended_passenger')`.
3. Bookings `requested`/`confirmed`, ride not departed, the pair blocked either way → `blocked_by_passenger` if the passenger blocked the driver, else `blocked_by_driver`.

## 5. Share link and Call 112 (`_shared/domain/safety.ts` + `_shared/shareToken.ts`)

- `shareExpiresAt(departureAt) = departureAt + CONTACT_WINDOW_H`. `canShare` = viewer is the passenger and `status ∈ {confirmed, completed}`, ride not cancelled, `now < shareExpiresAt`.
- `_shared/shareToken.ts` (not domain, it uses WebCrypto): `newShareToken()` = 16 random bytes → base64url (22 chars). `hashShareToken(t)` = SHA-256 bytes. `SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/`.
- `POST /bookings/{id}/share-link`: `INSERT … ON CONFLICT (booking_id) DO UPDATE SET token_hash, created_at, expires_at` (rotation: the old link dies). URL = `${APP_BASE_URL}/s/${token}`.
- `GET /share/{token}`: malformed → `404` without a DB call. Valid only while the link exists, `now < expires_at`, booking `confirmed`/`completed`, ride not cancelled, and driver and passenger both `active`. Otherwise `404`. `phase` = `before` (now < departure) · `underway` (now < departure + 2 h and booking not completed) · `done`. Headers: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`. The logging middleware must record the template `/share/:token` (test it).
- `call112Window(departureAt) = { from: departure − CALL_112_BEFORE_MIN (15), until: departure + CALL_112_AFTER_H (2) }` for `status ∈ {confirmed, completed}`, else `null`. `show112 = from <= now < until`.
- New constants in `rules.ts`: `NO_SHOW_WINDOW_H = 24`, `CALL_112_BEFORE_MIN = 15`, `CALL_112_AFTER_H = 2`, `COMPLETE_BATCH = 200`, `SWEEP_BATCH = 50`, `SHARE_TOKEN_BYTES = 16`. `RATE_LIMITS` adds `report {10, 86400}`, `block {30, 3600}`, `shareView {30, 60}` (per IP).

## 6. Endpoints (contract file `_shared/contracts/safety.ts`, plus updates to `bookings.ts`, `rides.ts`, `system.ts`)

| Method & path | Auth / gates, rate limit | Request | Response | Errors |
|---|---|---|---|---|
| `POST /bookings/{id}/no-show` | party (same gate as E4 cancel), `bookingAction` | `{}` | driver: `200 RideOwnerView`. Passenger: `200 BookingView` | `404`, `409 WINDOW_CLOSED · INVALID_STATE` |
| `POST /bookings/{id}/ratings` | party, `bookingAction` | `{ stars: 1..5, tags: RatingTag[] (unique, ≤ 4) }` | `201 { stars, tags, createdAt }` (never says whether the counterpart rated) | `400` (`fields.tags`), `404`, `409 INVALID_STATE · WINDOW_CLOSED · ALREADY_RATED` |
| `POST /bookings/{id}/share-link` | passenger only (driver → `404`), `bookingAction` | `{}` | `201 { url, expiresAt }` | `404`, `409 INVALID_STATE · WINDOW_CLOSED` |
| `DELETE /bookings/{id}/share-link` | passenger only, `bookingAction` | — | `204` (idempotent) | `404` |
| `GET /share/{token}` | **Public**, `shareView` | — | `200 SharedTrip` | `404` |
| `POST /reports` | `requireActive`, `report` | `{ reportedUserId, reason: ReportReason, details?: string (NFC, trimmed, 1..500; required for other), rideId?, bookingId?, alsoBlock?: boolean = false }` | `201 { id }` | `400` (`fields.reportedUserId = self`, `fields.details = required`), `404` |
| `POST /blocks` | `requireActive`, `block` | `{ userId }` | `204` (idempotent) | `400` (`fields.userId = self`), `404` |
| `DELETE /blocks/{userId}` | `requireActive`, `block` | — | `204` (idempotent) | `400` malformed id |
| `GET /me/blocks` | `requireActive`, `account` | — | `{ items: { user: PublicUser; blockedAt }[] }` | — |

```ts
type RatingTag = 'punctual'|'friendly'|'safe_driving'|'clean_car'|'respectful'|'on_time_at_pickup';
type RatingGiven = { stars: number; tags: RatingTag[]; createdAt: string };
type SharedTrip = { departureAt; pickupEtaAt; phase: 'before'|'underway'|'done'; expiresAt;
  driver: { firstName: string; photoUrl: string | null }; car: { make; model; colour; plate: string };
  pickup: { label: string }; dropoff: { label: string }; route: LineString | null /* passenger's own segment */ };

// BookingView (additive)
completedAt: string | null; noShowBy: 'driver' | 'passenger' | null;
rating: { given: RatingGiven | null; rateUntil: string | null };          // viewer's own rating only
share: { active: boolean; expiresAt: string | null } | null;              // passenger viewer only
actions: { canCancel; lateCancelIfNow; canReportDriverNoShow /* passenger */; canMarkNoShow /* driver, new */;
           canRate; canShare; show112; call112Window: { from: string; until: string } | null /* new */ };
// price.finalBani: stored final for completed, locked between departure and completion, null for no_show

// RideOwnerView.passengers[] now holds confirmed, completed and no_show bookings
{ …E4 fields, status: 'confirmed'|'completed'|'no_show', noShowBy, canMarkNoShow, canRate, rateUntil, ratingGiven: RatingGiven | null }
// RideOwnerView (ride level, additive): completedAt, show112, call112Window
// RideListItem: + toRate: number (completed passengers the driver can still rate)
// BookingListItem: + cancelledBy, canRate
// TickResponse: { expired, completed, swept, sent, failed, purged }
```
Changes to existing endpoints: `GET /rides/{id}` is `404` for non-parties when the ride is `completed` (like `cancelled`/`expired`). `GET /users/{id}`, search results and request cards use the visible-only rating summary and the real `ridesCompleted`. `GET /me` stays gated by `requireActive`: a suspended user gets `403 ACCOUNT_SUSPENDED`, which the web turns into the suspended screen.

## 7. Notifications (new templates in `_shared/domain/outbox.ts` and `_shared/notify/templates.ts`)

| Template | To | Payload | Link |
|---|---|---|---|
| `rating_prompt` | passenger, per completed booking | `bookingId, driverFirstName, departureAt` | `/rate/{bookingId}` |
| `rating_prompt_driver` | driver, per completed ride | `rideId, passengerCount, departureAt` | `/driving/{rideId}` |
| `no_show_reported` | the absent party | `bookingId, rideId, reporterFirstName, reporterRole, departureAt` | passenger `/booking/{id}`, driver `/driving/{rideId}` |
| `report_received` | each active admin | `reportId, reason` | `APP_BASE_URL` only (E7 adds the queue) |
| `ride_cancelled` (E4, extended) | passenger | adds `by: 'driver' \| 'system'` | `system` uses the neutral subject |

`booking_cancelled` and `booking_rejected` are reused for sweep and block cascades (§2). Payloads carry ids, times, first names, roles and a reason enum only. The E4 payload scan test extends to every new template.

New i18n keys (server `_shared/i18n/en.json`):
- `email.ratePrompt.subject` "How was your ride with {driver}?" / `.body` "Rate {driver} within 7 days. They see your rating once you’ve both rated."
- `email.ratePromptDriver.subject` "Rate your passengers from the {time} ride" / `.body` "You have 7 days. Ratings stay hidden until both sides have rated."
- `email.noShow.subject` "{name} reported a no-show on the {time} ride" / `.body` "It shows on your profile for 90 days. If this is wrong, open Haide and report a problem."
- `email.report.subject` "New safety report: {reason}" / `.body` "Review it in the database until the reports queue ships."
- `email.rideCancelled.system.subject` "The {time} ride with {driver} was cancelled"

## 8. `POST /internal/tick` (order matters)
1. **Expire** (E4).
2. **Complete:** one transaction: `app.complete_rides(now, now − 2 h, COMPLETE_BATCH)`, then outbox and analytics per §2.
3. **Safety sweep** (§4).
4. **Dispatch** the outbox (E4, daily cap unchanged).
5. **Purge** expired route previews and `share_links WHERE expires_at < now`.
6. **Hourly housekeeping** (E4, unchanged).

Each step keeps its own try/catch + `app_errors`. `completed` counts rides moved to `completed` or `expired`. `swept` counts bookings cancelled by the sweep.

## 9. Web screens (`apps/web`, design per design-direction.md: tokens only, dark and light, one saffron primary per screen, reduced-motion fallbacks, 44 px targets, focus trap + Esc + return focus in sheets)

New files: `features/safety/` (`ReportSheet`, `BlockSheet`, `NoShowSheet`, `ShareSheet`, `Call112Button`, `useNow.ts`), `features/ratings/screens/RateScreen.tsx`, `features/profile/screens/BlockedPeopleScreen.tsx`, `features/share/screens/SharedTripScreen.tsx`, `src/api/safety.ts`. Screens are lazy routes, and sheets are lazy chunks loaded on open (initial JS stays within 200 KB gzip).

| # | Screen / component | Route / entry | Behaviour |
|---|---|---|---|
| 5.1 | **Rate** | `/rate/:bookingId`. Entry: completed booking banner CTA (`actions.canRate`), "Rate {name}" per passenger row on DrivingRideScreen, "Rate" chip on past BookingCard (`canRate`) and RideCard (`toRate > 0`) | Data from `GET /bookings/{id}`. The counterpart comes from `viewerRole`. Star `radiogroup` (5 native radios, arrow keys, `rate.star.*` labels), tag chips (`aria-pressed`) from `RATING_TAGS[counterpartRole]` exported by contracts, window note with `rateUntil`, sticky saffron "Send rating". Success state `rate.done.*` with the teal check (springs in; static with reduced motion). `ALREADY_RATED`/`WINDOW_CLOSED`/`INVALID_STATE` → inline error and a back link. Not shown when `rating.given` is set; the booking shows `booking.rating.sent` instead |
| 5.2 | **Report sheet** | Public profile menu (`pub.menu.report`), "Report a problem" on BookingScreen (both roles, any status after confirmed), passenger row menu on DrivingRideScreen | Reason radios (copy §26), details textarea with counter (required for Other), "Also block {name}" checkbox. Send → `POST /reports` with `bookingId` when opened from a booking. Sent state `report.sent.*` (mentions 112). Toast |
| 5.3 | **Block sheet** | Public profile menu, report sheet `alsoBlock` | Copy §27. Block → `POST /blocks` → toast `block.toast` → navigate to `/rides` (the profile is now 404). Invalidate `myBookings`, `myRides`, `summary`, `booking(*)`, search results |
| 6.3 | **Blocked people** | `/settings/blocked`. Row "Blocked people" in the Safety group of the Profile/Settings list | List (avatar, name or "Deleted user", blocked date), outline "Unblock" → `DELETE` → optimistic removal + toast `block.unblocked`. Empty `block.empty`. Loading/error states |
| 5.4 | **No-show sheet** | Passenger: "Driver didn’t show" on BookingScreen (`canReportDriverNoShow`). Driver: "Mark no-show" per passenger (`canMarkNoShow`) | Copy §23 (`rideday.driverMissing.*`, `rideday.noShow.*`). Confirm → `POST /bookings/{id}/no-show` → toast. Booking banner `booking.noShow.title` + the new body keys below |
| 5.5 | **Share sheet** | "Share trip link" on BookingScreen (`canShare`) | Copy §23. "Create link" → POST → read-only URL field, "Copy link" (`navigator.clipboard`), and `navigator.share` when available. The `{url, expiresAt}` is kept in `localStorage` under `haide.share.<bookingId>` until `expiresAt`, and cleared on sign-out. If `share.active` is true but nothing is stored locally, offer "New link" with the warning. "Stop sharing" → DELETE |
| 5.5b | **Shared trip page** | `/s/:token`, outside the tab shell, no auth calls | Driver photo and first name, plate in large Sora numerals, car, "Leaves at", phase line, pickup → drop-off labels, lazy `RouteMap` (exact mode, own segment) with text alternative, expiry note, "In an emergency, call 112" (`tel:112`). `404` → `share.gone.*`. `public/_headers`: `/s/*` → `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`. Telemetry reports the route template only |
| 5.6 | **Call 112** | BookingScreen and DrivingRideScreen | `Call112Button`: `<a href="tel:112">`, `error` token for border and label (outline, never a fill; a11y finding 10), phone icon, hint `rideday.call112.hint`. Visible while `call112Window.from <= now < until`. `useNow(30_000)` re-renders at the boundaries (the timer pauses when the tab is hidden) |
| 5.7 | **Suspended** | Any `ACCOUNT_SUSPENDED` from `/me` or a gated call | Full screen `error.suspended` with Sign out. Public browsing stays available |
| — | **States** | BookingScreen, DrivingRideScreen, lists | Completed banner (`booking.completed.*`), no-show banner, `cancelledBy = 'system'` banner, final price line `booking.pay.final`, no pay line for no-show. Passenger rows show the status pill and "You rated" |

New web i18n keys (add to `apps/web/src/i18n/en.json` and append to copy.md as "§37 E5 additions"): `booking.cancelledSystem.title` "This booking was cancelled" / `.body` "Other rides on your route might fit." · `booking.noShow.byDriver` "{driver} marked you as a no-show. If that’s wrong, report a problem." · `booking.noShow.byYou` "You reported that {driver} didn’t show." · `driverRide.noShow.byPassenger` "{name} reported that you didn’t show. If that’s wrong, report a problem." · `rideday.share.create` "Create link" · `rideday.share.new` "New link" · `rideday.share.newWarn` "The old link stops working." · `rideday.share.stop` "Stop sharing" · `rideday.share.stopped` "Link stopped" · `share.title` "{driver} is driving" · `share.leaves` "Leaves at {time}" · `share.phase.before` "Not left yet" · `share.phase.underway` "On the way" · `share.phase.done` "Trip finished" · `share.route` "From {pickup} to {dropoff}" · `share.expires` "This page stops working at {time}." · `share.gone.title` "This link no longer works" · `share.gone.body` "It has expired or the trip was cancelled." · `share.emergency` "In an emergency, call 112." · `errors.WINDOW_CLOSED` "The time to do this has passed." · `errors.ALREADY_RATED` "You’ve already rated this ride." · `a11y.call112` "Call 112, the emergency number".

## 10. Test plan

| Layer | File | Must cover |
|---|---|---|
| Unit (domain) | `_shared/domain/{bookings,ratings,safety}.test.ts` | Exhaustive transition table incl. `completed → no_show`. No-show guard order and window boundaries (departure −1 ms, exactly +24 h). `assertCanRate` (status, `rateUntil` −1 ms / exact, tags per role, duplicates). `initialVisibleAt`. `bookingActions` matrix (role × status × time) incl. `call112Window` boundaries (−15 min exact, +2 h exact). `buildTimeline` with completed, no_show, system cancel, ride cancelled after a passenger cancel. `shareExpiresAt`, `phase` |
| Unit (shared) | `_shared/shareToken.test.ts`, `notify/templates.test.ts` | Token length, alphabet and uniqueness over 10k. Hash is 32 bytes. Every new template renders with diacritics. The payload scan finds no coordinates, phones, plates or emails |
| Unit (API) | `api/safety.test.ts`, `api/tick.test.ts` | Routing, gates, rate limits, error mapping (`23505` on ratings → `ALREADY_RATED`). Tick step order with a fake clock. A failing sweep does not stop dispatch. The log line for `/share/:token` carries the template, not the token |
| pgTAP | `supabase/tests/008_trust_safety.test.sql` | 3 tables, named constraints, indexes, RLS on, `anon`/`authenticated` cannot select. `has_function_privilege` false for `public`/`anon`/`authenticated` on the 3 functions, true for `haide_api`. `has_column_privilege(haide_api, ratings.stars, UPDATE)` false, `visible_at` true. `admin_actions` UPDATE/DELETE false, `reports` DELETE false. `complete_rides`: 2 confirmed + 1 cancelled at −2 h 01 → ride completed, `completed_at = p_now`, finals = locked, cancelled untouched. Empty ride → expired. −1 h 59 untouched. Cancelled ride untouched. A no-show-only ride → expired. Second call returns 0 rows. `admin_suspend_user`: active → suspended + `admin_actions` + report actioned + `true`. Again → `false`. Deleted stays deleted. Unsuspend. `ratings_tags_allowed`, `bookings_no_show_meta`, `bookings_final_only_completed`, `reliability_events_booking_kind_uidx` |
| Integration | `tests/integration/trust-safety.test.ts` (factories: `departRide(rideId, minutesAgo)` and `setCompletedAt` through `INT_DB_URL`) | Completion via tick: statuses, final price, `ride_completed`, rating-prompt outbox rows sent. No-show both directions, window, reliability counters on `GET /users/{id}`, no rating after a no-show, no no-show after a rating. Ratings: window, duplicate, tags per role, **blind visibility** (the ratee's `rating.count` unchanged after one side; both rated → visible; one side + day 7 → visible), visible-only average across `/users`, `/search` and request cards. Reports: self, unknown, wrong booking → 404, snapshot stored, admin outbox row, `alsoBlock`. Blocks: hides search and profile both ways, cascade cancels a confirmed booking (seat freed, no late flag, no reliability event, right email per direction), list and unblock, idempotency. Suspension: SQL suspend → gates 403, tick cancels future rides (passengers emailed, `system` wording) and the passenger's bookings, hidden from search, profile 404. Share: create, rotate (old token 404), revoke, expiry at +24 h, booking cancelled → 404, response leak scan (no phone, no passenger data, no driver origin or destination: route endpoints equal the passenger's fractions) |
| Concurrency | same file, `describe('concurrency')` | **S1** tick completion in parallel with a driver no-show → consistent end state, `seats_booked` = accepted count. **S2** both parties rate in parallel → both `visible_at <= now`. **S3** rating in parallel with no-show → exactly one succeeds. **S4** block in parallel with approve and with `POST /bookings` for the pair, then one tick → no active future booking between them. Assert the accepted-seat invariant after each case. Repeat S3 5 times |
| E2E | `tests/e2e/e5-trust-safety.spec.ts` + `e5-screenshots.spec.ts` (mocked API, 360×800, `safety-helpers.ts`) | Completed booking → Rate (stars by keyboard, tags) → done state → "You rated". Driver rates a passenger and marks a no-show. Report sheet with Also block → redirect. Blocked people → Unblock. Share sheet create + copy, the shared page renders and its 404 state. Call 112 appears only inside the window (mock clock) with `href="tel:112"`. Suspended screen. Axe dark and light on Rate, Blocked people, Shared trip and the 3 sheets. Reduced motion: no spring on the rating confirmation. Screenshots in `docs/screenshots/E5/` (light and dark) |

## 11. Work split (one PR, both devs on `feat/trust-safety`, disjoint files)

**Order:** BE-1 (contracts) lands first. FE starts in parallel with BE-2 to BE-6. QA runs last.

**backend-dev**
1. `_shared/contracts/safety.ts` (new) and the additive fields in `bookings.ts`, `rides.ts`, `system.ts`. `RATE_LIMITS` and constants in `rules.ts`.
2. Migration (§1) + pgTAP 008.
3. Domain: `bookings.ts` (transitions, timeline, actions), `ratings.ts`, `safety.ts`, outbox builders + tests. `_shared/shareToken.ts`.
4. Templates and i18n (§7).
5. `repo/{safety,ratings,ratingSummary,shareLinks,sweep}.ts`, `services/{cancellations,safety,ratings,shareLinks}.ts` (extract the E4 cancel paths into `cancellations.ts`), `serializers/{bookings,rides,users,share}.ts`, `routes/{safety,share}.ts`. Tick steps 2, 3 and 5.
6. Integration + concurrency tests and factories. "Implemented in E5" notes in `api-contract.md` §5/§6, `data-model.md` §4.4/§4.5 (accepted-seat invariant, `visible_at`), the `architecture.md` jobs table (completion moved into the tick, ADR 0024), and the suspend/unsuspend signatures in `deploy.md`.

**frontend-dev** (no business rules: every flag and window comes from the API)
1. `src/api/safety.ts` + query keys. Mutations invalidate `booking(id)`, `myRide(id)`, `myBookings`, `myRides`, `summary`, `blocks`, `user(id)`.
2. Rate screen and its entry points (5.1).
3. Report, block and no-show sheets. Blocked people screen and the Settings row (5.2, 5.3, 5.4, 6.3).
4. Share sheet, shared trip page and `_headers` (5.5). `Call112Button` + `useNow` (5.6). Suspended screen (5.7).
5. Booking, driver ride and list state updates (§9 "States"). Pill uses `cancelledBy`.
6. i18n keys + copy.md §37. E2E specs and screenshots.

**qa-reviewer**: run all layers. Check in CI logs: blind-rating and leak-scan tests, the concurrency suite S1-S4, `has_function_privilege`/`has_column_privilege` coverage. Check axe, contrast of the red outline in both themes, reduced motion, the bundle budget, and that no token appears in logs or telemetry.

## 12. Out of scope
Admin UI and endpoints for the reports queue and suspend/unsuspend (E7: they call the same SQL functions), report retention and `DELETE /me` (E6), driver-created share links, disputes for no-shows (handled through reports), push notifications (E8-4), showing individual reviews.
