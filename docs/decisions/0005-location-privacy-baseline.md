# 0005. Location privacy baseline: foreground-only, precision by role, 90-day coarsening

- **Status:** Proposed
- **Date:** 2026-11-15
- **Area:** Business
- **Agent:** product-strategist

## Context
Ride origins and destinations reveal home, work and routines. That makes them high-risk personal data under GDPR, and the EDPB advises collecting location only when strictly necessary and keeping it as short as possible. The architect needs fixed product rules before designing the data model and API.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Exact points public, keep forever | Simplest | Exposes home addresses to anyone. Fails data minimisation | Low |
| B. Approximate (~300 m) in public views, exact only to confirmed parties, foreground-only device location, coarsen after 90 days, account deletion | Strong minimisation. Still allows matching and meeting | API must filter fields by role. Retention job needed | Medium |
| C. B + live GPS sharing during rides | Extra safety | Continuous tracking, consent burden, battery, complexity | High |

## Decision
Option B. Lawful basis is contract for rides and bookings, legitimate interest for safety reports, and consent for device location and notifications. There is no background tracking. Phone and plate are visible only from confirmation until 24 h after the ride. Exact coordinates are coarsened 90 days after the ride, safety reports are kept for 12 months, and deleted accounts are purged within 30 days. The architect delivers a lightweight DPIA before Gate 3.

## Consequences
- Positive: low breach impact. A clear privacy story for users. Aligned with EDPB guidance.
- Negative / accepted risks: no live tracking (the share-trip link is static). Historical analytics are limited to neighbourhood granularity.
- What would trigger revisiting: safety incidents that live sharing would have prevented, or legal advice.

## Sources
- [EDPB Guidelines 01/2020 on connected vehicles and mobility apps](https://edpb.europa.eu/sites/default/files/consultation/edpb_guidelines_202001_connectedvehicles.pdf)
- [CMS summary of the EDPB guidelines](https://cms.law/en/aut/legal-updates/edpb-issues-guidelines-on-connected-cars)
- Full checkpoints: `docs/product/strategy.md` §9
