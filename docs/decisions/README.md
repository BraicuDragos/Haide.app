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
