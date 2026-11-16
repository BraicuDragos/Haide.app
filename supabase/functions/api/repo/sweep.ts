import type { Db } from '../../_shared/db.ts';
import type { RideStatus } from '../../_shared/contracts/rides.ts';

/**
 * SQL for the tick's completion step and safety sweep (E5, ADR 0024 and 0027). Every candidate query
 * has a LIMIT; the service re-checks each one under the ride lock before it changes anything.
 */

type Ts = Date | string;

export type CompletedRide = {
  ride_id: string;
  driver_id: string;
  driver_first_name: string | null;
  departure_at: Ts;
  outcome: RideStatus;
  booking_ids: string[];
  passenger_ids: string[];
};

/** uuid[] arrives as a JS array, or as the text `{a,b}` when the driver does not know the type. */
function toIdArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    const inner = v.replace(/^\{|\}$/g, '');
    return inner === '' ? [] : inner.split(',');
  }
  return [];
}

/**
 * app.complete_rides: finishes published rides that departed before `cutoff`. Idempotent: the
 * second call returns nothing. Rides locked by a concurrent writer are skipped until the next tick.
 */
export async function completeRides(
  sql: Db,
  now: Date,
  cutoff: Date,
  limit: number,
): Promise<CompletedRide[]> {
  const rows = await sql<CompletedRide[]>`
    select ride_id, driver_id, driver_first_name, departure_at, outcome, booking_ids, passenger_ids
    from app.complete_rides(${now}::timestamptz, ${cutoff}::timestamptz, ${limit}::integer)`;
  return rows.map((r) => ({
    ...r,
    booking_ids: toIdArray(r.booking_ids),
    passenger_ids: toIdArray(r.passenger_ids),
  }));
}

/** Published rides that have not departed, driven by a suspended user. */
export async function selectSuspendedDriverRides(
  sql: Db,
  now: Date,
  limit: number,
): Promise<{ id: string }[]> {
  return await sql<{ id: string }[]>`
    select r.id from app.rides r join app.profiles p on p.id = r.driver_id
    where r.status = 'published' and r.departure_at > ${now} and p.status = 'suspended'
    order by r.departure_at, r.id
    limit ${limit}`;
}

/** Active bookings of a suspended passenger on rides that have not departed. */
export async function selectSuspendedPassengerBookings(
  sql: Db,
  now: Date,
  limit: number,
): Promise<{ id: string }[]> {
  return await sql<{ id: string }[]>`
    select b.id from app.bookings b
    join app.rides r on r.id = b.ride_id
    join app.profiles p on p.id = b.passenger_id
    where b.status in ('requested', 'confirmed') and r.departure_at > ${now} and p.status = 'suspended'
    order by r.departure_at, b.id
    limit ${limit}`;
}

export type BlockedPairBooking = {
  id: string;
  reason: 'blocked_by_passenger' | 'blocked_by_driver';
};

/** Active bookings between a blocked pair (either direction) on rides that have not departed. */
export async function selectBlockedPairBookings(
  sql: Db,
  now: Date,
  limit: number,
): Promise<BlockedPairBooking[]> {
  return await sql<BlockedPairBooking[]>`
    select b.id,
           case when exists (select 1 from app.blocks x
                              where x.blocker_id = b.passenger_id and x.blocked_id = r.driver_id)
                then 'blocked_by_passenger' else 'blocked_by_driver' end as reason
    from app.bookings b
    join app.rides r on r.id = b.ride_id
    where b.status in ('requested', 'confirmed') and r.departure_at > ${now}
      and exists (select 1 from app.blocks x
                   where (x.blocker_id = b.passenger_id and x.blocked_id = r.driver_id)
                      or (x.blocker_id = r.driver_id and x.blocked_id = b.passenger_id))
    order by r.departure_at, b.id
    limit ${limit}`;
}
