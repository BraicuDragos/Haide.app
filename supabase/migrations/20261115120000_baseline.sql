-- Baseline schema (E0): extensions, schema `app`, roles and grants, enum types, helper
-- functions and the operational + geo reference tables (data-model.md sections 1, 3, 4.6, 4.7, 5, 7).
-- Forward-only. Later epics add their own tables and tighten grants per table.

-- ---------------------------------------------------------------------------------------------
-- Extensions (Supabase convention: installed into the `extensions` schema)
-- ---------------------------------------------------------------------------------------------
create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- Schema `app`: private. Not exposed through the Data API, no access for anon/authenticated.
-- ---------------------------------------------------------------------------------------------
create schema if not exists app;
revoke all on schema app from public;
revoke all on schema app from anon, authenticated;

-- API role. LOGIN without a password: the password is set out of band
-- (deploy.yml `ALTER ROLE haide_api PASSWORD ...`, or seed.sql for the local stack).
-- BYPASSRLS because tables have RLS enabled and no policies (deny-all for everyone else);
-- authorization happens in the API layer (architecture 8, data-model 5).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'haide_api') then
    create role haide_api login nosuperuser nocreatedb nocreaterole noinherit bypassrls;
  end if;
end
$$;

alter role haide_api set search_path = app, extensions, public;
alter role haide_api set statement_timeout = '10s';
alter role haide_api set idle_in_transaction_session_timeout = '15s';

-- Supabase lets the pooler / admin connect as other roles through postgres.
grant haide_api to postgres;

grant usage on schema app to haide_api;
-- haide_api can use PostGIS / pg_trgm / unaccent objects.
grant usage on schema extensions to haide_api;

-- Everything created in `app` from now on is usable by haide_api only.
alter default privileges in schema app
  grant select, insert, update, delete on tables to haide_api;
alter default privileges in schema app
  grant usage, select on sequences to haide_api;
alter default privileges in schema app
  grant execute on functions to haide_api;

-- ---------------------------------------------------------------------------------------------
-- Enum types (data-model 3). Adding values is a migration.
-- ---------------------------------------------------------------------------------------------
create type app.profile_status as enum ('active', 'suspended', 'deleted');
create type app.user_role as enum ('user', 'admin');
create type app.fuel_type as enum ('petrol', 'diesel', 'lpg', 'hybrid', 'electric');
create type app.ride_status as enum ('published', 'cancelled', 'completed', 'expired');
create type app.booking_status as enum (
  'requested', 'confirmed', 'rejected', 'expired', 'cancelled', 'completed', 'no_show'
);
create type app.consent_kind as enum ('terms', 'privacy', 'age_18');
create type app.report_reason as enum (
  'no_show', 'unsafe_driving', 'harassment', 'extra_money', 'fake_profile', 'other'
);
create type app.report_status as enum ('open', 'dismissed', 'actioned');
create type app.reliability_kind as enum ('late_cancellation', 'no_show');
create type app.outbox_status as enum ('pending', 'sent', 'failed');
create type app.notify_channel as enum ('email', 'push');

-- ---------------------------------------------------------------------------------------------
-- Pure helper functions
-- ---------------------------------------------------------------------------------------------

-- Indexable unaccent. Romanian comma-below and cedilla forms are mapped explicitly so the result
-- does not depend on the unaccent rules file: Ș/ș/Ş/ş -> s, Ț/ț/Ţ/ţ -> t.
create function app.immutable_unaccent(input text)
returns text
language sql
immutable
parallel safe
strict
set search_path = extensions, pg_catalog
as $$
  select extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    translate(input, 'ȘșŞşȚțŢţ', 'SsSsTtTt')
  )
$$;

-- Deterministic grid rounding in UTM 35N (EPSG:32635): centre of the cell_m x cell_m cell that
-- contains the point, back in WGS84 with 5 decimals. 300 m for public points, 1000 m for
-- retention coarsening. Mirrored by gridPoint() in _shared/domain/privacy.ts.
create function app.grid_point(p geometry, cell_m integer)
returns geometry
language sql
immutable
parallel safe
strict
set search_path = extensions, pg_catalog
as $$
  select ST_SnapToGrid(
    ST_Transform(
      ST_SetSRID(
        ST_MakePoint(
          (floor(ST_X(u.g) / cell_m) + 0.5) * cell_m,
          (floor(ST_Y(u.g) / cell_m) + 0.5) * cell_m
        ),
        32635
      ),
      4326
    ),
    0.00001
  )
  from (select ST_Transform(ST_SetSRID(p, 4326), 32635) as g) u
$$;

-- Public route trimming: cut min(max_m, max_ratio * length) off both ends so the exact origin
-- and destination cannot be read from the published polyline. NULL when nothing would remain.
create function app.trim_route(route geometry, max_m integer, max_ratio double precision)
returns geometry
language sql
immutable
parallel safe
strict
set search_path = extensions, pg_catalog
as $$
  select case
    when l.len <= 0 or 2 * least(max_m::double precision, max_ratio * l.len) >= l.len then null
    else ST_Transform(
      ST_LineSubstring(
        l.utm,
        least(max_m::double precision, max_ratio * l.len) / l.len,
        1 - least(max_m::double precision, max_ratio * l.len) / l.len
      ),
      4326
    )
  end
  from (
    select ST_Transform(ST_SetSRID(route, 4326), 32635) as utm,
           ST_Length(ST_Transform(ST_SetSRID(route, 4326), 32635)) as len
  ) l
$$;

-- Fixed-window rate limiter. Returns false when the caller is over the limit.
create function app.rate_limit_hit(p_key text, p_window_s integer, p_max integer)
returns boolean
language plpgsql
volatile
set search_path = app, pg_catalog
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  c integer;
begin
  insert into app.rate_limits as r (key, window_start, count)
  values (p_key, w, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into c;
  return c <= p_max;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Geo reference data (gazetteer, ADR 0014)
-- ---------------------------------------------------------------------------------------------
create table app.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  locality text not null check (char_length(locality) between 1 and 80),
  kind text not null check (kind in ('suburb', 'quarter', 'neighbourhood', 'locality')),
  geom geometry(MultiPolygon, 4326) not null,
  centroid geometry(Point, 4326) not null,
  osm_id bigint unique
);
create index areas_geom_gix on app.areas using gist (geom);

create table app.places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  locality text,
  -- diacritics-insensitive, lower-case: the only column autocomplete scans
  search_text text generated always as (
    app.immutable_unaccent(lower(name || ' ' || coalesce(locality, '')))
  ) stored,
  kind text not null check (kind in ('street', 'poi', 'address', 'area')),
  area_id uuid references app.areas (id) on delete set null,
  geom geometry(Point, 4326) not null,
  -- area 1 > POI 2 > street 3 > address 4
  rank smallint not null check (rank between 1 and 4),
  osm_id bigint
);
create index places_search_trgm_gix on app.places using gin (search_text extensions.gin_trgm_ops);
create index places_geom_gix on app.places using gist (geom);
create index places_area_idx on app.places (area_id);

-- Area containing the point, else the nearest area centroid.
create function app.area_for(p geometry)
returns uuid
language sql
stable
parallel safe
set search_path = app, extensions, pg_catalog
as $$
  select coalesce(
    (select a.id from app.areas a where ST_Covers(a.geom, ST_SetSRID(p, 4326)) limit 1),
    (select a.id from app.areas a order by a.centroid <-> ST_SetSRID(p, 4326) limit 1)
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Operations tables (data-model 4.7)
-- ---------------------------------------------------------------------------------------------
create table app.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
create index rate_limits_window_idx on app.rate_limits (window_start);

create table app.app_errors (
  id bigint generated always as identity primary key,
  source text not null check (source in ('client', 'server')),
  message text not null check (char_length(message) <= 500),
  stack text check (char_length(stack) <= 4000),
  route text check (char_length(route) <= 200),
  app_version text check (char_length(app_version) <= 64),
  user_id_hash text check (char_length(user_id_hash) <= 64),
  created_at timestamptz not null default now()
);
create index app_errors_created_idx on app.app_errors (created_at);

create table app.analytics_events (
  id bigint generated always as identity primary key,
  name text not null check (name in (
    'search_performed', 'ride_published', 'booking_requested', 'booking_confirmed',
    'booking_rejected', 'booking_expired', 'booking_cancelled', 'ride_completed',
    'no_show_reported', 'rating_submitted', 'report_submitted'
  )),
  user_id uuid, -- nulled on account deletion
  props jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index analytics_events_name_idx on app.analytics_events (name, occurred_at);

-- user_id gets its foreign key to profiles in E1 (the table does not exist yet).
create table app.outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  channel app.notify_channel not null default 'email',
  template text not null,
  -- labels, times and first names only: no coordinates, phones or plates (conventions 6)
  payload jsonb not null default '{}'::jsonb,
  status app.outbox_status not null default 'pending',
  attempts smallint not null default 0,
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index outbox_pending_idx on app.outbox (send_after) where status = 'pending';

-- ---------------------------------------------------------------------------------------------
-- Row level security: enabled on every table, no policies (deny-all). haide_api bypasses it.
-- ---------------------------------------------------------------------------------------------
alter table app.areas enable row level security;
alter table app.places enable row level security;
alter table app.rate_limits enable row level security;
alter table app.app_errors enable row level security;
alter table app.analytics_events enable row level security;
alter table app.outbox enable row level security;

-- The gazetteer is reference data loaded by migrations: the API only reads it.
revoke insert, update, delete on app.areas, app.places from haide_api;

-- Belt and braces: nothing in `app` is reachable by the public roles.
revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
