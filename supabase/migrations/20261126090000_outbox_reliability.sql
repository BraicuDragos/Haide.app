-- Outbox reliability (docs/architecture/notifications.md, improvements item 7).
-- Forward-only, additive, no backfill: existing rows keep NULL in both new columns.
--   app.outbox.provider_message_id  the provider's id for a sent email (Brevo messageId), to trace a row in
--                                   Brevo's Transactional logs. Never an address.
--   app.outbox.dedupe_key           template + natural id of the event (see outboxDedupeKey in
--                                   _shared/domain/outbox.ts, the only place it is derived). NULL = never deduplicate.
--   outbox_dedupe_uniq              partial UNIQUE index on (user_id, channel, dedupe_key) where dedupe_key is not null.
--                                   Inserts use ON CONFLICT DO NOTHING, so the same event enqueued twice is one row.
-- No new function, so there is no EXECUTE to revoke. app.run_retention is unchanged: it deletes finished
-- rows by status and age, and the key lives and dies with its row.
-- Checked: no existing row can violate the index (every existing dedupe_key is NULL).

alter table app.outbox
  add column if not exists provider_message_id text,
  add column if not exists dedupe_key text;

create unique index if not exists outbox_dedupe_uniq
  on app.outbox (user_id, channel, dedupe_key)
  where dedupe_key is not null;

comment on column app.outbox.provider_message_id is
  'Provider id of the sent message (Brevo messageId). Not personal data on its own; never an address.';
comment on column app.outbox.dedupe_key is
  'template:naturalId. Unique per (user_id, channel) when set; NULL for events that may repeat.';
