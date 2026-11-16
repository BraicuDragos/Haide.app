-- E6 privacy and compliance schema (e6-privacy-spec section 1, ADRs 0029 to 0031): account_deletions and
-- data_requests, coarsening, the retention proof and its catalog guard, scrub_account, run_retention,
-- export_user_data, and the grants of all of them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(143);

-- Fixtures ---------------------------------------------------------------------------------------------------------
-- Users u(1) D driver, u(2) P passenger, u(5) S scrubbed, u(6) T scrubbed without a photo,
-- u(7) Z deleted just over 3 years ago, u(8) Y deleted just under 3 years ago, u(9) E exported.
-- Rides rd(1)..rd(9), bookings bk(1)..bk(7).
create function pg_temp.u(n integer) returns uuid language sql as
  $$ select ('00000000-0000-4000-8000-0000000009' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.rd(n integer) returns uuid language sql as
  $$ select ('00000000-0000-4000-8000-00000000a0' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.bk(n integer) returns uuid language sql as
  $$ select ('00000000-0000-4000-8000-00000000b0' || lpad(n::text, 2, '0'))::uuid $$;

insert into auth.users (id, instance_id, aud, role, email) values
  (pg_temp.u(1), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'driver9@example.com'),
  (pg_temp.u(2), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p9@example.com'),
  (pg_temp.u(5), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's9@example.com'),
  (pg_temp.u(6), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't9@example.com'),
  (pg_temp.u(7), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'z9@example.com'),
  (pg_temp.u(8), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'y9@example.com'),
  (pg_temp.u(9), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'export@example.com');

update app.profiles set first_name = 'Radu', phone_e164 = '+40733000001' where id = pg_temp.u(1);
update app.profiles set first_name = 'Ioana', phone_e164 = '+40744000002' where id = pg_temp.u(2);
update app.profiles set first_name = 'Ana', phone_e164 = '+40721234567', bio = 'Hello',
  photo_path = 'avatars/6f1d8a5e-0000-4000-8000-000000000905.jpg', role = 'admin' where id = pg_temp.u(5);
update app.profiles set first_name = 'Tudor', phone_e164 = '+40755000003' where id = pg_temp.u(6);
update app.profiles set first_name = 'Eva', phone_e164 = '+40766000004', bio = 'export me' where id = pg_temp.u(9);
update app.profiles set status = 'deleted', deleted_at = now() - interval '3 years' - interval '1 day' where id = pg_temp.u(7);
update app.profiles set status = 'deleted', deleted_at = now() - interval '3 years' + interval '1 day' where id = pg_temp.u(8);

-- One real area, so a coarsened label can be compared with its name.
create temp table fx_area as select id, name from app.areas order by name limit 1;

-- A ride at the given departure. Exact points and street labels on purpose: coarsening must remove them.
create function pg_temp.ride(p_id uuid, p_driver uuid, p_departure timestamptz,
  p_status text default 'completed', p_note text default null)
returns void language sql as $$
  insert into app.rides (id, driver_id, origin, destination, origin_label, destination_label,
                         origin_area_id, destination_area_id, route, distance_m, duration_s, departure_at,
                         seats_offered, note, energy_price_id, rate_micro_per_km, vehicle_snapshot, status, completed_at)
  values (p_id, p_driver,
          ST_SetSRID(ST_MakePoint(24.15123, 45.70987), 4326), ST_SetSRID(ST_MakePoint(24.18654, 45.74321), 4326),
          'Strada Lungă 5', 'Piața Mare 1', (select id from fx_area), (select id from fx_area),
          ST_GeomFromText('LINESTRING(24.15123 45.70987, 24.17 45.725, 24.18654 45.74321)', 4326),
          5000, 600, p_departure, 3, p_note,
          (select id from app.energy_prices where fuel_type = 'diesel'), 651000,
          '{"make":"Dacia","model":"Logan","colour":"Grey","plate":"SB12ABC","fuelType":"diesel"}'::jsonb,
          p_status::app.ride_status, case when p_status = 'completed' then p_departure + interval '2 hours' end)
$$;

-- A completed booking created at p_created, with exact points.
create function pg_temp.book(p_id uuid, p_passenger uuid, p_ride uuid, p_created timestamptz, p_key text default null)
returns void language sql as $$
  insert into app.bookings (id, ride_id, passenger_id, status, pickup, dropoff, pickup_label, dropoff_label,
    pickup_fraction, dropoff_fraction, segment_m, walk_pickup_m, walk_dropoff_m,
    price_quoted_bani, price_locked_bani, final_price_bani, idempotency_key,
    requested_at, expires_at, decided_at, created_at)
  values (p_id, p_ride, p_passenger, 'completed',
    ST_SetSRID(ST_MakePoint(24.16234, 45.71876), 4326), ST_SetSRID(ST_MakePoint(24.18123, 45.74012), 4326),
    'Șelimbăr', 'Centru', 0.2, 0.9, 3500, 100, 100, 180, 120, 120, p_key,
    p_created, p_created + interval '30 minutes', p_created + interval '5 minutes', p_created)
$$;

-- Coarsening fixtures: rd(1) -91 d (note), rd(2) -89 d (note), rd(3..5) -100, -101, -102 d (no booking).
select pg_temp.ride(pg_temp.rd(1), pg_temp.u(1), now() - interval '91 days', 'completed', 'ring the bell');
select pg_temp.ride(pg_temp.rd(2), pg_temp.u(1), now() - interval '89 days', 'completed', 'ring the bell');
select pg_temp.ride(pg_temp.rd(3), pg_temp.u(1), now() - interval '100 days');
select pg_temp.ride(pg_temp.rd(4), pg_temp.u(1), now() - interval '101 days');
select pg_temp.ride(pg_temp.rd(5), pg_temp.u(1), now() - interval '102 days');
select pg_temp.book(pg_temp.bk(1), pg_temp.u(2), pg_temp.rd(1), now() - interval '92 days', 'key-b91');
select pg_temp.book(pg_temp.bk(2), pg_temp.u(2), pg_temp.rd(2), now() - interval '90 days', 'key-b89');

-- Young rides for the scrub and export tests: rd(6) D -10 d, rd(7) S -5 d, rd(8) S in 3 days, rd(9) E -3 d.
select pg_temp.ride(pg_temp.rd(6), pg_temp.u(1), now() - interval '10 days');
select pg_temp.ride(pg_temp.rd(7), pg_temp.u(5), now() - interval '5 days', 'completed', 'gate code 1234');
select pg_temp.ride(pg_temp.rd(8), pg_temp.u(5), now() + interval '3 days', 'published', 'gate code 1234');
select pg_temp.ride(pg_temp.rd(9), pg_temp.u(9), now() - interval '3 days');
-- bk(3) S on rd(6), bk(4) P on rd(7), bk(5) P on rd(6), bk(6) E on rd(6), bk(7) P on rd(9).
select pg_temp.book(pg_temp.bk(3), pg_temp.u(5), pg_temp.rd(6), now() - interval '11 days', 'key-s');
select pg_temp.book(pg_temp.bk(4), pg_temp.u(2), pg_temp.rd(7), now() - interval '6 days');
select pg_temp.book(pg_temp.bk(5), pg_temp.u(2), pg_temp.rd(6), now() - interval '11 days');
select pg_temp.book(pg_temp.bk(6), pg_temp.u(9), pg_temp.rd(6), now() - interval '11 days');
select pg_temp.book(pg_temp.bk(7), pg_temp.u(2), pg_temp.rd(9), now() - interval '4 days');

-- Snapshots to prove what coarsening keeps and what it leaves alone.
create temp table fx_rides_before as
  select r.id, to_jsonb(r) as j from app.rides r where r.id in (select pg_temp.rd(n) from generate_series(1, 5) n);
create temp table fx_bookings_before as
  select b.id, to_jsonb(b) as j from app.bookings b where b.id in (pg_temp.bk(1), pg_temp.bk(2));

-- Scrub fixtures (S) and the data every other test needs.
insert into app.vehicles (owner_id, make, model, colour, plate, fuel_type, seats) values
  (pg_temp.u(5), 'Dacia', 'Logan', 'Grey', 'SB12ABC', 'diesel', 3),
  (pg_temp.u(9), 'Skoda', 'Fabia', 'Blue', 'SB99XYZ', 'petrol', 3);
insert into app.route_previews (driver_id, origin, destination, origin_label, destination_label, route,
                                distance_m, duration_s, provider, expires_at)
values (pg_temp.u(5), ST_SetSRID(ST_MakePoint(24.15123, 45.70987), 4326), ST_SetSRID(ST_MakePoint(24.18654, 45.74321), 4326),
        'a', 'b', ST_GeomFromText('LINESTRING(24.15123 45.70987, 24.18654 45.74321)', 4326),
        2000, 300, 'fixture', now() + interval '30 minutes');
insert into app.share_links (booking_id, token_hash, created_by, expires_at, created_at) values
  (pg_temp.bk(3), decode(repeat('a1', 32), 'hex'), pg_temp.u(5), now() + interval '1 day', now() - interval '1 hour'),
  (pg_temp.bk(4), decode(repeat('a2', 32), 'hex'), pg_temp.u(2), now() + interval '1 day', now() - interval '1 hour'),
  (pg_temp.bk(5), decode(repeat('a3', 32), 'hex'), pg_temp.u(2), now() + interval '1 day', now() - interval '1 hour');
insert into app.blocks (blocker_id, blocked_id) values
  (pg_temp.u(5), pg_temp.u(1)), (pg_temp.u(1), pg_temp.u(5)), (pg_temp.u(9), pg_temp.u(1));
insert into app.reliability_events (user_id, kind) values
  (pg_temp.u(5), 'late_cancellation'), (pg_temp.u(2), 'late_cancellation'), (pg_temp.u(9), 'late_cancellation');
insert into app.outbox (user_id, template, payload, status) values
  (pg_temp.u(5), 'booking_expired', '{"t":"e6s-pending"}'::jsonb, 'pending'),
  (pg_temp.u(5), 'booking_expired', '{"t":"e6s-sent"}'::jsonb, 'sent'),
  (pg_temp.u(2), 'booking_expired', '{"t":"e6s-p-pending"}'::jsonb, 'pending');
insert into app.analytics_events (name, user_id, props) values
  ('search_performed', pg_temp.u(5), '{"t":"e6s"}'::jsonb),
  ('search_performed', pg_temp.u(9), '{"t":"e6e"}'::jsonb);
insert into app.ratings (booking_id, rater_id, ratee_id, stars, tags, visible_at) values
  (pg_temp.bk(3), pg_temp.u(5), pg_temp.u(1), 5, '{}', now()),
  (pg_temp.bk(3), pg_temp.u(1), pg_temp.u(5), 4, '{}', now()),
  (pg_temp.bk(6), pg_temp.u(9), pg_temp.u(1), 4, '{}', now()),
  (pg_temp.bk(6), pg_temp.u(1), pg_temp.u(9), 5, '{}', now() - interval '1 day'),
  (pg_temp.bk(7), pg_temp.u(2), pg_temp.u(9), 1, '{}', now() + interval '1 day');
insert into app.reports (reporter_id, reported_id, reason, details, reported_snapshot) values
  (pg_temp.u(2), pg_temp.u(5), 'harassment', 'e6s', '{"firstName":"Ana","phoneE164":"+40721234567"}'::jsonb),
  (pg_temp.u(9), pg_temp.u(1), 'other', 'filed-by-me', '{"firstName":"Radu","phoneE164":"+40733000001"}'::jsonb),
  (pg_temp.u(1), pg_temp.u(9), 'other', 'about-me-secret', '{"firstName":"Eva","phoneE164":"+40766000004"}'::jsonb);
insert into app.consents (user_id, kind, document_version) values
  (pg_temp.u(5), 'terms', '1.0'), (pg_temp.u(5), 'privacy', '1.0'),
  (pg_temp.u(9), 'terms', '1.0'), (pg_temp.u(9), 'privacy', '1.0'), (pg_temp.u(9), 'age_18', null),
  (pg_temp.u(7), 'terms', '1.0'), (pg_temp.u(7), 'age_18', null),
  (pg_temp.u(8), 'terms', '1.0'), (pg_temp.u(8), 'age_18', null);
insert into app.data_requests (user_id, kind, requested_at, fulfilled_at, note) values
  (pg_temp.u(9), 'export', now() - interval '1 day', null, 'e6e');

-- Structure, RLS and grants (13) ------------------------------------------------------------------------------------
select has_table('app', t::name, 'table ' || t || ' exists') from unnest(array['account_deletions', 'data_requests']) t;
select ok((select relrowsecurity from pg_class where oid = ('app.' || t)::regclass), t || ' has row level security enabled')
  from unnest(array['account_deletions', 'data_requests']) t;
select ok(not exists (select 1 from pg_policy p
  where p.polrelid in ('app.account_deletions'::regclass, 'app.data_requests'::regclass)),
  'the new tables have no RLS policies (deny-all)');
select ok(not has_table_privilege('anon', 'app.' || t, 'SELECT') and not has_table_privilege('authenticated', 'app.' || t, 'SELECT')
  and not has_table_privilege('anon', 'app.' || t, 'INSERT') and not has_table_privilege('authenticated', 'app.' || t, 'INSERT'),
  t || ' is unreachable for anon and authenticated')
  from unnest(array['account_deletions', 'data_requests']) t;
select ok(not has_table_privilege('haide_api', 'app.' || t, 'DELETE'), t || ' cannot be deleted from by haide_api')
  from unnest(array['account_deletions', 'data_requests', 'consents', 'reports']) t;
select ok(has_table_privilege('haide_api', 'app.account_deletions', 'INSERT')
  and has_table_privilege('haide_api', 'app.account_deletions', 'UPDATE')
  and has_table_privilege('haide_api', 'app.account_deletions', 'SELECT'),
  'haide_api can queue and progress an account deletion');
select ok(has_table_privilege('haide_api', 'app.data_requests', 'INSERT')
  and has_table_privilege('haide_api', 'app.data_requests', 'SELECT'),
  'haide_api can record and read a data request');

-- Constraints, indexes, foreign key and legal texts (12) -----------------------------------------------------------------
select ok(exists (select 1 from pg_constraint where conname = 'account_deletions_completed_meta'),
  'constraint account_deletions_completed_meta exists');
select throws_ok($$insert into app.account_deletions (user_id, completed_at) values (pg_temp.u(2), now())$$,
  '23514', null, 'a deletion cannot be completed before both storage and auth are done');
select throws_ok($$insert into app.account_deletions (user_id, last_error) values (pg_temp.u(2), repeat('x', 201))$$,
  '23514', null, 'last_error is at most 200 characters');
select throws_ok($$insert into app.account_deletions (user_id, photo_path) values (pg_temp.u(2), 'avatars/../secret.jpg')$$,
  '23514', null, 'photo_path must look like an avatar path');
select throws_ok($$insert into app.data_requests (user_id, kind) values (pg_temp.u(2), 'import')$$,
  '23514', null, 'the only data request kind is export');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = i), 'index ' || i || ' exists')
  from unnest(array['account_deletions_due_idx', 'data_requests_user_idx', 'reports_created_idx',
                    'analytics_events_occurred_idx', 'profiles_deleted_idx']) i;
select is((select confdeltype::text from pg_constraint where conname = 'admin_actions_report_id_fkey'), 'n',
  'deleting a report sets admin_actions.report_id to NULL');
select is((select count(*) from app.legal_documents where version = '1.1' and published_at = '2026-11-21T00:00:00Z'
             and kind in ('terms', 'privacy') and url in ('/policy/terms', '/policy/privacy')), 2::bigint,
  'terms and privacy 1.1 are published on 2026-11-21');

-- Function grants (31) ------------------------------------------------------------------------------------------------------
select ok(not exists (
  select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = to_regprocedure(f) and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  f || ' is not executable by PUBLIC')
  from unnest(array['app.coarsen_rides_by_id(uuid[], timestamptz)', 'app.coarsen_bookings_by_id(uuid[], timestamptz)',
                    'app.coarsen_locations(timestamptz, integer)', 'app.scrub_account(uuid, timestamptz)',
                    'app.location_retention_violations(timestamptz)', 'app.run_retention()',
                    'app.export_user_data(uuid)']) f;
select ok(not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE'),
  f || ' is not executable by anon or authenticated')
  from unnest(array['app.coarsen_rides_by_id(uuid[], timestamptz)', 'app.coarsen_bookings_by_id(uuid[], timestamptz)',
                    'app.coarsen_locations(timestamptz, integer)', 'app.scrub_account(uuid, timestamptz)',
                    'app.location_retention_violations(timestamptz)', 'app.run_retention()',
                    'app.export_user_data(uuid)']) f;
select ok(has_function_privilege('haide_api', f, 'EXECUTE'), f || ' is executable by haide_api')
  from unnest(array['app.coarsen_rides_by_id(uuid[], timestamptz)', 'app.coarsen_bookings_by_id(uuid[], timestamptz)',
                    'app.coarsen_locations(timestamptz, integer)', 'app.scrub_account(uuid, timestamptz)',
                    'app.location_retention_violations(timestamptz)', 'app.run_retention()']) f;
select ok(not has_function_privilege('haide_api', 'app.export_user_data(uuid)', 'EXECUTE'),
  'haide_api cannot run export_user_data (SQL editor only)');
select is((select string_agg(p.proname::text, ',' order by p.proname) from pg_proc p
            where p.oid in (to_regprocedure('app.coarsen_rides_by_id(uuid[], timestamptz)'),
                            to_regprocedure('app.coarsen_bookings_by_id(uuid[], timestamptz)'),
                            to_regprocedure('app.coarsen_locations(timestamptz, integer)'),
                            to_regprocedure('app.scrub_account(uuid, timestamptz)'),
                            to_regprocedure('app.location_retention_violations(timestamptz)'),
                            to_regprocedure('app.run_retention()'),
                            to_regprocedure('app.export_user_data(uuid)'))
              and p.prosecdef), 'export_user_data,run_retention',
  'only run_retention and export_user_data are SECURITY DEFINER');
select ok(exists (select 1 from pg_proc p, unnest(p.proconfig) c
  where p.oid = to_regprocedure(f) and c like 'search_path=%'), f || ' pins its search_path')
  from unnest(array['app.coarsen_rides_by_id(uuid[], timestamptz)', 'app.coarsen_bookings_by_id(uuid[], timestamptz)',
                    'app.coarsen_locations(timestamptz, integer)', 'app.scrub_account(uuid, timestamptz)',
                    'app.location_retention_violations(timestamptz)', 'app.run_retention()',
                    'app.export_user_data(uuid)']) f;
set local role authenticated;
select throws_ok($$select app.run_retention()$$, '42501', null, 'authenticated cannot run run_retention');
reset role;
set local role haide_api;
select throws_ok($$select app.export_user_data('00000000-0000-4000-8000-000000000909')$$, '42501', null,
  'haide_api cannot export a user');
reset role;

-- grid_point is stable under repetition (the coarsening is idempotent) (2) -------------------------------------------
select is((select count(*) from generate_series(0, 49) i,
    lateral (select ST_SetSRID(ST_MakePoint(23.98 + i * 0.0067, 45.68 + i * 0.0036), 4326) as p) q
  where ST_Equals(app.grid_point(app.grid_point(q.p, 1000), 1000), app.grid_point(q.p, 1000))),
  50::bigint, 'grid_point(grid_point(p, 1000), 1000) equals grid_point(p, 1000) on 50 points');
select is((select count(*) from generate_series(0, 49) i,
    lateral (select ST_SetSRID(ST_MakePoint(23.98 + i * 0.0067, 45.68 + i * 0.0036), 4326) as p) q
  where ST_Equals(app.grid_point(app.grid_point(q.p, 300), 300), app.grid_point(q.p, 300))),
  50::bigint, 'grid_point(grid_point(p, 300), 300) equals grid_point(p, 300) on 50 points');

-- Catalog guard (2): a new location column fails CI until it gets a retention rule ---------------------------------------
select set_eq(
  $$select f_table_name::text || '.' || f_geometry_column::text from extensions.geometry_columns where f_table_schema = 'app'$$,
  $$values ('areas.geom'), ('areas.centroid'), ('places.geom'),
           ('route_previews.origin'), ('route_previews.destination'), ('route_previews.route'),
           ('rides.origin'), ('rides.destination'), ('rides.route'), ('rides.route_utm'),
           ('bookings.pickup'), ('bookings.dropoff')$$,
  'every geometry column in app is in the retention inventory (e6-privacy-spec section 3): classify new ones');
select is((select count(*) from extensions.geography_columns where f_table_schema = 'app'), 0::bigint,
  'no geography column in app (it would also need a retention rule)');

-- Coarsening (28) ------------------------------------------------------------------------------------------------------------
select is((select count(*) from app.location_retention_violations(now()) where kind = 'ride'), 4::bigint,
  'before coarsening: four rides older than 90 days still hold exact geometry');
select is((select count(*) from app.location_retention_violations(now()) where kind = 'booking'), 1::bigint,
  'before coarsening: the booking on the -91 day ride holds exact points');
update app.bookings set coarsened_at = now() where id = pg_temp.bk(1);
select is((select count(*) from app.location_retention_violations(now()) where kind = 'booking'), 1::bigint,
  'the proof checks the points, not the coarsened_at flag');
update app.bookings set coarsened_at = null where id = pg_temp.bk(1);

set local role haide_api;
select lives_ok($$select * from app.coarsen_locations(now(), 0)$$, 'haide_api can run coarsen_locations');
reset role;

create temp table fx_run1 as select * from app.coarsen_locations(now(), 2);
select is((select rides from fx_run1), 2, 'p_limit caps the rides coarsened per run');
select is((select bookings from fx_run1), 1, 'the booking on an old ride is coarsened in the same run');
select is((select string_agg(id::text, ',' order by id) from app.rides
            where coarsened_at is not null and id in (select pg_temp.rd(n) from generate_series(1, 5) n)),
  pg_temp.rd(4)::text || ',' || pg_temp.rd(5)::text, 'the oldest rides go first');
create temp table fx_run2 as select * from app.coarsen_locations(now(), 500);
select is((select rides from fx_run2), 2, 'the second run takes the remaining two old rides');
select is((select bookings from fx_run2), 0, 'the second run has no booking left');
create temp table fx_run3 as select * from app.coarsen_locations(now(), 500);
select is((select rides + bookings from fx_run3), 0, 'a third run finds nothing (idempotent)');

select is((select count(*) from app.location_retention_violations(now())), 0::bigint,
  'no exact coordinates older than 90 days remain (checked by geometry)');
select is((select count(*) from app.rides r where r.departure_at < now() - interval '90 days'
    and (not ST_Equals(r.origin, app.grid_point(r.origin, 1000))
      or not ST_Equals(r.destination, app.grid_point(r.destination, 1000)))), 0::bigint,
  'every stored ride point older than 90 days is a 1 km grid centre');
select is((select count(*) from app.bookings b join app.rides r on r.id = b.ride_id
  where r.departure_at < now() - interval '90 days'
    and (not ST_Equals(b.pickup, app.grid_point(b.pickup, 1000))
      or not ST_Equals(b.dropoff, app.grid_point(b.dropoff, 1000)))), 0::bigint,
  'every stored booking point on an old ride is a 1 km grid centre');
select is((select count(*) from app.rides r where r.departure_at < now() - interval '90 days'
    and (r.route is not null or r.note is not null or jsonb_exists(r.vehicle_snapshot, 'plate'))), 0::bigint,
  'old rides keep no route, note or plate');
select ok((select ST_Equals(r.origin, app.grid_point(ST_SetSRID(ST_MakePoint(24.15123, 45.70987), 4326), 1000))
      and ST_Equals(r.destination, app.grid_point(ST_SetSRID(ST_MakePoint(24.18654, 45.74321), 4326), 1000))
    from app.rides r where r.id = pg_temp.rd(1)),
  'the -91 day ride points are the 1 km grid centres of the exact points');
select ok((select not ST_Equals(r.origin, ST_SetSRID(ST_MakePoint(24.15123, 45.70987), 4326))
    from app.rides r where r.id = pg_temp.rd(1)), 'the exact origin is gone');
select is((select r.origin_label || '|' || r.destination_label from app.rides r where r.id = pg_temp.rd(1)),
  coalesce((select name from fx_area), 'Sibiu') || '|' || coalesce((select name from fx_area), 'Sibiu'),
  'street labels became the area name');
select ok((select r.route is null and r.note is null and r.coarsened_at is not null
    from app.rides r where r.id = pg_temp.rd(1)), 'route and note are gone and the ride is marked coarsened');
select is((select vehicle_snapshot from app.rides where id = pg_temp.rd(1)),
  '{"make":"Dacia","model":"Logan","colour":"Grey","fuelType":"diesel"}'::jsonb, 'only the plate left the vehicle snapshot');
select is((select count(*) from fx_rides_before f join app.rides r on r.id = f.id
    where f.id <> pg_temp.rd(2)
      and (f.j - array['origin', 'destination', 'route', 'route_utm', 'origin_label', 'destination_label', 'note',
                       'vehicle_snapshot', 'coarsened_at'])
          is distinct from (to_jsonb(r) - array['origin', 'destination', 'route', 'route_utm', 'origin_label',
                       'destination_label', 'note', 'vehicle_snapshot', 'coarsened_at'])), 0::bigint,
  'distance, duration, prices, status and every timestamp of the old rides are unchanged');
select ok((select f.j = to_jsonb(r) from fx_rides_before f join app.rides r on r.id = f.id where f.id = pg_temp.rd(2)),
  'the -89 day ride is byte-identical');
select ok((select ST_Equals(b.pickup, app.grid_point(ST_SetSRID(ST_MakePoint(24.16234, 45.71876), 4326), 1000))
      and ST_Equals(b.dropoff, app.grid_point(ST_SetSRID(ST_MakePoint(24.18123, 45.74012), 4326), 1000))
      and b.idempotency_key is null and b.coarsened_at is not null
    from app.bookings b where b.id = pg_temp.bk(1)),
  'the booking on the -91 day ride has grid-centre points and no idempotency key');
select is((select count(*) from fx_bookings_before f join app.bookings b on b.id = f.id
    where f.id = pg_temp.bk(1)
      and (f.j - array['pickup', 'dropoff', 'idempotency_key', 'coarsened_at'])
          is distinct from (to_jsonb(b) - array['pickup', 'dropoff', 'idempotency_key', 'coarsened_at'])), 0::bigint,
  'the booking keeps its distances, prices, status and timestamps');
select ok((select f.j = to_jsonb(b) from fx_bookings_before f join app.bookings b on b.id = f.id where f.id = pg_temp.bk(2)),
  'the booking on the -89 day ride is byte-identical');

-- The guard itself: anything exact that comes back is reported.
update app.rides set vehicle_snapshot = vehicle_snapshot || '{"plate":"SB12ABC"}'::jsonb where id = pg_temp.rd(1);
select is((select count(*) from app.location_retention_violations(now())), 1::bigint, 'a plate left on an old ride is a violation');
update app.rides set vehicle_snapshot = vehicle_snapshot - 'plate', note = 'x' where id = pg_temp.rd(1);
select is((select count(*) from app.location_retention_violations(now())), 1::bigint, 'a note left on an old ride is a violation');
update app.rides set note = null, route = ST_GeomFromText('LINESTRING(24.15 45.70, 24.18 45.74)', 4326) where id = pg_temp.rd(1);
select is((select count(*) from app.location_retention_violations(now())), 1::bigint, 'a route left on an old ride is a violation');
update app.rides set route = null where id = pg_temp.rd(1);
select is((select count(*) from app.location_retention_violations(now())), 0::bigint, 'and the proof is empty again once it is removed');

-- scrub_account (26) -----------------------------------------------------------------------------------------------------------------
set local role haide_api;
select lives_ok($$select app.scrub_account('00000000-0000-4000-8000-000000000905', now())$$,
  'haide_api can run scrub_account (the invoker has every privilege it needs)');
reset role;
select ok((select p.first_name is null and p.phone_e164 is null and p.bio is null and p.photo_path is null
    and p.last_seen_summary_at is null and p.role = 'user' and p.status = 'deleted' and p.deleted_at = now()
    from app.profiles p where p.id = pg_temp.u(5)),
  'the profile is a tombstone: no name, phone, bio or photo, role user, status deleted');
select is((select count(*) from app.vehicles where owner_id = pg_temp.u(5)), 0::bigint, 'the vehicle is deleted');
select is((select count(*) from app.rides where driver_id = pg_temp.u(5)
             and vehicle_snapshot = '{"fuelType":"diesel"}'::jsonb), 2::bigint,
  'every ride keeps only the fuel type in its vehicle snapshot');
select is((select count(*) from app.rides where driver_id = pg_temp.u(5) and coarsened_at is not null
             and route is null and note is null), 2::bigint,
  'the rides are coarsened at once, a young one and a future one alike');
select ok((select b.coarsened_at is not null and b.idempotency_key is null
      and ST_Equals(b.pickup, app.grid_point(ST_SetSRID(ST_MakePoint(24.16234, 45.71876), 4326), 1000))
    from app.bookings b where b.id = pg_temp.bk(3)), 'the own booking is coarsened at once');
select is((select count(*) from app.blocks where blocker_id = pg_temp.u(5)), 0::bigint, 'outgoing blocks are deleted');
select is((select count(*) from app.blocks where blocked_id = pg_temp.u(5)), 1::bigint,
  'the incoming block (the other person''s data) is kept');
select is((select count(*) from app.reliability_events where user_id = pg_temp.u(5)), 0::bigint,
  'the reliability events of the user are deleted');
select is((select count(*) from app.reliability_events where user_id = pg_temp.u(2)), 1::bigint,
  'other users keep their reliability events');
select is((select count(*) from app.share_links where booking_id in (pg_temp.bk(3), pg_temp.bk(4))), 0::bigint,
  'share links of the user as passenger or as driver are deleted');
select is((select count(*) from app.share_links where booking_id = pg_temp.bk(5)), 1::bigint,
  'a share link between other people is kept');
select is((select string_agg(payload->>'t', ',' order by payload->>'t') from app.outbox where payload->>'t' like 'e6s-%'),
  'e6s-p-pending,e6s-sent', 'only the pending mail to the user is deleted');
select is((select count(*) from app.analytics_events where props->>'t' = 'e6s' and user_id is null), 1::bigint,
  'analytics events lose the user id');
select is((select count(*) from app.ratings where booking_id = pg_temp.bk(3)), 2::bigint, 'ratings in both directions are kept');
select is((select reported_snapshot->>'phoneE164' from app.reports where details = 'e6s'), '+40721234567',
  'a report about the user keeps its snapshot (12 months)');
select is((select count(*) from app.consents where user_id = pg_temp.u(5)), 2::bigint, 'consents are kept (3 years)');
select is((select count(*) from app.route_previews where driver_id = pg_temp.u(5)), 0::bigint, 'route previews are deleted');
select ok((select d.photo_path = 'avatars/6f1d8a5e-0000-4000-8000-000000000905.jpg' and d.storage_done_at is null
      and d.auth_done_at is null and d.completed_at is null and d.attempts = 0
      and d.requested_at = now() and d.next_attempt_at = now()
    from app.account_deletions d where d.user_id = pg_temp.u(5)),
  'the purge queue row records the photo and is due now');
select lives_ok($$select app.scrub_account('00000000-0000-4000-8000-000000000905', now() + interval '1 hour')$$,
  'a second scrub does not fail');
select is((select count(*) from app.account_deletions where user_id = pg_temp.u(5)), 1::bigint,
  'and still leaves one purge queue row');
select ok((select p.deleted_at = now() from app.profiles p where p.id = pg_temp.u(5)), 'and keeps the first deleted_at');
select lives_ok($$select app.scrub_account('00000000-0000-4000-8000-000000000906', now())$$, 'a user without a photo can be scrubbed');
select ok((select d.photo_path is null and d.storage_done_at = now() and d.completed_at is null
    from app.account_deletions d where d.user_id = pg_temp.u(6)),
  'without a photo the storage step is done at once, the row stays open for the auth step');
select lives_ok($$select app.scrub_account('00000000-0000-4000-8000-0000000009ff', now())$$, 'an unknown user is a no-op');
select is((select count(*) from app.account_deletions where user_id not in (pg_temp.u(5), pg_temp.u(6))), 0::bigint,
  'and creates no purge queue row');

-- run_retention (14): rows one day inside and one day outside each period -----------------------------------------------------
insert into app.rate_limits (key, window_start, count) values
  ('e6-old', now() - interval '2 days' - interval '1 day', 1), ('e6-new', now() - interval '2 days' + interval '1 day', 1);
insert into app.app_errors (source, message, created_at) values
  ('server', 'e6-old', now() - interval '14 days' - interval '1 day'), ('server', 'e6-new', now() - interval '14 days' + interval '1 day');
insert into app.outbox (user_id, template, payload, status, created_at) values
  (pg_temp.u(2), 'booking_expired', '{"t":"e6r-old-sent"}'::jsonb, 'sent', now() - interval '30 days' - interval '1 day'),
  (pg_temp.u(2), 'booking_expired', '{"t":"e6r-new-sent"}'::jsonb, 'sent', now() - interval '30 days' + interval '1 day'),
  (pg_temp.u(2), 'booking_expired', '{"t":"e6r-old-pending"}'::jsonb, 'pending', now() - interval '30 days' - interval '1 day');
insert into app.analytics_events (name, user_id, props, occurred_at) values
  ('search_performed', pg_temp.u(2), '{"t":"e6r-old"}'::jsonb, now() - interval '13 months' - interval '1 day'),
  ('search_performed', pg_temp.u(2), '{"t":"e6r-new"}'::jsonb, now() - interval '13 months' + interval '1 day');
insert into app.reports (id, reporter_id, reported_id, reason, details, reported_snapshot, created_at) values
  ('00000000-0000-4000-8000-0000000009c1', pg_temp.u(2), pg_temp.u(1), 'harassment', 'e6r-old',
   '{"firstName":"Radu","phoneE164":null}'::jsonb, now() - interval '12 months' - interval '1 day'),
  ('00000000-0000-4000-8000-0000000009c2', pg_temp.u(2), pg_temp.u(1), 'harassment', 'e6r-new',
   '{"firstName":"Radu","phoneE164":null}'::jsonb, now() - interval '12 months' + interval '1 day');
insert into app.admin_actions (action, report_id, details, created_at) values
  ('suspend', null, '{"t":"e6r-old"}'::jsonb, now() - interval '24 months' - interval '1 day'),
  ('suspend', null, '{"t":"e6r-new"}'::jsonb, now() - interval '24 months' + interval '1 day'),
  ('dismiss_report', '00000000-0000-4000-8000-0000000009c1', '{"t":"e6r-link"}'::jsonb, now());
insert into app.account_deletions (user_id, requested_at, storage_done_at, auth_done_at, completed_at) values
  (pg_temp.u(7), now() - interval '4 years', now() - interval '4 years', now() - interval '4 years',
   now() - interval '3 years' - interval '1 day'),
  (pg_temp.u(8), now() - interval '4 years', now() - interval '4 years', now() - interval '4 years',
   now() - interval '3 years' + interval '1 day');
insert into app.data_requests (user_id, kind, requested_at, fulfilled_at, note) values
  (pg_temp.u(2), 'export', now() - interval '4 years', now() - interval '3 years' - interval '1 day', 'e6r-old'),
  (pg_temp.u(2), 'export', now() - interval '4 years', now() - interval '3 years' + interval '1 day', 'e6r-new'),
  (pg_temp.u(2), 'export', now() - interval '5 years', null, 'e6r-open');

set local role haide_api;
select lives_ok($$select app.run_retention()$$, 'haide_api can run run_retention (the definer deletes what it may not)');
reset role;
select is((select string_agg(key, ',' order by key) from app.rate_limits where key like 'e6-%'), 'e6-new',
  'rate limits: older than 2 days go, younger stay');
select is((select string_agg(message, ',' order by message) from app.app_errors where message like 'e6-%'), 'e6-new',
  'app errors: older than 14 days go, younger stay');
select is((select string_agg(payload->>'t', ',' order by payload->>'t') from app.outbox where payload->>'t' like 'e6r-%'),
  'e6r-new-sent,e6r-old-pending', 'outbox: finished rows older than 30 days go, pending ones are never purged');
select is((select string_agg(props->>'t', ',' order by props->>'t') from app.analytics_events where props->>'t' like 'e6r-%'),
  'e6r-new', 'analytics: older than 13 months go');
select is((select string_agg(details, ',' order by details) from app.reports where details like 'e6r-%'), 'e6r-new',
  'reports: older than 12 months go, whole row');
select is((select count(*) from app.admin_actions where details->>'t' = 'e6r-link' and report_id is null), 1::bigint,
  'an admin action about a purged report stays, with report_id NULL');
select is((select string_agg(details->>'t', ',' order by details->>'t') from app.admin_actions where details->>'t' like 'e6r-%'),
  'e6r-link,e6r-new', 'admin actions: older than 24 months go');
select is((select count(*) from app.consents where user_id = pg_temp.u(7)), 0::bigint,
  'consents of an account deleted more than 3 years ago are purged');
select is((select count(*) from app.consents where user_id = pg_temp.u(8)), 2::bigint,
  'consents of an account deleted less than 3 years ago are kept');
select is((select count(*) from app.consents where user_id in (pg_temp.u(5), pg_temp.u(9))), 5::bigint,
  'consents of a user deleted today and of an active user are kept');
select is((select string_agg(user_id::text, ',' order by user_id) from app.account_deletions
            where user_id in (pg_temp.u(7), pg_temp.u(8))), pg_temp.u(8)::text,
  'account deletions: completed more than 3 years ago go');
select is((select string_agg(note, ',' order by note) from app.data_requests where note like 'e6r-%'), 'e6r-new,e6r-open',
  'data requests: fulfilled more than 3 years ago go, an unfulfilled one stays');
select is((select count(*) from jsonb_object_keys(app.run_retention())), 9::bigint,
  'run_retention reports the rows deleted for each of its nine tables');

-- export_user_data (15) ----------------------------------------------------------------------------------------------------------------
select is((select count(*) from unnest(array['schemaVersion', 'exportedAt', 'account', 'profile', 'vehicle', 'consents',
    'rides', 'bookings', 'ratingsGiven', 'ratingsReceived', 'reliabilityEvents', 'blocksOutgoing', 'reportsFiled',
    'dataRequests', 'analyticsEvents']) k where jsonb_exists(app.export_user_data(pg_temp.u(9)), k)), 15::bigint,
  'the export has every documented key');
select is((select count(*) from jsonb_object_keys(app.export_user_data(pg_temp.u(9)))), 15::bigint, 'and no other key');
select is((app.export_user_data(pg_temp.u(9))->'account'->>'email'), 'export@example.com', 'the account email comes from auth.users');
select ok((select jsonb_array_length(x->'ratingsReceived') = 1 and (x->'ratingsReceived'->0->>'stars')::int = 5
    from (select app.export_user_data(pg_temp.u(9)) as x) q),
  'a rating that is not visible yet is not exported');
select ok(not jsonb_exists(app.export_user_data(pg_temp.u(9))->'ratingsReceived'->0, 'raterId')
  and not jsonb_exists(app.export_user_data(pg_temp.u(9))->'ratingsReceived'->0, 'rater_id'),
  'a received rating does not name the rater');
select is(jsonb_array_length(app.export_user_data(pg_temp.u(9))->'ratingsGiven'), 1, 'ratings given are exported');
select is((app.export_user_data(pg_temp.u(9))->'rides'->0->'origin'->>'type'), 'Point', 'ride points are GeoJSON');
select is(jsonb_array_length(app.export_user_data(pg_temp.u(9))->'bookings'), 1, 'the own booking is exported');
select ok(position('+40733000001' in app.export_user_data(pg_temp.u(9))::text) = 0
  and position('+40744000002' in app.export_user_data(pg_temp.u(9))::text) = 0,
  'no counterpart phone number is exported');
select ok(position('filed-by-me' in app.export_user_data(pg_temp.u(9))::text) > 0, 'reports the user filed are exported');
select ok(position('about-me-secret' in app.export_user_data(pg_temp.u(9))::text) = 0
  and position('reported_snapshot' in app.export_user_data(pg_temp.u(9))::text) = 0,
  'reports about the user and their snapshots are not exported');
select is(jsonb_array_length(app.export_user_data(pg_temp.u(9))->'consents'), 3, 'consents are exported');
select ok((select jsonb_array_length(x->'blocksOutgoing') = 1 and jsonb_array_length(x->'reliabilityEvents') = 1
      and jsonb_array_length(x->'dataRequests') = 1 and jsonb_array_length(x->'analyticsEvents') = 1
    from (select app.export_user_data(pg_temp.u(9)) as x) q),
  'blocks, reliability events, data requests and analytics events are exported');
select is((app.export_user_data(pg_temp.u(9))->'vehicle'->>'plate'), 'SB99XYZ', 'the own vehicle, with its plate, is exported');
select is((app.export_user_data(pg_temp.u(9))->'profile'->>'phoneE164'), '+40766000004', 'the own phone number is exported');

select * from finish();
rollback;
