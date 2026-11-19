import type { Db } from '../../_shared/db.ts';

/** SQL for the monthly stats (E8-5): one STABLE function, local month in Europe/Bucharest. */

export type MonthStatsRow = {
  driver_shared_bani: string | number;
  driver_passengers: number;
  driver_rides: number;
  passenger_paid_bani: string | number;
  passenger_rides: number;
};

/** `firstOfMonth` is `YYYY-MM-01`. */
export async function selectMonthStats(
  sql: Db,
  userId: string,
  firstOfMonth: string,
): Promise<MonthStatsRow> {
  const rows = await sql<MonthStatsRow[]>`
    select driver_shared_bani, driver_passengers, driver_rides, passenger_paid_bani, passenger_rides
    from app.user_month_stats(${userId}::uuid, ${firstOfMonth}::date)`;
  return (
    rows[0] ?? {
      driver_shared_bani: 0,
      driver_passengers: 0,
      driver_rides: 0,
      passenger_paid_bani: 0,
      passenger_rides: 0,
    }
  );
}
