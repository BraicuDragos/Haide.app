# 0004. MVP scope: publish, search, book, complete, rate, with a trust baseline and no payments

- **Status:** Proposed
- **Date:** 2026-11-15
- **Area:** Business
- **Agent:** product-strategist

## Context
A small agent team must deliver a phone-usable MVP in a few weeks on free tiers. Each epic becomes one PR the owner reviews from his phone. The MVP must test the riskiest assumption, liquidity in Sibiu corridors, while meeting a minimum trust and GDPR bar for meeting strangers.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Bare listing board (post a ride + contact details, no booking) | 1–2 weeks | No booking states, so no metrics, no ratings, weak trust and privacy (addresses public) | Low |
| B. Core loop: publish, search with route matching, request/approve booking, auto-complete, mutual ratings, report/block, privacy controls. 7 epics; recurring rides and alerts as Should | Measures the North Star end to end. Minimum viable trust | 4–6 weeks | Medium |
| C. Full product (in-app payments, chat, live tracking, ID checks, native apps) | Polished | Months. Paid services. Legal exposure (see 0002) | High |

## Decision
Option B: epics E1–E7 are launch-ready (accounts, rides + pricing, search, bookings, trust and safety, privacy, metrics/admin), and E8 liquidity boosters follow immediately. Passengers walk up to 1 km to the driver's route (no driver detours). Phone and exact points are revealed only after confirmation.

## Consequences
- Positive: every North Star input is measurable from day 1. A trust baseline is in place without paid services.
- Negative / accepted risks: no chat (phone reveal instead), no payments (direct cash/transfer), and email-first notifications may slow driver responses until push arrives (E8).
- What would trigger revisiting: request response time > 60 min (pull push and auto-accept forward), or match rate < 15% (pull recurring rides and alerts forward).

## Sources
- `docs/product/mvp-scope.md`, `docs/product/backlog.md`
- [Waze Carpool shutdown, a liquidity lesson (Engadget)](https://www.engadget.com/waze-shuts-down-carpool-app-174825025.html)
