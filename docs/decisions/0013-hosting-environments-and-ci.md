# 0013. Hosting, environments and CI/CD: Cloudflare Pages + Supabase Free (Frankfurt) + Brevo, GitHub Actions with a gated deploy

- **Status:** Proposed
- **Date:** 2026-11-15
- **Area:** Infrastructure
- **Agent:** software-architect

## Context
The infra budget is 0 RON/month (review if it goes above 50 RON). The owner reviews from a phone and must approve the first deploy (GATE 3). Personal data should stay in the EU where possible (strategy P8). The team needs lint, typecheck and tests on every PR, plus reproducible deploys with no manual console work beyond a one-time setup. The Supabase Free plan has **no automatic backups** and keeps logs for 1 day.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. **Cloudflare Pages** (static PWA) + **Supabase Free, eu-central-1** + **Brevo** (email, EU) + **GitHub Actions** (CI, deploy, backups) | Pages: 500 builds/month, unlimited previews, custom domain, commercial use allowed. Supabase Frankfurt keeps data in the EU. Brevo is a French company with 300 emails/day free. Everything is scripted from Actions | Four accounts to create once. Backups are our job. The API lives on the `*.supabase.co` domain (a custom API domain is a paid add-on) | 0 RON/month + domain |
| B. Vercel Hobby + Supabase + Resend | Very smooth DX | Hobby plan is non-commercial only. Resend free is 100 emails/day, below our estimated peak | 0 now, risk later |
| C. One Oracle Cloud Always Free VM running Postgres/PostGIS, the API and the static site | Full control, no vendor quotas | We become sysadmins: patching, TLS, backups, uptime. Account creation needs a card. Single point of failure | 0 RON, high ops effort |

## Decision
Option A, with **two environments**:
1. **Local and CI**: an ephemeral Supabase stack via the Supabase CLI (Docker). Every PR runs it.
2. **Production**: one Supabase Free project `haide-prod` in Frankfurt, plus the Cloudflare Pages project `haide` on `haide.ro`.

No permanent staging in the MVP. It would be a second free project that pauses when idle, and the CI stack covers integration and E2E. **CI (`ci.yml`) on every PR**: lint, typecheck, unit tests with coverage, web build, `deno check` of the function, then a job that starts Supabase and runs pgTAP database tests, API integration tests and a Playwright mobile E2E smoke. **Deploy (`deploy.yml`)** runs migrations, deploys the function and uploads the web build with Wrangler. It is guarded twice: a repository variable `DEPLOY_ENABLED` (set only at GATE 3) and a GitHub Environment `production` that requires the owner's approval. **Backups (`backup.yml`)**: a nightly `pg_dump` of the `app` schema plus `auth.users`/`auth.identities`, encrypted with `age` (the owner holds the private key), stored as a 14-day Actions artifact. **Keep-alive (`keepalive.yml`)**: a twice-weekly `GET /health` so the free project never pauses before launch. Secrets live in GitHub Actions secrets and Supabase function secrets. Only public `VITE_*` values reach the browser. Support and privacy mailboxes use free **Cloudflare Email Routing** (`support@haide.ro`, `privacy@haide.ro` forwarded to the owner).

## Consequences
- Positive: 0 RON/month. Data at rest in the EU (Frankfurt) with EU email. Deploys are one approval tap on the phone. Backups exist despite the Free plan having none.
- Negative / accepted risks: Free-plan quotas need watching (the admin page shows DB size, email count and outbox backlog). The 1-day log retention limits forensics, so errors are persisted to our own `app_errors` table (14 days). If the repo is private, CI uses Actions minutes (about 2,000 Linux minutes/month included). We estimate about 500. Cloudflare's CDN processes visitor IPs globally (listed as a processor).
- What would trigger revisiting: Supabase egress above 4 GB/month or DB above 400 MB (move to Pro, 25 USD/month), emails above 250/day (Brevo paid tier or a second provider), or Actions minutes above 1,500/month (make the repo public or trim E2E).

## Sources
- [Supabase pricing, checked 2026-11-15](https://supabase.com/pricing)
- [Cloudflare Pages limits (500 builds/month, 20,000 files, 25 MiB per file), checked 2026-11-15](https://developers.cloudflare.com/pages/platform/limits/)
- [Brevo free SMTP (300 emails/day), checked 2026-11-15](https://www.brevo.com/free-smtp-server)
- [GitHub Actions billing (public repos free; Free plan includes 12 USD of compute, about 2,000 Linux minutes), checked 2026-11-15](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- Third-party summaries consulted for cross-checks: [temps.sh on Cloudflare Pages 2026](https://temps.sh/blog/cloudflare-pages-free-tier-limits-2026), [jetadmin on Supabase pricing 2026](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/)
