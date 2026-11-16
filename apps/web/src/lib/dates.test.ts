import { describe, expect, it } from 'vitest';
import { bucharestToIso, dayLabel } from './dates';

describe('bucharestToIso', () => {
  it('uses +02:00 in winter', () => {
    expect(bucharestToIso('2026-11-16', '07:30')).toBe('2026-11-16T05:30:00.000Z');
  });
  it('uses +03:00 in summer', () => {
    expect(bucharestToIso('2026-07-01', '07:30')).toBe('2026-07-01T04:30:00.000Z');
  });
  it('handles the spring-forward day (2026-03-29)', () => {
    expect(bucharestToIso('2026-03-29', '01:00')).toBe('2026-03-28T23:00:00.000Z');
    expect(bucharestToIso('2026-03-29', '12:00')).toBe('2026-03-29T09:00:00.000Z');
  });
});

describe('dayLabel', () => {
  const now = new Date('2026-11-15T10:00:00Z');
  it('names today and tomorrow', () => {
    expect(dayLabel('2026-11-15T16:00:00Z', now)).toBe('Today');
    expect(dayLabel('2026-11-16T05:30:00Z', now)).toBe('Tomorrow');
  });
  it('dates later days in Bucharest time', () => {
    expect(dayLabel('2026-11-18T05:30:00Z', now)).toMatch(/Wed.*18.*Nov/);
    // 23:30 UTC on the 15th is already the 16th in Bucharest
    expect(dayLabel('2026-11-15T23:30:00Z', now)).toBe('Tomorrow');
  });
});
