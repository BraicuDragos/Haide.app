# MVP scope

> Owner: product-strategist · Date: 2026-11-15 · ADR: [0004](../decisions/0004-mvp-scope.md)
> Stories and acceptance criteria: [backlog.md](backlog.md) · Strategy: [strategy.md](strategy.md) · Pricing: [pricing.md](pricing.md)

## 1. MVP goal

Prove that in Sibiu's 3 launch corridors, **drivers publish trips and passengers complete shared rides weekly**, without payments, with a trust baseline and GDPR-compliant location handling.

**The MVP is done when** a new user on a phone can sign up, a driver can publish a ride, a passenger can find it, book it and complete it, and both can rate each other. All of this happens on free-tier infrastructure.

## 2. Product constraints for the architect

| Constraint | Requirement |
|---|---|
| Device | Mobile-first, usable one-handed on a 360 px-wide phone. Installable to the home screen. A PWA is the product preference (no store review or fees). The architect decides |
| Language | English UI, i18n-ready (strings in resource files). UTF-8 everywhere (Romanian diacritics in names and addresses) |
| Cost | Free tiers only. OpenStreetMap-based routing and geocoding preferred. No paid SMS unless free at pilot volume |
| Pricing | Server-side only, per [pricing.md](pricing.md). Energy prices in config with effective dates |
| Privacy | Checkpoints P1–P10 from [strategy §9](strategy.md#9-privacy-and-gdpr-checkpoints) |
| Scale target | 500 users, 200 rides per week. Not a high-scale problem |

## 3. MoSCoW

### Must have (launch blockers)

| Area | Feature |
|---|---|
| Accounts | Sign up / sign in (Google or email magic link). 18+ attestation. ToS and privacy consent stored with version. Sign out |
| Profile | First name, photo, phone number, short bio. Public profile shows first name, photo, rating, ride count, late-cancellation count |
| Vehicle | One vehicle per driver: make, model, colour, plate, fuel type, seats (1–4) |
| Publish ride | Origin and destination (address search + map pin), departure date and time (≥ 15 min ahead, ≤ 14 days ahead), seats offered, optional note. Route computed. Price preview. Max 4 rides per driver per day |
| Manage rides | My rides list (upcoming and past). Cancel a ride, which notifies booked passengers |
| Search | Origin, destination, date and time window (±15 / 30 / 60 min, default ±30). Matching: pickup and dropoff each within **1 km walking distance** of the route, pickup before dropoff, seats free. Browse without an account |
| Results and detail | List sorted by total walking distance, then time difference. Shows time, approximate pickup and dropoff, walk distance, price "up to X RON", driver first name, photo and rating |
| Booking | Request a seat, then the driver approves or rejects. Requests auto-expire (see backlog E4). Passenger cancel. Price lock (can only go down) |
| Contact reveal | After confirmation: exact pickup and dropoff on a map, driver phone and car plate, passenger phone. Hidden 24 h after the ride |
| Notifications | Email for request, approval, rejection, cancellation and expiry. In-app status badges |
| Completion | Ride auto-completes at departure + 2 h unless cancelled. Either side can mark "no-show" within 24 h |
| Ratings | Mutual 1–5 stars + optional tags, within 7 days of completion |
| Safety | Report user (with reasons) and block user. Admin can suspend (DB flag is acceptable) |
| Privacy | Approximate locations in public views. In-app account deletion. Retention job (coarsen coordinates after 90 days). Privacy policy and ToS pages |
| Pricing | Pricing engine + energy-price config (per pricing.md) with unit tests for the cap invariants |
| Metrics | Event logging for the North Star and supporting metrics (search, results count, publish, request, confirm, complete, cancel) |

### Should have (in the MVP if the timeline allows; first post-launch iteration otherwise)

| Feature | Why |
|---|---|
| **Recurring rides** (repeat on selected weekdays for up to 4 weeks) | Biggest liquidity lever for commuters |
| **Ride alerts**: "notify me when a matching ride is published" | Converts empty searches |
| Web push notifications | Faster driver response than email |
| Driver auto-accept toggle | Less friction |
| Share-trip link (read-only public page, expires 24 h after the ride) | Safety |
| "Call 112" button on an active ride | Safety |
| SMS OTP phone verification (only if free) | Trust |
| Simple admin screen (reports queue, suspend/unsuspend) | Ops without DB console |
| Driver "free ride" toggle (price = 0) | Goodwill |
| Data export on request | GDPR completeness |

### Could have

| Feature |
|---|
| "Ride wanted" posts by passengers, visible to drivers on that corridor |
| "Fuel saved this month" counter for drivers and passengers |
| In-app chat (would replace the phone reveal) |
| Favourite places (home, work) |
| Romanian translation (strings are ready) |

### Won't have (MVP)

| Feature | Reason |
|---|---|
| In-app payments, platform fee | Legal and fiscal exposure. See ADR 0002 |
| ID-document verification | Cost |
| Live GPS tracking during the ride | Privacy and complexity |
| Driver detours to the passenger's door | Matching complexity. Passengers walk up to 1 km |
| On-demand hailing / instant rides < 15 min ahead | Would look like paid transport |
| Native store apps | PWA first (architect decides) |
| Multi-city, B2B circles, women-only rides | Stage 2 |

## 4. Success metrics (12 weeks after public launch) **[assumptions]**

| Metric | Target | Kill / pivot threshold |
|---|---|---|
| **North Star:** completed shared seats per week | **≥ 100** | < 30 |
| Search match rate (launch corridors) | ≥ 30% | < 15% |
| Ride fill rate | ≥ 25% | < 10% |
| Median request response time | < 15 min | > 60 min |
| 4-week passenger retention | ≥ 40% | < 20% |
| Reports per 100 completed rides | < 1 | > 3 (pause and review) |
| Cancellation rate | < 15% | > 30% |
| Average rating | ≥ 4.5 | < 4.0 |
| Infra cost | 0 RON/month | > 50 RON/month (review) |

## 5. Delivery order (one epic = one PR)

| # | Epic | Size | Depends on |
|---|---|---|---|
| E1 | Accounts, profile and vehicle | M | Scaffold |
| E2 | Publish and manage rides + pricing engine | L | E1 |
| E3 | Search and matching | L | E2 |
| E4 | Booking lifecycle and notifications | L | E3 |
| E5 | Completion, ratings and safety | M | E4 |
| E6 | Privacy and compliance | M | E1–E5 |
| E7 | Metrics and admin | S | E4 |
| E8 | Liquidity boosters (Should items) | M | E4 |

**Launch-ready = E1–E7.** E8 ships next if it is not in the first launch.
