-- Popular routes (improvement 4): a supporting index and app.popular_routes(), the ranking behind the public
-- GET /popular-routes. Forward-only, additive.
--
-- Definition of "popular" (also in docs/architecture/api-contract.md):
--   * rides departing between p_now - 30 days and p_now + 14 days, status published or completed
--     (cancelled and expired are excluded);
--   * grouped by (origin_area_id, destination_area_id), both NOT NULL and different;
--   * score = rides + bookings in confirmed or completed on those rides;
--   * a route is returned only when at least 2 DISTINCT drivers published it (privacy: one person's
--     habit is never exposed);
--   * order: score desc, rides desc, then origin and destination area names, then ids (deterministic);
--   * limit clamped to 1..10 (default 5).
-- The function returns area ids and counts only. No driver, passenger or ride id leaves it.
-- STABLE, search_path pinned, EXECUTE revoked from PUBLIC/anon/authenticated. haide_api keeps its own
-- EXECUTE through the default privileges set in the baseline (same as match_ride_alerts).

create index rides_popular_idx
  on app.rides (origin_area_id, destination_area_id, departure_at)
  where status in ('published', 'completed')
    and origin_area_id is not null and destination_area_id is not null;

create function app.popular_routes(p_now timestamptz, p_limit integer default 5)
returns table (
  origin_area uuid,
  destination_area uuid,
  ride_count integer,
  booking_count integer,
  score integer
)
language sql
stable
set search_path = app, extensions, pg_catalog
as $$
  with r as (
    select ru.id, ru.driver_id, ru.origin_area_id as o, ru.destination_area_id as d
    from app.rides ru
    where ru.status in ('published', 'completed')
      and ru.departure_at >= p_now - interval '30 days'
      and ru.departure_at <= p_now + interval '14 days'
      and ru.origin_area_id is not null
      and ru.destination_area_id is not null
      and ru.origin_area_id <> ru.destination_area_id
  ), g as (
    select r.o, r.d, count(*)::integer as n_rides, count(distinct r.driver_id)::integer as n_drivers
    from r
    group by r.o, r.d
  ), b as (
    select r.o, r.d, count(*)::integer as n_bookings
    from r
    join app.bookings bk on bk.ride_id = r.id and bk.status in ('confirmed', 'completed')
    group by r.o, r.d
  )
  select g.o, g.d, g.n_rides, coalesce(b.n_bookings, 0), g.n_rides + coalesce(b.n_bookings, 0)
  from g
  left join b on b.o = g.o and b.d = g.d
  join app.areas ao on ao.id = g.o
  join app.areas ad on ad.id = g.d
  where g.n_drivers >= 2
  order by g.n_rides + coalesce(b.n_bookings, 0) desc, g.n_rides desc, ao.name asc, ad.name asc, g.o asc, g.d asc
  limit least(greatest(coalesce(p_limit, 5), 1), 10)
$$;

revoke all on function app.popular_routes(timestamptz, integer) from public, anon, authenticated;
