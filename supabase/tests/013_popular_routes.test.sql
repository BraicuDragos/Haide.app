-- Popular routes (improvement 4): app.popular_routes(p_now, p_limit) and its supporting index.
-- Rules under test: window 30 days back to 14 days ahead, status published or completed, both areas known
-- and different, at least 2 DISTINCT drivers, score = rides + confirmed/completed bookings, order
-- score desc, rides desc, origin name, destination name, limit clamped to 1..10, privileges.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- Fixtures ---------------------------------------------------------------------------------------------------------
-- Drivers u(1)..u(3), passengers u(6)..u(8).
create function pg_temp.u(n integer) returns uuid language sql as
  $$ select ('00000000-0000-4000-8000-0000000013' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.id(prefix text, n integer) returns uuid language sql as
  $$ select (prefix || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

insert into auth.users (id, instance_id, aud, role, email)
select pg_temp.u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pop' || n || '@example.com'
from generate_series(1, 8) n;

-- Five areas, numbered by name: a1 < a2 < a3 < a4 < a5 (the tie order below relies on it).
create temp table ar as
  select (row_number() over (order by name, id))::integer as n, id, name from app.areas order by name, id limit 5;

create function pg_temp.a(n integer) returns uuid language sql as $$ select id from ar where ar.n = $1 $$;

create function pg_temp.ride(p_id uuid, p_driver uuid, p_from integer, p_to integer, p_departure timestamptz,
                             p_status text default 'published')
returns void language sql as $$
  insert into app.rides (id, driver_id, origin, destination, origin_label, destination_label,
                         origin_area_id, destination_area_id,
                         route, distance_m, duration_s, departure_at, seats_offered, seats_booked,
                         energy_price_id, rate_micro_per_km, vehicle_snapshot, status, cancelled_at, completed_at,
                         created_at, updated_at)
  values (p_id, p_driver,
          ST_SetSRID(ST_MakePoint(24.1861, 45.7413), 4326), ST_SetSRID(ST_MakePoint(24.09, 45.785), 4326),
          'Origin', 'Destination',
          case when p_from is null then null else pg_temp.a(p_from) end,
          case when p_to is null then null else pg_temp.a(p_to) end,
          ST_GeomFromText('LINESTRING(24.1861 45.7413, 24.15 45.76, 24.12 45.775, 24.09 45.785)', 4326),
          9588, 1020, p_departure, 3, 0,
          (select id from app.energy_prices where fuel_type = 'diesel'), 651000,
          '{"fuelType":"diesel"}'::jsonb, p_status::app.ride_status,
          case when p_status = 'cancelled' then now() end,
          case when p_status = 'completed' then p_departure + interval '1 hour' end, now(), now())
$$;

create function pg_temp.book(p_id uuid, p_passenger uuid, p_ride uuid, p_status text)
returns void language sql as $$
  insert into app.bookings (id, ride_id, passenger_id, status, pickup, dropoff, pickup_label, dropoff_label,
    pickup_fraction, dropoff_fraction, segment_m, walk_pickup_m, walk_dropoff_m, price_quoted_bani, price_locked_bani,
    final_price_bani, requested_at, expires_at, decided_at, cancelled_at, cancelled_by, created_at)
  values (p_id, p_ride, p_passenger, p_status::app.booking_status,
    ST_SetSRID(ST_MakePoint(24.16234, 45.71876), 4326), ST_SetSRID(ST_MakePoint(24.18123, 45.74012), 4326),
    'Pickup', 'Dropoff', 0.2, 0.9, 3500, 100, 100, 300,
    case when p_status in ('confirmed', 'completed') then 300 end,
    case when p_status = 'completed' then 300 end,
    now() - interval '2 hours', now() + interval '1 hour',
    case when p_status in ('confirmed', 'completed') then now() - interval '1 hour' end,
    case when p_status = 'cancelled' then now() end,
    case when p_status = 'cancelled' then 'passenger' end,
    now() - interval '2 hours')
$$;

-- R1: a1 -> a2, three drivers, 3 rides; bookings: 2 confirmed + 1 completed count, 1 requested and 1 cancelled do not.
select pg_temp.ride(pg_temp.id('a1000000', 1), pg_temp.u(1), 1, 2, now() + interval '2 days');
select pg_temp.ride(pg_temp.id('a1000000', 2), pg_temp.u(2), 1, 2, now() + interval '3 days');
select pg_temp.ride(pg_temp.id('a1000000', 3), pg_temp.u(3), 1, 2, now() - interval '5 days', 'completed');
select pg_temp.book(pg_temp.id('b1000000', 1), pg_temp.u(6), pg_temp.id('a1000000', 1), 'confirmed');
select pg_temp.book(pg_temp.id('b1000000', 2), pg_temp.u(7), pg_temp.id('a1000000', 1), 'confirmed');
select pg_temp.book(pg_temp.id('b1000000', 3), pg_temp.u(6), pg_temp.id('a1000000', 3), 'completed');
select pg_temp.book(pg_temp.id('b1000000', 4), pg_temp.u(8), pg_temp.id('a1000000', 1), 'requested');
select pg_temp.book(pg_temp.id('b1000000', 5), pg_temp.u(8), pg_temp.id('a1000000', 2), 'cancelled');
-- R2: a2 -> a3, two drivers, 2 rides (one completed 20 days ago, one ahead). Tie with R3 and R6b: score 2, rides 2.
select pg_temp.ride(pg_temp.id('a2000000', 1), pg_temp.u(1), 2, 3, now() - interval '20 days', 'completed');
select pg_temp.ride(pg_temp.id('a2000000', 2), pg_temp.u(2), 2, 3, now() + interval '5 days');
-- R3: a3 -> a4, two drivers, score 2.
select pg_temp.ride(pg_temp.id('a3000000', 1), pg_temp.u(1), 3, 4, now() + interval '1 day');
select pg_temp.ride(pg_temp.id('a3000000', 2), pg_temp.u(2), 3, 4, now() + interval '2 days');
-- R4: a4 -> a5, three rides by ONE driver: hidden (privacy).
select pg_temp.ride(pg_temp.id('a4000000', 1), pg_temp.u(1), 4, 5, now() + interval '1 day');
select pg_temp.ride(pg_temp.id('a4000000', 2), pg_temp.u(1), 4, 5, now() + interval '2 days');
select pg_temp.ride(pg_temp.id('a4000000', 3), pg_temp.u(1), 4, 5, now() + interval '3 days');
-- R5: a5 -> a1, one ride cancelled and one published by different drivers: only one distinct driver left.
select pg_temp.ride(pg_temp.id('a5000000', 1), pg_temp.u(1), 5, 1, now() + interval '1 day', 'cancelled');
select pg_temp.ride(pg_temp.id('a5000000', 2), pg_temp.u(2), 5, 1, now() + interval '2 days');
-- R6: a1 -> a3, two drivers, both OUTSIDE the window (31 days back, 15 days ahead): hidden.
select pg_temp.ride(pg_temp.id('a6000000', 1), pg_temp.u(1), 1, 3, now() - interval '31 days', 'completed');
select pg_temp.ride(pg_temp.id('a6000000', 2), pg_temp.u(2), 1, 3, now() + interval '15 days');
-- R6b: a3 -> a1, two drivers, just INSIDE the window (29 days back, 13 days ahead): shown, score 2.
select pg_temp.ride(pg_temp.id('a6100000', 1), pg_temp.u(1), 3, 1, now() - interval '29 days', 'completed');
select pg_temp.ride(pg_temp.id('a6100000', 2), pg_temp.u(2), 3, 1, now() + interval '13 days');
-- R7: same area at both ends, and R8: unknown origin area, two drivers each: hidden.
select pg_temp.ride(pg_temp.id('a7000000', 1), pg_temp.u(1), 2, 2, now() + interval '1 day');
select pg_temp.ride(pg_temp.id('a7000000', 2), pg_temp.u(2), 2, 2, now() + interval '2 days');
select pg_temp.ride(pg_temp.id('a8000000', 1), pg_temp.u(1), null, 4, now() + interval '1 day');
select pg_temp.ride(pg_temp.id('a8000000', 2), pg_temp.u(2), null, 4, now() + interval '2 days');

-- Tests -----------------------------------------------------------------------------------------------------------
select cmp_ok((select count(*) from ar), '=', 5::bigint, 'the gazetteer migration provides at least five areas');

select has_function('app', 'popular_routes', array['timestamp with time zone', 'integer'], 'app.popular_routes exists');
select has_index('app', 'rides', 'rides_popular_idx', 'the popular-routes index exists');
select ok(
  (select indexdef from pg_indexes where schemaname = 'app' and indexname = 'rides_popular_idx')
    like '%(origin_area_id, destination_area_id, departure_at)%'
  and (select indexdef from pg_indexes where schemaname = 'app' and indexname = 'rides_popular_idx') like '%published%'
  and (select indexdef from pg_indexes where schemaname = 'app' and indexname = 'rides_popular_idx') like '%completed%',
  'the index covers (origin_area_id, destination_area_id, departure_at) and is partial on published/completed');

select ok(
  (select provolatile = 's' and proconfig::text like '%search_path%'
     from pg_proc where oid = 'app.popular_routes(timestamptz, integer)'::regprocedure),
  'popular_routes is STABLE with a pinned search_path');
select ok(
  not has_function_privilege('anon', 'app.popular_routes(timestamptz, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app.popular_routes(timestamptz, integer)', 'EXECUTE')
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   where p.oid = 'app.popular_routes(timestamptz, integer)'::regprocedure and x.grantee = 0),
  'anon, authenticated and PUBLIC have no EXECUTE');
select ok(has_function_privilege('haide_api', 'app.popular_routes(timestamptz, integer)', 'EXECUTE'),
  'the API role can call it');
select is(
  (select proargnames::text from pg_proc where oid = 'app.popular_routes(timestamptz, integer)'::regprocedure),
  '{p_now,p_limit,origin_area,destination_area,ride_count,booking_count,score}',
  'it returns area ids and counts only (no driver, passenger or ride ids)');

-- Position is taken from the function's own output order, before any join can reorder rows.
create temp table res as
  with p as (select f.*, row_number() over () as pos from app.popular_routes(now(), 10) f)
  select ao.n as o, ad.n as d, p.ride_count, p.booking_count, p.score, p.pos
  from p
  join ar ao on ao.id = p.origin_area
  join ar ad on ad.id = p.destination_area;

select is((select array_agg(o || '>' || d order by pos) from res),
  array['1>2', '2>3', '3>1', '3>4'],
  'ranking: score 6 first, then the score-2 tie ordered by origin then destination area name');
select is((select ride_count || '/' || booking_count || '/' || score from res where o = 1 and d = 2), '3/3/6',
  'score = rides + confirmed/completed bookings (requested and cancelled bookings do not count)');
select is((select count(*) from res where o = 4 and d = 5), 0::bigint, 'a route with one driver is hidden');
select is((select count(*) from res where o = 5 and d = 1), 0::bigint,
  'a cancelled ride does not count: one distinct driver is left, so the route is hidden');
select is((select count(*) from res where o = 1 and d = 3), 0::bigint, 'rides 31 days back and 15 days ahead are outside the window');
select is((select ride_count from res where o = 3 and d = 1), 2, 'rides 29 days back and 13 days ahead are inside the window');
select is((select count(*) from res where o = d or o is null or d is null), 0::bigint,
  'same-area and unknown-area rides never form a route');

select is(
  (select count(*) from app.popular_routes(now(), 2) p join ar on ar.id = p.origin_area), 2::bigint,
  'p_limit 2 returns two rows');
select ok(
  (select count(*) from app.popular_routes(now(), 0)) = 1
  and (select count(*) from app.popular_routes(now(), 99)) <= 10
  and (select count(*) from app.popular_routes(now(), null)) <= 5,
  'p_limit is clamped to 1..10 and defaults to 5 when null');

select * from finish();
rollback;
