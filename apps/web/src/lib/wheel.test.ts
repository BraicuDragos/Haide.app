import { describe, expect, it } from 'vitest';
import {
  firstEnabled,
  indexFromScroll,
  lastEnabled,
  nearestEnabled,
  nearestSlotIndex,
  scrollForIndex,
  stepEnabled,
  typeAheadMatch,
  type WheelItem,
} from './wheel';

const row = (label: string, disabled = false): WheelItem => ({ value: label, label, disabled });
// 00..09, the first four are in the past
const hours: WheelItem[] = Array.from({ length: 10 }, (_, i) => row(`0${i}`, i < 4));

describe('wheel maths', () => {
  it('maps a scroll offset to the row under the band, clamped to the list', () => {
    expect(indexFromScroll(0, 10)).toBe(0);
    expect(indexFromScroll(47, 10)).toBe(1);
    expect(indexFromScroll(71, 10)).toBe(1);
    expect(indexFromScroll(73, 10)).toBe(2);
    expect(indexFromScroll(9999, 10)).toBe(9);
    expect(indexFromScroll(-30, 10)).toBe(0);
    expect(indexFromScroll(10, 0)).toBe(0);
    expect(scrollForIndex(3)).toBe(144);
  });

  it('snaps a disabled row to the nearest enabled one, a tie goes later', () => {
    expect(nearestEnabled(hours, 0)).toBe(4);
    expect(nearestEnabled(hours, 3)).toBe(4);
    expect(nearestEnabled(hours, 7)).toBe(7);
    const gap = [row('a'), row('b', true), row('c', true), row('d')];
    expect(nearestEnabled(gap, 1)).toBe(0);
    expect(nearestEnabled(gap, 2)).toBe(3);
    const mid = [row('a'), row('b', true), row('c')];
    expect(nearestEnabled(mid, 1)).toBe(2);
    expect(nearestEnabled([row('x', true)], 0)).toBe(-1);
    expect(nearestEnabled([], 0)).toBe(-1);
  });

  it('steps over disabled rows and stops at the ends', () => {
    expect(stepEnabled(hours, 4, -1)).toBe(4);
    expect(stepEnabled(hours, 4, 1)).toBe(5);
    expect(stepEnabled(hours, 5, -5)).toBe(4);
    expect(stepEnabled(hours, 6, 5)).toBe(9);
    const gap = [row('a'), row('b', true), row('c')];
    expect(stepEnabled(gap, 0, 1)).toBe(2);
    expect(stepEnabled(gap, 2, -1)).toBe(0);
  });

  it('finds the first and last enabled row', () => {
    expect(firstEnabled(hours)).toBe(4);
    expect(lastEnabled(hours)).toBe(9);
    expect(lastEnabled([row('x', true)])).toBe(-1);
  });

  it('type-ahead matches by label prefix and skips disabled rows', () => {
    expect(typeAheadMatch(hours, '07')).toBe(7);
    expect(typeAheadMatch(hours, '0')).toBe(4); // 00..03 are disabled
    expect(typeAheadMatch(hours, '03')).toBe(-1);
    expect(typeAheadMatch(hours, '')).toBe(-1);
    const days = [row('Today'), row('Tomorrow'), row('Mon 24 Nov')];
    expect(typeAheadMatch(days, 'tom')).toBe(1);
    expect(typeAheadMatch(days, 'mon')).toBe(2);
  });

  it('puts an off-grid minute on the nearest slot', () => {
    expect(nearestSlotIndex(32, 5, 12)).toBe(6); // :30
    expect(nearestSlotIndex(33, 5, 12)).toBe(7); // :35
    expect(nearestSlotIndex(59, 5, 12)).toBe(11);
    expect(nearestSlotIndex(0, 5, 12)).toBe(0);
  });
});
