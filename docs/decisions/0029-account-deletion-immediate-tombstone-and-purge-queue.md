# 0029. Account deletion: immediate tombstone in one transaction, external purge retried by the tick

- **Status:** Proposed
- **Date:** 2026-11-17
- **Area:** Architecture
- **Agent:** software-architect

## Context
E6-1 requires that deleting an account cancels future rides and bookings with notifications, removes profile, photo, phone and vehicle from every view at once, and purges them within 30 days (strategy §9 P5/P6). Ratings must stay as "Deleted user" and safety reports for 12 months. Part of the work is in our database and part is in two outside systems that can fail independently: Supabase Storage (avatar object) and Supabase Auth (the auth user). Suspended users, blocks, concurrent requests and double taps must behave predictably.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Soft delete with a 30-day grace period (hidden, restorable), purge job at day 30 | Undo for mistakes, time for abuse review | Keeps full personal data 30 days. Needs a restore flow and a "pending deletion" state in every gate and query | Medium-high |
| B. One transaction: cascade cancellations + scrub to a tombstone; storage and auth deletion after commit, tracked in `account_deletions` and retried by the tick until done | Personal data gone from the DB at commit. All-or-nothing in our DB. External failures cannot leave half-scrubbed rows. Reuses the E5 cancellation services | Irreversible. Two external calls need a retry queue | Medium |
| C. Everything synchronous in the request, including storage and auth | Simplest code | A storage or auth outage fails or half-completes the deletion. No proof of completion | Low |

## Decision
Option B. `DELETE /me` locks the profile row, cancels future rides and bookings with `by = 'system'` (E5 services, the normal notifications), then calls `app.scrub_account` in the same transaction. After commit it removes the avatar object and the auth user; failures are retried by a tick step with backoff from `app.account_deletions`, and an open deletion older than 7 days raises an `app_errors` alarm. The route needs only authentication: suspended users and users who have not accepted new terms can delete, and a second call answers `204`. Reports about the user keep their `reported_snapshot`, phone included, until 12 months after the report (legitimate interest: the phone is the only stable identifier left after the tombstone scrub). The safety sweep treats `deleted` like `suspended` as a backstop for writes racing the deletion.

## Consequences
- Positive: one atomic DB step meets "removed from active views at once". The 30-day promise holds through retries. An auditable `account_deletions` row is kept for 3 years.
- Negative / accepted risks: no undo. A suspended user can delete and sign up again with a new email (a phone blocklist is out of scope). The phone disappears from a ride that departed but has not completed yet. Cached avatar copies live up to 7 days (upload `max-age` lowered from 1 year).
- What would trigger revisiting: frequent accidental deletions (add a grace period), evasion of suspensions through re-registration, or legal advice on the report snapshot.

## Sources
- [GDPR Art. 17 (right to erasure) and Art. 17(3)(e) (legal claims)](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [Supabase Auth Admin API: delete a user](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)
- Spec: `docs/architecture/e6-privacy-spec.md` §2
