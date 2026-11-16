import type { Db } from '../../_shared/db.ts';
import type { BookingStatus, RideStatus } from '../../_shared/contracts/rides.ts';

/**
 * SQL for share-trip links (E5, ADR 0026). Only the SHA-256 of the token is stored. The hash goes in
 * as a hex string (`decode(…, 'hex')`), so no driver-specific bytea handling is involved.
 */

type Ts = Date | string;

/** Creates or rotates the booking's link: the old token stops working at once. */
export async function upsertShareLink(
  sql: Db,
  v: { bookingId: string; tokenHashHex: string; createdBy: string; expiresAt: Date; now: Date },
): Promise<void> {
  await sql`
    insert into app.share_links (booking_id, token_hash, created_by, expires_at, created_at)
    values (${v.bookingId}, decode(${v.tokenHashHex}::text, 'hex'), ${v.createdBy},
            ${v.expiresAt}::timestamptz, ${v.now}::timestamptz)
    on conflict (booking_id) do update
      set token_hash = excluded.token_hash, created_by = excluded.created_by,
          expires_at = excluded.expires_at, created_at = excluded.created_at`;
}

/** Revokes the booking's link. Idempotent. */
export async function deleteShareLink(sql: Db, bookingId: string): Promise<void> {
  await sql`delete from app.share_links where booking_id = ${bookingId}`;
}

export type SharedTripRow = {
  departure_at: Ts;
  duration_s: number;
  expires_at: Ts;
  status: BookingStatus;
  ride_status: RideStatus;
  driver_first_name: string | null;
  driver_photo_path: string | null;
  car_make: string | null;
  car_model: string | null;
  car_colour: string | null;
  car_plate: string | null;
  pickup_label: string;
  dropoff_label: string;
  pickup_fraction: number;
  /** The passenger's OWN segment of the route only. */
  segment_geojson: string | null;
};

/**
 * The one query behind the public page. A link is live only while it exists, has not expired, the
 * booking is confirmed or completed, the ride is not cancelled and both parties are active. It never
 * selects a phone, the passenger's name or the driver's full route.
 */
export async function selectSharedTrip(
  sql: Db,
  tokenHashHex: string,
  now: Date,
): Promise<SharedTripRow | undefined> {
  const rows = await sql<SharedTripRow[]>`
    select r.departure_at, r.duration_s, sl.expires_at, b.status, r.status as ride_status,
           dp.first_name as driver_first_name, dp.photo_path as driver_photo_path,
           r.vehicle_snapshot ->> 'make' as car_make,
           r.vehicle_snapshot ->> 'model' as car_model,
           r.vehicle_snapshot ->> 'colour' as car_colour,
           r.vehicle_snapshot ->> 'plate' as car_plate,
           b.pickup_label, b.dropoff_label, b.pickup_fraction,
           ST_AsGeoJSON(ST_Transform(
             ST_LineSubstring(r.route_utm, b.pickup_fraction, b.dropoff_fraction), 4326), 5) as segment_geojson
    from app.share_links sl
    join app.bookings b on b.id = sl.booking_id
    join app.rides r on r.id = b.ride_id
    join app.profiles dp on dp.id = r.driver_id
    join app.profiles pp on pp.id = b.passenger_id
    where sl.token_hash = decode(${tokenHashHex}::text, 'hex')
      and sl.expires_at > ${now}
      and b.status in ('confirmed', 'completed')
      and r.status <> 'cancelled'
      and dp.status = 'active' and pp.status = 'active'`;
  return rows[0];
}

/** Tick: links past their expiry. Returns the number deleted. */
export async function purgeShareLinks(sql: Db, now: Date): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    with d as (delete from app.share_links where expires_at < ${now} returning 1)
    select count(*)::int as n from d`;
  return rows[0]?.n ?? 0;
}
