import type { AdminMetricsResponse, Metric, MetricStatus } from '../contracts/admin.ts';
import { LAUNCH_CORRIDORS } from './corridors.ts';
import { METRICS_FIRST_WEEK } from './rules.ts';
import { bucharestDayKey, bucharestLocalToUtc } from './time.ts';

/**
 * Weekly metrics (E7-2, ADR 0034, e7-metrics-admin-spec §3). The database returns COUNTS for one ISO
 * week (Europe/Bucharest, Monday 00:00 local); this module turns them into rates, rounds them and
 * judges them against the targets and kill thresholds of mvp-scope §4. Pure: no I/O.
 */

// ---- targets -----------------------------------------------------------------------------------------------------

type Direction = 'higher' | 'lower';

/** `higher`: on target at `>= target`, below kill at `< kill`. `lower`: on target at `< target`, below kill at `> kill`. */
export type MetricTarget = { target: number; kill: number; direction: Direction };

/** Rates are fractions (0.3 = 30 %). The median response is in minutes, reports per 100 completed rides. */
export const METRIC_TARGETS = {
  northStar: { target: 100, kill: 30, direction: 'higher' },
  matchRate: { target: 0.3, kill: 0.15, direction: 'higher' },
  fillRate: { target: 0.25, kill: 0.1, direction: 'higher' },
  medianResponseMin: { target: 15, kill: 60, direction: 'lower' },
  retention4w: { target: 0.4, kill: 0.2, direction: 'higher' },
  reportsPer100: { target: 1, kill: 3, direction: 'lower' },
  cancellationRate: { target: 0.15, kill: 0.3, direction: 'lower' },
} as const satisfies Record<string, MetricTarget>;

export type MetricKey = keyof typeof METRIC_TARGETS;

/** Judges a value in the metric's own direction. Exactly at a threshold is the better side for `higher`. */
export function status(value: number | null, t: MetricTarget): MetricStatus {
  if (value === null || !Number.isFinite(value)) return 'no_data';
  if (t.direction === 'higher') {
    if (value >= t.target) return 'on_target';
    if (value < t.kill) return 'below_kill';
    return 'between';
  }
  if (value < t.target) return 'on_target';
  if (value > t.kill) return 'below_kill';
  return 'between';
}

// ---- arithmetic --------------------------------------------------------------------------------------------------

/** Rounds half away from zero to `dp` decimals (avoids 1.005 style float surprises). */
export function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.sign(value) * (Math.round(Math.abs(value) * f + Number.EPSILON * f) / f);
}

/** n / d as a fraction with 3 decimals, `null` when `d` is 0. */
export function rate(n: number, d: number): number | null {
  if (d <= 0) return null;
  return round(n / d, 3);
}

// ---- ISO weeks (Monday 00:00 Europe/Bucharest) ----------------------------------------------------------------

const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const dayNumber = (key: string): number => {
  const m = DAY_RE.exec(key);
  if (!m) throw new Error(`invalid day key ${key}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
};
const dayKey = (n: number): string => {
  const d = new Date(n * DAY_MS);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** `YYYY-MM-DD` plus `days` (negative allowed). Calendar arithmetic, no time zones. */
export const addDays = (key: string, days: number): string => dayKey(dayNumber(key) + days);

/** 1 (Monday) to 7 (Sunday). */
const isoWeekday = (n: number): number => ((((n + 3) % 7) + 7) % 7) + 1; // 1970-01-01 was a Thursday

/** Monday of ISO week 1: the week that holds 4 January. */
function week1Monday(year: number): number {
  const jan4 = dayNumber(`${pad(year, 4)}-01-04`);
  return jan4 - (isoWeekday(jan4) - 1);
}

/** 52 or 53: a year has 53 ISO weeks when it starts on a Thursday (or a Wednesday in a leap year). */
export function isoWeeksInYear(year: number): number {
  return Math.round((week1Monday(year + 1) - week1Monday(year)) / 7);
}

/** `2026-W47` to the Monday date `2026-11-16`. `null` when malformed or the week does not exist. */
export function parseIsoWeek(value: string): string | null {
  const m = WEEK_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (year < 1970 || year > 2200 || week < 1 || week > isoWeeksInYear(year)) return null;
  return dayKey(week1Monday(year) + (week - 1) * 7);
}

/** The ISO week label (`2026-W47`) of a calendar day. */
export function isoWeekOfDay(key: string): string {
  const n = dayNumber(key);
  const thursday = n - (isoWeekday(n) - 1) + 3; // the Thursday of the same week decides the ISO year
  const year = Number(dayKey(thursday).slice(0, 4));
  const week = Math.floor((n - (isoWeekday(n) - 1) - week1Monday(year)) / 7) + 1;
  return `${pad(year, 4)}-W${pad(week)}`;
}

/** The Monday on or before a calendar day. */
export const mondayOf = (key: string): string => {
  const n = dayNumber(key);
  return dayKey(n - (isoWeekday(n) - 1));
};

/** The label of the Monday-based week that holds `monday`. */
export const formatIsoWeek = (monday: string): string => isoWeekOfDay(monday);

/** The current ISO week in Europe/Bucharest. */
export function currentIsoWeek(now: Date): string {
  return isoWeekOfDay(bucharestDayKey(now));
}

/** UTC instants of Monday 00:00 Bucharest of the week and of the next one. */
export function weekBounds(monday: string): { from: Date; to: Date } {
  return {
    from: bucharestLocalToUtc(monday, '00:00'),
    to: bucharestLocalToUtc(addDays(monday, 7), '00:00'),
  };
}

export type WeekResolution =
  | { ok: true; week: string; monday: string }
  | { ok: false; reason: 'invalid' | 'before_launch' | 'future' };

/**
 * Resolves the `week` query parameter: default the current week; otherwise `METRICS_FIRST_WEEK` up to
 * and including the current week. Anything else is a 400 with `fields.week`.
 */
export function resolveWeek(raw: string | undefined, now: Date): WeekResolution {
  const current = currentIsoWeek(now);
  const week = raw === undefined || raw === '' ? current : raw;
  const monday = parseIsoWeek(week);
  if (monday === null) return { ok: false, reason: 'invalid' };
  const first = parseIsoWeek(METRICS_FIRST_WEEK);
  const last = parseIsoWeek(current);
  if (first !== null && monday < first) return { ok: false, reason: 'before_launch' };
  if (last !== null && monday > last) return { ok: false, reason: 'future' };
  return { ok: true, week: formatIsoWeek(monday), monday };
}

/** The `weeks` Mondays ending at `lastMonday`, oldest first. */
export function weekSeriesMondays(lastMonday: string, weeks: number): string[] {
  return Array.from({ length: weeks }, (_, i) => addDays(lastMonday, -7 * (weeks - 1 - i)));
}

// ---- from counts to the response -------------------------------------------------------------------------------------

/** One row of `app.metrics_week` (counts only). `median_response_s` is null without decided requests. */
export type WeekCounts = {
  completed_seats: number;
  rides_departed: number;
  rides_filled: number;
  requests: number;
  requests_decided: number;
  requests_expired: number;
  median_response_s: number | null;
  cohort_size: number;
  cohort_retained: number;
  cohort_closed: boolean;
  reports: number;
  rides_completed: number;
  accepted: number;
  cancelled_after_accept: number;
};

export type CorridorCounts = { corridor: string; searches: number; matched: number };

const CORRIDOR_ORDER = ['south', 'west', 'campus', 'other'] as const;
type CorridorName = (typeof CORRIDOR_ORDER)[number];
const isLaunch = (c: string): boolean => (LAUNCH_CORRIDORS as readonly string[]).includes(c);

function metric(key: MetricKey, value: number | null, n: number): Metric {
  const t = METRIC_TARGETS[key];
  return { value, target: t.target, kill: t.kill, status: status(value, t), n };
}

export type MetricsBody = Omit<
  AdminMetricsResponse,
  'week' | 'from' | 'to' | 'partial' | 'series' | 'flags'
>;

/** All seven metrics of one week from its counts. Pure. */
export function buildMetrics(
  counts: WeekCounts,
  corridors: readonly CorridorCounts[],
  cohortWeek: string,
): MetricsBody {
  const byName = new Map(corridors.map((c) => [c.corridor, c]));
  const rows = CORRIDOR_ORDER.map((name: CorridorName) => ({
    corridor: name,
    searches: byName.get(name)?.searches ?? 0,
    matched: byName.get(name)?.matched ?? 0,
  }));
  const sum = (list: typeof rows, f: 'searches' | 'matched') => list.reduce((a, r) => a + r[f], 0);
  const launchRows = rows.filter((r) => isLaunch(r.corridor));

  const medianMin =
    counts.median_response_s === null || counts.requests_decided === 0
      ? null
      : round(counts.median_response_s / 60, 1);
  const reportsPer100 =
    counts.rides_completed > 0 ? round((100 * counts.reports) / counts.rides_completed, 2) : null;

  return {
    northStar: metric('northStar', counts.completed_seats, counts.completed_seats),
    matchRate: {
      overall: metric(
        'matchRate',
        rate(sum(rows, 'matched'), sum(rows, 'searches')),
        sum(rows, 'searches'),
      ),
      launch: metric(
        'matchRate',
        rate(sum(launchRows, 'matched'), sum(launchRows, 'searches')),
        sum(launchRows, 'searches'),
      ),
      byCorridor: rows.map((r) => ({
        corridor: r.corridor,
        value: rate(r.matched, r.searches),
        searches: r.searches,
      })),
    },
    fillRate: metric(
      'fillRate',
      rate(counts.rides_filled, counts.rides_departed),
      counts.rides_departed,
    ),
    medianResponseMin: metric('medianResponseMin', medianMin, counts.requests_decided),
    retention4w: {
      ...metric(
        'retention4w',
        rate(counts.cohort_retained, counts.cohort_size),
        counts.cohort_size,
      ),
      cohortWeek,
      closed: counts.cohort_closed,
    },
    reportsPer100: metric('reportsPer100', reportsPer100, counts.rides_completed),
    cancellationRate: metric(
      'cancellationRate',
      rate(counts.cancelled_after_accept, counts.accepted),
      counts.accepted,
    ),
  };
}
