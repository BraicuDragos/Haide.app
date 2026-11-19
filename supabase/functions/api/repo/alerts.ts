import type { Db } from '../../_shared/db.ts';
import type { RideAlert } from '../../_shared/contracts/liquidity.ts';
import type { Weekday } from '../../_shared/contracts/rides.ts';
import type { AlertHit, ValidAlert } from '../../_shared/domain/alerts.ts';

/**
 * SQL for ride alerts (E8-2, ADR 0036). Local dates and times come out as strings (`to_char`).
 * Weekday sets go in as a Postgres array literal text (`{1,3}`) cast to smallint[].
 */

type AlertRow = {
  id: string;
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
  origin_label: string;
  destination_label: string;
  alert_date: string | null;
  weekdays: number[] | null;
  local_time: string;
  window_min: number;
  created_at: Date | string;
  expires_at: Date | string;
  last_notified_at: Date | string | null;
  matches_sent: number;
};

const iso = (d: Date | string): string => new Date(d).toISOString();

export function toRideAlert(r: AlertRow): RideAlert {
  return {
    id: r.id,
    from: { lat: r.from_lat, lng: r.from_lng },
    to: { lat: r.to_lat, lng: r.to_lng },
    fromLabel: r.origin_label,
    toLabel: r.destination_label,
    schedule:
      r.alert_date !== null
        ? { kind: 'date', date: r.alert_date }
        : { kind: 'weekly', weekdays: (r.weekdays ?? []).map(Number) as Weekday[] },
    time: r.local_time,
    windowMin: r.window_min as 15 | 30 | 60,
    createdAt: iso(r.created_at),
    expiresAt: iso(r.expires_at),
    lastNotifiedAt: r.last_notified_at ? iso(r.last_notified_at) : null,
    matchesSent: Number(r.matches_sent),
  };
}

/** Locks the caller's profile row (`for no key update`, the E6 lock lesson): alert creations serialise. */
export async function lockProfileForAlerts(sql: Db, userId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    select id from app.profiles where id = ${userId} for no key update`;
  return rows.length === 1;
}

const weekdaysLiteral = (w: readonly number[] | null): string | null =>
  w === null ? null : `{${w.join(',')}}`;

/** The same active alert (points, schedule, time, window), or undefined. */
export async function findIdenticalAlert(
  sql: Db,
  userId: string,
  a: ValidAlert,
  now: Date,
): Promise<RideAlert | undefined> {
  const date = a.schedule.kind === 'date' ? a.schedule.date : null;
  const weekdays = a.schedule.kind === 'weekly' ? weekdaysLiteral(a.schedule.weekdays) : null;
  const rows = await sql<AlertRow[]>`
    select a.id,
      round(ST_Y(a.origin)::numeric, 5)::float8 as from_lat, round(ST_X(a.origin)::numeric, 5)::float8 as from_lng,
      round(ST_Y(a.destination)::numeric, 5)::float8 as to_lat, round(ST_X(a.destination)::numeric, 5)::float8 as to_lng,
      a.origin_label, a.destination_label, to_char(a.alert_date, 'YYYY-MM-DD') as alert_date,
      a.weekdays::int[] as weekdays, to_char(a.local_time, 'HH24:MI') as local_time, a.window_min,
      a.created_at, a.expires_at, a.last_notified_at, a.matches_sent
    from app.ride_alerts a
    where a.user_id = ${userId}::uuid and a.expires_at > ${now}
      and ST_Equals(a.origin, ST_SetSRID(ST_MakePoint(${a.from.lng}::float8, ${a.from.lat}::float8), 4326))
      and ST_Equals(a.destination, ST_SetSRID(ST_MakePoint(${a.to.lng}::float8, ${a.to.lat}::float8), 4326))
      and a.alert_date is not distinct from ${date}::date
      and a.weekdays is not distinct from ${weekdays}::smallint[]
      and a.local_time = ${a.time}::time and a.window_min = ${a.windowMin}::smallint
    limit 1`;
  return rows[0] ? toRideAlert(rows[0]) : undefined;
}

export async function countActiveAlerts(sql: Db, userId: string, now: Date): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from app.ride_alerts where user_id = ${userId}::uuid and expires_at > ${now}`;
  return rows[0]?.n ?? 0;
}

export async function insertAlert(
  sql: Db,
  userId: string,
  a: ValidAlert,
  now: Date,
): Promise<RideAlert> {
  const date = a.schedule.kind === 'date' ? a.schedule.date : null;
  const weekdays = a.schedule.kind === 'weekly' ? weekdaysLiteral(a.schedule.weekdays) : null;
  const rows = await sql<AlertRow[]>`
    insert into app.ride_alerts
      (user_id, origin, destination, origin_label, destination_label, alert_date, weekdays,
       local_time, window_min, created_at, expires_at)
    values (${userId}::uuid,
      ST_SetSRID(ST_MakePoint(${a.from.lng}::float8, ${a.from.lat}::float8), 4326),
      ST_SetSRID(ST_MakePoint(${a.to.lng}::float8, ${a.to.lat}::float8), 4326),
      ${a.fromLabel}, ${a.toLabel}, ${date}::date, ${weekdays}::smallint[],
      ${a.time}::time, ${a.windowMin}::smallint, ${now}::timestamptz, ${a.expiresAt}::timestamptz)
    returning id,
      round(ST_Y(origin)::numeric, 5)::float8 as from_lat, round(ST_X(origin)::numeric, 5)::float8 as from_lng,
      round(ST_Y(destination)::numeric, 5)::float8 as to_lat, round(ST_X(destination)::numeric, 5)::float8 as to_lng,
      origin_label, destination_label, to_char(alert_date, 'YYYY-MM-DD') as alert_date,
      weekdays::int[] as weekdays, to_char(local_time, 'HH24:MI') as local_time, window_min,
      created_at, expires_at, last_notified_at, matches_sent`;
  const row = rows[0];
  if (!row) throw new Error('alert insert returned no row');
  return toRideAlert(row);
}

/** Active alerts, newest first (at most 5 exist). */
export async function listActiveAlerts(sql: Db, userId: string, now: Date): Promise<RideAlert[]> {
  const rows = await sql<AlertRow[]>`
    select a.id,
      round(ST_Y(a.origin)::numeric, 5)::float8 as from_lat, round(ST_X(a.origin)::numeric, 5)::float8 as from_lng,
      round(ST_Y(a.destination)::numeric, 5)::float8 as to_lat, round(ST_X(a.destination)::numeric, 5)::float8 as to_lng,
      a.origin_label, a.destination_label, to_char(a.alert_date, 'YYYY-MM-DD') as alert_date,
      a.weekdays::int[] as weekdays, to_char(a.local_time, 'HH24:MI') as local_time, a.window_min,
      a.created_at, a.expires_at, a.last_notified_at, a.matches_sent
    from app.ride_alerts a
    where a.user_id = ${userId}::uuid and a.expires_at > ${now}
    order by a.created_at desc, a.id desc
    limit 20`;
  return rows.map(toRideAlert);
}

/** Own alert only. True when a row was deleted. */
export async function deleteAlert(sql: Db, alertId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    delete from app.ride_alerts where id = ${alertId} and user_id = ${userId}::uuid returning id`;
  return rows.length === 1;
}

type HitRow = {
  alert_id: string;
  user_id: string;
  ride_id: string;
  departure_at: Date | string;
  pickup_area: string | null;
  dropoff_area: string | null;
};

/** One call of app.match_ride_alerts: marks up to `limit` new rides checked and returns the NEW hits. */
export async function matchRideAlerts(sql: Db, now: Date, limit: number): Promise<AlertHit[]> {
  const rows = await sql<HitRow[]>`
    select alert_id, user_id, ride_id, departure_at, pickup_area, dropoff_area
    from app.match_ride_alerts(${now}::timestamptz, ${limit}::integer)`;
  return rows.map((r) => ({
    alertId: r.alert_id,
    userId: r.user_id,
    rideId: r.ride_id,
    departureAt: new Date(r.departure_at),
    pickupArea: r.pickup_area ?? 'Sibiu',
    dropoffArea: r.dropoff_area ?? 'Sibiu',
  }));
}

export async function markAlertNotified(sql: Db, alertId: string, now: Date): Promise<void> {
  await sql`
    update app.ride_alerts
    set last_notified_at = ${now}, matches_sent = matches_sent + 1
    where id = ${alertId}`;
}
