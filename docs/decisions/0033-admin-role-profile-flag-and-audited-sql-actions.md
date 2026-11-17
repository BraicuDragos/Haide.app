# 0033. Admin role: a profile flag granted by SQL, an admin area inside the same PWA, every write through an audited SQL function

- **Status:** Proposed
- **Date:** 2026-11-17
- **Area:** Architecture
- **Agent:** software-architect

## Context
E7-2 to E7-4 need a protected area for one or two people (the owner and a maintainer) to read metrics, triage reports, suspend or unsuspend users and add energy prices. E5 already has `profiles.role ∈ {user, admin}`, a `requireAdmin` gate, the append-only `admin_actions` table and the SQL functions `admin_suspend_user` / `admin_unsuspend_user`. Suspension restricts an account on a hosting service, so the user is owed a statement of reasons (DSA Art. 17). Budget: no extra hosting, no new auth provider, initial JS ≤ 200 KB gzip.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. `profiles.role = 'admin'` set only by SQL; `requireAdmin` re-reads the role from the database on every request; `/admin/*` lazy routes in the same PWA; each write is one SQL function that also inserts `admin_actions` | Reuses E1/E5 pieces; role changes apply on the next request (no stale token); one deploy; the admin chunk never loads for users | An admin account is as strong as its email sign-in (no MFA in the MVP) | Low |
| B. No admin UI: owner keeps using the Supabase SQL editor | Zero code | No attribution (`admin_id` NULL), easy to skip the audit or the notification, not usable from a phone, metrics need hand-written SQL | Very low, high operational risk |
| C. Separate admin app with a JWT custom claim (`app_metadata.role`) | Strong isolation, could add MFA from the start | Second deploy and CORS origin; claims stay stale until the token refreshes; more code for 2 users | Medium |

## Decision
Option A. No endpoint can grant or revoke the admin role. An admin cannot suspend themselves. Every admin write (`dismiss_report`, `suspend`, `unsuspend`, `energy_price_added`) inserts one `admin_actions` row with `admin_id` in the same transaction, and suspension and reinstatement queue an email to the user with the ground, the admin's statement and how to appeal (reply to support). Admin responses never contain phone numbers, plates, exact coordinates or emails; the report snapshot phone stays reachable only through the SQL editor for police requests.

## Consequences
- Positive: smallest change that gives attribution, a full audit trail and DSA-style notices; works on the owner's phone.
- Negative / accepted risks: no MFA on admin accounts (mitigated: role granted to at most two accounts, magic-link sessions, every action audited and reversible); the admin area shares the PWA's CSP and bundle (lazy chunk, budget checked in CI).
- Revisit if: more than two admins, a moderation volume that needs roles (viewer vs moderator), or a security incident; then add Supabase TOTP MFA and require `aal2` in `requireAdmin`.

## Sources
- [Regulation (EU) 2022/2065 (DSA), Art. 17 statement of reasons](https://eur-lex.europa.eu/eli/reg/2022/2065/oj)
- [Supabase Auth: multi-factor authentication](https://supabase.com/docs/guides/auth/auth-mfa)
- Spec: `docs/architecture/e7-metrics-admin-spec.md` §3, §5. Related: ADR 0027 (suspension flag and sweep), 0031 (export stays SQL-only)
