# 0010. Progressive onboarding: browse first, sign up at the first action, resume in place

- **Status:** Proposed
- **Date:** 2026-11-15
- **Area:** UX
- **Agent:** ux-designer

## Context
Liquidity is the biggest risk (strategy §12). The strategy says passengers should see rides before creating an account, and E3-4 requires signed-out search. E1 requires an account, 18+ and Terms consent, a profile (first name, photo, phone) and, for drivers, a car, before booking or publishing. Asking for all of it upfront loses people who just want to see whether Haide has a ride on their route.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Sign-up wall at first launch (account and full profile before anything) | Simple. Every user is complete | Visitors see no value first. Highest drop-off exactly where density is thinnest | Low |
| B. Progressive: browse freely, gate the first real action. Steps are Account, Agreement, Profile, plus Car only for drivers. A step counter says 3 or 4 steps. After the last step the user returns to the same ride with the request sheet open | Value before commitment. Drivers are asked for the car only when they offer a ride. No lost context | Intent has to be remembered through the flow. More states to test | Medium |
| C. Account at first action but collect the full profile later (at first contact reveal) | Fastest first request | Drivers would approve requests from people with no photo or phone, which breaks the trust baseline | Medium |

## Decision
Option B. The gate sits at **Request seat** and **Offer a ride**, and at the My rides and Profile tabs. The flow is: sign in with Google or an email link (no password), agreement (two separate checkboxes with separate errors, Decline signs out), profile (photo, first name, Romanian mobile, optional bio), and for drivers the car. Each step shows progress, and the flow returns to the originating screen (and reopens the request sheet) when it completes.

## Consequences
- Positive: signed-out users see real rides, prices and drivers first. Trust data (photo, phone) is still complete before any booking. Drivers are not asked for a car when they only want to ride.
- Negative / accepted risks: the profile step is the longest and the likeliest drop-off point. Photo is required, which some will skip.
- What would trigger revisiting: more than 40% of users abandoning at the profile step. The fallback is a staged profile (name and photo first, phone at first acceptance) after a legal check of the phone requirement.

## Sources
- `docs/product/strategy.md` §11 (liquidity plan), `docs/product/backlog.md` E1-1 to E1-4 and E3-4
- Prototype gate behaviour: `docs/ux/prototype/index.html`
