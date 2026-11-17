-- E5 trust and safety schema (e5-trust-safety-spec section 1, ADRs 0024 to 0028): reports, admin_actions, share_links,
-- the tightened ratings/rides/bookings/reliability_events, app.complete_rides, app.admin_suspend_user and
-- app.admin_unsuspend_user, and their grants.
begin;
create extension if not exists pgtap with schema extensions;
select plan(86);

-- Fixtures ---------------------------------------------------------------------------------------------------------
-- d: the driver. p1, p2, p3: passengers. p2 is deleted and p3 suspended later.
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000801', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'driver@example.com'),
  ('00000000-0000-4000-8000-000000000802', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p1@example.com'),
  ('00000000-0000-4000-8000-000000000803', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p2@example.com'),
  ('00000000-0000-4000-8000-000000000804', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p3@example.com');
update app.profiles set first_name = 'Radu' where id = '00000000-0000-4000-8000-000000000801';

-- One ride per scenario. Times are chosen against a completion run at 07:41 with a cutoff of 05:41 (2 h before).
create function pg_temp.ride(p_id uuid, p_departure timestamptz, p_booked integer default 0)
returns void language sql as $$
  insert into app.rides (id, driver_id, origin, destination, origin_label, destination_label, route, distance_m,
                         duration_s, departure_at, seats_offered, seats_booked, energy_price_id, rate_micro_per_km,
                         vehicle_snapshot)
  values (p_id, '00000000-0000-4000-8000-000000000801',
          ST_SetSRID(ST_MakePoint(24.151, 45.709), 4326), ST_SetSRID(ST_MakePoint(24.1505, 45.7977), 4326),
          'a', 'b', ST_GeomFromText('LINESTRING(24.151 45.709, 24.1861 45.7413, 24.1505 45.7977)', 4326),
          11514, 1020, p_departure, 3, p_booked,
          (select id from app.energy_prices where fuel_type = 'diesel'), 651000,
          '{"make":"Dacia","model":"Logan","colour":"Grey","plate":"SB12ABC","fuelType":"diesel"}'::jsonb)
$$;

-- A: departed at -2 h 01, two confirmed and one cancelled booking. B: empty, departed at -2 h 11.
-- C: departed at -1 h 59 (too recent). D: already cancelled. E: only a no-show booking. F: departs later (constraint tests).
select pg_temp.ride('00000000-0000-4000-8000-0000000008a1', '2026-11-20T05:40:00Z', 2);
select pg_temp.ride('00000000-0000-4000-8000-0000000008a2', '2026-11-20T05:30:00Z');
select pg_temp.ride('00000000-0000-4000-8000-0000000008a3', '2026-11-20T05:42:00Z');
select pg_temp.ride('00000000-0000-4000-8000-0000000008a4', '2026-11-20T05:00:00Z');
select pg_temp.ride('00000000-0000-4000-8000-0000000008a5', '2026-11-20T05:20:00Z', 1);
select pg_temp.ride('00000000-0000-4000-8000-0000000008a6', '2026-11-26T05:00:00Z');
update app.rides set status = 'cancelled', cancelled_at = '2026-11-19T10:00:00Z'
 where id = '00000000-0000-4000-8000-0000000008a4';

-- One valid-by-default booking row; every argument can be overridden to break exactly one rule.
create function pg_temp.ins(
  p_id uuid, p_passenger uuid, p_ride uuid,
  p_status text default 'confirmed', p_locked integer default 100, p_final integer default null,
  p_no_show_at timestamptz default null, p_no_show_by text default null,
  p_cancelled_at timestamptz default null, p_cancelled_by text default null)
returns void language sql as $$
  insert into app.bookings (id, ride_id, passenger_id, status, pickup, dropoff, pickup_label, dropoff_label,
    pickup_fraction, dropoff_fraction, segment_m, walk_pickup_m, walk_dropoff_m, price_quoted_bani,
    price_locked_bani, final_price_bani, requested_at, expires_at, decided_at, cancelled_at, cancelled_by,
    no_show_at, no_show_by)
  values (p_id, p_ride, p_passenger, p_status::app.booking_status,
    ST_SetSRID(ST_MakePoint(24.18, 45.74), 4326), ST_SetSRID(ST_MakePoint(24.15, 45.79), 4326),
    'Șelimbăr', 'Centru', 0.2, 0.9, 4000, 100, 100, 180, p_locked, p_final,
    '2026-11-19T04:00:00Z', '2026-11-19T04:30:00Z', '2026-11-19T04:05:00Z', p_cancelled_at, p_cancelled_by,
    p_no_show_at, p_no_show_by)
$$;

-- b1, b2: confirmed on A (p1, p2). b3: cancelled on A (p3). b5: no-show only on E (p1). b6: confirmed on F (p3).
select pg_temp.ins('00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-0000000008a1');
select pg_temp.ins('00000000-0000-4000-8000-0000000008b2', '00000000-0000-4000-8000-000000000803', '00000000-0000-4000-8000-0000000008a1');
select pg_temp.ins('00000000-0000-4000-8000-0000000008b3', '00000000-0000-4000-8000-000000000804', '00000000-0000-4000-8000-0000000008a1',
  p_status => 'cancelled', p_locked => null, p_cancelled_at => '2026-11-19T20:00:00Z', p_cancelled_by => 'passenger');
select pg_temp.ins('00000000-0000-4000-8000-0000000008b5', '00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-0000000008a5',
  p_status => 'no_show', p_no_show_at => '2026-11-20T05:30:00Z', p_no_show_by => 'driver');
select pg_temp.ins('00000000-0000-4000-8000-0000000008b6', '00000000-0000-4000-8000-000000000804', '00000000-0000-4000-8000-0000000008a6');

-- A live share link on b1 and an open report p1 -> p3 (used by the suspend tests).
insert into app.share_links (booking_id, token_hash, created_by, expires_at, created_at)
values ('00000000-0000-4000-8000-0000000008b1', decode(repeat('ab', 32), 'hex'),
        '00000000-0000-4000-8000-000000000802', '2026-11-21T05:40:00Z', '2026-11-19T10:00:00Z');
insert into app.reports (id, reporter_id, reported_id, reason, reported_snapshot)
values ('00000000-0000-4000-8000-0000000008c1', '00000000-0000-4000-8000-000000000802',
        '00000000-0000-4000-8000-000000000804', 'harassment', '{"firstName":"X","phoneE164":null}'::jsonb);

-- Structure, RLS and grants (17) ------------------------------------------------------------------------------------
select has_table('app', t::name, 'table ' || t || ' exists') from unnest(array['reports', 'admin_actions', 'share_links']) t;
select ok((select relrowsecurity from pg_class where oid = ('app.' || t)::regclass), t || ' has row level security enabled')
  from unnest(array['reports', 'admin_actions', 'share_links']) t;
select ok(not exists (select 1 from pg_policy p
  where p.polrelid in ('app.reports'::regclass, 'app.admin_actions'::regclass, 'app.share_links'::regclass)),
  'the new tables have no RLS policies (deny-all)');
select ok(not has_table_privilege('anon', 'app.' || t, 'SELECT') and not has_table_privilege('authenticated', 'app.' || t, 'SELECT')
  and not has_table_privilege('anon', 'app.' || t, 'INSERT') and not has_table_privilege('authenticated', 'app.' || t, 'INSERT'),
  t || ' is unreachable for anon and authenticated')
  from unnest(array['reports', 'admin_actions', 'share_links']) t;
select ok(not has_table_privilege('haide_api', 'app.reports', 'DELETE') and has_table_privilege('haide_api', 'app.reports', 'INSERT'),
  'haide_api can insert reports but never delete them');
select ok(not has_table_privilege('haide_api', 'app.admin_actions', 'UPDATE')
  and not has_table_privilege('haide_api', 'app.admin_actions', 'DELETE'),
  'admin_actions is append-only for haide_api (no UPDATE, no DELETE)');
select ok(has_table_privilege('haide_api', 'app.admin_actions', 'INSERT') and has_table_privilege('haide_api', 'app.admin_actions', 'SELECT'),
  'haide_api can read and append admin_actions');
select ok(has_table_privilege('haide_api', 'app.share_links', 'DELETE') and has_table_privilege('haide_api', 'app.share_links', 'INSERT'),
  'haide_api can create, rotate and revoke share links');
select ok(not has_column_privilege('haide_api', 'app.ratings', 'stars', 'UPDATE')
  and not has_column_privilege('haide_api', 'app.ratings', 'tags', 'UPDATE'),
  'rating stars and tags are immutable for haide_api');
select ok(has_column_privilege('haide_api', 'app.ratings', 'visible_at', 'UPDATE'),
  'haide_api can move ratings.visible_at (blind ratings)');
select ok(not has_table_privilege('haide_api', 'app.ratings', 'UPDATE'),
  'there is no table-level UPDATE on ratings for haide_api');

-- Named constraints and indexes (14) -----------------------------------------------------------------------------------
select ok(exists (select 1 from pg_constraint where conname = c), 'constraint ' || c || ' exists')
  from unnest(array['reports_not_self', 'reports_other_has_details', 'reports_resolved_meta', 'ratings_tags_allowed',
                    'rides_completed_has_time', 'bookings_no_show_meta', 'bookings_final_only_completed']) c;
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = i), 'index ' || i || ' exists')
  from unnest(array['reports_status_created_idx', 'reports_reported_created_idx', 'admin_actions_target_created_idx',
                    'share_links_expires_idx', 'ratings_ratee_visible_idx']) i;
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'reliability_events_booking_kind_uidx'
    and indexdef ilike '%unique%' and indexdef ilike '%booking_id is not null%'),
  'reliability_events_booking_kind_uidx is a unique partial index on (booking_id, kind)');
select col_not_null('app', 'ratings', 'visible_at', 'ratings.visible_at is NOT NULL');

-- Constraint behaviour (17) -----------------------------------------------------------------------------------------------
select throws_ok($$insert into app.reports (reporter_id, reported_id, reason, reported_snapshot)
  values ('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000802', 'harassment', '{}'::jsonb)$$,
  '23514', null, 'a user cannot report themselves');
select throws_ok($$insert into app.reports (reporter_id, reported_id, reason, reported_snapshot)
  values ('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000801', 'other', '{}'::jsonb)$$,
  '23514', null, 'a report with reason other needs details');
select lives_ok($$insert into app.reports (reporter_id, reported_id, reason, details, reported_snapshot)
  values ('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000801', 'other', 'He cancelled twice', '{}'::jsonb)$$,
  'a report with reason other and details is accepted');
select throws_ok($$insert into app.reports (reporter_id, reported_id, reason, details, reported_snapshot)
  values ('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000801', 'harassment', repeat('x', 501), '{}'::jsonb)$$,
  '23514', null, 'report details are at most 500 characters');
select throws_ok($$insert into app.reports (reporter_id, reported_id, reason, status, reported_snapshot)
  values ('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000801', 'harassment', 'actioned', '{}'::jsonb)$$,
  '23514', null, 'a resolved report records when it was resolved');
select throws_ok($$insert into app.share_links (booking_id, token_hash, created_by, expires_at)
  values ('00000000-0000-4000-8000-0000000008b2', decode('abcd', 'hex'), '00000000-0000-4000-8000-000000000803', now() + interval '1 day')$$,
  '23514', null, 'a share-link token hash is exactly 32 bytes');
select throws_ok($$insert into app.share_links (booking_id, token_hash, created_by, expires_at, created_at)
  values ('00000000-0000-4000-8000-0000000008b2', decode(repeat('cd', 32), 'hex'), '00000000-0000-4000-8000-000000000803',
          '2026-11-20T03:00:00Z', '2026-11-20T04:00:00Z')$$,
  '23514', null, 'a share link expires after it was created');
select throws_ok($$insert into app.share_links (booking_id, token_hash, created_by, expires_at)
  values ('00000000-0000-4000-8000-0000000008b1', decode(repeat('cd', 32), 'hex'), '00000000-0000-4000-8000-000000000802', now() + interval '1 day')$$,
  '23505', null, 'a booking has at most one share link');
select throws_ok($$insert into app.share_links (booking_id, token_hash, created_by, expires_at)
  values ('00000000-0000-4000-8000-0000000008b2', decode(repeat('ab', 32), 'hex'), '00000000-0000-4000-8000-000000000803', now() + interval '1 day')$$,
  '23505', null, 'a token hash is unique');
select throws_ok($$insert into app.ratings (booking_id, rater_id, ratee_id, stars, tags, visible_at)
  values ('00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000801',
          5, array['rude'], now())$$,
  '23514', null, 'rating tags must come from the allowed list');
select lives_ok($$insert into app.ratings (booking_id, rater_id, ratee_id, stars, tags, visible_at)
  values ('00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000801',
          5, array['punctual', 'safe_driving'], '2026-11-27T05:40:00Z')$$,
  'a rating with allowed tags is accepted');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000008d1', '00000000-0000-4000-8000-000000000803',
  '00000000-0000-4000-8000-0000000008a6', p_status => 'no_show')$$, '23514', null,
  'a no-show booking records when and by whom');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000008d2', '00000000-0000-4000-8000-000000000803',
  '00000000-0000-4000-8000-0000000008a6', p_no_show_at => '2026-11-26T05:30:00Z', p_no_show_by => 'driver')$$, '23514', null,
  'only a no-show booking can carry no-show details');
select throws_ok($$select pg_temp.ins('00000000-0000-4000-8000-0000000008d3', '00000000-0000-4000-8000-000000000803',
  '00000000-0000-4000-8000-0000000008a6', p_final => 100)$$, '23514', null,
  'only a completed booking has a final price');
select throws_ok($$update app.rides set status = 'completed' where id = '00000000-0000-4000-8000-0000000008a6'$$,
  '23514', null, 'a completed ride has a completion time');
select lives_ok($$insert into app.reliability_events (user_id, kind, booking_id, ride_id)
  values ('00000000-0000-4000-8000-000000000802', 'no_show', '00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-0000000008a1')$$,
  'a booking produces a reliability event');
select throws_ok($$insert into app.reliability_events (user_id, kind, booking_id, ride_id)
  values ('00000000-0000-4000-8000-000000000802', 'no_show', '00000000-0000-4000-8000-0000000008b1', '00000000-0000-4000-8000-0000000008a1')$$,
  '23505', null, 'the same event cannot be counted twice for one booking');

-- Function grants (7) ----------------------------------------------------------------------------------------------------
select ok(not exists (
  select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = to_regprocedure(f) and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  f || ' is not executable by PUBLIC')
  from unnest(array['app.complete_rides(timestamptz, timestamptz, integer)',
                    'app.admin_suspend_user(uuid, text, uuid, uuid, text)',
                    'app.admin_unsuspend_user(uuid, text, uuid)']) f;
select ok(not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE'),
  f || ' is not executable by anon or authenticated')
  from unnest(array['app.complete_rides(timestamptz, timestamptz, integer)',
                    'app.admin_suspend_user(uuid, text, uuid, uuid, text)',
                    'app.admin_unsuspend_user(uuid, text, uuid)']) f;
select ok(has_function_privilege('haide_api', 'app.complete_rides(timestamptz, timestamptz, integer)', 'EXECUTE')
  and has_function_privilege('haide_api', 'app.admin_suspend_user(uuid, text, uuid, uuid, text)', 'EXECUTE')
  and has_function_privilege('haide_api', 'app.admin_unsuspend_user(uuid, text, uuid)', 'EXECUTE'),
  'haide_api can run all three functions');

-- app.complete_rides (16) ----------------------------------------------------------------------------------------------------
create temp table fx_c as
  select * from app.complete_rides('2026-11-20T07:41:00Z', '2026-11-20T05:41:00Z', 200);

select is((select count(*) from fx_c), 3::bigint, 'three rides are finished: A (completed), B and E (expired)');
select is((select outcome::text from fx_c where ride_id = '00000000-0000-4000-8000-0000000008a1'), 'completed',
  'a ride with confirmed bookings is completed');
select is((select completed_at from app.rides where id = '00000000-0000-4000-8000-0000000008a1'),
  '2026-11-20T07:41:00Z'::timestamptz, 'completed_at is the p_now of the run');
select is((select count(*) from app.bookings where ride_id = '00000000-0000-4000-8000-0000000008a1' and status = 'completed'),
  2::bigint, 'both confirmed bookings are completed');
select is((select count(*) from app.bookings where ride_id = '00000000-0000-4000-8000-0000000008a1'
  and status = 'completed' and final_price_bani = price_locked_bani), 2::bigint,
  'the final price equals the locked price');
select is((select count(*) from app.bookings where ride_id = '00000000-0000-4000-8000-0000000008a1'
  and status = 'completed' and passenger_event_at = '2026-11-20T07:41:00Z'), 2::bigint,
  'each passenger gets an update badge');
select ok((select status = 'cancelled' and final_price_bani is null from app.bookings where id = '00000000-0000-4000-8000-0000000008b3'),
  'a cancelled booking on the same ride is untouched');
select is((select status::text || '/' || coalesce(completed_at::text, 'null') from app.rides where id = '00000000-0000-4000-8000-0000000008a2'),
  'expired/null', 'a ride with no bookings expires, without a completion time');
select is((select status::text from app.rides where id = '00000000-0000-4000-8000-0000000008a5'), 'expired',
  'a ride whose only booking is a no-show expires');
select ok((select status = 'no_show' and final_price_bani is null from app.bookings where id = '00000000-0000-4000-8000-0000000008b5'),
  'the no-show booking stays a no-show without a final price');
select is((select status::text from app.rides where id = '00000000-0000-4000-8000-0000000008a3'), 'published',
  'a ride that left 1 h 59 ago is untouched');
select is((select status::text from app.rides where id = '00000000-0000-4000-8000-0000000008a4'), 'cancelled',
  'a cancelled ride is untouched');
select is((select count(*) from app.complete_rides('2026-11-20T07:41:00Z', '2026-11-20T05:41:00Z', 200)), 0::bigint,
  'running it again does nothing (idempotent)');
select is((select cardinality(booking_ids) from fx_c where ride_id = '00000000-0000-4000-8000-0000000008a1'), 2,
  'the result lists the completed booking ids for the rating prompts');
set local role haide_api;
select lives_ok($$select count(*) from app.complete_rides('2026-11-20T07:41:00Z', '2026-11-20T05:41:00Z', 200)$$,
  'haide_api can run complete_rides');
reset role;
select is((select seats_booked from app.rides where id = '00000000-0000-4000-8000-0000000008a1'), 2::smallint,
  'completion never changes the accepted-seat count');

-- app.admin_suspend_user and app.admin_unsuspend_user (15) ----------------------------------------------------------------------
select is(app.admin_suspend_user('00000000-0000-4000-8000-000000000804', 'harassment confirmed',
  '00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-0000000008c1'), true,
  'suspending an active user returns true');
select is((select status::text from app.profiles where id = '00000000-0000-4000-8000-000000000804'), 'suspended',
  'the user is suspended');
select is((select count(*) from app.admin_actions where target_user_id = '00000000-0000-4000-8000-000000000804' and action = 'suspend'),
  1::bigint, 'the suspension is logged in admin_actions');
select is((select status::text from app.reports where id = '00000000-0000-4000-8000-0000000008c1'), 'actioned',
  'the linked report is actioned');
select ok((select resolved_at is not null from app.reports where id = '00000000-0000-4000-8000-0000000008c1'),
  'the report records when it was resolved');
select is((select resolved_by from app.reports where id = '00000000-0000-4000-8000-0000000008c1'),
  '00000000-0000-4000-8000-000000000801'::uuid, 'the report records who resolved it');
select is(app.admin_suspend_user('00000000-0000-4000-8000-000000000804', 'again'), false,
  'suspending a suspended user returns false');
select is((select count(*) from app.admin_actions where target_user_id = '00000000-0000-4000-8000-000000000804'),
  1::bigint, 'a no-op writes no admin_actions row');
update app.profiles set status = 'deleted' where id = '00000000-0000-4000-8000-000000000803';
select is(app.admin_suspend_user('00000000-0000-4000-8000-000000000803', 'x'), false, 'a deleted user cannot be suspended');
select is((select status::text from app.profiles where id = '00000000-0000-4000-8000-000000000803'), 'deleted',
  'a deleted user stays deleted');
select is(app.admin_unsuspend_user('00000000-0000-4000-8000-000000000804', 'appeal accepted'), true,
  'unsuspending a suspended user returns true');
select is((select status::text from app.profiles where id = '00000000-0000-4000-8000-000000000804'), 'active',
  'the user is active again');
select is((select count(*) from app.admin_actions where target_user_id = '00000000-0000-4000-8000-000000000804' and action = 'unsuspend'),
  1::bigint, 'the unsuspension is logged');
select is(app.admin_unsuspend_user('00000000-0000-4000-8000-000000000804', 'again'), false,
  'unsuspending an active user returns false');
set local role haide_api;
select lives_ok($$select app.admin_suspend_user('00000000-0000-4000-8000-000000000803', 'x')$$,
  'haide_api can run admin_suspend_user');
reset role;

select * from finish();
rollback;
