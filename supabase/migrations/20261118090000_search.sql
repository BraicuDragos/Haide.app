-- E3 search and matching: the `blocks` table (needed by the match filter) and app.match_rides
-- (ADR 0015, architecture.md section 5). Forward-only.
-- RLS is enabled on the new table with NO policies (deny-all except haide_api).

-- ---------------------------------------------------------------------------------------------
-- blocks: one row per (blocker, blocked). Either direction hides the pair from search and matching.
-- The endpoints that write it arrive with E5; E3 only reads it.
-- ---------------------------------------------------------------------------------------------
create table app.blocks (
  blocker_id uuid not null references app.profiles (id) on delete cascade,
  blocked_id uuid not null references app.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
-- Reverse lookup: "who blocked me" (the match filter checks both directions).
create index blocks_blocked_idx on app.blocks (blocked_id);

alter table app.blocks enable row level security;

-- No access for the public roles (haide_api gets DML through the default privileges).
revoke all on all tables in schema app from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- app.match_rides: rides that fit a passenger's origin, destination and time window.
--
--   p_origin, p_destination  WGS84 points (the passenger's typed points, never stored)
--   p_from, p_to             departure window, inclusive
--   p_desired                the desired departure (only used for ordering)
--   p_searcher               the caller (NULL when signed out): own rides and blocked pairs are hidden
--   p_now                    "now" injected by the API (departed rides are excluded)
--   p_ride_id                single-ride re-check (match endpoint, booking): ignores the window,
--                            status, seats and ownership filters and returns the ride's state so the
--                            caller can name the reason; geometry and driver status still apply
--   p_include_blocked        true: blocked pairs are returned with blocked = true (the API counts and
--                            hides them). false: they are dropped
--   p_exclude_from/to        drop rides departing inside this range (the "nearest outside the window"
--                            query reuses the function with a whole-day window)
--   p_max_walk_m             straight-line walking limit (MAX_WALK_M in domain/rules.ts)
--   p_min_segment_m          shortest ride segment (MIN_SEGMENT_M)
--
-- Per ride: f_p = fraction of the route nearest to the origin; f_d = fraction nearest to the
-- destination searched only AFTER f_p (ST_LineSubstring), so loops pick the later pass and the
-- reverse direction fails the walk test. segment_m scales the router's distance by the fraction.
-- Only 300 m grid centres and area names leave the function (ADR 0005); exact snapped points do not.
-- Walk distances are exact here: the API rounds them to 50 m.
-- Order: total walk rounded to 50 m (what the user sees), then |departure - desired|, then id.
-- ---------------------------------------------------------------------------------------------
create function app.match_rides(
  p_origin geometry,
  p_destination geometry,
  p_from timestamptz,
  p_to timestamptz,
  p_desired timestamptz,
  p_searcher uuid,
  p_now timestamptz,
  p_ride_id uuid default null,
  p_include_blocked boolean default false,
  p_exclude_from timestamptz default null,
  p_exclude_to timestamptz default null,
  p_max_walk_m integer default 800,
  p_min_segment_m integer default 1000,
  p_limit integer default 50
)
returns table (
  ride_id uuid,
  driver_id uuid,
  ride_status text,
  departure_at timestamptz,
  duration_s integer,
  distance_m integer,
  seats_offered integer,
  seats_booked integer,
  is_free boolean,
  rate_micro_per_km integer,
  segment_m integer,
  walk_pickup_m double precision,
  walk_dropoff_m double precision,
  f_pickup double precision,
  f_dropoff double precision,
  pickup_eta_at timestamptz,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_lat double precision,
  dropoff_lng double precision,
  pickup_area text,
  dropoff_area text,
  blocked boolean
)
language sql
stable
parallel safe
set search_path = app, extensions, pg_catalog
as $$
  with q as (
    select ST_Transform(ST_SetSRID(p_origin, 4326), 32635) as o,
           ST_Transform(ST_SetSRID(p_destination, 4326), 32635) as t
  ),
  -- Candidate rides. The two branches are mutually exclusive on a parameter, so the planner keeps
  -- only one of them and the partial index (status = 'published', departure_at) serves the search.
  base as (
    select r.id, r.driver_id, r.status, r.departure_at, r.duration_s, r.distance_m,
           r.seats_offered, r.seats_booked, r.is_free, r.rate_micro_per_km, r.route_utm
    from app.rides r
    where p_ride_id is null
      and r.status = 'published'
      and r.departure_at > p_now
      and r.departure_at >= p_from and r.departure_at <= p_to
      and r.seats_booked < r.seats_offered
      and (p_searcher is null or r.driver_id <> p_searcher)
      and (p_exclude_from is null or r.departure_at < p_exclude_from or r.departure_at > p_exclude_to)
    union all
    select r.id, r.driver_id, r.status, r.departure_at, r.duration_s, r.distance_m,
           r.seats_offered, r.seats_booked, r.is_free, r.rate_micro_per_km, r.route_utm
    from app.rides r
    where p_ride_id is not null and r.id = p_ride_id
  ),
  -- Active drivers only, then the corridor filter (GiST) around both typed points.
  near as (
    select b.*, q.o, q.t, ST_LineLocatePoint(b.route_utm, q.o) as f_p
    from base b
    cross join q
    join app.profiles pr on pr.id = b.driver_id and pr.status = 'active'
    where b.route_utm is not null
      and ST_DWithin(b.route_utm, q.o, p_max_walk_m)
      and ST_DWithin(b.route_utm, q.t, p_max_walk_m)
  ),
  -- Destination located on the rest of the route only. A segment of at least 1 km can never
  -- start in the last 1 % of a route of at most 40 km, so f_p < 0.99 also avoids a degenerate
  -- (point) substring.
  after_pickup as (
    select n.*, ST_LineLocatePoint(ST_LineSubstring(n.route_utm, n.f_p, 1), n.t) as g
    from near n
    where n.f_p < 0.99
  ),
  located as (
    -- least(): float rounding must never push the fraction above 1 (ST_LineInterpolatePoint errors)
    select a.*, least(1::double precision, a.f_p + (1 - a.f_p) * a.g) as f_d
    from after_pickup a
  ),
  snapped as (
    select l.*,
           ST_LineInterpolatePoint(l.route_utm, l.f_p) as pp,
           ST_LineInterpolatePoint(l.route_utm, l.f_d) as dp
    from located l
    where l.f_d > l.f_p
  ),
  measured as (
    select s.*,
           ST_Distance(s.o, s.pp) as walk_p,
           ST_Distance(s.t, s.dp) as walk_d,
           round(s.distance_m * (s.f_d - s.f_p))::integer as seg_m,
           exists (
             select 1 from app.blocks bl
             where p_searcher is not null
               and ((bl.blocker_id = p_searcher and bl.blocked_id = s.driver_id)
                 or (bl.blocker_id = s.driver_id and bl.blocked_id = p_searcher))
           ) as is_blocked
    from snapped s
  ),
  ranked as (
    select m.*
    from measured m
    where m.walk_p <= p_max_walk_m
      and m.walk_d <= p_max_walk_m
      and m.seg_m >= p_min_segment_m
      and (p_include_blocked or not m.is_blocked)
    order by (round(m.walk_p / 50) + round(m.walk_d / 50)) * 50,
             abs(extract(epoch from (m.departure_at - p_desired))),
             m.id
    limit p_limit
  ),
  gridded as (
    select k.*,
           app.grid_point(ST_Transform(k.pp, 4326), 300) as pg,
           app.grid_point(ST_Transform(k.dp, 4326), 300) as dg
    from ranked k
  )
  select
    x.id,
    x.driver_id,
    x.status::text,
    x.departure_at,
    x.duration_s::integer,
    x.distance_m::integer,
    x.seats_offered::integer,
    x.seats_booked::integer,
    x.is_free,
    x.rate_micro_per_km::integer,
    x.seg_m,
    x.walk_p::double precision,
    x.walk_d::double precision,
    x.f_p::double precision,
    x.f_d::double precision,
    x.departure_at + make_interval(secs => x.duration_s * x.f_p),
    ST_Y(x.pg)::double precision,
    ST_X(x.pg)::double precision,
    ST_Y(x.dg)::double precision,
    ST_X(x.dg)::double precision,
    (select a.name from app.areas a where a.id = app.area_for(x.pg)),
    (select a.name from app.areas a where a.id = app.area_for(x.dg)),
    x.is_blocked
  from gridded x
  order by (round(x.walk_p / 50) + round(x.walk_d / 50)) * 50,
           abs(extract(epoch from (x.departure_at - p_desired))),
           x.id
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function unless revoked (carry-forward finding).
-- haide_api keeps its own EXECUTE through the default privileges set in the baseline.
revoke all on function app.match_rides(
  geometry, geometry, timestamptz, timestamptz, timestamptz, uuid, timestamptz,
  uuid, boolean, timestamptz, timestamptz, integer, integer, integer
) from public, anon, authenticated;
