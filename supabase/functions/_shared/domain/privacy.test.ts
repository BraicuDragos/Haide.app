import { describe, expect, it } from 'vitest';
import { PURGE_BACKOFF_MIN } from './rules.ts';
import {
  coarsenPoint,
  dataExportAckOutbox,
  dataExportRequestedOutbox,
  dataRequestDueBy,
  fromUtm35,
  gridPoint,
  inCoverage,
  isDataRequestOpen,
  isPurgeOverdue,
  nextPurgeAttemptAt,
  purgeBackoffMinutes,
  roundCoord,
  roundPoint,
  roundWalkM,
  statementHasContactDetails,
  toApproxPoint,
  toUtm35,
} from './privacy.ts';

const SIBIU = { lat: 45.79712, lng: 24.15211 };

describe('rounding', () => {
  it('rounds coordinates to 5 decimals', () => {
    expect(roundCoord(45.797123456)).toBe(45.79712);
    expect(roundPoint({ lat: 24.1521149, lng: -0.000004 })).toEqual({ lat: 24.15211, lng: 0 });
  });

  it('rounds walking distances to 50 m', () => {
    expect(roundWalkM(0)).toBe(0);
    expect(roundWalkM(24)).toBe(0);
    expect(roundWalkM(26)).toBe(50);
    expect(roundWalkM(149)).toBe(150);
    expect(roundWalkM(775)).toBe(800);
  });
});

describe('UTM 35N', () => {
  it('maps the central meridian at the equator to the false easting', () => {
    const u = toUtm35({ lat: 0, lng: 27 });
    expect(u.x).toBeCloseTo(500000, 3);
    expect(u.y).toBeCloseTo(0, 3);
  });

  it('has the right scale: 1 degree of longitude at Sibiu is about 77.7 km', () => {
    const a = toUtm35({ lat: 45.8, lng: 24 });
    const b = toUtm35({ lat: 45.8, lng: 25 });
    expect(Math.abs(b.x - a.x)).toBeGreaterThan(77_000);
    expect(Math.abs(b.x - a.x)).toBeLessThan(78_500);
  });

  it('round-trips within a millimetre', () => {
    const back = fromUtm35(toUtm35(SIBIU));
    expect(back.lat).toBeCloseTo(SIBIU.lat, 9);
    expect(back.lng).toBeCloseTo(SIBIU.lng, 9);
  });

  it('places Sibiu west of the central meridian and north of the equator', () => {
    const u = toUtm35(SIBIU);
    expect(u.x).toBeLessThan(500000);
    expect(u.y).toBeGreaterThan(5_000_000);
  });
});

describe('grid points', () => {
  it('snaps to the centre of a 300 m cell and is deterministic', () => {
    const g1 = gridPoint(SIBIU, 300);
    const g2 = gridPoint({ lat: SIBIU.lat + 0.00001, lng: SIBIU.lng + 0.00001 }, 300);
    expect(g1).toEqual(g2);
  });

  it('keeps the snapped point within about half a cell diagonal', () => {
    const g = gridPoint(SIBIU, 300);
    const a = toUtm35(SIBIU);
    const b = toUtm35(g);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(300 * Math.SQRT1_2 + 1);
  });

  it('marks approximate points with a 300 m radius', () => {
    const p = toApproxPoint(SIBIU);
    expect(p.approx).toBe(true);
    expect(p.radiusM).toBe(300);
    expect(p).toMatchObject(gridPoint(SIBIU, 300));
  });

  it('coarsens to a 1 km grid', () => {
    const c = coarsenPoint(SIBIU);
    const u = toUtm35(c);
    expect(((u.x / 500) % 2) - 1).toBeCloseTo(0, 1); // cell centres sit at k * 1000 + 500
    expect(c).toEqual(gridPoint(SIBIU, 1000));
  });
});

describe('inCoverage', () => {
  it('accepts Sibiu and rejects far away points', () => {
    expect(inCoverage(SIBIU)).toBe(true);
    expect(inCoverage({ lat: 44.4268, lng: 26.1025 })).toBe(false); // Bucharest
    expect(inCoverage({ lat: 45.79, lng: 24.4 })).toBe(false);
    expect(inCoverage({ lat: 45.9, lng: 24.15 })).toBe(false);
    expect(inCoverage({ lat: 45.7, lng: 23.9 })).toBe(false);
  });
});

describe('account deletion and data requests (E6)', () => {
  const T = new Date('2026-11-16T05:00:00Z');
  const minutes = (d: Date) => (d.getTime() - T.getTime()) / 60_000;

  it('purge backoff: 1 min, 5 min, 30 min, 2 h, 12 h, then daily', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 50].map(purgeBackoffMinutes)).toEqual([
      1, 5, 30, 120, 720, 1440, 1440, 1440,
    ]);
    expect(PURGE_BACKOFF_MIN).toEqual([1, 5, 30, 120, 720, 1440]);
    expect(minutes(nextPurgeAttemptAt(T, 3))).toBe(30);
  });

  it('purge backoff treats 0 or a negative count as the first failure', () => {
    expect(purgeBackoffMinutes(0)).toBe(1);
    expect(purgeBackoffMinutes(-4)).toBe(1);
  });

  it('a deletion is overdue after 7 days, not at 7', () => {
    const at = (days: number, extraMs = 0) => new Date(T.getTime() - days * 86_400_000 - extraMs);
    expect(isPurgeOverdue(at(6), T)).toBe(false);
    expect(isPurgeOverdue(at(7), T)).toBe(false);
    expect(isPurgeOverdue(at(7, 1), T)).toBe(true);
  });

  it('a data request is due 30 days after it was made', () => {
    expect(dataRequestDueBy(T).toISOString()).toBe('2026-12-16T05:00:00.000Z');
  });

  it('an unfulfilled request younger than 30 days is open, anything else is not', () => {
    const ago = (days: number) => new Date(T.getTime() - days * 86_400_000);
    expect(isDataRequestOpen({ requestedAt: ago(29), fulfilledAt: null }, T)).toBe(true);
    expect(isDataRequestOpen({ requestedAt: ago(30), fulfilledAt: null }, T)).toBe(false);
    expect(isDataRequestOpen({ requestedAt: ago(1), fulfilledAt: ago(0) }, T)).toBe(false);
  });

  it('the outbox rows carry ids and times only, and refuse an email, phone or plate', () => {
    const row = dataExportRequestedOutbox('u1', {
      requestId: 'r1',
      userId: 'u1',
      requestedAt: '2026-11-16T05:00:00.000Z',
    });
    expect(row).toMatchObject({ userId: 'u1', template: 'data_export_requested' });
    expect(
      dataExportAckOutbox('u1', { requestId: 'r1', dueBy: '2026-12-16T05:00:00.000Z' }).template,
    ).toBe('data_export_ack');
    expect(() =>
      dataExportRequestedOutbox('u1', { requestId: 'r1', userId: 'a@b.ro', requestedAt: 'x' }),
    ).toThrow();
    expect(() => dataExportAckOutbox('u1', { requestId: '+40721234567', dueBy: 'x' })).toThrow();
  });
});

describe('statementHasContactDetails (E7 suspension statement)', () => {
  it.each([
    'Call him on +40731111222.',
    'Call him on 0721 234 567 to settle it.',
    'Call him on 0721.234.567 to settle it.',
    'Reach him at +40 721-234-567 please.',
    'Write to radu@example.com about the rules.',
    'The car SB 12 ABC was parked there.',
    'He shared 45.79712 and 24.15211 with a passenger.',
  ])('rejects %s', (text) => {
    expect(statementHasContactDetails(text)).toBe(true);
  });

  it.each([
    'You sent repeated unwanted messages after a passenger asked you to stop.',
    'Three no-shows between 3 and 17 November 2026 in a row, and a reply of 1 to 2 words.',
    'Rides on 2026-11-17 and 2026-11-18 were reported.',
  ])('accepts %s', (text) => {
    expect(statementHasContactDetails(text)).toBe(false);
  });
});
