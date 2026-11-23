# Owner checklist — what only you can do to finish Haide

> Written 2026-11-22 by the Orchestrator. Claude never approves a production deploy, never merges and never changes environment protection: these steps are yours.

## 1. Done already (by you and claude, 2026-11-23)
- PRs #15-#19 merged, production deploy approved and green, `PROD_API_URL` set. Still to merge: **#20** (the live deploy was built from its branch; merging makes `main` identical) and the docs PR. A merge queues a Deploy run: approve it or cancel it, both are fine.

## 2. Fix the backup (5 minutes)
- Settings -> Secrets and variables -> Actions -> **Secrets** tab -> New repository secret, twice: `SUPABASE_ACCESS_TOKEN` (Supabase -> Account -> Access Tokens, make a new one or reuse the `github-actions` token value) and `SUPABASE_DB_PASSWORD` (the database password you saved from the project creation; if lost: Supabase -> Project Settings -> Database -> Reset password, then update the same secret in the `production` environment too).
- Then Actions -> Backup -> Run workflow, and tell claude (it checks the artifact is created).

## 3. Do on your side (claude cannot log in)
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
