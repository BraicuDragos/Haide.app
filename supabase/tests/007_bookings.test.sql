-- E4 bookings schema (e4-bookings-spec section 1): table, named constraints, indexes, the foreign keys that
-- were waiting for it, grants, app.expire_requests, app.outbox_recipients, app.call_tick and the cron job.
begin;
create extension if not exists pgtap with schema extensions;
select plan(78);

-- Fixtures ---------------------------------------------------------------------------------------------------------
-- d: the driver. p1, p2, p3: passengers (p3 is suspended later, for the recipient lookup).
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'driver@example.com'),
  ('00000000-0000-4000-8000-000000000702', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p1@example.com'),
  ('00000000-0000-4000-8000-000000000703', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p2@example.com'),
  ('00000000-0000-4000-8000-000000000704', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p3@example.com');
update app.profiles set first_name = 'Radu' where id = '00000000-0000-4000-8000-000000000701';

insert into app.rides (id, driver_id, origin, destination, origin_label, destination_label, route, distance_m,
                       duration_s, departure_at, seats_offered, energy_price_id, rate_micro_per_km, vehicle_snapshot)
values ('00000000-0000-4000-8000-0000000007a1', '00000000-0000-4000-8000-000000000701',
        ST_SetSRID(ST_MakePoint(24.151, 45.709), 4326), ST_SetSRID(ST_MakePoint(24.1505, 45.7977), 4326),
        'a', 'b', ST_GeomFromText('LINESTRING(24.151 45.709, 24.1861 45.7413, 24.1505 45.7977)', 4326),
        11514, 1020, '2026-11-20T05:40:00Z', 3,
        (select id from app.energy_prices where fuel_type = 'diesel'), 651000,
        '{"make":"Dacia","model":"Logan","colour":"Grey","plate":"SB12ABC","fuelType":"diesel"}'::jsonb);

-- One valid-by-default booking row; every argument can be overridden to break exactly one rule.
create function pg_temp.ins(
  p_id uuid, p_passenger uuid,
  p_status text default 'requested', p_expires timestamptz default '2026-11-16T06:00:00Z',
  p_key text default null, p_pf double precision default 0.2, p_df double precision default 0.9,
  p_seg integer default 4000, p_walk integer default 100, p_quoted integer default 180,
  p_locked integer default null, p_late boolean default false, p_decided timestamptz default null,
  p_cancelled_at timestamptz default null, p_cancelled_by text default null,
  p_ride uuid default '00000000-0000-4000-8000-0000000007a1')
returns void language sql as $$
  insert into app.bookings (id, ride_id, passenger_id, status, pickup, dropoff, pickup_label, dropoff_label,
    pickup_fraction, dropoff_fraction, segment_m, walk_pickup_m, walk_dropoff_m, price_quoted_bani,
    price_locked_bani, idempotency_key, requested_at, expires_at, decided_at, cancelled_at, cancelled_by,
    late_cancel)
  values (p_id, p_ride, p_passenger, p_status::app.booking_status,
    ST_SetSRID(ST_MakePoint(24.18, 45.74), 4326), ST_SetSRID(ST_MakePoint(24.15, 45.79), 4326),
    'Șelimbăr', 'Centru', p_pf, p_df, p_seg, p_walk, p_walk, p_quoted, p_locked, p_key,
    '2026-11-16T04:00:00Z', p_expires, p_decided, p_cancelled_at, p_cancelled_by, p_late)
$$;

-- b1: p1 requested, already past its expiry. b2: p2 requested, still open. b3: p3 confirmed, past the expiry time.
select pg_temp.ins('00000000-0000-4000-8000-0000000007b1', '00000000-0000-4000-8000-000000000702',
  p_expires => '2026-11-16T04:30:00Z', p_key => 'k1');
select pg_temp.ins('00000000-0000-4000-8000-0000000007b2', '00000000-0000-4000-8000-000000000703');
select pg_temp.ins('00000000-0000-4000-8000-0000000007b3', '00000000-0000-4000-8000-000000000704',
  p_status => 'confirmed', p_locked => 100, p_decided => '2026-11-16T04:05:00Z', p_expires => '2026-11-16T04:30:00Z');

-- Structure, RLS and grants (18) ------------------------------------------------------------------------------------
select has_table('app', 'bookings', 'bookings exists');

select has_column('app', 'bookings', c::name, 'bookings.' || c || ' exists')
  from unnest(array['id', 'ride_id', 'passenger_id', 'status', 'pickup', 'dropoff', 'pickup_fraction',
                    'dropoff_fraction', 'price_quoted_bani', 'price_locked_bani', 'expires_at',
                    'passenger_event_at']) c;

select ok((select relrowsecurity from pg_class where oid = 'app.bookings'::regclass),
  'bookings has row level security enabled');
select is(
  (select count(*) from pg_policy p where p.polrelid = 'app.bookings'::regclass),
  0::bigint, 'bookings has no RLS policies (deny-all)');
select ok(
  not has_table_privilege('anon', 'app.bookings', 'SELECT')
  and not has_table_privilege('authenticated', 'app.bookings', 'SELECT')
  and not has_table_privilege('anon', 'app.bookings', 'INSERT')
  and not has_table_privilege('authenticated', 'app.bookings', 'INSERT'),
  'bookings is unreachable for anon and authenticated');
select ok(has_table_privilege('haide_api', 'app.bookings', 'SELECT')
  and has_table_privilege('haide_api', 'app.bookings', 'INSERT')
  and has_table_privilege('haide_api', 'app.bookings', 'UPDATE'),
  'haide_api can read, insert and update bookings');
select ok(not has_table_privilege('haide_api', 'app.bookings', 'DELETE'),
  'haide_api cannot delete bookings (they are coarsened, never deleted)');

-- Named constraints (11) ----------------------------------------------------------------------------------------------
select ok(exists (select 1 from pg_constraint where conrelid = 'app.bookings'::regclass and conname = c),
  'constraint ' || c || ' exists')
  from unnest(array['bookings_fractions', 'bookings_segment_min', 'bookings_price_nonneg',
                    'bookings_lock_le_quote', 'bookings_final_le_lock', 'bookings_locked_when_confirmed',
                    'bookings_decided_has_time', 'bookings_cancelled_has_meta', 'bookings_late_only_cancelled',
                    'bookings_expiry_after_request', 'bookings_idempotency_uniq']) c;

-- Indexes (5) -----------------------------------------------------------------------------------------------------------
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'bookings_one_active_uidx'
    and indexdef ilike '%unique%' and indexdef ilike '%requested%' and indexdef ilike '%confirmed%'),
  'bookings_one_active_uidx is a unique partial index on requested and confirmed');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = i), 'index ' || i || ' exists')
  from unnest(array['bookings_ride_status_idx', 'bookings_passenger_idx', 'bookings_expiry_idx',
                    'bookings_coarsen_idx']) i;

-- Constraint behaviour (13) --------------------------------------------------------------------------------------------
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000007c1', '00000000-0000-4000-8000-000000000702',
  p_pf => 0.9, p_df => 0.5)$$, '23514', null, 'pickup must come before dropoff along the route');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000007c2', '00000000-0000-4000-8000-000000000702',
  p_seg => 999)$$, '23514', null, 'a segment is at least 1 km');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000007c3', '00000000-0000-4000-8000-000000000702',
  p_quoted => 100, p_locked => 200)$$, '23514', null, 'a locked price cannot exceed the quote');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000007c4', '00000000-0000-4000-8000-000000000702',
  p_status => 'confirmed', p_decided => '2026-11-16T04:05:00Z')$$, '23514', null,
  'a confirmed booking has a locked price');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000007c5', '00000000-0000-4000-8000-000000000702',
  p_status => 'cancelled')$$, '23514', null, 'a cancelled booking records when and by whom');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000007c6', '00000000-0000-4000-8000-000000000702',
  p_late => true)$$, '23514', null, 'only a cancelled booking can be a late cancellation');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000007c7', '00000000-0000-4000-8000-000000000702',
  p_expires => '2026-11-16T03:00:00Z')$$, '23514', null, 'a request expires after it was made');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000007c8', '00000000-0000-4000-8000-000000000702',
  p_walk => 801)$$, '23514', null, 'a walk is at most 800 m');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000007c9', '00000000-0000-4000-8000-000000000702',
  p_quoted => -1)$$, '23514', null, 'a price is not negative');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000007ca', '00000000-0000-4000-8000-000000000702',
  p_status => 'rejected')$$, '23514', null, 'a rejected booking has a decision time');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000007cb', '00000000-0000-4000-8000-000000000702')$$,
  '23505', null, 'a passenger has one live booking per ride (unique partial index)');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000007cc', '00000000-0000-4000-8000-000000000702',
  p_status => 'cancelled', p_cancelled_at => '2026-11-16T04:10:00Z', p_cancelled_by => 'passenger',
  p_key => 'k1')$$, '23505', null, 'an idempotency key is unique per passenger');
select lives_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000007cd', '00000000-0000-4000-8000-000000000702',
  p_status => 'cancelled', p_cancelled_at => '2026-11-16T04:10:00Z', p_cancelled_by => 'passenger',
  p_key => 'k2')$$, 'a cancelled booking does not block the one-live-booking rule');

-- Overbooking backstop (1) ------------------------------------------------------------------------------------------------
select throws_ok($$update app.rides set seats_booked = 4 where id = '00000000-0000-4000-8000-0000000007a1'$$,
  '23514', null, 'seats_booked cannot exceed seats_offered (the RIDE_FULL backstop)');

-- Foreign keys that were waiting for bookings (5) -------------------------------------------------------------------------
select ok(exists (select 1 from pg_constraint where contype = 'f' and conname = c), 'foreign key ' || c || ' exists')
  from unnest(array['reliability_events_booking_id_fkey', 'reliability_events_ride_id_fkey',
                    'ratings_booking_id_fkey']) c;
select throws_ok($$insert into app.reliability_events (user_id, kind, booking_id)
  values ('00000000-0000-4000-8000-000000000702', 'late_cancellation', gen_random_uuid())$$,
  '23503', null, 'a reliability event needs a real booking');
select throws_ok($$insert into app.reliability_events (user_id, kind, ride_id)
  values ('00000000-0000-4000-8000-000000000702', 'late_cancellation', gen_random_uuid())$$,
  '23503', null, 'a reliability event needs a real ride');

-- Function grants (8) ------------------------------------------------------------------------------------------------------
select ok(not exists (
  select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = to_regprocedure(f) and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  f || ' is not executable by PUBLIC')
  from unnest(array['app.expire_requests(timestamptz)', 'app.outbox_recipients(uuid[])', 'app.call_tick()']) f;
select ok(not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE'),
  f || ' is not executable by anon or authenticated')
  from unnest(array['app.expire_requests(timestamptz)', 'app.outbox_recipients(uuid[])', 'app.call_tick()']) f;
select ok(has_function_privilege('haide_api', 'app.expire_requests(timestamptz)', 'EXECUTE')
  and has_function_privilege('haide_api', 'app.outbox_recipients(uuid[])', 'EXECUTE'),
  'haide_api can run expire_requests and outbox_recipients');
select ok(not has_function_privilege('haide_api', 'app.call_tick()', 'EXECUTE'),
  'haide_api cannot run call_tick (only pg_cron does)');

-- app.expire_requests (9) ---------------------------------------------------------------------------------------------------
create temp table fx_exp as select * from app.expire_requests('2026-11-16T05:00:00Z');

select is((select count(*) from fx_exp), 1::bigint, 'exactly the past-due requested booking expires');
select is((select booking_id from fx_exp), '00000000-0000-4000-8000-0000000007b1'::uuid, 'it is the right booking');
select is((select driver_first_name from fx_exp), 'Radu', 'the row carries the driver first name for the email');
select is((select status::text from app.bookings where id = '00000000-0000-4000-8000-0000000007b1'), 'expired',
  'the past-due booking is now expired');
select is((select passenger_event_at from app.bookings where id = '00000000-0000-4000-8000-0000000007b1'),
  '2026-11-16T05:00:00Z'::timestamptz, 'the passenger gets an update badge');
select is((select status::text from app.bookings where id = '00000000-0000-4000-8000-0000000007b2'), 'requested',
  'an open request is untouched');
select is((select status::text from app.bookings where id = '00000000-0000-4000-8000-0000000007b3'), 'confirmed',
  'a confirmed booking is never expired');
select is((select count(*) from app.expire_requests('2026-11-16T05:00:00Z')), 0::bigint, 'running it again does nothing');
set local role haide_api;
select lives_ok($$select count(*) from app.expire_requests('2026-11-16T05:00:00Z')$$, 'haide_api can run expire_requests');
reset role;

-- app.outbox_recipients (5) ---------------------------------------------------------------------------------------------------
update app.profiles set status = 'suspended' where id = '00000000-0000-4000-8000-000000000704';

select ok((select prosecdef from pg_proc where oid = 'app.outbox_recipients(uuid[])'::regprocedure),
  'outbox_recipients is SECURITY DEFINER (the only path to auth.users emails)');
select is((select email from app.outbox_recipients(array['00000000-0000-4000-8000-000000000702']::uuid[])),
  'p1@example.com', 'an active user resolves to their email address');
select is((select count(*) from app.outbox_recipients(array['00000000-0000-4000-8000-000000000704']::uuid[])),
  0::bigint, 'a suspended user has no recipient');
select is((select count(*) from app.outbox_recipients(array[gen_random_uuid()])), 0::bigint,
  'an unknown user id has no recipient');
set local role haide_api;
select is((select count(*) from app.outbox_recipients(array['00000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000702']::uuid[])), 2::bigint, 'haide_api can resolve recipients');
reset role;

-- app.call_tick and the cron job (3) -----------------------------------------------------------------------------------------
select ok((select prosecdef from pg_proc where oid = 'app.call_tick()'::regprocedure), 'call_tick is SECURITY DEFINER');
select lives_ok($$select app.call_tick()$$, 'call_tick does nothing without the Vault secrets (local and CI)');
select ok(exists (select 1 from cron.job where jobname = 'haide-tick' and schedule = '* * * * *'),
  'the haide-tick cron job runs every minute');

select * from finish();
rollback;
