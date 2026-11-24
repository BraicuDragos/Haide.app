# Decision log (ADR — Architecture Decision Records)

Every significant decision (business, brand, UX, architecture) gets a file
`NNNN-short-title.md`, created with the `decision-record` skill.

| # | Title | Area | Status | Agent |
|---|---|---|---|---|
| [0001](0001-pilot-city-sibiu.md) | Pilot city: Sibiu, launched through 3 commuting corridors | Business | Proposed | product-strategist |
| [0002](0002-business-model-free-mvp.md) | Business model: free MVP with no payments in the app; B2B circles later | Business | Proposed | product-strategist |
| [0003](0003-cost-sharing-pricing-formula.md) | Pricing: fuel-only cost split with the driver, reference consumption per fuel type, round down | Business | Proposed | product-strategist |
| [0004](0004-mvp-scope.md) | MVP scope: publish, search, book, complete, rate, with a trust baseline and no payments | Business | Proposed | product-strategist |
| [0005](0005-location-privacy-baseline.md) | Location privacy baseline: foreground-only, precision by role, 90-day coarsening | Business | Proposed | product-strategist |
| [0006](0006-brand-name-haide.md) | Brand name: Haide ("come on, let's go") | Brand | Proposed | brand-designer |
| [0007](0007-visual-identity-dusk-indigo-saffron.md) | Visual identity: dusk indigo, saffron dot, Bricolage Grotesque and Figtree | Brand | Proposed | brand-designer |
| [0008](0008-navigation-and-information-architecture.md) | Navigation and IA: four bottom tabs, one account for both roles, browse without an account | UX | Proposed | ux-designer |
| [0009](0009-booking-request-then-approve-ux.md) | Booking UX: request then approve, absolute deadlines, no chat, phone reveal after acceptance | UX | Proposed | ux-designer |
| [0010](0010-progressive-onboarding-and-gating.md) | Progressive onboarding: browse first, sign up at the first action, resume in place | UX | Proposed | ux-designer |
| [0011](0011-price-and-money-presentation.md) | Price and money presentation: “Up to X RON”, a table by passenger count, lock that only goes down, no payment UI | UX | Proposed | ux-designer |
| [0012](0012-platform-and-application-stack.md) | Platform and stack: React PWA + Supabase (Postgres/PostGIS, Auth, Storage) + one REST API Edge Function | Architecture | Proposed | software-architect |
| [0013](0013-hosting-environments-and-ci.md) | Hosting, environments and CI/CD: Cloudflare Pages + Supabase Free (Frankfurt) + Brevo, GitHub Actions with a gated deploy | Infrastructure | Proposed | software-architect |
| [0014](0014-maps-routing-geocoding-providers.md) | Maps, routing and geocoding: self-hosted Sibiu vector tiles, openrouteservice routing, own Postgres gazetteer | Architecture | Proposed | software-architect |
| [0015](0015-route-matching-approach.md) | Route matching: PostGIS corridor match with linear referencing on stored route polylines | Architecture | Proposed | software-architect |
| [0016](0016-visual-direction-quiet-futurism-headlight.md) | Visual direction: "Headlight", dark-first quiet futurism where the route is the light (amends 0007) | Brand | Accepted | brand-designer |
| [0017](0017-typography-sora-and-figtree.md) | Typography: Sora for headings and numerals, Figtree for UI text (amends 0007) | Brand | Accepted | brand-designer |
| [0018](0018-icon-set-lucide-vendored.md) | Icon set: Lucide, vendored per icon as inline SVG, stroke 1.75 | Brand | Accepted | brand-designer |
| [0019](0019-motion-no-js-animation-library.md) | Motion: no JS animation library; CSS, WAAPI, View Transitions and linear() springs | Architecture | Accepted | brand-designer |
| [0020](0020-haide-wordmark-sanctioned-exclamation.md) | Copy: one sanctioned exclamation mark, the "Haide!" wordmark in the launch moment of Publish and Join | UX | Accepted | ux-designer |
| [0021](0021-booking-concurrency-ride-row-lock.md) | Booking concurrency: the ride row lock is the single serialization point | Architecture | Proposed | software-architect |
| [0022](0022-notification-delivery-outbox-tick-brevo.md) | Notification delivery: transactional outbox, per-minute tick with leased claims, Brevo HTTP API | Infrastructure | Proposed | software-architect |
| [0023](0023-confirmed-booking-reveal-scope.md) | Reveal scope for confirmed bookings: own segment only, serializer-enforced 24 h window | Architecture | Proposed | software-architect |
| [0024](0024-ride-completion-in-tick-and-no-show.md) | Ride completion as a tick step; accepted seats include completed and no-show; no-show refused once rated | Architecture | Proposed | software-architect |
| [0025](0025-blind-ratings-stored-visible-at.md) | Blind ratings: stored `visible_at` with a column-level update grant | Architecture | Proposed | software-architect |
| [0026](0026-share-trip-link-hashed-token.md) | Share-trip link: passenger-only, hashed 128-bit token, one link per booking, own segment only | Architecture | Proposed | software-architect |
| [0027](0027-suspension-flag-and-tick-safety-sweep.md) | Suspension: status flag set by SQL, cascades done by a tick safety sweep | Architecture | Proposed | software-architect |
| [0028](0028-block-cancels-active-bookings.md) | Blocking cancels active future bookings between the pair, without penalty | Architecture | Proposed | software-architect |
| [0029](0029-account-deletion-immediate-tombstone-and-purge-queue.md) | Account deletion: immediate tombstone in one transaction, external purge retried by the tick | Architecture | Proposed | software-architect |
| [0030](0030-retention-in-tick-coarsening-and-definer-purge.md) | Retention inside the tick: coarsening every minute, row purges through one SECURITY DEFINER function | Architecture | Proposed | software-architect |
| [0031](0031-data-access-requests-by-email-and-sql-export.md) | Data access requests: in-app request by email, export by an admin-only SQL function | Architecture | Proposed | software-architect |
| [0032](0032-product-events-service-side-flat-props-13-month-purge.md) | Product events: service-side in the state-change transaction, flat allow-listed props guarded by a CHECK, 13-month purge | Architecture | Proposed | software-architect |
| [0033](0033-admin-role-profile-flag-and-audited-sql-actions.md) | Admin role: profile flag granted by SQL, admin area in the same PWA, every write audited | Architecture | Proposed | software-architect |
| [0034](0034-metrics-computed-on-read-by-sql-functions.md) | Metrics computed on read by SQL functions from domain tables; events only for search | Architecture | Proposed | software-architect |
| [0035](0035-energy-price-versions-append-only-with-30-percent-guard.md) | Energy price versions: append-only, forward-only timeline, ±30 % guard with audited override | Architecture | Proposed | software-architect |
| [0036](0036-ride-alerts-matched-in-tick-reverse-match-once-per-ride.md) | Ride alerts: matched in the tick by reversing the search match, once per ride, deleted at expiry | Architecture | Proposed | software-architect |
| [0037](0037-auto-accept-confirmed-in-request-transaction-under-ride-lock.md) | Auto-accept: eligibility checked and the seat confirmed inside the request transaction, under the ride lock | Architecture | Proposed | software-architect |
| [0038](0038-web-push-own-rfc8291-on-webcrypto-separate-outbox-rows.md) | Web push: own RFC 8291/8292 sender on WebCrypto, one outbox row per channel, labels-only payloads | Architecture | Proposed | software-architect |
| [0039](0039-ride-series-materialised-up-front-skip-dates-over-daily-limit.md) | Ride series: every instance created up front, dates over the daily limit skipped and reported | Architecture | Proposed | software-architect |
| [0040](0040-zero-cost-personal-deploy-no-domain.md) | Zero-cost personal deploy: no custom domain, single-sender mail, OAuth in Testing mode | Architecture | Accepted | Orchestrator |
| [0041](0041-rides-are-editable-time-seats-note-auto-accept.md) | Rides are editable (time, seats, note, auto-accept); route fixed; a time change notifies each passenger | Architecture | Accepted | backend-dev |
| [0042](0042-approximate-address-positions.md) | Any house number in address search: own gazetteer plus synthetic, flagged approximate addresses (300 m interpolation bound) | Architecture | Proposed | backend-dev |
| [0043](0043-never-serve-places-outside-coverage.md) | Never serve places outside coverage; curated popular routes may carry a display label | Architecture | Accepted | backend-dev |
