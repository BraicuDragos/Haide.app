# SETUP — remaining steps (native Windows)

> The `_setup/` folder can be deleted once you finish these steps.
> Steps 1–2 (install Git, Node.js, Claude Code; `git init`; first `claude` login + trust) are already done.

## 3. Extract
Extract into `C:\Users\drago\carpool-app`. The project root must directly contain:
`CLAUDE.md`, `.claude\`, `.github\`, `docs\`, `_setup\`, `.gitignore`.
(Windows "Extract All" creates a subfolder by default — change the target path.)

## 4. User settings (once per PC)
File: `C:\Users\drago\.claude\settings.json`
- If it doesn't exist: copy `_setup\user-settings.json` there and rename it to `settings.json`.
- If it exists: add the `permissions.defaultMode` and `remoteControlAtStartup` keys from `_setup\user-settings.json`.

## 5. GitHub CLI + repository
```powershell
winget install --id GitHub.cli
# open a NEW terminal
gh auth login          # GitHub.com → HTTPS → Login with a web browser
cd C:\Users\drago\carpool-app
git branch -M main     # git init on Windows may create "master"
git add .
git commit -m "chore: agent team setup"
gh repo create carpool-app --private --source=. --remote=origin --push
```
Protect `main`: GitHub → repo → Settings → Rules → Rulesets → New branch ruleset →
Target: `main` → enable **Require a pull request before merging** + **Block force pushes**.
(On a private repo, rulesets are enforced only with GitHub Pro — free via the GitHub Student Developer Pack.)

## 6. Plugins (inside `claude`, from the project folder; pick **Project** scope when asked)
```
/plugin install frontend-design@claude-plugins-official
/plugin install feature-dev@claude-plugins-official
/plugin install code-review@claude-plugins-official
/plugin install playwright@claude-plugins-official
/plugin install context7@claude-plugins-official
/plugin marketplace add anthropics/knowledge-work-plugins
/plugin install design@knowledge-work-plugins
/plugin install engineering@knowledge-work-plugins
```
Exit (`/exit`), restart `claude`, type `/` → you should see `/kickoff`.

## 7. Phone + notifications
- Install the Claude app (iOS/Android) and sign in with the same account.
- Install GitHub Mobile (PR review + merge).
- In `claude`: `/config` → enable **Push when actions required** and **Push when Claude decides**.
- Windows: Settings → System → Power → when plugged in: screen may turn off, but **Sleep = Never**.

## 8. Start
```powershell
cd C:\Users\drago\carpool-app
claude
```
Then type `/kickoff`. The session shows up in the Claude app on your phone (Remote Control auto-connects).
Resume after a break / usage limit: `claude -c`, then `/kickoff resume`.
