---
name: kickoff
description: Start or resume the autonomous build of the carpooling app — runs the full phased workflow from CLAUDE.md with the agent team, stopping only at PR merges and the 3 gates.
argument-hint: "[resume]"
disable-model-invocation: true
---

# Kickoff — autonomous build

Argument: `$ARGUMENTS` (empty = fresh start, `resume` = continue from `docs/PROGRESS.md`).

## 0. Preflight (do this every time, quietly)
Run and check:
- `git status` — working tree state; `git branch --show-current`.
- `git remote -v` — `origin` must exist.
- `gh auth status` — must be logged in.
If anything fails, stop and tell the owner the exact commands to fix it. Nothing else.

Then read `CLAUDE.md` (already loaded), `docs/PROJECT_BRIEF.md`, `docs/PROGRESS.md`.
Use the task list to show the phases and tick them off as you go.

## 1. Determine the starting point
- Fresh start → Phase 1.
- `resume` → read `docs/PROGRESS.md`; if a PR is open, check it with `gh pr view <n> --json state,reviews,comments`:
  - MERGED → `git switch main && git pull`, continue with the next phase.
  - OPEN with new comments → address feedback on that branch.
  - OPEN without feedback → ask the owner (AskUserQuestion) as described in CLAUDE.md §3.

## 2. Run the phases (CLAUDE.md §3)
For each phase:
1. `git switch main && git pull && git switch -c <branch>`.
2. Brief the responsible agent(s) — short, self-contained, with input/output paths and acceptance criteria.
3. For code phases: dev agent(s) → `qa-reviewer` → loop fixes until APPROVED (max 3 loops, then report).
4. `release-manager` → commit, push, open PR.
5. Update `docs/PROGRESS.md` (commit it on the same branch before the PR is opened if possible).
6. Wait for the owner via AskUserQuestion (gate or merge), then continue.

## 3. Phase 6 loop
Take epics from `docs/architecture/backlog-technical.md` in order, one PR per epic, until the MVP backlog is done.

## 4. Phase 7
Prepare deploy per `docs/architecture/deploy.md`, list what the owner must create (accounts/keys),
ask for **GATE 3** approval, then deploy and report the live URL.

## Owner communication style
English, short, bullet points, always a link to the PR. Never ask about things the team can decide.
