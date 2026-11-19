import { describe, expect, it } from 'vitest';
import type { DomainError } from './errors.ts';
import { isoWeekday, normalizeWeekdays, planInstance, planSeries, seriesDates } from './series.ts';

const NOW = new Date('2026-11-19T10:00:00Z'); // Thu 19 Nov 2026, 12:00 in Bucharest

const fieldsOf = (fn: () => unknown): Record<string, string> | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).fields;
  }
  return undefined;
};

describe('isoWeekday and normalizeWeekdays', () => {
  it('numbers Monday 1 to Sunday 7', () => {
    expect(isoWeekday('2026-11-16')).toBe(1);
    expect(isoWeekday('2026-11-22')).toBe(7);
  });
  it('accepts unique 1..7 values (sorted) and refuses the rest', () => {
    expect(normalizeWeekdays([3, 1])).toEqual([1, 3]);
    for (const bad of [[], [0], [8], [1, 1], [1.5], ['1'], [1, 2, 3, 4, 5, 6, 7, 1]]) {
      expect(normalizeWeekdays(bad as unknown[]), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('seriesDates', () => {
  it('Monday and Wednesday over four weeks are 8 dates, ascending', () => {
    const d = seriesDates('2026-11-23', '2026-12-20', [1, 3]);
    expect(d).toHaveLength(8);
    expect(d[0]).toBe('2026-11-23');
    expect(d[7]).toBe('2026-12-16');
    expect([...d].sort()).toEqual(d);
  });
  it('crosses a month end and includes both bounds', () => {
    expect(seriesDates('2026-11-29', '2026-12-03', [7, 4])).toEqual(['2026-11-29', '2026-12-03']);
  });
  it('is empty for an impossible range or no matching weekday', () => {
    expect(seriesDates('2026-11-23', '2026-11-24', [5])).toEqual([]);
    expect(seriesDates('nope', '2026-11-24', [1])).toEqual([]);
  });
  it('at most 29 dates for 28 days with every weekday', () => {
    expect(seriesDates('2026-11-19', '2026-12-17', [1, 2, 3, 4, 5, 6, 7])).toHaveLength(29);
  });
});

describe('planSeries', () => {
  const ok = { weekdays: [1, 3], departureTime: '07:30', endsOn: '2026-12-16' };

  it('defaults startsOn to today (local) and lists the dates', () => {
    const p = planSeries(ok, NOW);
    expect(p.startsOn).toBe('2026-11-19');
    expect(p.weekdays).toEqual([1, 3]);
    expect(p.dates[0]).toBe('2026-11-23');
  });
  it('flags each bad field with its documented code', () => {
    expect(fieldsOf(() => planSeries({ ...ok, weekdays: [] }, NOW))).toEqual({
      weekdays: 'invalid',
    });
    expect(fieldsOf(() => planSeries({ ...ok, departureTime: '7:30' }, NOW))).toEqual({
      departureTime: 'invalid',
    });
    expect(fieldsOf(() => planSeries({ ...ok, startsOn: '2026-11-18' }, NOW))).toEqual({
      startsOn: 'past',
    });
    expect(fieldsOf(() => planSeries({ ...ok, startsOn: '2026-12-04' }, NOW))).toEqual({
      startsOn: 'too_far',
    });
    expect(
      fieldsOf(() => planSeries({ ...ok, startsOn: '2026-11-25', endsOn: '2026-11-24' }, NOW)),
    ).toEqual({ endsOn: 'before_start' });
    expect(fieldsOf(() => planSeries({ ...ok, endsOn: '2026-12-18' }, NOW))).toEqual({
      endsOn: 'too_far',
    });
    expect(fieldsOf(() => planSeries({ ...ok, endsOn: '2026-02-30' }, NOW))).toEqual({
      endsOn: 'invalid',
    });
  });
  it('accepts today + 14 as the start and today + 28 as the end', () => {
    const p = planSeries(
      {
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        departureTime: '07:30',
        startsOn: '2026-12-03',
        endsOn: '2026-12-17',
      },
      NOW,
    );
    expect(p.dates).toHaveLength(15);
  });
  it('reports endsOn = no_dates when no day matches', () => {
    expect(
      fieldsOf(() =>
        planSeries(
          { weekdays: [1], departureTime: '07:30', startsOn: '2026-11-24', endsOn: '2026-11-25' },
          NOW,
        ),
      ),
    ).toEqual({ endsOn: 'no_dates' });
  });
});

describe('planInstance', () => {
  it('converts the local time to UTC (winter +2, summer +3)', () => {
    const w = planInstance('2026-11-23', '07:30', NOW);
    expect(w.ok && w.departureAt.toISOString()).toBe('2026-11-23T05:30:00.000Z');
    const s = planInstance('2027-07-05', '07:30', new Date('2027-07-01T00:00:00Z'));
    expect(s.ok && s.departureAt.toISOString()).toBe('2027-07-05T04:30:00.000Z');
  });
  it('skips a time inside the last-Sunday-of-March gap as INVALID_TIME', () => {
    // 28 Mar 2027: 03:00 jumps to 04:00, so 03:30 does not exist.
    expect(planInstance('2027-03-28', '03:30', new Date('2027-03-20T00:00:00Z'))).toEqual({
      ok: false,
      code: 'INVALID_TIME',
    });
    expect(planInstance('2027-03-28', '04:30', new Date('2027-03-20T00:00:00Z')).ok).toBe(true);
  });
  it('accepts a time in the October repeated hour (one of the two instants)', () => {
    // 31 Oct 2027: 04:00 falls back to 03:00, so 03:30 happens twice.
    expect(planInstance('2027-10-31', '03:30', new Date('2027-10-20T00:00:00Z')).ok).toBe(true);
  });
  it('skips a departure under 15 minutes away as DEPARTURE_TOO_SOON', () => {
    expect(planInstance('2026-11-19', '12:10', NOW)).toEqual({
      ok: false,
      code: 'DEPARTURE_TOO_SOON',
    });
    expect(planInstance('2026-11-19', '12:15', NOW).ok).toBe(true);
  });
});
