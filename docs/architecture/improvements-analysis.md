# Analysis: seven improvements (written before any code)

Status: analysis only. Findings come from reading the code on `main` (33d44c4). Nothing was run against production, so every statement about production behaviour is a hypothesis, marked as such.

## Order of work

Bugs first (7, 4), then the data-backed items (5, 6), then the UI items (1, 2, 3). One commit per item, one PR.

## 7. Emails not reaching passengers (bug)

**Pipeline.** A state change inserts rows into `app.outbox` in the same transaction (`insertOutboxRows`, `api/repo/outbox.ts`). `pg_cron` calls `call_tick()` every minute, which POSTs `/internal/tick` through `pg_net` using two Vault secrets. The tick runs `dispatchOutbox` (`_shared/notify/dispatch.ts`): claim up to 50 rows with a 5 minute lease, look up the address through `app.outbox_recipients()` (active profiles with a non-null `auth.users.email`), send through Brevo, mark `sent`, reschedule with backoff (up to 5 attempts) or mark `failed`. If either Vault secret is missing, `call_tick()` returns silently and nothing is ever sent.

**Findings (verified by reading code):**

1. **Auto-accepted bookings send the passenger nothing.** `createBooking` (`api/services/bookings.ts` ~l.233) queues `booking_auto_confirmed` to the _driver_ only. The passenger who was just confirmed gets no email. This is a real passenger-side gap.
2. **No event exists for "ride details changed".** There is no ride edit endpoint (`api/routes/rides.ts` has publish, preview, list, view, cancel only), so nothing can fire. This needs a product decision, see "Needs your input".
3. **Failures are only half visible.** `last_error` is stored, but a recipient miss is stored as the bare string `no_recipient` (no reason), a render exception is stored as the exception _name_ only, the log line `outbox_failed` does not carry the error, and the Brevo `messageId` is not kept, so a row cannot be traced in Brevo's logs.
4. **No enqueue idempotency.** Nothing prevents two rows for the same event. Sending is at-least-once: a crash between the Brevo call and `markSent` re-sends after the lease expires (5 min). Brevo's transactional API has no idempotency key, so this window cannot be closed fully, only narrowed. Will be stated honestly.
5. **Passenger recipient rules are fine in code.** `outbox_recipients` uses the auth email; sign-in is magic link or Google, so the address is non-null for normal accounts. A passenger whose profile is not `active` (suspended) is skipped by design. Not the likely cause.

**Why passengers specifically (likely, not proven):**

- **Sender / spam (most likely).** `EMAIL_FROM` is `Haide <dragosbraicu9@gmail.com>` (`deploy.yml`, from `SUPPORT_EMAIL`). Mail claiming `@gmail.com` but sent from Brevo's servers cannot be DKIM-signed or SPF-aligned for gmail.com, so Brevo rewrites the envelope to its shared `brevosend.com` domain. Receivers see a Gmail-looking sender from a different domain and commonly junk it. The driver is the owner, who already knows the sender; a fresh passenger account does not. Check the Junk folder first.
- **Brevo-side silent drops.** The API answers 201 even when Brevo later blocklists or soft-bounces a contact (earlier hard bounce, spam complaint). Only Brevo's Transactional logs show this.
- **Free plan limits.** 300 mails/day; `EMAIL_DAILY_CAP=280` guards it. Auth magic-link mails use the same Brevo account and count too.

**Approach:** fix finding 1; add `dedupe_key` (unique partial index, `on conflict do nothing`), `provider_message_id`, structured reasons in `last_error`, error text in logs; add the event-to-recipient matrix and one test per event with the provider mocked; write SQL diagnostics the owner can run. **Risk:** one small migration (two nullable columns plus a partial unique index on `app.outbox`; no backfill, low risk, existing rows keep `null`).

## 6. Branded emails and sender address

**Current:** `renderEmail` returns a bare `<p>` and a plain link, one footer line, no layout, no logo. The Brevo provider sends `sender` and no `replyTo`.

**Why the sender looks like `…@12885302.brevosend.com`:** see finding "Sender / spam" above. It is Brevo's behaviour for free-mail senders, not a bug in Haide. It cannot be removed without a domain you own with SPF, DKIM and DMARC records authenticated in Brevo.

**Approach:** one shared layout (`_shared/notify/emailLayout.ts`): table-based, inline styles, 600 px max, wordmark header in brand colours (no image: Gmail blocks SVG, and the templates promise no remote images), title, body, bulletproof button (padded `<td>` plus `<a>`, with an Outlook VML fallback), footer (support contact, why you got this, controller placeholder), `color-scheme` meta and a dark-mode media query, explicit card colours so forced dark-mode inversion stays readable. Plain-text alternative kept. Preview script `scripts/email-preview.ts` writes every template to `tmp/email-preview/`. Sender: `EMAIL_FROM` stays the single variable for the address, new `EMAIL_REPLY_TO`, display name "Haide" is already used; `docs/architecture/email-sender.md` gets the exact steps to move to a domain. **Risk:** HTML email can only be partly verified locally (no Gmail or Apple Mail here), see the checklist in the PR.

## 4. Popular routes

**Current:** `FindScreen.tsx` hard-codes three corridors by place name. A tap resolves both names through the gazetteer search and fills From/To, then focuses the time field. It does not search, so on a phone the only visible change can be small, and a failed name lookup shows an error. Hypothesis for "nothing happens": no navigation to results, and name-based lookup. Not reproducible against production from here.

**Definition of popular (to be stated in the PR):** rides with `departure_at` from 30 days ago to 14 days ahead, status `published` or `completed` (cancelled excluded), grouped by (`origin_area_id`, `destination_area_id`), both known and different. Score = rides + bookings in `confirmed`/`completed`. Ties: more rides, then name. A route is shown only if at least 2 different drivers published it, so a single person's pattern is never exposed. Top 5.

**Fallback:** if fewer than 3 routes qualify, fill up with the curated Sibiu pilot corridors (`CURATED_PILOT_ROUTES`, marked `source: "curated"` in code and in the response, and not shown as "popular" counts).

**Approach:** SQL function `app.popular_routes(p_now, p_limit)` (STABLE, `PUBLIC` revoked) plus a supporting index on `rides (origin_area_id, destination_area_id, departure_at)`; public `GET /popular-routes` with a rate limit and a 5 minute cache header; the response carries gazetteer places (area centroid) for both ends, so the tap needs no name lookup. A tap writes the search criteria (today, next free 5 minute slot, ±60 min) and opens the results. States: loading, error with retry, empty. Tests: ranking query rules (SQL integration and pure fallback logic), and the click behaviour in the web unit tests. **Assumption to confirm:** a tap goes straight to results with a default time. **Risk:** low; one additive migration.

## 5. My rides: canceled rides

**Current:** Cancelled rides and bookings appear only mixed into "Past" (`r.status <> 'published'`, bookings `NOT (requested/confirmed and future)`). Bookings store `cancelled_by` (`passenger`/`driver`/`system`); rides do not store who cancelled; no cancel reason exists anywhere.

**Approach:** a third tab "Canceled" next to Upcoming and Past, scope `cancelled` on `GET /me/rides` and `GET /me/bookings`; Past no longer contains cancelled items. Migration adds `rides.cancelled_by` (`driver`/`system`, nullable; old rows read as driver). Cards show a status badge, date and time, route, "Canceled by you / the driver / Haide". **Reasons:** none are stored, so none are shown; capturing one needs a new field in the cancel sheet and the contract, which I will not invent unasked.

**RLS:** the app tables have RLS enabled with no policies and the API role bypasses it, so isolation is enforced by `driver_id = $me` / `passenger_id = $me` in every query. Tests: unit tests for the scope filter, a pgTAP check for the column and constraint, and an integration test with two accounts proving neither sees the other's cancelled rides. **Risk:** low; additive nullable column. The integration test needs the local stack and runs in CI only.

## 1. Home line follows a fictional road

**Current:** `RouteArt.tsx` draws one cubic Bézier between two points measured in pixels (`motion/geometry.ts`), animated by the shared `RouteOverlay` (stroke-dashoffset draw-in, travelling lights, reduced-motion handled by `lib/prefs.ts`).

**Approach:** replace the curve with a road-like path (straight runs, rounded turns, one small junction with a side street) defined in a fixed logical grid and fitted into the measured box with one uniform scale (no distortion), plus faint side streets in the same grid. `RouteOverlay` and its animation, tokens and reduced-motion logic stay untouched; the container keeps its fixed height, so no layout shift. **Risk:** the shared overlay also draws real maps, so the new path is passed in as data only.

## 2. Profile photo crop

**Current:** a hidden file input, `preparePhoto` (EXIF via `createImageBitmap`, longest side 1024 px, JPEG), upload on form submit through `PUT /me/photo`; the server centre-crops to 512 px. No crop UI, no image dependency.

**Choice:** a small custom canvas cropper, no new dependency. Reasons: zero added bundle (it lives in the already lazy `ProfileForm` chunk), pointer events cover touch and mouse, and I control keyboard access and tokens. A library would add weight and its own styling for a single dialog. Output: 512 × 512 JPEG, quality 0.85 (matches the server's `AVATAR_SIZE_PX`, so the server does no further resampling). Large photos are decoded once with a capped size so the main thread is not blocked. Cancel leaves the old photo. Unsupported files give a clear message. **Risk:** gesture handling on real phones cannot be verified here.

## 3. Custom time picker

**Current:** a native `type="time"` in `FindScreen` and `PublishForm`; value `HH:MM`; publish validates 15 minutes to 14 days ahead, search has no past-time check.

**Approach:** one shared `TimePicker` (`ui/TimePicker.tsx`): a labelled button opens the existing `Sheet` with hour and minute grids, 24-hour, 5 minute step (matches how rides are planned and keeps the grid at 12 buttons), `minTime` disables past slots for today, keyboard and screen-reader support, value stays `HH:MM`. Used in Find and Publish. `type="date"` fields are out of scope. **Risk:** the Playwright tests that `fill()` the time field must be updated.

## Needs your input (will be repeated in the PR)

1. **Ride details changed:** no edit feature exists. Should rides become editable (time and route), and who must be told? I will not build it unasked.
2. **Cancel reason:** none is stored. Do you want it captured?
3. **Popular route tap:** straight to results with a default time (my assumption), or fill the form only?
4. A withdrawn _request_ (never accepted) does not email the driver by design (ADR 0022). Keep?
