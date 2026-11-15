# 0012. Platform and stack: React PWA + Supabase (Postgres/PostGIS, Auth, Storage) + one REST API Edge Function

- **Status:** Proposed
- **Date:** 2026-11-15
- **Area:** Architecture
- **Agent:** software-architect

## Context
The MVP must work well one-handed on a 360 px phone, be installable to the home screen, work signed out (browse first, ADR 0010), cost nothing to host, and be built and maintained by a small team of AI agents. The scale target is 500 users and 200 rides per week. The core needs are geospatial matching (PostGIS-class queries), a server-side pricing engine (ADR 0003), role-based field filtering for privacy (ADR 0005), scheduled jobs (request expiry, completion, retention) and transactional email. App store review and fees are explicitly unwanted (mvp-scope §2).

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. **PWA (React + Vite + TypeScript)** + **Supabase** (Postgres with PostGIS, Auth, Storage, Edge Functions, pg_cron) | One codebase, shareable links to rides, no store. Postgres + PostGIS gives real geospatial indexes and transactions. Auth covers Google and magic link out of the box. Cron, storage and functions are on the free plan. React is the most familiar stack for coding agents | iOS web push only works once the PWA is installed (email stays the main channel). Edge Functions run on Deno, so the server toolchain differs slightly from the web's Node toolchain. Free projects pause after 7 days without activity | 0 RON/month. Medium effort |
| B. Native/cross-platform app (Expo React Native) + Firebase (Firestore, Auth, Functions) | Best native feel, reliable push | Store accounts and review (Apple costs 99 USD/year). Firestore has no real geospatial line queries, so matching becomes custom geohash code. Cloud Functions need the pay-as-you-go Blaze plan with a card | 99 USD/year + card on file. High effort |
| C. Next.js on Vercel + Neon Postgres + Auth.js + a mail API | Full control in one Node codebase, SSR | More code to own: auth flows, cron, storage, rate limits. Vercel Hobby forbids commercial use, and B2B is planned later | 0 now, a migration later. High effort |

## Decision
Option A. The client is a mobile-first **React 19 + Vite + TypeScript PWA** (vite-plugin-pwa, React Router, TanStack Query, Tailwind CSS v4 fed by `docs/brand/design-tokens.json`, i18next, MapLibre GL JS). The backend is **Supabase in the EU (Frankfurt)**: Postgres with PostGIS, pg_trgm, unaccent, pg_cron and pg_net, plus Supabase Auth (Google OAuth and email magic link, 15-minute single-use links) and Supabase Storage for profile photos. All business logic sits behind **one REST API, a single Edge Function `api` (Hono + zod)**. It reads and writes the database over a direct Postgres connection as a least-privilege role. The client never queries tables directly: the `app` schema is not exposed through PostgREST, and RLS is enabled deny-all as defence in depth. The **pricing engine and the booking rules are pure TypeScript modules** in `supabase/functions/_shared/domain/`, unit- and property-tested with Vitest. This is the single source of truth for prices. **No SMS OTP** in the MVP (no free provider at pilot volume). The phone number is format-validated only.

Why: it is the only option that meets zero cost, PostGIS matching and fast agent delivery together, and it keeps every rule server-side (backlog G1).

## Consequences
- Positive: one deployable web app and one deployable function. Real SQL transactions make overbooking impossible. Geospatial queries are indexed. Privacy filtering lives in one place (the API layer). No app-store friction.
- Negative / accepted risks: Deno for the function and Node for the web. Mitigated: the domain code is plain TypeScript with no runtime APIs and is tested with Vitest. iOS users get push only after installing the PWA (E8). We depend on Supabase's free plan terms (see ADR 0013 for exit paths). Edge Function limits are 2 s CPU and 256 MB per request, so heavy image work happens on the client, with a small server re-encode.
- What would trigger revisiting: more than 10k MAU or more than 400 MB of database, sustained cold-start latency over 1 s on the API, a need for native-only features (background location is out of scope by ADR 0005), or a Supabase free-plan change.

## Sources
- [Supabase pricing (free plan: 500 MB DB, 50k MAU, 500k function invocations, pause after 1 week inactive), checked 2026-11-15](https://supabase.com/pricing)
- [Supabase Edge Function limits (2 s CPU, 256 MB, 150 s wall clock on Free), checked 2026-11-15](https://supabase.com/docs/guides/functions/limits)
- [Supabase changelog: importing files outside the functions folder (experimental)](https://supabase.com/changelog/33613-deploy-edge-functions-from-cli-without-needing-docker-import-files-outside-of-supabase-directory)
- `docs/product/mvp-scope.md` §2, `docs/decisions/0003`, `0005`, `0010`
