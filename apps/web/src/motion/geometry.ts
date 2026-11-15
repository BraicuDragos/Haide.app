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
