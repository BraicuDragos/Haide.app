import type { Db } from '../../_shared/db.ts';
import type { FuelType } from '../../_shared/contracts/account.ts';
import type { LatLng } from '../../_shared/contracts/geo.ts';
import type { RideStatus } from '../../_shared/contracts/rides.ts';
import { RATING_WINDOW_DAYS } from '../../_shared/domain/rules.ts';

/**
 * SQL for rides (E2). postgres.js tagged templates only. Columns are listed explicitly (no
 * SELECT *). Geometry in via ST_MakePoint / ST_GeomFromGeoJSON, out via ST_AsGeoJSON / ST_X / ST_Y
 * (5 decimals exact). Parameters inside SELECT lists carry explicit casts.
 * jsonb parameters go in as `JSON.stringify(x)::text::jsonb`: with a bare `::jsonb` cast postgres.js
 * infers the jsonb type and encodes the string a second time (a JSON string scalar, not an object).
 */

export type EnergyPriceRow = { id: string; price_milli: number; consumption_centi: number };

/**
 * The price version in effect at `at`: the latest `effective_from <= at`. If none is effective yet
 * (clock before the first version), the earliest version is used so publishing never breaks.
 */
export async function energyPriceFor(
  sql: Db,
  fuel: FuelType,
  at: Date,
): Promise<EnergyPriceRow | null> {
  const rows = await sql<EnergyPriceRow[]>`
    select id, price_milli, consumption_centi
    from app.energy_prices
    where fuel_type = ${fuel}
    order by (effective_from <= ${at}) desc,
             case when effective_from <= ${at} then effective_from end desc nulls last,
             effective_from asc
    limit 1`;
  return rows[0] ?? null;
}

export type PointInfo = {
  area_id: string | null;
  area_name: string | null;
  place_name: string | null;
};

/** Area containing the point (nearest as a fallback) and the nearest named place within ~150 m. */
export async function describePoint(sql: Db, p: LatLng): Promise<PointInfo> {
  const rows = await sql<PointInfo[]>`
    select a.id as area_id, a.name as area_name,
      (select pl.name from app.places pl
        where pl.kind <> 'area' and ST_DWithin(pl.geom, pt.g, 0.002)
        order by pl.geom <-> pt.g
        limit 1) as place_name
    from (select ST_SetSRID(ST_MakePoint(${p.lng}::float8, ${p.lat}::float8), 4326) as g) pt
    left join app.areas a on a.id = app.area_for(pt.g)`;
  return rows[0] ?? { area_id: null, area_name: null, place_name: null };
}

export type NewPreview = {
  driverId: string;
  origin: LatLng;
  destination: LatLng;
  originLabel: string;
  destinationLabel: string;
  /** GeoJSON LineString text. Simplified at 10 m in SQL on insert. */
  routeGeoJson: string;
  distanceM: number;
  durationS: number;
  provider: 'ors' | 'fixture';
  createdAt: Date;
  expiresAt: Date;
};

export async function insertPreview(
  sql: Db,
  v: NewPreview,
): Promise<{ id: string; routeGeoJson: string }> {
  const rows = await sql<{ id: string; route_geojson: string }[]>`
    insert into app.route_previews
      (driver_id, origin, destination, origin_label, destination_label, route,
       distance_m, duration_s, provider, created_at, expires_at)
    values (
      ${v.driverId},
      ST_SetSRID(ST_MakePoint(${v.origin.lng}::float8, ${v.origin.lat}::float8), 4326),
      ST_SetSRID(ST_MakePoint(${v.destination.lng}::float8, ${v.destination.lat}::float8), 4326),
      ${v.originLabel}, ${v.destinationLabel},
      app.simplify_route(ST_SetSRID(ST_GeomFromGeoJSON(${v.routeGeoJson}::text), 4326), 10),
      ${v.distanceM}, ${v.durationS}, ${v.provider}, ${v.createdAt}, ${v.expiresAt})
    returning id, ST_AsGeoJSON(route, 5) as route_geojson`;
  const row = rows[0];
  if (!row) throw new Error('preview insert returned no row');
  return { id: row.id, routeGeoJson: row.route_geojson };
}

/** Serialises publishes of one driver inside the current transaction (daily limit). */
export async function lockDriverPublishing(sql: Db, driverId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`ride-publish:${driverId}`}::text, 0))`;
}

/** Rides that count toward the daily limit: not cancelled, departing in [start, end). */
export async function countDriverRidesBetween(
  sql: Db,
  driverId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n
    from app.rides
    where driver_id = ${driverId} and status <> 'cancelled'
      and departure_at >= ${start} and departure_at < ${end}`;
  return rows[0]?.n ?? 0;
}

export type NewRide = {
  previewId: string;
  driverId: string;
  now: Date;
  departureAt: Date;
  seats: number;
  note: string | null;
  isFree: boolean;
  /** E8-3: confirm eligible requests at once. */
  autoAccept?: boolean;
  /** E8-1: the series this instance belongs to. */
  seriesId?: string | null;
  energyPriceId: string;
  rateMicroPerKm: number;
  vehicleSnapshot: {
    make: string;
    model: string;
    colour: string;
    plate: string;
    fuelType: FuelType;
  };
};

/**
 * Creates the ride from the driver's own, unexpired preview (copies points, labels, route and
 * distance, so the client cannot supply any of them). Returns null when the preview is missing,
 * expired or someone else's: the caller answers PREVIEW_EXPIRED.
 */
export async function insertRideFromPreview(sql: Db, v: NewRide): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    insert into app.rides
      (driver_id, origin, destination, origin_label, destination_label, origin_area_id,
       destination_area_id, route, distance_m, duration_s, departure_at, seats_offered, note,
       is_free, auto_accept, series_id, energy_price_id, rate_micro_per_km, vehicle_snapshot,
       created_at, updated_at)
    select p.driver_id, p.origin, p.destination, p.origin_label, p.destination_label,
           app.area_for(p.origin), app.area_for(p.destination), p.route, p.distance_m, p.duration_s,
           ${v.departureAt}::timestamptz, ${v.seats}::smallint, ${v.note}::text,
           ${v.isFree}::boolean, ${v.autoAccept ?? false}::boolean, ${v.seriesId ?? null}::uuid,
           ${v.energyPriceId}::uuid, ${v.rateMicroPerKm}::integer,
           ${JSON.stringify(v.vehicleSnapshot)}::text::jsonb, ${v.now}::timestamptz, ${v.now}::timestamptz
    from app.route_previews p
    where p.id = ${v.previewId} and p.driver_id = ${v.driverId} and p.expires_at > ${v.now}
    returning id`;
  return rows[0]?.id ?? null;
}

/** Analytics `ride_published`: ids, counts, area names and booleans only (conventions §6). */
export async function insertRidePublishedEvent(
  sql: Db,
  userId: string,
  rideId: string,
  at: Date,
): Promise<void> {
  await sql`
    insert into app.analytics_events (name, user_id, props, occurred_at)
    select 'ride_published', ${userId}::uuid,
           jsonb_build_object(
             'rideId', r.id, 'distanceM', r.distance_m, 'seats', r.seats_offered,
             'isFree', r.is_free, 'originArea', oa.name, 'destinationArea', da.name,
             'inSeries', r.series_id is not null, 'autoAccept', r.auto_accept),
           ${at}::timestamptz
    from app.rides r
    left join app.areas oa on oa.id = r.origin_area_id
    left join app.areas da on da.id = r.destination_area_id
    where r.id = ${rideId}`;
}

/** Area names of a ride's endpoints: the only place labels that may leave in an email. */
export async function rideAreaLabels(
  sql: Db,
  rideId: string,
): Promise<{ origin: string | null; destination: string | null }> {
  const rows = await sql<{ origin: string | null; destination: string | null }[]>`
    select oa.name as origin, da.name as destination
    from app.rides r
    left join app.areas oa on oa.id = r.origin_area_id
    left join app.areas da on da.id = r.destination_area_id
    where r.id = ${rideId}`;
  return rows[0] ?? { origin: null, destination: null };
}

// ---- owner reads ------------------------------------------------------------------------------

export type VehicleSnapshot = {
  make: string;
  model: string;
  colour: string;
  plate: string;
  fuelType: FuelType;
};

export type OwnerRideRow = {
  id: string;
  status: RideStatus;
  departure_at: Date | string;
  origin_label: string;
  destination_label: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  route_geojson: string | null;
  distance_m: number;
  duration_s: number;
  seats_offered: number;
  seats_booked: number;
  note: string | null;
  is_free: boolean;
  auto_accept: boolean;
  series_id: string | null;
  rate_micro_per_km: number;
  vehicle_snapshot: VehicleSnapshot;
  late_cancel: boolean;
  cancelled_at: Date | string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
};

/** The driver's own ride (exact points and route). `forUpdate` locks the row in a transaction. */
export async function selectOwnerRide(
  sql: Db,
  rideId: string,
  driverId: string,
  forUpdate = false,
): Promise<OwnerRideRow | undefined> {
  const rows = forUpdate
    ? await sql<OwnerRideRow[]>`
        select r.id, r.status, r.departure_at, r.origin_label, r.destination_label,
          round(ST_Y(r.origin)::numeric, 5)::float8 as origin_lat,
          round(ST_X(r.origin)::numeric, 5)::float8 as origin_lng,
          round(ST_Y(r.destination)::numeric, 5)::float8 as destination_lat,
          round(ST_X(r.destination)::numeric, 5)::float8 as destination_lng,
          ST_AsGeoJSON(r.route, 5) as route_geojson,
          r.distance_m, r.duration_s, r.seats_offered, r.seats_booked, r.note, r.is_free,
          r.auto_accept, r.series_id,
          r.rate_micro_per_km, r.vehicle_snapshot, r.late_cancel, r.cancelled_at, r.created_at,
          r.completed_at
        from app.rides r
        where r.id = ${rideId} and r.driver_id = ${driverId}
        for update of r`
    : await sql<OwnerRideRow[]>`
        select r.id, r.status, r.departure_at, r.origin_label, r.destination_label,
          round(ST_Y(r.origin)::numeric, 5)::float8 as origin_lat,
          round(ST_X(r.origin)::numeric, 5)::float8 as origin_lng,
          round(ST_Y(r.destination)::numeric, 5)::float8 as destination_lat,
          round(ST_X(r.destination)::numeric, 5)::float8 as destination_lng,
          ST_AsGeoJSON(r.route, 5) as route_geojson,
          r.distance_m, r.duration_s, r.seats_offered, r.seats_booked, r.note, r.is_free,
          r.auto_accept, r.series_id,
          r.rate_micro_per_km, r.vehicle_snapshot, r.late_cancel, r.cancelled_at, r.created_at,
          r.completed_at
        from app.rides r
        where r.id = ${rideId} and r.driver_id = ${driverId}`;
  return rows[0];
}

/** A ride completed after this instant can still be rated (completion + 7 days > now). */
const ratingCutoff = (now: Date): Date => new Date(now.getTime() - RATING_WINDOW_DAYS * 86_400_000);

export type RideListRow = {
  id: string;
  departure_at: Date | string;
  origin_label: string;
  destination_label: string;
  status: RideStatus;
  seats_offered: number;
  seats_booked: number;
  /** Open requests: requested and not past their expiry. */
  pending_requests: number;
  /** Completed passengers the driver can still rate (E5). */
  to_rate: number;
  series_id: string | null;
};

/**
 * Upcoming: published rides departing now or later, ascending. Keyset pagination on
 * (departure_at, id): `after` is the last row of the previous page.
 */
export async function listUpcomingRides(
  sql: Db,
  driverId: string,
  now: Date,
  after: { departureAt: Date; id: string } | null,
  limit: number,
): Promise<RideListRow[]> {
  const hasCursor = after !== null;
  const cursorAt = after?.departureAt ?? now;
  const cursorId = after?.id ?? '00000000-0000-0000-0000-000000000000';
  const rateCutoff = ratingCutoff(now);
  return await sql<RideListRow[]>`
    select r.id, r.departure_at, r.origin_label, r.destination_label, r.status,
           r.seats_offered, r.seats_booked, r.series_id,
           (select count(*)::int from app.bookings b
             where b.ride_id = r.id and b.status = 'requested' and b.expires_at > ${now}) as pending_requests,
           (select count(*)::int from app.bookings b
             where b.ride_id = r.id and b.status = 'completed' and r.completed_at > ${rateCutoff}
               and not exists (select 1 from app.ratings x
                 where x.booking_id = b.id and x.rater_id = r.driver_id)) as to_rate
    from app.rides r
    where r.driver_id = ${driverId} and r.status = 'published' and r.departure_at >= ${now}
      and (not ${hasCursor}::boolean or (r.departure_at, r.id) > (${cursorAt}::timestamptz, ${cursorId}::uuid))
    order by r.departure_at asc, r.id asc
    limit ${limit}`;
}

/** Past: departed or no longer published (cancelled, completed, expired), newest first. */
export async function listPastRides(
  sql: Db,
  driverId: string,
  now: Date,
  after: { departureAt: Date; id: string } | null,
  limit: number,
): Promise<RideListRow[]> {
  const hasCursor = after !== null;
  const cursorAt = after?.departureAt ?? now;
  const cursorId = after?.id ?? 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const rateCutoff = ratingCutoff(now);
  return await sql<RideListRow[]>`
    select r.id, r.departure_at, r.origin_label, r.destination_label, r.status,
           r.seats_offered, r.seats_booked, r.series_id,
           (select count(*)::int from app.bookings b
             where b.ride_id = r.id and b.status = 'requested' and b.expires_at > ${now}) as pending_requests,
           (select count(*)::int from app.bookings b
             where b.ride_id = r.id and b.status = 'completed' and r.completed_at > ${rateCutoff}
               and not exists (select 1 from app.ratings x
                 where x.booking_id = b.id and x.rater_id = r.driver_id)) as to_rate
    from app.rides r
    where r.driver_id = ${driverId} and (r.status <> 'published' or r.departure_at < ${now})
      and (not ${hasCursor}::boolean or (r.departure_at, r.id) < (${cursorAt}::timestamptz, ${cursorId}::uuid))
    order by r.departure_at desc, r.id desc
    limit ${limit}`;
}

// ---- cancel -------------------------------------------------------------------------------------

export async function markRideCancelled(
  sql: Db,
  rideId: string,
  at: Date,
  lateCancel: boolean,
): Promise<void> {
  await sql`
    update app.rides
    set status = 'cancelled', cancelled_at = ${at}, late_cancel = ${lateCancel}, updated_at = ${at}
    where id = ${rideId}`;
}

export async function insertLateCancelEvent(
  sql: Db,
  userId: string,
  rideId: string,
  at: Date,
): Promise<void> {
  await sql`
    insert into app.reliability_events (user_id, kind, ride_id, occurred_at)
    values (${userId}, 'late_cancellation', ${rideId}, ${at})`;
}

// ---- public read --------------------------------------------------------------------------------

export type PublicRideRow = {
  id: string;
  status: RideStatus;
  departure_at: Date | string;
  duration_s: number;
  distance_m: number;
  seats_offered: number;
  seats_booked: number;
  note: string | null;
  is_free: boolean;
  auto_accept: boolean;
  rate_micro_per_km: number;
  driver_id: string;
  driver_status: 'active' | 'suspended' | 'deleted';
  /** Snapshot WITHOUT the plate (removed in SQL). */
  car: { make: string | null; model: string | null; colour: string | null };
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  origin_area: string | null;
  destination_area: string | null;
  route_public: string | null;
  /** A block exists between the viewer and the driver, in either direction (false when signed out). */
  blocked: boolean;
};

/** Public projection: 300 m grid points, area names, trimmed route. No plate, no exact points. */
export async function selectPublicRide(
  sql: Db,
  rideId: string,
  viewerId: string | null,
): Promise<PublicRideRow | undefined> {
  const rows = await sql<PublicRideRow[]>`
    select r.id, r.status, r.departure_at, r.duration_s, r.distance_m, r.seats_offered,
      r.seats_booked, r.note, r.is_free, r.auto_accept, r.rate_micro_per_km, r.driver_id,
      p.status as driver_status,
      jsonb_build_object(
        'make', r.vehicle_snapshot -> 'make',
        'model', r.vehicle_snapshot -> 'model',
        'colour', r.vehicle_snapshot -> 'colour') as car,
      ST_Y(app.grid_point(r.origin, 300)) as origin_lat,
      ST_X(app.grid_point(r.origin, 300)) as origin_lng,
      ST_Y(app.grid_point(r.destination, 300)) as destination_lat,
      ST_X(app.grid_point(r.destination, 300)) as destination_lng,
      oa.name as origin_area, da.name as destination_area,
      ST_AsGeoJSON(app.public_route(r.route), 5) as route_public,
      exists (
        select 1 from app.blocks bl
        where (bl.blocker_id = ${viewerId}::uuid and bl.blocked_id = r.driver_id)
           or (bl.blocker_id = r.driver_id and bl.blocked_id = ${viewerId}::uuid)
      ) as blocked
    from app.rides r
    join app.profiles p on p.id = r.driver_id
    left join app.areas oa on oa.id = r.origin_area_id
    left join app.areas da on da.id = r.destination_area_id
    where r.id = ${rideId}`;
  return rows[0];
}

// ---- auto-accept switch (E8-3) ----------------------------------------------------------------------

export async function setAutoAccept(
  sql: Db,
  rideId: string,
  value: boolean,
  now: Date,
): Promise<void> {
  await sql`update app.rides set auto_accept = ${value}, updated_at = ${now} where id = ${rideId}`;
}
