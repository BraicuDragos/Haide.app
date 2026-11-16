import { describe, expect, it } from 'vitest';
import { RIDE_LIMITS } from '../contracts/rides.ts';
import { fixedClock } from './clock.ts';
import type { DomainError } from './errors.ts';
import {
  MAX_LEAD_DAYS,
  MAX_RIDES_PER_DAY,
  MAX_ROUTE_M,
  MAX_SEATS,
  MIN_LEAD_MIN,
  MIN_ROUTE_M,
  ROUTE_PREVIEW_TTL_MIN,
} from './rules.ts';
import {
  assertDailyLimit,
  assertDeparture,
  assertPreviewPoints,
  canCancelRide,
  checkRouteLength,
  checkSeats,
  departureDayBounds,
  deriveLabel,
  isLateRideCancel,
  normalizeLabel,
  normalizeNote,
  previewExpiresAt,
  rideCancelledOutbox,
} from './rides.ts';

const NOW = '2026-11-16T05:00:00Z';
const clock = fixedClock(NOW);
const codeOf = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return null;
};

describe('contract limits agree with the domain constants', () => {
  it('RIDE_LIMITS mirrors rules.ts', () => {
    expect(RIDE_LIMITS).toMatchObject({
      minLeadMin: MIN_LEAD_MIN,
      maxLeadDays: MAX_LEAD_DAYS,
      minRouteM: MIN_ROUTE_M,
      maxRouteM: MAX_ROUTE_M,
      maxSeats: MAX_SEATS,
      maxRidesPerDay: MAX_RIDES_PER_DAY,
      previewTtlMin: ROUTE_PREVIEW_TTL_MIN,
    });
  });
});

describe('assertDeparture', () => {
  it('accepts exactly 15 min and exactly 14 days ahead', () => {
    expect(() => assertDeparture(new Date('2026-11-16T05:15:00Z'), clock)).not.toThrow();
    expect(() => assertDeparture(new Date('2026-11-30T05:00:00Z'), clock)).not.toThrow();
  });
  it('rejects too soon and too far', () => {
    expect(codeOf(() => assertDeparture(new Date('2026-11-16T05:14:59Z'), clock))).toBe(
      'DEPARTURE_TOO_SOON',
    );
    expect(codeOf(() => assertDeparture(new Date('2026-11-30T05:00:01Z'), clock))).toBe(
      'DEPARTURE_TOO_FAR',
    );
  });
});

describe('route length, seats, note', () => {
  it('1 to 40 km inclusive', () => {
    expect(() => checkRouteLength(1000)).not.toThrow();
    expect(() => checkRouteLength(40_000)).not.toThrow();
    expect(codeOf(() => checkRouteLength(999))).toBe('ROUTE_TOO_SHORT');
    expect(codeOf(() => checkRouteLength(40_001))).toBe('ROUTE_TOO_LONG');
  });

  it('seats cannot exceed the vehicle', () => {
    expect(() => checkSeats(3, 3)).not.toThrow();
    expect(codeOf(() => checkSeats(4, 3))).toBe('SEATS_EXCEED_VEHICLE');
  });

  it('normalises notes', () => {
    expect(normalizeNote(undefined)).toBeNull();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote('   ')).toBeNull();
    expect(normalizeNote('  Rucsac albastru pe bord  ')).toBe('Rucsac albastru pe bord');
    expect(normalizeNote('ș'.repeat(200))).toHaveLength(200);
    expect(codeOf(() => normalizeNote('x'.repeat(201)))).toBe('VALIDATION_FAILED');
  });
});

describe('daily limit', () => {
  it('allows up to 4 rides and rejects the 5th', () => {
    for (const n of [0, 1, 2, 3]) expect(() => assertDailyLimit(n)).not.toThrow();
    expect(codeOf(() => assertDailyLimit(4))).toBe('DAILY_RIDE_LIMIT');
    expect(codeOf(() => assertDailyLimit(9))).toBe('DAILY_RIDE_LIMIT');
  });

  it('the window is the Europe/Bucharest calendar day of the departure', () => {
    // 22:30 UTC on 16 Nov is 00:30 on 17 Nov in Bucharest (UTC+2).
    const { startUtc, endUtc } = departureDayBounds(new Date('2026-11-16T22:30:00Z'));
    expect(startUtc.toISOString()).toBe('2026-11-16T22:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-11-17T22:00:00.000Z');
  });

  it('copes with the 23 hour spring-forward day (29 Mar 2026)', () => {
    const { startUtc, endUtc } = departureDayBounds(new Date('2026-03-29T12:00:00Z'));
    expect(endUtc.getTime() - startUtc.getTime()).toBe(23 * 3_600_000);
  });
});

describe('preview expiry', () => {
  it('is 30 minutes', () => {
    expect(previewExpiresAt(new Date(NOW)).toISOString()).toBe('2026-11-16T05:30:00.000Z');
  });
});

describe('cancel rules', () => {
  const ride = (status: string, at: string) => ({ status, departureAt: new Date(at) });

  it('only a published ride that has not departed can be cancelled', () => {
    expect(canCancelRide(ride('published', '2026-11-16T07:00:00Z'), clock)).toBe(true);
    expect(canCancelRide(ride('cancelled', '2026-11-16T07:00:00Z'), clock)).toBe(false);
    expect(canCancelRide(ride('completed', '2026-11-16T07:00:00Z'), clock)).toBe(false);
    expect(canCancelRide(ride('published', '2026-11-16T04:59:00Z'), clock)).toBe(false);
  });

  it('within 30 minutes of departure is a late cancel', () => {
    expect(isLateRideCancel(ride('published', '2026-11-16T05:30:00Z'), clock)).toBe(true);
    expect(isLateRideCancel(ride('published', '2026-11-16T05:30:01Z'), clock)).toBe(false);
    expect(isLateRideCancel(ride('published', '2026-11-16T05:01:00Z'), clock)).toBe(true);
    // not cancellable at all: never "late"
    expect(isLateRideCancel(ride('cancelled', '2026-11-16T05:10:00Z'), clock)).toBe(false);
  });
});

describe('rideCancelledOutbox', () => {
  const payload = {
    rideId: 'r1',
    departureAt: '2026-11-16T05:30:00.000Z',
    originLabel: 'Șelimbăr',
    destinationLabel: 'Zona Industrială Vest',
    driverFirstName: 'Radu',
  };

  it('writes one row per distinct passenger and nothing for an empty ride', () => {
    expect(rideCancelledOutbox([], payload)).toEqual([]);
    const rows = rideCancelledOutbox(['p1', 'p2', 'p1'], payload);
    expect(rows.map((r) => r.userId)).toEqual(['p1', 'p2']);
    expect(rows.every((r) => r.template === 'ride_cancelled')).toBe(true);
  });

  it('carries labels and times only: no coordinates, phone or plate', () => {
    const [row] = rideCancelledOutbox(['p1'], payload);
    expect(Object.keys(row?.payload ?? {}).sort()).toEqual([
      'departureAt',
      'destinationLabel',
      'driverFirstName',
      'originLabel',
      'rideId',
    ]);
  });
});

describe('assertPreviewPoints', () => {
  const shoppingCity = { lat: 45.7413, lng: 24.1861 };
  const piataMare = { lat: 45.7977, lng: 24.1505 };

  it('accepts two distinct points inside the coverage box', () => {
    expect(() => assertPreviewPoints(shoppingCity, piataMare)).not.toThrow();
  });

  it('rejects points outside the coverage box with a field per point', () => {
    const bucharest = { lat: 44.4268, lng: 26.1025 };
    try {
      assertPreviewPoints(bucharest, bucharest);
      expect.unreachable();
    } catch (e) {
      expect((e as DomainError).code).toBe('VALIDATION_FAILED');
      expect((e as DomainError).fields).toEqual({
        origin: 'outside_coverage',
        destination: 'outside_coverage',
      });
    }
    expect(codeOf(() => assertPreviewPoints(shoppingCity, bucharest))).toBe('VALIDATION_FAILED');
  });

  it('rejects the same place (under 100 m apart) and accepts 150 m', () => {
    expect(codeOf(() => assertPreviewPoints(piataMare, piataMare))).toBe('SAME_PLACE');
    // ~55 m north
    expect(codeOf(() => assertPreviewPoints(piataMare, { ...piataMare, lat: 45.7982 }))).toBe(
      'SAME_PLACE',
    );
    // ~155 m north
    expect(() => assertPreviewPoints(piataMare, { ...piataMare, lat: 45.7991 })).not.toThrow();
  });
});

describe('labels', () => {
  it('normalises a driver-supplied label', () => {
    expect(normalizeLabel(undefined)).toBeNull();
    expect(normalizeLabel('   ')).toBeNull();
    expect(normalizeLabel('  Șelimbăr,   Shopping  City ')).toBe('Șelimbăr, Shopping City');
    expect(normalizeLabel('x'.repeat(120))).toHaveLength(80);
  });

  it('derives "<area>, <place>" and degrades gracefully', () => {
    expect(deriveLabel('Șelimbăr', 'Shopping City Sibiu')).toBe('Șelimbăr, Shopping City Sibiu');
    expect(deriveLabel('Hipodrom', null)).toBe('Hipodrom');
    expect(deriveLabel(null, 'Piața Mare')).toBe('Piața Mare');
    expect(deriveLabel(null, null)).toBe('Sibiu');
    expect(deriveLabel('A'.repeat(70), 'B'.repeat(70))).toHaveLength(80);
  });
});
