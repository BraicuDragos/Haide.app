import type { Db } from '../../_shared/db.ts';
import type { CorridorCounts, WeekCounts } from '../../_shared/domain/metrics.ts';

/**
 * Metrics reads (E7-2, ADR 0034): the STABLE SQL functions return counts, never rates. `week` is the
 * Monday as `YYYY-MM-DD` (a non-Monday raises 22023 in the database; the service validates first).
 */

export async function selectWeekCounts(sql: Db, monday: string, now: Date): Promise<WeekCounts> {
  const rows = await sql<WeekCounts[]>`
    select completed_seats, rides_departed, rides_filled, requests, requests_decided, requests_expired,
           median_response_s, cohort_size, cohort_retained, cohort_closed, reports, rides_completed,
           accepted, cancelled_after_accept
    from app.metrics_week(${monday}::date, ${now}::timestamptz)`;
  const row = rows[0];
  if (!row) throw new Error('metrics_week returned no row');
  return row;
}

export async function selectCorridorCounts(sql: Db, monday: string): Promise<CorridorCounts[]> {
  return await sql<CorridorCounts[]>`
    select corridor, searches, matched from app.metrics_match_by_corridor(${monday}::date)`;
}

export async function selectSeatsSeries(
  sql: Db,
  lastMonday: string,
  weeks: number,
): Promise<{ week: string; completed_seats: number }[]> {
  return await sql<{ week: string; completed_seats: number }[]>`
    select to_char(week, 'YYYY-MM-DD') as week, completed_seats
    from app.metrics_seats_series(${lastMonday}::date, ${weeks}::integer)`;
}

export async function selectHighVolumeDrivers(
  sql: Db,
  until: Date,
  min: number,
): Promise<{ driver_id: string; completed: number }[]> {
  return await sql<{ driver_id: string; completed: number }[]>`
    select driver_id, completed
    from app.metrics_high_volume_drivers(${until}::timestamptz, ${min}::integer)`;
}
