---
name: ship-pr
description: Git and GitHub workflow for this repo — branch naming, Conventional Commits, push, and opening a Pull Request with an English description via gh CLI. Use whenever changes must be committed, pushed and turned into a PR, or PR feedback must be read.
allowed-tools: Bash(git status *) Bash(git diff *) Bash(git add *) Bash(git commit *) Bash(git switch *) Bash(git branch *) Bash(git log *) Bash(git pull *) Bash(gh pr create *) Bash(gh pr view *) Bash(gh pr checks *) Bash(gh pr list *) Bash(gh auth status *)
---

# Ship a PR

## Branch names
`docs/<topic>`, `feat/<epic-slug>`, `fix/<slug>`, `chore/<slug>`, `test/<slug>` — lowercase, kebab-case.

## Steps
1. **Check state**
   ```bash
   gh auth status
   git status
   git branch --show-current
   ```
   If on `main`/`master`: create the branch first — `git switch -c <branch>`.

2. **Safety check before staging**
   ```bash
   git status --porcelain
   ```
   Never stage `.env*` (except `.env.example`), keys, tokens, `node_modules/`, build outputs.

3. **Commit in logical chunks** (Conventional Commits, English, imperative):
   ```bash
   git add <paths>
   git diff --cached --stat
   git commit -m "feat(booking): allow passengers to join a published route"
   ```

4. **Push the branch** (never to main):
   ```bash
   git push -u origin <branch>
   ```

5. **Open the PR** — title and body in English, following `.github/pull_request_template.md`:
   ```bash
   gh pr create --base main --head <branch> --title "<type>: <short English title>" --body "$(cat <<'EOF'
   ## What this PR contains
   - ...

   ## Why
   ...

   ## Decisions (ADRs)
   - docs/decisions/NNNN-....md

   ## How to review (from a phone)
   - Open `docs/...` in the Files changed tab
   - ...

   ## Screenshots / preview
   ![screen](docs/screenshots/<epic>/<file>.png)

   ## Checklist
   - [x] Tests pass (CI green)
   - [x] Reviewed by qa-reviewer
   - [x] No secrets in code
   - [x] docs/PROGRESS.md updated
   EOF
   )"
   ```
   Screenshot links: use paths relative to the repo root so GitHub renders them in the PR.

6. **Report CI**
   ```bash
   gh pr checks <number>
   ```
   (If no CI exists yet, say so.)

7. Return: PR URL, number, branch, CI status.

## Reading feedback
```bash
gh pr view <number> --comments
gh pr view <number> --json reviews,state
```
Summarize each requested change as an actionable item for the orchestrator.

## Forbidden
`git push` to main/master, `--force`, `gh pr merge`, `git push --delete`, rewriting published history.
