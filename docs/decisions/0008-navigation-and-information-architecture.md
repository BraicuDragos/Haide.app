# 0008. Navigation and IA: four bottom tabs, one account for both roles, browse without an account

- **Status:** Proposed
- **Date:** 2026-11-15
- **Area:** UX
- **Agent:** ux-designer

## Context
The MVP is a phone-first PWA used one-handed on a 360 px screen. One person can be a driver in the morning and a passenger in the evening. Supply (drivers publishing) is the liquidity bottleneck, so publishing must be as easy to reach as searching. Passengers must see value before signing up (E3-4). The structure has to survive the E8 additions (alerts, recurring rides, push settings) without a redesign.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Role mode switch (“I’m a passenger” / “I’m a driver”) with two separate home screens | Simple mental model per mode | Users who do both keep switching. Hides the other role’s entry point, which hurts driver recruiting. Two navigation trees to build | Medium |
| B. Four bottom tabs: Find, Offer, My rides (Riding / Driving inside), Profile. No mode switch | Both entry points always visible. One tree. Thumb reachable. Role is just a segment inside My rides | Four tabs are all used, so adding a fifth later needs a rethink. Two-level segments in My rides are dense | Low |
| C. Hamburger menu plus a floating action button | More room for content | Hidden navigation lowers discovery. Weak on one-handed reach. Poor accessibility | Medium |

## Decision
Option B. Four bottom tabs appear only on root screens, deeper screens use a back button and a sticky action bar. Search, results, ride details and public profiles work signed out, and an account is requested at the first real action (see ADR 0010). This keeps both supply and demand entry points one tap away and gives E8 predictable slots (a switch on the publish form, a row in Settings).

## Consequences
- Positive: one navigation tree, both roles visible, works one-handed, easy to explain in the onboarding copy, and the tab badge gives the driver’s pending requests and the passenger’s status changes a single home.
- Negative / accepted risks: the My rides screen has two segment levels (role, then upcoming or past). Four tabs leave no spare slot.
- What would trigger revisiting: usability tests where users cannot find their requests, or an E8 feature that needs a fifth top-level destination (for example an inbox).

## Sources
- `docs/product/mvp-scope.md` (device constraints), `docs/product/backlog.md` (E3-4, E8)
- Prototype: `docs/ux/prototype/index.html`
