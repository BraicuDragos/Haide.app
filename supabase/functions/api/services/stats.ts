import type { MonthStatsResponse } from '../../_shared/contracts/liquidity.ts';
import { STATS_FIRST_MONTH } from '../../_shared/domain/rules.ts';
import { bucharestDayKey } from '../../_shared/domain/time.ts';
import { AppError } from '../../_shared/errors.ts';
import { selectMonthStats } from '../repo/stats.ts';
import type { Account, Deps } from '../types.ts';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

const bad = (code: 'invalid' | 'before_launch' | 'future') =>
  new AppError('VALIDATION_FAILED', 'Invalid month.', { fields: { month: code } });

/** `YYYY-MM` after `month`. */
export function nextMonth(month: string): string {
  const m = MONTH_RE.exec(month);
  if (!m) throw bad('invalid');
  const year = Number(m[1]);
  const mon = Number(m[2]);
  return mon === 12
    ? `${year + 1}-01`
    : `${String(year).padStart(4, '0')}-${String(mon + 1).padStart(2, '0')}`;
}

/** GET /me/stats/month: default the current local month; from the launch month to now, else 400. */
export async function monthStats(
  deps: Deps,
  account: Account,
  month: string | undefined,
): Promise<MonthStatsResponse> {
  const current = bucharestDayKey(deps.clock.now()).slice(0, 7);
  const wanted = month ?? current;
  if (!MONTH_RE.test(wanted)) throw bad('invalid');
  if (wanted < STATS_FIRST_MONTH) throw bad('before_launch');
  if (wanted > current) throw bad('future');

  const row = await selectMonthStats(deps.sql, account.id, `${wanted}-01`);
  return {
    month: wanted,
    from: `${wanted}-01`,
    to: `${nextMonth(wanted)}-01`,
    driver: {
      sharedFuelCostBani: Number(row.driver_shared_bani),
      passengersCarried: Number(row.driver_passengers),
      ridesCompleted: Number(row.driver_rides),
    },
    passenger: {
      paidBani: Number(row.passenger_paid_bani),
      ridesCompleted: Number(row.passenger_rides),
    },
  };
}
