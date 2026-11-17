import { describe, expect, it } from 'vitest';
import { changePct, formatScaled, isLargeChange, parseScaled } from './energyChange';

describe('energyChange', () => {
  it('treats exactly 30 % as fine and 30.01 % as large, up and down', () => {
    expect(isLargeChange(10000, 13000)).toBe(false);
    expect(isLargeChange(10000, 13001)).toBe(true);
    expect(isLargeChange(10000, 7000)).toBe(false);
    expect(isLargeChange(10000, 6999)).toBe(true);
    expect(isLargeChange(10000, 12999)).toBe(false);
  });
  it('has nothing to compare without a previous value', () => {
    expect(isLargeChange(null, 5000)).toBe(false);
    expect(changePct(undefined, 5000)).toBeNull();
    expect(changePct(0, 5000)).toBeNull();
  });
  it('rounds the displayed change to 0.1 %', () => {
    expect(changePct(7000, 7700)).toBe(10);
    expect(changePct(10000, 13001)).toBe(30);
    expect(changePct(10000, 6000)).toBe(-40);
  });
  it('parses decimals without float error', () => {
    expect(parseScaled('7.234', 3)).toBe(7234);
    expect(parseScaled('7,2', 3)).toBe(7200);
    expect(parseScaled('0.1', 3)).toBe(100);
    expect(parseScaled('6.5', 2)).toBe(650);
    expect(parseScaled('6.555', 2)).toBeNull();
    expect(parseScaled('-1', 3)).toBeNull();
    expect(parseScaled('abc', 3)).toBeNull();
    expect(parseScaled('', 3)).toBeNull();
    expect(parseScaled('7.', 3)).toBe(7000);
  });
  it('formats scaled integers', () => {
    expect(formatScaled(7234, 3)).toBe('7.234');
    expect(formatScaled(100, 3)).toBe('0.100');
    expect(formatScaled(650, 2)).toBe('6.50');
  });
});
