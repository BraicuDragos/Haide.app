# 0002. Business model: free MVP with no payments in the app; B2B circles later

- **Status:** Proposed
- **Date:** 2026-11-15
- **Area:** Business
- **Agent:** product-strategist

## Context
Paid car transport through platforms in Romania requires authorisation under OUG 49/2019, and unauthorised paid passenger transport is sanctioned. Cost-sharing carpooling is treated as non-commercial (Romania's 2018 OECD note on BlaBlaCar; the French L3132-1 and Madrid 2017 precedents), but Romania has no explicit statutory exemption. That point is an assumption. Handling payments or taking fees would add payment-licensing, invoicing and possibly DAC7 reporting duties. The MVP must cost almost nothing and focus on liquidity.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Free, no in-app payments. Passenger pays the driver directly the app-computed amount | Zero legal and fiscal exposure as intermediary. Zero infra cost. Fastest to build | No revenue. Cash/transfer friction. No-show money is not enforceable | Lowest |
| B. In-app payments + commission from the driver's share | Revenue from day 1 | Driver payout looks commercial, so legal risk. Payment provider costs and KYC. Weeks of extra work | High |
| C. In-app payments + flat passenger booking fee on top | BlaBlaCar-proven. Driver's take stays ≤ cost | Payment and DAC7 setup. Fees hurt adoption at 1–4 RON prices | High |

## Decision
Option A for the MVP and pilot. Later revenue order: **(1) B2B "circles"** for employers, campus and municipality (a hypothesis of 5–10 RON per employee per month), then **(2) optional Option C**. Both come only after ≥ 300 shared seats per week **and** a legal review. A commission on the driver's share (Option B) is rejected permanently.

## Consequences
- Positive: the cleanest legal position. Focus on liquidity. No payment accounts needed from the owner.
- Negative / accepted risks: no revenue during the pilot. Some payment disputes stay between users (mitigated by reports and counters).
- What would trigger revisiting: liquidity targets met, an employer or municipality willing to pay, or a legal opinion that changes the risk picture.

## Sources
- [OUG 49/2019 overview (e-juridic)](https://e-juridic.manager.ro/articole/soferii-uber-bolt-si-clever-vor-avea-noi-conditii-de-respectat-de-la-1-noiembrie-26314.html)
- [OUG 49/2019 platform obligations (startupcafe)](https://www.startupcafe.ro/taxe/conditii-uber-bolt-ridesharing.htm)
- [Romania OECD submission 2018](https://one.oecd.org/document/DAF/COMP/WP2/WD(2018)19/en/pdf)
- [French carpool definition L3132-1 (Cerema)](https://cerema.fr/system/files/documents/2022/07/fiche_covoiturage_vf.pdf)
- [Madrid court on BlaBlaCar, 2017 (hosteltur)](https://www.hosteltur.com/120330_juez-desestima-demanda-confebus-contra-blablacar.html)
- [Bucharest carpool fuel support (Romania Insider)](https://www.romania-insider.com/bucharest-city-hall-cover-fuel-costs-carpool)
- Full analysis: `docs/product/strategy.md` §6
