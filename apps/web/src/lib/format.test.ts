import { describe, expect, it } from 'vitest';
import { formatRon, formatTime, formatWalk } from './format';

describe('formatRon', () => {
  it('formats bani as RON with two decimals', () => {
    expect(formatRon(390)).toBe('3.90 RON');
    expect(formatRon(5)).toBe('0.05 RON');
    expect(formatRon(0)).toBe('0.00 RON');
    expect(formatRon(12345)).toBe('123.45 RON');
  });
  it('rejects floats', () => {
    expect(() => formatRon(3.9)).toThrow(RangeError);
  });
});

describe('formatTime', () => {
  it('uses Europe/Bucharest, 24 h (winter UTC+2)', () => {
    expect(formatTime('2026-11-16T05:30:00Z')).toBe('07:30');
  });
  it('handles summer time (UTC+3)', () => {
    expect(formatTime('2026-07-16T05:30:00Z')).toBe('08:30');
  });
  it('pads midnight', () => {
    expect(formatTime('2026-11-15T22:05:00Z')).toBe('00:05');
  });
});

describe('formatWalk', () => {
  it('formats metres and kilometres', () => {
    expect(formatWalk(150)).toBe('150 m');
    expect(formatWalk(1000)).toBe('1 km');
    expect(formatWalk(1250)).toBe('1.3 km');
  });
});
