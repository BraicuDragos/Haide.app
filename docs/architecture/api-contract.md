# API contract (REST, v1)

> Owner: software-architect · Date: 2026-11-15 · Implementation: Edge Function `api` (Hono). Schemas: zod in `supabase/functions/_shared/contracts/` (shared with the web app)
> Related: [architecture.md](architecture.md) · [data-model.md](data-model.md) (authorization matrix §5.2) · [conventions.md](conventions.md)

## 1. General rules

| Topic | Rule |
|---|---|
| Base URL | `https://<project-ref>.supabase.co/functions/v1/api/v1`. Local: `http://127.0.0.1:54321/functions/v1/api/v1`. Web env var `VITE_API_BASE_URL` |
| Format | JSON, UTF-8, **camelCase** keys. `Content-Type: application/json` (except the photo upload: `multipart/form-data`) |
| Auth | `Authorization: Bearer <supabase access token>`. Marked **Public** = works without it (if sent, it is used, for example to hide blocked users) |
| Times | ISO 8601 UTC with `Z` (`2026-11-16T05:30:00Z`). The client converts for display in Europe/Bucharest |
| Money | Integers in **bani** (`priceBani: 390` = 3.90 RON). Never floats |
| Coordinates | `{ "lat": 45.79712, "lng": 24.15211 }` WGS84. Exact coordinates have 5 decimals (about 1 m). Approximate ones are 300 m grid centres with `approx: true` and `radiusM: 300` |
| Distances | Integer metres. Walk distances in responses are rounded to 50 m |
| Location in requests | Always in the **POST body**, never in URLs (keeps coordinates out of logs) |
| Pagination | `?limit=20&cursor=<opaque>`. Response `{ items: [...], nextCursor: string \| null }` |
| Idempotency | `POST /bookings` requires `Idempotency-Key: <uuid>`. A replay returns the original response |
| Rate limits | `429 RATE_LIMITED` with a `Retry-After` header |
| Versioning | Path prefix `/v1`. Additive changes only within v1 |
| CORS | Allowed origins: `https://haide.ro`, `https://www.haide.ro`, `http://localhost:5173`, plus Pages preview origins in dev |

### 1.1 Error envelope

```json
{ "error": { "code": "RIDE_FULL", "message": "All seats on this ride are taken.", "fields": { "seats": "too_many" }, "requestId": "01J..." } }
```

`code` is stable and maps to the i18n key `errors.<CODE>` in the web app. `message` is developer-facing English. `fields` is present for validation errors.

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_FAILED`, `SAME_PLACE`, `DEPARTURE_TOO_SOON` (< 15 min), `DEPARTURE_TOO_FAR` (> 14 days), `ROUTE_TOO_SHORT` (< 1 km), `ROUTE_TOO_LONG` (> 40 km), `SEATS_EXCEED_VEHICLE`, `PREVIEW_EXPIRED`, `PHOTO_INVALID`, `PHOTO_TOO_LARGE`, `CONFIRMATION_REQUIRED` |
| 401 | `UNAUTHENTICATED` |
| 403 | `ACCOUNT_SUSPENDED`, `ACCOUNT_DELETED`, `CONSENT_REQUIRED`, `PROFILE_INCOMPLETE`, `VEHICLE_REQUIRED`, `FORBIDDEN` (admin routes) |
| 404 | `NOT_FOUND` (also used when the caller may not see the resource) |
| 409 | `DAILY_RIDE_LIMIT` (4 per day), `RIDE_FULL`, `RIDE_NOT_BOOKABLE` (cancelled/completed/departing in < 10 min), `OWN_RIDE`, `BLOCKED`, `ALREADY_REQUESTED`, `NO_LONGER_MATCHES`, `INVALID_STATE` (transition not allowed), `REQUEST_EXPIRED`, `WINDOW_CLOSED` (rating/no-show window over), `ALREADY_RATED`, `ALERT_LIMIT` (E8), `LARGE_CHANGE` (admin energy price ±30 %) |
| 422 | `ROUTE_NOT_FOUND` (router found no route) |
| 429 | `RATE_LIMITED` |
| 502/503 | `ROUTING_UNAVAILABLE`, `UPSTREAM_ERROR`, `TEMPORARILY_UNAVAILABLE` (E6: `DELETE /me` lost a lock race twice; retry) |
| 500 | `INTERNAL` (no details leaked) |

### 1.2 Shared types

```ts
type LatLng = { lat: number; lng: number };
type ApproxPoint = LatLng & { approx: true; radiusM: 300 };
type Place = { id: string; name: string; secondary: string; kind: 'street'|'poi'|'address'|'area'; point: LatLng; areaName: string };
type PublicUser = { id: string; firstName: string | null /* null = "Deleted user" */; photoUrl: string | null;
  memberSince: string /* YYYY-MM */; rating: { average: number; count: number } | null /* null = "New" (< 3) */;
  ridesCompleted: number; lateCancellations90d: number; noShows90d: number; bio: string | null };
type CarPublic = { make: string; model: string; colour: string };            // never the plate
type PriceRow = { passengers: 1|2|3|4; priceBani: number };
type RideStatus = 'published'|'cancelled'|'completed'|'expired';
type BookingStatus = 'requested'|'confirmed'|'rejected'|'expired'|'cancelled'|'completed'|'no_show';
type FuelType = 'petrol'|'diesel'|'lpg'|'hybrid'|'electric';
```

## 2. Public endpoints

### `GET /health`: Public
`200 { "status": "ok", "db": "ok", "version": "<git sha>" }`

### `GET /legal/current`: Public
`200 { "terms": { "version": "1.0", "url": "/policy/terms" }, "privacy": { "version": "1.0", "url": "/policy/privacy" } }`

### `GET /places?q=selimbar&limit=8`: Public. Rate limit 60/min
Diacritics-insensitive autocomplete from the gazetteer, biased to Sibiu. `q` is 2–80 chars.
`200 { "items": Place[] }`

### `GET /popular-routes?limit=5`: Public. Rate limit 60/min (the public-read limit)
Popular corridors for the Find screen. `limit` 1 to 10 (default 5). `Cache-Control: public, max-age=300`. No personal data.
`200 { "items": [{ "from": Place, "to": Place, "rides": number, "source": "data" | "curated" }] }`

**Definition of popular** (SQL `app.popular_routes(p_now, p_limit)`, STABLE, no EXECUTE for `PUBLIC`/`anon`/`authenticated`):
- Rides with `departure_at` from 30 days before now to 14 days after now, status `published` or `completed` (cancelled and expired are excluded).
- Grouped by (`origin_area_id`, `destination_area_id`); both must be known and different.
- `score = rides + bookings in confirmed or completed` on those rides.
- A route is returned only if at least **2 distinct drivers** published it (privacy: one person's pattern is never exposed).
- Order: score desc, rides desc, origin area name, destination area name (deterministic). Limit 5 (default), max 10.

`from` and `to` are ordinary `Place`s at area level: the gazetteer place of kind `area` for that area (rank 1), else the area centroid with the area id as a stable `id` (the same fallback `POST /places/reverse` uses). The web can pass `place.point` straight to `POST /search` as `from` and `to`; no name lookup is needed.

**Fallback:** when fewer than 3 real routes qualify, the list is filled up to 3 with `CURATED_PILOT_ROUTES` (Cisnădie to Piața Mare, Șelimbăr to Zona Industrială Vest, Hipodrom to Piața Mare), resolved server-side by name to gazetteer places and skipped if a name cannot be resolved. Curated items have `source: "curated"` and `rides: 0` and **must not be shown as a popularity count**. A curated item never duplicates a real route (same ids or same names). Real items come first, `source: "data"`, `rides` is the number of rides in the window.

Errors: `400 VALIDATION_FAILED` (`fields.limit`), `429 RATE_LIMITED`.

### `POST /places/reverse`: Public. Rate limit 60/min
Body `{ "point": LatLng }` → `200 { "place": Place }` (nearest address/street + area). `404` outside the coverage bbox.

### `POST /search`: Public. Rate limit 30/min
```json
{ "from": {"lat":45.7105,"lng":24.1530}, "to": {"lat":45.7972,"lng":24.1521},
  "date": "2026-11-16", "time": "07:30", "windowMin": 30 }
```
`windowMin ∈ {15,30,60}`. `date` + `time` are interpreted in Europe/Bucharest. `from` and `to` must differ by ≥ 1 km.
```json
{ "items": [ {
    "rideId": "…", "departureAt": "2026-11-16T05:25:00Z", "pickupEtaAt": "2026-11-16T05:30:00Z",
    "pickup":  { "point": ApproxPoint, "label": "Cisnădie, Măgurii area", "walkM": 150 },
    "dropoff": { "point": ApproxPoint, "label": "Piața Mare", "walkM": 100 },
    "segmentM": 11500, "priceUpToBani": 390, "isFree": false, "seatsLeft": 2,
    "driver": { "id": "…", "firstName": "Radu", "photoUrl": "…", "rating": { "average": 4.8, "count": 23 } }
  } ],
  "nearestOutsideWindow": [ /* same item shape, max 3, same day, outside the window; always present, [] unless items is empty */ ],
  "hiddenBlockedCount": 0 }
```
Sorted by `pickup.walkM + dropoff.walkM` (rounded to 50 m), then `|departureAt − desired|`. Logs `search_performed` (results count, corridor/area labels, never coordinates).
Implemented in E3: `nearestOutsideWindow` is **always present** (an empty array unless `items` is empty, then nearest in time first). `from`/`to` outside the Sibiu box → `400 VALIDATION_FAILED` (`fields.from|to = outside_coverage`); closer than 1 km → `400 SAME_PLACE` (`fields.to = too_close`); date earlier than yesterday or later than 30 days ahead → `400 VALIDATION_FAILED` (`fields.date = out_of_range`). Every point is a 300 m grid centre (`approx: true`), walks are rounded to 50 m, `pickupEtaAt` to 5 minutes. `priceUpToBani` is computed on the matched segment from the ride's own rate snapshot (`quoteUpTo`, n = 1), the client never sends a price. `hiddenBlockedCount` counts in-window rides hidden because of a block in either direction; nothing says who blocked whom. Locations travel in the POST body only (never in URLs or logs).

### `GET /rides/{id}`: Public
The generic public detail.
```json
{ "id": "…", "status": "published", "departureAt": "…", "durationS": 1020, "distanceM": 9600,
  "origin": { "point": ApproxPoint, "label": "Șelimbăr" }, "destination": { "point": ApproxPoint, "label": "Zona Industrială Vest" },
  "routePublic": { "type": "LineString", "coordinates": [[24.18,45.76], …] },
  "seatsOffered": 3, "seatsLeft": 2, "note": "…", "isFree": false,
  "priceTable": PriceRow[] /* full route, n = 1..seatsOffered */,
  "car": CarPublic, "driver": PublicUser,
  "viewer": { "isDriver": false, "bookingId": null, "bookingStatus": null, "blocked": false } }
```
`404` if the ride is cancelled/expired and the viewer is not a party, the driver is blocked either way, or the driver is suspended. Malformed ids are `404` too.
Implemented in E2: `origin.label` and `destination.label` are **area names** (the gazetteer area, `Sibiu` as fallback), never the driver's street-level label. `point` is the 300 m grid centre. `routePublic` is `null` when the stored route is gone (coarsened). The plate, the driver's phone and every exact coordinate are absent. Since E3 a block in either direction makes the ride `404` (same as missing), and (E4) `viewer.bookingId`/`bookingStatus` hold the viewer's latest booking on the ride. A cancelled ride stays visible to its passengers (party rule) and to nobody else.

### `POST /rides/{id}/match`: Public
Passenger-specific view for ride detail and the request sheet. Body `{ "from": LatLng, "to": LatLng }`.
`200 { "pickup": {...}, "dropoff": {...}, "segmentM": 5390, "priceUpToBani": 120, "pickupEtaAt": "…", "seatsLeft": 2, "bookable": true, "notBookableReason": null }`
`notBookableReason ∈ RIDE_FULL | RIDE_NOT_BOOKABLE | OWN_RIDE | BLOCKED | ALREADY_REQUESTED | NO_LONGER_MATCHES`. The UI shows it as a disabled-button reason.
Implemented in E3: `seatsLeft` is added (0 when full). The endpoint never returns `BLOCKED` (a blocked pair gets `404`, like `GET /rides/{id}`, so nobody learns who blocked whom); `BLOCKED` stays for `POST /bookings` (E4), and `ALREADY_REQUESTED` arrived with E4. Reason priority: `OWN_RIDE`, `ALREADY_REQUESTED` (an active or rejected booking of the viewer), `RIDE_NOT_BOOKABLE` (not published, or departing in under 10 minutes), `RIDE_FULL`, `NO_LONGER_MATCHES`. When the points no longer fit (`NO_LONGER_MATCHES`), `pickup`, `dropoff`, `segmentM`, `priceUpToBani` and `pickupEtaAt` are all `null`. Rate limit 60/min.

### `GET /users/{id}`: Public
`200 PublicUser`. A deleted user returns `firstName: null`, no photo and no bio. Suspended or blocked (either way) → `404`.

### `GET /share/{token}`: Public (E5-6, Should)
`200 { "driver": { "firstName", "photoUrl" }, "car": { "make","model","colour","plate" }, "departureAt", "route": LineString /* trimmed */, "origin": {label}, "destination": {label} }`. `404` after expiry.

## 3. Account (E1, E6)

### `GET /me`
```json
{ "id": "…", "email": "…", "firstName": "Ioana", "phoneE164": "+40721234567", "bio": null, "photoUrl": "…",
  "status": "active", "role": "user",
  "consent": { "upToDate": true, "required": [] /* e.g. ["terms"] after a version bump */, "reaccept": false /* E6 */ },
  "profileComplete": true, "hasVehicle": false, "createdAt": "…" }
```

### `POST /me/consents`
Body `{ "age18": true, "termsVersion": "1.0", "privacyVersion": "1.0" }`. Gated routes answer `403 CONSENT_REQUIRED` with `fields` naming what is outstanding (`age18`, `terms`, `privacy`). Bodies are capped at 64 KB (photo: ~1.6 MB), over the cap is `400` (`VALIDATION_FAILED` with `fields._ = body_too_large`, or `PHOTO_TOO_LARGE`). All are required and versions must be current, otherwise `400 VALIDATION_FAILED`. Writes 3 `consents` rows. `204`. Declining is client-side: sign out.

Implemented in E6 (e6-privacy-spec §4): `age18` is optional when an `age_18` consent already exists (a user re-accepting updated terms); for a first acceptance it is still required (`fields.age18 = required`). The versions must still be the current ones (`fields.termsVersion` / `privacyVersion = not_current`). A re-acceptance writes only the `terms` and `privacy` rows. `GET /me` adds `consent.reaccept`: true when the user accepted an older version of terms or privacy than the current one (a user who never accepted anything is a first-time user, not a re-accepting one). `GET /legal/current` adds `publishedAt` (ISO) to each document. A published version's text never changes: an edit is a new version, a migration row and a web content file. Version 1.1 (migration `20261121090000_privacy.sql`) becomes current on 2026-11-21.

### `PATCH /me/profile`
Body (any subset) `{ "firstName": "Ștefan", "phone": "0721 234 567", "bio": "…" }`. The phone is normalised to E.164 and must be a Romanian mobile (`+407…`). `200` returns the `/me` shape. Requires consent.

### `PUT /me/photo`: `multipart/form-data`, field `photo`
JPEG or PNG (WebP is not decoded server-side; the client re-encodes to JPEG before upload), ≤ 1.5 MB after client-side resize. Re-encoded to 512×512 JPEG with no metadata. `200 { "photoUrl": "…" }`. Errors `PHOTO_INVALID`, `PHOTO_TOO_LARGE`.

### `GET /me/vehicle` · `PUT /me/vehicle`
Body `{ "make": "Dacia", "model": "Logan", "colour": "Grey", "plate": "sb 12 abc", "fuelType": "petrol", "seats": 3 }` → plate normalised to `SB12ABC`. `200` returns the vehicle (with plate; owner only). `GET` returns `404` when there is none. Editing never changes published rides.

### `GET /me/summary` (badge polling, every 60 s while visible)
`200 { "driverPendingRequests": 2, "passengerUnseenUpdates": 1, "nextRide": { "kind": "booking", "id": "…", "departureAt": "…" } | null }`

### `POST /me/summary/seen`
Body `{ "bookingIds": ["…"] }` → marks passenger updates as seen. `204`.
Implemented in E4: 1 to 50 uuids (else `400`). Sets `seen_by_passenger_at = now` on the caller's **own** bookings only; other ids match no row and are ignored. Badge rule: a booking is unseen while `passenger_event_at > coalesce(seen_by_passenger_at, -infinity)`; `passenger_event_at` is bumped by every change the passenger did not cause (confirmed, rejected, expired, cancelled by the driver, price dropped). `GET /me/summary`: `driverPendingRequests` counts open requests on the caller's rides (`requested`, not past `expires_at`); `nextRide` is the soonest upcoming confirmed booking or published ride (`kind` `booking` or `ride`). Rate limit 30/min (the `account` bucket).

### `GET /me/blocks` · `POST /blocks` · `DELETE /blocks/{userId}`
`POST` body `{ "userId": "…" }` → `204` (idempotent). `GET` → `{ items: [{ user: PublicUser, blockedAt }] }`.

### `DELETE /me`
Body `{ "confirm": "DELETE" }`, otherwise `400 CONFIRMATION_REQUIRED`. Cancels future rides and bookings (notifies counterparts), scrubs personal data, deletes the auth user. `204`. The client then signs out.

Implemented in E6 (ADR 0029, `routes/privacy.ts`, `services/accountDeletion.ts`): the gate is authentication plus a loaded account, nothing else, so a suspended user or one who has not accepted the new terms may delete. Rate limit `account` (30/min). **One transaction** (`SET LOCAL statement_timeout = 5s`): lock the profile row, cancel every published future ride of the user (`cancelRideTx`, `by: system`, so each passenger gets `ride_cancelled` with the neutral wording and `seats_booked` becomes 0), cancel every `requested`/`confirmed` booking of the user on a ride that has not departed (`systemCancelBookingTx`, reason `account_deleted`: the driver gets `booking_cancelled` for a confirmed one, a freed seat is relocked), then `app.scrub_account(user, now)`. Names for the emails are read before the scrub in the same transaction. A deadlock (`40P01`) is retried once, then `503 TEMPORARILY_UNAVAILABLE` (new code, additive). A second call, from a double tap or another device, waits on the profile lock, finds `status = deleted`, changes nothing and answers `204`. **After the commit** `services/accountPurge.ts` removes the avatar object (`storage.removeStrict`, 404 = done) and the auth user (`authAdmin.deleteUser`, `DELETE /auth/v1/admin/users/{id}` with the secret key, 404 = done); each success sets its `*_done_at` on `app.account_deletions`, both set `completed_at`. A failure never fails the response: it records `attempts + 1`, a scrubbed `last_error` and `next_attempt_at` (+1 min, 5 min, 30 min, 2 h, 12 h, then daily) and the tick finishes it. Afterwards every gate answers `403 ACCOUNT_DELETED` for the old token, `GET /users/{id}` returns `firstName`, `photoUrl`, `bio` and `rating` as `null` ("Deleted user"), and ratings, reports about the user (with snapshot, 12 months) and the incoming blocks of others stay. Avatar uploads are now cached for 7 days (`max-age=604800`, was 1 year).

### `POST /me/data-export-request` (Should, E6-4)
Inserts an outbox email to the support address with the user id. `202`.

Implemented in E6 (ADR 0031, `services/dataRequests.ts`): authenticated, `active` or `suspended` (deleted is `403 ACCOUNT_DELETED`), rate limit `dataRequest` (3 per day), body `{}` (unknown fields are `400`). Under the profile row lock: an unfulfilled request from the last 30 days is returned as it is (`202`, no new row, no new emails); otherwise one transaction inserts `app.data_requests (kind = export)`, queues `data_export_requested` (payload `{ requestId, userId, requestedAt }`, `user_id` = the requester; the dispatcher sends it to `EMAIL_SUPPORT_TO`, not to the user) and `data_export_ack` (to the user: "we will email it within 30 days"). `202 { requestId, requestedAt, dueBy }` with `dueBy = requestedAt + 30 d`. There is **no export endpoint**: the owner runs `select app.export_user_data('<uuid>');` in the SQL editor (deploy.md §6). The payloads carry ids and a time only; the payload scan covers both templates.

## 4. Rides (E2)

### `POST /rides/preview`
Requires consent + complete profile + vehicle. Rate limit 20/hour.
Body `{ "origin": LatLng, "destination": LatLng, "originLabel"?: string, "destinationLabel"?: string }`
```json
{ "previewId": "…", "expiresAt": "…", "distanceM": 9588, "durationS": 1020,
  "route": { "type": "LineString", "coordinates": [...] } /* full, owner view */,
  "originLabel": "Șelimbăr, Shopping City", "destinationLabel": "Zona Industrială Vest, Str. Salzburg",
  "priceTable": [ {"passengers":1,"priceBani":310}, {"passengers":2,"priceBani":200}, {"passengers":3,"priceBani":150} ],
  "tripCostBani": 624, "rateMicroPerKm": 651000, "fuelType": "diesel" }
```
`priceTable` goes up to `vehicle.seats`. `tripCostBani` (rounded down) feeds the "you recover about X of Y RON" line. Errors: `SAME_PLACE`, `ROUTE_TOO_SHORT`, `ROUTE_TOO_LONG`, `ROUTE_NOT_FOUND`, `ROUTING_UNAVAILABLE`, and `VALIDATION_FAILED` with `fields.origin` and/or `fields.destination` = `outside_coverage` when a point is outside the Sibiu coverage box (checked before `SAME_PLACE`, which needs the points at least 100 m apart). Coordinates are rounded to 5 decimals on input.
Labels: optional, at most 80 characters (NFC, whitespace collapsed). When omitted, the server derives `<area>, <nearest place within about 150 m>` (falling back to the area, then `Sibiu`). The response always carries the labels in use. They are stored with the preview and copied to the ride on publish.

### `POST /rides`
Body `{ "previewId": "…", "departureAt": "2026-11-16T05:30:00Z", "seats": 3, "note": "Blue backpack on the dashboard", "isFree": false }`
`201` returns the owner ride view (below). Errors: `PREVIEW_EXPIRED` (unknown, expired or someone else's preview: indistinguishable on purpose), `DEPARTURE_TOO_SOON`, `DEPARTURE_TOO_FAR`, `SEATS_EXCEED_VEHICLE`, `DAILY_RIDE_LIMIT` (4 non-cancelled rides per driver per Europe/Bucharest day of departure). Logs `ride_published`. Rate limit 20/hour.
There is no price field: unknown keys are ignored, the price comes from the stored route and the energy price version in effect at publish time (snapshotted on the ride). `isFree: true` makes every row of the table 0.

### `GET /me/rides?scope=upcoming|past|cancelled&limit&cursor`
Driver list. `{ items: [{ id, departureAt, originLabel, destinationLabel, status, seatsOffered, seatsBooked, pendingRequests, toRate, seriesId, cancelledAt: string | null, cancelledBy: "driver" | "system" | null }], nextCursor: string | null }`. Upcoming (published, not departed) is sorted ascending by departure. Past (departed, completed or expired) is descending and **no longer contains cancelled rides**. `cancelled` lists the driver's cancelled rides, newest departure first. `cancelledAt` and `cancelledBy` are set only when `status` is `cancelled` (`null` otherwise); `cancelledBy` is `driver` (the driver's own cancel) or `system` (the platform, e.g. a suspended driver); rows cancelled before the column existed read as `driver`. No cancel reason is stored or returned. Always scoped to the caller (`driver_id = me`): another user's rides never appear and `GET /me/rides/{id}` of someone else's ride is a 404. `limit` 1 to 50 (default 20). `cursor` is opaque (keyset on departure time and id): pass `nextCursor` back. `pendingRequests` is `0` until E4.

### `GET /me/rides/{id}`: driver only (else 404)
```json
{ "id": "…", "status": "published", "departureAt": "…", "origin": { "point": LatLng, "label": "…" }, "destination": {...},
  "route": LineString, "distanceM": 9588, "durationS": 1020, "seatsOffered": 3, "seatsBooked": 1, "note": "…", "isFree": false,
  "priceTable": PriceRow[], "tripCostBani": 624, "car": { "make","model","colour","plate" },
  "requests": [ { "bookingId": "…", "passenger": PublicUser, "pickupLabel": "…", "dropoffLabel": "…",
                  "segmentM": 9588, "priceIfAcceptedBani": 200, "requestedAt": "…", "expiresAt": "…" } ],
  "passengers": [ { "bookingId": "…", "status": "confirmed", "passenger": PublicUser,
                    "pickup": { "point": LatLng, "label": "…" }, "dropoff": {...},   // exact only within window
                    "phoneE164": "+40…" /* only within window */, "priceLockedBani": 200, "finalPriceBani": null,
                    "canMarkNoShow": false, "canRate": false } ],
  "canCancel": true, "lateCancelIfNow": false,
  "fuelType": "diesel", "lateCancel": false, "cancelledAt": null, "createdAt": "…" }
```
Additive fields added in E2: `fuelType` (from the vehicle snapshot), `lateCancel` (true once cancelled within 30 min of departure), `cancelledAt`, `createdAt`. Implemented in E4: `requests` holds the open requests (`requested`, `expires_at` in the future, soonest deadline first): public profile, **area labels** and `segmentM`, never a point. `priceIfAcceptedBani` is `seatPrice(segment, rate, confirmed + 1)`. `passengers` holds the `confirmed` bookings. `pickup.point`, `dropoff.point` and `phoneE164` go through `revealFor` (confirmed or completed, and now < departure + 24 h): outside it the points are 300 m grid centres (`approx: true`) and `phoneE164` is `null`. `label` is always an area name. `GET /me/rides` `pendingRequests` counts the open requests. For a coarsened ride (no stored route) `route` falls back to a straight line between the two points.

### `POST /rides/{id}/cancel`: driver only
Body `{}`. Ride → `cancelled`. All `requested` and `confirmed` bookings → `cancelled` (`cancelled_by='driver'`), passengers emailed. Within 30 min of departure: `late_cancel=true` + a reliability event. `200` returns the owner view. `INVALID_STATE` if not `published`.
Implemented in E4: the cascade runs in the same transaction as the ride cancel (ride row locked first, ADR 0021). `rides.seats_booked` returns to 0 (the invariant `seats_booked = count(confirmed)` also holds for a cancelled ride). One `ride_cancelled` outbox row per booking, each with that passenger's own pickup and dropoff **area names**, plus one `booking_cancelled` analytics event per booking (`by: driver`).

### `PATCH /me/rides/{id}` (E8-3)
Body `{ "autoAccept": true }` → `200` owner view. Driver only (else `404`); the ride is locked and must be `published` and not departed (else `409 INVALID_STATE`). Switching on never confirms requests that are already pending (ADR 0037).

## 5. Bookings (E4, E5)

### `POST /bookings`
Headers: `Idempotency-Key`. Requires consent + complete profile. Rate limit 10/hour.
Body `{ "rideId": "…", "from": LatLng, "to": LatLng }`
Server re-runs the match for this ride and stores the snapped points, `segment_m`, labels, `price_quoted_bani = quoteUpTo`, and `expires_at = min(now + 30 min, departure − 10 min)`.
`201` returns the booking view (below). Errors: `RIDE_FULL`, `RIDE_NOT_BOOKABLE`, `OWN_RIDE`, `BLOCKED`, `ALREADY_REQUESTED`, `NO_LONGER_MATCHES`. Logs `booking_requested`. Outbox: `booking_requested` → driver. With `autoAccept` (E8-3) and an eligible requester, the booking is confirmed in the same transaction (ADR 0037: after every E4 guard and the insert, under the ride lock; eligible = fewer than 3 visible ratings or a visible average ≥ 4.0; the response is then `201` with `status: 'confirmed'` and `autoConfirmed: true`; the driver gets `booking_auto_confirmed` instead of `booking_requested`).
Implemented in E4: header `Idempotency-Key` (uuid) is required: missing or not a uuid → `400 VALIDATION_FAILED` (`fields.idempotencyKey = required | invalid`). A replay with the same key and ride returns `201` with the current view and writes nothing; the same key for another ride, or for this ride with other points (the route fractions differ, or the points no longer match) → `400` (`fields.idempotencyKey = reused`). Body points must be inside the Sibiu box (`fields.from|to = outside_coverage`); there is no price field. Under the ride row lock (ADR 0021) the guards run in this order: replay, `OWN_RIDE`, `BLOCKED` (either direction), driver not active (`404`), `ALREADY_REQUESTED` (a `requested`, `confirmed` or **`rejected`** booking exists: a declined passenger cannot ask again, after `cancelled` or `expired` they can), `RIDE_NOT_BOOKABLE` (not published, or departing in 10 minutes or less), `RIDE_FULL`, `NO_LONGER_MATCHES`. An unknown ride is `404`. `pickup.label` and `dropoff.label` are **area names**; the stored points are the exact snapped points on the route (`ST_LineInterpolatePoint` at the matched fractions) and are never returned before the reveal. `price_quoted_bani` = `quoteUpTo(segment)` (n = 1). Rate limit 10/hour. Analytics `booking_requested`.

### `GET /me/bookings?scope=upcoming|past|cancelled&limit&cursor`
Improvement 5: `scope=cancelled` lists the passenger's bookings with status `cancelled` (cancelled by the passenger, by the driver cancelling the ride, or by the system), newest departure first. `past` no longer contains cancelled bookings (rejected, expired, completed and no-show stay in Past). `BookingListItem` gains `cancelledAt: string | null` (set only for cancelled bookings); `cancelledBy` (`passenger | driver | system | null`) and `rideStatus` (`cancelled` when the ride itself was cancelled) already exist. Always scoped to the caller (`passenger_id = me`).

`{ items: [{ id, rideId, status, departureAt, pickupLabel, dropoffLabel, driver: PublicUser, priceBani /* locked ?? quoted */, unseen: boolean }] }`
Implemented in E4: `{ items: BookingListItem[], nextCursor }` with `BookingListItem = { id, rideId, status, rideStatus, departureAt, pickupEtaAt, pickupLabel, dropoffLabel, driver: PublicUser, priceBani /* final ?? locked ?? quoted */, unseen }`. Upcoming = `requested` or `confirmed` and departing after now, ascending. Past = everything else, descending. Keyset cursor on `(departure_at, id)` like `/me/rides`; `limit` 1 to 50 (default 20). Labels are area names.

### `GET /bookings/{id}`: passenger of the booking or driver of the ride (else 404)
```json
{ "id": "…", "status": "confirmed", "rideId": "…", "rideStatus": "published",
  "departureAt": "…", "pickupEtaAt": "…", "expiresAt": "…", "requestedAt": "…", "decidedAt": "…",
  "pickup":  { "point": LatLng | ApproxPoint, "label": "…", "walkM": 150 },
  "dropoff": { "point": LatLng | ApproxPoint, "label": "…", "walkM": 100 },
  "route": LineString /* exact while revealed, else trimmed public */,
  "price": { "quotedBani": 390, "lockedBani": 260, "finalBani": null, "droppedFromBani": 390 | null },
  "driver": PublicUser, "car": { "make","model","colour","plate": "SB12ABC" | null },
  "contact": { "phoneE164": "+40…", "revealedUntil": "…" } | null,
  "timeline": [ { "status": "requested", "at": "…" }, { "status": "confirmed", "at": "…" } ],
  "actions": { "canCancel": true, "lateCancelIfNow": false, "canReportDriverNoShow": false, "canRate": false,
               "canShare": true, "show112": false } }
```
Exact `pickup`, `dropoff`, `plate` and `contact` are present only when the status is `confirmed`/`completed` and `now < departureAt + 24 h`. Otherwise approximate points and `null`.
Implemented in E4 (ADR 0023): the shape is `BookingView` in `_shared/contracts/bookings.ts` (adds `viewerRole`, `passenger`, `segmentM`, `cancelledAt`, `cancelledBy`, `unseen`, `rideStatus`; `actions` carries the five E5 flags, all `false` for now). One pure function, `revealFor`, decides the exposure: `status ∈ {confirmed, completed}` and `now < departureAt + 24 h` (hidden at exactly +24 h). When revealed, `route` is the exact route **between the passenger's own pickup and dropoff only** (never the driver's start and end), `contact.phoneE164` is the counterpart's phone (the driver's for the passenger, the passenger's for the driver) and `car.plate` is set. Otherwise points are 300 m grid centres (`approx: true`), `route` is the trimmed public route (`null` once coarsened), `contact` is `null` and a passenger gets `plate: null` (the driver always sees their own plate). `walkM` is rounded to 50 m, `pickupEtaAt` to 5 minutes. `price.finalBani` equals `lockedBani` once the ride has departed (E5 stores it). `timeline` shows `ride_cancelled` instead of `cancelled` when the driver cancelled the ride. `unseen` is true for the passenger viewer while `passenger_event_at > seen_by_passenger_at`. Anyone but the passenger and the ride's driver gets `404` (also for a malformed id).

### `POST /bookings/{id}/approve`: driver only
Transaction: lock the ride, check `requested` and `expires_at > now`, seat free → `confirmed`, `seats_booked + 1`, relock all confirmed prices with `min`. `200` returns the owner ride view. Errors: `RIDE_FULL`, `REQUEST_EXPIRED`, `INVALID_STATE`. Logs `booking_confirmed`. Outbox → passenger.
Implemented in E4: not the driver of the ride (or unknown id) → `404`. Guards in order: ride `published` (else `INVALID_STATE`), booking `requested` (an `expired` one answers `REQUEST_EXPIRED`, any other state `INVALID_STATE`), `expires_at > now` (`REQUEST_EXPIRED`, which also covers the up-to-1-minute tick lag), no block either way (`BLOCKED`), a free seat (`RIDE_FULL`). The update is `… WHERE id = $1 AND status = 'requested' AND expires_at > now`; the `rides_seats_booked_range` CHECK is the backstop (`23514` → `RIDE_FULL`). After the seat is taken every confirmed booking is relocked with `min(old ?? quoted, seatPrice(segment, rate, n))`; the approved booking and every booking whose lock dropped get `passenger_event_at = now` (badge). Logs `booking_confirmed` (`responseSeconds`). Rate limit 30/min.

### `POST /bookings/{id}/reject`: driver only
`requested` → `rejected`. `200`. Logs `booking_rejected`. Outbox → passenger.
Implemented in E4: `200` returns the owner ride view. Errors `404`, `REQUEST_EXPIRED`, `INVALID_STATE`. Seats and prices are untouched. Rate limit 30/min.

### `POST /bookings/{id}/cancel`: passenger only
Allowed from `requested` and `confirmed`, until departure. A confirmed booking cancelled within 30 min of departure is a late cancellation (reliability event). Seats are freed and remaining prices relocked (never up). `200` returns the booking view. Logs `booking_cancelled` (`late` flag). Outbox → driver.
Implemented in E4: a withdrawn `requested` booking sends **no** email (in-app only, ADR 0022); a cancelled `confirmed` booking emails the driver, sets `late_cancel` and inserts `reliability_events(late_cancellation, booking_id)` when within 30 minutes of departure. A booking in a terminal state, or a ride that has already left → `409 INVALID_STATE`. Not the passenger's booking → `404`. Rate limit 30/min.

### `POST /bookings/{id}/no-show`
- Driver caller: marks the passenger as a no-show (`confirmed`/`completed` → `no_show`, `no_show_by='driver'`). Reliability event for the passenger.
- Passenger caller: "driver didn't show" (`no_show_by='passenger'`). Reliability event for the driver.
- Window: departure → departure + 24 h, else `WINDOW_CLOSED`. `200`. Logs `no_show_reported`.

Implemented in E5 (ADR 0024): the caller must be the booking's passenger or the ride's driver (else `404`, also for a malformed id). The driver gets the owner ride view back, the passenger the booking view. Guards in order: ride lock, then the booking row (`FOR UPDATE`, so a rating in parallel waits and then sees `no_show`), status `confirmed`/`completed` (`INVALID_STATE`), window `departure ≤ now < departure + 24 h` (`WINDOW_CLOSED`), no rating by either party (`INVALID_STATE`). The guarded update clears `final_price_bani` and sets `no_show_at`/`no_show_by`; one `reliability_events(no_show, booking_id)` row goes to the absent party (unique per booking and kind) and a `no_show_reported` email to the same party. Seats are never touched. Rate limit 30/min (`booking-action`).

### `POST /bookings/{id}/ratings`
Body `{ "stars": 5, "tags": ["punctual","friendly"] }`. Tags: driver-rated ∈ {punctual, friendly, safe_driving, clean_car}. Passenger-rated ∈ {punctual, friendly, respectful, on_time_at_pickup}. Only `completed` bookings, within 7 days of ride completion, once per rater. `201`. Errors `WINDOW_CLOSED`, `ALREADY_RATED`, `INVALID_STATE` (no-show bookings). Logs `rating_submitted`.

Implemented in E5 (ADR 0025): body validated at the boundary (`stars` integer 1 to 5, at most 4 tags); unknown, duplicate or wrong-role tags answer `400` with `fields.tags = invalid`. Under the ride lock then the booking lock the guards run in this order: not `completed` (`INVALID_STATE`), `now ≥ completed_at + 7 d` (`WINDOW_CLOSED`), already rated (`ALREADY_RATED`; the unique key `ratings_booking_id_rater_id_key` maps to the same code), tags. The rating is **blind**: it is stored with `visible_at = completed_at + 7 d`, or `now` when the counterpart already rated, in which case the counterpart's `visible_at` is pulled to `least(visible_at, now)` in the same transaction. Every public summary (`/users/{id}`, search, request cards, booking views) counts `visible_at <= now` only (`repo/ratingSummary.ts`). The `201` body is `{ stars, tags, createdAt }` and never says whether the counterpart rated. A suspended or deleted ratee can still be rated. `BookingView` adds `completedAt`, `noShowBy`, `rating { given, rateUntil }` (the viewer's own rating only), `share` (passenger only) and the E5 `actions` (`canReportDriverNoShow`, `canMarkNoShow`, `canRate`, `canShare`, `show112`, `call112Window`); `BookingListItem` adds `cancelledBy` and `canRate`; `RideOwnerView` adds `completedAt`, `show112`, `call112Window` and its `passengers` hold `confirmed`, `completed` and `no_show` bookings; `RideListItem` adds `toRate`. `GET /rides/{id}` is `404` for non-parties once the ride is `completed`.

### `POST /bookings/{id}/share-link` (Should, E5-6)
Confirmed parties. `201 { "url": "https://haide.ro/s/<token>", "expiresAt": "…" }`.

Implemented in E5 (ADR 0026): **passenger only** (the driver and strangers get `404`). `confirmed`/`completed` booking on a ride that is not cancelled (else `INVALID_STATE`), before `departure + 24 h` (else `WINDOW_CLOSED`). The token is 16 random bytes as 22 base64url characters; only its SHA-256 is stored (`share_links.token_hash`, one row per booking: creating again **rotates**, the old token dies). `DELETE /bookings/{id}/share-link` revokes (`204`, idempotent, passenger only). `GET /share/{token}` is public (rate limit 30/min per IP, `shareView`): a malformed token is `404` without a database call; a live link needs `expires_at > now`, booking `confirmed`/`completed`, ride not cancelled, both parties `active`, else the same `404`. The body is built by `serializers/share.ts` through the contract schema (driver first name and photo, car with plate, the passenger's own segment as `route`, area labels, times, `phase`); never a phone, the passenger, or the driver's start and end. Headers `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`. The request log carries the route template `/share/:token`. The tick deletes links past `expires_at`.

## 6. Safety (E5)

### `POST /reports`
Body `{ "reportedUserId": "…", "reason": "extra_money", "details": "…", "rideId"?: "…", "bookingId"?: "…", "alsoBlock": true }`. Rate limit 10/day. `201 { "id": "…" }`. The reported user is never notified. Logs `report_submitted`.

Implemented in E5 (ADR 0027, 0028): `details` is NFC-normalised and trimmed, 1 to 500 code points, required for `other` (`fields.details = required | too_long`). Reporting yourself is `400` (`fields.reportedUserId = self`); an unknown user is `404` whatever their status (a suspension is not leaked). With `bookingId` the booking's parties must be exactly the caller and the reported user (`ride_id` is derived from it); with only `rideId` both must be parties of the ride; otherwise `404`. One transaction stores the report with the reported user's `{firstName, phoneE164}` snapshot, queues a `report_received` email (report id and reason only) for each active admin, logs `report_submitted` and, with `alsoBlock`, inserts the block. After the commit the block cascade runs.

### `POST /blocks` · `DELETE /blocks/{userId}` · `GET /me/blocks` (E5)
Implemented in E5 (ADR 0028). All need an active account. `POST /blocks { userId }`: self is `400` (`fields.userId = self`), unknown `404`, else `204` (idempotent, 30/hour). Transaction 1 commits the block (from then on new requests and approvals fail with `BLOCKED`). Then, one transaction per booking in ride order, every `requested`/`confirmed` booking between the pair on a ride that has not departed is cancelled by `system` under the ride lock: never a late cancellation, no reliability event, a confirmed seat is freed and prices are relocked (never up). Blocker = passenger: the driver gets `booking_cancelled` (confirmed only). Blocker = driver: the passenger gets `booking_rejected` and sees the update. A failing cascade still answers `204`: the tick safety sweep finishes it. `DELETE /blocks/{userId}` removes only the caller's own row (`204`, also when there is none; a malformed id is `400`) and restores nothing. `GET /me/blocks` lists outgoing blocks only, newest first, at most 200, with `PublicUser` (deleted users included).

## 7. Admin (E5-5, E7). Role `admin` only, else 403 `FORBIDDEN`

Implemented in E7 (ADR 0033 to 0035, `_shared/contracts/admin.ts`, `routes/admin.ts`, `services/{admin,metrics,energyPrices}.ts`). Every route sits behind `requireAdmin`: an active account whose `profiles.role` is `admin`, **re-read from the database on every request** (anonymous 401, a plain user 403 `FORBIDDEN`, a suspended admin 403 `ACCOUNT_SUSPENDED`). One rate limit for all: `admin`, 120 per minute per admin. **No admin response holds a phone number, plate, email or coordinate**; ride endpoints are area names. Nothing can grant or revoke the role (SQL only). Every write is one transaction: the target's profile row is locked `FOR NO KEY UPDATE`, the state is re-checked, one audited SQL function changes it and inserts its `admin_actions` row, and the outbox row is queued in the same commit.

`AdminUserRef = { id, firstName: string | null, photoUrl, status: 'active' | 'suspended' | 'deleted', memberSince: 'YYYY-MM', ridesCompleted, reports90d }`. For a deleted reported user `firstName` falls back to the name in the report snapshot.

| Method & path | Body / query | Response |
|---|---|---|
| `GET /admin/metrics?week=2026-W47` | `week` is an ISO week from `2026-W46` to the current one (Europe/Bucharest), default the current one. Else `400 fields.week` (`invalid`, `before_launch`, `future`) | `{ week, from, to, partial, northStar, matchRate: {overall, launch, byCorridor: [{corridor, value, searches}]}, fillRate, medianResponseMin, retention4w: {…, cohortWeek, closed}, reportsPer100, cancellationRate, series: [{week, completedSeats}] (12 weeks, zeros included), flags: {highVolumeDrivers: [{user: AdminUserRef, completed7d}]} }`. Each metric is `{ value: number \| null, target, kill, status: 'on_target' \| 'between' \| 'below_kill' \| 'no_data', n }` (`n` is the denominator). Rates are fractions with 3 decimals, `medianResponseMin` has 1 decimal, `reportsPer100` 2. `partial` while `now < to`. `matchRate.launch` is south + west + campus (the target applies to it) |
| `GET /admin/reports?status=open\|dismissed\|actioned\|all&limit&cursor` | default `open`, `limit` 20 (≤ 50), keyset `(created_at desc, id desc)` | `{ items: [{ id, status, reason, details, createdAt, resolvedAt, reporter: AdminUserRef, reported: AdminUserRef & {openReports}, ride: {id, departureAt, fromArea, toArea} \| null, bookingId, history: [{action, adminFirstName, at, note}] (last 5 admin actions about the reported user) }], nextCursor }` |
| `POST /admin/reports/{id}/dismiss` | `{ note?: ≤ 200 }` | `204`, `admin_actions` row `dismiss_report`. `404` unknown, `409 INVALID_STATE` not open. Nobody is emailed |
| `POST /admin/users/{id}/suspend` | `{ reasonCode: report_reason, statement: 10…300 (NFC, trimmed, no contact details), reportId? }` | `204`. Report becomes `actioned`, `admin_actions` row `suspend` (`{reason: statement, reasonCode}`), outbox `account_suspended` (ground, statement, "a person reviewed this", how to appeal by reply: DSA Art. 17), sent to the suspended user. The tick sweep cancels future rides and bookings within a minute. `400`: `fields.userId = self | admin`, `fields.statement = required \| too_short \| too_long \| contact_details`, `fields.reportId = mismatch`. `404` unknown user or report. `409 INVALID_STATE`: user not active, report not open. Two parallel suspends: one `204`, one `409` |
| `POST /admin/users/{id}/unsuspend` | `{ note?: ≤ 200 }` | `204`, outbox `account_reinstated`. `404`, `409 INVALID_STATE` when not suspended. Cancelled items stay cancelled |
| `GET /admin/users?status=suspended` | | `{ items: [{ user: AdminUserRef, suspendedAt, reasonCode \| null, statement \| null, adminFirstName \| null }] }` (≤ 100, newest first) |
| `GET /admin/energy-prices` | | `{ fuels: [{ fuelType, unit, current: EnergyPrice, scheduled: EnergyPrice \| null }], history: EnergyPrice[] (last 50) }`. `EnergyPrice = { id, fuelType, priceMilli, consumptionCenti, unit, effectiveFrom, sourceNote, createdBy: {id, firstName} \| null, createdAt }` |
| `POST /admin/energy-prices` | `{ fuelType, priceMilli, consumptionCenti, effectiveFrom?, sourceNote, overrideLargeChange?: boolean }` (no `unit`: electric is kWh, the rest litres) | `201 { item: EnergyPrice }`. One transaction under `pg_advisory_xact_lock`, `admin_actions` row `energy_price_added`. `400`: `priceMilli` 100…50 000 and `consumptionCenti` 100…5 000 (integers, `out_of_range`), `sourceNote` 1…200 (`required`, `too_long`), `fields.effectiveFrom = invalid \| past \| too_far \| not_after_latest` (default now to the minute, at most 5 minutes back and 30 days ahead, later than the latest row of the fuel). `409 LARGE_CHANGE` when price **or** consumption moves more than 30 % from the latest row (exactly 30 % passes), with `fields.priceMilli` and/or `fields.consumptionCenti = large_change`, unless `overrideLargeChange` (then `details.override = true`) |
| `GET /admin/ops` | | `{ dbSizeMb, emailsToday, emailCap, outboxPending, outboxFailed24h, routePreviewsToday, errors24h, openReports, openDataRequests, overdueDeletions, cron: [{job, status, startedAt}] }`. `routePreviewsToday` is the sum of `ride-preview` rate-limit counters since UTC midnight (about the openrouteservice calls); `cron` comes from `app.admin_cron_runs()` and is empty where pg_cron is unreadable |
| `GET /admin/errors?limit=50` | `limit` ≤ 100 | `{ items: [{ id, source, message, route, appVersion, createdAt }] }` (no stack, no user hash) |

Metric definitions and thresholds: e7-metrics-admin-spec §3 (counts come from STABLE SQL functions, rates and statuses from `_shared/domain/metrics.ts`, ADR 0034). There is **no admin export endpoint**: `GET /admin/users/{id}/export` was dropped (ADR 0031: `app.export_user_data` stays SQL-editor only, deploy.md §6). The SQL functions `app.admin_suspend_user` and `app.admin_unsuspend_user` keep working from the SQL editor (deploy.md); the 4-argument call shape `admin_suspend_user(user, reason, admin, report)` still resolves (the fifth argument `reason_code` defaults to `other`).

## 8. Telemetry

### `POST /telemetry/error`: Public. Rate limit 20/min
Body `{ "message": "…", "stack": "…", "route": "/ride/:id", "appVersion": "…" }` (truncated server-side, scrubbed of anything that looks like an email, a phone or coordinates). `204`.

## 9. E8 (Should): liquidity boosters

Specified in [e8-liquidity-spec.md §7](e8-liquidity-spec.md) (ADRs 0036 to 0039); schemas in `_shared/contracts/liquidity.ts`. Every route needs an active account; writes need consent; series also need a complete profile and a vehicle. Non-UUID ids are `404`. Ride-wanted posts (E8-6) are out of scope.

```ts
type Weekday = 1|2|3|4|5|6|7;                                    // ISO, Monday = 1
type AlertSchedule = { kind: 'date'; date: string } | { kind: 'weekly'; weekdays: Weekday[] };
type RideAlert = { id; from: LatLng; to: LatLng; fromLabel; toLabel; schedule: AlertSchedule; time: string /* HH:MM local */;
  windowMin: 15|30|60; createdAt; expiresAt; lastNotifiedAt: string|null; matchesSent: number };
type RideSeries = { id; weekdays: Weekday[]; departureTime: string; startsOn: string; endsOn: string;
  status: 'active'|'cancelled'; upcomingCount: number };
```

| Method & path | Body | Response · errors |
|---|---|---|
| `POST /ride-series` | `{ previewId, weekdays, departureTime: "07:30", startsOn?, endsOn: "2026-12-13", seats, note?, isFree?, autoAccept? }` | `201 { series, created: [{rideId, departureAt}], skipped: [{date, code: 'DAILY_RIDE_LIMIT'\|'DEPARTURE_TOO_SOON'\|'INVALID_TIME'}] }`. All instances are created up front in one transaction (≤ 28 days ahead; ADR 0039). `PREVIEW_EXPIRED`, `SEATS_EXCEED_VEHICLE`, `400 fields.weekdays \| departureTime \| startsOn \| endsOn` (`endsOn = no_dates` when no date matches), `409 DAILY_RIDE_LIMIT` when nothing could be created. Rate limit `ridePublish` |
| `POST /ride-series/{id}/cancel` | `{}` | `200 { series, cancelledRideIds }`: every future published instance, each through the ride-cancel cascade. `404`, `409 INVALID_STATE` |
| `POST /alerts` | `{ from, to, fromLabel, toLabel, schedule, time, windowMin }` | `201 { item: RideAlert }` (`200` for an identical active alert). `400` fields, **`409 ALERT_LIMIT`** (5 active). Expires after 14 days (a date alert at its window end if sooner). Rate limit `alerts` 20/h |
| `GET /me/alerts` · `DELETE /alerts/{id}` | | `{ items: RideAlert[] }` (active, newest first) · `204` / `404` |
| `GET /push/config` (Public) | | `{ vapidPublicKey: string \| null }` (`null` = push disabled) |
| `PUT /me/push-subscription` | `PushSubscription.toJSON()`: `{ endpoint, keys: {p256dh, auth}, expirationTime? }` | `204`. `400 fields.endpoint = invalid \| unsupported_service` (only FCM, Mozilla, Apple, Windows push hosts), `fields.keys = invalid`, `503 TEMPORARILY_UNAVAILABLE` when push is disabled. Rate limit `pushSubscription` 20/h |
| `DELETE /me/push-subscription` | `{ endpoint? }` | `204`, idempotent; no endpoint = all of the caller's subscriptions |
| `GET /me/stats/month?month=YYYY-MM` | | `{ month, from, to, driver: { sharedFuelCostBani, passengersCarried, ridesCompleted }, passenger: { paidBani, ridesCompleted } }` (E8-5). `400 fields.month = invalid \| before_launch \| future` |

Additive fields: `POST /rides` body `autoAccept?`; `RideOwnerView.autoAccept`, `.series: RideSeries | null`; `RideListItem.seriesId`; `RidePublicView.autoAccept`; `BookingView.autoConfirmed`. Outbox templates `booking_auto_confirmed` (driver) and `ride_alert_match`. Analytics: `ride_published` + `inSeries`, `autoAccept`; `booking_confirmed` + `auto`; new `alert_created {alertId, kind, windowMin, fromArea, toArea}`, `alert_matched {alertId, rideId}`.

## 10. Internal

### `POST /internal/tick`
Header `x-cron-secret: <CRON_SECRET>`. Called by pg_cron through pg_net every minute. Runs expiry, outbox dispatch (≤ 50 per run) and cleanup. `200 { "expired": n, "sent": n, "failed": n, "purged": n }`. Not exposed through CORS.
Implemented in E4 (every minute, each step in its own try/catch; a failure is logged and recorded in `app_errors`, the next step still runs): (1) `app.expire_requests(now)` turns every `requested` booking past `expires_at` into `expired` and queues `booking_expired` + analytics in one transaction; (2) the outbox dispatcher (claim with `FOR UPDATE SKIP LOCKED` and a 5 minute lease, 4 sends at a time through Brevo or the console provider, backoff 1/2/4/8 min, final after 5 attempts or a permanent 4xx, stops at `EMAIL_DAILY_CAP` per UTC day); (3) deletes expired `route_previews`; (4) at minute 0 UTC also deletes `rate_limits` older than 2 days, `app_errors` older than 14 days and finished `outbox` rows older than 30 days. `purged` is the number of rows deleted by steps 3 and 4. `sent`/`failed` count rows that reached `sent`/`failed` in this run.

Implemented in E5 (ADR 0024, 0027): the order is now (1) expire, (2) **complete** rides, (3) **safety sweep**, (4) dispatch, (5) purge previews and `share_links` past `expires_at`, (6) hourly housekeeping. Step 2 runs `app.complete_rides(now, now − 2 h, 200)` in one transaction: confirmed bookings become `completed` with `final_price_bani = price_locked_bani`, the ride becomes `completed` (or `expired` when no booking was completed), a `rating_prompt` email is queued per completed booking and one `rating_prompt_driver` per ride, and `ride_completed` is logged. Rides locked by a concurrent writer are skipped (`SKIP LOCKED`) until the next tick. Step 3 (at most 50 per query, one transaction per item, re-checked under the ride lock) cancels future rides of suspended drivers (`ride_cancelled`, `by: system`), active bookings of suspended passengers and active bookings between blocked pairs. The response is `{ expired, completed, swept, sent, failed, purged }`: `completed` counts rides moved to `completed` or `expired`, `swept` bookings cancelled by the sweep, `purged` also counts expired share links.

Implemented in E6 (ADR 0029, 0030): the order is (1) expire, (2) complete, (3) safety sweep (its two status queries now match `p.status IN ('suspended', 'deleted')`, so a write that raced an account deletion is cancelled at the next tick), (4) dispatch (`data_export_requested` goes to `EMAIL_SUPPORT_TO`), (5) purge previews and share links, (6) **coarsen** `app.coarsen_locations(now, 500)`, (7) **account purge** (at most 10 due `account_deletions` rows: storage object and auth user, with backoff), (8) hourly housekeeping at minute 0 UTC: `select app.run_retention()` (replaces the E4 inline deletes) plus one `app_errors` row `account_purge_overdue` per deletion open for more than 7 days (user id hashed). The response adds `coarsened` (rides plus bookings coarsened) and `accountsPurged` (deletions completed in this run); `purged` now also sums the rows `run_retention` deleted. Each step keeps its own try/catch.

Planned in E8 (e8-liquidity-spec §8, ADRs 0036, 0038): the order becomes (1) expire, (2) complete, (3) safety sweep, (4) **match alerts** (`app.match_ride_alerts(now, 50)`, one notification per alert per run, push-first), (5) email dispatch (the daily cap counts `email` rows only), (6) **push dispatch** (`channel = 'push'` rows, batch 50, no daily cap, skipped when push is disabled; 404/410 deletes the subscription), (7) purge previews and share links, (8) coarsen, (9) account purge, (10) hourly housekeeping (`run_retention` also deletes expired alerts and series 90 days after their end). The response adds `alertsMatched`, `pushSent`, `pushFailed`.

## 11. Analytics events written by the API (E7-1)

Server-side only, written in the transaction of the state change (`user_id` is the actor; NULL for a signed-out search), no SDK and no device storage, so no consent prompt (ADR 0032). The registry is `_shared/domain/events.ts` (`EVENT_NAMES`, `EventProps`, the builders and `eventPropsOk`). **Props are flat** (string, number, boolean or null), at most 12 keys of at most 40 characters, strings at most 80 characters, and no key named `lat`, `lng`, `lon`, `latitude`, `longitude`, `coordinates`, `point`, `geom`, `geometry`, `origin`, `destination`, `pickup`, `dropoff`, `phone`, `phoneE164`, `plate`, `email`, `details`, `note`, `firstName` or `name` (any letter case): the database refuses a row that breaks this (`analytics_events_props_ok`, `app.event_props_ok`).

| Event | Written by | Props (the complete list) |
|---|---|---|
| `search_performed` | `POST /search` (own statement, never fails the search) | `resultsCount`, `fromArea`, `toArea`, `windowMin`, `corridor` (`south\|west\|campus\|other`) |
| `ride_published` | `POST /rides` | `rideId`, `distanceM`, `seats`, `isFree`, `originArea`, `destinationArea` |
| `booking_requested` | `POST /bookings` | `bookingId`, `rideId`, `segmentM` |
| `booking_confirmed` / `booking_rejected` | approve / reject | `bookingId`, `rideId`, `responseSeconds` |
| `booking_expired` | tick step 1 | `bookingId`, `rideId` |
| `booking_cancelled` | passenger cancel, ride cancel (`driver`), sweep, block and deletion (`system`) | `bookingId`, `rideId`, `by`, `late` |
| `ride_completed` | tick step 2, outcome `completed` only | `rideId`, `seats` |
| `no_show_reported` | no-show endpoint | `bookingId`, `rideId`, `by` |
| `rating_submitted` | ratings endpoint | `bookingId`, `stars`, `tagCount`, `raterRole` |
| `report_submitted` | reports endpoint | `reason`, `alsoBlock` |

Other state changes are not analytics events: they are audited in their own tables (`admin_actions`, `consents`, `account_deletions`, `data_requests`, `reliability_events`). Admin writes are never analytics events (G2). Retention: `app.run_retention` deletes events older than 13 months; `app.scrub_account` nulls `user_id` on deletion; `app.export_user_data` includes the user's own events. Objection (GDPR Art. 21): by email to support, runbook in deploy.md (null the user's `user_id` in past events). Metrics outputs are aggregates; the only per-person output is the high-volume driver flag in `GET /admin/metrics` (id and first name, for ToS enforcement).

Corridor classification lives in `_shared/domain/corridors.ts` (area-name sets per launch corridor from strategy §2).
