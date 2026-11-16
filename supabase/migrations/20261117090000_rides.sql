-- E2 rides: energy price config (versioned, immutable), route previews, rides, and two route
-- helper functions. data-model.md sections 4.2 and 4.3, architecture.md section 6.
-- Forward-only. RLS is enabled on every table with NO policies (deny-all except haide_api).

-- ---------------------------------------------------------------------------------------------
-- energy_prices: versioned config. Rows are immutable: haide_api can read and append, never
-- change or delete (a new version is a new row). Each ride snapshots the version it was priced with.
-- ---------------------------------------------------------------------------------------------
create table app.energy_prices (
  id uuid primary key default gen_random_uuid(),
  fuel_type app.fuel_type not null,
  -- milli-RON per litre or kWh: 9810 = 9.81 RON/l
  price_milli integer not null check (price_milli > 0),
  -- per 100 km, x100: 700 = 7.00 l/100 km
  consumption_centi integer not null check (consumption_centi > 0),
  unit text not null check (unit in ('l', 'kWh')),
  effective_from timestamptz not null,
  source_note text,
  created_by uuid references app.profiles (id),
  created_at timestamptz not null default now(),
  unique (fuel_type, effective_from),
  check ((fuel_type = 'electric') = (unit = 'kWh'))
);

-- Seed v1 (pricing.md section 3, effective 2026-11-15). Needed in every environment, so it lives
-- in the migration and not in seed.sql. Consumptions are assumptions, prices are national averages.
insert into app.energy_prices (fuel_type, price_milli, consumption_centi, unit, effective_from, source_note)
values
  ('petrol',   9810,  700, 'l',   '2026-11-15T00:00:00Z', 'v1: national average 10 Nov 2026 (Playtech / PretCarburant.ro). Consumption: assumption'),
  ('diesel',  10850,  600, 'l',   '2026-11-15T00:00:00Z', 'v1: national average 10 Nov 2026 (Playtech / PretCarburant.ro). Consumption: assumption'),
  ('lpg',      4760,  900, 'l',   '2026-11-15T00:00:00Z', 'v1: national average 10 Nov 2026 (Playtech / PretCarburant.ro). Consumption: assumption'),
  ('hybrid',   9810,  500, 'l',   '2026-11-15T00:00:00Z', 'v1: petrol price. Consumption: assumption'),
  ('electric', 1400, 1700, 'kWh', '2026-11-15T00:00:00Z', 'v1: blended home and public charging. Assumption, verify before launch');

-- ---------------------------------------------------------------------------------------------
-- Route helper functions (immutable, pure)
-- ---------------------------------------------------------------------------------------------

-- Douglas-Peucker simplification in UTM 35N metres (topology preserving), back to WGS84.
-- 10 m for stored routes, 25 m for public ones.
create function app.simplify_route(route geometry, tolerance_m integer)
returns geometry
language sql
immutable
parallel safe
strict
set search_path = app, extensions, pg_catalog
as $$
  select ST_Transform(
    ST_SimplifyPreserveTopology(ST_Transform(ST_SetSRID(route, 4326), 32635), tolerance_m),
    4326
  )
$$;

-- Public route: trimmed by min(500 m, 10 % of the length) at both ends (the exact origin and
-- destination cannot be read from it), then simplified at 25 m (architecture section 5).
create function app.public_route(route geometry)
returns geometry
language sql
immutable
parallel safe
strict
set search_path = app, extensions, pg_catalog
as $$
  select app.simplify_route(app.trim_route(route, 500, 0.1), 25)
$$;

-- ---------------------------------------------------------------------------------------------
-- route_previews: what the driver saw when pricing a trip. 30 min TTL, purged by `tick` (E4).
-- ---------------------------------------------------------------------------------------------
create table app.route_previews (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references app.profiles (id) on delete cascade,
  origin geometry(Point, 4326) not null,
  destination geometry(Point, 4326) not null,
  origin_label text not null check (char_length(origin_label) between 1 and 80),
  destination_label text not null check (char_length(destination_label) between 1 and 80),
  -- simplified at 10 m on insert (app.simplify_route)
  route geometry(LineString, 4326) not null,
  distance_m integer not null check (distance_m > 0),
  duration_s integer not null check (duration_s > 0),
  provider text not null check (provider in ('ors', 'fixture')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);
create index route_previews_expires_idx on app.route_previews (expires_at);
create index route_previews_driver_idx on app.route_previews (driver_id);

-- ---------------------------------------------------------------------------------------------
-- rides
-- ---------------------------------------------------------------------------------------------
create table app.rides (
  id uuid primary key default gen_random_uuid(),
  -- tombstoned profiles are never deleted, so RESTRICT
  driver_id uuid not null references app.profiles (id) on delete restrict,
  -- foreign key to ride_series arrives with E8-1
  series_id uuid,
  -- exact points: coarsened to a 1 km grid centroid 90 days after departure
  origin geometry(Point, 4326) not null,
  destination geometry(Point, 4326) not null,
  -- driver-facing labels; they become the area name when coarsened
  origin_label text not null check (char_length(origin_label) between 1 and 80),
  destination_label text not null check (char_length(destination_label) between 1 and 80),
  origin_area_id uuid references app.areas (id) on delete set null,
  destination_area_id uuid references app.areas (id) on delete set null,
  -- simplified at 10 m, NULL after coarsening
  route geometry(LineString, 4326),
  route_utm geometry(LineString, 32635) generated always as (ST_Transform(route, 32635)) stored,
  distance_m integer not null check (distance_m between 1000 and 40000),
  duration_s integer not null check (duration_s > 0),
  -- 15 min to 14 days ahead is an API rule (now() is not immutable, so no CHECK)
  departure_at timestamptz not null,
  seats_offered smallint not null check (seats_offered between 1 and 4),
  seats_booked smallint not null default 0,
  note text check (char_length(note) <= 200),
  is_free boolean not null default false,
  auto_accept boolean not null default false,
  -- price snapshot: later energy price changes never alter a published ride
  energy_price_id uuid not null references app.energy_prices (id),
  rate_micro_per_km integer not null check (rate_micro_per_km > 0),
  -- {make, model, colour, plate, fuelType} at publish time. Plate scrubbed on deletion/coarsening
  vehicle_snapshot jsonb not null check (jsonb_typeof(vehicle_snapshot) = 'object'),
  status app.ride_status not null default 'published',
  cancelled_at timestamptz,
  late_cancel boolean not null default false,
  completed_at timestamptz,
  coarsened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- the overbooking backstop (E4 maps a violation to RIDE_FULL)
  constraint rides_seats_booked_range check (seats_booked between 0 and seats_offered),
  constraint rides_cancelled_has_time check (status <> 'cancelled' or cancelled_at is not null),
  constraint rides_late_cancel_only_cancelled check (not late_cancel or status = 'cancelled')
);

-- Search prefilter (E3): published rides by departure.
create index rides_published_departure_idx on app.rides (departure_at) where status = 'published';
-- Corridor filter (E3).
create index rides_route_utm_gix on app.rides using gist (route_utm) where status = 'published';
-- "My rides" lists and the daily limit count.
create index rides_driver_departure_idx on app.rides (driver_id, departure_at desc);
-- Retention job: rides still holding exact geometry.
create index rides_coarsen_idx on app.rides (departure_at) where coarsened_at is null;

-- ---------------------------------------------------------------------------------------------
-- Row level security (no policies) and grants
-- ---------------------------------------------------------------------------------------------
alter table app.energy_prices enable row level security;
alter table app.route_previews enable row level security;
alter table app.rides enable row level security;

-- Immutable config: new versions are new rows.
revoke update, delete on app.energy_prices from haide_api;

-- No access for the public roles.
revoke all on all tables in schema app from anon, authenticated;

-- Postgres grants EXECUTE to PUBLIC on every new function unless revoked (carry-forward finding).
-- haide_api keeps its own EXECUTE through the default privileges set in the baseline.
revoke all on function app.simplify_route(geometry, integer) from public, anon, authenticated;
revoke all on function app.public_route(geometry) from public, anon, authenticated;
