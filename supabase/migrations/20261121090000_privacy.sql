-- E6 privacy and compliance (docs/architecture/e6-privacy-spec.md section 1, ADRs 0029, 0030, 0031).
-- Forward-only. Adds the account deletion queue and the data request log, re-creates one foreign key
-- so reports can be purged, adds three indexes and legal text version 1.1, and seven functions:
-- location coarsening (invoker, run by the tick), account scrub (invoker, run inside DELETE /me),
-- the retention proof, the row purge (SECURITY DEFINER), the admin export (SECURITY DEFINER, SQL editor
-- only) and two internal coarsening helpers.
-- RLS is enabled on every new table with NO policies (deny-all except haide_api, which bypasses it).
-- Every new function has EXECUTE revoked from PUBLIC (Postgres grants it by default).

-- ---------------------------------------------------------------------------------------------
-- account_deletions: what is left to do after the DELETE /me transaction commits (ADR 0029).
-- The profile is already a tombstone; the avatar object and the auth user are removed by the tick,
-- retried with backoff until both are done. One row per user (PK), kept 3 years as proof of erasure.
-- ---------------------------------------------------------------------------------------------
create table app.account_deletions (
  user_id uuid primary key references app.profiles (id),
  requested_at timestamptz not null default now(),
  -- the avatar to remove; cleared once the object is gone so no path to personal data remains
  photo_path text check (photo_path ~ '^avatars/[0-9a-f-]{36}\.jpg$'),
  storage_done_at timestamptz,
  auth_done_at timestamptz,
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- scrubbed by the API (no emails, phones or tokens)
  last_error text check (char_length(last_error) <= 200),
  completed_at timestamptz,
  constraint account_deletions_completed_meta check (
    (completed_at is not null) = (storage_done_at is not null and auth_done_at is not null))
);
create index account_deletions_due_idx on app.account_deletions (next_attempt_at)
  where completed_at is null;

-- ---------------------------------------------------------------------------------------------
-- data_requests: "Request my data" (ADR 0031). The export itself is app.export_user_data, run by the
-- owner in the SQL editor. fulfilled_at is set by hand when the JSON has been sent.
-- ---------------------------------------------------------------------------------------------
create table app.data_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles (id),
  kind text not null check (kind = 'export'),
  requested_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  note text check (char_length(note) <= 200)
);
create index data_requests_user_idx on app.data_requests (user_id, requested_at desc);

-- ---------------------------------------------------------------------------------------------
-- Changes to existing tables
-- ---------------------------------------------------------------------------------------------
-- admin_actions is append-only for the API, so the 12-month report purge needs the foreign key to
-- null itself instead of blocking the delete.
alter table app.admin_actions drop constraint admin_actions_report_id_fkey;
alter table app.admin_actions add constraint admin_actions_report_id_fkey
  foreign key (report_id) references app.reports (id) on delete set null;

-- Range scans for the hourly purge.
create index reports_created_idx on app.reports (created_at);
create index analytics_events_occurred_idx on app.analytics_events (occurred_at);
create index profiles_deleted_idx on app.profiles (deleted_at) where status = 'deleted';

-- Legal text 1.1 (the content ships in apps/web, features/policy/content). It becomes current on the
-- publish date; users on 1.0 are asked to accept again (consent.reaccept on GET /me).
insert into app.legal_documents (kind, version, published_at, url) values
  ('terms', '1.1', '2026-11-21T00:00:00Z', '/policy/terms'),
  ('privacy', '1.1', '2026-11-21T00:00:00Z', '/policy/privacy');

-- ---------------------------------------------------------------------------------------------
-- RLS (no policies) and grants
-- ---------------------------------------------------------------------------------------------
alter table app.account_deletions enable row level security;
alter table app.data_requests enable row level security;

-- Proof of erasure and of the request: the API role cannot delete them (run_retention can).
revoke delete on app.account_deletions from haide_api;
revoke delete on app.data_requests from haide_api;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Internal helpers shared by app.coarsen_locations and app.scrub_account (ADR 0030).
-- Rides: points to the centre of their 1 km grid cell, route gone, street labels become the area
-- name, free text gone, plate removed. Distance, duration, prices, status and every timestamp stay.
-- Idempotent: rows already coarsened are not touched. updated_at is not touched either.
-- ---------------------------------------------------------------------------------------------
create function app.coarsen_rides_by_id(p_ids uuid[], p_now timestamptz)
returns integer
language plpgsql
volatile
set search_path = app, extensions, pg_catalog
as $$
declare
  v_n integer;
begin
  update app.rides r
     set origin = app.grid_point(r.origin, 1000),
         destination = app.grid_point(r.destination, 1000),
         route = null,
         origin_label = coalesce((select a.name from app.areas a where a.id = r.origin_area_id), 'Sibiu'),
         destination_label = coalesce((select a.name from app.areas a where a.id = r.destination_area_id), 'Sibiu'),
         note = null,
         vehicle_snapshot = r.vehicle_snapshot - 'plate',
         coarsened_at = p_now
   where r.id = any (p_ids) and r.coarsened_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- Bookings: pickup and dropoff to the 1 km grid centre, idempotency key cleared. Labels are already area names.
create function app.coarsen_bookings_by_id(p_ids uuid[], p_now timestamptz)
returns integer
language plpgsql
volatile
set search_path = app, extensions, pg_catalog
as $$
declare
  v_n integer;
begin
  update app.bookings b
     set pickup = app.grid_point(b.pickup, 1000),
         dropoff = app.grid_point(b.dropoff, 1000),
         idempotency_key = null,
         coarsened_at = p_now
   where b.id = any (p_ids) and b.coarsened_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- app.coarsen_locations: tick step 6, every minute. Rides that departed more than 90 days before
-- p_now, then bookings on such rides, at most p_limit of each, oldest first. Rows locked by a
-- concurrent writer are skipped until the next tick. The bookings prefilter on created_at uses
-- bookings_coarsen_idx and is valid because a booking is always created before its ride departs.
-- ---------------------------------------------------------------------------------------------
create function app.coarsen_locations(p_now timestamptz, p_limit integer)
returns table (rides integer, bookings integer)
language plpgsql
volatile
set search_path = app, extensions, pg_catalog
as $$
declare
  v_cutoff timestamptz := p_now - interval '90 days';
  v_ride_ids uuid[] := '{}';
  v_booking_ids uuid[] := '{}';
  r record;
begin
  for r in
    select x.id as rid
      from app.rides x
     where x.coarsened_at is null and x.departure_at < v_cutoff
     order by x.departure_at, x.id
     limit p_limit
       for update of x skip locked
  loop
    v_ride_ids := v_ride_ids || r.rid;
  end loop;

  for r in
    select b.id as bid
      from app.bookings b
      join app.rides x on x.id = b.ride_id
     where b.coarsened_at is null and b.created_at < v_cutoff and x.departure_at < v_cutoff
     order by b.created_at, b.id
     limit p_limit
       for update of b skip locked
  loop
    v_booking_ids := v_booking_ids || r.bid;
  end loop;

  rides := app.coarsen_rides_by_id(v_ride_ids, p_now);
  bookings := app.coarsen_bookings_by_id(v_booking_ids, p_now);
  return next;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- app.scrub_account: the last step of the DELETE /me transaction (ADR 0029). The API has already
-- cancelled the future rides and bookings. Turns the profile into a tombstone and removes what only
-- served the person. Kept: ratings both ways, reports (with their snapshot, 12 months), admin
-- actions, consents (3 years), blocks other people set against this user, and the rides and
-- bookings themselves (coarsened). Idempotent. Pushes of E8 will add their deletion here.
-- ---------------------------------------------------------------------------------------------
create function app.scrub_account(p_user uuid, p_now timestamptz)
returns void
language plpgsql
volatile
set search_path = app, extensions, pg_catalog
as $$
declare
  v_photo text;
  v_ids uuid[];
begin
  select p.photo_path into v_photo from app.profiles p where p.id = p_user;
  if not found then
    return;
  end if;

  insert into app.account_deletions (user_id, requested_at, photo_path, storage_done_at, next_attempt_at)
  values (p_user, p_now, v_photo, case when v_photo is null then p_now end, p_now)
  on conflict (user_id) do nothing;

  update app.profiles
     set first_name = null, phone_e164 = null, bio = null, photo_path = null,
         last_seen_summary_at = null, role = 'user', status = 'deleted',
         deleted_at = coalesce(deleted_at, p_now), updated_at = p_now
   where id = p_user;

  delete from app.vehicles where owner_id = p_user;
  delete from app.route_previews where driver_id = p_user;

  -- Every ride keeps only the fuel type (the price is computed from it), whatever its age.
  update app.rides
     set vehicle_snapshot = coalesce(
           jsonb_strip_nulls(jsonb_build_object('fuelType', vehicle_snapshot -> 'fuelType')), '{}'::jsonb)
   where driver_id = p_user;

  -- Coarsen all rides and own bookings now, not after 90 days.
  select coalesce(array_agg(r.id), '{}') into v_ids
    from app.rides r where r.driver_id = p_user and r.coarsened_at is null;
  perform app.coarsen_rides_by_id(v_ids, p_now);
  select coalesce(array_agg(b.id), '{}') into v_ids
    from app.bookings b where b.passenger_id = p_user and b.coarsened_at is null;
  perform app.coarsen_bookings_by_id(v_ids, p_now);

  delete from app.blocks where blocker_id = p_user;
  delete from app.reliability_events where user_id = p_user;
  delete from app.share_links s
   using app.bookings b
   where b.id = s.booking_id
     and (b.passenger_id = p_user
          or exists (select 1 from app.rides r where r.id = b.ride_id and r.driver_id = p_user));
  delete from app.outbox where user_id = p_user and status = 'pending';
  update app.analytics_events set user_id = null where user_id = p_user;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- app.location_retention_violations: the proof (ADR 0030). Every ride and booking past the cutoff
-- that still holds exact geometry, a route, a note or a plate. Checked by geometry, not by the
-- coarsened_at flag: a point must equal its own 1 km grid centre. Empty means compliant.
-- ---------------------------------------------------------------------------------------------
create function app.location_retention_violations(p_now timestamptz)
returns table (kind text, id uuid)
language sql
stable
set search_path = app, extensions, pg_catalog
as $$
  select 'ride'::text, r.id
    from app.rides r
   where r.departure_at < p_now - interval '90 days'
     and (r.coarsened_at is null
          or r.route is not null
          or r.note is not null
          or jsonb_exists(r.vehicle_snapshot, 'plate')
          or not ST_Equals(r.origin, app.grid_point(r.origin, 1000))
          or not ST_Equals(r.destination, app.grid_point(r.destination, 1000)))
  union all
  select 'booking'::text, b.id
    from app.bookings b
    join app.rides r on r.id = b.ride_id
   where r.departure_at < p_now - interval '90 days'
     and (b.coarsened_at is null
          or not ST_Equals(b.pickup, app.grid_point(b.pickup, 1000))
          or not ST_Equals(b.dropoff, app.grid_point(b.dropoff, 1000)))
$$;

-- ---------------------------------------------------------------------------------------------
-- app.run_retention: hourly, from the tick (ADR 0030). SECURITY DEFINER because haide_api has no
-- DELETE on the append-only tables, and it takes no clock argument so the API cannot purge early.
-- One batch of at most 5 000 rows per table and call. Returns the number of rows deleted per table.
--   rate_limits 2 days, app_errors 14 days, outbox (not pending) 30 days, analytics 13 months,
--   reports 12 months (whole row, snapshot included; admin_actions.report_id becomes NULL),
--   admin_actions 24 months, consents of accounts deleted 3 years ago, account_deletions and
--   data_requests 3 years after they were completed or fulfilled.
-- ---------------------------------------------------------------------------------------------
create function app.run_retention()
returns jsonb
language plpgsql
volatile
security definer
set search_path = app, extensions, pg_catalog
as $$
declare
  c_batch constant integer := 5000;
  v_rate_limits integer;
  v_app_errors integer;
  v_outbox integer;
  v_analytics integer;
  v_reports integer;
  v_admin_actions integer;
  v_consents integer;
  v_deletions integer;
  v_requests integer;
begin
  with d as (
    delete from app.rate_limits t
     where t.ctid in (select s.ctid from app.rate_limits s
                       where s.window_start < now() - interval '2 days' limit c_batch)
    returning 1)
  select count(*)::integer into v_rate_limits from d;

  with d as (
    delete from app.app_errors t
     where t.ctid in (select s.ctid from app.app_errors s
                       where s.created_at < now() - interval '14 days' limit c_batch)
    returning 1)
  select count(*)::integer into v_app_errors from d;

  with d as (
    delete from app.outbox t
     where t.ctid in (select s.ctid from app.outbox s
                       where s.status <> 'pending' and s.created_at < now() - interval '30 days' limit c_batch)
    returning 1)
  select count(*)::integer into v_outbox from d;

  with d as (
    delete from app.analytics_events t
     where t.ctid in (select s.ctid from app.analytics_events s
                       where s.occurred_at < now() - interval '13 months' limit c_batch)
    returning 1)
  select count(*)::integer into v_analytics from d;

  with d as (
    delete from app.reports t
     where t.ctid in (select s.ctid from app.reports s
                       where s.created_at < now() - interval '12 months' limit c_batch)
    returning 1)
  select count(*)::integer into v_reports from d;

  with d as (
    delete from app.admin_actions t
     where t.ctid in (select s.ctid from app.admin_actions s
                       where s.created_at < now() - interval '24 months' limit c_batch)
    returning 1)
  select count(*)::integer into v_admin_actions from d;

  with d as (
    delete from app.consents t
     where t.ctid in (select c.ctid
                        from app.consents c
                        join app.profiles p on p.id = c.user_id
                       where p.status = 'deleted' and p.deleted_at < now() - interval '3 years'
                       limit c_batch)
    returning 1)
  select count(*)::integer into v_consents from d;

  with d as (
    delete from app.account_deletions t
     where t.ctid in (select s.ctid from app.account_deletions s
                       where s.completed_at < now() - interval '3 years' limit c_batch)
    returning 1)
  select count(*)::integer into v_deletions from d;

  with d as (
    delete from app.data_requests t
     where t.ctid in (select s.ctid from app.data_requests s
                       where s.fulfilled_at < now() - interval '3 years' limit c_batch)
    returning 1)
  select count(*)::integer into v_requests from d;

  return jsonb_build_object(
    'rateLimits', v_rate_limits,
    'appErrors', v_app_errors,
    'outbox', v_outbox,
    'analyticsEvents', v_analytics,
    'reports', v_reports,
    'adminActions', v_admin_actions,
    'consents', v_consents,
    'accountDeletions', v_deletions,
    'dataRequests', v_requests
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- app.export_user_data: one user's own data as JSON (ADR 0031). SECURITY DEFINER because it reads
-- the email in auth.users. NOT executable by haide_api or any public role: the owner runs it in the
-- SQL editor. Excluded on purpose (rights of others, GDPR Art. 15(4)): reports about the user,
-- counterparts' phones and points, ratings that are not visible yet, the identity of raters.
-- ---------------------------------------------------------------------------------------------
create function app.export_user_data(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = app, extensions, pg_catalog
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'exportedAt', now(),
    'account', (
      select jsonb_build_object(
        'id', p.id, 'email', u.email, 'createdAt', u.created_at,
        'lastSignInAt', u.last_sign_in_at, 'status', p.status)
        from app.profiles p
        left join auth.users u on u.id = p.id
       where p.id = p_user),
    'profile', (
      select jsonb_build_object(
        'firstName', p.first_name, 'phoneE164', p.phone_e164, 'bio', p.bio,
        'photoPath', p.photo_path, 'role', p.role, 'createdAt', p.created_at, 'deletedAt', p.deleted_at)
        from app.profiles p where p.id = p_user),
    'vehicle', (
      select jsonb_build_object(
        'make', v.make, 'model', v.model, 'colour', v.colour, 'plate', v.plate,
        'fuelType', v.fuel_type, 'seats', v.seats, 'createdAt', v.created_at)
        from app.vehicles v where v.owner_id = p_user),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', c.kind, 'version', c.document_version, 'acceptedAt', c.accepted_at)
        order by c.accepted_at)
        from app.consents c where c.user_id = p_user), '[]'::jsonb),
    'rides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'origin', ST_AsGeoJSON(r.origin)::jsonb,
        'destination', ST_AsGeoJSON(r.destination)::jsonb,
        'route', case when r.route is null then null else ST_AsGeoJSON(r.route)::jsonb end,
        'originLabel', r.origin_label, 'destinationLabel', r.destination_label,
        'departureAt', r.departure_at, 'distanceM', r.distance_m, 'durationS', r.duration_s,
        'seatsOffered', r.seats_offered, 'seatsBooked', r.seats_booked,
        'note', r.note, 'isFree', r.is_free, 'autoAccept', r.auto_accept,
        'rateMicroPerKm', r.rate_micro_per_km, 'vehicle', r.vehicle_snapshot,
        'status', r.status, 'cancelledAt', r.cancelled_at, 'completedAt', r.completed_at,
        'coarsenedAt', r.coarsened_at, 'createdAt', r.created_at)
        order by r.departure_at)
        from app.rides r where r.driver_id = p_user), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'rideId', b.ride_id, 'status', b.status,
        'pickup', ST_AsGeoJSON(b.pickup)::jsonb, 'dropoff', ST_AsGeoJSON(b.dropoff)::jsonb,
        'pickupLabel', b.pickup_label, 'dropoffLabel', b.dropoff_label,
        'priceQuotedBani', b.price_quoted_bani, 'priceLockedBani', b.price_locked_bani,
        'finalPriceBani', b.final_price_bani,
        'requestedAt', b.requested_at, 'decidedAt', b.decided_at,
        'cancelledAt', b.cancelled_at, 'cancelledBy', b.cancelled_by,
        'noShowAt', b.no_show_at, 'noShowBy', b.no_show_by,
        'coarsenedAt', b.coarsened_at, 'createdAt', b.created_at)
        order by b.requested_at)
        from app.bookings b where b.passenger_id = p_user), '[]'::jsonb),
    'ratingsGiven', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bookingId', g.booking_id, 'stars', g.stars, 'tags', g.tags, 'createdAt', g.created_at)
        order by g.created_at)
        from app.ratings g where g.rater_id = p_user), '[]'::jsonb),
    'ratingsReceived', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stars', g.stars, 'tags', g.tags, 'createdAt', g.created_at)
        order by g.created_at)
        from app.ratings g where g.ratee_id = p_user and g.visible_at <= now()), '[]'::jsonb),
    'reliabilityEvents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'bookingId', e.booking_id, 'rideId', e.ride_id, 'occurredAt', e.occurred_at)
        order by e.occurred_at)
        from app.reliability_events e where e.user_id = p_user), '[]'::jsonb),
    'blocksOutgoing', coalesce((
      select jsonb_agg(jsonb_build_object('blockedUserId', k.blocked_id, 'createdAt', k.created_at)
        order by k.created_at)
        from app.blocks k where k.blocker_id = p_user), '[]'::jsonb),
    'reportsFiled', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reason', rp.reason, 'details', rp.details, 'status', rp.status, 'createdAt', rp.created_at)
        order by rp.created_at)
        from app.reports rp where rp.reporter_id = p_user), '[]'::jsonb),
    'dataRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'requestedAt', d.requested_at, 'fulfilledAt', d.fulfilled_at)
        order by d.requested_at)
        from app.data_requests d where d.user_id = p_user), '[]'::jsonb),
    'analyticsEvents', coalesce((
      select jsonb_agg(jsonb_build_object('name', a.name, 'props', a.props, 'occurredAt', a.occurred_at)
        order by a.occurred_at, a.id)
        from app.analytics_events a where a.user_id = p_user), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Function privileges. Postgres grants EXECUTE to PUBLIC on every new function unless revoked.
-- haide_api keeps EXECUTE (default privileges) on everything the API or the tick calls; the helpers
-- are internal and the export is for the SQL editor only.
-- ---------------------------------------------------------------------------------------------
revoke all on function app.coarsen_rides_by_id(uuid[], timestamptz) from public, anon, authenticated;
revoke all on function app.coarsen_bookings_by_id(uuid[], timestamptz) from public, anon, authenticated;
revoke all on function app.coarsen_locations(timestamptz, integer) from public, anon, authenticated;
revoke all on function app.scrub_account(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.location_retention_violations(timestamptz) from public, anon, authenticated;
revoke all on function app.run_retention() from public, anon, authenticated;
revoke all on function app.export_user_data(uuid) from public, anon, authenticated, haide_api;
grant execute on function app.run_retention() to haide_api;
