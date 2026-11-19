import type { Db } from '../../_shared/db.ts';
import type { LatLng } from '../../_shared/contracts/geo.ts';
import type { BookingStatus, RideStatus } from '../../_shared/contracts/rides.ts';
import { MAX_WALK_M, MIN_SEGMENT_M } from '../../_shared/domain/rules.ts';

/**
 * SQL for bookings (E4, e4-bookings-spec §2, ADR 0021). postgres.js tagged templates only, columns
 * listed explicitly. Lock order is always: the ride row first (`for update of r`), then bookings
 * through guarded updates (`where id = $1 and status = <from>`). Parameters inside SELECT lists
 * carry explicit casts.
 *
 * Exact points, phones and the plate are selected here and decided on by the serializer through
 * revealFor() (ADR 0023): nothing else may ever copy them into a response.
 */

type Ts = Date | string;

// ---- ride lock ---------------------------------------------------------------------------------------

export type LockedRide = {
  id: string;
  driver_id: string;
  status: RideStatus;
  departure_at: Ts;
  duration_s: number;
  seats_offered: number;
  seats_booked: number;
  is_free: boolean;
  auto_accept: boolean;
  rate_micro_per_km: number;
  driver_status: 'active' | 'suspended' | 'deleted';
};

/** Locks the ride a passenger wants to book. Null when the ride does not exist. */
export async function lockRide(sql: Db, rideId: string): Promise<LockedRide | undefined> {
  const rows = await sql<LockedRide[]>`
    select r.id, r.driver_id, r.status, r.departure_at, r.duration_s, r.seats_offered,
           r.seats_booked, r.is_free, r.auto_accept, r.rate_micro_per_km, p.status as driver_status
    from app.rides r
    join app.profiles p on p.id = r.driver_id
    where r.id = ${rideId}
    for update of r`;
  return rows[0];
}

/**
 * Locks the ride of a booking for its driver (approve, reject): null when the booking is unknown or
 * the caller does not drive that ride (the caller answers 404).
 */
export async function lockRideOfBookingForDriver(
  sql: Db,
  bookingId: string,
  driverId: string,
): Promise<LockedRide | undefined> {
  const rows = await sql<LockedRide[]>`
    select r.id, r.driver_id, r.status, r.departure_at, r.duration_s, r.seats_offered,
           r.seats_booked, r.is_free, r.auto_accept, r.rate_micro_per_km, p.status as driver_status
    from app.rides r
    join app.bookings b on b.ride_id = r.id
    join app.profiles p on p.id = r.driver_id
    where b.id = ${bookingId} and r.driver_id = ${driverId}
    for update of r`;
  return rows[0];
}

/** Locks the ride of a booking for its passenger (cancel): null when it is not their booking. */
export async function lockRideOfBookingForPassenger(
  sql: Db,
  bookingId: string,
  passengerId: string,
): Promise<LockedRide | undefined> {
  const rows = await sql<LockedRide[]>`
    select r.id, r.driver_id, r.status, r.departure_at, r.duration_s, r.seats_offered,
           r.seats_booked, r.is_free, r.auto_accept, r.rate_micro_per_km, p.status as driver_status
    from app.rides r
    join app.bookings b on b.ride_id = r.id
    join app.profiles p on p.id = r.driver_id
    where b.id = ${bookingId} and b.passenger_id = ${passengerId}
    for update of r`;
  return rows[0];
}

/**
 * Locks the ride of a booking for either party (no-show, ratings, share link): null when the booking
 * is unknown or the caller is neither its passenger nor the ride's driver (the caller answers 404).
 */
export async function lockRideOfBookingForParty(
  sql: Db,
  bookingId: string,
  userId: string,
): Promise<LockedRide | undefined> {
  const rows = await sql<LockedRide[]>`
    select r.id, r.driver_id, r.status, r.departure_at, r.duration_s, r.seats_offered,
           r.seats_booked, r.is_free, r.auto_accept, r.rate_micro_per_km, p.status as driver_status
    from app.rides r
    join app.bookings b on b.ride_id = r.id
    join app.profiles p on p.id = r.driver_id
    where b.id = ${bookingId} and (r.driver_id = ${userId} or b.passenger_id = ${userId})
    for update of r`;
  return rows[0];
}

/** Locks the ride of a booking with no party check (system cancellations: blocks and the sweep). */
export async function lockRideOfBooking(
  sql: Db,
  bookingId: string,
): Promise<LockedRide | undefined> {
  const rows = await sql<LockedRide[]>`
    select r.id, r.driver_id, r.status, r.departure_at, r.duration_s, r.seats_offered,
           r.seats_booked, r.is_free, r.auto_accept, r.rate_micro_per_km, p.status as driver_status
    from app.rides r
    join app.bookings b on b.ride_id = r.id
    join app.profiles p on p.id = r.driver_id
    where b.id = ${bookingId}
    for update of r`;
  return rows[0];
}

// ---- request ----------------------------------------------------------------------------------------------

export async function findBookingByKey(
  sql: Db,
  passengerId: string,
  key: string,
): Promise<{ id: string; ride_id: string } | undefined> {
  const rows = await sql<{ id: string; ride_id: string }[]>`
    select id, ride_id from app.bookings
    where passenger_id = ${passengerId} and idempotency_key = ${key}`;
  return rows[0];
}

/** A block exists between the two users, in either direction. */
export async function hasBlockBetween(sql: Db, a: string, b: string): Promise<boolean> {
  const rows = await sql<{ blocked: boolean }[]>`
    select exists (
      select 1 from app.blocks bl
      where (bl.blocker_id = ${a}::uuid and bl.blocked_id = ${b}::uuid)
         or (bl.blocker_id = ${b}::uuid and bl.blocked_id = ${a}::uuid)) as blocked`;
  return rows[0]?.blocked === true;
}

/** `requested`, `confirmed` or `rejected`: the states that stop a new request (ADR 0021, spec §0). */
export async function hasActiveOrRejected(
  sql: Db,
  rideId: string,
  passengerId: string,
): Promise<boolean> {
  const rows = await sql<{ found: boolean }[]>`
    select exists (
      select 1 from app.bookings
      where ride_id = ${rideId} and passenger_id = ${passengerId}
        and status in ('requested', 'confirmed', 'rejected')) as found`;
  return rows[0]?.found === true;
}

export type BookingMatch = {
  f_pickup: number;
  f_dropoff: number;
  segment_m: number;
  walk_pickup_m: number;
  walk_dropoff_m: number;
};

/**
 * Re-runs app.match_rides for the one ride with the typed points. The function never returns exact
 * points, only the fractions along the route: the exact snapped points are derived on insert.
 */
export async function matchOneRide(
  sql: Db,
  a: { from: LatLng; to: LatLng; rideId: string; searcherId: string; now: Date },
): Promise<BookingMatch | undefined> {
  const rows = await sql<BookingMatch[]>`
    select m.f_pickup, m.f_dropoff, m.segment_m, m.walk_pickup_m, m.walk_dropoff_m
    from app.match_rides(
      ST_SetSRID(ST_MakePoint(${a.from.lng}::float8, ${a.from.lat}::float8), 4326),
      ST_SetSRID(ST_MakePoint(${a.to.lng}::float8, ${a.to.lat}::float8), 4326),
      ${a.now}::timestamptz, ${a.now}::timestamptz, ${a.now}::timestamptz,
      ${a.searcherId}::uuid, ${a.now}::timestamptz, ${a.rideId}::uuid,
      true, null::timestamptz, null::timestamptz,
      ${MAX_WALK_M}::integer, ${MIN_SEGMENT_M}::integer, 1::integer
    ) m`;
  return rows[0];
}

export type NewBooking = {
  rideId: string;
  passengerId: string;
  match: BookingMatch;
  priceQuotedBani: number;
  idempotencyKey: string;
  now: Date;
  expiresAt: Date;
};

export type InsertedBooking = {
  id: string;
  pickup_label: string;
  dropoff_label: string;
};

/**
 * Inserts the request with the EXACT snapped points on the route (`ST_LineInterpolatePoint` at the
 * matched fractions). Labels are area names. Walk distances are stored exact (the API rounds them).
 */
export async function insertBooking(sql: Db, v: NewBooking): Promise<InsertedBooking> {
  const rows = await sql<InsertedBooking[]>`
    with pts as (
      select ST_Transform(ST_LineInterpolatePoint(r.route_utm, ${v.match.f_pickup}::float8), 4326) as pp,
             ST_Transform(ST_LineInterpolatePoint(r.route_utm, ${v.match.f_dropoff}::float8), 4326) as dp
      from app.rides r where r.id = ${v.rideId}
    )
    insert into app.bookings
      (ride_id, passenger_id, pickup, dropoff, pickup_label, dropoff_label, pickup_area_id,
       dropoff_area_id, pickup_fraction, dropoff_fraction, segment_m, walk_pickup_m, walk_dropoff_m,
       price_quoted_bani, idempotency_key, requested_at, expires_at, created_at, updated_at)
    select ${v.rideId}::uuid, ${v.passengerId}::uuid, pts.pp, pts.dp,
           left(coalesce((select a.name from app.areas a where a.id = app.area_for(pts.pp)), 'Sibiu'), 80),
           left(coalesce((select a.name from app.areas a where a.id = app.area_for(pts.dp)), 'Sibiu'), 80),
           app.area_for(pts.pp), app.area_for(pts.dp),
           ${v.match.f_pickup}::float8, ${v.match.f_dropoff}::float8, ${v.match.segment_m}::integer,
           round(${v.match.walk_pickup_m}::float8)::integer, round(${v.match.walk_dropoff_m}::float8)::integer,
           ${v.priceQuotedBani}::integer, ${v.idempotencyKey}::text, ${v.now}::timestamptz,
           ${v.expiresAt}::timestamptz, ${v.now}::timestamptz, ${v.now}::timestamptz
    from pts
    returning id, pickup_label, dropoff_label`;
  const row = rows[0];
  if (!row) throw new Error('booking insert returned no row');
  return row;
}

// ---- state under the ride lock ------------------------------------------------------------------------------

export type BookingState = {
  id: string;
  ride_id: string;
  passenger_id: string;
  status: BookingStatus;
  pickup_label: string;
  dropoff_label: string;
  pickup_fraction: number;
  segment_m: number;
  price_quoted_bani: number;
  price_locked_bani: number | null;
  requested_at: Ts;
  expires_at: Ts;
  passenger_first_name: string | null;
};

/** The booking as it is now (read AFTER the ride lock, so a committed concurrent change is visible). */
export async function selectBookingState(
  sql: Db,
  bookingId: string,
): Promise<BookingState | undefined> {
  const rows = await sql<BookingState[]>`
    select b.id, b.ride_id, b.passenger_id, b.status, b.pickup_label, b.dropoff_label,
           b.pickup_fraction, b.segment_m, b.price_quoted_bani, b.price_locked_bani,
           b.requested_at, b.expires_at, p.first_name as passenger_first_name
    from app.bookings b
    join app.profiles p on p.id = b.passenger_id
    where b.id = ${bookingId}`;
  return rows[0];
}

/** requested -> confirmed. The lock starts at the quote and is relocked right after. 0 rows: lost a race. */
export async function confirmBooking(
  sql: Db,
  bookingId: string,
  now: Date,
  auto = false,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update app.bookings
    set status = 'confirmed', decided_at = ${now}, price_locked_bani = price_quoted_bani,
        auto_confirmed = ${auto}::boolean, passenger_event_at = ${now}, updated_at = ${now}
    where id = ${bookingId} and status = 'requested' and expires_at > ${now}
    returning id`;
  return rows.length === 1;
}

/** requested -> rejected. */
export async function rejectBooking(sql: Db, bookingId: string, now: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update app.bookings
    set status = 'rejected', decided_at = ${now}, passenger_event_at = ${now}, updated_at = ${now}
    where id = ${bookingId} and status = 'requested' and expires_at > ${now}
    returning id`;
  return rows.length === 1;
}

/** Passenger cancel from `from` (guarded by the status the service read under the lock). */
export async function cancelBookingByPassenger(
  sql: Db,
  bookingId: string,
  from: 'requested' | 'confirmed',
  late: boolean,
  now: Date,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update app.bookings
    set status = 'cancelled', cancelled_at = ${now}, cancelled_by = 'passenger',
        late_cancel = ${late}::boolean, updated_at = ${now}
    where id = ${bookingId} and status = ${from}::app.booking_status
    returning id`;
  return rows.length === 1;
}

/**
 * System cancel (block cascade, suspended passenger): requested or confirmed becomes cancelled by
 * `system`, never a late cancellation. `notify` bumps passenger_event_at (the passenger sees it).
 */
export async function cancelBookingBySystem(
  sql: Db,
  bookingId: string,
  from: 'requested' | 'confirmed',
  notify: boolean,
  now: Date,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update app.bookings
    set status = 'cancelled', cancelled_at = ${now}, cancelled_by = 'system', late_cancel = false,
        passenger_event_at = case when ${notify}::boolean then ${now}::timestamptz else passenger_event_at end,
        updated_at = ${now}
    where id = ${bookingId} and status = ${from}::app.booking_status
    returning id`;
  return rows.length === 1;
}

export async function adjustSeatsBooked(
  sql: Db,
  rideId: string,
  delta: 1 | -1,
  now: Date,
): Promise<void> {
  // A violation of rides_seats_booked_range (23514) is mapped to RIDE_FULL by the service.
  await sql`
    update app.rides set seats_booked = seats_booked + ${delta}::smallint, updated_at = ${now}
    where id = ${rideId}`;
}

export type ConfirmedRow = {
  id: string;
  segment_m: number;
  price_quoted_bani: number;
  price_locked_bani: number | null;
};

export async function selectConfirmed(sql: Db, rideId: string): Promise<ConfirmedRow[]> {
  return await sql<ConfirmedRow[]>`
    select id, segment_m, price_quoted_bani, price_locked_bani
    from app.bookings
    where ride_id = ${rideId} and status = 'confirmed'
    order by requested_at, id`;
}

/** Lowers a lock. `notify` bumps passenger_event_at (the passenger sees a price drop). */
export async function updateLock(
  sql: Db,
  bookingId: string,
  lockedBani: number,
  notify: boolean,
  now: Date,
): Promise<void> {
  await sql`
    update app.bookings
    set price_locked_bani = ${lockedBani}::integer,
        passenger_event_at = case when ${notify}::boolean then ${now}::timestamptz else passenger_event_at end,
        updated_at = ${now}
    where id = ${bookingId} and status = 'confirmed'`;
}

export async function insertLateCancelEventForBooking(
  sql: Db,
  userId: string,
  bookingId: string,
  rideId: string,
  at: Date,
): Promise<void> {
  await sql`
    insert into app.reliability_events (user_id, kind, booking_id, ride_id, occurred_at)
    values (${userId}, 'late_cancellation', ${bookingId}, ${rideId}, ${at})`;
}

export type CancelledByRide = {
  id: string;
  passenger_id: string;
  pickup_label: string;
  dropoff_label: string;
};

/**
 * Ride cancel cascade: every requested or confirmed booking becomes cancelled (by the driver) and
 * the ride's seat counter drops to 0 (the invariant seats_booked = count(confirmed) also holds for
 * a cancelled ride). Runs inside the ride cancel transaction, which already holds the ride lock.
 */
export async function cancelRideBookings(
  sql: Db,
  rideId: string,
  now: Date,
  by: 'driver' | 'system' = 'driver',
): Promise<CancelledByRide[]> {
  // Two literal statements, not a bound value: the cancelled_by text is part of the contract tests.
  const rows =
    by === 'driver'
      ? await sql<CancelledByRide[]>`
          update app.bookings
          set status = 'cancelled', cancelled_at = ${now}, cancelled_by = 'driver',
              passenger_event_at = ${now}, updated_at = ${now}
          where ride_id = ${rideId} and status in ('requested', 'confirmed')
          returning id, passenger_id, pickup_label, dropoff_label`
      : await sql<CancelledByRide[]>`
          update app.bookings
          set status = 'cancelled', cancelled_at = ${now}, cancelled_by = 'system',
              passenger_event_at = ${now}, updated_at = ${now}
          where ride_id = ${rideId} and status in ('requested', 'confirmed')
          returning id, passenger_id, pickup_label, dropoff_label`;
  await sql`update app.rides set seats_booked = 0, updated_at = ${now} where id = ${rideId}`;
  return rows;
}

// ---- expiry (tick) ---------------------------------------------------------------------------------------------------

export type ExpiredRow = {
  booking_id: string;
  ride_id: string;
  passenger_id: string;
  departure_at: Ts;
  driver_first_name: string | null;
};

export async function expireRequests(sql: Db, now: Date): Promise<ExpiredRow[]> {
  return await sql<ExpiredRow[]>`
    select booking_id, ride_id, passenger_id, departure_at, driver_first_name
    from app.expire_requests(${now}::timestamptz)`;
}

// ---- booking view row -----------------------------------------------------------------------------------------------

export type BookingViewRow = {
  id: string;
  ride_id: string;
  passenger_id: string;
  driver_id: string;
  status: BookingStatus;
  auto_confirmed: boolean;
  ride_status: RideStatus;
  departure_at: Ts;
  duration_s: number;
  pickup_label: string;
  dropoff_label: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  pickup_grid_lat: number;
  pickup_grid_lng: number;
  dropoff_grid_lat: number;
  dropoff_grid_lng: number;
  pickup_fraction: number;
  segment_m: number;
  walk_pickup_m: number;
  walk_dropoff_m: number;
  price_quoted_bani: number;
  price_locked_bani: number | null;
  final_price_bani: number | null;
  requested_at: Ts;
  expires_at: Ts;
  decided_at: Ts | null;
  cancelled_at: Ts | null;
  cancelled_by: 'passenger' | 'driver' | 'system' | null;
  /** The ride's completion time and the booking's no-show facts (E5). */
  completed_at: Ts | null;
  no_show_at: Ts | null;
  no_show_by: 'driver' | 'passenger' | null;
  /** The passenger's and the driver's own ratings of this booking (the serializer picks the viewer's). */
  rp_stars: number | null;
  rp_tags: string[] | null;
  rp_created_at: Ts | null;
  rd_stars: number | null;
  rd_tags: string[] | null;
  rd_created_at: Ts | null;
  /** When the live share link (if any) stops working. */
  share_expires_at: Ts | null;
  unseen: boolean;
  car_make: string | null;
  car_model: string | null;
  car_colour: string | null;
  car_plate: string | null;
  driver_phone: string | null;
  passenger_phone: string | null;
  /** The passenger's own exact segment of the route. */
  segment_geojson: string | null;
  route_public: string | null;
};

/** Everything the booking view needs in one round trip. */
export async function selectBookingView(
  sql: Db,
  bookingId: string,
): Promise<BookingViewRow | undefined> {
  const rows = await sql<BookingViewRow[]>`
    select b.id, b.ride_id, b.passenger_id, r.driver_id, b.status, b.auto_confirmed, r.status as ride_status,
      r.departure_at, r.duration_s, b.pickup_label, b.dropoff_label,
      round(ST_Y(b.pickup)::numeric, 5)::float8 as pickup_lat,
      round(ST_X(b.pickup)::numeric, 5)::float8 as pickup_lng,
      round(ST_Y(b.dropoff)::numeric, 5)::float8 as dropoff_lat,
      round(ST_X(b.dropoff)::numeric, 5)::float8 as dropoff_lng,
      ST_Y(app.grid_point(b.pickup, 300)) as pickup_grid_lat,
      ST_X(app.grid_point(b.pickup, 300)) as pickup_grid_lng,
      ST_Y(app.grid_point(b.dropoff, 300)) as dropoff_grid_lat,
      ST_X(app.grid_point(b.dropoff, 300)) as dropoff_grid_lng,
      b.pickup_fraction, b.segment_m, b.walk_pickup_m, b.walk_dropoff_m,
      b.price_quoted_bani, b.price_locked_bani, b.final_price_bani,
      b.requested_at, b.expires_at, b.decided_at, b.cancelled_at, b.cancelled_by,
      r.completed_at, b.no_show_at, b.no_show_by,
      rp.stars as rp_stars, rp.tags as rp_tags, rp.created_at as rp_created_at,
      rd.stars as rd_stars, rd.tags as rd_tags, rd.created_at as rd_created_at,
      sl.expires_at as share_expires_at,
      (b.passenger_event_at is not null
        and b.passenger_event_at > coalesce(b.seen_by_passenger_at, '-infinity'::timestamptz)) as unseen,
      r.vehicle_snapshot ->> 'make' as car_make,
      r.vehicle_snapshot ->> 'model' as car_model,
      r.vehicle_snapshot ->> 'colour' as car_colour,
      r.vehicle_snapshot ->> 'plate' as car_plate,
      dp.phone_e164 as driver_phone,
      pp.phone_e164 as passenger_phone,
      ST_AsGeoJSON(ST_Transform(
        ST_LineSubstring(r.route_utm, b.pickup_fraction, b.dropoff_fraction), 4326), 5) as segment_geojson,
      ST_AsGeoJSON(app.public_route(r.route), 5) as route_public
    from app.bookings b
    join app.rides r on r.id = b.ride_id
    join app.profiles dp on dp.id = r.driver_id
    join app.profiles pp on pp.id = b.passenger_id
    left join app.ratings rp on rp.booking_id = b.id and rp.rater_id = b.passenger_id
    left join app.ratings rd on rd.booking_id = b.id and rd.rater_id = r.driver_id
    left join app.share_links sl on sl.booking_id = b.id
    where b.id = ${bookingId}`;
  return rows[0];
}

// ---- lists -------------------------------------------------------------------------------------------------------------

export type BookingListRow = {
  id: string;
  ride_id: string;
  status: BookingStatus;
  ride_status: RideStatus;
  departure_at: Ts;
  duration_s: number;
  pickup_fraction: number;
  pickup_label: string;
  dropoff_label: string;
  driver_id: string;
  price_quoted_bani: number;
  price_locked_bani: number | null;
  final_price_bani: number | null;
  unseen: boolean;
  cancelled_by: 'passenger' | 'driver' | 'system' | null;
  /** The ride's completion time, and whether the passenger already rated (E5). */
  completed_at: Ts | null;
  rated: boolean;
};

type After = { departureAt: Date; id: string } | null;

/** Requested or confirmed, departing after now, ascending. Keyset on (departure_at, id). */
export async function listUpcomingBookings(
  sql: Db,
  passengerId: string,
  now: Date,
  after: After,
  limit: number,
): Promise<BookingListRow[]> {
  const hasCursor = after !== null;
  const cursorAt = after?.departureAt ?? now;
  const cursorId = after?.id ?? '00000000-0000-0000-0000-000000000000';
  return await sql<BookingListRow[]>`
    select b.id, b.ride_id, b.status, r.status as ride_status, r.departure_at, r.duration_s,
           b.pickup_fraction, b.pickup_label, b.dropoff_label, r.driver_id, b.price_quoted_bani,
           b.price_locked_bani, b.final_price_bani, b.cancelled_by, r.completed_at,
           exists (select 1 from app.ratings x where x.booking_id = b.id and x.rater_id = b.passenger_id) as rated,
           (b.passenger_event_at is not null
             and b.passenger_event_at > coalesce(b.seen_by_passenger_at, '-infinity'::timestamptz)) as unseen
    from app.bookings b
    join app.rides r on r.id = b.ride_id
    where b.passenger_id = ${passengerId} and b.status in ('requested', 'confirmed')
      and r.departure_at > ${now}
      and (not ${hasCursor}::boolean or (r.departure_at, b.id) > (${cursorAt}::timestamptz, ${cursorId}::uuid))
    order by r.departure_at asc, b.id asc
    limit ${limit}`;
}

/** Everything else (finished, cancelled, expired, rejected, departed), newest first. */
export async function listPastBookings(
  sql: Db,
  passengerId: string,
  now: Date,
  after: After,
  limit: number,
): Promise<BookingListRow[]> {
  const hasCursor = after !== null;
  const cursorAt = after?.departureAt ?? now;
  const cursorId = after?.id ?? 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  return await sql<BookingListRow[]>`
    select b.id, b.ride_id, b.status, r.status as ride_status, r.departure_at, r.duration_s,
           b.pickup_fraction, b.pickup_label, b.dropoff_label, r.driver_id, b.price_quoted_bani,
           b.price_locked_bani, b.final_price_bani, b.cancelled_by, r.completed_at,
           exists (select 1 from app.ratings x where x.booking_id = b.id and x.rater_id = b.passenger_id) as rated,
           (b.passenger_event_at is not null
             and b.passenger_event_at > coalesce(b.seen_by_passenger_at, '-infinity'::timestamptz)) as unseen
    from app.bookings b
    join app.rides r on r.id = b.ride_id
    where b.passenger_id = ${passengerId}
      and not (b.status in ('requested', 'confirmed') and r.departure_at > ${now})
      and (not ${hasCursor}::boolean or (r.departure_at, b.id) < (${cursorAt}::timestamptz, ${cursorId}::uuid))
    order by r.departure_at desc, b.id desc
    limit ${limit}`;
}

// ---- driver view of a ride: requests and passengers ------------------------------------------------------------------------

export type RequestRow = {
  id: string;
  passenger_id: string;
  pickup_label: string;
  dropoff_label: string;
  segment_m: number;
  requested_at: Ts;
  expires_at: Ts;
};

/** Open requests (not past their expiry), soonest deadline first. Never a point. */
export async function selectOpenRequests(
  sql: Db,
  rideId: string,
  now: Date,
): Promise<RequestRow[]> {
  return await sql<RequestRow[]>`
    select b.id, b.passenger_id, b.pickup_label, b.dropoff_label, b.segment_m, b.requested_at, b.expires_at
    from app.bookings b
    where b.ride_id = ${rideId} and b.status = 'requested' and b.expires_at > ${now}
    order by b.expires_at asc, b.id asc`;
}

export type PassengerRow = {
  id: string;
  status: BookingStatus;
  passenger_id: string;
  pickup_label: string;
  dropoff_label: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  pickup_grid_lat: number;
  pickup_grid_lng: number;
  dropoff_grid_lat: number;
  dropoff_grid_lng: number;
  price_locked_bani: number | null;
  final_price_bani: number | null;
  phone_e164: string | null;
  no_show_by: 'driver' | 'passenger' | null;
  /** The driver's own rating of this passenger, when there is one. */
  rating_stars: number | null;
  rating_tags: string[] | null;
  rating_created_at: Ts | null;
  /** Either party has rated this booking. */
  any_rated: boolean;
};

/** Confirmed, completed and no_show passengers of a ride. */
export async function selectRidePassengers(sql: Db, rideId: string): Promise<PassengerRow[]> {
  return await sql<PassengerRow[]>`
    select b.id, b.status, b.passenger_id, b.pickup_label, b.dropoff_label,
      round(ST_Y(b.pickup)::numeric, 5)::float8 as pickup_lat,
      round(ST_X(b.pickup)::numeric, 5)::float8 as pickup_lng,
      round(ST_Y(b.dropoff)::numeric, 5)::float8 as dropoff_lat,
      round(ST_X(b.dropoff)::numeric, 5)::float8 as dropoff_lng,
      ST_Y(app.grid_point(b.pickup, 300)) as pickup_grid_lat,
      ST_X(app.grid_point(b.pickup, 300)) as pickup_grid_lng,
      ST_Y(app.grid_point(b.dropoff, 300)) as dropoff_grid_lat,
      ST_X(app.grid_point(b.dropoff, 300)) as dropoff_grid_lng,
      b.price_locked_bani, b.final_price_bani, p.phone_e164, b.no_show_by,
      dr.stars as rating_stars, dr.tags as rating_tags, dr.created_at as rating_created_at,
      exists (select 1 from app.ratings ax where ax.booking_id = b.id) as any_rated
    from app.bookings b
    join app.rides r on r.id = b.ride_id
    join app.profiles p on p.id = b.passenger_id
    left join app.ratings dr on dr.booking_id = b.id and dr.rater_id = r.driver_id
    where b.ride_id = ${rideId} and b.status in ('confirmed', 'completed', 'no_show')
    order by b.requested_at asc, b.id asc`;
}

// ---- the viewer's own booking on a ride (GET /rides/{id}) --------------------------------------------------------------------

export async function selectViewerBooking(
  sql: Db,
  rideId: string,
  passengerId: string,
): Promise<{ id: string; status: BookingStatus } | undefined> {
  const rows = await sql<{ id: string; status: BookingStatus }[]>`
    select id, status from app.bookings
    where ride_id = ${rideId} and passenger_id = ${passengerId}
    order by requested_at desc, id desc
    limit 1`;
  return rows[0];
}

// ---- summary -----------------------------------------------------------------------------------------------------------------------

export type SummaryRow = {
  driver_pending: number;
  passenger_unseen: number;
};

export async function selectSummaryCounts(sql: Db, userId: string, now: Date): Promise<SummaryRow> {
  const rows = await sql<SummaryRow[]>`
    select
      (select count(*)::int from app.bookings b join app.rides r on r.id = b.ride_id
        where r.driver_id = ${userId} and b.status = 'requested' and b.expires_at > ${now}) as driver_pending,
      (select count(*)::int from app.bookings b
        where b.passenger_id = ${userId} and b.passenger_event_at is not null
          and b.passenger_event_at > coalesce(b.seen_by_passenger_at, '-infinity'::timestamptz)) as passenger_unseen`;
  return rows[0] ?? { driver_pending: 0, passenger_unseen: 0 };
}

export type NextRideRow = { kind: 'booking' | 'ride'; id: string; departure_at: Ts };

/** The soonest upcoming confirmed booking (as passenger) or published ride (as driver). */
export async function selectNextRide(
  sql: Db,
  userId: string,
  now: Date,
): Promise<NextRideRow | undefined> {
  const rows = await sql<NextRideRow[]>`
    select kind, id, departure_at from (
      select 'booking'::text as kind, b.id, r.departure_at
      from app.bookings b join app.rides r on r.id = b.ride_id
      where b.passenger_id = ${userId} and b.status = 'confirmed' and r.status = 'published'
        and r.departure_at > ${now}
      union all
      select 'ride'::text, r.id, r.departure_at
      from app.rides r
      where r.driver_id = ${userId} and r.status = 'published' and r.departure_at > ${now}
    ) u
    order by departure_at asc, id asc
    limit 1`;
  return rows[0];
}

/** Marks the caller's own bookings as seen. Other people's ids simply match no row. */
export async function markSeen(
  sql: Db,
  passengerId: string,
  bookingIds: readonly string[],
  now: Date,
): Promise<void> {
  await sql`
    update app.bookings set seen_by_passenger_at = ${now}
    where passenger_id = ${passengerId}
      and id in ${sql([...bookingIds])}`;
}
