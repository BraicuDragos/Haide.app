import type { Db } from '../../_shared/db.ts';

/**
 * SQL for privacy and compliance (E6, e6-privacy-spec §1, §2, §5, ADRs 0029 to 0031): the account
 * deletion transaction, the purge queue, coarsening and data requests. postgres.js tagged templates
 * only, columns listed explicitly. Lock order for deletion: the profile row first, then rides (through
 * lockRide), then bookings by guarded updates.
 */

type Ts = Date | string;

// ---- DELETE /me ------------------------------------------------------------------------------------------

export type LockedProfile = {
  id: string;
  first_name: string | null;
  status: 'active' | 'suspended' | 'deleted';
};

/**
 * Locks the caller's profile row: the second of two parallel deletes waits here and then sees `deleted`.
 * `for no key update`, not `for update`: a booking or ride transaction holding a ride lock inserts an outbox
 * row whose foreign key takes `for key share` on this profile, and `for update` would deadlock with it
 * (the deletion waits for the ride lock, the writer for the profile). The scrub only changes non-key columns.
 */
export async function lockProfile(sql: Db, userId: string): Promise<LockedProfile | undefined> {
  const rows = await sql<LockedProfile[]>`
    select id, first_name, status from app.profiles where id = ${userId} for no key update`;
  return rows[0];
}

/** Published rides of a driver that have not departed (candidates: the service re-checks under the ride lock). */
export async function selectFutureDriverRides(
  sql: Db,
  userId: string,
  now: Date,
): Promise<{ id: string }[]> {
  return await sql<{ id: string }[]>`
    select id from app.rides
    where driver_id = ${userId} and status = 'published' and departure_at > ${now}
    order by departure_at, id`;
}

/** Active bookings of a passenger on rides that have not departed. */
export async function selectActivePassengerBookings(
  sql: Db,
  userId: string,
  now: Date,
): Promise<{ id: string }[]> {
  return await sql<{ id: string }[]>`
    select b.id from app.bookings b
    join app.rides r on r.id = b.ride_id
    where b.passenger_id = ${userId} and b.status in ('requested', 'confirmed') and r.departure_at > ${now}
    order by r.departure_at, b.id`;
}

/** app.scrub_account: tombstone, vehicle, coarsening and the rest of the personal data (one call, same transaction). */
export async function scrubAccount(sql: Db, userId: string, now: Date): Promise<void> {
  await sql`select app.scrub_account(${userId}::uuid, ${now}::timestamptz)`;
}

// ---- purge queue (app.account_deletions) --------------------------------------------------------------------

export type DeletionRow = {
  user_id: string;
  requested_at: Ts;
  photo_path: string | null;
  storage_done_at: Ts | null;
  auth_done_at: Ts | null;
  attempts: number;
};

export async function selectDeletion(sql: Db, userId: string): Promise<DeletionRow | undefined> {
  const rows = await sql<DeletionRow[]>`
    select user_id, requested_at, photo_path, storage_done_at, auth_done_at, attempts
    from app.account_deletions
    where user_id = ${userId} and completed_at is null`;
  return rows[0];
}

/** Open deletions whose next attempt is due, oldest due first. */
export async function selectDueDeletions(
  sql: Db,
  now: Date,
  limit: number,
): Promise<{ user_id: string }[]> {
  return await sql<{ user_id: string }[]>`
    select user_id from app.account_deletions
    where completed_at is null and next_attempt_at <= ${now}
    order by next_attempt_at
    limit ${limit}`;
}

/** The avatar object is gone. The path is cleared so no pointer to the photo stays in the database. */
export async function markStorageDone(sql: Db, userId: string, now: Date): Promise<void> {
  await sql`
    update app.account_deletions set storage_done_at = ${now}, photo_path = null
    where user_id = ${userId} and storage_done_at is null`;
}

export async function markAuthDone(sql: Db, userId: string, now: Date): Promise<void> {
  await sql`
    update app.account_deletions set auth_done_at = ${now}
    where user_id = ${userId} and auth_done_at is null`;
}

/** Both sides are done: closes the row. Returns false when something is still open. */
export async function completeDeletion(sql: Db, userId: string, now: Date): Promise<boolean> {
  const rows = await sql<{ user_id: string }[]>`
    update app.account_deletions set completed_at = ${now}, last_error = null
    where user_id = ${userId} and completed_at is null
      and storage_done_at is not null and auth_done_at is not null
    returning user_id`;
  return rows.length === 1;
}

/** One failed run: attempts + 1, the scrubbed error and the next attempt time. */
export async function recordPurgeFailure(
  sql: Db,
  userId: string,
  nextAttemptAt: Date,
  error: string,
): Promise<void> {
  await sql`
    update app.account_deletions
    set attempts = least(attempts + 1, 32000), next_attempt_at = ${nextAttemptAt}, last_error = ${error}
    where user_id = ${userId} and completed_at is null`;
}

/** Open deletions requested before `olderThan` (the 7-day alarm). Ids only. */
export async function selectOverdueDeletions(
  sql: Db,
  olderThan: Date,
  limit: number,
): Promise<{ user_id: string }[]> {
  return await sql<{ user_id: string }[]>`
    select user_id from app.account_deletions
    where completed_at is null and requested_at < ${olderThan}
    order by requested_at
    limit ${limit}`;
}

// ---- retention (tick) ---------------------------------------------------------------------------------------------

/** app.coarsen_locations: rides and bookings past 90 days, at most `limit` of each. */
export async function coarsenLocations(
  sql: Db,
  now: Date,
  limit: number,
): Promise<{ rides: number; bookings: number }> {
  const rows = await sql<{ rides: number; bookings: number }[]>`
    select rides, bookings from app.coarsen_locations(${now}::timestamptz, ${limit}::integer)`;
  return { rides: Number(rows[0]?.rides ?? 0), bookings: Number(rows[0]?.bookings ?? 0) };
}

/** app.run_retention: SECURITY DEFINER, no clock argument. Returns the rows deleted per table. */
export async function runRetention(sql: Db): Promise<Record<string, number>> {
  const rows = await sql<{ counts: unknown }[]>`select app.run_retention() as counts`;
  const raw = rows[0]?.counts;
  const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  const out: Record<string, number> = {};
  if (parsed && typeof parsed === 'object') {
    for (const [k, v] of Object.entries(parsed)) out[k] = Number(v) || 0;
  }
  return out;
}

// ---- data requests ------------------------------------------------------------------------------------------------

export type DataRequestRow = { id: string; requested_at: Ts; fulfilled_at: Ts | null };

/** The newest unfulfilled request of the user made at or after `since`. */
export async function findOpenDataRequest(
  sql: Db,
  userId: string,
  since: Date,
): Promise<DataRequestRow | undefined> {
  const rows = await sql<DataRequestRow[]>`
    select id, requested_at, fulfilled_at from app.data_requests
    where user_id = ${userId} and kind = 'export' and fulfilled_at is null and requested_at > ${since}
    order by requested_at desc
    limit 1`;
  return rows[0];
}

export async function insertDataRequest(
  sql: Db,
  userId: string,
  now: Date,
): Promise<DataRequestRow> {
  const rows = await sql<DataRequestRow[]>`
    insert into app.data_requests (user_id, kind, requested_at)
    values (${userId}, 'export', ${now})
    returning id, requested_at, fulfilled_at`;
  const row = rows[0];
  if (!row) throw new Error('data request insert returned no row');
  return row;
}
