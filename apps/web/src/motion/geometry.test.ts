import { describe, expect, it } from 'vitest';
import {
  clamp,
  heroScene,
  LAYER_BLEED,
  PARALLAX_MAX,
  parallaxOffset,
  rng,
  ROAD_GRID,
  roadLayout,
  roundedPath,
} from './geometry';

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

describe('parallaxOffset', () => {
  it('moves against the input and scales with depth', () => {
    expect(parallaxOffset(1, 0, 1).x).toBeCloseTo(-PARALLAX_MAX);
    expect(parallaxOffset(-1, 0, 2).x).toBeCloseTo(2 * PARALLAX_MAX);
    expect(Math.abs(parallaxOffset(0.5, 0, 0.4).x)).toBeLessThan(
      Math.abs(parallaxOffset(0.5, 0, 2).x),
    );
  });
  it('clamps wild input and stays inside the layer bleed at the deepest layer', () => {
    const o = parallaxOffset(99, -99, 2);
    expect(Math.abs(o.x)).toBeLessThanOrEqual(LAYER_BLEED);
    expect(Math.abs(o.y)).toBeLessThanOrEqual(LAYER_BLEED);
    expect(clamp(5, -1, 1)).toBe(1);
  });
  it('rests at zero', () => {
    expect(Math.abs(parallaxOffset(0, 0, 2).x)).toBe(0);
    expect(Math.abs(parallaxOffset(0, 0, 2).y)).toBe(0);
  });
});

describe('heroScene', () => {
  it('is deterministic (same box, same scene) and varies with the box', () => {
    expect(heroScene(360, 330)).toEqual(heroScene(360, 330));
    expect(heroScene(360, 330).grid).not.toBe(heroScene(1280, 330).grid);
    const a = rng(7);
    const b = rng(7);
    expect([a(), a()]).toEqual([b(), b()]);
  });
  it.each([
    [360, 330],
    [1280, 330],
  ])('keeps lights and bokeh inside the %i x %i box and clear of the headline', (w, h) => {
    const s = heroScene(w, h);
    for (const p of [...s.lights[0], ...s.lights[1], ...s.bokeh]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(w);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(h);
      // the headline sits top left: nothing there but the grid
      expect(p.x < w * 0.4 && p.y < h * 0.4).toBe(false);
    }
    expect(s.lights[0].length + s.lights[1].length).toBeGreaterThan(8);
  });
  it('has traffic lanes on the road layout', () => {
    expect(roadLayout(360, 330).lanes).toHaveLength(2);
  });
});
