import {
  COARSEN_GRID_M,
  COORD_DECIMALS,
  COVERAGE_BBOX,
  PUBLIC_GRID_M,
  WALK_ROUND_M,
} from './rules.ts';

/**
 * Privacy rounding helpers. Each one is mirrored in SQL (app.grid_point, round(x, 5)) and the
 * two implementations must agree (ADR 0005, data-model §7).
 */

export type Point = { lat: number; lng: number };
export type ApproxPoint = Point & { approx: true; radiusM: 300 };

/** Exact coordinates: 5 decimals (about 1 m). SQL: round(x::numeric, 5). */
export function roundCoord(value: number): number {
  const f = 10 ** COORD_DECIMALS;
  return Math.round(value * f) / f + 0; // + 0 turns -0 into 0
}

export function roundPoint(p: Point): Point {
  return { lat: roundCoord(p.lat), lng: roundCoord(p.lng) };
}

/** Walk distances are shown rounded to 50 m. */
export function roundWalkM(metres: number): number {
  return Math.round(metres / WALK_ROUND_M) * WALK_ROUND_M;
}

// --- UTM zone 35N (EPSG:32635), Kruger series, WGS84 ---------------------------------------

const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const E0 = 500000;
const LON0_DEG = 27; // central meridian of zone 35
const N = F / (2 - F);
const N2 = N * N;
const N3 = N2 * N;
const N4 = N3 * N;
const RECT_A = (A / (1 + N)) * (1 + N2 / 4 + N4 / 64);
const ALPHA = [
  N / 2 - (2 * N2) / 3 + (5 * N3) / 16 + (41 * N4) / 180,
  (13 * N2) / 48 - (3 * N3) / 5 + (557 * N4) / 1440,
  (61 * N3) / 240 - (103 * N4) / 140,
  (49561 * N4) / 161280,
] as const;
const BETA = [
  N / 2 - (2 * N2) / 3 + (37 * N3) / 96 - N4 / 360,
  N2 / 48 + N3 / 15 - (437 * N4) / 1440,
  (17 * N3) / 480 - (37 * N4) / 840,
  (4397 * N4) / 161280,
] as const;
const DELTA = [
  2 * N - (2 * N2) / 3 - 2 * N3 + (116 * N4) / 45,
  (7 * N2) / 3 - (8 * N3) / 5 - (227 * N4) / 45,
  (56 * N3) / 15 - (136 * N4) / 35,
  (4279 * N4) / 630,
] as const;

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** WGS84 lat/lng to UTM 35N easting/northing in metres. */
export function toUtm35(p: Point): { x: number; y: number } {
  const phi = rad(p.lat);
  const lam = rad(p.lng - LON0_DEG);
  const c = (2 * Math.sqrt(N)) / (1 + N);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
  const xi0 = Math.atan2(t, Math.cos(lam));
  const eta0 = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let xi = xi0;
  let eta = eta0;
  ALPHA.forEach((a, i) => {
    const j = 2 * (i + 1);
    xi += a * Math.sin(j * xi0) * Math.cosh(j * eta0);
    eta += a * Math.cos(j * xi0) * Math.sinh(j * eta0);
  });
  return { x: E0 + K0 * RECT_A * eta, y: K0 * RECT_A * xi };
}

/** UTM 35N easting/northing (metres) to WGS84 lat/lng. */
export function fromUtm35(u: { x: number; y: number }): Point {
  const xi = u.y / (K0 * RECT_A);
  const eta = (u.x - E0) / (K0 * RECT_A);
  let xi0 = xi;
  let eta0 = eta;
  BETA.forEach((b, i) => {
    const j = 2 * (i + 1);
    xi0 -= b * Math.sin(j * xi) * Math.cosh(j * eta);
    eta0 -= b * Math.cos(j * xi) * Math.sinh(j * eta);
  });
  const chi = Math.asin(Math.sin(xi0) / Math.cosh(eta0));
  let phi = chi;
  DELTA.forEach((d, i) => {
    phi += d * Math.sin(2 * (i + 1) * chi);
  });
  const lam = Math.atan2(Math.sinh(eta0), Math.cos(xi0));
  return { lat: deg(phi), lng: LON0_DEG + deg(lam) };
}

/**
 * Centre of the grid cell (in UTM 35N metres) containing the point, back in WGS84 with 5 decimals.
 * SQL mirror: app.grid_point(p, cell_m).
 */
export function gridPoint(p: Point, cellM: number): Point {
  const u = toUtm35(p);
  const centre = {
    x: (Math.floor(u.x / cellM) + 0.5) * cellM,
    y: (Math.floor(u.y / cellM) + 0.5) * cellM,
  };
  return roundPoint(fromUtm35(centre));
}

/** Public/approximate point: 300 m grid centre. */
export function toApproxPoint(p: Point): ApproxPoint {
  return { ...gridPoint(p, PUBLIC_GRID_M), approx: true, radiusM: 300 };
}

/** Retention coarsening: 1 km grid centroid (data-model §6). */
export function coarsenPoint(p: Point): Point {
  return gridPoint(p, COARSEN_GRID_M);
}

/** True if the point is inside the Sibiu coverage bbox. */
export function inCoverage(p: Point): boolean {
  return (
    p.lat >= COVERAGE_BBOX.south &&
    p.lat <= COVERAGE_BBOX.north &&
    p.lng >= COVERAGE_BBOX.west &&
    p.lng <= COVERAGE_BBOX.east
  );
}
