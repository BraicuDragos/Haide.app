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
| 502/503 | `ROUTING_UNAVAILABLE`, `UPSTREAM_ERROR` |
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
  "consent": { "upToDate": true, "required": [] /* e.g. ["terms"] after a version bump */ },
  "profileComplete": true, "hasVehicle": false, "createdAt": "…" }
```

### `POST /me/consents`
Body `{ "age18": true, "termsVersion": "1.0", "privacyVersion": "1.0" }`. Gated routes answer `403 CONSENT_REQUIRED` with `fields` naming what is outstanding (`age18`, `terms`, `privacy`). Bodies are capped at 64 KB (photo: ~1.6 MB), over the cap is `400` (`VALIDATION_FAILED` with `fields._ = body_too_large`, or `PHOTO_TOO_LARGE`). All are required and versions must be current, otherwise `400 VALIDATION_FAILED`. Writes 3 `consents` rows. `204`. Declining is client-side: sign out.

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

### `POST /me/data-export-request` (Should, E6-4)
Inserts an outbox email to the support address with the user id. `202`.

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

### `GET /me/rides?scope=upcoming|past&limit&cursor`
Driver list. `{ items: [{ id, departureAt, originLabel, destinationLabel, status, seatsOffered, seatsBooked, pendingRequests }], nextCursor: string | null }`. Upcoming (published, not departed) is sorted ascending by departure, past (departed or no longer published) descending. `limit` 1 to 50 (default 20). `cursor` is opaque (keyset on departure time and id): pass `nextCursor` back. `pendingRequests` is `0` until E4.

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
Body `{ "autoAccept": true }` → `200`.

## 5. Bookings (E4, E5)

### `POST /bookings`
Headers: `Idempotency-Key`. Requires consent + complete profile. Rate limit 10/hour.
Body `{ "rideId": "…", "from": LatLng, "to": LatLng }`
Server re-runs the match for this ride and stores the snapped points, `segment_m`, labels, `price_quoted_bani = quoteUpTo`, and `expires_at = min(now + 30 min, departure − 10 min)`.
`201` returns the booking view (below). Errors: `RIDE_FULL`, `RIDE_NOT_BOOKABLE`, `OWN_RIDE`, `BLOCKED`, `ALREADY_REQUESTED`, `NO_LONGER_MATCHES`. Logs `booking_requested`. Outbox: `booking_requested` → driver. With `autoAccept` (E8-3) and an eligible requester, the booking is confirmed in the same transaction.
Implemented in E4: header `Idempotency-Key` (uuid) is required: missing or not a uuid → `400 VALIDATION_FAILED` (`fields.idempotencyKey = required | invalid`). A replay with the same key and ride returns `201` with the current view and writes nothing; the same key for another ride → `400` (`fields.idempotencyKey = reused`). Body points must be inside the Sibiu box (`fields.from|to = outside_coverage`); there is no price field. Under the ride row lock (ADR 0021) the guards run in this order: replay, `OWN_RIDE`, `BLOCKED` (either direction), driver not active (`404`), `ALREADY_REQUESTED` (a `requested`, `confirmed` or **`rejected`** booking exists: a declined passenger cannot ask again, after `cancelled` or `expired` they can), `RIDE_NOT_BOOKABLE` (not published, or departing in 10 minutes or less), `RIDE_FULL`, `NO_LONGER_MATCHES`. An unknown ride is `404`. `pickup.label` and `dropoff.label` are **area names**; the stored points are the exact snapped points on the route (`ST_LineInterpolatePoint` at the matched fractions) and are never returned before the reveal. `price_quoted_bani` = `quoteUpTo(segment)` (n = 1). Rate limit 10/hour. Analytics `booking_requested`.

### `GET /me/bookings?scope=upcoming|past&limit&cursor`
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

### `POST /bookings/{id}/ratings`
Body `{ "stars": 5, "tags": ["punctual","friendly"] }`. Tags: driver-rated ∈ {punctual, friendly, safe_driving, clean_car}. Passenger-rated ∈ {punctual, friendly, respectful, on_time_at_pickup}. Only `completed` bookings, within 7 days of ride completion, once per rater. `201`. Errors `WINDOW_CLOSED`, `ALREADY_RATED`, `INVALID_STATE` (no-show bookings). Logs `rating_submitted`.

### `POST /bookings/{id}/share-link` (Should, E5-6)
Confirmed parties. `201 { "url": "https://haide.ro/s/<token>", "expiresAt": "…" }`.

## 6. Safety (E5)

### `POST /reports`
Body `{ "reportedUserId": "…", "reason": "extra_money", "details": "…", "rideId"?: "…", "bookingId"?: "…", "alsoBlock": true }`. Rate limit 10/day. `201 { "id": "…" }`. The reported user is never notified. Logs `report_submitted`.

## 7. Admin (E5-5, E7). Role `admin` only, else 403 `FORBIDDEN`

| Method & path | Body / query | Response |
|---|---|---|
| `GET /admin/metrics?week=2026-W47` | | `{ week, northStar: {completedSeats, target:100, kill:30}, matchRate: {overall, byCorridor: [{label, rate}]}, fillRate, medianResponseMin, retention4w, reportsPer100, cancellationRate, weeklySeries: [{week, completedSeats}] }` |
| `GET /admin/ops` | | `{ dbSizeMb, emailsToday, emailCap: 300, outboxPending, outboxFailed, orsCallsToday, lastCronRuns: [{job, status, at}], errors24h }` |
| `GET /admin/reports?status=open` | | `{ items: [{ id, reporter: PublicUser, reported: PublicUser, reason, details, rideId, createdAt }] }` (never phones) |
| `POST /admin/reports/{id}/dismiss` | `{ note? }` | `204` + `admin_actions` row |
| `POST /admin/users/{id}/suspend` | `{ reason, reportId? }` | `204`. Cancels future rides and bookings (notifications), hides from search |
| `POST /admin/users/{id}/unsuspend` | `{ note? }` | `204` |
| `GET /admin/energy-prices` | | `{ current: [...], history: [...] }` |
| `POST /admin/energy-prices` | `{ fuelType, priceMilli, consumptionCenti, unit, effectiveFrom, sourceNote, overrideLargeChange?: boolean }` | `201`. `409 LARGE_CHANGE` if more than ±30 % without the override |
| `GET /admin/users/{id}/export` | | JSON export (E6-4) |
| `GET /admin/errors?limit` | | recent `app_errors` |

Until E7 ships, suspension is done by SQL: `select app.admin_suspend_user('<uuid>', 'reason');` (documented in deploy.md).

## 8. Telemetry

### `POST /telemetry/error`: Public. Rate limit 20/min
Body `{ "message": "…", "stack": "…", "route": "/ride/:id", "appVersion": "…" }` (truncated server-side, scrubbed of anything that looks like an email, a phone or coordinates). `204`.

## 9. E8 (Should)

| Method & path | Body | Notes |
|---|---|---|
| `POST /ride-series` | `{ previewId, weekdays: [1..7], departureTime: "07:30", endsOn: "2026-12-13", seats, note, isFree }` | Creates individual rides (each checked against the daily limit). Returns `{ seriesId, createdRideIds, skipped: [{date, code}] }` |
| `POST /ride-series/{id}/cancel` | `{}` | Cancels all future rides in the series |
| `POST /alerts` | `{ from, to, fromLabel, toLabel, date? , weekday?, time, windowMin }` | Max 5 active (`ALERT_LIMIT`), expires in 14 days |
| `GET /me/alerts` · `DELETE /alerts/{id}` | | |
| `PUT /me/push-subscription` · `DELETE /me/push-subscription` | Web Push subscription JSON | |
| `GET /me/stats/month` | | `{ sharedFuelCostBani }` (E8-5) |

## 10. Internal

### `POST /internal/tick`
Header `x-cron-secret: <CRON_SECRET>`. Called by pg_cron through pg_net every minute. Runs expiry, outbox dispatch (≤ 50 per run) and cleanup. `200 { "expired": n, "sent": n, "failed": n, "purged": n }`. Not exposed through CORS.
Implemented in E4 (every minute, each step in its own try/catch; a failure is logged and recorded in `app_errors`, the next step still runs): (1) `app.expire_requests(now)` turns every `requested` booking past `expires_at` into `expired` and queues `booking_expired` + analytics in one transaction; (2) the outbox dispatcher (claim with `FOR UPDATE SKIP LOCKED` and a 5 minute lease, 4 sends at a time through Brevo or the console provider, backoff 1/2/4/8 min, final after 5 attempts or a permanent 4xx, stops at `EMAIL_DAILY_CAP` per UTC day); (3) deletes expired `route_previews`; (4) at minute 0 UTC also deletes `rate_limits` older than 2 days, `app_errors` older than 14 days and finished `outbox` rows older than 30 days. `purged` is the number of rows deleted by steps 3 and 4. `sent`/`failed` count rows that reached `sent`/`failed` in this run.

## 11. Analytics events written by the API (E7-1)

| Event | Written by | Props (never coordinates or phones) |
|---|---|---|
| `search_performed` | `POST /search` | `resultsCount`, `fromArea`, `toArea`, `windowMin`, `corridor` (`south|west|campus|other`) |
| `ride_published` | `POST /rides` | `rideId`, `distanceM`, `seats`, `isFree`, `originArea`, `destinationArea` |
| `booking_requested` / `booking_confirmed` / `booking_rejected` / `booking_expired` | booking endpoints / tick | `bookingId`, `rideId`, `responseSeconds` (confirm/reject) |
| `booking_cancelled` | cancel endpoints | `bookingId`, `by`, `late` |
| `ride_completed` | complete job | `rideId`, `seats` |
| `no_show_reported` | no-show endpoint | `bookingId`, `by` |
| `rating_submitted` | ratings endpoint | `bookingId`, `stars` |
| `report_submitted` | reports endpoint | `reason` |

Corridor classification lives in `_shared/domain/corridors.ts` (area-name sets per launch corridor from strategy §2).
