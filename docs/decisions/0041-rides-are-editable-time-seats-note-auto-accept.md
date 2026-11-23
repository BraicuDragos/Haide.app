# 0041. Rides are editable: time, seats, note and auto-accept; the route is fixed; a time change notifies each passenger

- **Status:** Accepted (owner decision: "make rides editable, and notify who should be notified")
- **Date:** 2026-11-23
- **Area:** Architecture / Product
- **Agent:** backend-dev

## Context
Until now the only change a driver could make to a published ride was the auto-accept switch (ADR 0037); anything else meant cancel and publish again. `docs/architecture/improvements-analysis.md` and `docs/architecture/notifications.md` recorded that "ride details changed" had no event. The owner asked for rides to be editable and for the right people to be told. A ride carries a priced route (distance, rate snapshot, price table), a vehicle snapshot and, once booked, passengers whose pickup and dropoff segments were matched on that route (ADR 0021, 0023).

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Edit time, seats, note and auto-accept; the route, price and vehicle stay fixed; a **time change** notifies requested and confirmed passengers | Covers what drivers actually change (the hour, a free seat, a note); no re-pricing, no re-matching, no broken pickup points; bookings stay valid | A wrong route still needs cancel and republish | Low |
| B. Also edit origin, destination and route | Most flexible | A new route changes the distance, the price of every seat, and whether each passenger's pickup and dropoff still lie on it: every booking would need re-matching, re-pricing and re-consent, or a cancellation cascade; the price is a promise already shown to passengers | High, risky |
| C. No editing (status quo) | Nothing to build | Moving a ride by one hour costs a cancel (late cancel statistics, every passenger cancelled) | None |

## Decision
Option A.
- **Editable:** `departureAt`, `seats`, `note`, `autoAccept`, through `PATCH /rides/{id}` (partial, strict, at least one field). **Not editable:** origin, destination, labels, route, price and energy snapshot, vehicle. Sending any of them is `400 ROUTE_NOT_EDITABLE` with a message telling the driver to cancel and publish a new ride.
- **Who and when:** only the ride's driver (404 for anyone else); the ride must be `published` and not departed (`409 RIDE_NOT_EDITABLE`; the owner view gets `canEdit` with the same test). Same gates and a rate limit (20/hour) as publishing.
- **Time:** a changed departure follows the publish rules exactly (15 minutes to 14 days ahead) and the daily limit of 4 rides on the Bucharest day of the new time, counted under the same advisory lock as publishing and without counting the ride itself. There is no extra "too late to edit" window: the driver may move a ride until it departs, as long as the new time is valid, because forbidding it would only push the driver to cancel (which notifies everyone and can count as a late cancellation). An unchanged departure is not re-checked, so seats and note can be fixed minutes before leaving.
- **Seats:** 1 to 4, not above the vehicle's seats when raised, never below the seats already confirmed (`409 SEATS_BELOW_BOOKED`).
- **Bookings when the time moves:** they stay as they are. A confirmed booking keeps its seat and its locked price; the passenger is told and can cancel (their cancel follows the normal late-cancel rule against the new time). A pending request is clamped in the same transaction: `expires_at = least(expires_at, newDeparture - 10 min)`, the margin `createBooking` uses, so a request never outlives the new departure.
- **Who is told:** only a change of departure time notifies, one `ride_updated` outbox row (email + push) per passenger with a requested or confirmed booking. Payload: `bookingId`, `rideId`, `driverFirstName`, `previousDepartureAt`, `departureAt`, the passenger's own pickup and dropoff area names (ids, times, a first name and labels only, `assertPayloadSafe`). Dedupe key `ride_updated:{bookingId}:{new departureAt}` through the single `outboxDedupeKey` helper: a retry is one row, a second distinct move is a new notification. Moving to the same time, or editing seats, note or auto-accept, tells nobody. The driver is never told (they made the change). The unseen badge of each affected booking is set.
- **Transaction:** one, under the ride row lock (the lock used by booking, approve and cancel): read and validate, optional driver lock and daily count, update the ride (`updated_at`), clamp requests and flag bookings, insert outbox rows, answer with the updated owner view.
- **Not added:** no analytics event (the `analytics_events.props` check would need a migration) and no migration at all: `app.outbox.template` is free text, the dedupe index already exists.

## Consequences
- Positive: a driver can fix a time without cancelling everyone; passengers are told once per move, in mail and push, and keep control (they can cancel); no pricing or matching logic changes.
- Negative / accepted risks: a driver can move a ride repeatedly (bounded by the 20/hour limit and the 14-day window; each move re-notifies); a passenger who cannot make the new time must cancel, and a cancel within 30 minutes of the new time counts as late for them (revisit if it causes complaints); moving a ride that belongs to a series changes only that instance; ride alerts that already matched are not re-sent for the new time.
- Revisit if: drivers ask to change the route often (then consider a "replace ride" action that republishes and moves passengers with their consent), or moves cause no-shows.

## Sources
- `docs/architecture/improvements-analysis.md` (item 7 and "Needs your input" 1), `docs/architecture/notifications.md`, `docs/architecture/api-contract.md` (`PATCH /rides/{id}`)
- ADR 0021 (ride row lock), ADR 0022 (outbox), ADR 0023 (reveal rules), ADR 0037 (auto-accept), ADR 0038 (push)
