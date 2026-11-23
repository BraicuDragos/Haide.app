import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  clampState,
  clampZoom,
  cropRect,
  cropSide,
  initialState,
  panBy,
  zoomTo,
} from './cropMath';

describe('cropMath', () => {
  it('starts centred on the largest square', () => {
    const s = initialState(2000, 1000);
    expect(cropRect(s, 2000, 1000)).toEqual({ sx: 500, sy: 0, side: 1000 });
  });

  it('limits zoom to 1..MAX_ZOOM and ignores junk', () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(NaN)).toBe(1);
    expect(cropSide(2000, 1000, 2)).toBe(500);
  });

  it('never lets the window leave the image', () => {
    const s = clampState({ zoom: 2, cx: -50, cy: 5000 }, 2000, 1000);
    const r = cropRect(s, 2000, 1000);
    expect(r.sx).toBe(0);
    expect(r.sy + r.side).toBe(1000);
  });

  it('pans opposite to the drag, scaled by the zoom, and clamps', () => {
    const s = zoomTo(initialState(1000, 1000), 2, 1000, 1000); // window 500 px of a 250 px viewport: 2 src px per px
    const moved = panBy(s, 50, 0, 250, 1000, 1000);
    expect(moved.cx).toBe(400);
    const far = panBy(s, -10_000, 10_000, 250, 1000, 1000);
    expect(far.cx).toBe(750);
    expect(far.cy).toBe(250);
  });

  it('keeps a portrait photo square at any zoom', () => {
    for (const z of [1, 1.7, 4]) {
      const r = cropRect({ zoom: z, cx: 10, cy: 10 }, 1200, 3000);
      expect(r.side).toBeCloseTo(1200 / z);
      expect(r.sx).toBeGreaterThanOrEqual(0);
      expect(r.sy).toBeGreaterThanOrEqual(0);
      expect(r.sx + r.side).toBeLessThanOrEqual(1200 + 1e-9);
    }
  });

  it('zooming back out re-clamps the window', () => {
    const s = panBy(zoomTo(initialState(1000, 1000), 4, 1000, 1000), -5000, 0, 250, 1000, 1000);
    const out = zoomTo(s, 1, 1000, 1000);
    expect(cropRect(out, 1000, 1000)).toEqual({ sx: 0, sy: 0, side: 1000 });
  });
});
