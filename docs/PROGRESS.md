# PROGRESS — the team's shared memory

> Updated by the Orchestrator after every step. Read at the start of every session.

## Current state
- **Phase:** 5 — scaffold + CI (E0) built and QA-approved; PR on branch `chore/scaffold`
- **Open PRs:** E0 scaffold PR (being opened)
- **Approved gates:** GATE 1 (PR #1), GATE 2 (PR #2) — both merged

## Done
- [x] Phase 1 — product strategy (ADRs 0001–0005) — PR #1
- [x] Phase 2 — brand "Haide" (ADRs 0006–0007) — PR #1
- [x] Phase 3 — UX + clickable prototype (ADRs 0008–0011) — PR #2
- [x] Phase 4 — architecture (ADRs 0012–0015) — PR #2
- [x] Phase 5 — E0 scaffold: pnpm workspace, Supabase baseline migration + gazetteer (22.6k places), Hono API (`/health`, `/places`, ...), PWA shell, place picker, RouteMap, CI workflows (deploy guarded). QA: APPROVED (lint, typecheck, 102 unit tests, 13 Playwright+axe, Lighthouse a11y 100)

## Next step
- Owner merges E0 PR → Phase 6, epic E1 `feat/accounts` (see `docs/architecture/backlog-technical.md`)

## Not verified in E0 (no Docker/Supabase CLI/Deno on this machine) — CI must confirm
- `supabase db reset`, pgTAP, `deno check/lint`, workflow runs, `build-tiles.sh`, real-tile map rendering, hosted-Supabase `bypassrls` role creation, `backup.yml` dump.

## Carry-forward findings (non-blocking, from QA)
- E1: check JWT issuer in `auth.ts`; add `bodyLimit` (~64 KB) on public POST routes.
- E4: retention/cleanup for `app.rate_limits` and `app.app_errors` via `/internal/tick`.
- Every new migration must revoke PUBLIC EXECUTE on new `app` functions.
- Reverse geocode casts to geography (skips GiST index) — fine at current size.
- No Lighthouse step in CI yet. conventions.md says MapLibre 5; code uses v6 — update docs.
- E3: PMTiles offline caching (206 responses) TODO in `sw.ts`.

## Blockers / what the owner needs to provide
- Nothing before Gate 3 (batch in `docs/architecture/deploy.md` §3).
- Stale paths in `.claude/agents/frontend-dev.md`: `docs/ux/screens.md` → `docs/ux/ia-and-flows.md` §4; `assets/brand/design-tokens.json` → `docs/brand/design-tokens.json`. Owner config; briefs give correct paths.
- `gh` is at `C:\Program Files\GitHub CLI\gh.exe` (not on bash PATH); `pnpm` not on PATH locally (use `npx pnpm`).
