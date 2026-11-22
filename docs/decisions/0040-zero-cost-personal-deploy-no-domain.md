# 0040. Zero-cost personal deploy: no custom domain, single-sender mail, OAuth in Testing mode

- **Status:** Accepted (owner request, GATE 3 preparation)
- **Date:** 2026-11-22
- **Area:** Architecture / Ops
- **Agent:** Orchestrator

## Context
Haide is a personal learning project: no app stores, no money, invite-only friends and test users. deploy.md assumed a `haide.ro` domain (about 50-100 RON/year), Cloudflare Email Routing mailboxes and Brevo domain authentication.

## Options considered
| Option | Pros | Cons | Cost |
|---|---|---|---|
| A. Keep haide.ro | Real sender domain, clean mail deliverability | Costs money, domain research already showed `.ro`/`.app` taken | 50-100 RON/yr |
| B. `<project>.pages.dev` + `<ref>.supabase.co`, Brevo single sender (owner Gmail), Google OAuth Testing mode | 0 RON, HTTPS/PWA/push all work | Mail may land in spam, max 100 OAuth test users, longer URLs | 0 |

## Decision
Option B. `deploy.yml` derives `PAGES_URL` from the repo variable `PAGES_PROJECT` (default `haide`), uses it for Supabase `site_url`, redirect URLs, `APP_BASE_URL` and `CORS_ORIGINS`, and uses the owner's Gmail for `EMAIL_FROM`, `EMAIL_SUPPORT_TO`, SMTP `admin_email` and `VAPID_SUBJECT`. Legal documents v1.2 name the owner as a private individual and the Gmail as the single contact. Web push keys and the other generated secrets are created by the Orchestrator and stored as `production` environment secrets.

## Consequences
- Positive: no cost, no domain registration, same code paths.
- Negative / accepted risks: auth mails may be filtered as spam (a Gmail sender sent through Brevo); Google test-user cap; the app must stay invite-only and non-commercial (no payments, no advertising). A real launch would need a domain, a sender domain with SPF/DKIM/DMARC and a legal entity.
- Revisit if: the project goes beyond friends and test users.
