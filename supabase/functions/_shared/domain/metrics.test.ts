import { describe, expect, it } from 'vitest';
import {
  METRIC_TARGETS,
  addDays,
  buildMetrics,
  currentIsoWeek,
  formatIsoWeek,
  isoWeekOfDay,
  isoWeeksInYear,
  mondayOf,
  parseIsoWeek,
  rate,
  resolveWeek,
  round,
  status,
  weekBounds,
  weekSeriesMondays,
  type WeekCounts,
} from './metrics.ts';

describe('ISO weeks', () => {
  it('parses a week to its Monday', () => {
    expect(parseIsoWeek('2026-W47')).toBe('2026-11-16');
    expect(parseIsoWeek('2026-W46')).toBe('2026-11-09');
    expect(parseIsoWeek('2024-W01')).toBe('2024-01-01');
  });

  it('W01 can start in the previous year', () => {
    expect(parseIsoWeek('2026-W01')).toBe('2025-12-29');
    expect(parseIsoWeek('2025-W01')).toBe('2024-12-30');
    expect(parseIsoWeek('2027-W01')).toBe('2027-01-04');
  });

  it('knows which years have 53 weeks', () => {
    expect(isoWeeksInYear(2026)).toBe(53);
    expect(isoWeeksInYear(2027)).toBe(52);
    expect(isoWeeksInYear(2020)).toBe(53);
    expect(parseIsoWeek('2026-W53')).toBe('2026-12-28');
    expect(parseIsoWeek('2027-W53')).toBeNull();
    expect(parseIsoWeek('2020-W53')).toBe('2020-12-28');
  });

  it('rejects malformed weeks', () => {
    for (const bad of [
      '2026-W00',
      '2026-W54',
      '2026-47',
      '26-W47',
      '2026-W7',
      '2026W47',
      '',
      'x',
    ]) {
      expect(parseIsoWeek(bad), bad).toBeNull();
    }
  });

  it('formats a day and a Monday back to the label (round trip)', () => {
    expect(isoWeekOfDay('2026-12-31')).toBe('2026-W53');
    expect(isoWeekOfDay('2027-01-03')).toBe('2026-W53');
    expect(isoWeekOfDay('2027-01-04')).toBe('2027-W01');
    expect(isoWeekOfDay('2025-12-29')).toBe('2026-W01');
    expect(isoWeekOfDay('2026-01-01')).toBe('2026-W01');
    for (const w of ['2026-W01', '2026-W47', '2026-W53', '2027-W52', '2024-W10']) {
      const monday = parseIsoWeek(w) as string;
      expect(formatIsoWeek(monday)).toBe(w);
      expect(mondayOf(addDays(monday, 6))).toBe(monday);
    }
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('currentIsoWeek follows Europe/Bucharest: Sunday 23:30 local is still the old week', () => {
    expect(currentIsoWeek(new Date('2026-11-22T21:30:00Z'))).toBe('2026-W47'); // 23:30 EET Sunday
    expect(currentIsoWeek(new Date('2026-11-22T22:30:00Z'))).toBe('2026-W48'); // 00:30 EET Monday
  });

  it('week bounds are local midnights: a DST week is 169 or 167 hours', () => {
    const hours = (monday: string) => {
      const { from, to } = weekBounds(monday);
      return (to.getTime() - from.getTime()) / 3_600_000;
    };
    expect(hours('2026-11-16')).toBe(168);
    expect(hours('2026-10-19')).toBe(169); // clocks go back on Sunday 25 Oct
    expect(hours('2026-03-23')).toBe(167); // clocks go forward on Sunday 29 Mar
    expect(weekBounds('2026-11-16').from.toISOString()).toBe('2026-11-15T22:00:00.000Z');
    expect(weekBounds('2026-10-19').from.toISOString()).toBe('2026-10-18T21:00:00.000Z');
  });

  it('builds the series of Mondays, oldest first', () => {
    expect(weekSeriesMondays('2026-11-16', 3)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
    expect(weekSeriesMondays('2026-11-16', 12)).toHaveLength(12);
  });
});

describe('resolveWeek', () => {
  const NOW = new Date('2026-11-17T09:00:00Z'); // 2026-W47

  it('defaults to the current week', () => {
    expect(resolveWeek(undefined, NOW)).toEqual({
      ok: true,
      week: '2026-W47',
      monday: '2026-11-16',
    });
    expect(resolveWeek('', NOW)).toMatchObject({ ok: true, week: '2026-W47' });
  });

  it('accepts the first launch week up to the current one', () => {
    expect(resolveWeek('2026-W46', NOW)).toMatchObject({ ok: true, monday: '2026-11-09' });
    expect(resolveWeek('2026-W47', NOW)).toMatchObject({ ok: true });
  });

  it('rejects malformed, early and future weeks with a reason', () => {
    expect(resolveWeek('2026-W45', NOW)).toEqual({ ok: false, reason: 'before_launch' });
    expect(resolveWeek('2026-W48', NOW)).toEqual({ ok: false, reason: 'future' });
    expect(resolveWeek('nope', NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(resolveWeek('2027-W53', NOW)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('rate and round', () => {
  it('is null for a zero denominator and 3 decimals otherwise', () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(5, 0)).toBeNull();
    expect(rate(0, 4)).toBe(0);
    expect(rate(1, 3)).toBe(0.333);
    expect(rate(2, 3)).toBe(0.667);
    expect(rate(1, 16)).toBe(0.063); // 0.0625 rounds half up
    expect(rate(4, 4)).toBe(1);
  });

  it('rounds half away from zero', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(2.5, 0)).toBe(3);
    expect(round(-2.5, 0)).toBe(-3);
    expect(round(10, 1)).toBe(10);
  });
});

describe('status per direction at the exact thresholds', () => {
  const t = METRIC_TARGETS;

  it('higher is better: on target at the target, below kill under the kill', () => {
    expect(status(100, t.northStar)).toBe('on_target');
    expect(status(99, t.northStar)).toBe('between');
    expect(status(30, t.northStar)).toBe('between');
    expect(status(29, t.northStar)).toBe('below_kill');
    expect(status(0.3, t.matchRate)).toBe('on_target');
    expect(status(0.299, t.matchRate)).toBe('between');
    expect(status(0.15, t.matchRate)).toBe('between');
    expect(status(0.149, t.matchRate)).toBe('below_kill');
    expect(status(0.25, t.fillRate)).toBe('on_target');
    expect(status(0.1, t.fillRate)).toBe('between');
    expect(status(0.099, t.fillRate)).toBe('below_kill');
    expect(status(0.4, t.retention4w)).toBe('on_target');
    expect(status(0.2, t.retention4w)).toBe('between');
    expect(status(0.199, t.retention4w)).toBe('below_kill');
  });

  it('lower is better: on target strictly under the target, below kill strictly over the kill', () => {
    expect(status(14.9, t.medianResponseMin)).toBe('on_target');
    expect(status(15, t.medianResponseMin)).toBe('between');
    expect(status(60, t.medianResponseMin)).toBe('between');
    expect(status(60.1, t.medianResponseMin)).toBe('below_kill');
    expect(status(0.99, t.reportsPer100)).toBe('on_target');
    expect(status(1, t.reportsPer100)).toBe('between');
    expect(status(3, t.reportsPer100)).toBe('between');
    expect(status(3.01, t.reportsPer100)).toBe('below_kill');
    expect(status(0.149, t.cancellationRate)).toBe('on_target');
    expect(status(0.15, t.cancellationRate)).toBe('between');
    expect(status(0.3, t.cancellationRate)).toBe('between');
    expect(status(0.301, t.cancellationRate)).toBe('below_kill');
  });

  it('zero is a real value, null is no data', () => {
    expect(status(0, t.northStar)).toBe('below_kill');
    expect(status(0, t.reportsPer100)).toBe('on_target');
    expect(status(null, t.northStar)).toBe('no_data');
    expect(status(Number.NaN, t.matchRate)).toBe('no_data');
  });
});

describe('buildMetrics', () => {
  const counts = (over: Partial<WeekCounts> = {}): WeekCounts => ({
    completed_seats: 12,
    rides_departed: 40,
    rides_filled: 10,
    requests: 30,
    requests_decided: 20,
    requests_expired: 4,
    median_response_s: 600,
    cohort_size: 10,
    cohort_retained: 4,
    cohort_closed: true,
    reports: 1,
    rides_completed: 50,
    accepted: 30,
    cancelled_after_accept: 3,
    ...over,
  });
  const corridors = [
    { corridor: 'south', searches: 10, matched: 4 },
    { corridor: 'west', searches: 10, matched: 2 },
    { corridor: 'other', searches: 20, matched: 10 },
  ];

  it('turns counts into values, denominators and statuses', () => {
    const m = buildMetrics(counts(), corridors, '2026-W43');
    expect(m.northStar).toEqual({ value: 12, target: 100, kill: 30, status: 'below_kill', n: 12 });
    expect(m.fillRate).toEqual({
      value: 0.25,
      target: 0.25,
      kill: 0.1,
      status: 'on_target',
      n: 40,
    });
    expect(m.medianResponseMin).toEqual({
      value: 10,
      target: 15,
      kill: 60,
      status: 'on_target',
      n: 20,
    });
    expect(m.retention4w).toMatchObject({
      value: 0.4,
      status: 'on_target',
      n: 10,
      cohortWeek: '2026-W43',
      closed: true,
    });
    expect(m.reportsPer100).toMatchObject({ value: 2, status: 'between', n: 50 });
    expect(m.cancellationRate).toMatchObject({ value: 0.1, status: 'on_target', n: 30 });
  });

  it('match rate: overall, launch corridors only, and always four corridors', () => {
    const m = buildMetrics(counts(), corridors, 'w');
    expect(m.matchRate.overall).toMatchObject({ value: 0.4, n: 40 });
    expect(m.matchRate.launch).toMatchObject({ value: 0.3, status: 'on_target', n: 20 });
    expect(m.matchRate.byCorridor.map((c) => c.corridor)).toEqual([
      'south',
      'west',
      'campus',
      'other',
    ]);
    expect(m.matchRate.byCorridor[2]).toEqual({ corridor: 'campus', value: null, searches: 0 });
    expect(m.matchRate.byCorridor[0]).toEqual({ corridor: 'south', value: 0.4, searches: 10 });
  });

  it('an empty week has no data, not zeros', () => {
    const m = buildMetrics(
      counts({
        completed_seats: 0,
        rides_departed: 0,
        rides_filled: 0,
        requests_decided: 0,
        median_response_s: null,
        cohort_size: 0,
        cohort_retained: 0,
        cohort_closed: false,
        reports: 0,
        rides_completed: 0,
        accepted: 0,
        cancelled_after_accept: 0,
      }),
      [],
      'w',
    );
    expect(m.northStar).toMatchObject({ value: 0, status: 'below_kill' });
    for (const k of [
      'fillRate',
      'medianResponseMin',
      'retention4w',
      'reportsPer100',
      'cancellationRate',
    ] as const) {
      expect(m[k], k).toMatchObject({ value: null, status: 'no_data', n: 0 });
    }
    expect(m.matchRate.launch).toMatchObject({ value: null, status: 'no_data', n: 0 });
    expect(m.retention4w.closed).toBe(false);
  });

  it('rounds the median to 1 decimal minute and reports to 2 decimals', () => {
    const m = buildMetrics(
      counts({ median_response_s: 1_000, reports: 1, rides_completed: 3 }),
      [],
      'w',
    );
    expect(m.medianResponseMin.value).toBe(16.7);
    expect(m.reportsPer100.value).toBe(33.33);
  });

  it('counts only the four known corridors', () => {
    const m = buildMetrics(counts(), [{ corridor: 'mars', searches: 5, matched: 5 }], 'w');
    expect(m.matchRate.overall.n).toBe(0);
  });
});
