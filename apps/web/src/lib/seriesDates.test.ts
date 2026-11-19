import { describe, expect, it } from 'vitest';
import { addDays, isoWeekday, seriesDates } from './seriesDates';

describe('seriesDates', () => {
  it('numbers weekdays ISO, Monday = 1 and Sunday = 7', () => {
    expect(isoWeekday('2026-11-23')).toBe(1);
    expect(isoWeekday('2026-11-29')).toBe(7);
  });

  it('lists Monday and Wednesday over four weeks', () => {
    const d = seriesDates('2026-11-23', '2026-12-20', [1, 3]);
    expect(d).toHaveLength(8);
    expect(d[0]).toBe('2026-11-23');
    expect(d[1]).toBe('2026-11-25');
    expect(d.at(-1)).toBe('2026-12-16');
  });

  it('crosses month and year ends and stays ascending', () => {
    const d = seriesDates('2026-12-28', '2027-01-10', [1, 5, 7]);
    expect(d).toEqual([
      '2026-12-28',
      '2027-01-01',
      '2027-01-03',
      '2027-01-04',
      '2027-01-08',
      '2027-01-10',
    ]);
  });

  it('is empty without weekdays, for an end before the start or when no weekday fits', () => {
    expect(seriesDates('2026-11-23', '2026-12-01', [])).toEqual([]);
    expect(seriesDates('2026-11-23', '2026-11-22', [1])).toEqual([]);
    expect(seriesDates('2026-11-23', '2026-11-25', [6])).toEqual([]);
  });

  it('adds days across the clock change without drifting', () => {
    expect(addDays('2027-03-27', 1)).toBe('2027-03-28');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});
