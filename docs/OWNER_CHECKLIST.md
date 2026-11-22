# Owner checklist — what only you can do to finish Haide

> Written 2026-11-22 by the Orchestrator. Claude never approves a production deploy, never merges and never changes environment protection: these steps are yours.

## 1. Merge the PRs (in this order; all three had green CI on 2026-11-22 night, re-check `gh pr checks <n>` if you wait)
1. **#16** `fix(deploy)`: deploy workflow fixes (needed before any deploy).
2. **#18** `fix: hardening`: deleted-user guards, admin rule, idempotency, search flake.
3. **#17** `feat(web)`: map tiles + MapLibre worker fix + a11y fix.
Each merge to `main` queues a Deploy run that waits for you; GitHub keeps only the newest waiting run, so the one you approve at the end is the one built from the last merge.

## 2. Approve the deploy
- Actions → **Deploy** → open the newest *Waiting* run → **Review deployments** → tick `production` → **Approve and deploy** (works in the GitHub mobile app).
- Tell Claude "deploy running". Claude reads the log and fixes what breaks (this is the first run that touches the real Supabase project; expect one or two fixes).
- A run that is stuck on a branch name (`fix/deploy-remote`) can be cancelled: Actions → that run → Cancel.

## 3. After the deploy is green
1. Set the repo variable `PROD_API_URL` = `https://<project-ref>.supabase.co/functions/v1/api/v1` (no trailing slash). Settings → Secrets and variables → Actions → Variables. This turns on the nightly backup and the keepalive (free Supabase pauses after 7 days idle).
2. Open `https://haide.pages.dev` on your phone, sign in once, then in Supabase → SQL Editor run:
   `update app.profiles set role = 'admin' where id = (select id from auth.users where email = 'dragosbraicu9@gmail.com');`
3. Google Cloud → Google Auth Platform → Audience: add yourself and each tester as a **test user** (Testing mode allows 100). Without this Google sign-in is refused.
4. Brevo: check the first magic-link mail arrives (look in spam). If it is rejected, re-check that the sender address is verified.
5. Supabase → Database → Cron: `haide-tick` shows successful runs. In the SQL editor `select * from app.location_retention_violations(now());` returns no rows.
6. Supabase → Authentication: turn off the audit log if the setting exists, or ask Claude to add the 30-day purge (deploy.md section 6).

## 4. Check on a real phone (Claude cannot)
- Install the PWA (Android Chrome: menu → Install; iOS Safari: Share → Add to Home Screen). Web push on iOS only works after installing.
- Publish a ride, search from a second account, request, approve, cancel; check the emails; check the map and the offline behaviour.
- Note anything ugly or broken and give it to Claude as a list.

## 5. Optional housekeeping
- Update your local remote: `git remote set-url origin https://github.com/BraicuDragos/Haide.app.git` (the repo was renamed; pushes still redirect).
- Legal: the text says you are a private individual running a non-commercial learning project. Keep it invite-only, free, without ads. If this ever goes public, get a real legal review.
- Delete merged branches in GitHub when you like (Claude never deletes remote branches).
