# PROGRESS — the team's shared memory

> Updated by the Orchestrator after every step. Read at the start of every session.

## Current state
- **Phase:** 6 — features. E1 (accounts) built and QA-approved; PR on branch `feat/accounts`
- **Open PRs:** E1 PR (being opened)
- **Approved gates:** GATE 1 (PR #1), GATE 2 (PR #2); E0 merged (PR #3)

## Done
- [x] Phases 1–4: strategy, brand "Haide", UX + prototype, architecture (ADRs 0001–0015)
- [x] Phase 5 — E0 scaffold + CI (PR #3, merged; CI green incl. integration)
- [x] E1 — accounts, profile, vehicle: migration `20261116090000_accounts.sql` (6 tables, RLS), gates middleware, account endpoints, photo pipeline (imagescript), JWT iss check, bodyLimit; auth + onboarding + profile screens, policy pages. QA: APPROVED (292 unit tests, 30 mocked Playwright, initial JS 155 KB gzip)

## Next step
- Owner merges E1 PR → epic **E-DM** (design & motion), brief: `docs/brand/design-direction.md` (starts only after E1 merge; branch `feat/design-motion`) → then E2 (rides + pricing engine)

## Not verified locally in E1 — CI must confirm
- Migration + pgTAP 004, `deno check/lint`, imagescript wasm under Deno, integration tests incl. Storage upload, real magic-link E2E, CI assumptions (`supabase seed buckets`, `supabase status -o env` keys, HS256 local JWT).
- Production later: create `avatars` bucket on hosted project, pin CSP `img-src` to the project host.

## Carry-forward findings (non-blocking)
- E1 low: imagescript resize is nearest-neighbour; consider lowering `PHOTO_MAX_PIXELS` 24 MP → ~8 MP; imagescript v1 is unmaintained (v3 exists).
- E4: retention/cleanup for `app.rate_limits` and `app.app_errors` via `/internal/tick`.
- Every new migration must revoke PUBLIC EXECUTE on new `app` functions.
- E5 refines rating visibility (7-day / counter-rating); E6 adds `DELETE /me`.
- No Lighthouse step in CI yet. conventions.md says MapLibre 5; code uses v6. PMTiles offline caching TODO in `sw.ts` (E3).

## Blockers / what the owner needs to provide
- Nothing before Gate 3 (batch in `docs/architecture/deploy.md` §3). `haide.ro`/`haide.app` are taken; `haide.city`, `gohaide.app` look free — brand-guide domain advice needs updating.
- `gh` is at `C:\Program Files\GitHub CLI\gh.exe`; `pnpm` not on PATH locally (use `npx pnpm`).
