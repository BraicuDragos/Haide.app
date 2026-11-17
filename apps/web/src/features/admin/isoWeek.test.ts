import { describe, expect, it } from 'vitest';
import {
  addWeeks,
  compareWeeks,
  currentIsoWeek,
  isoWeekOf,
  parseIsoWeek,
  weekLabel,
  weeksInYear,
} from './isoWeek';

describe('isoWeek', () => {
  it('parses a week to its Monday', () => {
    expect(parseIsoWeek('2026-W47')).toBe('2026-11-16');
    expect(parseIsoWeek('2026-W01')).toBe('2025-12-29');
  });
  it('knows 53-week years', () => {
    expect(weeksInYear(2026)).toBe(53);
    expect(weeksInYear(2027)).toBe(52);
    expect(parseIsoWeek('2026-W53')).toBe('2026-12-28');
    expect(parseIsoWeek('2027-W53')).toBeNull();
  });
  it('rejects junk', () => {
    for (const w of ['2026-W00', '2026-W54', '2026W47', 'x', '2026-w47', '']) {
      expect(parseIsoWeek(w)).toBeNull();
    }
  });
  it('maps a date back to its week, across year ends', () => {
    expect(isoWeekOf('2026-11-16')).toBe('2026-W47');
    expect(isoWeekOf('2026-11-22')).toBe('2026-W47');
    expect(isoWeekOf('2027-01-03')).toBe('2026-W53');
    expect(isoWeekOf('2027-01-04')).toBe('2027-W01');
    expect(isoWeekOf('2025-12-29')).toBe('2026-W01');
  });
  it('adds weeks across years', () => {
    expect(addWeeks('2026-W53', 1)).toBe('2027-W01');
    expect(addWeeks('2027-W01', -1)).toBe('2026-W53');
    expect(addWeeks('2026-W47', -1)).toBe('2026-W46');
  });
  it('uses the Bucharest calendar for the current week', () => {
    // Sunday 23:30 UTC is already Monday 01:30 in Bucharest (UTC+2 in November).
    expect(currentIsoWeek(new Date('2026-11-22T23:30:00Z'))).toBe('2026-W48');
    expect(currentIsoWeek(new Date('2026-11-22T21:30:00Z'))).toBe('2026-W47');
  });
  it('compares fixed-width weeks', () => {
    expect(compareWeeks('2026-W46', '2026-W47')).toBe(-1);
    expect(compareWeeks('2027-W01', '2026-W53')).toBe(1);
    expect(compareWeeks('2026-W47', '2026-W47')).toBe(0);
  });
  it('labels a week', () => {
    expect(weekLabel('2026-W47')).toBe('Week 47 · 16–22 Nov 2026');
    expect(weekLabel('2026-W48')).toBe('Week 48 · 23–29 Nov 2026');
    expect(weekLabel('2026-W49')).toBe('Week 49 · 30 Nov–6 Dec 2026');
    expect(weekLabel('2026-W53')).toBe('Week 53 · 28 Dec 2026–3 Jan 2027');
  });
});
