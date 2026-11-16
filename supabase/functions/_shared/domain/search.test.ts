import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fixedClock } from './clock.ts';
import { DomainError } from './errors.ts';
import {
  assertInCoverage,
  assertSearchPoints,
  notBookableReason,
  roundEta,
  searchTimes,
  type MatchRideState,
} from './search.ts';

const SHOPPING_CITY = { lat: 45.7413, lng: 24.1861 };
const ZI_VEST = { lat: 45.785, lng: 24.09 };
const clock = fixedClock('2026-11-16T05:00:00Z');

const thrown = (fn: () => void): DomainError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error('expected a DomainError');
};

describe('assertSearchPoints', () => {
  it('accepts two points in Sibiu at least 1 km apart', () => {
    expect(() => assertSearchPoints(SHOPPING_CITY, ZI_VEST)).not.toThrow();
  });

  it('names every point outside the coverage box, before checking the distance', () => {
    const e = thrown(() => assertSearchPoints({ lat: 46.5, lng: 24.1 }, { lat: 45.75, lng: 25.5 }));
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.fields).toEqual({ from: 'outside_coverage', to: 'outside_coverage' });
    expect(thrown(() => assertInCoverage(SHOPPING_CITY, { lat: 0, lng: 0 })).fields).toEqual({
      to: 'outside_coverage',
    });
  });

  it('rejects points closer than 1 km, accepts about 1.1 km', () => {
    const tooNear = { lat: SHOPPING_CITY.lat + 0.008, lng: SHOPPING_CITY.lng }; // about 890 m
    const ok = { lat: SHOPPING_CITY.lat + 0.01, lng: SHOPPING_CITY.lng }; // about 1110 m
    const e = thrown(() => assertSearchPoints(SHOPPING_CITY, tooNear));
    expect(e).toMatchObject({ code: 'SAME_PLACE', fields: { to: 'too_close' } });
    expect(() => assertSearchPoints(SHOPPING_CITY, ok)).not.toThrow();
    expect(thrown(() => assertSearchPoints(SHOPPING_CITY, SHOPPING_CITY)).code).toBe('SAME_PLACE');
  });
});

describe('searchTimes', () => {
  it('reads date and time in Europe/Bucharest (winter UTC+2) and builds the window', () => {
    const t = searchTimes('2026-11-16', '07:30', 30, clock);
    expect(t.desiredAt.toISOString()).toBe('2026-11-16T05:30:00.000Z');
    expect(t.fromAt.toISOString()).toBe('2026-11-16T05:00:00.000Z');
    expect(t.toAt.toISOString()).toBe('2026-11-16T06:00:00.000Z');
    // the Bucharest calendar day, end inclusive
    expect(t.dayStartAt.toISOString()).toBe('2026-11-15T22:00:00.000Z');
    expect(t.dayEndAt.toISOString()).toBe('2026-11-16T21:59:59.999Z');
  });

  it('uses summer time (UTC+3) in July', () => {
    const summer = fixedClock('2027-07-01T05:00:00Z');
    const t = searchTimes('2027-07-01', '07:30', 15, summer);
    expect(t.desiredAt.toISOString()).toBe('2027-07-01T04:30:00.000Z');
    expect(t.fromAt.toISOString()).toBe('2027-07-01T04:15:00.000Z');
    expect(t.dayStartAt.toISOString()).toBe('2027-06-30T21:00:00.000Z');
  });

  it('a window of 60 minutes spans 2 hours', () => {
    const t = searchTimes('2026-11-16', '07:30', 60, clock);
    expect(t.toAt.getTime() - t.fromAt.getTime()).toBe(2 * 3_600_000);
  });

  it('accepts yesterday and 30 days ahead, rejects anything else', () => {
    expect(() => searchTimes('2026-11-15', '07:30', 30, clock)).not.toThrow();
    expect(() => searchTimes('2026-12-16', '07:30', 30, clock)).not.toThrow();
    for (const bad of ['2026-11-14', '2026-12-17', '1999-01-01', '9999-12-31']) {
      const e = thrown(() => searchTimes(bad, '07:30', 30, clock));
      expect(e).toMatchObject({ code: 'VALIDATION_FAILED', fields: { date: 'out_of_range' } });
    }
  });

  it('rejects an impossible calendar date', () => {
    const feb = fixedClock('2026-02-10T05:00:00Z');
    expect(thrown(() => searchTimes('2026-02-30', '07:30', 30, feb)).code).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('roundEta', () => {
  it('rounds to the nearest 5 minutes', () => {
    const r = (iso: string) => roundEta(new Date(iso)).toISOString();
    expect(r('2026-11-16T05:27:29Z')).toBe('2026-11-16T05:25:00.000Z');
    expect(r('2026-11-16T05:27:31Z')).toBe('2026-11-16T05:30:00.000Z');
    expect(r('2026-11-16T05:30:00Z')).toBe('2026-11-16T05:30:00.000Z');
    expect(r('2026-11-16T05:57:31Z')).toBe('2026-11-16T06:00:00.000Z');
  });

  it('always lands on a 5 minute mark within 2.5 minutes of the input', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 }), (ms) => {
        const out = roundEta(new Date(ms)).getTime();
        expect(out % 300_000).toBe(0);
        expect(Math.abs(out - ms)).toBeLessThanOrEqual(150_000);
      }),
    );
  });
});

describe('notBookableReason', () => {
  const ride = (over: Partial<MatchRideState> = {}): MatchRideState => ({
    driverId: 'driver',
    status: 'published',
    departureAt: new Date('2026-11-16T07:00:00Z'),
    seatsOffered: 3,
    seatsBooked: 1,
    ...over,
  });

  it('is null for a bookable ride, signed in or out', () => {
    expect(notBookableReason(ride(), 'me', clock, true)).toBeNull();
    expect(notBookableReason(ride(), null, clock, true)).toBeNull();
  });

  it('an active or rejected booking of the viewer is ALREADY_REQUESTED, right after OWN_RIDE', () => {
    expect(notBookableReason(ride(), 'me', clock, true, true)).toBe('ALREADY_REQUESTED');
    // it wins over a full or no longer bookable ride and over non-matching points
    expect(notBookableReason(ride({ seatsBooked: 3 }), 'me', clock, false, true)).toBe(
      'ALREADY_REQUESTED',
    );
    expect(notBookableReason(ride({ status: 'cancelled' }), 'me', clock, true, true)).toBe(
      'ALREADY_REQUESTED',
    );
    // own ride still comes first
    expect(notBookableReason(ride(), 'driver', clock, true, true)).toBe('OWN_RIDE');
  });

  it('own ride comes first, whatever else is true', () => {
    const r = ride({ status: 'cancelled', seatsBooked: 3 });
    expect(notBookableReason(r, 'driver', clock, false)).toBe('OWN_RIDE');
  });

  it('a ride that is not published is not bookable', () => {
    for (const status of ['cancelled', 'completed', 'expired']) {
      expect(notBookableReason(ride({ status }), 'me', clock, true)).toBe('RIDE_NOT_BOOKABLE');
    }
  });

  it('requests close 10 minutes before departure', () => {
    const dep = (min: number) => new Date(clock.now().getTime() + min * 60_000);
    expect(notBookableReason(ride({ departureAt: dep(11) }), 'me', clock, true)).toBeNull();
    expect(notBookableReason(ride({ departureAt: dep(10) }), 'me', clock, true)).toBeNull();
    expect(notBookableReason(ride({ departureAt: dep(9) }), 'me', clock, true)).toBe(
      'RIDE_NOT_BOOKABLE',
    );
    expect(notBookableReason(ride({ departureAt: dep(-5) }), 'me', clock, true)).toBe(
      'RIDE_NOT_BOOKABLE',
    );
  });

  it('not bookable beats full, full beats "no longer matches"', () => {
    expect(notBookableReason(ride({ seatsBooked: 3 }), 'me', clock, true)).toBe('RIDE_FULL');
    expect(notBookableReason(ride({ seatsBooked: 3 }), 'me', clock, false)).toBe('RIDE_FULL');
    expect(
      notBookableReason(ride({ seatsBooked: 3, status: 'cancelled' }), 'me', clock, true),
    ).toBe('RIDE_NOT_BOOKABLE');
    expect(notBookableReason(ride(), 'me', clock, false)).toBe('NO_LONGER_MATCHES');
  });
});
