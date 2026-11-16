-- E3 search and matching: blocks table, grants, and app.match_rides (ADR 0015) against fixture routes.
-- Fixed clock: now = 04:00Z, desired departure = 05:30Z, default window 05:00Z to 06:00Z (Nov 2026).
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

-- Fixtures: profiles ------------------------------------------------------------------------------------------------
-- d1 and d2: ordinary drivers. p: the passenger. d4: suspended. d5: blocked by p. d6: has blocked p. d7: loop driver.
insert into app.profiles (id, status) values
  ('00000000-0000-4000-8000-000000000401', 'active'),
  ('00000000-0000-4000-8000-000000000402', 'active'),
  ('00000000-0000-4000-8000-000000000403', 'active'),
  ('00000000-0000-4000-8000-000000000404', 'suspended'),
  ('00000000-0000-4000-8000-000000000405', 'active'),
  ('00000000-0000-4000-8000-000000000406', 'active'),
  ('00000000-0000-4000-8000-000000000407', 'active');

insert into app.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000405'),
  ('00000000-0000-4000-8000-000000000406', '00000000-0000-4000-8000-000000000403');

-- Fixtures: routes. 'a' is Trip A (Cisnadie to Piata Mare via Selimbar, pricing.md section 5, same vertices as the
-- routing fixture), 'a_shift' the same road moved 0.003 degrees (about 230 m) east, 'loop' a rectangle that ends
-- next to where it starts (pickup mid-loop, the stop near the start is passed twice).
create temp table fx_route as
with a as (
  select ST_GeomFromText(
    'LINESTRING(24.151 45.709, 24.1585 45.7152, 24.1698 45.7261, 24.1792 45.7352, 24.1861 45.7413,
                24.1868 45.7489, 24.1822 45.7566, 24.1741 45.7651, 24.1668 45.7738, 24.1596 45.7826,
                24.1548 45.7909, 24.1505 45.7977)', 4326) as g
)
select 'a'::text as name, g from a
union all select 'a_shift', ST_Translate(g, 0.003, 0) from a
union all select 'loop', ST_GeomFromText(
  'LINESTRING(24.100 45.780, 24.115 45.780, 24.115 45.795, 24.100 45.795, 24.100 45.7812)', 4326);

-- Fixtures: typed points. o = Shopping City, t = Piata Mare (both a few tens of metres off the road).
create temp table fx_pt as
select * from (values
  ('o',      ST_SetSRID(ST_MakePoint(24.1858, 45.7416), 4326)),
  ('t',      ST_SetSRID(ST_MakePoint(24.1500, 45.7972), 4326)),
  ('o900',   ST_SetSRID(ST_MakePoint(24.1978, 45.7416), 4326)),  -- about 900 m east of the road
  ('o660',   ST_SetSRID(ST_MakePoint(24.1943, 45.7416), 4326)),  -- about 600 m east of the road
  ('tshort', ST_SetSRID(ST_MakePoint(24.1866, 45.7466), 4326)),  -- about 600 m along the road from o
  ('ol',     ST_SetSRID(ST_MakePoint(24.1150, 45.7875), 4326)),  -- middle of the loop
  ('tl',     ST_SetSRID(ST_MakePoint(24.1008, 45.7802), 4326))   -- near the start, passed twice
) v(name, g);

-- Fixtures: rides. The last two hex characters of the id name the case.
insert into app.rides (id, driver_id, origin, destination, origin_label, destination_label, route, distance_m,
                       duration_s, departure_at, seats_offered, seats_booked, status, cancelled_at,
                       energy_price_id, rate_micro_per_km, vehicle_snapshot)
select v.id::uuid, v.driver::uuid, ST_StartPoint(r.g), ST_EndPoint(r.g), 'a', 'b', r.g, v.dist, v.dur,
       v.dep::timestamptz, v.offered, v.booked, v.status::app.ride_status,
       case when v.status = 'cancelled' then v.dep::timestamptz end,
       (select id from app.energy_prices where fuel_type = 'diesel'), 651000,
       '{"make":"Dacia","model":"Logan","colour":"Grey","plate":"SB12ABC","fuelType":"diesel"}'::jsonb
from (values
  -- id,                                      driver,                                   route,     dist,  dur,  departure,             seats, booked, status
  ('00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-000000000401', 'a',       11514, 1020, '2026-11-20T05:40:00Z', 3, 0, 'published'),
  ('00000000-0000-4000-8000-0000000003a2', '00000000-0000-4000-8000-000000000402', 'a',       11514, 1020, '2026-11-20T05:25:00Z', 3, 0, 'published'),
  ('00000000-0000-4000-8000-0000000003a3', '00000000-0000-4000-8000-000000000402', 'a_shift', 11514, 1020, '2026-11-20T05:30:00Z', 3, 0, 'published'),
  ('00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-000000000402', 'a',       11514, 1020, '2026-11-20T05:30:00Z', 2, 2, 'published'),
  ('00000000-0000-4000-8000-0000000003c1', '00000000-0000-4000-8000-000000000402', 'a',       11514, 1020, '2026-11-20T05:30:00Z', 3, 0, 'cancelled'),
  ('00000000-0000-4000-8000-0000000003d1', '00000000-0000-4000-8000-000000000401', 'a',       11514, 1020, '2026-11-20T03:30:00Z', 3, 0, 'published'),
  ('00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-000000000401', 'a',       11514, 1020, '2026-11-20T06:00:00Z', 3, 0, 'published'),
  ('00000000-0000-4000-8000-0000000003ee', '00000000-0000-4000-8000-000000000401', 'a',       11514, 1020, '2026-11-20T07:30:00Z', 3, 0, 'published'),
  ('00000000-0000-4000-8000-00000000035a', '00000000-0000-4000-8000-000000000404', 'a',       11514, 1020, '2026-11-20T05:30:00Z', 3, 0, 'published'),
  ('00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-000000000405', 'a',       11514, 1020, '2026-11-20T05:30:00Z', 3, 0, 'published'),
  ('00000000-0000-4000-8000-0000000003b2', '00000000-0000-4000-8000-000000000406', 'a',       11514, 1020, '2026-11-20T05:30:00Z', 3, 0, 'published'),
  ('00000000-0000-4000-8000-00000000031a', '00000000-0000-4000-8000-000000000407', 'loop',     5500,  600, '2026-11-20T05:30:00Z', 3, 0, 'published')
) v(id, driver, route, dist, dur, dep, offered, booked, status)
join fx_route r on r.name = v.route;

-- A ride whose route was coarsened away (retention): published, but no geometry left to match.
insert into app.rides (id, driver_id, origin, destination, origin_label, destination_label, route, distance_m,
                       duration_s, departure_at, seats_offered, energy_price_id, rate_micro_per_km, vehicle_snapshot)
values ('00000000-0000-4000-8000-00000000030a', '00000000-0000-4000-8000-000000000401',
        ST_SetSRID(ST_MakePoint(24.1861, 45.7413), 4326), ST_SetSRID(ST_MakePoint(24.1505, 45.7977), 4326),
        'a', 'b', null, 11514, 1020, '2026-11-20T05:30:00Z', 3,
        (select id from app.energy_prices where fuel_type = 'diesel'), 651000,
        '{"make":"Dacia","model":"Logan","colour":"Grey","plate":"SB12ABC","fuelType":"diesel"}'::jsonb);

-- Helpers: ids of the matches as 'a2,a1,...' in result order, and a one-line summary of a single-ride re-check.
create function pg_temp.ids(
  p_o text, p_t text, p_searcher uuid default null,
  p_from timestamptz default '2026-11-20T05:00:00Z', p_to timestamptz default '2026-11-20T06:00:00Z')
returns text language sql stable as $$
  select coalesce(string_agg(right(m.ride_id::text, 2), ','), '')
  from app.match_rides(
    (select g from fx_pt where name = p_o), (select g from fx_pt where name = p_t),
    p_from, p_to, '2026-11-20T05:30:00Z', p_searcher, '2026-11-20T04:00:00Z') m
$$;

create function pg_temp.one(p_ride text, p_o text, p_t text, p_searcher uuid default null, p_include boolean default false)
returns text language sql stable as $$
  select coalesce(string_agg(m.ride_status || '|' || m.seats_booked || '/' || m.seats_offered || '|' || m.blocked::text, ';'), 'none')
  from app.match_rides(
    (select g from fx_pt where name = p_o), (select g from fx_pt where name = p_t),
    '2026-11-20T05:00:00Z', '2026-11-20T06:00:00Z', '2026-11-20T05:30:00Z', p_searcher, '2026-11-20T04:00:00Z',
    ('00000000-0000-4000-8000-0000000003' || p_ride)::uuid, p_include) m
$$;

-- Snapshots of one passenger search (Trip A, a2) and of the loop search, for the property checks below.
create temp table fx_a2 as
select m.* from app.match_rides(
  (select g from fx_pt where name = 'o'), (select g from fx_pt where name = 't'),
  '2026-11-20T05:00:00Z', '2026-11-20T06:00:00Z', '2026-11-20T05:30:00Z',
  '00000000-0000-4000-8000-000000000403', '2026-11-20T04:00:00Z') m
where m.ride_id = '00000000-0000-4000-8000-0000000003a2';

create temp table fx_loop as
select m.* from app.match_rides(
  (select g from fx_pt where name = 'ol'), (select g from fx_pt where name = 'tl'),
  '2026-11-20T05:00:00Z', '2026-11-20T06:00:00Z', '2026-11-20T05:30:00Z',
  '00000000-0000-4000-8000-000000000403', '2026-11-20T04:00:00Z') m;

-- Blocks table: structure, RLS, grants --------------------------------------------------------------------------------
select has_table('app', 'blocks', 'blocks exists');
select ok((select relrowsecurity from pg_class where oid = 'app.blocks'::regclass),
  'blocks has row level security enabled');
select is(
  (select count(*) from pg_policy p where p.polrelid = 'app.blocks'::regclass),
  0::bigint, 'blocks has no RLS policies (deny-all)');
select ok(
  not has_table_privilege('anon', 'app.blocks', 'SELECT') and not has_table_privilege('authenticated', 'app.blocks', 'SELECT')
  and not has_table_privilege('anon', 'app.blocks', 'INSERT') and not has_table_privilege('authenticated', 'app.blocks', 'INSERT'),
  'blocks is unreachable for anon and authenticated');
select ok(
  has_table_privilege('haide_api', 'app.blocks', 'SELECT') and has_table_privilege('haide_api', 'app.blocks', 'INSERT')
  and has_table_privilege('haide_api', 'app.blocks', 'DELETE'),
  'haide_api can read, add and remove blocks');
select throws_ok(
  $$insert into app.blocks (blocker_id, blocked_id)
    values ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000403')$$,
  '23514', null, 'nobody can block themselves');
select throws_ok(
  $$insert into app.blocks (blocker_id, blocked_id)
    values ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000405')$$,
  '23505', null, 'one block per pair');
select has_index('app', 'blocks', 'blocks_blocked_idx', 'reverse block lookup index exists');
select throws_ok(
  $$insert into app.blocks (blocker_id, blocked_id)
    values ('00000000-0000-4000-8000-000000000403', gen_random_uuid())$$,
  '23503', null, 'a block must reference a real profile');

-- Function grants -------------------------------------------------------------------------------------------------------
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'app' and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  0::bigint, 'no app function is executable by PUBLIC');
select ok(
  not has_function_privilege('anon', (select oid from pg_proc where proname = 'match_rides' and pronamespace = 'app'::regnamespace), 'EXECUTE')
  and not has_function_privilege('authenticated', (select oid from pg_proc where proname = 'match_rides' and pronamespace = 'app'::regnamespace), 'EXECUTE'),
  'match_rides is not callable by anon or authenticated');
select ok(
  has_function_privilege('haide_api', (select oid from pg_proc where proname = 'match_rides' and pronamespace = 'app'::regnamespace), 'EXECUTE'),
  'haide_api can call match_rides');
select ok(
  (select provolatile = 's' from pg_proc where proname = 'match_rides' and pronamespace = 'app'::regnamespace),
  'match_rides is STABLE');

-- Matching: Trip A, passenger Shopping City to Piata Mare ---------------------------------------------------------------
-- p = 403 searches. a2 (5 min before), a1 (10 min after), e1 (exactly at the end of the window) share the best walk;
-- a3 is the same road 230 m east with the perfect time, so it comes last: walk first, then time.
select is(pg_temp.ids('o', 't', '00000000-0000-4000-8000-000000000403'), 'a2,a1,e1,a3',
  'Trip A matches Shopping City to Piata Mare, ordered by walk then by time (window end is inclusive)');
select doesnt_match(pg_temp.ids('o', 't', '00000000-0000-4000-8000-000000000403'), 'f1', 'a full ride is excluded');
select doesnt_match(pg_temp.ids('o', 't', '00000000-0000-4000-8000-000000000403'), 'c1', 'a cancelled ride is excluded');
select doesnt_match(pg_temp.ids('o', 't', '00000000-0000-4000-8000-000000000403'), '5a', 'a suspended driver is excluded');
select doesnt_match(pg_temp.ids('o', 't', '00000000-0000-4000-8000-000000000403'), 'ee', 'a ride outside the time window is excluded');
select doesnt_match(pg_temp.ids('o', 't', '00000000-0000-4000-8000-000000000403'), '0a', 'a ride without a stored route is excluded');
select doesnt_match(pg_temp.ids('o', 't', '00000000-0000-4000-8000-000000000403'), 'b1', 'a driver the searcher blocked is excluded');
select doesnt_match(pg_temp.ids('o', 't', '00000000-0000-4000-8000-000000000403'), 'b2', 'a driver who blocked the searcher is excluded');
select is(pg_temp.ids('o', 't', '00000000-0000-4000-8000-000000000401'), 'b1,b2,a2,a3',
  'own rides are excluded (driver 401 searching); equal walk and time fall back to the ride id');
select is(pg_temp.ids('o', 't'), 'b1,b2,a2,a1,e1,a3',
  'signed out (no searcher): nobody is hidden for ownership or blocks');
select is(pg_temp.ids('t', 'o', '00000000-0000-4000-8000-000000000403'), '',
  'the reverse direction (Piata Mare to Shopping City) does not match');
select doesnt_match(pg_temp.ids('o900', 't', '00000000-0000-4000-8000-000000000403'), '(a1|a2|e1)',
  'a pickup 900 m from the road does not match (800 m limit)');
select like(pg_temp.ids('o660', 't', '00000000-0000-4000-8000-000000000403'), '%a2%',
  'a pickup about 650 m from the road matches');
select is(pg_temp.ids('o', 'tshort', '00000000-0000-4000-8000-000000000403'), '',
  'a segment under 1 km does not match');

-- Matching: loop route (dropoff must come after the pickup) -------------------------------------------------------------
select is((select string_agg(right(ride_id::text, 2), ',') from fx_loop), '1a',
  'the loop route matches a pickup mid-loop and a dropoff near its start');
select ok((select f_dropoff > f_pickup from fx_loop), 'the dropoff comes after the pickup along the route');
select ok((select f_dropoff > 0.9 from fx_loop), 'the loop picks the later pass near its end, not the early one');
select ok(
  (select ST_LineLocatePoint(r.route_utm, ST_Transform((select g from fx_pt where name = 'tl'), 32635)) < l.f_pickup
     from app.rides r, fx_loop l where r.id = '00000000-0000-4000-8000-00000000031a'),
  'fixture check: a plain nearest-point lookup would put the dropoff BEFORE the pickup');
select ok((select segment_m between 3000 and 4000 from fx_loop),
  'the loop segment is the 3.5 km from mid-loop to the end, not a wrapped-around value');

-- Single-ride re-check (ride_id) -----------------------------------------------------------------------------------------
select is(pg_temp.one('c1', 'o', 't'), 'cancelled|0/3|false',
  'single-ride mode returns a cancelled ride with its state');
select is(pg_temp.one('f1', 'o', 't'), 'published|2/2|false',
  'single-ride mode returns a full ride with its seat counts');
select is(pg_temp.one('a2', 'o', 't', '00000000-0000-4000-8000-000000000402'), 'published|0/3|false',
  'single-ride mode does not hide the searcher''s own ride');
select is(pg_temp.one('a2', 't', 'o'), 'none', 'single-ride mode still applies the geometry (reverse direction)');
select is(pg_temp.one('5a', 'o', 't'), 'none', 'single-ride mode still hides a suspended driver');
select is(pg_temp.one('b1', 'o', 't', '00000000-0000-4000-8000-000000000403'), 'none',
  'single-ride mode drops a blocked pair unless asked to flag it');
select is(pg_temp.one('b1', 'o', 't', '00000000-0000-4000-8000-000000000403', true), 'published|0/3|true',
  'single-ride mode flags a blocked pair when asked');
select is(pg_temp.one('d1', 'o', 't'), 'published|0/3|false',
  'single-ride mode ignores the window and the departure time (the caller names the reason)');

-- include_blocked ---------------------------------------------------------------------------------------------------------
select is(
  (select string_agg(right(m.ride_id::text, 2), ',' order by m.ride_id) filter (where m.blocked)
     from app.match_rides((select g from fx_pt where name = 'o'), (select g from fx_pt where name = 't'),
       '2026-11-20T05:00:00Z', '2026-11-20T06:00:00Z', '2026-11-20T05:30:00Z',
       '00000000-0000-4000-8000-000000000403', '2026-11-20T04:00:00Z', null, true) m),
  'b1,b2', 'include_blocked flags exactly the blocked rides (either direction)');
select is(
  (select count(*) from app.match_rides((select g from fx_pt where name = 'o'), (select g from fx_pt where name = 't'),
       '2026-11-20T05:00:00Z', '2026-11-20T06:00:00Z', '2026-11-20T05:30:00Z',
       '00000000-0000-4000-8000-000000000403', '2026-11-20T04:00:00Z', null, true)),
  6::bigint, 'include_blocked returns the blocked rides in addition to the 4 visible ones');

-- Window, exclusion range, departed rides, limit ---------------------------------------------------------------------------
select is(
  (select coalesce(string_agg(right(m.ride_id::text, 2), ','), '')
     from app.match_rides((select g from fx_pt where name = 'o'), (select g from fx_pt where name = 't'),
       '2026-11-20T00:00:00Z', '2026-11-20T23:59:59.999Z', '2026-11-20T05:30:00Z',
       '00000000-0000-4000-8000-000000000403', '2026-11-20T04:00:00Z', null, false,
       '2026-11-20T05:00:00Z', '2026-11-20T06:00:00Z') m),
  'ee', 'a whole-day window minus the requested window leaves only the ride outside it (nearest-rides query)');
select doesnt_match(pg_temp.ids('o', 't', '00000000-0000-4000-8000-000000000403', '2026-11-20T05:00:00Z', '2026-11-20T05:59:59Z'),
  'e1', 'a ride one second after the window end is excluded');
select doesnt_match(pg_temp.ids('o', 't', '00000000-0000-4000-8000-000000000403', '2026-11-20T03:00:00Z', '2026-11-20T06:00:00Z'),
  'd1', 'a ride that has already departed is excluded even when the window covers it');
select is(
  (select string_agg(right(m.ride_id::text, 2), ',')
     from app.match_rides((select g from fx_pt where name = 'o'), (select g from fx_pt where name = 't'),
       '2026-11-20T05:00:00Z', '2026-11-20T06:00:00Z', '2026-11-20T05:30:00Z',
       '00000000-0000-4000-8000-000000000403', '2026-11-20T04:00:00Z', null, false, null, null, 800, 1000, 1) m),
  'a2', 'the limit keeps the best match only');

-- What leaves the function (privacy, derived values) ------------------------------------------------------------------------
select ok(
  (select ST_Equals(
            app.grid_point(ST_SetSRID(ST_MakePoint(pickup_lng, pickup_lat), 4326), 300),
            ST_SetSRID(ST_MakePoint(pickup_lng, pickup_lat), 4326)) from fx_a2),
  'the pickup point is a 300 m grid centre (grid_point leaves it unchanged)');
select ok(
  (select ST_Equals(
            app.grid_point(ST_SetSRID(ST_MakePoint(dropoff_lng, dropoff_lat), 4326), 300),
            ST_SetSRID(ST_MakePoint(dropoff_lng, dropoff_lat), 4326)) from fx_a2),
  'the dropoff point is a 300 m grid centre');
select ok((select pickup_area is not null and dropoff_area is not null from fx_a2),
  'pickup and dropoff carry an area label');
select ok(
  (select abs(extract(epoch from (pickup_eta_at - departure_at)) - duration_s * f_pickup) < 1
          and f_pickup between 0.3 and 0.5 from fx_a2),
  'the pickup ETA is the departure plus the duration times the pickup fraction');
select ok(
  (select segment_m = round(distance_m * (f_dropoff - f_pickup)) and segment_m between 6500 and 7500 from fx_a2),
  'the segment is the router distance scaled by the route fraction (about 7 km for Trip A)');
select ok((select walk_pickup_m < 100 and walk_dropoff_m < 100 from fx_a2),
  'walks to and from the road are well under the 800 m limit for points a few tens of metres away');

-- Execution as the API role ---------------------------------------------------------------------------------------------------
set local role haide_api;
select lives_ok(
  $$select count(*) from app.match_rides(
      ST_SetSRID(ST_MakePoint(24.1858, 45.7416), 4326), ST_SetSRID(ST_MakePoint(24.1500, 45.7972), 4326),
      '2026-11-20T05:00:00Z', '2026-11-20T06:00:00Z', '2026-11-20T05:30:00Z', null, '2026-11-20T04:00:00Z')$$,
  'haide_api can run match_rides');
reset role;

select * from finish();
rollback;
