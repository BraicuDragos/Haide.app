-- E5 trust and safety (docs/architecture/e5-trust-safety-spec.md section 1, ADRs 0024 to 0028).
-- Forward-only. Adds reports, admin_actions and share_links, tightens ratings, rides, bookings and
-- reliability_events, and three functions: ride completion (run by the tick), suspend and unsuspend.
-- RLS is enabled on every new table with NO policies (deny-all except haide_api, which bypasses it).

-- ---------------------------------------------------------------------------------------------
-- reports: a user reports another user. The reported user's name and phone are copied in, so the
-- evidence survives account deletion. Rows are never deleted by the API role (the E6 retention
-- job gets its own path).
-- ---------------------------------------------------------------------------------------------
create table app.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references app.profiles (id),
  reported_id uuid not null references app.profiles (id),
  ride_id uuid references app.rides (id),
  booking_id uuid references app.bookings (id),
  reason app.report_reason not null,
  details text check (char_length(details) <= 500),
  -- {firstName, phoneE164} of the reported user at report time
  reported_snapshot jsonb not null,
  status app.report_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references app.profiles (id),
  constraint reports_not_self check (reporter_id <> reported_id),
  -- coalesce: a NULL comparison would let a missing detail slip through a CHECK
  constraint reports_other_has_details check (reason <> 'other' or coalesce(char_length(details), 0) >= 1),
  constraint reports_resolved_meta check ((status = 'open') = (resolved_at is null))
);
create index reports_status_created_idx on app.reports (status, created_at);
create index reports_reported_created_idx on app.reports (reported_id, created_at);

-- ---------------------------------------------------------------------------------------------
-- admin_actions: append-only log of what an admin (or the SQL console, admin_id NULL) did.
-- ---------------------------------------------------------------------------------------------
create table app.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references app.profiles (id),
  action text not null check (action in ('suspend', 'unsuspend', 'dismiss_report')),
  target_user_id uuid references app.profiles (id),
  report_id uuid references app.reports (id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_actions_target_created_idx on app.admin_actions (target_user_id, created_at);

-- ---------------------------------------------------------------------------------------------
-- share_links: one live link per booking. Only the SHA-256 of the 128-bit token is stored, so a
-- database leak cannot reveal a usable link (ADR 0026).
-- ---------------------------------------------------------------------------------------------
create table app.share_links (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references app.bookings (id),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_by uuid not null references app.profiles (id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index share_links_expires_idx on app.share_links (expires_at);

-- ---------------------------------------------------------------------------------------------
-- Changes to existing tables
-- ---------------------------------------------------------------------------------------------
-- ratings.visible_at (ADR 0025): the moment a rating starts to count. Existing rows count at once.
alter table app.ratings add column visible_at timestamptz;
update app.ratings set visible_at = created_at where visible_at is null;
alter table app.ratings alter column visible_at set not null;
alter table app.ratings add constraint ratings_tags_allowed check (
  tags <@ array['punctual', 'friendly', 'safe_driving', 'clean_car', 'respectful', 'on_time_at_pickup']::text[]);
create index ratings_ratee_visible_idx on app.ratings (ratee_id, visible_at);

alter table app.rides add constraint rides_completed_has_time check (
  status <> 'completed' or completed_at is not null);

alter table app.bookings add constraint bookings_no_show_meta check (
  (status = 'no_show') = (no_show_at is not null and no_show_by is not null));
alter table app.bookings add constraint bookings_final_only_completed check (
  final_price_bani is null or status = 'completed');

-- A booking can produce each kind of reliability event once (backstop against double counting).
create unique index reliability_events_booking_kind_uidx on app.reliability_events (booking_id, kind)
  where booking_id is not null;

-- ---------------------------------------------------------------------------------------------
-- RLS (no policies) and grants
-- ---------------------------------------------------------------------------------------------
alter table app.reports enable row level security;
alter table app.admin_actions enable row level security;
alter table app.share_links enable row level security;

revoke delete on app.reports from haide_api;
revoke update, delete on app.admin_actions from haide_api;

-- Ratings stay immutable (stars and tags), with one exception: the API may move visible_at forward
-- when the counter-rating arrives (blind ratings, ADR 0025).
grant update (visible_at) on app.ratings to haide_api;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- app.complete_rides: published rides that departed before p_cutoff are finished (tick step 2).
-- Each ride row is locked with SKIP LOCKED, so a concurrent driver action simply postpones that
-- ride to the next tick. Confirmed bookings become completed with their locked price as the final
-- one. A ride is `completed` when at least one booking was completed, else `expired`. Seat counts
-- never change here (seats_booked counts accepted seats). Requested rows are left alone: the
-- expiry step that runs just before has already handled them. Idempotent.
-- ---------------------------------------------------------------------------------------------
create function app.complete_rides(p_now timestamptz, p_cutoff timestamptz, p_limit integer)
returns table (
  ride_id uuid,
  driver_id uuid,
  driver_first_name text,
  departure_at timestamptz,
  outcome app.ride_status,
  booking_ids uuid[],
  passenger_ids uuid[]
)
language plpgsql
volatile
set search_path = app, extensions, pg_catalog
as $$
declare
  r record;
  v_ids uuid[];
  v_pids uuid[];
  v_n integer;
begin
  for r in
    select x.id as rid, x.driver_id as did, x.departure_at as dep
      from app.rides x
     where x.status = 'published' and x.departure_at <= p_cutoff
     order by x.departure_at, x.id
     limit p_limit
       for update of x skip locked
  loop
    with done as (
      update app.bookings b
         set status = 'completed', final_price_bani = b.price_locked_bani,
             passenger_event_at = p_now, updated_at = p_now
       where b.ride_id = r.rid and b.status = 'confirmed'
      returning b.id as bid, b.passenger_id as pid
    )
    select coalesce(array_agg(d.bid order by d.bid), '{}'::uuid[]),
           coalesce(array_agg(d.pid order by d.bid), '{}'::uuid[]),
           count(*)::integer
      into v_ids, v_pids, v_n
      from done d;

    update app.rides u
       set status = case when v_n > 0 then 'completed'::app.ride_status else 'expired'::app.ride_status end,
           completed_at = case when v_n > 0 then p_now end,
           updated_at = p_now
     where u.id = r.rid;

    ride_id := r.rid;
    driver_id := r.did;
    select p.first_name into driver_first_name from app.profiles p where p.id = r.did;
    departure_at := r.dep;
    outcome := case when v_n > 0 then 'completed'::app.ride_status else 'expired'::app.ride_status end;
    booking_ids := v_ids;
    passenger_ids := v_pids;
    return next;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- app.admin_suspend_user / app.admin_unsuspend_user: the one supported way to change a status
-- until the admin UI ships in E7 (which calls the same functions). `deleted` stays `deleted`.
-- Suspension cancels nothing by itself: the tick safety sweep does (ADR 0027).
-- ---------------------------------------------------------------------------------------------
create function app.admin_suspend_user(
  p_user_id uuid,
  p_reason text,
  p_admin_id uuid default null,
  p_report_id uuid default null
)
returns boolean
language plpgsql
volatile
set search_path = app, extensions, pg_catalog
as $$
declare
  v_changed integer;
begin
  update app.profiles p set status = 'suspended', updated_at = now()
   where p.id = p_user_id and p.status = 'active';
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return false;
  end if;
  insert into app.admin_actions (admin_id, action, target_user_id, report_id, details)
  values (p_admin_id, 'suspend', p_user_id, p_report_id, jsonb_build_object('reason', p_reason));
  if p_report_id is not null then
    update app.reports rp
       set status = 'actioned', resolved_at = now(), resolved_by = p_admin_id
     where rp.id = p_report_id and rp.status = 'open';
  end if;
  return true;
end
$$;

create function app.admin_unsuspend_user(
  p_user_id uuid,
  p_note text,
  p_admin_id uuid default null
)
returns boolean
language plpgsql
volatile
set search_path = app, extensions, pg_catalog
as $$
declare
  v_changed integer;
begin
  update app.profiles p set status = 'active', updated_at = now()
   where p.id = p_user_id and p.status = 'suspended';
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return false;
  end if;
  insert into app.admin_actions (admin_id, action, target_user_id, details)
  values (p_admin_id, 'unsuspend', p_user_id, jsonb_build_object('note', p_note));
  return true;
end
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function unless revoked (carry-forward finding).
-- haide_api keeps EXECUTE through the default privileges (the E7 admin endpoints call the same functions).
revoke all on function app.complete_rides(timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke all on function app.admin_suspend_user(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function app.admin_unsuspend_user(uuid, text, uuid) from public, anon, authenticated;
