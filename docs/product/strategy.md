# Product strategy: city carpooling (pilot: Sibiu)

> Owner: product-strategist · Date: 2026-11-15 · Status: Proposed (accepted when the Phase 1 PR is merged)
> Related: [pricing.md](pricing.md) · [mvp-scope.md](mvp-scope.md) · [backlog.md](backlog.md) · ADRs [0001](../decisions/0001-pilot-city-sibiu.md)–[0005](../decisions/0005-location-privacy-baseline.md)
>
> **Evidence convention:** **[V]** = verified against a cited source · **[A]** = assumption, to validate in the pilot.

## 1. Vision

**Every car already crossing Sibiu becomes a shared, near-free ride for a neighbour.** Drivers publish trips they are making anyway. Passengers on the same path join for a fair share of the fuel, typically **1 to 4 RON**. It is not a taxi and not a business for drivers. It is organised, trusted neighbourliness.

## 2. Pilot city decision: Sibiu (confirmed)

| Criterion | Sibiu | Cluj-Napoca (main alternative) |
|---|---|---|
| Size | 134,309 inhabitants, 2021 census **[V]** ([citypopulation.de](https://citypopulation.de/en/romania/localities/sibiu/143450__sibiu/)), plus fast-growing suburbs (Șelimbăr 17,492 **[V]**, [g4media](https://www.g4media.ro/unul-din-3-locuitori-din-municipiul-sibiu-s-a-nascut-in-alt-judet-in-selimbar-localitate-de-langa-municipiu-sunt-majoritari-locuitorii-veniti-din-alte-zone-ale-tarii.html)) | About 3 times larger, so demand is spread thinner |
| Liquidity density | Compact. Most commutes are 4–12 km and converge on a few hubs (centre, Zona Industrială Vest, ULBS, Shopping City) **[A]** | Many dispersed hubs, so more users are needed per match |
| Founder on the ground | Yes. Local seeding is possible (groups, employers, campus) | No |
| Competition | No intra-city carpool product with visible traction **[A]** | Same, but heavier Bolt/Uber presence **[A]** |

**Decision:** pilot in **Sibiu**. The app works citywide, but launch marketing targets **3 corridors**, so density forms where commuting already concentrates:

1. **South:** Cisnădie, Șelimbăr and Calea Dumbrăvii to the centre (car-dependent suburbs).
2. **West:** Vasile Aaron and Turnișor to Zona Industrială Vest and the airport area (shift workers at large employers).
3. **Campus:** Hipodrom, Ștrand and Mihai Viteazu to ULBS and the centre.

Expansion trigger to a second city (Brașov or Cluj): Sibiu reaches ≥ 300 completed shared seats per week for 4 consecutive weeks.

## 3. Market and competitors (Sibiu, Nov 2026)

| Alternative | Price for a 5–10 km trip | Strength | Weakness we exploit |
|---|---|---|---|
| **Tursib** (city bus) | 3.5 RON / 60-min ticket **[V]** (Tursib site, undated). Pupils ride free (HCL 122/2025) **[V]**. ULBS students get a 90% discount on passes **[V]** ([Tursib/ULBS](https://inginerie.ulbsibiu.ro/fara-categorie/tursib-face-reducere-90-la-abonamente-pentru-studentii-ulbs)) | Cheap, frequent in the core | Fixed routes and times. Transfers and slow suburb links **[A]** |
| **Taxi** | 4.00 RON start + 4.00 RON/km, so about 24–44 RON **[V]** ([taxi-calculator](https://www.taxi-calculator.com/taxi-rate-sibiu/1048)) | Door to door, on demand | 10–15 times our price |
| **Bolt / Uber** | About 2.9–3.2 RON/km indicative, not Sibiu-specific **[V]** ([bento.travel](https://www.bento.travel/compare/romania/bolt-ro-vs-speed-taxi-app-ro)). Uber is present in Sibiu **[V]** ([Uber](https://www.uber.com/global/ro/r/cities/sibiu-sibiu-ro)) | On demand, polished | 8–12 times our price, plus surges |
| **BlaBlaCar** | Inter-city only in Romania **[V]** ([OECD note by Romania, 2018](https://one.oecd.org/document/DAF/COMP/WP2/WD(2018)19/en/pdf)) | Trusted carpool brand | No intra-city product in Romania |
| **Wirgo** | Free app. Cost-sharing between users | Romania/Moldova carpool app that mentions commuting **[V]** ([App Store](https://apps.apple.com/us/app/-/id6670219309)) | No evidence of Sibiu liquidity **[A]**. Generic, not city-focused |
| **Facebook / WhatsApp groups, hitchhiking** | Free or informal | Existing habit | No trust layer, no matching, no fair price |
| *Waze Carpool* (closed 2022) | – | – | **Lesson:** commute carpooling dies without density ([Engadget](https://www.engadget.com/waze-shuts-down-carpool-app-174825025.html)). Hence the corridor focus |

**Positioning:** *"The neighbourly way across Sibiu: as cheap as the bus, as direct as a car."* We sit at or below Tursib on price and beat it on directness and time. Against Bolt or taxi we win on price by an order of magnitude, and we never claim to be on-demand.

## 4. Target users and personas

| | **Andrei, the commuting driver** (primary supply) | **Ioana, the car-less student** (primary demand) | **Mihaela, the shift worker** (demand, sometimes supply) |
|---|---|---|---|
| Profile | 34, engineer at an automotive supplier in Zona Industrială Vest. Lives in Șelimbăr, drives alone daily, 07:30 / 16:30 | 21, ULBS student. Lives in Cisnădie with her parents, no car | 45, nurse at the county hospital. Lives in Turnișor. Early and late shifts |
| Job to be done | "Cut what my commute costs without hassle or strangers I can't trust" | "Get to class fast and cheaply, especially when the bus doesn't fit" | "Get to a 06:00 shift or home at 22:00 safely, without paying 25 RON for a taxi" |
| Pain today | Pays the full fuel cost alone (about 350 RON/month on Trip A, see [pricing](pricing.md#7-why-drivers-cannot-turn-this-into-a-profit-business)) | Slow suburb bus with transfers **[A]**. Bolt too expensive | Sparse buses off-peak **[A]**. Safety concerns |
| What wins them | Publish a weekday commute once. Verified, rated passengers. Zero admin | A ride in 2 taps, 1–4 RON, known pickup point | Ratings, visible car and plate, share-trip link |
| Main fear | Strangers, no-shows, legal trouble | Safety, being stood up | Safety at night |

## 5. Value proposition

| For | We offer | Proof point |
|---|---|---|
| Passengers | Direct rides across Sibiu for **1–4 RON**, often faster than the bus | Pricing examples: 1.40 / 3.10 / 3.90 RON vs 20.90 / 42.40 / 50.10 RON by taxi ([pricing §5](pricing.md#5-worked-examples-three-real-sibiu-trips)) |
| Drivers | Recover **up to 80% of the fuel** for trips you already make, with rated people from your city | Formula n/(n+1) with fuel-only basis |
| The city | Fewer single-occupant cars at peak | Metric: average occupancy on completed rides |

## 6. Business model and monetization

### Legal frame: cost-sharing vs paid transport

| Point | Status | Source |
|---|---|---|
| Romania regulates **paid** car transport through platforms ("transport alternativ") under **OUG 49/2019**: an authorised operator, an alternative-transport contract, and a platform operator with obligations (in 2019, a 100,000 RON fee per 24 months for platforms) | **[V]** | [e-juridic](https://e-juridic.manager.ro/articole/soferii-uber-bolt-si-clever-vor-avea-noi-conditii-de-respectat-de-la-1-noiembrie-26314.html), [startupcafe](https://www.startupcafe.ro/taxe/conditii-uber-bolt-ridesharing.htm), [Eurofound](https://apps.eurofound.europa.eu/platformeconomydb/ridesharing-ordinance-105143) |
| Carrying passengers **for payment** ("contra cost") without authorisation is sanctioned. Case law shows fines and retention of plates and registration (Legea 92/2007, art. 46^1). OG 27/2011 requires a licence for paid road passenger transport | **[V]** | [legeaz.net case](https://legeaz.net/spete-civil-2/plangere-contraventionala-amenzicontraventii-inchisoare-contraventionala-712-2012), [OG 27/2011](https://WWW.RATBV.RO/uploads/documents/og27din2011.pdf) |
| Romania's own 2018 OECD submission describes BlaBlaCar as **occasional, non-commercial** ride-sharing, distinct from taxi and ride-hailing | **[V]** | [OECD](https://one.oecd.org/document/DAF/COMP/WP2/WD(2018)19/en/pdf) |
| EU reference: France defines carpooling in law as shared use of a car "à titre non onéreux, excepté le partage des frais", on a trip the driver makes for their own account | **[V]** | [Code des transports L3132-1, via Cerema](https://cerema.fr/system/files/documents/2022/07/fiche_covoiturage_vf.pdf) |
| EU reference: a Madrid commercial court (2017) held that BlaBlaCar cost-sharing is not regulated transport and not unfair competition | **[V]** | [hosteltur](https://www.hosteltur.com/120330_juez-desestima-demanda-confebus-contra-blablacar.html), [Iberian Lawyer](https://iberianlawyer.com/?p=145236) |
| The EU Commission's collaborative-economy agenda treats pure cost-sharing separately from remunerated services | **[V]** | [COM(2016) 356](https://old.parliament.bg/pub/ECD/227300COM_2016_356_EN_ACTE_f.pdf) |
| **Romania has no explicit statutory cost-sharing exemption.** Cost-sharing below cost is treated as non-commercial because there is no "remuneration" beyond costs | **[A]**: not verified in statute or case law | – |
| Cost contributions below cost are not taxable income for drivers | **[A]** | – |
| DAC7 platform reporting (EU Directive 2021/514) is not triggered while the platform takes no fee and handles no payments | **[A]**: to verify before any monetization | [Uber DAC7 FAQ (context)](https://www.uber.com/ie/en/drive/tax-information/faq-and-resources/) |

**How we stay on the cost-sharing side by design:** a fuel-only basis, the driver always pays a share, server-side prices, no upward override, max 4 passengers, max 4 rides per driver per day, rides published ≥ 15 min ahead, no hailing, and no money through the platform. Full list in [pricing §7](pricing.md#7-why-drivers-cannot-turn-this-into-a-profit-business).

### Model decision (ADR [0002](../decisions/0002-business-model-free-mvp.md))

| Stage | Revenue | Rationale |
|---|---|---|
| **MVP / pilot (now)** | **None.** Free for everyone. Passengers pay drivers directly (cash, bank transfer, Revolut) the app-computed amount | Zero legal and fiscal exposure as payment intermediary (no PSD2 licence, no DAC7 reporting, no invoicing). Zero infra cost. Maximum focus on liquidity |
| **Stage 2** (after ≥ 300 shared seats/week and a 1-hour legal review) | **B2B "circles"** for employers and the campus: private groups, a commute report, CO₂ and parking savings. Hypothesis: 5–10 RON per employee per month **[A]** | Payers are organisations with parking and ESG pain. Does not touch the per-seat price, so legally clean |
| **Stage 3** (optional) | In-app payment with a flat **passenger booking fee** on top of the cost share, paid to the platform | Follows the BlaBlaCar pattern. Only once volume justifies payment-provider costs |
| Rejected | Commission taken from the driver's share | Turns the driver's take into a commercial service. Legal risk |
| Rejected | Ads | Weak at pilot scale. Hurts trust and privacy |

Public-sector precedent: Bucharest City Hall approved fuel support of up to 500 RON/month for carpooling commuters in 2018 **[V headline]** ([Romania Insider](https://www.romania-insider.com/bucharest-city-hall-cover-fuel-costs-carpool)). This makes a Sibiu municipality partnership a credible Stage 2 channel.

## 7. Pricing (summary)

`price per passenger = floor_0.10( segment_km × rate_per_km[fuel] / (confirmed passengers + 1) )`. The price can only go down after booking. Petrol rate: **0.687 RON/km** (7.0 l/100 km × 9.81 RON/l national average on 10 Nov 2026 **[V]** for the price, **[A]** for the consumption).

| Real Sibiu trip | km | 1 passenger | 2 | 3 |
|---|---|---|---|---|
| A: Cisnădie to Piața Mare (petrol) | 11.5 | 3.90 | 2.60 | 1.90 |
| B: Șelimbăr to ZI Vest (diesel) | 9.6 | 3.10 | 2.00 | 1.50 |
| C: Hipodrom to old town (petrol) | 4.2 | 1.40 | 0.90 | 0.70 |

Full formula, rates per fuel type, caps and anti-profit guardrails: **[pricing.md](pricing.md)** (ADR [0003](../decisions/0003-cost-sharing-pricing-formula.md)).

## 8. Trust and safety (MVP baseline)

| Mechanism | MVP? | Notes |
|---|---|---|
| 18+ only (attested at sign-up) | Must | Avoids minors' consent issues (the Romanian digital-consent age is 16) and child-safety risk |
| Verified sign-in (Google or email link) + phone number on profile | Must | |
| SMS OTP phone verification | Should | Only if a free tier covers pilot volume (architect to confirm) |
| Real first name + profile photo required to publish or book | Must | |
| Vehicle make, model, colour and plate (plate visible only to confirmed passengers) | Must | Recognise the car at pickup |
| Exact pickup and dropoff + phone shown **only after confirmation** | Must | Privacy and safety |
| Driver approves each booking request | Must | Auto-accept toggle = Should |
| Mutual 1–5 star rating + optional tags after a completed ride | Must | Average shown when ≥ 3 ratings |
| Report user (reasons include "asked for extra money", "unsafe driving", "no-show", "harassment") + block | Must | Reports go to an admin queue. Suspension flag |
| Late-cancellation and no-show counters on profile | Must | Late = within 30 min of departure |
| Share-trip link (read-only page: driver, car, plate, route, time) | Should | |
| "Call 112" button on the ride screen | Should | |
| ID-document verification, live GPS tracking, women-only rides | Won't (MVP) | Cost and privacy. Revisit with data |

## 9. Privacy and GDPR checkpoints

Location and trip data reveal home, work and routines, so we treat them as high-risk personal data. The EDPB says to collect location only when strictly necessary and keep it only as long as needed **[V]** ([EDPB Guidelines 01/2020](https://edpb.europa.eu/sites/default/files/consultation/edpb_guidelines_202001_connectedvehicles.pdf), [CMS summary](https://cms.law/en/aut/legal-updates/edpb-issues-guidelines-on-connected-cars)). ADR [0005](../decisions/0005-location-privacy-baseline.md).

| # | Checkpoint | Requirement |
|---|---|---|
| P1 | Lawful basis | Contract (Art. 6(1)(b)) for account, rides and bookings. Legitimate interest for safety reports and fraud. **Consent** for anything optional (device location, notifications) |
| P2 | No background tracking | Device location is used **only** when the user taps "use my location", in the foreground. No GPS trails |
| P3 | Precision by role | Public ride listings show origin and destination **rounded to about 300 m / neighbourhood name**. Exact points only for the driver and confirmed passengers |
| P4 | Contact reveal window | Phone number visible to counterparts from confirmation until 24 h after the ride |
| P5 | Retention | Exact coordinates of rides and bookings are coarsened 90 days after the ride date (only distance and price are kept). Safety reports: 12 months. Deleted accounts purged within 30 days |
| P6 | Data subject rights | In-app **account deletion** (Must) and data export on request by email (Should) |
| P7 | Transparency | Privacy policy and ToS in the app before sign-up. Consent records stored with timestamp and version |
| P8 | Processors | Hosting, auth, maps and geocoding providers listed in the privacy policy. Prefer EU regions (architect) |
| P9 | DPIA | Lightweight DPIA document produced by the architect before launch (Gate 3) |
| P10 | Supervisory authority | ANSPDCP (Romania). Breach notification within 72 h (Art. 33) |

## 10. Key metrics

**North Star: completed shared seats per week.** This counts passenger seats on rides that actually happened (not cancelled, not a no-show). It captures both sides of the market and real value delivered.

| Supporting metric | Definition | Pilot target (week 12 after launch) **[A]** |
|---|---|---|
| Search match rate | % of passenger searches returning ≥ 1 ride | ≥ 30% in launch corridors |
| Ride fill rate | % of published rides with ≥ 1 confirmed passenger | ≥ 25% |
| Request response time | Median time from request to driver decision | < 15 min |
| 4-week passenger retention | % of passengers with ≥ 2 completed rides within 28 days of the first | ≥ 40% |
| Safety and reliability | Reports per 100 completed rides / cancellation rate | < 1 / < 15% |

North Star target at week 12: **≥ 100 completed shared seats per week** **[A]**.

## 11. Liquidity plan (chicken-and-egg)

1. **Supply first.** Drivers are already on the road. Recruit **30 founding drivers** on the 3 corridors through employer HR and intranet, ULBS student groups, and local Facebook groups.
2. **Recurring rides** (publish a commute once, repeat Mon–Fri) turn one driver into about 10 rides per week of standing supply.
3. **Concentrate.** Corridors plus weekday peaks (07:00–09:00 and 15:00–18:00) in all messaging.
4. **Capture unmet demand.** "Notify me when a matching ride appears" on empty searches (Should). Show the nearest-time alternative instead of a dead end.
5. **Lower passenger friction.** Browsing without an account. Account required only to book.
6. **Measure weekly** match rate per corridor. Shift recruiting to the weakest corridor.

## 12. Risks and mitigations

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| **Liquidity:** searches return nothing, users churn | High / High | Corridors, founding drivers, recurring rides, ride alerts. Kill or pivot review at week 12 if match rate < 15% |
| **Legal reclassification** as paid transport | Low–Med / High | Fuel-only below-cost price, server-side, guardrails in pricing §7, no payments in the platform, ToS wording, legal review before monetization |
| **Safety incident** | Low / Very high | Baseline from §8, 18+, ratings, reports with fast suspension, share-trip link, 112 button |
| **No-shows and late cancellations** | Med / Med | Public counters, driver approval, auto-expiry of unanswered requests |
| **Drivers ask for extra cash** | Med / Med | Price shown to both sides, report reason, suspension |
| **Low driver motivation** (small money) | Med / Med | Recurring rides (zero effort), "fuel saved this month" counter, community framing. Stage 2 employer perks |
| **Privacy breach / over-collection** | Low / High | §9 baseline, minimum data, retention jobs, DPIA |
| **Fuel price volatility** | High / Low | Configurable rates, 3% update rule, price fixed per ride at publish time |
| **Free-tier limits** (maps, SMS, hosting) | Med / Med | OSM-based routing and geocoding preferred. SMS OTP only if free. Architect to monitor |
| **Owner bandwidth** | High / Med | Everything decided by the team. Owner input limited to the items below |

## 13. Owner needs

Nothing is needed from the owner for Phases 1–6. Before **public launch (Gate 3)**:

1. **Data controller identity** for the privacy policy and ToS: personal name, PFA, or SRL. A legal-entity name and address must appear in the policy.
2. **A contact email** for privacy and support requests (a free alias is fine).
3. **Recommended:** a 1-hour consult with a Romanian transport/GDPR lawyer to confirm the **[A]** items in §6. Estimated 500–1,000 RON **[A]**.
4. **Accounts and keys** (hosting, auth, maps) will be batched by the architect in Phase 4/7 with exact instructions.
5. **Optional, high impact:** share the launch post in 2–3 local groups or your workplace to recruit founding drivers.

## Sources

- Fuel prices: [Playtech / PretCarburant.ro, 10 Nov 2026](https://playtech.ro/2026/benzina-si-motorina-s-au-ieftinit-in-romania-orasele-in-care-soferii-gasesc-cele-mai-mici-preturi/)
- Taxi Sibiu: [taxi-calculator.com](https://www.taxi-calculator.com/taxi-rate-sibiu/1048) · [expatistan](https://expatistan.com/price/taxi-trip/sibiu)
- Bolt/Uber: [bento.travel](https://www.bento.travel/compare/romania/bolt-ro-vs-speed-taxi-app-ro) · [Uber Sibiu](https://www.uber.com/global/ro/r/cities/sibiu-sibiu-ro) · [Uber Sibiu blog 2021](https://www.uber.com/en-RO/blog/sibiu-your-uber-awaits)
- Tursib: [Tursib travel titles](https://new.tursib.ro/?p=2332) · [Free passes list](https://new.tursib.ro/images/Persoanele-care-beneficiaza-de-gratuitate-la-transportul-public-din-Sibiu.pdf) · [ULBS 90% discount](https://inginerie.ulbsibiu.ro/fara-categorie/tursib-face-reducere-90-la-abonamente-pentru-studentii-ulbs)
- Population: [citypopulation.de](https://citypopulation.de/en/romania/localities/sibiu/143450__sibiu/) · [g4media](https://www.g4media.ro/unul-din-3-locuitori-din-municipiul-sibiu-s-a-nascut-in-alt-judet-in-selimbar-localitate-de-langa-municipiu-sunt-majoritari-locuitorii-veniti-din-alte-zone-ale-tarii.html)
- Legal RO: [e-juridic on OUG 49/2019](https://e-juridic.manager.ro/articole/soferii-uber-bolt-si-clever-vor-avea-noi-conditii-de-respectat-de-la-1-noiembrie-26314.html) · [startupcafe](https://www.startupcafe.ro/taxe/conditii-uber-bolt-ridesharing.htm) · [Eurofound](https://apps.eurofound.europa.eu/platformeconomydb/ridesharing-ordinance-105143) · [OG 27/2011](https://WWW.RATBV.RO/uploads/documents/og27din2011.pdf) · [legeaz.net case](https://legeaz.net/spete-civil-2/plangere-contraventionala-amenzicontraventii-inchisoare-contraventionala-712-2012) · [OECD 2018](https://one.oecd.org/document/DAF/COMP/WP2/WD(2018)19/en/pdf)
- Legal EU: [Cerema on L3132-1](https://cerema.fr/system/files/documents/2022/07/fiche_covoiturage_vf.pdf) · [Madrid ruling, hosteltur](https://www.hosteltur.com/120330_juez-desestima-demanda-confebus-contra-blablacar.html) · [COM(2016) 356](https://old.parliament.bg/pub/ECD/227300COM_2016_356_EN_ACTE_f.pdf) · [BlaBlaCar ToS](https://legal.blablacar.com/en-gb/terms-and-conditions/)
- GDPR: [EDPB Guidelines 01/2020](https://edpb.europa.eu/sites/default/files/consultation/edpb_guidelines_202001_connectedvehicles.pdf) · [CMS summary](https://cms.law/en/aut/legal-updates/edpb-issues-guidelines-on-connected-cars)
- Competitors: [Wirgo](https://apps.apple.com/us/app/-/id6670219309) · [Waze Carpool shutdown](https://www.engadget.com/waze-shuts-down-carpool-app-174825025.html) · [Bucharest carpool support](https://www.romania-insider.com/bucharest-city-hall-cover-fuel-costs-carpool)
- Distances: [OSRM public router](https://router.project-osrm.org) (OpenStreetMap), queried 2026-11-15
