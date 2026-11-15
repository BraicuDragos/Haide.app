import { describe, expect, it } from 'vitest';
import {
  coarsenPoint,
  fromUtm35,
  gridPoint,
  inCoverage,
  roundCoord,
  roundPoint,
  roundWalkM,
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
