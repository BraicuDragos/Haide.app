-- Outbox reliability (migration 20261126090000): the two new columns, the partial unique index, ON CONFLICT DO NOTHING,
-- that NULL keys never collide, that email and push rows of one event coexist, and that run_retention still deletes
-- finished rows. NOT run locally when written (no Postgres in the authoring environment): CI runs it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-000000001201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ob1@example.com');

select has_column('app', 'outbox', 'provider_message_id', 'outbox.provider_message_id exists');
select has_column('app', 'outbox', 'dedupe_key', 'outbox.dedupe_key exists');
select ok(
  (select indisunique from pg_index where indexrelid = 'app.outbox_dedupe_uniq'::regclass),
  'outbox_dedupe_uniq is a unique index');
select ok(
  (select indpred is not null from pg_index where indexrelid = 'app.outbox_dedupe_uniq'::regclass),
  'outbox_dedupe_uniq is partial (where dedupe_key is not null)');

insert into app.outbox (user_id, template, payload, dedupe_key)
values ('00000000-0000-4000-8000-000000001201', 'booking_confirmed', '{}'::jsonb, 'booking_confirmed:b1');
insert into app.outbox (user_id, template, payload, dedupe_key)
values ('00000000-0000-4000-8000-000000001201', 'booking_confirmed', '{}'::jsonb, 'booking_confirmed:b1')
on conflict (user_id, channel, dedupe_key) where dedupe_key is not null do nothing;
select is((select count(*)::int from app.outbox where dedupe_key = 'booking_confirmed:b1'), 1,
  'the same event twice gives one row');

select throws_ok(
  $$insert into app.outbox (user_id, template, payload, dedupe_key)
    values ('00000000-0000-4000-8000-000000001201', 'booking_confirmed', '{}'::jsonb, 'booking_confirmed:b1')$$,
  '23505', null, 'without ON CONFLICT a duplicate key is rejected');

insert into app.outbox (user_id, channel, template, payload, dedupe_key)
values ('00000000-0000-4000-8000-000000001201', 'push', 'booking_confirmed', '{}'::jsonb, 'booking_confirmed:b1');
select is((select count(*)::int from app.outbox where dedupe_key = 'booking_confirmed:b1'), 2,
  'the email and the push row of one event coexist (the channel is part of the key)');

insert into app.outbox (user_id, template, payload) values
  ('00000000-0000-4000-8000-000000001201', 'account_reinstated', '{}'::jsonb),
  ('00000000-0000-4000-8000-000000001201', 'account_reinstated', '{}'::jsonb);
select is((select count(*)::int from app.outbox where template = 'account_reinstated'), 2,
  'NULL keys never collide (a reinstatement can repeat)');

-- run_retention is unchanged: a finished row older than 30 days is deleted, a pending one stays.
update app.outbox set status = 'sent', sent_at = now() - interval '40 days', created_at = now() - interval '40 days'
 where dedupe_key = 'booking_confirmed:b1' and channel = 'email';
create temp table retention_result as select app.run_retention() as counts;
select is((select count(*)::int from app.outbox where dedupe_key = 'booking_confirmed:b1' and channel = 'email'), 0,
  'run_retention still deletes finished rows (the key goes with the row)');
select is((select count(*)::int from app.outbox where dedupe_key = 'booking_confirmed:b1' and channel = 'push'), 1,
  'a pending row survives run_retention');

select * from finish();
rollback;
