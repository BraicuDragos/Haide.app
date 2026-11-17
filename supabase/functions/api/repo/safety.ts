import type { Db } from '../../_shared/db.ts';
import type { BookingStatus } from '../../_shared/contracts/rides.ts';

/**
 * SQL for no-shows, reports and blocks (E5, e5-trust-safety-spec §2 and §4). postgres.js tagged
 * templates only, columns listed explicitly. Lock order is the E4 one: the ride row first (through
 * lockRideOfBookingForParty), then the booking row, then guarded updates.
 */

type Ts = Date | string;

// ---- no-show --------------------------------------------------------------------------------------

export type NoShowContext = {
  id: string;
  status: BookingStatus;
  passenger_id: string;
  ride_id: string;
  driver_id: string;
  departure_at: Ts;
  /** Either party has rated this booking: a rated ride can no longer become a no-show. */
  rated: boolean;
  passenger_first_name: string | null;
  driver_first_name: string | null;
};

/**
 * The booking with its ride and both first names, locked (`for update of b`) so a rating written in
 * parallel waits for us and then sees the new status (spec §2, S3). Call AFTER the ride lock.
 */
export async function selectNoShowContext(
  sql: Db,
  bookingId: string,
): Promise<NoShowContext | undefined> {
  const rows = await sql<NoShowContext[]>`
    select b.id, b.status, b.passenger_id, r.id as ride_id, r.driver_id, r.departure_at,
           exists (select 1 from app.ratings x where x.booking_id = b.id) as rated,
           pp.first_name as passenger_first_name, dp.first_name as driver_first_name
    from app.bookings b
    join app.rides r on r.id = b.ride_id
    join app.profiles pp on pp.id = b.passenger_id
    join app.profiles dp on dp.id = r.driver_id
    where b.id = ${bookingId}
    for update of b`;
  return rows[0];
}

/** confirmed or completed -> no_show. 0 rows: another writer changed the booking first. */
export async function markNoShow(
  sql: Db,
  bookingId: string,
  by: 'driver' | 'passenger',
  now: Date,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update app.bookings
    set status = 'no_show', no_show_at = ${now}, no_show_by = ${by}::text,
        final_price_bani = null, updated_at = ${now},
        passenger_event_at = case when ${by}::text = 'driver' then ${now}::timestamptz else passenger_event_at end
    where id = ${bookingId} and status in ('confirmed', 'completed')
    returning id`;
  return rows.length === 1;
}

/** One reliability event for the party who did not show. */
export async function insertNoShowEvent(
  sql: Db,
  userId: string,
  bookingId: string,
  rideId: string,
  at: Date,
): Promise<void> {
  await sql`
    insert into app.reliability_events (user_id, kind, booking_id, ride_id, occurred_at)
    values (${userId}, 'no_show', ${bookingId}, ${rideId}, ${at})`;
}

export async function selectFirstName(sql: Db, userId: string): Promise<string | null> {
  const rows = await sql<{ first_name: string | null }[]>`
    select first_name from app.profiles where id = ${userId}`;
  return rows[0]?.first_name ?? null;
}

// ---- reports ------------------------------------------------------------------------------------------

export async function profileExists(sql: Db, userId: string): Promise<boolean> {
  const rows = await sql<{ found: boolean }[]>`
    select exists (select 1 from app.profiles where id = ${userId}) as found`;
  return rows[0]?.found === true;
}

/** The two parties of a booking and its ride, or undefined when the booking is unknown. */
export async function selectBookingParties(
  sql: Db,
  bookingId: string,
): Promise<{ passenger_id: string; driver_id: string; ride_id: string } | undefined> {
  const rows = await sql<{ passenger_id: string; driver_id: string; ride_id: string }[]>`
    select b.passenger_id, r.driver_id, r.id as ride_id
    from app.bookings b join app.rides r on r.id = b.ride_id
    where b.id = ${bookingId}`;
  return rows[0];
}

/** The user drives the ride or holds a booking on it (any status). */
export async function isRideParty(sql: Db, rideId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ party: boolean }[]>`
    select (exists (select 1 from app.rides r where r.id = ${rideId} and r.driver_id = ${userId})
         or exists (select 1 from app.bookings b where b.ride_id = ${rideId} and b.passenger_id = ${userId})) as party`;
  return rows[0]?.party === true;
}

export type NewReport = {
  reporterId: string;
  reportedId: string;
  rideId: string | null;
  bookingId: string | null;
  reason: string;
  details: string | null;
  now: Date;
};

/** Inserts the report with the reported user's {firstName, phoneE164} copied in (read in SQL). */
export async function insertReport(sql: Db, v: NewReport): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into app.reports
      (reporter_id, reported_id, ride_id, booking_id, reason, details, reported_snapshot, created_at)
    select ${v.reporterId}::uuid, p.id, ${v.rideId}::uuid, ${v.bookingId}::uuid,
           ${v.reason}::app.report_reason, ${v.details}::text,
           jsonb_build_object('firstName', p.first_name, 'phoneE164', p.phone_e164),
           ${v.now}::timestamptz
    from app.profiles p
    where p.id = ${v.reportedId}
    returning id`;
  const row = rows[0];
  if (!row) throw new Error('report insert returned no row');
  return row.id;
}

export async function selectActiveAdminIds(sql: Db): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select id from app.profiles where role = 'admin' and status = 'active' order by id`;
  return rows.map((r) => r.id);
}

// ---- blocks ---------------------------------------------------------------------------------------------

/** Idempotent: a second block of the same user changes nothing. */
export async function insertBlock(
  sql: Db,
  blockerId: string,
  blockedId: string,
  now: Date,
): Promise<void> {
  await sql`
    insert into app.blocks (blocker_id, blocked_id, created_at)
    values (${blockerId}, ${blockedId}, ${now})
    on conflict (blocker_id, blocked_id) do nothing`;
}

/** Deletes the caller's own block. Idempotent. */
export async function deleteBlock(sql: Db, blockerId: string, blockedId: string): Promise<void> {
  await sql`delete from app.blocks where blocker_id = ${blockerId} and blocked_id = ${blockedId}`;
}

export type BlockRow = { blocked_id: string; created_at: Ts };

/** The caller's outgoing blocks, newest first. Nobody learns who blocked them. */
export async function listBlocks(sql: Db, blockerId: string, limit: number): Promise<BlockRow[]> {
  return await sql<BlockRow[]>`
    select blocked_id, created_at from app.blocks
    where blocker_id = ${blockerId}
    order by created_at desc, blocked_id asc
    limit ${limit}`;
}

export type PairBooking = { id: string; ride_id: string; passenger_id: string };

/** Active bookings between two users (either direction) on rides that have not departed. */
export async function selectPairBookings(
  sql: Db,
  a: string,
  b: string,
  now: Date,
): Promise<PairBooking[]> {
  return await sql<PairBooking[]>`
    select bk.id, bk.ride_id, bk.passenger_id
    from app.bookings bk join app.rides r on r.id = bk.ride_id
    where bk.status in ('requested', 'confirmed') and r.departure_at > ${now}
      and ((bk.passenger_id = ${a}::uuid and r.driver_id = ${b}::uuid)
        or (bk.passenger_id = ${b}::uuid and r.driver_id = ${a}::uuid))
    order by bk.ride_id, bk.id`;
}
