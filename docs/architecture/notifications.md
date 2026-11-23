# Notifications: who is told what, and how to check that mail arrives

Status: written with improvements item 7 ("Emails are not reaching passengers"). Related: ADR 0022 (outbox, tick, Brevo), ADR 0037 and 0038 (auto-accept, push), `docs/architecture/improvements-analysis.md` section 7.

Honesty rules for this document: **verified** means read in the code on this branch or covered by a test. **Hypothesis** means a likely explanation that nobody has confirmed against production. Nothing here was run against production, and the SQL below and the migration were not run locally (no Postgres in the authoring environment).

## 1. Pipeline in one paragraph

A state change inserts rows into `app.outbox` in the same transaction (`insertOutboxRows`, `api/repo/outbox.ts`). One email row per event, plus a `push` row for the lifecycle templates when the recipient has a push subscription. `pg_cron` runs `app.call_tick()` every minute, which POSTs `/internal/tick` through `pg_net` using two Vault secrets (`api_tick_url`, `cron_secret`); if either is missing `call_tick()` returns silently and nothing is ever sent. The tick (`api/services/tick.ts`) runs `dispatchOutbox` (`_shared/notify/dispatch.ts`): claim up to 50 rows with a 5 minute lease, resolve addresses with `app.outbox_recipients()` (active profiles with an auth email), send through Brevo, then mark the row `sent` (with the Brevo `messageId`), reschedule it with backoff (1, 2, 4, 8 minutes, 5 attempts) or mark it `failed` with a reason in `last_error`.

**Delivery guarantee: at-least-once, not exactly-once.** Enqueue is idempotent (see section 5), but a crash between the Brevo call and `markSent` leaves the row `pending`; after the 5 minute lease expires the next tick sends it again. Brevo's transactional API has no idempotency key, so this window can be narrowed but not closed. A rare duplicate email is the accepted trade-off (ADR 0022).

## 2. Event to recipient matrix

Every template that exists (`OUTBOX_TEMPLATES`). "Push" means a `push` row is also written when the recipient has a subscription (`PUSH_TEMPLATES`, ADR 0038); `ride_alert_match` is push-first (one row, email only when there is no subscription or the push finally failed).

| Template | Event | Trigger code | Recipient | Channels |
|---|---|---|---|---|
| `booking_requested` | passenger requests a seat on a ride that needs approval | `api/services/bookings.ts` `createBooking` | the driver | email + push |
| `booking_confirmed` | driver approves a request | `bookings.ts` `approveBooking` | the passenger | email + push |
| `booking_confirmed` | **auto-accept**: the request was confirmed on creation | `bookings.ts` `createBooking` (added in item 7) | the passenger | email + push |
| `booking_auto_confirmed` | auto-accept confirmed a request | `bookings.ts` `createBooking` | the driver (instead of `booking_requested`) | email + push |
| `booking_rejected` | driver rejects a request | `bookings.ts` `rejectBookingRequest` | the passenger | email + push |
| `booking_rejected` | a block makes the system cancel the passenger's booking | `api/services/cancellations.ts` `systemCancelBookingTx` (`blocked_by_driver`) | the passenger | email + push |
| `booking_expired` | a request was not answered in time | `api/services/tick.ts` step 1 (`app.expire_requests`) | the passenger | email + push |
| `ride_cancelled` | driver cancels the ride, or the system sweeps a suspended driver's ride | `cancellations.ts` `cancelRideTx` | EACH passenger with a requested or confirmed booking (one row per booking) | email + push |
| `booking_cancelled` | passenger cancels a **confirmed** booking | `bookings.ts` `cancelBooking`, and `cancellations.ts` `systemCancelBookingTx` | the driver | email + push |
| `booking_cancelled` | passenger withdraws a **requested** (not confirmed) booking | none, by ADR 0022 | nobody (in-app update only) | none |
| `rating_prompt` | ride completed (2 h after departure) | `api/services/safety.ts` `completeFinishedRides` (tick step 2) | each passenger with a completed booking | email |
| `rating_prompt_driver` | same, once per completed ride | `safety.ts` `completeFinishedRides` | the driver | email |
| `no_show_reported` | one party reports the other as absent | `safety.ts` (about l.92) | the party who did not show | email |
| `report_received` | a user files a report | `safety.ts` (about l.180) | each active admin | email |
| `data_export_requested` | user asks for a copy of their data | `api/services/dataRequests.ts` | the support mailbox (`EMAIL_SUPPORT_TO`), not the requester | email |
| `data_export_ack` | same | `dataRequests.ts` | the requester, even if suspended | email |
| `account_suspended` | admin suspends a user | `api/services/admin.ts` (about l.224) | the suspended user (sent although suspended) | email |
| `account_reinstated` | admin reinstates a user | `admin.ts` (about l.249) | the user | email |
| `ride_alert_match` | a new ride matches a saved alert | `api/services/alerts.ts` (tick step 4) | the alert owner | push first, email fallback |
| price drop on a booking | n/a | n/a | in-app badge only, by ADR 0022 | none |
| `ride_updated` | driver moves the departure of a published ride (ADR 0041) | `api/services/rides.ts` `editRide` | EACH passenger with a requested or confirmed booking (one row per booking, their own areas) | email + push |
| ride seats, note or auto-accept changed | n/a | `editRide` | nobody (in-app only) | none |

**Ride edits (ADR 0041, `PATCH /rides/{id}`).** A driver may change the departure time, seats, note and auto-accept of a published ride that has not departed; the route, price and vehicle are fixed (to change them the driver cancels and publishes again). Only a **change of departure time** notifies anyone: in the same transaction, under the ride lock, `editRide` writes one `ride_updated` row per requested or confirmed booking (payload: `bookingId`, `rideId`, `driverFirstName`, `previousDepartureAt`, `departureAt`, the passenger's own `pickupArea` and `dropoffArea`; ids, times, a first name and area labels only). The mail says "Now leaving at {time} (was {previous}). Open Haide to check it still suits you, or cancel your seat." and links to `/booking/{id}`; the push (title "Ride time changed", TTL 1 h, tag `ride_updated:{bookingId}`) never carries the driver's name. The booking stays as it is: a confirmed seat keeps its seat and price, an open request is clamped so it cannot outlive the new departure (`expires_at = least(expires_at, departure - 10 min)`), and each booking is flagged unseen for its passenger. Dedupe key: `ride_updated:{bookingId}:{new departureAt}`, so a retry is one row and a second, different move is a new notification. Moving a ride to the time it already has, or editing seats, note or auto-accept, writes no outbox row. Cancelled, rejected, expired and completed bookings and the driver are never told.

Tests: `_shared/notify/events.test.ts` proves the recipient and template for every row above using the real builders, dispatcher and templates with a fake provider. `api/bookings.test.ts`, `api/tick.test.ts` and `api/safety.test.ts` prove that each service call queues the right row for the right user.

## 3. Why a passenger may not get mail

**Verified by code:**

1. **Auto-accepted bookings emailed only the driver.** `createBooking` queued `booking_auto_confirmed` to the driver and nothing to the passenger. Fixed in item 7: the passenger now also gets `booking_confirmed`, built the same way as on approve. This is a real passenger-side gap, but it only affects auto-accept rides.
2. **Failures were half visible.** A recipient miss was stored as the bare `no_recipient`; a render exception only as the exception name; the `outbox_failed` log line did not carry the error; the Brevo `messageId` was not kept, so a row could not be found in Brevo's logs. Fixed: reasons `no_recipient:inactive_or_no_email` and `no_recipient:support_address_unset`, `render_failed:...` and `provider_threw:...` with a scrubbed message, an `outbox_failed` log with the error and an `outbox_sent` log with template, hashed user ref and `messageId` (never the address), and `app.outbox.provider_message_id`.
3. **A suspended or deleted passenger gets nothing, by design**, except `account_suspended` and `data_export_ack`. The row ends `failed` with `no_recipient:inactive_or_no_email`.
4. **If a Vault secret is missing, nothing is sent at all** and nothing is logged by the API (the tick never arrives). Rows stay `pending`. Check this first.

**Hypothesis (not proven, listed by likelihood):**

1. **Sender and spam.** `EMAIL_FROM` is `Haide <...@gmail.com>` (`deploy.yml`, built from `SUPPORT_EMAIL`). Brevo cannot DKIM-sign or SPF-align for gmail.com, so receivers see a Gmail-looking sender from Brevo's servers and often junk it. The driver is the owner and knows the sender; a fresh passenger account does not. Look in Junk first. The lasting fix is a domain you own authenticated in Brevo (`docs/architecture/email-sender.md`).
2. **Silent drops inside Brevo.** The API answers 201 even if Brevo later blocklists or soft-bounces the contact (earlier hard bounce, spam complaint, unsubscribed). Only Brevo's Transactional logs show it. Our `sent` status means "Brevo accepted it", not "it was delivered".
3. **Quota.** Free plan: 300 mails a day. `EMAIL_DAILY_CAP=280` stops sending for the UTC day and leaves rows `pending`. Auth magic-link mail on the same Brevo account counts against the 300 too.
4. **The passenger has no email on the auth user** (a phone-only or broken account). Query (c4) below counts these without printing addresses.

## 4. Read-only SQL diagnostics (Supabase SQL editor)

All queries only read. None prints an email address. Replace nothing.

```sql
-- (c1) Outbox status by template, last 7 days, email channel
select template, status, left(coalesce(last_error, ''), 60) as last_error, count(*) as n
from app.outbox
where channel = 'email' and created_at > now() - interval '7 days'
group by 1, 2, 3
order by template, status, n desc;

-- (c2) Failures by reason, last 7 days (the reason text is scrubbed of addresses)
select split_part(coalesce(last_error, 'none'), ' ', 1) as reason, template, count(*) as n
from app.outbox
where channel = 'email' and status = 'failed' and created_at > now() - interval '7 days'
group by 1, 2
order by n desc;

-- (c3) Pending for more than 10 minutes: should be empty. If not, the tick is not running or the cap was hit.
select template, attempts, send_after, created_at, left(coalesce(last_error, ''), 80) as last_error
from app.outbox
where channel = 'email' and status = 'pending' and created_at < now() - interval '10 minutes'
order by created_at
limit 50;

-- (c4) Accounts that cannot receive mail: a profile whose auth user has no email. Counts only.
select
  count(*) filter (where u.id is null) as profile_without_auth_user,
  count(*) filter (where u.id is not null and (u.email is null or u.email = '')) as auth_user_without_email,
  count(*) filter (where p.status <> 'active') as not_active
from app.profiles p
left join auth.users u on u.id = p.id;

-- (c5) Sent mail you can trace in Brevo: the message ids of the last 20 sent rows (no addresses).
-- provider_message_id is empty for rows sent before this migration and for EMAIL_PROVIDER=console.
select sent_at, template, provider_message_id
from app.outbox
where channel = 'email' and status = 'sent'
order by sent_at desc
limit 20;

-- (c6) Vault secrets that the tick needs: NAMES ONLY, never values. Both rows must be present.
select name from vault.secrets where name in ('api_tick_url', 'cron_secret') order by name;

-- (c7) The last cron runs of the tick job: status should be 'succeeded' about once a minute.
select j.jobname, d.status, d.start_time, left(coalesce(d.return_message, ''), 80) as message
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname = 'haide-tick'
order by d.start_time desc
limit 10;
```

Reading the results: (c1) many `pending` and no `sent` means the tick is not delivering (check c6, c7). Many `failed` with `brevo:4xx` means a sender or key problem. `sent` for the passenger's template but no mail in the inbox points to spam or Brevo (section 6). `no_recipient:inactive_or_no_email` rows point to an account problem (c4).

## 5. Idempotent enqueue (migration `20261126090000_outbox_reliability.sql`)

`app.outbox` gets `provider_message_id text`, `dedupe_key text` and a partial unique index `outbox_dedupe_uniq` on `(user_id, channel, dedupe_key) where dedupe_key is not null`. Every insert uses `on conflict ... do nothing`, so the same event enqueued twice is one row per channel. The key is derived in ONE function, `outboxDedupeKey` (`_shared/domain/outbox.ts`): the template plus the natural id (`bookingId`; `rideId` for `rating_prompt_driver`; `bookingId` and reporter role for `no_show_reported`; `reportId`; `requestId`; `alertId` and `rideId`; `bookingId` and the new `departureAt` for `ride_updated`). `account_suspended` and `account_reinstated` have no key because they can legitimately repeat. Existing rows keep `null` in both columns (no backfill). `app.run_retention()` is unchanged: it deletes finished rows older than 30 days and the key goes with the row. After deletion the same event could in theory be enqueued again, which cannot happen in practice because events are tied to bookings and rides that are no longer actionable by then. The migration adds no function, so there is no EXECUTE to revoke.

## 6. Manual two-account test (what to do, what to look for)

Use two real inboxes you control (driver A, passenger B, for example two Gmail accounts). Run these on the live site with a ride about two hours or more ahead, and wait up to 2 minutes after each step (the tick runs every minute). After each step check: inbox, Junk or Spam folder, and in Brevo the Transactional logs.

| Step | Do | Expected mail |
|---|---|---|
| 1 | B requests a seat on A's ride (approval required) | A: "new request" |
| 2 | A approves | B: booking confirmed |
| 3 | B cancels the confirmed booking | A: booking cancelled |
| 4 | B requests again, A rejects | B: request declined |
| 5 | B requests, nobody answers until it expires (or lower the wait in a test ride close to departure) | B: request expired |
| 6 | B requests a second ride, then A cancels that ride | B: ride cancelled (and every other booked passenger) |
| 7 | A publishes a ride with auto-accept on, B requests it | A: auto-confirmed notice; **B: booking confirmed** (new) |
| 8 | B withdraws a request that is still pending | nobody (by design) |
| 9 | B has a seat (requested or confirmed) on a ride of A. A edits the ride and moves the departure by at least an hour (`PATCH /rides/{id}` or the edit screen) | B: "ride time changed" (mail and push) with the new and the old time. A gets nothing |
| 10 | A edits only the note, the seats or auto-accept of that ride | nobody |

What to look for: the subject and the sender name ("Haide"), the button link opening the right page, the mail landing in Inbox rather than Junk, and in Brevo (Transactional, Logs) one entry per mail with status "Delivered" (or "Soft bounce", "Blocked", "Deferred"). If a mail is missing, run (c1) and (c5) right after: a `sent` row with a `provider_message_id` means Brevo accepted it, so search that id in Brevo.

## 7. What only the owner can do

1. **Brevo, Transactional, Logs:** search the passenger's address. "Delivered" and still missing means spam or the recipient's mail server; "Blocked", "Hard bounce" or "Unsubscribed" means Brevo suppressed it.
2. **Brevo, Contacts, Blocklisted:** check the passenger's address is not on the blocklist; remove it if it is.
3. **Brevo, Senders, Domains and IPs:** confirm the sender in `EMAIL_FROM` is verified. Check the "authenticated" status; a gmail.com sender is never authenticated (see section 3, hypothesis 1).
4. **Ask the passenger to check Junk or Spam**, and to mark "Not spam" so later mail lands in the Inbox.
5. **Brevo quota:** check today's usage against the 300 mails a day on the free plan, including magic-link mail.
6. **Confirm the Vault secrets** `api_tick_url` and `cron_secret` exist (query c6) and that the cron job is succeeding (c7). The values must never be pasted anywhere.
7. **Optionally set `EMAIL_REPLY_TO`** (a Supabase secret or the deploy variable) to a monitored support address so replies reach you; `EMAIL_FROM` stays the single sender variable.
