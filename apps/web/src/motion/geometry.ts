import type { Pt } from './core';

const f = (n: number) => n.toFixed(1);

/** Gentle S-curve between two points (used when a ride has no route geometry, and on the plain background). */
export function curvePath(a: Pt, b: Pt): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const c1 = horizontal ? { x: a.x + dx * 0.55, y: a.y } : { x: a.x, y: a.y + dy * 0.55 };
  const c2 = horizontal ? { x: b.x - dx * 0.55, y: b.y } : { x: b.x, y: b.y - dy * 0.55 };
  return `M${f(a.x)} ${f(a.y)}C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`;
}

/** Smooth path through projected route points (Catmull-Rom to cubic Bezier). */
export function smoothPath(pts: Pt[]): string {
  const first = pts[0];
  if (!first) return '';
  if (pts.length < 3) return curvePath(first, pts[pts.length - 1] ?? first);
  let d = `M${f(first.x)} ${f(first.y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/** Plain-background layout: pickup low left, drop-off high right, in a w x h box. */
export function plainEndpoints(w: number, h: number): { start: Pt; end: Pt } {
  return { start: { x: w * 0.16, y: h * 0.74 }, end: { x: w * 0.84, y: h * 0.26 } };
}

/** A few quiet street lines for the plain background (decoration only, in the map-road role). */
export function plainStreets(w: number, h: number): string[] {
  return [
    `M0 ${f(h * 0.3)}C${f(w * 0.3)} ${f(h * 0.2)} ${f(w * 0.6)} ${f(h * 0.5)} ${f(w)} ${f(h * 0.45)}`,
    `M${f(w * 0.22)} ${f(h)}C${f(w * 0.3)} ${f(h * 0.6)} ${f(w * 0.45)} ${f(h * 0.3)} ${f(w * 0.5)} 0`,
    `M0 ${f(h * 0.85)}C${f(w * 0.4)} ${f(h * 0.8)} ${f(w * 0.7)} ${f(h * 0.9)} ${f(w)} ${f(h * 0.7)}`,
    `M${f(w * 0.75)} ${f(h)}C${f(w * 0.72)} ${f(h * 0.7)} ${f(w * 0.85)} ${f(h * 0.4)} ${f(w * 0.8)} 0`,
  ];
}

/**
 * Polyline with rounded corners: straight runs joined by quadratic turns (the corner point is the control point).
 * The turn radius is clamped to half of each adjacent run, so short runs never overshoot.
 */
export function roundedPath(pts: Pt[], radius: number): string {
  const first = pts[0];
  if (!first) return '';
  let d = `M${f(first.x)} ${f(first.y)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    const next = pts[i + 1];
    if (!next) {
      d += `L${f(cur.x)} ${f(cur.y)}`;
      break;
    }
    const lenIn = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const lenOut = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, lenIn / 2, lenOut / 2);
    if (r <= 0) {
      d += `L${f(cur.x)} ${f(cur.y)}`;
      continue;
    }
    const a = {
      x: cur.x + ((prev.x - cur.x) / lenIn) * r,
      y: cur.y + ((prev.y - cur.y) / lenIn) * r,
    };
    const b = {
      x: cur.x + ((next.x - cur.x) / lenOut) * r,
      y: cur.y + ((next.y - cur.y) / lenOut) * r,
    };
    d += `L${f(a.x)} ${f(a.y)}Q${f(cur.x)} ${f(cur.y)} ${f(b.x)} ${f(b.y)}`;
  }
  return d;
}

/** Logical grid of the fictional hero road. Everything below is drawn on it, then fitted with ONE scale. */
export const ROAD_GRID = { w: 320, h: 120 } as const;
const ROAD_TURN = 14; // turn radius in grid units

const p = (x: number, y: number): Pt => ({ x, y });

/** The lit route: pickup at the bottom left, drop-off at the right, four turns. */
const ROAD_ROUTE: Pt[] = [
  p(8, 100),
  p(84, 100),
  p(84, 66),
  p(170, 66),
  p(170, 34),
  p(248, 34),
  p(248, 62),
  p(312, 62),
];

/**
 * Faint streets of the same grid. Some cross the route (junctions), some are short stubs (side streets). They run far
 * past the grid so a wide box is still filled; the SVG clips them.
 */
const ROAD_STREETS: Pt[][] = [
  [p(-900, 100), p(8, 100)],
  [p(312, 62), p(1200, 62)],
  [p(84, 100), p(84, 230)],
  [p(84, 66), p(84, -40)],
  [p(-900, 66), p(84, 66)],
  [p(170, 66), p(170, 112), p(330, 112), p(330, 160)],
  [p(170, 34), p(170, -40)],
  [p(248, 34), p(248, -40)],
  [p(248, 62), p(248, 150)],
  [p(-260, 14), p(40, 14), p(40, -40)],
  [p(100, 18), p(170, 18), p(170, 34)],
  [p(330, 112), p(1200, 112)],
  [p(-40, 100), p(-40, 230)],
  [p(400, 62), p(400, -40)],
  [p(520, 112), p(520, 62)],
  [p(-120, 66), p(-120, 230)],
];

/** Side streets that carry ambient traffic (a light enters from the left, another leaves the route downwards). */
const ROAD_LANES: Pt[][] = [
  [p(-90, 66), p(84, 66)],
  [p(170, 66), p(170, 112), p(330, 112), p(330, 160)],
];

export interface RoadLayout {
  /** The lit route as SVG path data in the box's pixel space. */
  route: string;
  start: Pt;
  end: Pt;
  /** Faint street paths, same pixel space (may extend outside the box; the SVG clips). */
  streets: string[];
  /** Traffic lanes (a subset of the streets), same pixel space. */
  lanes: string[];
  /** Pixels per grid unit. */
  scale: number;
}

/**
 * Fits the road grid into the part of a w x h box that is clear of the headline (top) and the form card that overlaps
 * the bottom edge, with a single uniform scale (no distortion), centred in that area.
 */
export function roadLayout(w: number, h: number): RoadLayout {
  const area = { x: w * 0.05, y: h * 0.4, w: w * 0.9, h: h * 0.42 };
  const scale = Math.min(area.w / ROAD_GRID.w, area.h / ROAD_GRID.h);
  const ox = area.x + (area.w - ROAD_GRID.w * scale) / 2;
  const oy = area.y + (area.h - ROAD_GRID.h * scale) / 2;
  const map = (q: Pt): Pt => ({ x: ox + q.x * scale, y: oy + q.y * scale });
  const route = ROAD_ROUTE.map(map);
  return {
    route: roundedPath(route, ROAD_TURN * scale),
    start: route[0]!,
    end: route[route.length - 1]!,
    streets: ROAD_STREETS.map((s) => roundedPath(s.map(map), ROAD_TURN * scale)),
    lanes: ROAD_LANES.map((s) => roundedPath(s.map(map), ROAD_TURN * scale)),
    scale,
  };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Largest parallax shift (px) of a layer at depth 1; the deepest layer (depth 2) stays within LAYER_BLEED. */
export const PARALLAX_MAX = 8;
export const LAYER_BLEED = 24;

/**
 * Parallax shift in px of a layer at `depth` for a normalised input (-1..1 per axis, e.g. the pointer position or the
 * device tilt). The scene moves against the input; vertical travel is damped. Always within +/-depth*max.
 */
export function parallaxOffset(nx: number, ny: number, depth: number, max = PARALLAX_MAX): Pt {
  return { x: -clamp(nx, -1, 1) * depth * max, y: -clamp(ny, -1, 1) * depth * max * 0.6 };
}

/** Small deterministic random source (mulberry32): the same scene on every load, in tests and in screenshots. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HeroScene {
  /** Far layer: a fine, slightly irregular street grid as one path (drawn rotated a little by the caller). */
  grid: string;
  /** Distant lights in two groups (the groups twinkle out of step). */
  lights: [Pt[], Pt[]];
  /** Near layer: out-of-focus wide streets and bokeh discs at the edges. */
  near: string[];
  bokeh: Array<Pt & { r: number }>;
}

/**
 * Deterministic far/near layers for a w x h box. Lights and bokeh keep clear of the headline (top left) and of the
 * form card (bottom edge).
 */
export function heroScene(w: number, h: number): HeroScene {
  const r = rng(w * 31 + h);
  const span = Math.max(w, h) * 0.3;
  let grid = '';
  for (let y = -span; y < h + span; y += 26)
    if (r() > 0.2) grid += `M${f(-span)} ${f(y)}H${f(w + span)}`;
  for (let x = -span; x < w + span; x += 34)
    if (r() > 0.2) grid += `M${f(x)} ${f(-span)}V${f(h + span)}`;
  const at = (x0: number, x1: number, y0: number, y1: number): Pt => ({
    x: w * (x0 + r() * (x1 - x0)),
    y: h * (y0 + r() * (y1 - y0)),
  });
  const group = (n: number, xa: number): Pt[] => [
    ...Array.from({ length: n }, () => at(xa, 0.97, 0.04, 0.34)),
    ...Array.from({ length: 4 }, () => at(0.02, 0.98, 0.42, 0.8)),
  ];
  const lights: [Pt[], Pt[]] = [group(7, 0.56), group(6, 0.5)];
  const bokeh = [
    at(0.7, 0.96, 0.06, 0.3),
    at(0.05, 0.3, 0.6, 0.78),
    at(0.78, 0.97, 0.5, 0.7),
    at(0.4, 0.6, 0.04, 0.2),
  ].map((q) => ({ ...q, r: 5 + r() * 6 }));
  const near = [
    roundedPath(
      [
        { x: w * 0.9, y: -20 },
        { x: w * 0.9, y: h * 0.3 },
        { x: w + 20, y: h * 0.36 },
      ],
      40,
    ),
  ];
  return { grid, lights, near, bokeh };
}
