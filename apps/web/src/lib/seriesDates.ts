import type { Weekday } from '@/api/liquidity';

/** Mirror of the server rules (e8 spec section 2) for instant feedback; the server stays the authority. */
export const SERIES_MAX_DAYS = 28;

/** ISO weekday (Monday = 1) of a YYYY-MM-DD calendar day. Pure calendar arithmetic, no time zone involved. */
export function isoWeekday(day: string): Weekday {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return (js === 0 ? 7 : js) as Weekday;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Ascending calendar days from `startsOn` to `endsOn` (inclusive) that fall on one of `weekdays`. */
export function seriesDates(
  startsOn: string,
  endsOn: string,
  weekdays: readonly Weekday[],
): string[] {
  if (endsOn < startsOn || weekdays.length === 0) return [];
  const set = new Set<number>(weekdays);
  const out: string[] = [];
  for (let day = startsOn; day <= endsOn; day = addDays(day, 1)) {
    if (set.has(isoWeekday(day))) out.push(day);
    if (out.length > SERIES_MAX_DAYS + 1) break;
  }
  return out;
}

/** Monday..Sunday as ISO numbers; names come from the i18n files (weekday.N.short / weekday.N.long). */
export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];
