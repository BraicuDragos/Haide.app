# 0009. Booking UX: request then approve, absolute deadlines, no chat, phone reveal after acceptance

- **Status:** Proposed
- **Date:** 2026-11-15
- **Area:** UX
- **Agent:** ux-designer

## Context
ADR 0004 fixes the booking model as request, then the driver approves, with expiry at the earlier of 30 minutes after creation or 10 minutes before departure. There is no chat and no payment in the app, and exact points and phone numbers are revealed only after confirmation (ADR 0005). Median response time is a kill metric (over 60 minutes). The UX must make waiting tolerable for the passenger and the decision quick for the driver, without live push in the MVP (email and badges only).

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Instant booking (auto-accept) as the default | No waiting, best conversion | Contradicts ADR 0004. Drivers lose control, which is the main trust fear for the supply side. Auto-accept is an E8 Should | Low |
| B. Request then approve, one screen for every state, deadline shown as a **clock time**, request details in a bottom sheet, accept and decline as two buttons on the driver’s ride screen | Matches ADR 0004. The passenger always knows who decides and until when. No ticking timers (calm, accessible). One booking screen replaces six | Waiting is still a cost until push and auto-accept (E8) arrive | Low |
| C. Request then approve plus an in-app chat for questions | Fewer misunderstandings | Moderation and message storage, and a GDPR surface. Replaced by phone reveal in the scope on purpose | High |

## Decision
Option B. The request sheet states who decides, the deadline as a clock time, and that points stay approximate until acceptance. After sending, the passenger lands on a single booking screen whose banner, timeline and visible data change with the state (requested, confirmed, rejected, expired, cancelled, ride cancelled, completed, no-show). Exact points, phone, plate and “Call” and “WhatsApp” appear only in the confirmed and completed states. The driver answers from the ride screen with Accept and Decline, and the price table shows how everyone’s price changes. An auto-accept switch is reserved as an E8 slot.

## Consequences
- Positive: one consistent mental model, no chat to moderate, the privacy rule is visible (locked rows explain why), and the same screen supports price-drop and cancellation messaging.
- Negative / accepted risks: slow driver answers will hurt conversion until web push and auto-accept ship. The driver has no way to ask a question before accepting.
- What would trigger revisiting: median request response time over 60 minutes (pull E8-3 auto-accept and E8-4 push forward, as ADR 0004 already states), or repeated user confusion about what is hidden.

## Sources
- `docs/decisions/0004-mvp-scope.md`, `docs/decisions/0005-location-privacy-baseline.md`
- `docs/product/backlog.md` E4-1 to E4-7
