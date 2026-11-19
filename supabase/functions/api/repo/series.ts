import type { Db } from '../../_shared/db.ts';
import type { RideSeries, Weekday } from '../../_shared/contracts/rides.ts';

/**
 * SQL for ride series (E8-1, ADR 0039). Dates and times come out as local strings (`to_char`), so no
 * timezone conversion can shift them. A series holds no geometry.
 */

type SeriesRow = {
  id: string;
  weekdays: number[];
  departure_time: string;
  starts_on: string;
  ends_on: string;
  status: 'active' | 'cancelled';
  upcoming_count: number;
};

const toSeries = (r: SeriesRow): RideSeries => ({
  id: r.id,
  weekdays: r.weekdays.map(Number) as Weekday[],
  departureTime: r.departure_time,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  status: r.status,
  upcomingCount: Number(r.upcoming_count),
});

export type NewSeries = {
  driverId: string;
  weekdays: readonly number[];
  departureTime: string;
  startsOn: string;
  endsOn: string;
  now: Date;
};

export async function insertSeries(sql: Db, v: NewSeries): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into app.ride_series (driver_id, weekdays, departure_time, starts_on, ends_on, created_at)
    values (${v.driverId}::uuid, ${`{${v.weekdays.join(',')}}`}::smallint[], ${v.departureTime}::time,
            ${v.startsOn}::date, ${v.endsOn}::date, ${v.now}::timestamptz)
    returning id`;
  const row = rows[0];
  if (!row) throw new Error('series insert returned no row');
  return row.id;
}

/** A series with its count of published, not yet departed instances. */
export async function selectSeriesView(
  sql: Db,
  seriesId: string,
  now: Date,
): Promise<RideSeries | null> {
  const rows = await sql<SeriesRow[]>`
    select s.id, s.weekdays::int[] as weekdays, to_char(s.departure_time, 'HH24:MI') as departure_time,
           to_char(s.starts_on, 'YYYY-MM-DD') as starts_on, to_char(s.ends_on, 'YYYY-MM-DD') as ends_on,
           s.status,
           (select count(*)::int from app.rides r
             where r.series_id = s.id and r.status = 'published' and r.departure_at > ${now}) as upcoming_count
    from app.ride_series s
    where s.id = ${seriesId}`;
  const row = rows[0];
  return row ? toSeries(row) : null;
}

/** The caller's own series, locked for the cancel. Null when unknown or someone else's. */
export async function lockOwnSeries(
  sql: Db,
  seriesId: string,
  driverId: string,
): Promise<{ id: string; status: 'active' | 'cancelled' } | undefined> {
  const rows = await sql<{ id: string; status: 'active' | 'cancelled' }[]>`
    select id, status from app.ride_series
    where id = ${seriesId} and driver_id = ${driverId}
    for update`;
  return rows[0];
}

/** Published instances that have not departed, soonest first (the cancel order). */
export async function listUpcomingInstanceIds(
  sql: Db,
  seriesId: string,
  now: Date,
): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select id from app.rides
    where series_id = ${seriesId} and status = 'published' and departure_at > ${now}
    order by departure_at, id`;
  return rows.map((r) => r.id);
}

export async function markSeriesCancelled(sql: Db, seriesId: string, now: Date): Promise<void> {
  await sql`
    update app.ride_series set status = 'cancelled', cancelled_at = ${now}
    where id = ${seriesId} and status = 'active'`;
}
