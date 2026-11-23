import { describe, expect, it } from 'vitest';
import { placesResponseSchema } from '../../supabase/functions/_shared/contracts/geo.ts';
import { popularRoutesResponseSchema } from '../../supabase/functions/_shared/contracts/popular.ts';
import { inCoverage } from '../../supabase/functions/_shared/domain/privacy.ts';
import { bucharestDayKey } from '../../supabase/functions/_shared/domain/time.ts';
import { BASE } from './factories.ts';

/**
 * Every popular route the API offers must be searchable (the bug: the curated route Cisnădie to
 * Centrul Istoric answered POST /search with 400 outside_coverage, so the app showed "We couldn't
 * load rides"). No auth, no rides are needed: the point is that the request is accepted (200, maybe
 * with no items). Skipped without the local stack, like the other integration suites.
 */
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
const toPoint = (p: { lat: number; lng: number }) => ({ lat: round5(p.lat), lng: round5(p.lng) });

describe.skipIf(!BASE)('popular routes and autocomplete only offer places the app can use', () => {
  it('POST /search answers 200 for EVERY item of GET /popular-routes', async () => {
    const res = await fetch(`${BASE}/popular-routes?limit=10`);
    expect(res.status).toBe(200);
    const { items } = popularRoutesResponseSchema.parse(await res.json());
    expect(items.length).toBeGreaterThan(0);

    const date = bucharestDayKey(new Date(Date.now() + 24 * 3_600_000));
    for (const item of items) {
      const label = `${item.from.name} -> ${item.to.name} (${item.source})`;
      expect(inCoverage(item.from.point), `${label}: from is inside coverage`).toBe(true);
      expect(inCoverage(item.to.point), `${label}: to is inside coverage`).toBe(true);
      const search = await fetch(`${BASE}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: toPoint(item.from.point),
          to: toPoint(item.to.point),
          date,
          time: '07:30',
          windowMin: 60,
        }),
      });
      expect(search.status, label).toBe(200);
    }
  });

  it('GET /places?q=cisnadie returns only points inside coverage (its sub-areas, not the whole locality)', async () => {
    const res = await fetch(`${BASE}/places?q=cisnadie&limit=20`);
    expect(res.status).toBe(200);
    const { items } = placesResponseSchema.parse(await res.json());
    expect(items.length).toBeGreaterThan(0);
    for (const place of items) {
      expect(inCoverage(place.point), `${place.name}: ${JSON.stringify(place.point)}`).toBe(true);
    }
    // usable sub-areas of Cisnădie (e.g. Centru) are still found
    expect(items.some((p) => p.kind === 'area' && p.secondary.includes('Cisnădie'))).toBe(true);
  });
});
