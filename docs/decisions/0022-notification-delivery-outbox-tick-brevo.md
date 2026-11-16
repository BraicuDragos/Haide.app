# 0022. Notification delivery: transactional outbox, per-minute tick with leased claims, Brevo HTTP API

- **Status:** Proposed
- **Date:** 2026-11-16
- **Area:** Infrastructure
- **Agent:** software-architect

## Context
E4-6 requires booking emails within 2 minutes, with no exact addresses, phones or plates. ADR 0013 picked Brevo Free (300 emails a day, shared with nothing else because auth mail goes over SMTP and is never blocked by our cap). Architecture section 10 already fixes an `outbox` table filled in the same transaction as each state change. Still open: how `tick` claims rows without double-sending when two runs overlap, how it finds the recipient's email (the API role cannot read `auth.users`), retries, the daily cap, and which events are worth an email under a 300-a-day budget.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Outbox plus pg_cron every minute, which calls `POST /internal/tick` through pg_net. Claim with `FOR UPDATE SKIP LOCKED` and push `send_after` forward 5 minutes as a lease. Send through the Brevo HTTP API. Look up recipients with a `SECURITY DEFINER` SQL function. Daily cap of 280 | No new services. Overlapping ticks cannot send the same row twice inside the lease. One SQL call resolves all recipients. Free | At-least-once: a crash between the Brevo accept and `status = 'sent'` re-sends that one email after the lease | Low |
| B. Send email inline in the request handler, after commit | Lowest latency | Slows the user's request. A Brevo outage loses mail or fails the action. No retry, no cap accounting | Low, but fragile |
| C. Supabase Database Webhooks or a queue (pgmq) that triggers a separate sender function | Push-based, near-instant | One more function and trigger configuration. The cap and backoff logic is still needed. More moving parts for a small team | Medium |

## Decision
Option A. Tick runs every minute and dispatches at most 50 rows per run, 4 at a time. Retry backoff is 1, 2, 4 and 8 minutes. A row becomes `failed` after 5 attempts, or straight away on a permanent 4xx (but not 429) or when the recipient is missing or not active. Sending stops for the UTC day once 280 have been sent (`EMAIL_DAILY_CAP`), and unsent rows stay `pending`. Emails go out for: new request (to the driver), accepted, declined, expired and ride cancelled (to the passenger), and a cancelled **confirmed** booking (to the driver). A withdrawn request and a price drop do not get an email. They show as in-app updates only. That keeps the forecast well under the cap.

## Consequences
- Positive: delivery in about 1 minute. Users' actions never wait on Brevo. Quota is protected. Every send is auditable in `outbox`. Templates stay in TypeScript with i18n strings.
- Negative / accepted risks: rare duplicate emails (at-least-once). Fewer emails for price drops and withdrawn requests, which the in-app badge covers. Delivery depends on pg_cron and pg_net running on the free project, which the Ops tile (E7) and `/health` keepalive watch.
- What would trigger revisiting: more than 200 emails a day for a week (consider a digest or a paid tier), Brevo deliverability problems, or E8 web push (it reuses the same outbox with `channel = 'push'`).

## Sources
- [Brevo: send a transactional email (`POST /v3/smtp/email`, `api-key` header)](https://developers.brevo.com/docs/send-a-transactional-email)
- [Brevo email API, free plan 300 emails/day](https://www.brevo.com/features/email-api/)
- [Supabase: scheduling Edge Functions with pg_cron and pg_net](https://supabase.com/docs/guides/functions/schedule-functions)
- [PostgreSQL 17: SELECT … FOR UPDATE SKIP LOCKED](https://www.postgresql.org/docs/17/sql-select.html#SQL-FOR-UPDATE-SHARE)
- `docs/decisions/0013-hosting-environments-and-ci.md`, `docs/architecture/architecture.md` section 10
