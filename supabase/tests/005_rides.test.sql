-- E2 rides schema: RLS, grants, immutability of energy prices, constraints, indexes, route helpers.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

-- Structure, RLS and public-role grants ---------------------------------------------------------------
select has_table('app', t::name, t || ' exists')
  from unnest(array['energy_prices', 'route_previews', 'rides']) t;

select ok(
  (select relrowsecurity from pg_class where oid = ('app.' || t)::regclass),
  t || ' has row level security enabled')
  from unnest(array['energy_prices', 'route_previews', 'rides']) t;

select is(
  (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname in ('energy_prices', 'route_previews', 'rides')),
  0::bigint, 'new tables have no RLS policies (deny-all)');

select ok(
  not has_table_privilege('anon', ('app.' || t)::regclass, 'SELECT')
  and not has_table_privilege('authenticated', ('app.' || t)::regclass, 'SELECT')
  and not has_table_privilege('anon', ('app.' || t)::regclass, 'INSERT')
  and not has_table_privilege('authenticated', ('app.' || t)::regclass, 'INSERT'),
  t || ' is unreachable for anon and authenticated')
  from unnest(array['energy_prices', 'route_previews', 'rides']) t;

-- haide_api grants ---------------------------------------------------------------------------------------
select ok(has_table_privilege('haide_api', 'app.energy_prices', 'SELECT')
  and has_table_privilege('haide_api', 'app.energy_prices', 'INSERT'),
  'haide_api can read and append energy prices');
select ok(not has_table_privilege('haide_api', 'app.energy_prices', 'UPDATE')
  and not has_table_privilege('haide_api', 'app.energy_prices', 'DELETE'),
  'energy prices are immutable for haide_api (new versions only)');
select ok(has_table_privilege('haide_api', 'app.rides', 'INSERT')
  and has_table_privilege('haide_api', 'app.rides', 'UPDATE')
  and has_table_privilege('haide_api', 'app.route_previews', 'INSERT')
  and has_table_privilege('haide_api', 'app.route_previews', 'DELETE'),
  'haide_api can write rides and route previews');

-- Functions: nothing executable by PUBLIC, anon or authenticated; haide_api can call them -----------
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'app' and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  0::bigint, 'no app function is executable by PUBLIC');
select ok(not has_function_privilege('anon', 'app.simplify_route(geometry, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app.simplify_route(geometry, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'app.public_route(geometry)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app.public_route(geometry)', 'EXECUTE'),
  'route helpers are not callable by anon or authenticated');
select ok(has_function_privilege('haide_api', 'app.simplify_route(geometry, integer)', 'EXECUTE')
  and has_function_privilege('haide_api', 'app.public_route(geometry)', 'EXECUTE'),
  'haide_api can call the route helpers');
select ok(
  (select provolatile = 'i' and proisstrict from pg_proc where oid = 'app.public_route(geometry)'::regprocedure),
  'public_route is IMMUTABLE and STRICT');

-- Seed: energy prices v1 (pricing.md section 3) -------------------------------------------------------------
select is(
  (select count(*) from app.energy_prices where effective_from = '2026-11-15T00:00:00Z'),
  5::bigint, 'five energy price rows in v1');
select is(
  (select string_agg(fuel_type || ':' || price_milli || ':' || consumption_centi || ':' || unit, ',' order by fuel_type::text)
     from app.energy_prices where effective_from = '2026-11-15T00:00:00Z'),
  'diesel:10850:600:l,electric:1400:1700:kWh,hybrid:9810:500:l,lpg:4760:900:l,petrol:9810:700:l',
  'v1 prices and reference consumptions match pricing.md');
select throws_ok(
  $$insert into app.energy_prices (fuel_type, price_milli, consumption_centi, unit, effective_from)
    values ('petrol', 9900, 700, 'l', '2026-11-15T00:00:00Z')$$,
  '23505', null, 'one price per fuel and effective date');
select throws_ok(
  $$insert into app.energy_prices (fuel_type, price_milli, consumption_centi, unit, effective_from)
    values ('electric', 1400, 1700, 'l', '2027-01-01T00:00:00Z')$$,
  '23514', null, 'electric is priced per kWh');
select throws_ok(
  $$insert into app.energy_prices (fuel_type, price_milli, consumption_centi, unit, effective_from)
    values ('petrol', 0, 700, 'l', '2027-01-01T00:00:00Z')$$,
  '23514', null, 'energy price must be positive');

-- Rides: constraints (as the table owner so grants do not interfere) ------------------------------------------
insert into app.profiles (id) values ('00000000-0000-4000-8000-000000000002');

insert into app.rides (id, driver_id, origin, destination, origin_label, destination_label, route,
                       distance_m, duration_s, departure_at, seats_offered, energy_price_id,
                       rate_micro_per_km, vehicle_snapshot)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000002',
        ST_SetSRID(ST_MakePoint(24.1861, 45.7413), 4326), ST_SetSRID(ST_MakePoint(24.0900, 45.7850), 4326),
        'Șelimbăr', 'Zona Industrială Vest',
        ST_SetSRID(ST_MakeLine(ST_MakePoint(24.1861, 45.7413), ST_MakePoint(24.0900, 45.7850)), 4326),
        9588, 1020, '2026-11-20T05:30:00Z', 3,
        (select id from app.energy_prices where fuel_type = 'diesel'), 651000,
        '{"make":"Dacia","model":"Logan","colour":"Grey","plate":"SB12ABC","fuelType":"diesel"}');

select is(
  (select status::text || '/' || seats_booked || '/' || is_free || '/' || late_cancel
     from app.rides where id = '00000000-0000-4000-8000-0000000000a1'),
  'published/0/false/false', 'a new ride is published, empty, paid and not late-cancelled');
select is(
  (select ST_SRID(route_utm) from app.rides where id = '00000000-0000-4000-8000-0000000000a1'),
  32635, 'route_utm is generated in EPSG:32635');
select ok(
  abs(ST_Length(route_utm) - ST_Length(ST_Transform(route, 32635))) < 0.001, 'route_utm follows the route')
  from app.rides where id = '00000000-0000-4000-8000-0000000000a1';

select throws_ok($$update app.rides set distance_m = 999 where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'a route under 1 km is rejected');
select throws_ok($$update app.rides set distance_m = 40001 where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'a route over 40 km is rejected');
select throws_ok($$update app.rides set seats_offered = 5 where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'at most 4 seats are offered');
select throws_ok($$update app.rides set seats_booked = 4 where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23514', null,
  'seats_booked cannot exceed seats_offered (overbooking backstop)');
select throws_ok($$update app.rides set seats_booked = -1 where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'seats_booked cannot be negative');
select throws_ok($$update app.rides set note = repeat('x', 201) where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'a note is at most 200 characters');
select lives_ok($$update app.rides set note = repeat('ă', 200) where id = '00000000-0000-4000-8000-0000000000a1'$$,
  'a 200-character note with diacritics is accepted');
select throws_ok($$update app.rides set vehicle_snapshot = '[]'::jsonb where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'the vehicle snapshot is a JSON object');
select throws_ok($$update app.rides set rate_micro_per_km = 0 where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'the rate snapshot is positive');
select throws_ok($$update app.rides set status = 'cancelled' where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'a cancelled ride needs cancelled_at');
select throws_ok($$update app.rides set late_cancel = true where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23514', null, 'late_cancel only applies to cancelled rides');
select lives_ok(
  $$update app.rides set status = 'cancelled', cancelled_at = now(), late_cancel = true
    where id = '00000000-0000-4000-8000-0000000000a1'$$,
  'a late-cancelled ride is valid');
select throws_ok($$delete from app.profiles where id = '00000000-0000-4000-8000-000000000002'$$,
  '23503', null, 'a driver with rides cannot be deleted (RESTRICT)');
select throws_ok(
  $$update app.rides set energy_price_id = gen_random_uuid() where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23503', null, 'the energy price snapshot must reference a real version');

-- route_previews ------------------------------------------------------------------------------------------------
select throws_ok(
  $$insert into app.route_previews (driver_id, origin, destination, origin_label, destination_label, route,
                                    distance_m, duration_s, provider, created_at, expires_at)
    values ('00000000-0000-4000-8000-000000000002',
            ST_SetSRID(ST_MakePoint(24.1861, 45.7413), 4326), ST_SetSRID(ST_MakePoint(24.0900, 45.7850), 4326),
            'a', 'b',
            ST_SetSRID(ST_MakeLine(ST_MakePoint(24.1861, 45.7413), ST_MakePoint(24.0900, 45.7850)), 4326),
            9588, 1020, 'fixture', '2026-11-16T05:00:00Z', '2026-11-16T05:00:00Z')$$,
  '23514', null, 'a preview must expire after it was created');
select lives_ok(
  $$insert into app.route_previews (driver_id, origin, destination, origin_label, destination_label, route,
                                    distance_m, duration_s, provider, created_at, expires_at)
    values ('00000000-0000-4000-8000-000000000002',
            ST_SetSRID(ST_MakePoint(24.1861, 45.7413), 4326), ST_SetSRID(ST_MakePoint(24.0900, 45.7850), 4326),
            'a', 'b',
            ST_SetSRID(ST_MakeLine(ST_MakePoint(24.1861, 45.7413), ST_MakePoint(24.0900, 45.7850)), 4326),
            9588, 1020, 'fixture', '2026-11-16T05:00:00Z', '2026-11-16T05:30:00Z')$$,
  'a 30 minute preview is valid');

-- Indexes (data-model 4.3) ----------------------------------------------------------------------------------------
select has_index('app', 'rides', 'rides_published_departure_idx', 'search prefilter index exists');
select has_index('app', 'rides', 'rides_route_utm_gix', 'corridor GiST index exists');
select has_index('app', 'rides', 'rides_driver_departure_idx', 'driver list and daily limit index exists');
select has_index('app', 'rides', 'rides_coarsen_idx', 'retention index exists');
select has_index('app', 'route_previews', 'route_previews_expires_idx', 'preview expiry index exists');
select ok(
  (select indexdef from pg_indexes where schemaname = 'app' and indexname = 'rides_route_utm_gix') like '%gist%'
  and (select indexdef from pg_indexes where schemaname = 'app' and indexname = 'rides_published_departure_idx')
        like '%published%',
  'the corridor index is GiST and the search index is partial on published rides');

-- Route helpers ------------------------------------------------------------------------------------------------------
select ok(
  ST_NPoints(app.simplify_route(
    ST_SetSRID(ST_MakeLine(array[
      ST_MakePoint(24.1000, 45.7800), ST_MakePoint(24.1010, 45.78003), ST_MakePoint(24.1020, 45.7800),
      ST_MakePoint(24.1030, 45.78002), ST_MakePoint(24.1040, 45.7800)]), 4326), 10)) = 2,
  'simplify_route drops vertices within 10 m of the line');
select ok(
  ST_Distance(
    ST_StartPoint(app.simplify_route(
      ST_SetSRID(ST_MakeLine(ST_MakePoint(24.10, 45.78), ST_MakePoint(24.16, 45.78)), 4326), 10))::geography,
    ST_SetSRID(ST_MakePoint(24.10, 45.78), 4326)::geography) < 0.1,
  'simplify_route keeps the endpoints');
select ok(
  ST_Distance(
    ST_StartPoint(app.public_route(
      ST_SetSRID(ST_MakeLine(ST_MakePoint(24.10, 45.78), ST_MakePoint(24.18, 45.78)), 4326)))::geography,
    ST_SetSRID(ST_MakePoint(24.10, 45.78), 4326)::geography) > 450
  and ST_Distance(
    ST_EndPoint(app.public_route(
      ST_SetSRID(ST_MakeLine(ST_MakePoint(24.10, 45.78), ST_MakePoint(24.18, 45.78)), 4326)))::geography,
    ST_SetSRID(ST_MakePoint(24.18, 45.78), 4326)::geography) > 450,
  'the public route starts and ends at least ~500 m from the exact origin and destination');
select ok(
  ST_Distance(
    ST_StartPoint(app.public_route(
      ST_SetSRID(ST_MakeLine(ST_MakePoint(24.1000, 45.78), ST_MakePoint(24.1155, 45.78)), 4326)))::geography,
    ST_SetSRID(ST_MakePoint(24.1000, 45.78), 4326)::geography) > 100,
  'a short route (about 1.2 km) is trimmed by 10 % at each end');
select ok(app.public_route(null) is null, 'public_route of NULL is NULL');

-- Behaviour as the API role -----------------------------------------------------------------------------------------------
set local role haide_api;
select lives_ok(
  $$insert into app.energy_prices (fuel_type, price_milli, consumption_centi, unit, effective_from, source_note)
    values ('petrol', 10100, 700, 'l', '2027-01-01T00:00:00Z', 'pgTAP new version')$$,
  'haide_api can append a new energy price version');
select throws_ok($$update app.energy_prices set price_milli = 1$$, '42501', null,
  'haide_api cannot update energy prices');
select throws_ok($$delete from app.energy_prices$$, '42501', null,
  'haide_api cannot delete energy prices');
reset role;

select * from finish();
rollback;
