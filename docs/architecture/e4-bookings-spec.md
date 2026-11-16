# E4 implementation spec: booking lifecycle and notifications

> Owner: software-architect · Date: 2026-11-16 · Branch `feat/bookings` · Stories E4-1 to E4-7 plus the E2-4 cancel cascade
> Inputs: [backlog E4](../product/backlog.md), [data-model](data-model.md) §4.4/§5.2, [api-contract](api-contract.md) §3/§5/§10, [architecture](architecture.md) §8/§10, ADRs [0009](../decisions/0009-booking-request-then-approve-ux.md), [0015](../decisions/0015-route-matching-approach.md)
> New ADRs: [0021 ride row lock](../decisions/0021-booking-concurrency-ride-row-lock.md) · [0022 outbox + tick + Brevo](../decisions/0022-notification-delivery-outbox-tick-brevo.md) · [0023 reveal scope](../decisions/0023-confirmed-booking-reveal-scope.md)

## 0. Decisions in one screen

| Topic | Decision |
|---|---|
| Concurrency | Every transaction that changes a ride's bookings locks the ride first (`FOR UPDATE`), then makes guarded booking updates. Lock order is always ride, then bookings. The CHECK `rides_seats_booked_range` is the backstop and maps to `RIDE_FULL` (ADR 0021) |
| Invariant | `rides.seats_booked = count(bookings WHERE status = 'confirmed')` at all times, **including cancelled rides** (ride cancel sets it to 0). Asserted after every concurrency test |
| Exact snapped points | `POST /bookings` re-runs `app.match_rides(p_ride_id => …)` and stores `ST_LineInterpolatePoint(route_utm, f)` transformed to 4326. `match_rides` itself stays unchanged and never returns exact points |
| Labels | `bookings.pickup_label` and `dropoff_label` are **area names** (`app.area_for(exact point)`). They are safe for emails, lists and every viewer. Exact precision comes only from the revealed point on the map |
| Price | `price_quoted_bani = quoteUpTo(segment)` (n = 1). On every approve or confirmed cancel, `relockConfirmed()` (pure TS) sets each confirmed `price_locked = min(old, seatPrice(segment, rate, n))`. `droppedFromBani = quoted` when `locked < quoted`. Final price = locked once departed (E5 persists `final_price_bani`) |
| Re-request | Allowed after `cancelled` or `expired`. **Not** after `rejected` (`ALREADY_REQUESTED`), so a declined passenger cannot spam the driver |
| Expiry | `app.expire_requests(p_now)` in `tick`. Approve also checks `expires_at > now()`, which covers the up-to-1-minute tick lag |
| Emails | Outbox in the same transaction, sent by `tick` through Brevo HTTP. No email for a withdrawn request or a price drop (in-app only) (ADR 0022) |
| Badges | New column `bookings.passenger_event_at`, bumped by every change the passenger did not cause. Unseen = `passenger_event_at > coalesce(seen_by_passenger_at, '-infinity')`. `profiles.last_seen_summary_at` is not used (left in place, dropped in E6) |
| Reveal | Exact points, the passenger's own exact route segment, counterpart phone and plate only for `confirmed`/`completed` and `now < departure_at + 24 h`, through one pure function `revealFor()` (ADR 0023) |
| Error codes | No new codes. A reused `Idempotency-Key` with a different body → `400 VALIDATION_FAILED` (`fields.idempotencyKey = reused`) |

## 1. Migration `supabase/migrations/20261119090000_bookings.sql`

Forward-only. Header comment points to this spec.

### 1.1 `app.bookings`
Columns exactly as in data-model §4.4, plus:

| Column | Type | Notes |
|---|---|---|
| passenger_event_at | timestamptz NULL | last change the passenger should see (badge) |

Types and constraints (named):
- `ride_id uuid NOT NULL REFERENCES app.rides(id) ON DELETE RESTRICT`, `passenger_id uuid NOT NULL REFERENCES app.profiles(id)`.
- `pickup`, `dropoff geometry(Point,4326) NOT NULL`. `pickup_area_id`, `dropoff_area_id` FK → `areas ON DELETE SET NULL`. Labels `char_length BETWEEN 1 AND 80`.
- `bookings_fractions` `CHECK (0 <= pickup_fraction AND pickup_fraction < dropoff_fraction AND dropoff_fraction <= 1)`.
- `bookings_segment_min` `CHECK (segment_m >= 1000)`. Walks `CHECK (BETWEEN 0 AND 800)`.
- `bookings_price_nonneg` `CHECK (price_quoted_bani >= 0)`. `bookings_lock_le_quote` `CHECK (price_locked_bani IS NULL OR price_locked_bani <= price_quoted_bani)`. `final_price_bani <= price_locked_bani` when both are set.
- `bookings_locked_when_confirmed` `CHECK (status NOT IN ('confirmed','completed','no_show') OR price_locked_bani IS NOT NULL)`.
- `bookings_decided_has_time` `CHECK (status NOT IN ('confirmed','rejected') OR decided_at IS NOT NULL)`.
- `bookings_cancelled_has_meta` `CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL))`. `cancelled_by IN ('passenger','driver','system')`.
- `bookings_late_only_cancelled` `CHECK (NOT late_cancel OR status = 'cancelled')`.
- `bookings_expiry_after_request` `CHECK (expires_at > requested_at)`.
- `idempotency_key text CHECK (char_length(idempotency_key) <= 64)`, `UNIQUE (passenger_id, idempotency_key)`.

Indexes: the five from data-model §4.4 (`bookings_one_active_uidx` is UNIQUE partial on `('requested','confirmed')`).

### 1.2 Other schema changes
- `ALTER TABLE app.reliability_events ADD CONSTRAINT … FOREIGN KEY (booking_id) REFERENCES app.bookings(id)`, and the same for `ride_id` → `rides` if it is still missing. Add the same FK on `app.ratings.booking_id` (the accounts migration left both open).
- Grants: `REVOKE DELETE ON app.bookings FROM haide_api` (bookings are coarsened, never deleted).
- `ALTER TABLE app.bookings ENABLE ROW LEVEL SECURITY` with **no policies**. `REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated` (repeat it, as earlier migrations do).

### 1.3 Functions (each with `SET search_path = app, extensions, pg_catalog`)

| Function | Kind | Behaviour |
|---|---|---|
| `app.expire_requests(p_now timestamptz)` | VOLATILE SQL, returns setof `(booking_id, ride_id, passenger_id, departure_at, driver_first_name)` | `UPDATE app.bookings SET status = 'expired', passenger_event_at = p_now, updated_at = p_now WHERE status = 'requested' AND expires_at <= p_now RETURNING …` joined to rides and the driver's profile. No ride lock (seats untouched, ADR 0021) |
| `app.outbox_recipients(p_user_ids uuid[])` | STABLE, **SECURITY DEFINER**, owner `postgres` | Returns `(user_id, email)` from `auth.users` joined to `app.profiles` where `status = 'active'`. The only path from the API role to email addresses |
| `app.call_tick()` | VOLATILE, SECURITY DEFINER | Reads `api_tick_url` and `cron_secret` from `vault.decrypted_secrets`. **Returns without doing anything if either is missing** (local and CI). Otherwise `net.http_post(url, '{}'::jsonb, headers => {x-cron-secret, content-type}, timeout_milliseconds => 10000)` |
| cron | — | `SELECT cron.schedule('haide-tick', '* * * * *', $$select app.call_tick()$$);` (idempotent by name) |

**PUBLIC EXECUTE revoke (mandatory carry-forward):**
```sql
revoke all on function app.expire_requests(timestamptz) from public, anon, authenticated;
revoke all on function app.outbox_recipients(uuid[]) from public, anon, authenticated;
revoke all on function app.call_tick() from public, anon, authenticated, haide_api;
-- haide_api keeps EXECUTE on expire_requests and outbox_recipients through default privileges
```

## 2. State machine (E4 scope)

`requested → confirmed | rejected | expired | cancelled` and `confirmed → cancelled` (E5 adds `completed` and `no_show`). Implement the table as `BOOKING_TRANSITIONS` in `_shared/domain/bookings.ts`. Every write is `UPDATE … WHERE id = $1 AND status = <from>`. Zero rows updated → re-read and answer `INVALID_STATE` or `REQUEST_EXPIRED`.

| Action (actor) | From → to | Guards (in this order, under the ride lock) | Side effects in the same transaction | Outbox → recipient | Analytics |
|---|---|---|---|---|---|
| Request (passenger) | ∅ → requested | idempotency replay · `OWN_RIDE` · block either way → `BLOCKED` · driver not active → 404 · active or rejected booking → `ALREADY_REQUESTED` · ride not `published` or `now >= departure − 10 min` → `RIDE_NOT_BOOKABLE` · `seats_booked >= seats_offered` → `RIDE_FULL` · match re-check fails → `NO_LONGER_MATCHES` | insert with exact snapped points, `expires_at = bookingExpiresAt(now, departure)` | `booking_requested` → driver | `booking_requested` |
| Approve (driver) | requested → confirmed | caller is the driver (else 404) · ride `published` · `expires_at > now` (else `REQUEST_EXPIRED`) · block either way → `BLOCKED` · seat free (else `RIDE_FULL`) | `seats_booked + 1`, `decided_at`, relock **all** confirmed bookings, `passenger_event_at = now` for the approved booking and for every booking whose lock dropped | `booking_confirmed` → passenger | `booking_confirmed` (`responseSeconds`) |
| Reject (driver) | requested → rejected | driver · `expires_at > now` (else `REQUEST_EXPIRED`) | `decided_at`, `passenger_event_at` | `booking_rejected` → passenger | `booking_rejected` (`responseSeconds`) |
| Expire (tick) | requested → expired | `expires_at <= now` | `passenger_event_at` | `booking_expired` → passenger | `booking_expired` |
| Cancel (passenger) | requested → cancelled | passenger · `now < departure` | `cancelled_by = 'passenger'` | none (withdrawn request) | `booking_cancelled` (`by: passenger`, `late: false`) |
| Cancel (passenger) | confirmed → cancelled | passenger · `now < departure` | `seats_booked − 1`, relock the rest (never up), `late_cancel` + `reliability_events(late_cancellation, booking_id)` when `isLateCancel` | `booking_cancelled` → driver | `booking_cancelled` (`late`) |
| Ride cancel (driver, E2 endpoint) | requested/confirmed → cancelled | existing E2 guards | `cancelled_by = 'driver'`, `passenger_event_at`, `rides.seats_booked = 0`. Replaces the `activePassengerIds` stub with `cancelRideBookings(tx, rideId, now)` (UPDATE … RETURNING) | `ride_cancelled` → each passenger, **per booking** (own pickup and dropoff area) | `booking_cancelled` (`by: driver`) per booking |

Approve sketch (`repo/bookings.ts`, inside `sql.begin`, `SET LOCAL statement_timeout = '5s'`):
```sql
select r.* from app.rides r join app.bookings b on b.ride_id = r.id
 where b.id = $booking and r.driver_id = $caller for update of r;          -- 404 if none
update app.bookings set status = 'confirmed', decided_at = $now, price_locked_bani = $p, passenger_event_at = $now
 where id = $booking and status = 'requested' and expires_at > $now returning id;  -- 0 rows → re-read → REQUEST_EXPIRED | INVALID_STATE
update app.rides set seats_booked = seats_booked + 1, updated_at = $now where id = $ride;  -- 23514 → RIDE_FULL (rollback)
-- then select confirmed (id, segment_m, price_locked_bani), relockConfirmed() in TS, update the changed rows
```
Check `seats_booked < seats_offered` explicitly before the updates (clear error). The CHECK is only the backstop.

## 3. Pricing in E4 (`_shared/domain/bookings.ts`, reusing `pricing.ts`)

```ts
relockConfirmed(confirmed: { id; segmentM; lockedBani: number | null }[], rateMicro, isFree)
  → { id; lockedBani; dropped: boolean }[]   // n = confirmed.length; locked = relock(old ?? quoted, seatPriceBani(seg, rate, n, isFree))
```
- The newly approved booking enters with `old = price_quoted_bani`.
- Passenger and driver views read the same stored `price_locked_bani`. The price shown is `final ?? locked ?? quoted`. `finalBani` in the API = `locked` once `now >= departure_at` (E5 stores it at completion).
- The driver's request card shows `priceIfAcceptedBani = seatPriceBani(segment, rate, nConfirmed + 1, isFree)`.

## 4. Visibility rules (ADR 0023)

`revealFor({status, departureAt}, clock)` = `status ∈ {confirmed, completed} && now < departureAt + 24 h` (reuse `contactWindowOpen`). The boundary is exclusive: hidden at exactly +24 h.

| Field | Passenger (own booking) | Driver (own ride) | Anyone else |
|---|---|---|---|
| `pickup.point`, `dropoff.point` | exact (5 dp) if revealed, else 300 m grid + `approx: true` | same, per passenger in `passengers[]` | booking is 404 |
| `route` | revealed: exact **own segment** `ST_LineSubstring(route_utm, f_p, f_d)` → 4326. Else `app.public_route(route)`. `null` when coarsened | owner view keeps the full route (E2) | — |
| `contact.phoneE164` | driver's phone if revealed, else `contact: null` | passenger's phone in `passengers[].phoneE164` if revealed, else `null` | — |
| `car.plate` | from `vehicle_snapshot` if revealed, else `null` | own plate (E2) | — |
| Requests (`requests[]`) | — | public profile, area labels, `segmentM`, price. **Never** points | — |

Emails, outbox payloads, analytics and logs never carry coordinates, phones, plates or email addresses.

## 5. Endpoints (add to api-contract.md as "Implemented in E4" notes)

Shared contract file: `supabase/functions/_shared/contracts/bookings.ts` (zod). Rate limits added to `RATE_LIMITS`: `bookingRequest {10, 3600}`, `bookingAction {30, 60}` (approve, reject, cancel), `summary` reuses `account` (30/min).

| Method & path | Auth / gates | Request | Response | Errors |
|---|---|---|---|---|
| `POST /bookings` | consent + complete profile, `bookingRequest` | header `Idempotency-Key` (uuid, required), body `{ rideId, from: LatLng, to: LatLng }` (coverage box, 5 dp) | `201 BookingView`. A replay with the same key and ride returns `201` with the current view | `400 VALIDATION_FAILED` (key missing or reused), `404`, `409 OWN_RIDE · BLOCKED · ALREADY_REQUESTED · RIDE_NOT_BOOKABLE · RIDE_FULL · NO_LONGER_MATCHES` |
| `GET /me/bookings?scope=upcoming\|past&limit&cursor` | active | — | `{ items: BookingListItem[], nextCursor }`. Upcoming = `requested`/`confirmed` and `departure_at > now`, ascending. Past = the rest, descending. Keyset on `(departure_at, id)` like `/me/rides` | `400` |
| `GET /bookings/{id}` | passenger or ride driver, else 404 | — | `200 BookingView` | `404` |
| `POST /bookings/{id}/approve` | ride driver, `bookingAction` | `{}` | `200 RideOwnerView` | `404`, `409 REQUEST_EXPIRED · RIDE_FULL · BLOCKED · INVALID_STATE` |
| `POST /bookings/{id}/reject` | ride driver, `bookingAction` | `{}` | `200 RideOwnerView` | `404`, `409 REQUEST_EXPIRED · INVALID_STATE` |
| `POST /bookings/{id}/cancel` | passenger, `bookingAction` | `{}` | `200 BookingView` | `404`, `409 INVALID_STATE` (terminal, or departed) |
| `GET /me/summary` | active | — | `{ driverPendingRequests, passengerUnseenUpdates, nextRide: { kind: 'booking'\|'ride', id, departureAt } \| null }` | — |
| `POST /me/summary/seen` | active | `{ bookingIds: uuid[1..50] }` | `204`. Sets `seen_by_passenger_at = now` on the caller's own bookings only, ignores others | `400` |

```ts
type BookingListItem = { id; rideId; status: BookingStatus; rideStatus: RideStatus; departureAt; pickupEtaAt;
  pickupLabel; dropoffLabel; driver: PublicUser; priceBani: number /* final ?? locked ?? quoted */; unseen: boolean };

type BookingView = { id; status; rideId; rideStatus; viewerRole: 'passenger' | 'driver';
  departureAt; pickupEtaAt /* rounded 5 min */; requestedAt; expiresAt; decidedAt: string | null; cancelledAt: string | null;
  cancelledBy: 'passenger' | 'driver' | 'system' | null;
  pickup:  { point: LatLng | ApproxPoint; label: string; walkM: number /* 50 m */ };
  dropoff: { point: LatLng | ApproxPoint; label: string; walkM: number };
  segmentM: number; route: LineString | null;
  price: { quotedBani; lockedBani: number | null; finalBani: number | null; droppedFromBani: number | null };
  driver: PublicUser; passenger: PublicUser; car: { make; model; colour; plate: string | null };
  contact: { phoneE164: string; revealedUntil: string } | null;      // counterpart's phone
  timeline: { status: BookingStatus | 'ride_cancelled'; at: string }[];
  unseen: boolean;                                                    // passenger viewer only, else false
  actions: { canCancel: boolean; lateCancelIfNow: boolean;
             canReportDriverNoShow: false; canRate: false; canShare: false; show112: false } };  // E5 fills these
```

Changes to existing endpoints:
- `GET /me/rides`: `pendingRequests` = count of `requested` with `expires_at > now`.
- `GET /me/rides/{id}`: `requests[]` (requested, not past `expires_at`, sorted by `expires_at` ascending, shape per api-contract plus `priceIfAcceptedBani`). `passengers[]` (status `confirmed`. E5 adds `completed`/`no_show`). Points, phone and plate go through `revealFor`. `canMarkNoShow` and `canRate` stay `false`.
- `GET /rides/{id}`: `viewer.bookingId`/`bookingStatus` = the viewer's latest booking on the ride. A cancelled ride stays visible to its passengers (party rule).
- `POST /rides/{id}/match`: adds `ALREADY_REQUESTED` (active or rejected booking). Reason priority: `OWN_RIDE`, `ALREADY_REQUESTED`, `RIDE_NOT_BOOKABLE`, `RIDE_FULL`, `NO_LONGER_MATCHES`.
- `POST /rides/{id}/cancel`: real cascade (§2). The `ride_cancelled` payload becomes per booking.
- `POST /internal/tick`: response adds `purged` (additive): `{ expired, sent, failed, purged }`.

## 6. Notifications

### 6.1 Templates (`_shared/notify/templates.ts`, strings in `_shared/i18n/en.json` from copy.md §34)
Payload type is a discriminated union. Fields are ids, ISO times, first names and **area names only**.

| Template | To | Payload | Link |
|---|---|---|---|
| `booking_requested` | driver | `bookingId, rideId, passengerFirstName, departureAt, pickupArea, dropoffArea, expiresAt` | `/driving/{rideId}` |
| `booking_confirmed` | passenger | `bookingId, driverFirstName, departureAt, pickupEtaAt, pickupArea` | `/booking/{id}` |
| `booking_rejected` | passenger | `bookingId, driverFirstName, departureAt` | `/booking/{id}` |
| `booking_expired` | passenger | `bookingId, driverFirstName, departureAt` | `/booking/{id}` |
| `ride_cancelled` | passenger | `bookingId, rideId, driverFirstName, departureAt, pickupArea, dropoffArea` | `/booking/{id}` |
| `booking_cancelled` | driver | `bookingId, rideId, passengerFirstName, departureAt` (confirmed bookings only) | `/driving/{rideId}` |

Times are rendered in Europe/Bucharest (`bucharestTime`, plus `ddd D MMM` when not today). Links are `${APP_BASE_URL}…`. The plain-text body and minimal HTML (no images, no tracking pixels) are rendered at send time. `email.priceDropped.body` stays unused.

### 6.2 Dispatcher (`_shared/notify/dispatch.ts`, ADR 0022)
1. `remaining = EMAIL_DAILY_CAP − count(status = 'sent' AND sent_at >= UTC midnight)`. If `<= 0`, stop.
2. Claim: `UPDATE app.outbox SET attempts = attempts + 1, send_after = now + 5 min WHERE id IN (SELECT id FROM app.outbox WHERE status = 'pending' AND send_after <= now ORDER BY send_after LIMIT least(50, remaining) FOR UPDATE SKIP LOCKED) RETURNING *`.
3. `app.outbox_recipients(ids)`. A row with no recipient → `failed`, `last_error = 'no_recipient'`.
4. Send 4 at a time through `EmailProvider.send({ to, subject, text, html, tag: template })`.
   - Brevo: `POST https://api.brevo.com/v3/smtp/email`, header `api-key`, timeout 10 s.
   - Console provider: logs the template and a hash of the user id, never the address.
5. Success → `status = 'sent'`, `sent_at`. Transient failure (5xx, 429, timeout) → `send_after = now + [1, 2, 4, 8] min` by attempt, then `failed` after 5. Permanent failure (other 4xx) → `failed`. `last_error` is truncated to 300 chars and scrubbed.

## 7. `POST /internal/tick` (every minute)
Each step runs in its own try/catch. A failure is logged plus `app_errors(source = 'server')`, and the next step still runs.
1. **Expire:** in one transaction, `app.expire_requests(now)`, then outbox `booking_expired` rows plus `booking_expired` analytics.
2. **Dispatch** the outbox (§6.2).
3. **Purge route previews:** `DELETE FROM app.route_previews WHERE expires_at < now` (E2 carry-forward).
4. **Hourly housekeeping** (only when `now` minute is 0 UTC): `rate_limits` with `window_start < now − 2 days`, `app_errors` older than 14 days, `outbox` with `status <> 'pending'` and `created_at < now − 30 days` (carry-forward).

Response: `{ expired, sent, failed, purged }`. `purged` = deleted previews + housekeeping rows. The clock is injected (`Clock`), so tests drive time.

## 8. Test plan

| Layer | File | Must cover |
|---|---|---|
| Unit (domain) | `_shared/domain/bookings.test.ts` | Exhaustive transition table. Guard order of the request checks. `relockConfirmed` against Trip A mixed (P1 full route 2.60, P2 from Shopping City 1.20 RON). **Properties** (seeded, about 500 runs) over random approve and cancel sequences: a lock never increases, Σ locked ≤ n/(n+1) × trip cost, locked_i ≤ segment cost_i / 2. `revealFor` boundaries (−1 ms, exactly +24 h, statuses). `droppedFromBani` |
| Unit (notify) | `_shared/notify/*.test.ts` | Each template renders subject, text and link with diacritics. A payload scan regex finds no coordinates (`\d+\.\d{4,}`), `+40` phones or plates. Dispatcher with a fake provider and clock: cap reached, lease, backoff schedule, permanent versus transient failure, missing recipient |
| Unit (API) | `api/bookings.test.ts` (recording fake sql, existing pattern) | Route wiring, gates, rate limits, idempotency header validation, error mapping (`23505` on the one-active index → `ALREADY_REQUESTED`, `23514` → `RIDE_FULL`) |
| pgTAP | `supabase/tests/007_bookings.test.sql` | Table, columns, named constraints (fractions, lock ≤ quote, locked when confirmed, cancelled meta). Unique one-active index. RLS enabled. `anon`/`authenticated` cannot select. `has_function_privilege` false for `public`/`anon`/`authenticated` on the 3 new functions and for `haide_api` on `call_tick`. `expire_requests` expires only past-due `requested` rows and is idempotent. `call_tick` is a no-op without Vault secrets. Cron job `haide-tick` exists. FKs on `reliability_events.booking_id` and `ratings.booking_id` |
| Integration | `tests/integration/bookings.test.ts` | Lifecycle: request → approve → detail reveals → passenger cancel (late and not late) → ride cancel cascade. Reject. Expiry: set `expires_at` in the past through `INT_DB_URL`, call tick, expect `expired` plus outbox `sent` (console). Idempotent replay and a reused key. Re-request after cancel succeeds, after reject → `ALREADY_REQUESTED`. Match endpoint reasons. Summary counts and `seen`. **Leak scan** (reuse the E3 JSON-path helper) over `GET /bookings/{id}`, `/me/bookings`, `/me/rides/{id}`, `/rides/{id}` for requested, rejected, expired, cancelled and third-party viewers, and after moving `departure_at` to −25 h: no exact coordinates, phone or plate |
| **Concurrency** | same file, `describe('concurrency')` | **C1** ride with 2 seats, 6 requests, 6 approvals in `Promise.all` → exactly 2 × 200, 4 × `RIDE_FULL`. **C2** same booking approved twice in parallel → one 200, one `INVALID_STATE`. **C3** approve in parallel with ride cancel → never a `confirmed` booking on a cancelled ride. **C4** approve in parallel with tick after forcing `expires_at` into the past → never confirmed. **C5** passenger cancel in parallel with approval of another booking. **C6** 3 parallel `POST /bookings` with the same key → one row and the same id. After every case assert `seats_booked = count(confirmed)` and that no lock exceeds its previous value. Repeat C1 5 times in a loop |
| E2E | `tests/e2e/e4-bookings.spec.ts` (mocked API, 360×800) | Request sheet → booking detail (requested) → mocked confirmed state shows the contact card with `tel:` and `https://wa.me/40…` links. Driver accepts a request. Badge count on My rides. Riding list. Axe dark and light on the 4 screens. Reduced motion: no pulse or launch animation |

## 9. Work split (one PR, both devs on `feat/bookings`, disjoint files)

**Order:** BE-1 lands first (contracts), then FE starts in parallel with BE-2 to BE-6. QA runs last.

**backend-dev**
1. `_shared/contracts/bookings.ts` (zod, §5), owner-view and public-view contract updates, `RATE_LIMITS` additions.
2. Migration (§1) + pgTAP 007.
3. `_shared/domain/bookings.ts` (transitions, guards, `relockConfirmed`, `revealFor`, outbox builders) + tests. Update `domain/rides.ts` `rideCancelledOutbox` to per-booking payloads.
4. `_shared/notify/{templates,dispatch}.ts`, `_shared/providers/email/{index,brevo,console}.ts`, `_shared/i18n/en.json` (email keys).
5. `api/repo/bookings.ts`, `api/services/bookings.ts`, `api/serializers/bookings.ts`, `api/routes/bookings.ts`. Update `services/rides.ts` (cancel cascade, remove the `activePassengerIds` stub), `serializers/rides.ts` (`requests`, `passengers`, `pendingRequests`), `services/search.ts` (`ALREADY_REQUESTED`, viewer booking), `routes/system.ts` (tick), the `GET /me/summary` and `POST /me/summary/seen` routes.
6. `tests/integration/bookings.test.ts` (incl. concurrency) and factories. Add "Implemented in E4" notes to `api-contract.md` and data-model §4.4 (`passenger_event_at`, labels are area names).

**frontend-dev** (no pricing logic: every number comes from the API)
1. `src/api/bookings.ts` + query keys. Mutations invalidate `summary`, `myBookings`, `booking(id)`, `myRide(id)`, `ride(id)`.
2. **Request seat sheet (4.1)** on `RideDetailScreen`, replacing the "coming soon" toast: summary, "Up to" price, three plain lines with the deadline as a clock time, Send. `Idempotency-Key = crypto.randomUUID()` per attempt, kept in sessionStorage. Offline: queue one pending request (same key) and retry on `online` while the app is open, with a "queued" note. Success → `/booking/:id` with the launch moment ("Haide!", ADR 0020). Each `notBookableReason` is a disabled reason. `ALREADY_REQUESTED` links to the booking.
3. **Booking detail `/booking/:id` (4.2)**: state banner for every status incl. ride cancelled, timeline, `RouteMap` (exact pins when revealed, else 300 m circles and the locked-row explanation), price card with the price-dropped banner (saffron dot pulses once, none with reduced motion), contact card (Call `tel:`, WhatsApp `https://wa.me/<digits>`, plate) with "visible until …". Calls `POST /me/summary/seen` when `unseen`. **Cancel sheet (4.3)** with the late warning from `actions.lateCancelIfNow`.
4. **Riding list (4.4)** in `RidesScreen` (Upcoming and Past booking cards, status pill, unseen dot) and booking cards linking to `/booking/:id`.
5. **Driver requests** in `DrivingRideScreen`: request cards (public profile, area labels, `priceIfAcceptedBani`, "answer by HH:mm"), Accept and Decline with inline `RIDE_FULL` and `REQUEST_EXPIRED`, passengers list with Call and WhatsApp when revealed, exact passenger pins on `OwnerMap`. `pendingRequests` badge on `RideCard`.
6. **Badges (4.6)**: `useSummary()` (TanStack Query, `refetchInterval: 60_000`, no background refetch, refetch on focus, signed-in only). The My rides badge = `driverPendingRequests + passengerUnseenUpdates`, with the spoken count in the tab's accessible name.
7. i18n keys from copy.md §13 and §22. `errors.*` for every code above. New screens lazy-loaded (bundle budget 200 KB gzip initial). `tests/e2e/e4-bookings.spec.ts`.

**qa-reviewer**: run all layers. Check the leak scan and the concurrency suite in CI logs, reduced motion, axe and contrast on the 4 screens, the bundle budget, and `has_function_privilege` coverage.

## 10. Out of scope (E5+)
Completion job and `final_price_bani` persistence, no-show, ratings, share link, Call 112, block and report endpoints (approve and request already honour existing blocks), auto-accept (E8-3), web push (E8-4), `DELETE /me` and suspension cascades.
