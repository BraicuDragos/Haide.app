import { describe, expect, it } from 'vitest';
import { ROAD_GRID, roadLayout, roundedPath } from './geometry';

const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const points = (d: string) => {
  const n = nums(d);
  return Array.from({ length: n.length / 2 }, (_, i) => ({ x: n[2 * i]!, y: n[2 * i + 1]! }));
};

describe('roundedPath', () => {
  it('rounds interior corners with a quadratic turn and keeps the ends', () => {
    const d = roundedPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      10,
    );
    expect(d).toBe('M0.0 0.0L90.0 0.0Q100.0 0.0 100.0 10.0L100.0 100.0');
  });
  it('clamps the radius to half of a short run', () => {
    const d = roundedPath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 100 },
      ],
      50,
    );
    expect(d).toContain('L5.0 0.0Q10.0 0.0 10.0 5.0');
  });
  it('is empty without points', () => {
    expect(roundedPath([], 5)).toBe('');
  });
});

describe('roadLayout', () => {
  const sizes: Array<[number, number]> = [
    [360, 330],
    [430, 330],
    [1280, 330],
  ];

  it.each(sizes)('keeps the route inside the %i x %i box', (w, h) => {
    const r = roadLayout(w, h);
    for (const pt of points(r.route)) {
      expect(pt.x).toBeGreaterThanOrEqual(0);
      expect(pt.x).toBeLessThanOrEqual(w);
      expect(pt.y).toBeGreaterThanOrEqual(0);
      expect(pt.y).toBeLessThanOrEqual(h);
    }
    expect(r.start.x).toBeLessThan(r.end.x);
    expect(r.route.startsWith(`M${r.start.x.toFixed(1)} ${r.start.y.toFixed(1)}`)).toBe(true);
    expect(r.route.endsWith(`L${r.end.x.toFixed(1)} ${r.end.y.toFixed(1)}`)).toBe(true);
  });

  it('keeps the route clear of the headline area and the form card', () => {
    const r = roadLayout(360, 330);
    for (const pt of points(r.route)) {
      expect(pt.y).toBeGreaterThanOrEqual(330 * 0.4);
      expect(pt.y).toBeLessThanOrEqual(330 * 0.82);
    }
  });

  it('uses one uniform scale: grid proportions survive', () => {
    const r = roadLayout(1280, 330);
    const dx = r.end.x - r.start.x;
    const dy = r.start.y - r.end.y; // pickup 100 and drop-off 62 on the grid
    expect(dx / r.scale).toBeCloseTo(312 - 8, 1);
    expect(dy / r.scale).toBeCloseTo(100 - 62, 0);
    expect(ROAD_GRID.w * r.scale).toBeLessThanOrEqual(1280 * 0.9 + 0.001);
    expect(ROAD_GRID.h * r.scale).toBeLessThanOrEqual(330 * 0.42 + 0.001);
  });

  it('is centred in the free area', () => {
    const r = roadLayout(1280, 330);
    expect((r.start.x + r.end.x) / 2).toBeCloseTo(640, 0);
  });

  it('is deterministic and draws side streets', () => {
    expect(roadLayout(360, 330)).toEqual(roadLayout(360, 330));
    expect(roadLayout(360, 330).streets.length).toBeGreaterThan(5);
  });
});
