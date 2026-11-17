-- E7 metrics and admin (e7-metrics-admin-spec section 1, ADRs 0032 to 0035): the analytics props guard,
-- the new admin_actions action, app.admin_dismiss_report, the re-created app.admin_suspend_user,
-- app.outbox_recipients (2 arguments), the four metrics functions over a seeded week with hand-computed
-- answers, app.admin_cron_runs, and the grants of all of them.
--
-- THE SEEDED WEEK. W = 2026-W38, Monday 2026-09-14 (Europe/Bucharest is UTC+3 in September, so the week is
-- [2026-09-13T21:00Z, 2026-09-20T21:00Z)). Edges sit one hour either side of the boundaries in LOCAL time:
-- 00:30 local on Monday is still the previous UTC day, 23:30 local on Sunday is before the end.
--
--  Rides (D1 = u1, D2 = u2):                                          departure (UTC)       status
--   r1 D1  Mon 00:30 local, in W (its UTC date is the 13th)             2026-09-13 21:30      completed
--   r2 D1  Wed                                                          2026-09-16 05:00      completed
--   r3 D1  Sun 23:30 local, in W                                        2026-09-20 20:30      completed
--   r4 D2  Mon 00:30 local, W+1                                         2026-09-20 21:30      completed
--   r5 D2  Thu, nobody accepted                                         2026-09-17 05:00      published
--   r6 D2  Fri                                                          2026-09-18 05:00      cancelled
--   r0 D2  Sun 23:30 local, W-1                                         2026-09-13 20:30      completed
--  Bookings (request time, seconds until the driver answered):
--   b1 P1 r1 completed 09-13 21:15 +600     b2 P2 r1 completed 09-14 08:00 +1200   b3 P1 r2 completed 09-15 08:00 +1800
--   b4 P3 r3 completed 09-16 08:00 +300     b5 P4 r4 completed 09-20 21:30 +600 (W+1)
--   b6 P5 r0 completed 09-13 20:30 +600 (W-1)   b7 P6 r2 no_show 09-16 09:00 +900
--   b8 P7 r6 cancelled by driver 09-17 08:00 +1500   b9 P8 r3 cancelled by system 09-18 08:00 +2400
--   b11 P2 r5 rejected 09-15 10:00 +2700    b12 P3 r5 expired 09-15 11:00    b13 P4 r5 requested 09-20 20:30
--  Answers for W (p_now = 2026-09-21 10:00Z):
--   completed_seats    b1 b2 b3 b4 = 4 (b5 is W+1, b6 is W-1, b7 is a no-show)
--   rides_departed     r1 r2 r3 r5 r6 = 5        rides_filled  r1 r2 r3 r6 = 4 (r5 has only rejected, expired, requested)
--   requests           b1 b2 b3 b4 b7 b8 b9 b11 b12 b13 = 10   decided = 8 (all but b12, b13)   expired = 1 (b12)
--   median_response_s  300 600 900 1200 1500 1800 2400 2700 -> (1200 + 1500) / 2 = 1350
--   reports            rp1 (09-14 10:00) and rp2 (09-20 20:30) = 2 (rp3 is W+1, rp4 is W-1)
--   rides_completed    r1 r2 r3 = 3
--   accepted           b1 b2 b3 b4 b7 b9 b8 = 7     cancelled_after_accept  b8 (driver) = 1 (b9 is a system cancel)
--  Retention cohort = passengers whose FIRST completed booking departs in W-4 = [2026-08-16T21:00Z, 2026-08-23T21:00Z):
--   Q1 a1 (08-18) then a3 (09-08, within 28 d)  retained       Q2 a1 only                    not retained
--   Q3 a6 (08-22 23:30 local) then a2 (08-24 00:30 local, 25 h later)  retained
--   Q4 first ride a7 (08-16 23:30 local) is W-5, so Q4 is not in the cohort although he also rode a1
--   cohort_size 3, cohort_retained 2; the window closes at 2026-08-23T21:00Z + 672 h = 2026-09-20T21:00Z.
--  Searches in W (corridor, resultsCount): south 3 / 0 / 1, west 0 and "n/a" (not a number), other 2, 5 (no corridor key)
--   and 0 (corridor 'mars'). south 3 searches 2 matched, west 2 / 0, campus 0 / 0, other 3 / 2.
--   Outside W: a south search at 09-20 21:30 (W+1) and at 09-13 20:30 (W-1), and a ride_published event in W.
--  Seats series ending 2026-09-14, 3 weeks: 2026-08-31 -> 0, 2026-09-07 -> 2 (a3, r0), 2026-09-14 -> 4.
--  DST week 2026-10-19 (clocks go back on Sunday 25 October, so the week is 169 hours):
--   d1 Sun 23:30 local (EET) = 10-25 21:30Z in the week; d2 Mon 00:30 local = 10-25 22:30Z, NEXT week (same UTC date);
--   d3 Mon 10-19 00:30 local (EEST) = 10-18 21:30Z in the week; d4 Sun 10-18 23:30 local = 10-18 20:30Z, previous week.
--  High-volume window (p_until = 2026-11-02 12:00Z, window (10-26 12:00Z, 11-02 12:00Z]):
--   H1 41 completed in the window, H2 40, H3 40 in the window plus one exactly at the start (excluded),
--   H4 40 in the window plus one exactly at p_until (included) = 41.
begin;
create extension if not exists pgtap with schema extensions;
select plan(114);

-- Fixtures ---------------------------------------------------------------------------------------------------------
create function pg_temp.u(n integer) returns uuid language sql as
  $$ select ('00000000-0000-4000-8000-0000000010' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.rd(n integer) returns uuid language sql as
  $$ select ('00000000-0000-4000-8000-0000000a' || lpad(n::text, 4, '0'))::uuid $$;
create function pg_temp.bk(n integer) returns uuid language sql as
  $$ select ('00000000-0000-4000-8000-0000000b' || lpad(n::text, 4, '0'))::uuid $$;
create function pg_temp.rp(n integer) returns uuid language sql as
  $$ select ('00000000-0000-4000-8000-0000000c' || lpad(n::text, 4, '0'))::uuid $$;

-- u1 D1, u2 D2, u3 admin, u4 T1 (suspended with a code), u5 T2 (suspended the old way), u6 T3,
-- u11..u18 passengers P1..P8, u21..u24 cohort passengers Q1..Q4, u31..u34 high-volume drivers H1..H4.
insert into app.profiles (id, first_name)
select pg_temp.u(n), 'User' || n
from unnest(array[1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 31, 32, 33, 34]) n;
update app.profiles set role = 'admin', first_name = 'Dragos' where id = pg_temp.u(3);

-- Three people with an email address: active, suspended, deleted.
insert into auth.users (id, instance_id, aud, role, email) values
  (pg_temp.u(7), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'active10@example.com'),
  (pg_temp.u(8), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'suspended10@example.com'),
  (pg_temp.u(9), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deleted10@example.com');
update app.profiles set status = 'suspended' where id = pg_temp.u(8);
update app.profiles set status = 'deleted', deleted_at = now() where id = pg_temp.u(9);

create temp table fx_area as select id from app.areas order by name limit 1;

create function pg_temp.ride(p_id uuid, p_driver uuid, p_departure timestamptz, p_status text default 'completed')
returns void language sql as $$
  insert into app.rides (id, driver_id, origin, destination, origin_label, destination_label,
                         origin_area_id, destination_area_id, route, distance_m, duration_s, departure_at,
                         seats_offered, energy_price_id, rate_micro_per_km, vehicle_snapshot, status,
                         completed_at, cancelled_at)
  values (p_id, p_driver,
          ST_SetSRID(ST_MakePoint(24.15123, 45.70987), 4326), ST_SetSRID(ST_MakePoint(24.18654, 45.74321), 4326),
          'Strada Lunga 5', 'Piata Mare 1', (select id from fx_area), (select id from fx_area),
          ST_GeomFromText('LINESTRING(24.15123 45.70987, 24.17 45.725, 24.18654 45.74321)', 4326),
          5000, 600, p_departure, 3,
          (select id from app.energy_prices where fuel_type = 'diesel' limit 1), 651000,
          '{"make":"Dacia","model":"Logan","colour":"Grey","plate":"SB12ABC","fuelType":"diesel"}'::jsonb,
          p_status::app.ride_status,
          case when p_status = 'completed' then p_departure + interval '2 hours' end,
          case when p_status = 'cancelled' then p_departure - interval '1 hour' end)
$$;

create function pg_temp.book(p_id uuid, p_passenger uuid, p_ride uuid, p_status text, p_requested timestamptz,
  p_decided_after interval default null, p_cancelled_by text default null)
returns void language sql as $$
  insert into app.bookings (id, ride_id, passenger_id, status, pickup, dropoff, pickup_label, dropoff_label,
    pickup_fraction, dropoff_fraction, segment_m, walk_pickup_m, walk_dropoff_m, price_quoted_bani,
    price_locked_bani, final_price_bani, requested_at, expires_at, decided_at, cancelled_at, cancelled_by,
    no_show_at, no_show_by, created_at)
  values (p_id, p_ride, p_passenger, p_status::app.booking_status,
    ST_SetSRID(ST_MakePoint(24.16234, 45.71876), 4326), ST_SetSRID(ST_MakePoint(24.18123, 45.74012), 4326),
    'Selimbar', 'Centru', 0.2, 0.9, 3500, 100, 100, 180,
    case when p_status in ('confirmed', 'completed', 'no_show') then 120 end,
    case when p_status = 'completed' then 120 end,
    p_requested, p_requested + interval '30 minutes',
    case when p_decided_after is not null then p_requested + p_decided_after end,
    case when p_status = 'cancelled' then p_requested + interval '1 hour' end,
    case when p_status = 'cancelled' then p_cancelled_by end,
    case when p_status = 'no_show' then p_requested + interval '2 hours' end,
    case when p_status = 'no_show' then 'driver' end,
    p_requested)
$$;

-- The seeded week -------------------------------------------------------------------------------------------------------
select pg_temp.ride(pg_temp.rd(1), pg_temp.u(1), '2026-09-13T21:30:00Z');
select pg_temp.ride(pg_temp.rd(2), pg_temp.u(1), '2026-09-16T05:00:00Z');
select pg_temp.ride(pg_temp.rd(3), pg_temp.u(1), '2026-09-20T20:30:00Z');
select pg_temp.ride(pg_temp.rd(4), pg_temp.u(2), '2026-09-20T21:30:00Z');
select pg_temp.ride(pg_temp.rd(5), pg_temp.u(2), '2026-09-17T05:00:00Z', 'published');
select pg_temp.ride(pg_temp.rd(6), pg_temp.u(2), '2026-09-18T05:00:00Z', 'cancelled');
select pg_temp.ride(pg_temp.rd(7), pg_temp.u(2), '2026-09-13T20:30:00Z');
-- Cohort rides: a1 rd(11), a2 rd(12), a3 rd(13), a6 rd(16), a7 rd(17).
select pg_temp.ride(pg_temp.rd(11), pg_temp.u(1), '2026-08-18T05:00:00Z');
select pg_temp.ride(pg_temp.rd(12), pg_temp.u(1), '2026-08-23T21:30:00Z');
select pg_temp.ride(pg_temp.rd(13), pg_temp.u(1), '2026-09-08T05:00:00Z');
select pg_temp.ride(pg_temp.rd(16), pg_temp.u(2), '2026-08-22T20:30:00Z');
select pg_temp.ride(pg_temp.rd(17), pg_temp.u(2), '2026-08-16T20:30:00Z');

select pg_temp.book(pg_temp.bk(1), pg_temp.u(11), pg_temp.rd(1), 'completed', '2026-09-13T21:15:00Z', interval '600 seconds');
select pg_temp.book(pg_temp.bk(2), pg_temp.u(12), pg_temp.rd(1), 'completed', '2026-09-14T08:00:00Z', interval '1200 seconds');
select pg_temp.book(pg_temp.bk(3), pg_temp.u(11), pg_temp.rd(2), 'completed', '2026-09-15T08:00:00Z', interval '1800 seconds');
select pg_temp.book(pg_temp.bk(4), pg_temp.u(13), pg_temp.rd(3), 'completed', '2026-09-16T08:00:00Z', interval '300 seconds');
select pg_temp.book(pg_temp.bk(5), pg_temp.u(14), pg_temp.rd(4), 'completed', '2026-09-20T21:30:00Z', interval '600 seconds');
select pg_temp.book(pg_temp.bk(6), pg_temp.u(15), pg_temp.rd(7), 'completed', '2026-09-13T20:30:00Z', interval '600 seconds');
select pg_temp.book(pg_temp.bk(7), pg_temp.u(16), pg_temp.rd(2), 'no_show', '2026-09-16T09:00:00Z', interval '900 seconds');
select pg_temp.book(pg_temp.bk(8), pg_temp.u(17), pg_temp.rd(6), 'cancelled', '2026-09-17T08:00:00Z', interval '1500 seconds', 'driver');
select pg_temp.book(pg_temp.bk(9), pg_temp.u(18), pg_temp.rd(3), 'cancelled', '2026-09-18T08:00:00Z', interval '2400 seconds', 'system');
select pg_temp.book(pg_temp.bk(11), pg_temp.u(12), pg_temp.rd(5), 'rejected', '2026-09-15T10:00:00Z', interval '2700 seconds');
select pg_temp.book(pg_temp.bk(12), pg_temp.u(13), pg_temp.rd(5), 'expired', '2026-09-15T11:00:00Z');
select pg_temp.book(pg_temp.bk(13), pg_temp.u(14), pg_temp.rd(5), 'requested', '2026-09-20T20:30:00Z');
-- Cohort bookings (requested a day before the ride).
select pg_temp.book(pg_temp.bk(21), pg_temp.u(21), pg_temp.rd(11), 'completed', '2026-08-17T05:00:00Z', interval '5 minutes');
select pg_temp.book(pg_temp.bk(22), pg_temp.u(22), pg_temp.rd(11), 'completed', '2026-08-17T05:00:00Z', interval '5 minutes');
select pg_temp.book(pg_temp.bk(23), pg_temp.u(24), pg_temp.rd(11), 'completed', '2026-08-17T05:00:00Z', interval '5 minutes');
select pg_temp.book(pg_temp.bk(24), pg_temp.u(21), pg_temp.rd(13), 'completed', '2026-09-07T05:00:00Z', interval '5 minutes');
select pg_temp.book(pg_temp.bk(25), pg_temp.u(23), pg_temp.rd(16), 'completed', '2026-08-21T20:30:00Z', interval '5 minutes');
select pg_temp.book(pg_temp.bk(26), pg_temp.u(23), pg_temp.rd(12), 'completed', '2026-08-22T21:30:00Z', interval '5 minutes');
select pg_temp.book(pg_temp.bk(27), pg_temp.u(24), pg_temp.rd(17), 'completed', '2026-08-15T20:30:00Z', interval '5 minutes');

insert into app.reports (id, reporter_id, reported_id, reason, details, reported_snapshot, created_at) values
  (pg_temp.rp(1), pg_temp.u(11), pg_temp.u(1), 'harassment', 'w1', '{"firstName":"User1"}'::jsonb, '2026-09-14T10:00:00Z'),
  (pg_temp.rp(2), pg_temp.u(12), pg_temp.u(1), 'harassment', 'w2', '{"firstName":"User1"}'::jsonb, '2026-09-20T20:30:00Z'),
  (pg_temp.rp(3), pg_temp.u(13), pg_temp.u(1), 'harassment', 'w+1', '{"firstName":"User1"}'::jsonb, '2026-09-20T21:30:00Z'),
  (pg_temp.rp(4), pg_temp.u(14), pg_temp.u(1), 'harassment', 'w-1', '{"firstName":"User1"}'::jsonb, '2026-09-13T20:30:00Z');

insert into app.analytics_events (name, user_id, props, occurred_at) values
  ('search_performed', null, '{"corridor":"south","resultsCount":3}', '2026-09-15T10:00:00Z'),
  ('search_performed', null, '{"corridor":"south","resultsCount":0}', '2026-09-15T10:01:00Z'),
  ('search_performed', pg_temp.u(11), '{"corridor":"south","resultsCount":1}', '2026-09-15T10:02:00Z'),
  ('search_performed', null, '{"corridor":"west","resultsCount":0}', '2026-09-16T10:00:00Z'),
  ('search_performed', null, '{"corridor":"west","resultsCount":"n/a"}', '2026-09-16T10:01:00Z'),
  ('search_performed', null, '{"corridor":"other","resultsCount":2}', '2026-09-17T10:00:00Z'),
  ('search_performed', null, '{"resultsCount":5}', '2026-09-17T10:01:00Z'),
  ('search_performed', null, '{"corridor":"mars","resultsCount":0}', '2026-09-17T10:02:00Z'),
  ('search_performed', null, '{"corridor":"south","resultsCount":1}', '2026-09-20T21:30:00Z'),
  ('search_performed', null, '{"corridor":"south","resultsCount":1}', '2026-09-13T20:30:00Z'),
  ('ride_published', pg_temp.u(1), '{"corridor":"south","resultsCount":1}', '2026-09-15T12:00:00Z');

-- The DST week: d1 rd(21), d2 rd(22), d3 rd(23), d4 rd(24), one completed booking on each.
select pg_temp.ride(pg_temp.rd(21), pg_temp.u(1), '2026-10-25T21:30:00Z');
select pg_temp.ride(pg_temp.rd(22), pg_temp.u(1), '2026-10-25T22:30:00Z');
select pg_temp.ride(pg_temp.rd(23), pg_temp.u(1), '2026-10-18T21:30:00Z');
select pg_temp.ride(pg_temp.rd(24), pg_temp.u(1), '2026-10-18T20:30:00Z');
select pg_temp.book(pg_temp.bk(31), pg_temp.u(11), pg_temp.rd(21), 'completed', '2026-10-24T08:00:00Z', interval '5 minutes');
select pg_temp.book(pg_temp.bk(32), pg_temp.u(11), pg_temp.rd(22), 'completed', '2026-10-24T08:00:00Z', interval '5 minutes');
select pg_temp.book(pg_temp.bk(33), pg_temp.u(11), pg_temp.rd(23), 'completed', '2026-10-17T08:00:00Z', interval '5 minutes');
select pg_temp.book(pg_temp.bk(34), pg_temp.u(11), pg_temp.rd(24), 'completed', '2026-10-17T08:00:00Z', interval '5 minutes');

-- The high-volume window. Ride and booking numbers: H1 101..141, H2 201..240, H3 301..340 and 341 (at the start),
-- H4 401..440 and 441 (at p_until); the booking of ride n is bk(1000 + n).
insert into app.profiles (id, first_name) values (pg_temp.u(35), 'Passenger');
select pg_temp.ride(pg_temp.rd(100 + n), pg_temp.u(31), '2026-10-28T08:00:00Z'::timestamptz + n * interval '1 minute')
  from generate_series(1, 41) n;
select pg_temp.ride(pg_temp.rd(200 + n), pg_temp.u(32), '2026-10-28T08:00:00Z'::timestamptz + n * interval '1 minute')
  from generate_series(1, 40) n;
select pg_temp.ride(pg_temp.rd(300 + n), pg_temp.u(33), '2026-10-28T08:00:00Z'::timestamptz + n * interval '1 minute')
  from generate_series(1, 40) n;
select pg_temp.ride(pg_temp.rd(341), pg_temp.u(33), '2026-10-26T12:00:00Z');
select pg_temp.ride(pg_temp.rd(400 + n), pg_temp.u(34), '2026-10-28T08:00:00Z'::timestamptz + n * interval '1 minute')
  from generate_series(1, 40) n;
select pg_temp.ride(pg_temp.rd(441), pg_temp.u(34), '2026-11-02T12:00:00Z');
select pg_temp.book(pg_temp.bk(1000 + r.n), pg_temp.u(35), pg_temp.rd(r.n), 'completed', '2026-10-27T08:00:00Z', interval '5 minutes')
  from (select 100 + g as n from generate_series(1, 41) g
        union all select 200 + g from generate_series(1, 40) g
        union all select 300 + g from generate_series(1, 40) g union all select 341
        union all select 400 + g from generate_series(1, 40) g union all select 441) r;

-- Reports and a few users for the admin functions.
insert into app.reports (id, reporter_id, reported_id, reason, details, reported_snapshot) values
  (pg_temp.rp(10), pg_temp.u(11), pg_temp.u(4), 'harassment', 'dismiss me', '{"firstName":"User4"}'::jsonb),
  (pg_temp.rp(11), pg_temp.u(11), pg_temp.u(5), 'unsafe_driving', 'dismiss me too', '{"firstName":"User5"}'::jsonb),
  (pg_temp.rp(12), pg_temp.u(12), pg_temp.u(6), 'harassment', 'suspend me', '{"firstName":"User6"}'::jsonb);

-- app.event_props_ok (15) --------------------------------------------------------------------------------------------------
select is(app.event_props_ok('{"a":1,"b":"x","c":true,"d":null,"e":1.5}'::jsonb), true, 'flat props are accepted');
select is(app.event_props_ok('{}'::jsonb), true, 'an empty object is accepted');
select is(app.event_props_ok('{"a":{"b":1}}'::jsonb), false, 'a nested object is rejected');
select is(app.event_props_ok('{"a":[1,2]}'::jsonb), false, 'an array value is rejected');
select is(app.event_props_ok('[1,2]'::jsonb), false, 'an array at the top is rejected');
select is(app.event_props_ok('"text"'::jsonb), false, 'a scalar at the top is rejected');
select is(app.event_props_ok(null), false, 'null is rejected');
select is(app.event_props_ok('{"lat":45.7}'::jsonb), false, 'a lat key is rejected');
select is(app.event_props_ok('{"Lat":45.7}'::jsonb), false, 'the key check ignores letter case');
select is(app.event_props_ok('{"phoneE164":"+40721234567"}'::jsonb), false, 'a phoneE164 key is rejected');
select is(app.event_props_ok('{"details":"x"}'::jsonb), false, 'a details key is rejected');
select is(app.event_props_ok(jsonb_build_object('a', repeat('x', 81))), false, 'an 81 character string is rejected');
select is(app.event_props_ok(jsonb_build_object('a', repeat('x', 80))), true, 'an 80 character string is accepted');
select is(app.event_props_ok((select jsonb_object_agg('k' || g, g) from generate_series(1, 13) g)), false, '13 keys are rejected');
select is(app.event_props_ok((select jsonb_object_agg('k' || g, g) from generate_series(1, 12) g)), true, '12 keys are accepted');

-- The constraint (6) ------------------------------------------------------------------------------------------------------------
select ok(exists (select 1 from pg_constraint where conname = 'analytics_events_props_ok' and convalidated),
  'analytics_events_props_ok exists and is validated');
select throws_ok($$insert into app.analytics_events (name, props) values ('search_performed', '{"lat":45.7}'::jsonb)$$,
  '23514', null, 'an event with a lat prop cannot be stored');
select throws_ok($$insert into app.analytics_events (name, props) values ('search_performed', '{"a":{"b":1}}'::jsonb)$$,
  '23514', null, 'an event with a nested prop cannot be stored');
select lives_ok($$insert into app.analytics_events (name, props) values ('search_performed', '{"corridor":"west","resultsCount":2}'::jsonb)$$,
  'a flat event can be stored');
select is((select provolatile::text from pg_proc where oid = 'app.event_props_ok(jsonb)'::regprocedure), 'i',
  'event_props_ok is IMMUTABLE (a CHECK needs it)');
set local role haide_api;
select lives_ok($$insert into app.analytics_events (name, user_id, props) values ('ride_published', null, '{"seats":3}'::jsonb)$$,
  'haide_api can insert an event (it can run the CHECK function)');
reset role;

-- admin_actions (3) -----------------------------------------------------------------------------------------------------------------
select lives_ok($$insert into app.admin_actions (admin_id, action, details) values (null, 'energy_price_added', '{"fuelType":"petrol"}'::jsonb)$$,
  'energy_price_added is an allowed action');
select throws_ok($$insert into app.admin_actions (admin_id, action) values (null, 'delete_everything')$$,
  '23514', null, 'an unknown action is rejected');
select is((select count(*)::integer from pg_indexes where schemaname = 'app'
            and indexname in ('rides_departure_idx', 'bookings_requested_idx', 'admin_actions_created_idx', 'admin_actions_report_idx')),
  4, 'the four E7 indexes exist');

-- app.admin_dismiss_report (9) ------------------------------------------------------------------------------------------------------
select is(app.admin_dismiss_report(pg_temp.rp(10), pg_temp.u(3), 'no evidence'), true, 'an open report is dismissed');
select is((select status::text from app.reports where id = pg_temp.rp(10)), 'dismissed', 'the report is dismissed');
select is((select resolved_by from app.reports where id = pg_temp.rp(10)), pg_temp.u(3), 'the report records who resolved it');
select ok((select resolved_at is not null from app.reports where id = pg_temp.rp(10)), 'the report records when');
select is((select jsonb_build_object('admin', admin_id, 'target', target_user_id, 'report', report_id, 'note', details ->> 'note')
             from app.admin_actions where action = 'dismiss_report' and report_id = pg_temp.rp(10)),
  jsonb_build_object('admin', pg_temp.u(3), 'target', pg_temp.u(4), 'report', pg_temp.rp(10), 'note', 'no evidence'),
  'one dismiss_report audit row names the admin, the reported user, the report and the note');
select is(app.admin_dismiss_report(pg_temp.rp(10), pg_temp.u(3), 'again'), false, 'a second dismissal returns false');
select is((select count(*)::integer from app.admin_actions where action = 'dismiss_report' and report_id = pg_temp.rp(10)), 1,
  'and adds no second audit row');
select is(app.admin_dismiss_report(gen_random_uuid(), pg_temp.u(3), 'x'), false, 'an unknown report returns false');
select is(app.admin_dismiss_report(pg_temp.rp(11), pg_temp.u(3), null), true, 'the note is optional');

-- app.admin_suspend_user (8) --------------------------------------------------------------------------------------------------------
select is(app.admin_suspend_user(pg_temp.u(6), 'Repeated unwanted messages.', pg_temp.u(3), pg_temp.rp(12), 'harassment'), true,
  'suspends with a report and a ground');
select is((select jsonb_build_object('reason', details ->> 'reason', 'code', details ->> 'reasonCode', 'admin', admin_id, 'report', report_id)
             from app.admin_actions where action = 'suspend' and target_user_id = pg_temp.u(6)),
  jsonb_build_object('reason', 'Repeated unwanted messages.', 'code', 'harassment', 'admin', pg_temp.u(3), 'report', pg_temp.rp(12)),
  'the audit row holds the statement, the reason code, the admin and the report');
select is((select status::text || ':' || resolved_by::text from app.reports where id = pg_temp.rp(12)), 'actioned:' || pg_temp.u(3)::text,
  'the open report becomes actioned, resolved by the admin');
select is(app.admin_suspend_user(pg_temp.u(6), 'again', pg_temp.u(3), null, 'other'), false, 'suspending a suspended user returns false');
select is(app.admin_suspend_user(pg_temp.u(5), 'old style call', null, null), true, 'the four-argument call shape still resolves');
select is((select details ->> 'reasonCode' from app.admin_actions where action = 'suspend' and target_user_id = pg_temp.u(5)), 'other',
  'and the reason code defaults to other');
select throws_ok($$select app.admin_suspend_user('00000000-0000-4000-8000-000000001004'::uuid, 'x', null, null, 'rude')$$,
  '22023', null, 'an unknown reason code is rejected');
select ok(to_regprocedure('app.admin_suspend_user(uuid, text, uuid, uuid)') is null,
  'the four-argument overload is gone (no ambiguity)');

-- app.outbox_recipients (7) --------------------------------------------------------------------------------------------------------------
select is((select count(*)::integer from app.outbox_recipients(array[pg_temp.u(7), pg_temp.u(8), pg_temp.u(9)], false)), 1,
  'without the flag only the active user has an address');
select is((select count(*)::integer from app.outbox_recipients(array[pg_temp.u(7), pg_temp.u(8), pg_temp.u(9)], true)), 2,
  'with the flag the suspended user too');
select is((select email from app.outbox_recipients(array[pg_temp.u(8)], true)), 'suspended10@example.com', 'and it is their address');
select is((select count(*)::integer from app.outbox_recipients(array[pg_temp.u(9)], true)), 0, 'a deleted user never has one');
select is((select count(*)::integer from app.outbox_recipients(array[pg_temp.u(7), pg_temp.u(8), pg_temp.u(9)])), 1,
  'the one-argument version still answers active users only');
select ok((select prosecdef from pg_proc where oid = 'app.outbox_recipients(uuid[], boolean)'::regprocedure),
  'the two-argument version is SECURITY DEFINER');
select is((select count(*)::integer from app.outbox_recipients(null::uuid[], true)), 0, 'a null list is empty');

-- Metrics: input checks (7) ------------------------------------------------------------------------------------------------------------------
select throws_ok($$select * from app.metrics_week('2026-09-15', now())$$, '22023', null, 'metrics_week rejects a Tuesday');
select throws_ok($$select * from app.metrics_match_by_corridor('2026-09-13')$$, '22023', null, 'metrics_match_by_corridor rejects a Sunday');
select throws_ok($$select * from app.metrics_seats_series('2026-09-15', 3)$$, '22023', null, 'metrics_seats_series rejects a Tuesday');
select throws_ok($$select * from app.metrics_seats_series('2026-09-14', 27)$$, '22023', null, 'and more than 26 weeks');
select throws_ok($$select * from app.metrics_seats_series('2026-09-14', 0)$$, '22023', null, 'and fewer than 1');
select lives_ok($$select * from app.metrics_seats_series('2026-09-14', 26)$$, '26 weeks is fine');
select is((select provolatile::text || prosecdef::text from pg_proc where oid = 'app.metrics_week(date, timestamptz)'::regprocedure),
  'sfalse', 'metrics_week is STABLE and SECURITY INVOKER');

-- Metrics: the seeded week (12) ---------------------------------------------------------------------------------------------------------------------
select is((select to_jsonb(m) from app.metrics_week('2026-09-14', '2026-09-21T10:00:00Z') m),
  '{"completed_seats":4,"rides_departed":5,"rides_filled":4,"requests":10,"requests_decided":8,"requests_expired":1,
    "median_response_s":1350,"cohort_size":3,"cohort_retained":2,"cohort_closed":true,"reports":2,
    "rides_completed":3,"accepted":7,"cancelled_after_accept":1}'::jsonb,
  'every count of the seeded week matches the hand-computed answer');
select is((select completed_seats from app.metrics_week('2026-09-14', now())), 4,
  'Monday 00:30 local (still the 13th in UTC) and Sunday 23:30 local count in the week; a no-show and the next Monday 00:30 do not');
select is((select requests from app.metrics_week('2026-09-07', now())), 2,
  'the booking requested at 2026-09-13 20:30Z (Sunday 23:30 local) belongs to the previous week (with a3 booking of 09-07)');
select is((select cohort_closed from app.metrics_week('2026-09-14', '2026-09-20T20:59:00Z')), false,
  'the retention window is still open one minute before it closes');
select is((select cohort_closed from app.metrics_week('2026-09-14', '2026-09-20T21:00:00Z')), true,
  'and closed at the exact moment (end of W-4 plus 672 hours)');
select is((select to_jsonb(m) - 'cohort_closed' from app.metrics_week('2026-03-02', now()) m),
  '{"completed_seats":0,"rides_departed":0,"rides_filled":0,"requests":0,"requests_decided":0,"requests_expired":0,
    "median_response_s":null,"cohort_size":0,"cohort_retained":0,"reports":0,"rides_completed":0,"accepted":0,
    "cancelled_after_accept":0}'::jsonb,
  'an empty week is all zeros and a null median');
select is((select jsonb_agg(to_jsonb(c) order by array_position(array['south', 'west', 'campus', 'other'], c.corridor))
             from app.metrics_match_by_corridor('2026-09-14') c),
  '[{"corridor":"south","searches":3,"matched":2},{"corridor":"west","searches":2,"matched":0},
    {"corridor":"campus","searches":0,"matched":0},{"corridor":"other","searches":3,"matched":2}]'::jsonb,
  'searches and matches per corridor: zeros kept, a missing or unknown corridor is other, a non-number result is not a match');
select is((select count(*)::integer from app.metrics_match_by_corridor('2026-03-02') where searches = 0 and matched = 0), 4,
  'an empty week still returns the four corridors');
select is((select jsonb_agg(to_jsonb(s) order by s.week) from app.metrics_seats_series('2026-09-14', 3) s),
  '[{"week":"2026-08-31","completed_seats":0},{"week":"2026-09-07","completed_seats":2},{"week":"2026-09-14","completed_seats":4}]'::jsonb,
  'the seats series has one row per week, zeros included');
select is((select count(*)::integer from app.metrics_seats_series('2026-09-14', 26)), 26, 'and 26 rows for 26 weeks');
select is((select completed_seats from app.metrics_seats_series('2026-10-19', 1)), 2,
  'the DST week (169 hours): Sunday 23:30 EET and Monday 00:30 EEST count, Monday 00:30 EET (same UTC date) and Sunday 23:30 EEST do not');
select is((select rides_departed from app.metrics_week('2026-10-19', now())), 2, 'and rides_departed agrees');

-- Metrics: high-volume drivers (4) ------------------------------------------------------------------------------------------------------------------
select is((select jsonb_agg(to_jsonb(h) order by h.driver_id) from app.metrics_high_volume_drivers('2026-11-02T12:00:00Z', 40) h),
  jsonb_build_array(jsonb_build_object('driver_id', pg_temp.u(31), 'completed', 41),
                    jsonb_build_object('driver_id', pg_temp.u(34), 'completed', 41)),
  '41 completed in the window is flagged (including a ride exactly at p_until), 40 is not');
select is((select count(*)::integer from app.metrics_high_volume_drivers('2026-11-02T12:00:00Z', 39)), 4,
  'with a lower threshold all four are flagged (a ride exactly 7 days before p_until is outside the window)');
select is((select count(*)::integer from app.metrics_high_volume_drivers('2026-11-02T12:00:00Z', 41)), 0, 'the threshold is strict');
select is((select driver_id from app.metrics_high_volume_drivers('2026-11-02T12:00:00Z', 40) order by completed desc, driver_id limit 1),
  pg_temp.u(31), 'rows come most active first, then by driver id');

-- app.admin_cron_runs and the grants (43) -------------------------------------------------------------------------------------------------------------
select lives_ok($$select * from app.admin_cron_runs()$$, 'admin_cron_runs answers (empty where pg_cron has no runs)');
select is(pg_get_function_result('app.admin_cron_runs()'::regprocedure),
  'TABLE(job text, status text, started_at timestamp with time zone)', 'it returns the job, the status and the start only, never the command');
select ok(not exists (
  select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = to_regprocedure(f) and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  f || ' is not executable by PUBLIC')
  from unnest(array['app.event_props_ok(jsonb)', 'app.admin_suspend_user(uuid, text, uuid, uuid, text)',
                    'app.admin_dismiss_report(uuid, uuid, text)', 'app.outbox_recipients(uuid[], boolean)',
                    'app.metrics_week(date, timestamptz)', 'app.metrics_match_by_corridor(date)',
                    'app.metrics_seats_series(date, integer)', 'app.metrics_high_volume_drivers(timestamptz, integer)',
                    'app.admin_cron_runs()']) f;
select ok(not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE'),
  f || ' is not executable by anon or authenticated')
  from unnest(array['app.event_props_ok(jsonb)', 'app.admin_suspend_user(uuid, text, uuid, uuid, text)',
                    'app.admin_dismiss_report(uuid, uuid, text)', 'app.outbox_recipients(uuid[], boolean)',
                    'app.metrics_week(date, timestamptz)', 'app.metrics_match_by_corridor(date)',
                    'app.metrics_seats_series(date, integer)', 'app.metrics_high_volume_drivers(timestamptz, integer)',
                    'app.admin_cron_runs()']) f;
select ok(has_function_privilege('haide_api', f, 'EXECUTE'), f || ' is executable by haide_api')
  from unnest(array['app.event_props_ok(jsonb)', 'app.admin_suspend_user(uuid, text, uuid, uuid, text)',
                    'app.admin_dismiss_report(uuid, uuid, text)', 'app.outbox_recipients(uuid[], boolean)',
                    'app.metrics_week(date, timestamptz)', 'app.metrics_match_by_corridor(date)',
                    'app.metrics_seats_series(date, integer)', 'app.metrics_high_volume_drivers(timestamptz, integer)',
                    'app.admin_cron_runs()']) f;
select is((select string_agg(p.proname::text, ',' order by p.proname) from pg_proc p
            where p.oid in (to_regprocedure('app.event_props_ok(jsonb)'),
                            to_regprocedure('app.admin_suspend_user(uuid, text, uuid, uuid, text)'),
                            to_regprocedure('app.admin_dismiss_report(uuid, uuid, text)'),
                            to_regprocedure('app.outbox_recipients(uuid[], boolean)'),
                            to_regprocedure('app.metrics_week(date, timestamptz)'),
                            to_regprocedure('app.metrics_match_by_corridor(date)'),
                            to_regprocedure('app.metrics_seats_series(date, integer)'),
                            to_regprocedure('app.metrics_high_volume_drivers(timestamptz, integer)'),
                            to_regprocedure('app.admin_cron_runs()'))
              and p.prosecdef), 'admin_cron_runs,outbox_recipients',
  'only outbox_recipients and admin_cron_runs are SECURITY DEFINER');
select ok(exists (select 1 from pg_proc p, unnest(p.proconfig) c
  where p.oid = to_regprocedure(f) and c like 'search_path=%'), f || ' pins its search_path')
  from unnest(array['app.event_props_ok(jsonb)', 'app.admin_suspend_user(uuid, text, uuid, uuid, text)',
                    'app.admin_dismiss_report(uuid, uuid, text)', 'app.outbox_recipients(uuid[], boolean)',
                    'app.metrics_week(date, timestamptz)', 'app.metrics_match_by_corridor(date)',
                    'app.metrics_seats_series(date, integer)', 'app.metrics_high_volume_drivers(timestamptz, integer)',
                    'app.admin_cron_runs()']) f;
set local role authenticated;
select throws_ok($$select * from app.metrics_week('2026-09-14', now())$$, '42501', null, 'authenticated cannot run metrics_week');
select throws_ok($$select * from app.admin_cron_runs()$$, '42501', null, 'authenticated cannot read the cron runs');
reset role;
set local role haide_api;
select lives_ok($$select * from app.metrics_week('2026-09-14', now())$$, 'haide_api can run metrics_week');
select lives_ok($$select * from app.admin_cron_runs()$$, 'haide_api can read the cron runs');
reset role;

select * from finish();
rollback;
