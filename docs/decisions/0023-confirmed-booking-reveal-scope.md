# 0023. Reveal scope for confirmed bookings: own segment only, serializer-enforced 24 h window

- **Status:** Proposed
- **Date:** 2026-11-16
- **Area:** Architecture
- **Agent:** software-architect

## Context
E4-5 reveals exact pickup and dropoff, the counterpart's phone and the plate once a booking is confirmed, and hides them again 24 hours after departure. Two docs disagree on the route. api-contract.md says the booking `route` is "exact while revealed". The data-model.md matrix says a confirmed passenger sees "exact own pickup/dropoff only", never the driver's exact origin, destination or full route. The driver's origin is often their home (ADR 0005). We need one rule that is simple to test.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. A confirmed passenger gets the exact route **between their own pickup and dropoff only** (`ST_LineSubstring` on the stored fractions). Otherwise they get the trimmed public route. Phone, plate and exact points are added by the serializer only when `status ∈ {confirmed, completed}` and `now < departure_at + 24 h` | Meets the data-model matrix. The passenger gets everything they need to meet. The driver's home is never exposed. The rule lives in one pure function | One more SQL expression per booking read | Low |
| B. Full exact route for confirmed passengers (api-contract wording) | Slightly nicer map | Reveals the driver's start and end to every passenger, which ADR 0005 and the matrix rule out | Low |
| C. A DB job that nulls the revealed fields at departure + 24 h | Data really disappears | Phones and plates belong to the profile and the vehicle snapshot, which other features still need. Coarsening at 90 days (E6) already removes the geometry | Medium |

## Decision
Option A. One pure domain function, `revealFor(booking, ride, viewer, clock)`, decides the exposure. Every serializer that emits booking points, contact or plate (booking view, owner ride view, lists) goes through it. Emails and outbox payloads only ever carry area names, first names and times.

## Consequences
- Positive: one test target for the privacy rule. The leak tests in the integration suite scan JSON paths for exact coordinates, phones and plates across every status and viewer.
- Negative / accepted risks: after 24 h the data still exists in the database until the 90-day coarsening. That is accepted by ADR 0005 and the DPIA.
- What would trigger revisiting: drivers asking to share their full route, or a DPIA change.

## Sources
- `docs/decisions/0005-location-privacy-baseline.md`
- `docs/architecture/data-model.md` section 5.2, `docs/architecture/api-contract.md` `GET /bookings/{id}`
- `docs/product/backlog.md` E4-5
