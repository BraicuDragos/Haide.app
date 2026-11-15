# Setup conversation — how this agent team was designed

> Record of the conversation between the owner (Dragoș) and Claude that produced this repository's
> agent setup (2026-11-15). Owner messages are translated from Romanian; Claude's replies are condensed
> to their decisions and instructions. This is context for humans and agents — the binding rules
> live in `CLAUDE.md`.

---

## 1. Owner — the goal

> I'm a technical person passionate about AI and I want to learn how to work with agents using
> Claude Code. To learn this I want to build a practical project where I don't give important input
> and agents make decisions and work on my behalf.
>
> The project I want to build is a city BlaBlaCar. Basically routes get announced, people join other
> routes if the route suits them, and the price is very low. We'll settle more details along the way.
>
> I want you to tell me what to do to configure everything so this app works end to end. The agents
> I configure make design decisions (name, logo, color palette), code architecture decisions, business
> decisions and UI & UX decisions. Use important, valuable skills for each.
>
> I want to work with Claude Code. Send me the steps one by one, and afterwards I should be able to
> just hit start.

## 2. Claude — plan and first steps

**System design**
- The main Claude Code session acts as **orchestrator / Product Lead** and delegates to
  **specialised subagents** defined as Markdown files in `.claude/agents/` (frontmatter: name,
  description, tools, model, skills; body = system prompt). The `skills` field preloads skills into a subagent.
- Proposed team: `product-strategist`, `brand-designer`, `ux-designer`, `software-architect`,
  `backend-dev`, `frontend-dev`, `qa-reviewer` — each backed by relevant skills
  (`frontend-design`, the `design` and `engineering` plugins, `feature-dev`, `code-review`).
- **Subagents, not agent teams**: agent teams are experimental, disabled by default and use
  significantly more tokens. Can be explored later as an exercise.

**Roadmap**
1. Prerequisites + Claude Code install
2. Create the project + log in
3. Install plugins/skills
4. Write `CLAUDE.md` (the orchestrator's constitution)
5. Define subagents in `.claude/agents/`
6. `.claude/settings.json` permissions for autonomy
7. MCP (Model Context Protocol) servers, e.g. Playwright for UI self-testing
8. Kickoff prompt

**Step 1** — install Git for Windows, Node.js LTS, Claude Code
(`irm https://claude.ai/install.ps1 | iex`), verify with `--version`.
**Step 2** — `mkdir carpool-app`, `git init`, `claude` (log in). Don't run `/init` on an empty repo.

**Questions asked**: OS? Claude plan? Separate from the KiddoFlux hackathon project? Level of autonomy
(full vs. 2–3 approval gates — recommended gates)? Ready-made files vs. building them step by step?

## 3. Owner — answers

> ```
> claude --version → 2.1.323 (Claude Code)
> git --version    → git version 2.53.0.windows.3
> node --version   → v24.15.0
> ```
> I ran `git init` and trusted the project in Claude.
> - I work on **native Windows**.
> - I have **Claude Pro** (you decide which model each agent uses, whatever you think is best).
> - It's a **separate project** (not the hackathon).
> - Autonomy: **4b — approval gates**.
> - Send the files ready-made in an archive and I'll extract it into the project.
>
> I want one agent or all of them connected to git — doing git commit, git push and everything —
> and I only review the PR and merge. I want to do this from my phone and use Claude Remote Control.

## 4. Claude — the delivered setup

**Model choices (Claude Pro, limited usage)**
| Agent | Model | Why |
|---|---|---|
| Main session (orchestrator) | Sonnet | Mostly delegates; saves Pro quota (Opus would be the Pro default) |
| `product-strategist`, `software-architect` | Opus | Rare but critical decisions |
| `brand-designer`, `ux-designer`, `backend-dev`, `frontend-dev`, `qa-reviewer` | Sonnet | Good quality/usage ratio for bulk work |
| `release-manager` | Haiku | git/`gh` operations are mechanical |

**Git workflow**
- Only `release-manager` talks to the remote: branch per phase/epic, Conventional Commits,
  `git push -u origin <branch>`, `gh pr create`. Never pushes to `main`, never force-pushes, never merges.
- The owner approves by **merging the PR in GitHub Mobile**, then confirms in the Claude app
  (the orchestrator waits via AskUserQuestion — no token-burning polling).
- Local `deny` rules in `.claude/settings.json` are a safety net only; the real protection is a
  GitHub ruleset on `main` (require PR, block force pushes).

**Gates**: GATE 1 after business + brand, GATE 2 after UX + architecture, GATE 3 before deploy.

**Remote Control**: `remoteControlAtStartup: true` and `permissions.defaultMode: "auto"` go in the
user-level `~/.claude/settings.json` (auto mode is ignored in project settings). Enable push
notifications via `/config`. The PC must stay on (sleep = never) — work runs locally, the phone steers it.

**Remaining steps**: extract → user settings → `gh auth login` + `gh repo create` → install 8 plugins →
phone apps + notifications → `claude` + `/kickoff`. Details in `_setup/SETUP.md`.

**Caveats**: Pro usage limits will be hit several times during a full MVP build — resume with
`claude -c` + `/kickoff resume` (state lives in `docs/PROGRESS.md`). Deploy will require the owner
to create hosting accounts once.

## 5. Owner — language change

> Send the archive again please. I want everything to be in **English** — the app, the PRs and all
> those things. Also include our conversation.

## 6. Claude — applied

- All artifacts switched to English: app UI (i18n-ready), docs, ADRs, PR titles/descriptions,
  review notes, questions and summaries to the owner.
- This file (`docs/setup-conversation.md`) added as the record of the setup conversation.
