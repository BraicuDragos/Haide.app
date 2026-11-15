# Deploy guide (Phase 7, after GATE 3)

> Owner: software-architect · Date: 2026-11-15 · **Nothing is deployed yet.** Every step below happens only after the owner approves GATE 3.
> Related: [architecture.md](architecture.md) §12 and §16 · ADR [0013](../decisions/0013-hosting-environments-and-ci.md)

## 1. Target

| Piece | Where | Plan | Region |
|---|---|---|---|
| PWA (static) | Cloudflare Pages project `haide`, domain `haide.ro` (+ `www`) | Free | Global CDN |
| API, DB, Auth, Storage, Cron | Supabase project `haide-prod` | Free | Central EU (Frankfurt, eu-central-1) |
| Email (auth + notifications) | Brevo, domain `haide.ro`, sender `no-reply@haide.ro` | Free (300/day) | EU |
| Routing | openrouteservice (HeiGIT) | Standard (free) | DE |
| Support mailboxes | Cloudflare Email Routing: `support@haide.ro`, `privacy@haide.ro` → owner's inbox | Free | — |
| CI, deploy, backups | GitHub Actions (this repo) | Free | — |

## 2. Cost estimate

| Item | Cost |
|---|---|
| Supabase, Cloudflare Pages, Email Routing, Brevo, openrouteservice, GitHub Actions | **0 RON/month** at pilot scale (limits in architecture §16, checked 2026-11-15) |
| Domain `haide.ro` | about **50–100 RON/year [A]** (the only recommended spend) |
| Optional: 1-hour transport/GDPR lawyer consult (strategy §13) | 500–1,000 RON one-off **[A]** |
| If we outgrow free tiers later | Supabase Pro 25 USD/month. Brevo Starter from about 9–15 USD/month |

## 3. What the owner must create (one batch, about 60–90 minutes)

Use one password manager entry per account. Paste **secrets only into GitHub → Settings → Secrets and variables → Actions** (or the named dashboard), never into chat, issues or files.

| # | Account / item | Why | Exact steps | Hand back as |
|---|---|---|---|---|
| 1 | **Domain `haide.ro`** | App URL, email sender, support mailboxes | Buy at any `.ro` registrar (e.g. ROTLD-accredited). If taken: `haide.app`, then `gohaide.ro` (brand-guide §11). Do step 2 right after, to point nameservers to Cloudflare | Domain name |
| 2 | **Cloudflare account** (free) | Hosting, DNS, email forwarding | (a) Sign up at dash.cloudflare.com. (b) "Add a domain" → `haide.ro` → Free plan → copy the 2 nameservers → set them at the registrar. (c) **Email → Email Routing** → enable → create `support@haide.ro` and `privacy@haide.ro` → destination: your personal email (confirm the verification mail). (d) **My Profile → API Tokens → Create Token → Custom token**: permission *Account · Cloudflare Pages · Edit*, your account only. (e) Copy the **Account ID** from the domain overview sidebar | Secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| 3 | **Supabase account** (free) | Database, API, auth | (a) Sign in at supabase.com with GitHub. (b) New organization → **Free** plan. (c) New project: name `haide-prod`, region **Central EU (Frankfurt)**, click "Generate a password" and save it. (d) Project Settings → copy **Project ref** (the `xxxx` in `xxxx.supabase.co`) and the **publishable (anon) key**. (e) Account (avatar) → **Access Tokens** → generate `github-actions` | Secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`. Variables `SUPABASE_PROJECT_REF`, `VITE_SUPABASE_PUBLISHABLE_KEY` |
| 4 | **Google sign-in** (free) | "Continue with Google" | (a) console.cloud.google.com → new project `Haide`. (b) **Google Auth Platform → Branding** (older UI: "OAuth consent screen"): External, app name `Haide`, support email `support@haide.ro`, authorised domains `haide.ro` and `supabase.co`, scopes `openid`, `email`, `profile` only → **Publish app** (basic scopes need no Google review). (c) **Clients → Create client → Web application**: JavaScript origin `https://haide.ro`, redirect URI `https://<project-ref>.supabase.co/auth/v1/callback` | Secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| 5 | **Brevo account** (free) | Sending email | (a) Sign up at brevo.com (choose the free plan, skip marketing setup). (b) **Senders, Domains & Dedicated IPs → Domains → Add a domain** `haide.ro` → choose "authenticate with Cloudflare" if offered, else copy the TXT/CNAME records (Brevo code, DKIM, DMARC) into Cloudflare DNS → Verify. (c) **Senders** → add `no-reply@haide.ro` (name "Haide"). (d) **SMTP & API → SMTP** → generate an SMTP key. Note the login shown there. (e) **SMTP & API → API keys** → generate `haide-api` | Secrets `BREVO_SMTP_LOGIN`, `BREVO_SMTP_KEY`, `BREVO_API_KEY` |
| 6 | **openrouteservice key** (free) | Route calculation when publishing | Sign up at openrouteservice.org (HeiGIT account) → Dashboard → request a **Standard** token named `haide` | Secret `ORS_API_KEY` |
| 7 | **Backup encryption key** | Nightly encrypted DB backups | Install `age` (winget `FiloSottile.age`, or brew/apt), run `age-keygen -o haide-backup.key`. Store the file in your password manager (it is the only way to read backups). Copy the line starting with `age1…` | Variable `BACKUP_AGE_PUBLIC_KEY` |
| 8 | **GitHub settings** | Gate the deploy | Repo → Settings → **Environments → New environment `production`** → Required reviewers: yourself. Then add all secrets/variables from §4 marked "owner". Set variable `DEPLOY_ENABLED` = `true` **only when GATE 3 is approved** | — |
| 9 | **Legal identity** (strategy §13) | Privacy policy and ToS | Decide controller: your name, a PFA or an SRL, plus a postal address | Text for the policy placeholder |

Generated by the team (no owner action): `CRON_SECRET`, `API_DB_PASSWORD`, `IP_HASH_SALT_SEED`, VAPID keys (E8). The release manager creates these with `openssl rand -base64 32` and stores them as GitHub secrets via `gh secret set` (values never printed or committed).

## 4. Configuration reference

### 4.1 GitHub Actions: secrets (S) and variables (V)

| Name | S/V | Source | Used by |
|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | S | owner #3 | deploy |
| `SUPABASE_DB_PASSWORD` | S | owner #3 | deploy (link, db push, role setup), backup (pg_dump) |
| `SUPABASE_PROJECT_REF` | V | owner #3 | deploy, backup, keepalive |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | V | owner #3 | web build (public by design) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | S | owner #4 | `supabase config push` |
| `BREVO_SMTP_LOGIN`, `BREVO_SMTP_KEY` | S | owner #5 | `supabase config push` (auth SMTP) |
| `BREVO_API_KEY` | S | owner #5 | function secret |
| `ORS_API_KEY` | S | owner #6 | function secret |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | S | owner #2 | wrangler |
| `BACKUP_AGE_PUBLIC_KEY` | V | owner #7 | backup |
| `CRON_SECRET` | S | team | function secret + Vault |
| `API_DB_PASSWORD` | S | team | role `haide_api` password → function secret `API_DB_URL` |
| `IP_HASH_SALT_SEED` | S | team | function secret |
| `DEPLOY_ENABLED` | V | owner at GATE 3 | deploy guard |
| `PROD_API_URL` | V | team after the first deploy (`https://<ref>.supabase.co/functions/v1/api/v1`) | keepalive, backup guard, web build |

### 4.2 Edge Function secrets (set by `deploy.yml` with `supabase secrets set`)

| Name | Value |
|---|---|
| `API_DB_URL` | `postgresql://haide_api.<ref>:<API_DB_PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres` (transaction pooler. Copy the exact host from Project Settings → Database → Connection pooling) |
| `CRON_SECRET` | from GitHub |
| `ROUTING_PROVIDER` | `ors` |
| `ORS_API_KEY` | from GitHub |
| `EMAIL_PROVIDER` | `brevo` |
| `BREVO_API_KEY` | from GitHub |
| `EMAIL_FROM` | `Haide <no-reply@haide.ro>` |
| `EMAIL_SUPPORT_TO` | `support@haide.ro` |
| `EMAIL_DAILY_CAP` | `280` |
| `APP_BASE_URL` | `https://haide.ro` |
| `CORS_ORIGINS` | `https://haide.ro,https://www.haide.ro` |
| `IP_HASH_SALT_SEED` | from GitHub |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | injected automatically by Supabase (used only for `auth.admin.deleteUser` and storage writes) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | E8 only (`mailto:support@haide.ro`) |

### 4.3 Web build (public, baked into the bundle)

| Name | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://<ref>.supabase.co/functions/v1/api/v1` |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key (safe to expose: the `app` schema has no grants for it) |
| `VITE_MAP_STYLE_URL` | empty = self-hosted PMTiles style. Fallback: `https://tiles.openfreemap.org/styles/positron` |
| `VITE_APP_VERSION` | git SHA (set by CI) |

### 4.4 Supabase Auth (in `supabase/config.toml`, pushed with `supabase config push`)

- Site URL `https://haide.ro`. Additional redirect URLs `https://haide.ro/auth/callback`, `https://www.haide.ro/auth/callback`.
- Email: magic link enabled, **OTP expiry 900 s**, confirm email on, secure email change on.
- External provider Google: `client_id = env(GOOGLE_CLIENT_ID)`, `secret = env(GOOGLE_CLIENT_SECRET)`.
- SMTP: host `smtp-relay.brevo.com`, port `587`, user `env(BREVO_SMTP_LOGIN)`, pass `env(BREVO_SMTP_KEY)`, sender `no-reply@haide.ro`, name `Haide`.
- Rate limit: emails sent 60/hour (raised from the default once custom SMTP is set).
- Email templates: magic link in English, matching copy.md.
- Data API: exposed schemas stay `public, graphql_public` only (**never add `app`**).

## 5. Deploy procedure

### 5.1 First deploy (after GATE 3 and §3 completed)

The release manager runs `deploy.yml` via **Actions → Deploy → Run workflow** (branch `main`). The owner taps **Approve** on the `production` environment prompt (GitHub mobile works). The workflow does:

1. `pnpm install --frozen-lockfile && pnpm build` (web, with §4.3 values).
2. `supabase link --project-ref $SUPABASE_PROJECT_REF` (uses `SUPABASE_DB_PASSWORD`).
3. `supabase db push` (all migrations, including extensions, roles, gazetteer load, energy prices v1, legal docs v1, cron schedules).
4. Role and Vault setup (idempotent SQL via `psql`): `ALTER ROLE haide_api PASSWORD …`, upsert Vault secrets `api_tick_url` (`<PROD_API_URL>/internal/tick`) and `cron_secret`.
5. `supabase config push` (auth settings from §4.4).
6. `supabase secrets set …` (§4.2), then `supabase functions deploy api --no-verify-jwt`.
7. `wrangler pages project create haide --production-branch main` (first run only, the step tolerates "already exists"), then `wrangler pages deploy apps/web/dist --project-name haide --branch main`.
8. Smoke: `curl -f $PROD_API_URL/health`, `curl -f https://haide.ro/find` (until DNS propagates, the `haide.pages.dev` URL).

Then, manually, once:
- **Custom domain:** Cloudflare → Workers & Pages → `haide` → Custom domains → add `haide.ro` and `www.haide.ro` (DNS records are created automatically since the zone is on Cloudflare).
- **Admin account:** the owner signs in once on `https://haide.ro`, then in Supabase → SQL Editor runs:
  `update app.profiles set role = 'admin' where id = (select id from auth.users where email = '<owner email>');`
- **Enable ops workflows:** set variable `PROD_API_URL` (activates `keepalive.yml` and `backup.yml`).

### 5.2 Launch verification checklist (qa-reviewer + owner, about 15 min on a phone)

1. `https://haide.ro` loads, installs to the home screen (Android Chrome + iOS Safari), and the map shows Sibiu.
2. Sign in with Google works. Magic link arrives within 1 min (check spam), works once, and expires after 15 min.
3. Consent → profile → car → publish a test ride (price table matches pricing.md for a known trip).
4. A second account searches, requests, and the driver gets the email. Approve → passenger sees phone and plate. Cancel → email.
5. `/admin` shows metrics and ops (DB size, emails today).
6. Delete both test accounts. Their profiles show "Deleted user".
7. Supabase → Database → Cron: `tick`, `complete-rides` and `retention` show successful runs.
8. Next morning: a `backup` artifact exists. Do a test restore into the local stack (`age -d -i haide-backup.key dump.sql.age | psql <local>`).

### 5.3 Routine deploys

Every merge to `main` triggers `deploy.yml`. It waits for the owner's approval on `production`, then runs steps 1–3 and 5–8 (skips role setup unless secrets changed). Migrations are forward-only.

### 5.4 Rollback

| Layer | How |
|---|---|
| Web | Cloudflare → Pages → `haide` → Deployments → previous → **Rollback** (instant) |
| API function | Actions → Deploy → Run workflow on the previous commit SHA (function-only input `only=function`) |
| Database | Forward-fix migration (preferred). Disaster: restore the latest `backup` artifact (`age -d … \| psql`) into a fresh project, then repoint secrets |

## 6. Operations

| Task | Frequency | How |
|---|---|---|
| Energy price check (pricing §3 update rule) | Monthly, or when the national average moves > 3 % | Admin → Energy prices (E7-4). Before E7: an SQL insert into `app.energy_prices` (new row, never update) |
| Quota check | Monthly | Supabase → Usage (egress, invocations, DB size). Admin ops tile (emails/day, ORS/day) |
| Map tiles and gazetteer refresh | Quarterly | `scripts/geo/build-tiles.sh`, `scripts/geo/build-gazetteer.ts` → PR |
| Suspend a user (before E7 UI) | On report | SQL Editor: `select app.admin_suspend_user('<uuid>', '<reason>');` |
| Data export request (E6-4) | On request (≤ 30 days) | Admin → user → Export, then email the JSON from `privacy@haide.ro` |
| Breach | On incident | DPIA §7: contain, assess, notify ANSPDCP within 72 h if risk |
| Backup restore drill | Quarterly | §5.2 step 8 |
