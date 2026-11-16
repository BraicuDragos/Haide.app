# 0026. Share-trip link: passenger-only, hashed random token, one link per booking

- **Status:** Proposed
- **Date:** 2026-11-16
- **Area:** Architecture
- **Agent:** software-architect

## Context
E5-6 (Should): a passenger sends a read-only page to family that shows the driver's first name and photo, the car with its plate, the route and the departure time. It needs no account and stops working 24 h after departure. The page exposes the plate and the passenger's own route to anyone who has the URL, so the link must be unguessable, revocable and short-lived. architecture.md §security already sketches "128-bit token, SHA-256 stored".

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. 128-bit random token (base64url, 22 chars), only `sha256(token)` stored in `share_links`, one row per booking (creating again replaces it), `DELETE` revokes, expiry `departure_at + 24 h`, page valid only while the booking is `confirmed`/`completed` | Revocable and rotatable. A database leak does not give working links. The page dies with the booking | The token is shown only once, so the client keeps it locally to show it again | Low |
| B. Stateless signed token (HMAC over booking id and expiry) | No table | Cannot be revoked or rotated. A key leak exposes every link | Low |
| C. No link: use the Web Share API to send static text (driver, car, plate, time) | No public endpoint | No live state, cancellation not reflected, text keeps living after the trip | Very low |

## Decision
Option A. Only the passenger can create a link (the story is the passenger's; the page is about who is driving them). The route shown is the passenger's **own segment** (ADR 0023), with area labels, so the driver's start and end are never on the page. The driver's phone and every other passenger never appear. The page is served with `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `noindex`. API logs use the route template `/share/:token`, never the raw path.

## Consequences
- Positive: the reveal rules stay as they are (the passenger shares only what they already see). One pure function decides validity.
- Negative / accepted risks: whoever gets the URL sees the plate and segment until it expires or is revoked. The token is kept in the passenger's `localStorage` until expiry so that reopening the sheet does not rotate the link.
- What would trigger revisiting: drivers asking for their own share link, or live location sharing (not planned, ADR 0005).

## Sources
- `docs/product/backlog.md` E5-6
- `docs/architecture/architecture.md` (security table, share links)
- ADR 0005, ADR 0023
