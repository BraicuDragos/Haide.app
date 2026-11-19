-- E8 liquidity boosters (e8-liquidity-spec section 1 and 10, ADRs 0036 to 0039): grants and RLS of the new
-- tables and functions, the alert matcher (once per ride, every exclusion), the monthly stats (DST month, no-shows),
-- scrub_account, run_retention, export_user_data and the analytics name CHECK.
begin;
create extension if not exists pgtap with schema extensions;
select plan(82);

-- Fixtures ---------------------------------------------------------------------------------------------------------
-- Users: u(1) D driver, u(2) A alert owner, u(3) B blocked from D, u(4) S suspended, u(5) Z scrubbed, u(6) P passenger,
-- u(7) Q passenger, u(8) F fresh (no rides).
create function pg_temp.u(n integer) returns uuid language sql as
  $$ select ('00000000-0000-4000-8000-0000000011' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.id(prefix text, n integer) returns uuid language sql as
  $$ select (prefix || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

insert into auth.users (id, instance_id, aud, role, email)
select pg_temp.u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e8u' || n || '@example.com'
from generate_series(1, 8) n;
update app.profiles set first_name = 'Radu', phone_e164 = '+40733000001' where id = pg_temp.u(1);
update app.profiles set status = 'suspended' where id = pg_temp.u(4);
insert into app.blocks (blocker_id, blocked_id) values (pg_temp.u(3), pg_temp.u(1));

-- Wanted departure of the main ride: 08:00 local, three local days from now (always in the future, ISO weekday W).
create temp table fx as
  select ((date_trunc('day', now() at time zone 'Europe/Bucharest') + interval '3 days' + time '08:00')
            at time zone 'Europe/Bucharest') as dep,
         ((date_trunc('day', now() at time zone 'Europe/Bucharest') + interval '3 days')::date) as day,
         extract(isodow from (date_trunc('day', now() at time zone 'Europe/Bucharest') + interval '3 days'))::smallint as w;

-- A ride along Trip B (Shopping City to Zona Industriala Vest), about 9.6 km.
create function pg_temp.ride(p_id uuid, p_driver uuid, p_departure timestamptz, p_status text default 'published',
                             p_booked integer default 0, p_offered integer default 3)
returns void language sql as $$
  insert into app.rides (id, driver_id, origin, destination, origin_label, destination_label,
                         route, distance_m, duration_s, departure_at, seats_offered, seats_booked,
                         energy_price_id, rate_micro_per_km, vehicle_snapshot, status, cancelled_at, completed_at, created_at, updated_at)
  values (p_id, p_driver,
          ST_SetSRID(ST_MakePoint(24.1861, 45.7413), 4326), ST_SetSRID(ST_MakePoint(24.09, 45.785), 4326),
          'Shopping City', 'Zona Industriala Vest',
          ST_GeomFromText('LINESTRING(24.1861 45.7413, 24.15 45.76, 24.12 45.775, 24.09 45.785)', 4326),
          9588, 1020, p_departure, p_offered, p_booked,
          (select id from app.energy_prices where fuel_type = 'diesel'), 651000,
          '{"fuelType":"diesel"}'::jsonb, p_status::app.ride_status,
          case when p_status = 'cancelled' then now() end,
          case when p_status = 'completed' then p_departure + interval '1 hour' end, now(), now())
$$;

-- An alert near the ride ends (about 100 m from each) unless told otherwise.
create function pg_temp.alert(p_id uuid, p_user uuid, p_date date, p_weekdays smallint[], p_time time, p_window smallint,
  p_o_lng float8 default 24.1858, p_o_lat float8 default 45.7415, p_d_lng float8 default 24.0903, p_d_lat float8 default 45.7848,
  p_created timestamptz default now() - interval '1 hour', p_expires timestamptz default now() + interval '10 days')
returns void language sql as $$
  insert into app.ride_alerts (id, user_id, origin, destination, origin_label, destination_label, alert_date, weekdays,
                               local_time, window_min, created_at, expires_at)
  values (p_id, p_user, ST_SetSRID(ST_MakePoint(p_o_lng, p_o_lat), 4326), ST_SetSRID(ST_MakePoint(p_d_lng, p_d_lat), 4326),
          'Home', 'Work', p_date, p_weekdays, p_time, p_window, p_created, p_expires)
$$;

-- Tables, RLS and grants ----------------------------------------------------------------------------------------------
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname in ('ride_series', 'ride_alerts', 'ride_alert_hits', 'push_subscriptions')
      and c.relrowsecurity),
  4::bigint, 'the four E8 tables have row level security enabled');
select is(
  (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname in ('ride_series', 'ride_alerts', 'ride_alert_hits', 'push_subscriptions')),
  0::bigint, 'and no policies (deny-all)');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname in ('ride_series', 'ride_alerts', 'ride_alert_hits', 'push_subscriptions')
      and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT')
        or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('authenticated', c.oid, 'DELETE'))),
  0::bigint, 'anon and authenticated have no privileges on them');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname in ('ride_series', 'ride_alerts', 'ride_alert_hits', 'push_subscriptions')
      and has_table_privilege('haide_api', c.oid, 'SELECT, INSERT, UPDATE, DELETE')),
  4::bigint, 'haide_api can read and write all four');
set local role anon;
select throws_ok($$select 1 from app.push_subscriptions$$, '42501', null, 'anon cannot read push_subscriptions');
select throws_ok($$select 1 from app.ride_alerts$$, '42501', null, 'anon cannot read ride_alerts');
reset role;
set local role authenticated;
select throws_ok($$select app.match_ride_alerts(now(), 10)$$, '42501', null, 'authenticated cannot call match_ride_alerts');
select throws_ok($$select * from app.user_month_stats('00000000-0000-4000-8000-000000001101', date '2026-11-01')$$,
  '42501', null, 'authenticated cannot call user_month_stats');
reset role;

-- Function grants (new and replaced) ----------------------------------------------------------------------------------
select is(
  (select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in (to_regprocedure('app.match_ride_alerts(timestamptz, integer)'),
                    to_regprocedure('app.user_month_stats(uuid, date)'),
                    to_regprocedure('app.scrub_account(uuid, timestamptz)'),
                    to_regprocedure('app.run_retention()'),
                    to_regprocedure('app.export_user_data(uuid)'))
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  0::bigint, 'no new or replaced E8 function is executable by PUBLIC');
select is(
  (select count(*) from unnest(array['app.match_ride_alerts(timestamptz, integer)', 'app.user_month_stats(uuid, date)',
                                     'app.scrub_account(uuid, timestamptz)', 'app.run_retention()',
                                     'app.export_user_data(uuid)']) f
    where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')),
  0::bigint, 'nor by anon or authenticated');
select ok(has_function_privilege('haide_api', 'app.match_ride_alerts(timestamptz, integer)', 'EXECUTE')
  and has_function_privilege('haide_api', 'app.user_month_stats(uuid, date)', 'EXECUTE')
  and has_function_privilege('haide_api', 'app.scrub_account(uuid, timestamptz)', 'EXECUTE')
  and has_function_privilege('haide_api', 'app.run_retention()', 'EXECUTE'),
  'haide_api can execute the matcher, the stats, the scrub and the retention');
select ok(not has_function_privilege('haide_api', 'app.export_user_data(uuid)', 'EXECUTE'),
  'haide_api still cannot run the replaced export_user_data');
select is(
  (select count(*) from pg_proc p
    where p.oid in (to_regprocedure('app.match_ride_alerts(timestamptz, integer)'),
                    to_regprocedure('app.user_month_stats(uuid, date)'),
                    to_regprocedure('app.scrub_account(uuid, timestamptz)'),
                    to_regprocedure('app.run_retention()'),
                    to_regprocedure('app.export_user_data(uuid)'))
      and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  5::bigint, 'each pins its search_path');
select is(
  (select string_agg(p.proname::text, ',' order by p.proname) from pg_proc p
    where p.oid in (to_regprocedure('app.match_ride_alerts(timestamptz, integer)'),
                    to_regprocedure('app.user_month_stats(uuid, date)'),
                    to_regprocedure('app.scrub_account(uuid, timestamptz)'),
                    to_regprocedure('app.run_retention()'),
                    to_regprocedure('app.export_user_data(uuid)'))
      and p.prosecdef),
  'export_user_data,run_retention', 'only the two E6 definers stay SECURITY DEFINER');
select is((select provolatile::text from pg_proc where oid = 'app.match_ride_alerts(timestamptz, integer)'::regprocedure),
  'v', 'match_ride_alerts is VOLATILE');
select is((select provolatile::text from pg_proc where oid = 'app.user_month_stats(uuid, date)'::regprocedure),
  's', 'user_month_stats is STABLE');

-- Constraints ------------------------------------------------------------------------------------------------------------
select throws_ok($$insert into app.ride_series (driver_id, weekdays, departure_time, starts_on, ends_on)
  values ('00000000-0000-4000-8000-000000001101', '{1,8}', '07:30', current_date, current_date + 7)$$,
  '23514', null, 'a series weekday outside 1..7 is refused');
select throws_ok($$insert into app.ride_series (driver_id, weekdays, departure_time, starts_on, ends_on)
  values ('00000000-0000-4000-8000-000000001101', '{1}', '07:30', current_date, current_date + 29)$$,
  '23514', null, 'a series longer than 28 days is refused');
select lives_ok($$insert into app.ride_series (driver_id, weekdays, departure_time, starts_on, ends_on)
  values ('00000000-0000-4000-8000-000000001101', '{1,3}', '07:30', current_date, current_date + 28)$$,
  'a series of exactly 28 days is accepted');
select throws_ok($$insert into app.ride_series (driver_id, weekdays, departure_time, starts_on, ends_on, status)
  values ('00000000-0000-4000-8000-000000001101', '{1}', '07:30', current_date, current_date + 7, 'cancelled')$$,
  '23514', null, 'a cancelled series needs cancelled_at');
select throws_ok($$select pg_temp.alert(gen_random_uuid(), '00000000-0000-4000-8000-000000001102', null, null, '07:30', 30::smallint)$$,
  '23514', null, 'an alert needs a date or weekdays');
select throws_ok($$select pg_temp.alert(gen_random_uuid(), '00000000-0000-4000-8000-000000001102', current_date, '{1}', '07:30', 30::smallint)$$,
  '23514', null, 'but not both');
select throws_ok($$select pg_temp.alert(gen_random_uuid(), '00000000-0000-4000-8000-000000001102', null, '{1}', '07:30', 20::smallint)$$,
  '23514', null, 'the window is 15, 30 or 60');
select throws_ok($$insert into app.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ('00000000-0000-4000-8000-000000001102', 'http://fcm.googleapis.com/x', repeat('a', 87), repeat('b', 22))$$,
  '23514', null, 'a push endpoint must be https');
select lives_ok($$insert into app.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ('00000000-0000-4000-8000-000000001102', 'https://fcm.googleapis.com/fcm/send/e8-one', repeat('a', 87), repeat('b', 22))$$,
  'a well-formed subscription is accepted');
select throws_ok($$insert into app.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ('00000000-0000-4000-8000-000000001103', 'https://fcm.googleapis.com/fcm/send/e8-one', repeat('a', 87), repeat('b', 22))$$,
  '23505', null, 'the endpoint is unique');
select ok(exists (select 1 from information_schema.columns where table_schema = 'app' and table_name = 'bookings'
    and column_name = 'auto_confirmed' and is_nullable = 'NO' and column_default = 'false'),
  'bookings.auto_confirmed is NOT NULL default false');

-- Analytics names ----------------------------------------------------------------------------------------------------------
select lives_ok($$insert into app.analytics_events (name, props) values ('alert_created', '{"kind":"weekly"}'), ('alert_matched', '{}')$$,
  'the CHECK accepts alert_created and alert_matched');
select throws_ok($$insert into app.analytics_events (name, props) values ('alert_deleted', '{}')$$, '23514', null,
  'and still refuses an unknown name');
select throws_ok($$insert into app.analytics_events (name, props) values ('alert_created', '{"origin":"x"}')$$, '23514', null,
  'and the props guard still applies');

-- The alert matcher ---------------------------------------------------------------------------------------------------------
-- R1 main ride (D, 08:00 local). R2 at 00:10 local (midnight boundary). R3 full. R4 cancelled. R5 departs in 5 minutes.
select pg_temp.ride(pg_temp.id('e8000000', 1), pg_temp.u(1), (select dep from fx));
select pg_temp.ride(pg_temp.id('e8000000', 2), pg_temp.u(1), (select ((date_trunc('day', now() at time zone 'Europe/Bucharest') + interval '4 days' + time '00:10') at time zone 'Europe/Bucharest') from fx));
select pg_temp.ride(pg_temp.id('e8000000', 3), pg_temp.u(1), (select dep from fx), 'published', 1, 1);
select pg_temp.ride(pg_temp.id('e8000000', 4), pg_temp.u(1), (select dep from fx), 'cancelled');
select pg_temp.ride(pg_temp.id('e8000000', 5), pg_temp.u(1), now() + interval '5 minutes');

-- Alerts (all owned by A unless noted). Expected to match R1: a01, a02, a13.
select pg_temp.alert(pg_temp.id('e8a00000', 1), pg_temp.u(2), null, array[(select w from fx)], time '08:00', 30::smallint);
select pg_temp.alert(pg_temp.id('e8a00000', 2), pg_temp.u(2), (select day from fx), null, time '08:10', 15::smallint);
select pg_temp.alert(pg_temp.id('e8a00000', 3), pg_temp.u(2), null, array[(select w from fx)], time '08:00', 30::smallint,
  24.0903, 45.7848, 24.1858, 45.7415);                                             -- reverse direction
select pg_temp.alert(pg_temp.id('e8a00000', 4), pg_temp.u(2), null, array[(select w from fx)], time '09:00', 30::smallint);  -- outside window
select pg_temp.alert(pg_temp.id('e8a00000', 5), pg_temp.u(2), null, array[((select w from fx) % 7 + 1)::smallint], time '08:00', 30::smallint); -- wrong weekday
select pg_temp.alert(pg_temp.id('e8a00000', 6), pg_temp.u(2), null, array[(select w from fx)], time '08:00', 30::smallint,
  p_created => now() + interval '1 minute', p_expires => now() + interval '10 days');          -- created after the ride
select pg_temp.alert(pg_temp.id('e8a00000', 7), pg_temp.u(1), null, array[(select w from fx)], time '08:00', 30::smallint);  -- own ride
select pg_temp.alert(pg_temp.id('e8a00000', 8), pg_temp.u(3), null, array[(select w from fx)], time '08:00', 30::smallint);  -- blocked pair
select pg_temp.alert(pg_temp.id('e8a00000', 9), pg_temp.u(2), null, array[(select w from fx)], time '08:00', 30::smallint,
  p_created => now() - interval '2 hours', p_expires => now() - interval '1 hour');            -- expired
select pg_temp.alert(pg_temp.id('e8a00000', 10), pg_temp.u(4), null, array[(select w from fx)], time '08:00', 30::smallint);  -- suspended owner
select pg_temp.alert(pg_temp.id('e8a00000', 11), pg_temp.u(2), null, array[(select w from fx)], time '08:00', 30::smallint,
  24.2500, 45.7415);                                                                           -- origin far from the route
select pg_temp.alert(pg_temp.id('e8a00000', 12), pg_temp.u(2), (select day + 1 from fx), null, time '08:00', 30::smallint);  -- wrong date
select pg_temp.alert(pg_temp.id('e8a00000', 13), pg_temp.u(2), null, array[(select w from fx)], time '08:30', 30::smallint);  -- exactly at the window edge
select pg_temp.alert(pg_temp.id('e8a00000', 14), pg_temp.u(2), null, array[(select w from fx)], time '08:31', 30::smallint);  -- one minute outside
-- midnight: R2 leaves at 00:10 the next local day. An alert at 23:50 (30 min) does NOT match across midnight; one at 00:00 does.
select pg_temp.alert(pg_temp.id('e8a00000', 15), pg_temp.u(2), null, array[(select (w % 7 + 1)::smallint from fx)], time '23:50', 30::smallint);
select pg_temp.alert(pg_temp.id('e8a00000', 16), pg_temp.u(2), null, array[(select (w % 7 + 1)::smallint from fx)], time '00:00', 30::smallint);
-- alerts for the rides that must yield nothing: full R3 and cancelled R4 share R1's time (a01 matches them in time).

create temp table res as select * from app.match_ride_alerts(now(), 100);

select is((select count(*) from res where ride_id = pg_temp.id('e8000000', 1)), 3::bigint,
  'R1 matches exactly three alerts');
select is((select string_agg(right(alert_id::text, 2), ',' order by alert_id) from res where ride_id = pg_temp.id('e8000000', 1)),
  '01,02,13', 'a01 (weekly), a02 (one date) and a13 (exactly at the window edge)');
select ok(not exists (select 1 from res where alert_id in (pg_temp.id('e8a00000', 3), pg_temp.id('e8a00000', 14))),
  'a reversed trip and one minute outside the window do not match');
select ok(not exists (select 1 from res where alert_id in (pg_temp.id('e8a00000', 4), pg_temp.id('e8a00000', 5), pg_temp.id('e8a00000', 12))),
  'a wrong time, weekday or date does not match');
select ok(not exists (select 1 from res where alert_id = pg_temp.id('e8a00000', 6)), 'an alert created after the ride is not notified');
select ok(not exists (select 1 from res where alert_id = pg_temp.id('e8a00000', 7)), 'the driver is not told about their own ride');
select ok(not exists (select 1 from res where alert_id = pg_temp.id('e8a00000', 8)), 'a blocked pair does not match');
select ok(not exists (select 1 from res where alert_id = pg_temp.id('e8a00000', 9)), 'an expired alert does not match');
select ok(not exists (select 1 from res where alert_id = pg_temp.id('e8a00000', 10)), 'a suspended owner does not match');
select ok(not exists (select 1 from res where alert_id = pg_temp.id('e8a00000', 11)), 'an origin more than 800 m from the route does not match');
select is((select count(*) from res where ride_id in (pg_temp.id('e8000000', 3), pg_temp.id('e8000000', 4), pg_temp.id('e8000000', 5))),
  0::bigint, 'a full ride, a cancelled ride and a ride leaving within 10 minutes yield nothing');
select is((select string_agg(right(alert_id::text, 2), ',' order by alert_id) from res where ride_id = pg_temp.id('e8000000', 2)),
  '16', 'midnight: the 00:00 alert matches the 00:10 ride, the 23:50 one does not (no wrap across midnight)');
select is((select count(*) from res where user_id <> pg_temp.u(2)), 0::bigint, 'every row names the alert owner');
select ok((select departure_at = (select dep from fx) from res where alert_id = pg_temp.id('e8a00000', 1)),
  'the row carries the departure time');
select is((select count(*) from app.rides where id in (select pg_temp.id('e8000000', n) from generate_series(1, 5) n)
    and alerts_checked_at is not null), 5::bigint, 'all five rides are marked checked, matched or not');
select is((select count(*) from app.ride_alert_hits where ride_id in (select pg_temp.id('e8000000', n) from generate_series(1, 5) n)),
  4::bigint, 'four hits were written (3 on R1, 1 on R2)');

-- Once per ride
select is((select count(*) from app.match_ride_alerts(now(), 100)), 0::bigint, 'a second run finds no new ride and returns nothing');
update app.rides set alerts_checked_at = null where id = pg_temp.id('e8000000', 1);
select is((select count(*) from app.match_ride_alerts(now(), 100)), 0::bigint,
  'even when the ride is checked again, the primary key returns no repeat hit (once per ride)');
select throws_ok($$insert into app.ride_alert_hits (alert_id, ride_id)
  values ('e8a00000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001')$$, '23505', null,
  'ride_alert_hits refuses a duplicate (alert, ride)');
-- The same alert still fires for another ride
select pg_temp.ride(pg_temp.id('e8000000', 6), pg_temp.u(1), (select dep from fx));
select is((select string_agg(right(alert_id::text, 2), ',' order by alert_id) from app.match_ride_alerts(now() + interval '1 second', 100)),
  '01,02,13', 'a new ride at the same time fires the same alerts again (once per ride, not once per alert)');
select is((select count(*) from app.ride_alerts where id = pg_temp.id('e8a00000', 1)), 1::bigint, 'the alert itself is untouched');
select is((select count(*) from app.match_ride_alerts(now(), 0)), 0::bigint, 'a zero limit takes nothing');

-- Monthly stats (E8-5) -----------------------------------------------------------------------------------------------------------
-- DST month: October 2026 is 2026-09-30T21:00Z to 2026-10-31T22:00Z. A: 23:30 local on 31 Oct (October). B: 00:30 on 1 Nov
-- (November). C: 23:30 on 30 Sep (September). D: 00:30 on 1 Oct (October).
create function pg_temp.sbook(p_id uuid, p_passenger uuid, p_ride uuid, p_status text, p_bani integer)
returns void language sql as $$
  insert into app.bookings (id, ride_id, passenger_id, status, pickup, dropoff, pickup_label, dropoff_label,
    pickup_fraction, dropoff_fraction, segment_m, walk_pickup_m, walk_dropoff_m, price_quoted_bani, price_locked_bani,
    final_price_bani, requested_at, expires_at, decided_at, cancelled_at, cancelled_by, no_show_at, no_show_by, created_at)
  values (p_id, p_ride, p_passenger, p_status::app.booking_status,
    ST_SetSRID(ST_MakePoint(24.16234, 45.71876), 4326), ST_SetSRID(ST_MakePoint(24.18123, 45.74012), 4326),
    'Selimbar', 'Centru', 0.2, 0.9, 3500, 100, 100, p_bani, p_bani,
    case when p_status in ('completed') then p_bani end,
    now() - interval '100 days', now() - interval '99 days', now() - interval '100 days' + interval '5 minutes',
    case when p_status = 'cancelled' then now() - interval '99 days' end,
    case when p_status = 'cancelled' then 'passenger' end,
    case when p_status = 'no_show' then now() - interval '98 days' end,
    case when p_status = 'no_show' then 'driver' end,
    now() - interval '100 days')
$$;
select pg_temp.ride(pg_temp.id('e8000000', 21), pg_temp.u(1), timestamptz '2026-10-31T21:30:00Z', 'completed');
select pg_temp.ride(pg_temp.id('e8000000', 22), pg_temp.u(1), timestamptz '2026-10-31T22:30:00Z', 'completed');
select pg_temp.ride(pg_temp.id('e8000000', 23), pg_temp.u(1), timestamptz '2026-09-30T20:30:00Z', 'completed');
select pg_temp.ride(pg_temp.id('e8000000', 24), pg_temp.u(1), timestamptz '2026-09-30T21:30:00Z', 'completed');
select pg_temp.sbook(pg_temp.id('e8b00000', 1), pg_temp.u(6), pg_temp.id('e8000000', 21), 'completed', 500);
select pg_temp.sbook(pg_temp.id('e8b00000', 2), pg_temp.u(7), pg_temp.id('e8000000', 21), 'completed', 300);
select pg_temp.sbook(pg_temp.id('e8b00000', 3), pg_temp.u(6), pg_temp.id('e8000000', 24), 'completed', 200);
select pg_temp.sbook(pg_temp.id('e8b00000', 4), pg_temp.u(7), pg_temp.id('e8000000', 24), 'no_show', 900);
select pg_temp.sbook(pg_temp.id('e8b00000', 5), pg_temp.u(6), pg_temp.id('e8000000', 22), 'completed', 400);
select pg_temp.sbook(pg_temp.id('e8b00000', 6), pg_temp.u(6), pg_temp.id('e8000000', 23), 'completed', 700);
select pg_temp.sbook(pg_temp.id('e8b00000', 7), pg_temp.u(8), pg_temp.id('e8000000', 24), 'cancelled', 800);

select is((select driver_shared_bani from app.user_month_stats(pg_temp.u(1), date '2026-10-01')), 1000::bigint,
  'driver, October: completed bookings only (500 + 300 + 200), the no-show is not counted');
select is((select driver_passengers from app.user_month_stats(pg_temp.u(1), date '2026-10-01')), 3,
  'driver, October: three passengers carried');
select is((select driver_rides from app.user_month_stats(pg_temp.u(1), date '2026-10-01')), 2,
  'driver, October: two rides (23:30 on 31 Oct and 00:30 on 1 Oct, local time)');
select is((select driver_shared_bani from app.user_month_stats(pg_temp.u(1), date '2026-11-01')), 400::bigint,
  'driver, November: the 00:30 ride on 1 Nov (local) belongs to November');
select is((select driver_shared_bani from app.user_month_stats(pg_temp.u(1), date '2026-09-01')), 700::bigint,
  'driver, September: the 23:30 ride on 30 Sep (local) belongs to September');
select is((select passenger_paid_bani from app.user_month_stats(pg_temp.u(6), date '2026-10-01')), 700::bigint,
  'passenger, October: 500 + 200');
select is((select passenger_rides from app.user_month_stats(pg_temp.u(6), date '2026-10-01')), 2, 'passenger, October: two rides');
select is((select passenger_paid_bani || '/' || passenger_rides from app.user_month_stats(pg_temp.u(7), date '2026-10-01')), '300/1',
  'a passenger with a no-show in the month only counts the completed ride');
select is((select row(driver_shared_bani, driver_passengers, driver_rides, passenger_paid_bani, passenger_rides)::text
    from app.user_month_stats(pg_temp.u(8), date '2026-10-01')), '(0,0,0,0,0)',
  'a cancelled booking and a user with nothing give zeros, never NULL');
select throws_ok($$select * from app.user_month_stats('00000000-0000-4000-8000-000000001101', date '2026-10-15')$$,
  '22023', null, 'a month that is not the 1st is refused (22023)');

-- scrub_account (E8) -------------------------------------------------------------------------------------------------------------
select pg_temp.alert(pg_temp.id('e8a00000', 31), pg_temp.u(5), null, array[1::smallint], time '07:30', 30::smallint);
select pg_temp.alert(pg_temp.id('e8a00000', 32), pg_temp.u(2), null, array[1::smallint], time '07:30', 30::smallint);
insert into app.push_subscriptions (user_id, endpoint, p256dh, auth) values
  (pg_temp.u(5), 'https://fcm.googleapis.com/fcm/send/e8-z', repeat('a', 87), repeat('b', 22)),
  (pg_temp.u(2), 'https://fcm.googleapis.com/fcm/send/e8-a', repeat('a', 87), repeat('b', 22));
insert into app.ride_series (id, driver_id, weekdays, departure_time, starts_on, ends_on)
  values (pg_temp.id('e8c00000', 1), pg_temp.u(5), '{1}', '07:30', current_date, current_date + 7);
insert into app.ride_alert_hits (alert_id, ride_id) values (pg_temp.id('e8a00000', 31), pg_temp.id('e8000000', 1));

set local role haide_api;
select lives_ok($$select app.scrub_account('00000000-0000-4000-8000-000000001105', now())$$, 'haide_api can scrub an account with alerts and subscriptions');
reset role;
select is((select count(*) from app.ride_alerts where user_id = pg_temp.u(5)), 0::bigint, 'scrub: the alerts are deleted');
select is((select count(*) from app.ride_alert_hits where alert_id = pg_temp.id('e8a00000', 31)), 0::bigint, 'scrub: their hits go with them');
select is((select count(*) from app.push_subscriptions where user_id = pg_temp.u(5)), 0::bigint, 'scrub: the push subscriptions are deleted');
select is((select status from app.ride_series where id = pg_temp.id('e8c00000', 1)), 'cancelled', 'scrub: the series is cancelled');
select ok((select cancelled_at is not null from app.ride_series where id = pg_temp.id('e8c00000', 1)), 'scrub: with a cancellation time');
select is((select count(*) from app.ride_alerts where user_id = pg_temp.u(2)) > 0
  and (select count(*) from app.push_subscriptions where user_id = pg_temp.u(2)) = 2, true, 'scrub: other users are untouched');

-- run_retention (E8) -------------------------------------------------------------------------------------------------------------
select pg_temp.alert(pg_temp.id('e8a00000', 41), pg_temp.u(2), null, array[1::smallint], time '07:30', 30::smallint,
  p_created => now() - interval '20 days', p_expires => now() - interval '1 hour');
select pg_temp.alert(pg_temp.id('e8a00000', 42), pg_temp.u(2), null, array[1::smallint], time '07:30', 30::smallint,
  p_created => now() - interval '1 day', p_expires => now() + interval '1 hour');
insert into app.ride_alert_hits (alert_id, ride_id) values (pg_temp.id('e8a00000', 41), pg_temp.id('e8000000', 2));
insert into app.ride_series (id, driver_id, weekdays, departure_time, starts_on, ends_on) values
  (pg_temp.id('e8c00000', 2), pg_temp.u(1), '{1}', '07:30', (now() - interval '120 days')::date, (now() - interval '92 days')::date),
  (pg_temp.id('e8c00000', 3), pg_temp.u(1), '{1}', '07:30', (now() - interval '100 days')::date, (now() - interval '89 days')::date);
update app.rides set series_id = pg_temp.id('e8c00000', 2) where id = pg_temp.id('e8000000', 21);

create temp table ret as select app.run_retention() as j;
select is((select (j->>'rideAlerts')::int from ret) >= 1, true, 'run_retention reports the expired alerts it deleted');
select is((select count(*) from app.ride_alerts where id = pg_temp.id('e8a00000', 41)), 0::bigint, 'an alert past its expiry is deleted');
select is((select count(*) from app.ride_alert_hits where alert_id = pg_temp.id('e8a00000', 41)), 0::bigint, 'and its hits cascade');
select is((select count(*) from app.ride_alerts where id = pg_temp.id('e8a00000', 42)), 1::bigint, 'an alert still active stays');
select is((select count(*) from app.ride_series where id = pg_temp.id('e8c00000', 2)), 0::bigint, 'a series that ended 92 days ago is deleted');
select is((select count(*) from app.ride_series where id = pg_temp.id('e8c00000', 3)), 1::bigint, 'a series that ended 89 days ago stays');
select is((select series_id from app.rides where id = pg_temp.id('e8000000', 21)), null, 'the ride of a deleted series stays, with series_id NULL');

-- export_user_data (E8) ------------------------------------------------------------------------------------------------------------
select is((app.export_user_data(pg_temp.u(2))->>'schemaVersion')::int, 2, 'the export is schema version 2');
select is(jsonb_array_length(app.export_user_data(pg_temp.u(2))->'rideAlerts') >= 1, true, 'the export lists the alerts');
select is((app.export_user_data(pg_temp.u(2))->'rideAlerts'->0->'origin'->>'type'), 'Point', 'alert points are GeoJSON');
select is((app.export_user_data(pg_temp.u(2))->'pushSubscriptions'->0->>'service'), 'fcm.googleapis.com',
  'a push subscription is exported as its service host');
select ok(position('e8-a' in app.export_user_data(pg_temp.u(2))::text) = 0
  and position(repeat('a', 87) in app.export_user_data(pg_temp.u(2))::text) = 0
  and position(repeat('b', 22) in app.export_user_data(pg_temp.u(2))::text) = 0,
  'and never the endpoint path or the keys');
select is(jsonb_array_length(app.export_user_data(pg_temp.u(1))->'rideSeries') >= 1, true, 'the export lists the series');

select * from finish();
rollback;
