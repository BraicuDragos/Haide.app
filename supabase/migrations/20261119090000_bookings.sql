-- E4 bookings and notifications (docs/architecture/e4-bookings-spec.md section 1, ADRs 0021, 0022, 0023).
-- Forward-only. The bookings table, the open foreign keys of earlier migrations, the expiry and
-- recipient functions, and the per-minute tick job.
-- RLS is enabled on the new table with NO policies (deny-all except haide_api, which bypasses it).

-- ---------------------------------------------------------------------------------------------
-- bookings (data-model 4.4 plus passenger_event_at)
-- ---------------------------------------------------------------------------------------------
create table app.bookings (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references app.rides (id) on delete restrict,
  -- tombstoned profiles are never deleted, so no cascade
  passenger_id uuid not null references app.profiles (id),
  status app.booking_status not null default 'requested',
  -- snapped points ON the driver's route (exact). Coarsened to a 1 km grid centroid after 90 days
  pickup geometry(Point, 4326) not null,
  dropoff geometry(Point, 4326) not null,
  -- area names (app.area_for of the exact point): safe for emails, lists and every viewer
  pickup_label text not null check (char_length(pickup_label) between 1 and 80),
  dropoff_label text not null check (char_length(dropoff_label) between 1 and 80),
  pickup_area_id uuid references app.areas (id) on delete set null,
  dropoff_area_id uuid references app.areas (id) on delete set null,
  pickup_fraction double precision not null,
  dropoff_fraction double precision not null,
  segment_m integer not null,
  walk_pickup_m integer not null check (walk_pickup_m between 0 and 800),
  walk_dropoff_m integer not null check (walk_dropoff_m between 0 and 800),
  price_quoted_bani integer not null,
  price_locked_bani integer,
  final_price_bani integer,
  idempotency_key text check (char_length(idempotency_key) <= 64),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('passenger', 'driver', 'system')),
  late_cancel boolean not null default false,
  no_show_at timestamptz,
  no_show_by text check (no_show_by in ('driver', 'passenger')),
  seen_by_passenger_at timestamptz,
  -- last change the passenger did not cause (badge): unseen = passenger_event_at > seen_by_passenger_at
  passenger_event_at timestamptz,
  coarsened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_fractions check (
    0 <= pickup_fraction and pickup_fraction < dropoff_fraction and dropoff_fraction <= 1),
  constraint bookings_segment_min check (segment_m >= 1000),
  constraint bookings_price_nonneg check (price_quoted_bani >= 0),
  constraint bookings_lock_le_quote check (
    price_locked_bani is null or (price_locked_bani >= 0 and price_locked_bani <= price_quoted_bani)),
  constraint bookings_final_le_lock check (
    final_price_bani is null or price_locked_bani is null or final_price_bani <= price_locked_bani),
  constraint bookings_locked_when_confirmed check (
    status not in ('confirmed', 'completed', 'no_show') or price_locked_bani is not null),
  constraint bookings_decided_has_time check (
    status not in ('confirmed', 'rejected') or decided_at is not null),
  constraint bookings_cancelled_has_meta check (
    status <> 'cancelled' or (cancelled_at is not null and cancelled_by is not null)),
  constraint bookings_late_only_cancelled check (not late_cancel or status = 'cancelled'),
  constraint bookings_expiry_after_request check (expires_at > requested_at),
  constraint bookings_idempotency_uniq unique (passenger_id, idempotency_key)
);

-- One live booking per passenger and ride. A cancelled, expired or rejected one does not count
-- (re-requesting after a rejection is blocked by the API, not by this index).
create unique index bookings_one_active_uidx on app.bookings (ride_id, passenger_id)
  where status in ('requested', 'confirmed');
create index bookings_ride_status_idx on app.bookings (ride_id, status);
create index bookings_passenger_idx on app.bookings (passenger_id, requested_at desc);
-- The per-minute expiry sweep.
create index bookings_expiry_idx on app.bookings (expires_at) where status = 'requested';
-- Retention job (E6): rows still holding exact geometry.
create index bookings_coarsen_idx on app.bookings (created_at) where coarsened_at is null;

-- ---------------------------------------------------------------------------------------------
-- Foreign keys that were waiting for this table (accounts migration)
-- ---------------------------------------------------------------------------------------------
alter table app.reliability_events
  add constraint reliability_events_booking_id_fkey foreign key (booking_id) references app.bookings (id);
alter table app.reliability_events
  add constraint reliability_events_ride_id_fkey foreign key (ride_id) references app.rides (id);
alter table app.ratings
  add constraint ratings_booking_id_fkey foreign key (booking_id) references app.bookings (id);

-- ---------------------------------------------------------------------------------------------
-- RLS (no policies) and grants
-- ---------------------------------------------------------------------------------------------
alter table app.bookings enable row level security;

-- Bookings are coarsened, never deleted.
revoke delete on app.bookings from haide_api;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- app.expire_requests: requested -> expired for every request past its expiry (tick, every minute).
-- Seats and prices are untouched, so no ride lock is needed (ADR 0021). Approve checks
-- expires_at > now() itself, which covers the lag until the next tick. Idempotent.
-- ---------------------------------------------------------------------------------------------
create function app.expire_requests(p_now timestamptz)
returns table (
  booking_id uuid,
  ride_id uuid,
  passenger_id uuid,
  departure_at timestamptz,
  driver_first_name text
)
language sql
volatile
set search_path = app, extensions, pg_catalog
as $$
  with expired as (
    update app.bookings b
       set status = 'expired', passenger_event_at = p_now, updated_at = p_now
     where b.status = 'requested' and b.expires_at <= p_now
    returning b.id as bid, b.ride_id as rid, b.passenger_id as pid
  )
  select e.bid, e.rid, e.pid, r.departure_at, pr.first_name
  from expired e
  join app.rides r on r.id = e.rid
  join app.profiles pr on pr.id = r.driver_id
$$;

-- ---------------------------------------------------------------------------------------------
-- app.outbox_recipients: the only path from the API role to email addresses (auth.users is not
-- readable by haide_api). Active profiles only.
-- ---------------------------------------------------------------------------------------------
create function app.outbox_recipients(p_user_ids uuid[])
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = app, extensions, pg_catalog
as $$
  select p.id, u.email::text
  from app.profiles p
  join auth.users u on u.id = p.id
  where p.id = any (p_user_ids)
    and p.status = 'active'
    and u.email is not null
$$;

-- ---------------------------------------------------------------------------------------------
-- app.call_tick: pg_cron entry point. Reads the tick URL and the cron secret from Vault and calls
-- POST /internal/tick through pg_net. Does nothing when either secret is missing (local stack, CI).
-- ---------------------------------------------------------------------------------------------
create function app.call_tick()
returns void
language plpgsql
volatile
security definer
set search_path = app, extensions, pg_catalog
as $$
declare
  v_url text;
  v_secret text;
begin
  select ds.decrypted_secret into v_url
    from vault.decrypted_secrets ds where ds.name = 'api_tick_url' limit 1;
  select ds.decrypted_secret into v_secret
    from vault.decrypted_secrets ds where ds.name = 'cron_secret' limit 1;
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret),
    timeout_milliseconds := 10000
  );
exception
  -- no Vault in this environment: nothing to do
  when undefined_table or invalid_schema_name then
    return;
end
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function unless revoked (carry-forward finding).
-- haide_api keeps EXECUTE on expire_requests and outbox_recipients through the default privileges.
revoke all on function app.expire_requests(timestamptz) from public, anon, authenticated;
revoke all on function app.outbox_recipients(uuid[]) from public, anon, authenticated;
revoke all on function app.call_tick() from public, anon, authenticated, haide_api;

-- ---------------------------------------------------------------------------------------------
-- Cron: every minute. cron.schedule with a job name replaces an existing job of that name.
-- ---------------------------------------------------------------------------------------------
select cron.schedule('haide-tick', '* * * * *', $cron$select app.call_tick()$cron$);
