-- E8 liquidity boosters (docs/architecture/e8-liquidity-spec.md section 1, ADRs 0036 to 0039).
-- Forward-only. Adds four tables (ride_series, ride_alerts, ride_alert_hits, push_subscriptions),
-- the series foreign key on rides, the alert-check marker on rides, the auto-confirmed flag on
-- bookings, the two new analytics event names, and two new functions (the alert matcher and the
-- monthly stats). Replaces three E6 functions (scrub_account, run_retention, export_user_data) with
-- the E6 body plus the E8 additions.
-- RLS is enabled on every new table with NO policies (deny-all except haide_api, which bypasses it).
-- Every new or replaced function pins its search_path and has EXECUTE revoked from PUBLIC (Postgres
-- grants it by default).

-- ---------------------------------------------------------------------------------------------
-- ride_series: the schedule of a repeating ride (ADR 0039). No geometry: every instance is a normal
-- ride that carries its own copy of the preview route. Deleted 90 days after ends_on (run_retention).
-- ---------------------------------------------------------------------------------------------
create table app.ride_series (
  id uuid primary key default gen_random_uuid(),
  -- tombstoned profiles are never deleted, so RESTRICT (like rides)
  driver_id uuid not null references app.profiles (id) on delete restrict,
  -- ISO weekdays, Monday = 1
  weekdays smallint[] not null,
  -- local Europe/Bucharest wall-clock time, minute precision
  departure_time time not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active',
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ride_series_weekdays_ok check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  constraint ride_series_minute_precision check (extract(second from departure_time) = 0),
  constraint ride_series_span check (ends_on >= starts_on and ends_on <= starts_on + 28),
  constraint ride_series_status_check check (status in ('active', 'cancelled')),
  constraint ride_series_cancelled_has_time check (status <> 'cancelled' or cancelled_at is not null)
);
create index ride_series_driver_idx on app.ride_series (driver_id, created_at desc);
create index ride_series_ends_idx on app.ride_series (ends_on);

-- ---------------------------------------------------------------------------------------------
-- ride_alerts: "tell me when a ride matches this route" (ADR 0036). Exact points and a commute time:
-- deleted at expiry (at most 14 days) and on account deletion. The UTM columns are generated.
-- ---------------------------------------------------------------------------------------------
create table app.ride_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles (id) on delete cascade,
  origin geometry(Point, 4326) not null,
  destination geometry(Point, 4326) not null,
  origin_utm geometry(Point, 32635) generated always as (ST_Transform(origin, 32635)) stored,
  destination_utm geometry(Point, 32635) generated always as (ST_Transform(destination, 32635)) stored,
  origin_label text not null check (char_length(origin_label) between 1 and 80),
  destination_label text not null check (char_length(destination_label) between 1 and 80),
  -- exactly one of a single local date or a set of ISO weekdays
  alert_date date,
  weekdays smallint[],
  -- local wall-clock time of the wanted departure
  local_time time not null,
  window_min smallint not null check (window_min in (15, 30, 60)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_notified_at timestamptz,
  matches_sent integer not null default 0 check (matches_sent >= 0),
  constraint ride_alerts_one_schedule check ((alert_date is not null) <> (weekdays is not null)),
  constraint ride_alerts_weekdays_ok check (
    weekdays is null
    or (cardinality(weekdays) between 1 and 7 and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])),
  constraint ride_alerts_expires_after_created check (expires_at > created_at)
);
create index ride_alerts_user_idx on app.ride_alerts (user_id, expires_at);
create index ride_alerts_expires_idx on app.ride_alerts (expires_at);
create index ride_alerts_origin_gix on app.ride_alerts using gist (origin_utm);

-- ---------------------------------------------------------------------------------------------
-- ride_alert_hits: the once-per-ride guarantee. The primary key is what stops a second notification
-- for the same alert and ride, however often the matcher runs.
-- ---------------------------------------------------------------------------------------------
create table app.ride_alert_hits (
  alert_id uuid not null references app.ride_alerts (id) on delete cascade,
  ride_id uuid not null references app.rides (id) on delete cascade,
  notified_at timestamptz not null default now(),
  constraint ride_alert_hits_pkey primary key (alert_id, ride_id)
);
create index ride_alert_hits_ride_idx on app.ride_alert_hits (ride_id);

-- ---------------------------------------------------------------------------------------------
-- push_subscriptions: one row per browser (ADR 0038). The endpoint is unique: a shared device moves
-- to the last user who registered it. Hosts are checked by the API (no SSRF); keys are base64url.
-- ---------------------------------------------------------------------------------------------
create table app.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures smallint not null default 0 check (failures >= 0)
);
create index push_subscriptions_user_idx on app.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------------------------
-- Changes to existing tables
-- ---------------------------------------------------------------------------------------------
-- rides.series_id (E2 left the column without a key): a series row that is purged leaves its rides.
alter table app.rides
  add constraint rides_series_id_fkey foreign key (series_id) references app.ride_series (id) on delete set null;
create index rides_series_idx on app.rides (series_id, departure_at) where series_id is not null;

-- Rides the alert matcher has not looked at yet. Existing rides are backfilled so that deploying E8
-- does not notify anyone about rides that were published before the alert existed.
alter table app.rides add column alerts_checked_at timestamptz;
update app.rides set alerts_checked_at = created_at;
create index rides_alerts_pending_idx on app.rides (created_at) where alerts_checked_at is null;

-- A booking confirmed by the ride's auto-accept (ADR 0037).
alter table app.bookings add column auto_confirmed boolean not null default false;
alter table app.bookings
  add constraint bookings_auto_confirmed_decided check (not auto_confirmed or decided_at is not null);

-- The two new product events.
alter table app.analytics_events drop constraint analytics_events_name_check;
alter table app.analytics_events add constraint analytics_events_name_check check (name in (
  'search_performed', 'ride_published', 'booking_requested', 'booking_confirmed',
  'booking_rejected', 'booking_expired', 'booking_cancelled', 'ride_completed',
  'no_show_reported', 'rating_submitted', 'report_submitted',
  'alert_created', 'alert_matched'
));

-- ---------------------------------------------------------------------------------------------
-- RLS (no policies) and grants
-- ---------------------------------------------------------------------------------------------
alter table app.ride_series enable row level security;
alter table app.ride_alerts enable row level security;
alter table app.ride_alert_hits enable row level security;
alter table app.push_subscriptions enable row level security;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- app.match_ride_alerts: tick step 4 (ADR 0036). Takes the next p_limit rides nobody has checked
-- (oldest first, rows locked by a concurrent run are skipped) and marks them checked. A ride that is
-- not published, or departs within 10 minutes, is marked and yields nothing. For the others it finds
-- the alerts whose two points are within 800 m of the route (GiST on the alert origin, then the
-- destination) and whose time rule fits, confirms each with app.match_rides (the same rules as
-- search: direction, walk, segment length, blocks, active driver) and writes the hit. Only NEW hits
-- are returned: the primary key of ride_alert_hits makes a second run return nothing.
-- Time rule, in Europe/Bucharest local time L of the departure: a date alert needs
-- |L - (alert_date + local_time)| <= window; a weekly alert needs isodow(L) in weekdays and
-- |L - (L::date + local_time)| <= window. There is no wrap across midnight (a 23:50 alert with a
-- 30 minute window does not match a 00:10 ride): documented, rare for a commute.
-- ---------------------------------------------------------------------------------------------
create function app.match_ride_alerts(p_now timestamptz, p_limit integer)
returns table (
  alert_id uuid,
  user_id uuid,
  ride_id uuid,
  departure_at timestamptz,
  pickup_area text,
  dropoff_area text
)
language plpgsql
volatile
set search_path = app, extensions, pg_catalog
as $$
#variable_conflict use_column
begin
  return query
  with marked as (
    update app.rides r
       set alerts_checked_at = p_now
     where r.id in (
       select x.id
         from app.rides x
        where x.alerts_checked_at is null
        order by x.created_at, x.id
        limit p_limit
          for update skip locked)
    returning r.id, r.driver_id, r.status, r.departure_at, r.created_at, r.route_utm,
              r.seats_offered, r.seats_booked
  ),
  fresh as (
    select m.*, (m.departure_at at time zone 'Europe/Bucharest') as local_at
      from marked m
     where m.status = 'published'
       and m.departure_at > p_now + interval '10 minutes'
       and m.seats_booked < m.seats_offered
       and m.route_utm is not null
  ),
  cand as (
    select a.id as a_id, a.user_id as a_user, a.origin as a_origin, a.destination as a_dest,
           f.id as f_ride, f.departure_at as f_dep
      from fresh f
      join app.ride_alerts a
        on a.expires_at > p_now
       and a.created_at < f.created_at
       and a.user_id <> f.driver_id
       and ST_DWithin(a.origin_utm, f.route_utm, 800)
       and ST_DWithin(a.destination_utm, f.route_utm, 800)
      join app.profiles pr on pr.id = a.user_id and pr.status = 'active'
     where case
             when a.alert_date is not null then
               abs(extract(epoch from (f.local_at - (a.alert_date + a.local_time)))) <= a.window_min * 60
             else
               extract(isodow from f.local_at)::smallint = any (a.weekdays)
               and abs(extract(epoch from (f.local_at - (f.local_at::date + a.local_time)))) <= a.window_min * 60
           end
  ),
  matched as (
    select c.a_id, c.a_user, c.f_ride, c.f_dep, mr.pickup_area, mr.dropoff_area
      from cand c
     cross join lateral app.match_rides(
            c.a_origin, c.a_dest, null::timestamptz, null::timestamptz, c.f_dep, c.a_user, p_now,
            p_ride_id => c.f_ride) mr
  ),
  ins as (
    insert into app.ride_alert_hits (alert_id, ride_id, notified_at)
    select mt.a_id, mt.f_ride, p_now from matched mt
    on conflict on constraint ride_alert_hits_pkey do nothing
    returning ride_alert_hits.alert_id as h_alert, ride_alert_hits.ride_id as h_ride
  )
  select i.h_alert, mt.a_user, i.h_ride, mt.f_dep, mt.pickup_area, mt.dropoff_area
    from ins i
    join matched mt on mt.a_id = i.h_alert and mt.f_ride = i.h_ride
   order by mt.f_dep, i.h_alert;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- app.user_month_stats: E8-5. One user's completed money and rides in one local month
-- (Europe/Bucharest: the month a ride departed in). p_month must be the first of a month (22023).
-- Driver: bookings completed on the user's rides. Passenger: the user's own completed bookings.
-- No-shows and cancellations are not completed, so they count for nothing. Zeros, never NULL.
-- ---------------------------------------------------------------------------------------------
create function app.user_month_stats(p_user uuid, p_month date)
returns table (
  driver_shared_bani bigint,
  driver_passengers integer,
  driver_rides integer,
  passenger_paid_bani bigint,
  passenger_rides integer
)
language plpgsql
stable
set search_path = app, extensions, pg_catalog
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'p_month must be the first day of a month' using errcode = '22023';
  end if;
  v_from := p_month::timestamp at time zone 'Europe/Bucharest';
  v_to := (p_month + interval '1 month')::timestamp at time zone 'Europe/Bucharest';
  return query
  select
    coalesce((select sum(b.final_price_bani) from app.bookings b
                join app.rides r on r.id = b.ride_id
               where r.driver_id = p_user and b.status = 'completed'
                 and r.departure_at >= v_from and r.departure_at < v_to), 0)::bigint,
    (select count(*) from app.bookings b
       join app.rides r on r.id = b.ride_id
      where r.driver_id = p_user and b.status = 'completed'
        and r.departure_at >= v_from and r.departure_at < v_to)::integer,
    (select count(distinct r.id) from app.bookings b
       join app.rides r on r.id = b.ride_id
      where r.driver_id = p_user and b.status = 'completed'
        and r.departure_at >= v_from and r.departure_at < v_to)::integer,
    coalesce((select sum(b.final_price_bani) from app.bookings b
                join app.rides r on r.id = b.ride_id
               where b.passenger_id = p_user and b.status = 'completed'
                 and r.departure_at >= v_from and r.departure_at < v_to), 0)::bigint,
    (select count(*) from app.bookings b
       join app.rides r on r.id = b.ride_id
      where b.passenger_id = p_user and b.status = 'completed'
        and r.departure_at >= v_from and r.departure_at < v_to)::integer;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Replaced E6 functions: the E6 body plus the E8 additions (marked "E8" in the text).
-- ---------------------------------------------------------------------------------------------

create or replace function app.scrub_account(p_user uuid, p_now timestamptz)
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
  -- E8 (ADR 0036, 0038, 0039): alerts hold the person's exact points and commute times, push
  -- subscriptions hold device endpoints and keys. Both go now. A series holds no geometry; it is
  -- only closed (its future rides are already cancelled by DELETE /me).
  delete from app.ride_alerts where user_id = p_user;
  delete from app.push_subscriptions where user_id = p_user;
  update app.ride_series
     set status = 'cancelled', cancelled_at = coalesce(cancelled_at, p_now)
   where driver_id = p_user and status = 'active';
  update app.analytics_events set user_id = null where user_id = p_user;
end
$$;

create or replace function app.run_retention()
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
  v_alerts integer;
  v_series integer;
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

  -- E8: alerts at expiry (their hits cascade), series 90 days after their end (the foreign key sets
  -- rides.series_id to NULL: a commute pattern is not kept longer than the exact locations).
  with d as (
    delete from app.ride_alerts t
     where t.ctid in (select s.ctid from app.ride_alerts s
                       where s.expires_at < now() limit c_batch)
    returning 1)
  select count(*)::integer into v_alerts from d;

  with d as (
    delete from app.ride_series t
     where t.ctid in (select s.ctid from app.ride_series s
                       where s.ends_on < (now() - interval '90 days')::date limit c_batch)
    returning 1)
  select count(*)::integer into v_series from d;

  return jsonb_build_object(
    'rateLimits', v_rate_limits,
    'appErrors', v_app_errors,
    'outbox', v_outbox,
    'analyticsEvents', v_analytics,
    'reports', v_reports,
    'adminActions', v_admin_actions,
    'consents', v_consents,
    'accountDeletions', v_deletions,
    'dataRequests', v_requests,
    'rideAlerts', v_alerts,
    'rideSeries', v_series
  );
end
$$;

create or replace function app.export_user_data(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = app, extensions, pg_catalog
as $$
  select jsonb_build_object(
    'schemaVersion', 2,
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
    'rideAlerts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'origin', ST_AsGeoJSON(a.origin)::jsonb, 'destination', ST_AsGeoJSON(a.destination)::jsonb,
        'originLabel', a.origin_label, 'destinationLabel', a.destination_label,
        'date', a.alert_date, 'weekdays', a.weekdays, 'time', a.local_time, 'windowMin', a.window_min,
        'createdAt', a.created_at, 'expiresAt', a.expires_at, 'matchesSent', a.matches_sent)
        order by a.created_at, a.id)
        from app.ride_alerts a where a.user_id = p_user), '[]'::jsonb),
    'rideSeries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'weekdays', s.weekdays, 'departureTime', s.departure_time,
        'startsOn', s.starts_on, 'endsOn', s.ends_on, 'status', s.status,
        'createdAt', s.created_at, 'cancelledAt', s.cancelled_at)
        order by s.created_at, s.id)
        from app.ride_series s where s.driver_id = p_user), '[]'::jsonb),
    -- the push service host only (who receives the pushes), never the endpoint path or the keys
    'pushSubscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'service', split_part(split_part(u.endpoint, '://', 2), '/', 1),
        'createdAt', u.created_at, 'lastSuccessAt', u.last_success_at)
        order by u.created_at, u.id)
        from app.push_subscriptions u where u.user_id = p_user), '[]'::jsonb),
    'analyticsEvents', coalesce((
      select jsonb_agg(jsonb_build_object('name', a.name, 'props', a.props, 'occurredAt', a.occurred_at)
        order by a.occurred_at, a.id)
        from app.analytics_events a where a.user_id = p_user), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Function privileges. haide_api keeps EXECUTE through the default privileges; export_user_data
-- stays out of its reach (the owner runs it in the SQL editor).
-- ---------------------------------------------------------------------------------------------
revoke all on function app.match_ride_alerts(timestamptz, integer) from public, anon, authenticated;
revoke all on function app.user_month_stats(uuid, date) from public, anon, authenticated;
revoke all on function app.scrub_account(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.run_retention() from public, anon, authenticated;
revoke all on function app.export_user_data(uuid) from public, anon, authenticated, haide_api;
grant execute on function app.run_retention() to haide_api;
