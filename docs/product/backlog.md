# MVP backlog: epics, user stories, acceptance criteria

> Owner: product-strategist · Date: 2026-11-15 · Scope: [mvp-scope.md](mvp-scope.md) · Pricing: [pricing.md](pricing.md)
> Each epic = **one PR** on branch `feat/<epic-slug>`. Epics are listed in delivery order. Glossary per the `carpool-domain` skill (`User`, `Vehicle`, `Ride`, `Booking`, `Stop`, `Rating`).
> Priority tags: **M** = Must, **S** = Should, **C** = Could. All UI strings go through i18n resources. All screens work at 360 px width.

## Global rules (apply to every epic)

- G1. All business rules (pricing, matching, limits, state transitions) are enforced **server-side**. The UI only mirrors them.
- G2. Every state-changing action logs an analytics event (see E7) with no exact coordinates in the payload.
- G3. Each epic ships unit tests for its domain logic and one happy-path E2E smoke on a mobile viewport.
- G4. Timezone: Europe/Bucharest for display. Store UTC.

---

## E1: Accounts, profile and vehicle · `feat/accounts`

| ID | Story | Pri |
|---|---|---|
| E1-1 | As a visitor, I want to sign up with Google or an email magic link so that I don't need a password | M |
| E1-2 | As a new user, I want to confirm I'm 18+ and accept the ToS and privacy policy so that I can use the service legally | M |
| E1-3 | As a user, I want to set my first name, photo, phone and a short bio so that others can trust and recognise me | M |
| E1-4 | As a driver, I want to add my vehicle so that passengers can recognise my car and prices use the right fuel rate | M |
| E1-5 | As a user, I want to view someone's public profile so that I can decide whether to ride with them | M |
| E1-6 | As a user, I want to sign out | M |

**Acceptance criteria**
- E1-1: Given a visitor, when they complete Google sign-in or click a valid magic link, then an account exists and they land on onboarding. Magic links expire after 15 min and are single-use.
- E1-2: Onboarding cannot be completed without checking "I am 18 or older" and accepting the ToS and privacy policy. The stored consent record includes `user_id`, document versions and a UTC timestamp. Declining signs the user out.
- E1-3: First name (1–30 chars, Unicode letters incl. ă â î ș ț), phone (E.164, Romanian numbers +40 validated) and photo (JPEG/PNG ≤ 5 MB, resized server-side, stripped of EXIF/GPS) are required before publishing or booking. Bio is optional (≤ 200 chars).
- E1-4: Vehicle fields: make, model, colour (all required, free text ≤ 30), plate (required, normalised uppercase without spaces), fuel type ∈ {petrol, diesel, lpg, hybrid, electric}, seats offered default 1–4. One vehicle per user in the MVP. Editing a vehicle does not change already-published rides.
- E1-5: The public profile shows first name, photo, member-since month, average rating (only if ≥ 3 ratings, else "New"), completed rides count, and late cancellations plus no-shows in the last 90 days. It **never** shows phone, plate or surname.
- E1-6: Sign out clears the session on the device. Back navigation does not reveal protected screens.

---

## E2: Publish and manage rides + pricing engine · `feat/rides`

| ID | Story | Pri |
|---|---|---|
| E2-1 | As a driver, I want to publish a ride (origin, destination, departure time, seats) so that passengers on my way can join | M |
| E2-2 | As a driver, I want to see the price per seat before publishing so that I know what passengers will pay | M |
| E2-3 | As a driver, I want to see my upcoming and past rides | M |
| E2-4 | As a driver, I want to cancel a ride so that booked passengers are informed | M |
| E2-5 | As the platform, I want a pricing engine with configurable energy prices so that prices stay fair and legal | M |
| E2-6 | As a driver, I want to offer a ride for free | S |

**Acceptance criteria**
- E2-1: Origin and destination are chosen via address autocomplete (Sibiu bias, diacritics-insensitive: "Selimbar" finds "Șelimbăr") or a map pin. Departure must be ≥ 15 min and ≤ 14 days ahead. Seats 1–4 and ≤ vehicle seats. Route distance must be 1–40 km. The server computes and stores the route polyline and distance. Publishing a 5th ride departing on the same calendar day is rejected with a clear message. Requires a complete profile and vehicle.
- E2-2: The preview shows "Up to X RON per passenger (1 passenger), Y RON with 2, Z RON with 3" for the full route, computed by the server with the formula in pricing.md §2. Drivers have no way to edit the price upward.
- E2-3: Two tabs: Upcoming (sorted by departure) and Past. Each item shows time, origin → destination (short labels), seats booked/offered and pending requests count.
- E2-4: Cancelling sets the Ride to `cancelled` and every `requested`/`confirmed` Booking to `cancelled`, and notifies those passengers (E4 channel). Cancelling within 30 min of departure increments the driver's late-cancellation counter.
- E2-5: The pricing engine is a pure, server-side function with unit tests covering: (a) the three worked examples in pricing.md §5 to the exact RON value; (b) invariant Σ prices ≤ n/(n+1) × trip_cost over randomised inputs; (c) invariant price_i ≤ segment_cost_i / 2; (d) rounding is always down to 0.10; (e) price never increases after confirmation. Energy prices are stored as versioned config rows (`fuel_type`, `price`, `ref_consumption`, `effective_from`). Each Ride stores the config version used at publish time.
- E2-6 (S): A "Free ride" toggle sets all seat prices on that ride to 0.00 and shows "Free" in search.

---

## E3: Search and matching · `feat/search`

| ID | Story | Pri |
|---|---|---|
| E3-1 | As a passenger, I want to search by origin, destination and time window so that I find rides going my way | M |
| E3-2 | As a passenger, I want results ranked by convenience so that the best option is first | M |
| E3-3 | As a passenger, I want to see ride details with approximate pickup and dropoff before booking | M |
| E3-4 | As a visitor, I want to browse rides without an account so that I can see value before signing up | M |
| E3-5 | As a passenger, I want a helpful empty state so that a zero-result search isn't a dead end | M |

**Acceptance criteria**
- E3-1: Inputs: origin and destination (autocomplete or "use my location", foreground only, with permission prompt), date, time and window ±15/30/60 min (default ±30). A Ride matches when **all** of these hold: status `published`; departure within the window; the passenger origin's nearest point on the route polyline is ≤ 1 km walking (straight-line ≤ 800 m is an acceptable MVP proxy, the architect decides); the same holds for the destination; pickup comes **before** dropoff along the route direction; segment ≥ 1 km; free seats ≥ 1; the driver is not the searcher and not blocked by or blocking the searcher. Response time < 2 s at pilot scale.
- E3-2: Sort by (walk to pickup + walk from dropoff) ascending, then |departure − desired time| ascending. Each card shows departure time, pickup and dropoff neighbourhood labels, walk distances (rounded to 50 m), price "up to X RON" for this passenger's segment, and driver first name, photo and rating.
- E3-3: Details show the route line on a map, with pickup and dropoff **snapped points rounded to about 300 m** (no exact coordinates in the API response for non-confirmed users), seats left, driver note, car make, model and colour (no plate), and the driver's public profile link.
- E3-4: Search and details work signed-out. Tapping "Request seat" prompts sign-up and returns the user to the same ride afterwards.
- E3-5: Zero results show the nearest rides outside the window (up to 3, same day) if any exist, plus a placeholder for "Notify me" (activated in E8).

---

## E4: Booking lifecycle and notifications · `feat/bookings`

| ID | Story | Pri |
|---|---|---|
| E4-1 | As a passenger, I want to request a seat so that the driver can accept me | M |
| E4-2 | As a driver, I want to approve or reject requests | M |
| E4-3 | As a passenger, I want unanswered requests to expire so that I'm not left waiting | M |
| E4-4 | As a passenger, I want to cancel my booking | M |
| E4-5 | As confirmed parties, we want to see exact meeting points and contact details so that we can meet | M |
| E4-6 | As a user, I want email notifications and in-app badges for booking events | M |
| E4-7 | As a passenger, I want my price to never go up after I'm confirmed | M |

**Acceptance criteria**
- E4-1: Booking state machine: `requested → confirmed | rejected | expired | cancelled`, then `confirmed → completed | cancelled | no_show` (E5). One active booking per passenger per ride, 1 seat per booking in the MVP. Requesting is blocked if seats are full, the ride departs in < 10 min, or either side has blocked the other. The request stores pickup and dropoff snapped points and the segment distance.
- E4-2: The driver sees each request with the passenger's public profile, pickup/dropoff labels and price. Approve reserves the seat atomically (no overbooking under concurrent approvals; a test is required). Reject frees nothing and notifies the passenger.
- E4-3: A request expires automatically at the earlier of 30 min after creation or 10 min before departure. The passenger is notified.
- E4-4: Passengers can cancel `requested` or `confirmed` bookings until departure. Cancelling a `confirmed` booking within 30 min of departure increments the passenger's late-cancellation counter. Remaining passengers' prices are recomputed but **never increase** (E4-7).
- E4-5: Only after `confirmed`: both sides see exact pickup and dropoff on a map, the counterpart's phone with "Call" and "WhatsApp" deep links, and the plate (for the passenger). These fields are absent from API responses for anyone else, and hidden again 24 h after departure.
- E4-6: Emails are sent within 2 min for: new request (driver), approved / rejected / expired (passenger), ride cancelled (passengers), booking cancelled (driver). Emails contain no exact addresses, only neighbourhood labels and a link to the app. In-app badges show pending requests (driver) and status changes (passenger).
- E4-7: `locked_price = min(price at confirmation, current computed price)`. This is shown on the booking as "You pay X RON to the driver, in cash or by transfer". The final price is frozen at departure time and is identical for passenger and driver views.

---

## E5: Completion, ratings and safety · `feat/trust-safety`

| ID | Story | Pri |
|---|---|---|
| E5-1 | As the platform, I want rides to complete automatically so that ratings and metrics are triggered | M |
| E5-2 | As a driver or passenger, I want to report a no-show | M |
| E5-3 | As a user, I want to rate the people I rode with | M |
| E5-4 | As a user, I want to report and block someone | M |
| E5-5 | As an admin, I want to suspend a user | M |
| E5-6 | As a passenger, I want a share-trip link to send to family | S |
| E5-7 | As a user on a ride, I want a one-tap "Call 112" | S |

**Acceptance criteria**
- E5-1: At departure + 2 h, `published` rides with ≥ 1 confirmed booking become `completed`, and their confirmed bookings become `completed` (unless marked no-show). Rides with no bookings become `expired`.
- E5-2: Within 24 h after departure, the driver can mark a confirmed passenger `no_show`, and a passenger can report "driver didn't show". Each increments the counter shown on the profile (last 90 days). No ratings are allowed between parties of a no-show booking.
- E5-3: Within 7 days of completion, each party can rate each counterpart once: 1–5 stars plus optional tags (Punctual, Friendly, Safe driving, Clean car / Respectful, On time at pickup). Ratings are immutable after submission. A rating becomes visible to the rated user only once both sides have rated or the 7 days are over, to prevent retaliation.
- E5-4: Report reasons: No-show, Unsafe driving, Harassment, Asked for extra money, Fake profile, Other (free text ≤ 500). Reports are stored for admin review and the reporter gets a confirmation. Blocking hides each user's rides and profile from the other and prevents bookings in both directions. Users can unblock from settings.
- E5-5: A `suspended` user cannot sign in to protected actions, their future rides are cancelled (passengers notified), and they are hidden from search. A DB/console flag is acceptable in the MVP (the UI comes in E7).
- E5-6 (S): Confirmed parties can generate a read-only link showing driver first name, photo, car (make, model, colour, plate), route map and departure time. The link expires 24 h after departure and needs no account.
- E5-7 (S): On a ride's detail screen from 15 min before to 2 h after departure, a "Call 112" button opens the dialer.

---

## E6: Privacy and compliance · `feat/privacy`

| ID | Story | Pri |
|---|---|---|
| E6-1 | As a user, I want to delete my account in the app | M |
| E6-2 | As the platform, I want location data coarsened after 90 days | M |
| E6-3 | As a user, I want to read the privacy policy and ToS at any time | M |
| E6-4 | As a user, I want to request a copy of my data | S |

**Acceptance criteria**
- E6-1: Settings → Delete account requires confirmation. Future rides and bookings are cancelled with notifications. Profile, photo, phone and vehicle are deleted immediately from active views and purged within 30 days. Past ratings remain as "Deleted user", and safety reports are kept for 12 months (legitimate interest), as stated in the policy.
- E6-2: A scheduled job (at least daily) replaces exact coordinates on Rides and Bookings older than 90 days with the neighbourhood label / centroid rounded to 1 km, keeping only distance, price, timestamps and status. A test proves that no exact coordinates older than 90 days remain.
- E6-3: Privacy policy and ToS pages are reachable signed-out and from Settings, and are versioned. A version bump requires re-acceptance at next sign-in. The ToS includes the cost-sharing clauses: no profit, no extra payments, the driver's own trip, 18+, ride limits. The privacy policy covers controller, purposes, lawful bases (strategy §9 P1), processors, retention (P5), rights, the ANSPDCP contact, and a placeholder for controller identity (owner need #1).
- E6-4 (S): A "Request my data" button sends an email to the support address. The admin can produce a JSON export.

---

## E7: Metrics and admin · `feat/metrics-admin`

| ID | Story | Pri |
|---|---|---|
| E7-1 | As the team, I want product events logged so that we can compute the North Star and supporting metrics | M |
| E7-2 | As the team, I want a simple metrics view | M |
| E7-3 | As an admin, I want a reports queue with suspend/unsuspend | S |
| E7-4 | As an admin, I want to update energy prices without a deploy | S |

**Acceptance criteria**
- E7-1: Events: `search_performed` (results_count, corridor_label), `ride_published`, `booking_requested`, `booking_confirmed`, `booking_rejected`, `booking_expired`, `booking_cancelled` (late flag), `ride_completed` (seats), `no_show_reported`, `rating_submitted`, `report_submitted`. Payloads carry user IDs and neighbourhood labels only, never exact coordinates or phone numbers. Events older than 13 months are deleted.
- E7-2: A protected page (admin role) shows, per ISO week: completed shared seats (North Star), search match rate (overall and per corridor), ride fill rate, median request response time, 4-week passenger retention cohort, reports per 100 completed rides, and cancellation rate.
- E7-3 (S): Lists open reports with reporter, reported user, reason, ride link and date. Actions: dismiss, suspend, unsuspend. Every action is logged.
- E7-4 (S): The admin can add a new energy-price config version with `effective_from`. Validation: price within ±30% of the previous value, or an explicit override confirmation.

---

## E8: Liquidity boosters · `feat/liquidity`

| ID | Story | Pri |
|---|---|---|
| E8-1 | As a commuting driver, I want to publish a recurring ride on selected weekdays | S |
| E8-2 | As a passenger, I want to be notified when a matching ride is published | S |
| E8-3 | As a driver, I want auto-accept so that passengers get instant confirmation | S |
| E8-4 | As a user, I want web push notifications | S |
| E8-5 | As a driver, I want to see how much fuel cost I've shared this month | C |
| E8-6 | As a passenger, I want to post a "ride wanted" that drivers on my corridor can see | C |

**Acceptance criteria**
- E8-1: The driver selects weekdays and an end date (≤ 4 weeks). The server creates individual Ride instances, which count toward the 4-rides-per-day limit and can each be cancelled individually or as a series. Price is computed per instance.
- E8-2: From an empty or any search, the user taps "Notify me". The saved alert (origin, destination, weekday/date, window) is matched on each new published Ride, and a notification is sent within 5 min. Max 5 active alerts per user, expiring after 14 days.
- E8-3: With auto-accept on, eligible requests (requester not blocked, rating ≥ 4.0 or "New") are confirmed immediately. Overbooking protection from E4-2 still applies.
- E8-4: Opt-in prompt only after the user's first booking or ride (not on first launch). Push covers the same events as E4-6. Email remains the fallback.
- E8-5 (C): Profile shows "This month you shared X RON of fuel costs" (sum of final prices on completed rides).
- E8-6 (C): A ride-wanted post (origin, destination, time window) appears to drivers whose published or recurring rides pass within 1 km. Expires at the window end.
