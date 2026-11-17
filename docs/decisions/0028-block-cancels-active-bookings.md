# 0028. Blocking cancels active future bookings between the pair, without penalty

- **Status:** Proposed
- **Date:** 2026-11-16
- **Area:** Architecture
- **Agent:** software-architect

## Context
E5-4: blocking hides each user's rides and profile from the other and prevents bookings in both directions. E3 and E4 already honour `app.blocks` for search, ride detail, request and approve. The open question is what happens to a `requested` or `confirmed` booking that already exists between the two people. A driver has no endpoint to remove one confirmed passenger. Their only way out is to cancel the whole ride, and within 30 minutes that counts as a late cancellation. A confirmed booking between blocked users would also keep revealing phones and exact points (ADR 0023).

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Block affects the future only. Existing bookings are untouched and the UI suggests cancelling | Simplest | The safety tool fails exactly when it matters (harassment before a booked ride). The driver is stuck | Very low |
| B. Block commits first, then cancels every `requested`/`confirmed` booking between the pair on rides not yet departed (ride lock, relock prices never up), `cancelled_by = 'system'`, no late flag, no reliability event. The tick safety sweep (ADR 0027) repeats it as a safety net | Safe. No penalty for using a safety feature. Race-free: the committed block makes concurrent requests and approvals fail with `BLOCKED` | The other party gets a cancellation email, from which they may infer something happened | Low (reuses the E4 cancel path) |
| C. Refuse to block while an active booking exists | No surprise cancellations | Unacceptable for safety | Very low |

## Decision
Option B. Emails stay truthful and neutral. When the passenger blocked, the driver gets the usual `booking_cancelled` for a confirmed seat. When the driver blocked, the passenger gets the `booking_rejected` wording ("{driver} can't take you this time"). Nobody is ever told about a block. Departed bookings are not touched: a completed ride can still be rated and reported. Unblocking restores nothing.

## Consequences
- Positive: blocking is a complete safety action for both roles.
- Negative / accepted risks: a user can drop a confirmed seat without a late-cancel mark by blocking the counterpart. This is rare, visible in `analytics_events` (`booking_cancelled`, `by: system`) and reviewable in E7.
- What would trigger revisiting: evidence of blocking used to dodge late-cancel counters.

## Sources
- `docs/product/backlog.md` E5-4
- ADR 0021, ADR 0023, ADR 0027
