import { beforeEach, describe, expect, it } from 'vitest';
import { dist, ease, ms, stagger, toMs } from './core';
import { curvePath, smoothPath } from './geometry';

beforeEach(() => {
  const s = document.documentElement.style;
  s.setProperty('--tk-dur-slow', '400ms');
  s.setProperty('--tk-ease-spring', 'cubic-bezier(0.34, 1.3, 0.64, 1)');
  s.setProperty('--tk-travel-rise', '12px');
  s.setProperty('--tk-stagger-step', '40ms');
  s.setProperty('--tk-stagger-max', '240ms');
});

describe('token readers', () => {
  it('reads durations, easings and distances from the CSS custom properties', () => {
    expect(ms('slow')).toBe(400);
    expect(ease('spring')).toContain('cubic-bezier');
    expect(dist('rise')).toBe('12px');
  });
  it('reads seconds too (the build minifier turns 400ms into .4s)', () => {
    expect(toMs('.4s')).toBe(400);
    expect(toMs('2.4s')).toBe(2400);
    expect(toMs('80ms')).toBe(80);
    expect(toMs('')).toBe(0);
  });
  it('staggers by the step and caps at the max', () => {
    expect(stagger(0)).toBe(0);
    expect(stagger(2)).toBe(80);
    expect(stagger(50)).toBe(240);
    expect(stagger(-3)).toBe(0);
  });
});

describe('route geometry', () => {
  it('builds a smooth path between two points', () => {
    expect(curvePath({ x: 0, y: 0 }, { x: 100, y: 50 })).toMatch(/^M0\.0 0\.0C.* 100\.0 50\.0$/);
  });
  it('smooths a polyline and tolerates tiny input', () => {
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
    expect(d.startsWith('M0.0 0.0C')).toBe(true);
    expect(smoothPath([])).toBe('');
  });
});
