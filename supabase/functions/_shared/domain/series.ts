import type { SkipCode } from '../contracts/liquidity.ts';
import type { Weekday } from '../contracts/rides.ts';
import { DomainError } from './errors.ts';
import { MIN_LEAD_MIN, SERIES_MAX_DAYS, SERIES_START_MAX_DAYS } from './rules.ts';
import { bucharestDayKey, bucharestLocalToUtc, bucharestTime } from './time.ts';

/**
 * Ride series rules (E8-1, e8-liquidity-spec §2, ADR 0039). Pure: today comes from the caller's
 * clock. Dates are local Europe/Bucharest `YYYY-MM-DD` strings, weekdays ISO (Monday = 1).
 */

const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Milliseconds at UTC midnight of a valid `YYYY-MM-DD`, or null. */
export function dayToMs(day: string): number | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(ms);
  if (back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3])) return null;
  return ms;
}

export const msToDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const addLocalDays = (day: string, n: number): string =>
  msToDay((dayToMs(day) ?? 0) + n * DAY_MS);

/** ISO weekday of a local date (Monday = 1). */
export function isoWeekday(day: string): Weekday {
  const d = new Date(dayToMs(day) ?? 0).getUTCDay(); // 0 = Sunday
  return (((d + 6) % 7) + 1) as Weekday;
}

/** Unique ISO weekdays in ascending order, or null when the input is not 1 to 7 distinct 1..7 integers. */
export function normalizeWeekdays(input: readonly unknown[]): Weekday[] | null {
  if (input.length < 1 || input.length > 7) return null;
  const set = new Set<number>();
  for (const v of input) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 7) return null;
    if (set.has(v)) return null;
    set.add(v);
  }
  return [...set].sort((a, b) => a - b) as Weekday[];
}

/** Every local date from `startsOn` to `endsOn` (inclusive) whose ISO weekday is in `weekdays`, ascending. */
export function seriesDates(
  startsOn: string,
  endsOn: string,
  weekdays: readonly number[],
): string[] {
  const start = dayToMs(startsOn);
  const end = dayToMs(endsOn);
  if (start === null || end === null) return [];
  const out: string[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const day = msToDay(ms);
    if (weekdays.includes(isoWeekday(day))) out.push(day);
  }
  return out;
}

export type { SkipCode, Weekday };

export type SeriesInput = {
  weekdays: readonly unknown[];
  departureTime: string;
  startsOn?: string | undefined;
  endsOn: string;
};

export type SeriesPlan = {
  weekdays: Weekday[];
  departureTime: string;
  startsOn: string;
  endsOn: string;
  dates: string[];
};

/** Validates the request fields. Throws VALIDATION_FAILED with `fields` naming each problem. */
export function planSeries(input: SeriesInput, now: Date): SeriesPlan {
  const fields: Record<string, string> = {};
  const today = bucharestDayKey(now);

  const weekdays = normalizeWeekdays(input.weekdays);
  if (!weekdays) fields.weekdays = 'invalid';
  if (!TIME_RE.test(input.departureTime)) fields.departureTime = 'invalid';

  const startsOn = input.startsOn ?? today;
  if (dayToMs(startsOn) === null) fields.startsOn = 'invalid';
  else if (startsOn < today) fields.startsOn = 'past';
  else if (startsOn > addLocalDays(today, SERIES_START_MAX_DAYS)) fields.startsOn = 'too_far';

  if (dayToMs(input.endsOn) === null) fields.endsOn = 'invalid';
  else if (!fields.startsOn && input.endsOn < startsOn) fields.endsOn = 'before_start';
  else if (input.endsOn > addLocalDays(today, SERIES_MAX_DAYS)) fields.endsOn = 'too_far';

  if (Object.keys(fields).length > 0 || !weekdays) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid ride series.', fields);
  }
  const dates = seriesDates(startsOn, input.endsOn, weekdays);
  if (dates.length === 0) {
    throw new DomainError('VALIDATION_FAILED', 'No date matches.', { endsOn: 'no_dates' });
  }
  return { weekdays, departureTime: input.departureTime, startsOn, endsOn: input.endsOn, dates };
}

export type InstancePlan =
  { ok: true; departureAt: Date } | { ok: false; code: 'DEPARTURE_TOO_SOON' | 'INVALID_TIME' };

/**
 * One date of a series. A wall-clock time inside the spring clock-change gap does not exist
 * (INVALID_TIME); a departure under 15 minutes away is too soon.
 */
export function planInstance(day: string, time: string, now: Date): InstancePlan {
  const departureAt = bucharestLocalToUtc(day, time);
  if (bucharestTime(departureAt) !== time) return { ok: false, code: 'INVALID_TIME' };
  if (departureAt.getTime() < now.getTime() + MIN_LEAD_MIN * 60_000) {
    return { ok: false, code: 'DEPARTURE_TOO_SOON' };
  }
  return { ok: true, departureAt };
}
