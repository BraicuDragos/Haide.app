import { describe, expect, it } from 'vitest';
import { fixedClock } from './clock.ts';
import { DomainError } from './errors.ts';
import {
  addMinutes,
  bookingCutoffPassed,
  bookingExpiresAt,
  bucharestDayBounds,
  bucharestDayKey,
  bucharestLocalToUtc,
  bucharestOffsetMin,
  bucharestParts,
  bucharestTime,
  checkDeparture,
  contactWindowOpen,
  isLateCancel,
} from './time.ts';

const iso = (d: Date) => d.toISOString();

describe('Europe/Bucharest helpers', () => {
  it('uses +2 h in winter and +3 h in summer', () => {
    expect(bucharestOffsetMin(new Date('2026-11-16T12:00:00Z'))).toBe(120);
    expect(bucharestOffsetMin(new Date('2026-07-16T12:00:00Z'))).toBe(180);
  });

  it('computes the calendar day across midnight', () => {
    expect(bucharestDayKey(new Date('2026-11-16T21:59:00Z'))).toBe('2026-11-16');
    expect(bucharestDayKey(new Date('2026-11-16T22:00:00Z'))).toBe('2026-11-17');
    expect(bucharestTime(new Date('2026-11-16T05:30:00Z'))).toBe('07:30');
    expect(bucharestParts(new Date('2026-11-16T05:30:15Z')).second).toBe(15);
  });

  it('converts local date + time to UTC', () => {
    expect(iso(bucharestLocalToUtc('2026-11-16', '07:30'))).toBe('2026-11-16T05:30:00.000Z');
    expect(iso(bucharestLocalToUtc('2026-07-16', '07:30'))).toBe('2026-07-16T04:30:00.000Z');
  });

  it('handles DST transitions (2026-03-29 and 2026-10-25)', () => {
    // spring forward: 03:00 -> 04:00. 03:30 does not exist and resolves after the gap.
    expect(iso(bucharestLocalToUtc('2026-03-29', '02:30'))).toBe('2026-03-29T00:30:00.000Z');
    expect(iso(bucharestLocalToUtc('2026-03-29', '04:30'))).toBe('2026-03-29T01:30:00.000Z');
    // fall back day is 25 h long
    const fall = bucharestDayBounds('2026-10-25');
    expect((fall.endUtc.getTime() - fall.startUtc.getTime()) / 3_600_000).toBe(25);
    const spring = bucharestDayBounds('2026-03-29');
    expect((spring.endUtc.getTime() - spring.startUtc.getTime()) / 3_600_000).toBe(23);
    const normal = bucharestDayBounds('2026-11-16');
    expect(iso(normal.startUtc)).toBe('2026-11-15T22:00:00.000Z');
    expect(iso(normal.endUtc)).toBe('2026-11-16T22:00:00.000Z');
  });

  it('rejects malformed or impossible dates and times', () => {
    expect(() => bucharestLocalToUtc('16-11-2026', '07:30')).toThrow(DomainError);
    expect(() => bucharestLocalToUtc('2026-11-16', '7:30')).toThrow(DomainError);
    expect(() => bucharestLocalToUtc('2026-11-16', '24:00')).toThrow(DomainError);
    expect(() => bucharestLocalToUtc('2026-02-30', '07:30')).toThrow(/calendar/);
  });
});

describe('departure rules', () => {
  const now = fixedClock('2026-11-16T05:00:00Z');

  it('requires 15 min to 14 days ahead', () => {
    expect(checkDeparture(addMinutes(now.now(), 14), now)).toBe('DEPARTURE_TOO_SOON');
    expect(checkDeparture(addMinutes(now.now(), 15), now)).toBeNull();
    expect(checkDeparture(addMinutes(now.now(), 14 * 24 * 60), now)).toBeNull();
    expect(checkDeparture(addMinutes(now.now(), 14 * 24 * 60 + 1), now)).toBe('DEPARTURE_TOO_FAR');
    expect(checkDeparture(addMinutes(now.now(), -60), now)).toBe('DEPARTURE_TOO_SOON');
  });

  it('flags late cancellation within 30 min', () => {
    const dep = new Date('2026-11-16T06:00:00Z');
    expect(isLateCancel(dep, fixedClock('2026-11-16T05:29:00Z'))).toBe(false);
    expect(isLateCancel(dep, fixedClock('2026-11-16T05:30:00Z'))).toBe(true);
    expect(isLateCancel(dep, fixedClock('2026-11-16T05:59:00Z'))).toBe(true);
  });

  it('keeps contact data visible until departure + 24 h', () => {
    const dep = new Date('2026-11-16T06:00:00Z');
    expect(contactWindowOpen(dep, fixedClock('2026-11-17T05:59:59Z'))).toBe(true);
    expect(contactWindowOpen(dep, fixedClock('2026-11-17T06:00:00Z'))).toBe(false);
  });

  it('closes bookings 10 min before departure', () => {
    const dep = new Date('2026-11-16T06:00:00Z');
    expect(bookingCutoffPassed(dep, fixedClock('2026-11-16T05:50:00Z'))).toBe(false);
    expect(bookingCutoffPassed(dep, fixedClock('2026-11-16T05:50:01Z'))).toBe(true);
  });

  it('expires a request at least(requested + 30 min, departure - 10 min)', () => {
    const req = new Date('2026-11-16T05:00:00Z');
    expect(iso(bookingExpiresAt(req, new Date('2026-11-16T07:00:00Z')))).toBe(
      '2026-11-16T05:30:00.000Z',
    );
    expect(iso(bookingExpiresAt(req, new Date('2026-11-16T05:20:00Z')))).toBe(
      '2026-11-16T05:10:00.000Z',
    );
  });
});
