# 0031. Data access requests: in-app request by email, export by an admin-only SQL function

- **Status:** Proposed
- **Date:** 2026-11-17
- **Area:** Architecture
- **Agent:** software-architect

## Context
E6-4 (Should) asks for a "Request my data" button that emails the support address, and an admin JSON export. GDPR Art. 15 and 20 give one month to answer. The export contains exact locations, phone and email, so whoever can call it can read one user's full history. The MVP has no admin UI until E7, and the owner is the only admin.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Self-service `GET /me/export` (instant download) | Best UX, no manual work | A stolen session exfiltrates the full history in one call. Needs pagination, a size budget and a web download flow. Over-built for the expected handful of requests | Medium |
| B. `POST /me/data-export-request` (row + email to support + acknowledgement) and `app.export_user_data(uuid)` runnable only from the SQL editor | Minimal surface: the export is not reachable through the API role at all. The request is recorded with a due date. E7 can wrap the same function | Manual step for the owner (minutes per request). Answer is not instant | Low |
| C. B plus an admin endpoint `GET /admin/users/{id}/export` now | Ready for the E7 admin UI | A stolen admin token exports anyone. Needs audit logging that E7 designs anyway | Low-medium |

## Decision
Option B. The request is idempotent within 30 days, writes `app.data_requests`, sends `data_export_requested` to `EMAIL_SUPPORT_TO` and `data_export_ack` to the user. `app.export_user_data` is SECURITY DEFINER (it reads the auth email), with EXECUTE revoked from `haide_api` and every public role. It returns the user's own data only: reports about the user, counterparts' phones and points, and not-yet-visible ratings are excluded (rights of others, Art. 15(4)). The owner sends the JSON from `privacy@` to the account email (deploy.md runbook).

## Consequences
- Positive: no new data-exfiltration path through the API. Deadline tracking through `data_requests.fulfilled_at`.
- Negative / accepted risks: manual work and a reply measured in days. Replying only to the account email is the identity check.
- What would trigger revisiting: more than a few requests per month, or the E7 admin UI (add an audited admin endpoint calling the same function).

## Sources
- [GDPR Art. 12(3), 15 and 20](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [EDPB Guidelines 01/2022 on the right of access](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-012022-data-subject-rights-right-access_en)
- Spec: `docs/architecture/e6-privacy-spec.md` §5
