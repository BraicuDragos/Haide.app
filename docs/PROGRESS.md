# PROGRESS — the team's shared memory

> Updated by the Orchestrator after every step. Read at the start of every session.

## Current state
- **Phase:** 6 — features. E-DM (design & motion) built + QA-approved; PR being opened on `feat/design-motion`
- **Open PRs:** E-DM PR (being opened)
- **Approved gates:** GATE 1 (PR #1), GATE 2 (PR #2); E0 merged (PR #3)

## Done
- [x] Phases 1–4: strategy, brand "Haide", UX + prototype, architecture (ADRs 0001–0015)
- [x] Phase 5 — E0 scaffold + CI (PR #3, merged; CI green incl. integration)
- [x] E-DM — "Headlight" dark-first design + motion (ADRs 0016–0020): Sora, Lucide, motion tokens, route glow, price roll, seat picker, launch moment, Reduce-motion + Theme settings; QA APPROVED (383 unit, 68 Playwright, Lighthouse a11y 100, JS 152.6 KB gzip)
- [x] E1 — accounts (PR #5 merged), profile, vehicle: migration `20261116090000_accounts.sql` (6 tables, RLS), gates middleware, account endpoints, photo pipeline (Jimp), JWT iss check, bodyLimit; auth + onboarding + profile screens, policy pages. QA: APPROVED (292 unit tests, 30 mocked Playwright, initial JS 155 KB gzip)

## Next step
- Owner merges E-DM PR → E2 (publish rides + pricing engine), then E3…E8. E-DM leftovers: match moment + live trip + shared-element ride morphs land with E3/E4 screens; real-phone fps, real tiles, screen readers unverified

## Not verified locally in E1 — CI must confirm
- Migration + pgTAP 004, `deno check/lint`, integration tests incl. Storage upload, real magic-link E2E, CI assumptions (`supabase seed buckets`, `supabase status -o env` keys, HS256 local JWT).
- Production later: create `avatars` bucket on hosted project, pin CSP `img-src` to the project host.

## Carry-forward findings (non-blocking)
- E1: imagescript replaced by pure-JS Jimp 1.6.1 (lazy import; native codec failed on Deno Edge Runtime); `PHOTO_MAX_PIXELS` lowered to 8 MP.
- E4: retention/cleanup for `app.rate_limits` and `app.app_errors` via `/internal/tick`.
- Every new migration must revoke PUBLIC EXECUTE on new `app` functions.
- E5 refines rating visibility (7-day / counter-rating); E6 adds `DELETE /me`.
- No Lighthouse step in CI yet. conventions.md says MapLibre 5; code uses v6. PMTiles offline caching TODO in `sw.ts` (E3).

## Blockers / what the owner needs to provide
- Nothing before Gate 3 (batch in `docs/architecture/deploy.md` §3). `haide.ro`/`haide.app` are taken; `haide.city`, `gohaide.app` look free — brand-guide domain advice needs updating.
- `gh` is at `C:\Program Files\GitHub CLI\gh.exe`; `pnpm` not on PATH locally (use `npx pnpm`).
