# 0011. Price and money presentation: “Up to X RON”, a table by passenger count, a lock that only goes down, no payment UI

- **Status:** Proposed
- **Date:** 2026-11-15
- **Area:** UX
- **Agent:** ux-designer

## Context
ADR 0003 fixes the formula: the price per passenger is the fuel cost of the passenger’s segment divided by (confirmed passengers + 1), rounded down to 0.10, and it can only go down after acceptance. ADR 0002 says no money flows through the app: the passenger pays the driver directly. The way the price is shown carries the legal framing (cost-sharing, not a fare) and drives trust, so wording and structure matter as much as the number. The brand bans “fare” and “earn”.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. A single fixed price per ride | Simplest to read | It would be wrong whenever the passenger count changes. It hides that the price falls when others join | Low |
| B. “Up to X RON” on cards (the passenger riding alone with the driver, which is the maximum), a full table by passenger count on the detail and driver screens, a locked price after acceptance with a banner and a single saffron-dot pulse when it drops, and a plain line “You pay the driver directly, in cash or by transfer. Haide doesn’t handle money.” | Honest and matches the formula. Explains why prices fall. Makes the driver’s limit visible (“You can’t raise it”, “You recover about 4.50 RON of the 6.24 RON fuel cost”). Keeps the cost-sharing wording | Slightly more to read than one number | Low |
| C. Dynamic price with a driver-editable field | Familiar from marketplaces | Violates ADR 0003 (no upward override). Looks like a fare | Medium |

## Decision
Option B. Cards and the request sheet show “Up to {price}” with “Drops if others join”. Ride detail shows the price table (1, 2, 3 passengers) with a caption. After acceptance the booking shows “You pay {driver} {price}”, “In cash or by transfer when you meet”, and “Your price can only go down”. The driver’s publish screen has no price input, only the same table, the recover line and “The price is set by Haide.” A free-ride switch lowers the price to zero. Money is formatted as `3.90 RON` everywhere with tabular numbers.

## Consequences
- Positive: users see how cost-sharing works. The wording (“recover”, “share”, never “earn” or “fare”) supports the legal position. The price drop is a rewarding, honest moment rather than a surprise.
- Negative / accepted risks: users compare the “up to” card with the lower locked price and may ask why. The copy states it on every price surface. Cash handling is outside the app, so disputes happen off-platform, and the report reason “Asked for extra money” is the only control.
- What would trigger revisiting: introducing in-app payments or a booking fee (ADR 0002 stage 3), which needs a new payment flow and a separate fee line, or evidence that “Up to” confuses users.

## Sources
- `docs/product/pricing.md` §2 to §7, `docs/decisions/0002-business-model-free-mvp.md`, `docs/decisions/0003-cost-sharing-pricing-formula.md`
- `docs/brand/brand-guide.md` §7 (vocabulary)
