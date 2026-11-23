-- My rides, "Canceled" tab (improvement 5): app.rides.cancelled_by (driver | system, nullable) and the access
-- model the per-user scoping relies on: RLS on, no policies, no grants for anon/authenticated. The API role
-- bypasses RLS, so isolation is `driver_id = me` / `passenger_id = me` in every query (integration-tested).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

create function pg_temp.u(n integer) returns uuid language sql as
  $$ select ('00000000-0000-4000-8000-0000000014' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.id(n integer) returns uuid language sql as
  $$ select ('c4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

insert into auth.users (id, instance_id, aud, role, email)
select pg_temp.u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cb' || n || '@example.com'
from generate_series(1, 2) n;

create function pg_temp.ride(p_id uuid, p_status text, p_by text default null)
returns void language sql as $$
  insert into app.rides (id, driver_id, origin, destination, origin_label, destination_label,
                         route, distance_m, duration_s, departure_at, seats_offered, seats_booked,
                         energy_price_id, rate_micro_per_km, vehicle_snapshot, status, cancelled_at, cancelled_by,
                         created_at, updated_at)
  values (p_id, pg_temp.u(1),
          ST_SetSRID(ST_MakePoint(24.1861, 45.7413), 4326), ST_SetSRID(ST_MakePoint(24.09, 45.785), 4326),
          'Origin', 'Destination',
          ST_GeomFromText('LINESTRING(24.1861 45.7413, 24.15 45.76, 24.12 45.775, 24.09 45.785)', 4326),
          9588, 1020, now() + interval '2 days', 3, 0,
          (select id from app.energy_prices where fuel_type = 'diesel'), 651000,
          '{"fuelType":"diesel"}'::jsonb, p_status::app.ride_status,
          case when p_status = 'cancelled' then now() end, p_by, now(), now())
$$;

-- Column and constraint ------------------------------------------------------------------------------------------
select has_column('app', 'rides', 'cancelled_by', 'rides.cancelled_by exists');
select col_type_is('app', 'rides', 'cancelled_by', 'text', 'rides.cancelled_by is text');
select col_is_null('app', 'rides', 'cancelled_by', 'rides.cancelled_by is nullable (old rows stay NULL)');
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'app.rides'::regclass and conname = 'rides_cancelled_by_check')
  like '%driver%' and
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'app.rides'::regclass and conname = 'rides_cancelled_by_check')
  like '%system%',
  'rides_cancelled_by_check allows driver and system');

select lives_ok($$select pg_temp.ride(pg_temp.id(1), 'cancelled', 'driver')$$, 'a driver-cancelled ride is accepted');
select lives_ok($$select pg_temp.ride(pg_temp.id(2), 'cancelled', 'system')$$, 'a system-cancelled ride is accepted');
select lives_ok($$select pg_temp.ride(pg_temp.id(3), 'cancelled', null)$$, 'an old cancelled ride with NULL cancelled_by is accepted');
select throws_ok($$select pg_temp.ride(pg_temp.id(4), 'cancelled', 'passenger')$$, '23514', null,
  'cancelled_by = passenger is rejected for a ride');
select throws_ok($$select pg_temp.ride(pg_temp.id(5), 'cancelled', 'admin')$$, '23514', null,
  'an unknown cancelled_by is rejected');

-- Access model: the scoping lives in the API queries, so the tables must not be reachable otherwise ------------
select ok(
  (select relrowsecurity from pg_class where oid = 'app.rides'::regclass)
  and (select relrowsecurity from pg_class where oid = 'app.bookings'::regclass),
  'rides and bookings have row level security enabled');
select is((select count(*) from pg_policies where schemaname = 'app' and tablename in ('rides', 'bookings')), 0::bigint,
  'rides and bookings have no policies (anon and authenticated see nothing)');
select ok(
  not has_table_privilege('anon', 'app.rides', 'SELECT') and not has_table_privilege('authenticated', 'app.rides', 'SELECT')
  and not has_table_privilege('anon', 'app.bookings', 'SELECT') and not has_table_privilege('authenticated', 'app.bookings', 'SELECT'),
  'anon and authenticated have no SELECT on rides or bookings');
select ok(
  has_table_privilege('haide_api', 'app.rides', 'UPDATE') and has_table_privilege('haide_api', 'app.rides', 'SELECT'),
  'the API role can read and update rides (it writes cancelled_by)');

select * from finish();
rollback;
