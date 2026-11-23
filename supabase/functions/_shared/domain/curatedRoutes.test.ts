import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURATED_PILOT_ROUTES, nameKey, type CuratedEnd } from './popularRoutes.ts';
import { inCoverage } from './privacy.ts';

/**
 * The curated pilot routes are resolved by NAME (and optional locality) against the gazetteer
 * (app.places, loaded from supabase/seed/gazetteer/places.csv). A name that is not there makes the
 * route silently disappear (the original bug: "Piața Mare" exists only as street addresses), and a
 * point outside coverage makes POST /search answer 400 (the second bug: the locality row "Cisnădie").
 * Every end must be an existing place of kind `area` INSIDE COVERAGE, and the two ends must differ.
 */
const csv = readFileSync(
  new URL('../../../seed/gazetteer/places.csv', import.meta.url),
  'utf8',
).split(/\r?\n/);

// osm_id,name,kind,locality,rank,lat,lng. Names in this file never contain a comma, so a plain split is enough.
const rows = csv
  .slice(1)
  .filter((l) => l.length > 0)
  .map((l) => l.split(','))
  .map((c) => ({
    name: c[1] ?? '',
    kind: c[2] ?? '',
    locality: c[3] ?? '',
    point: { lat: Number(c[5]), lng: Number(c[6]) },
  }));

/** Same match the SQL does: name (and locality when given), inside coverage. */
function resolve(end: CuratedEnd) {
  return rows.filter(
    (r) =>
      nameKey(r.name) === nameKey(end.name) &&
      (!end.locality || nameKey(r.locality) === nameKey(end.locality)) &&
      inCoverage(r.point),
  );
}

const ends = CURATED_PILOT_ROUTES.flatMap((r) => [r.from, r.to]);

describe('CURATED_PILOT_ROUTES', () => {
  it('has three routes', () => {
    expect(CURATED_PILOT_ROUTES).toHaveLength(3);
  });

  it.each(ends.map((e) => [`${e.name}${e.locality ? ` (${e.locality})` : ''}`, e] as const))(
    '%s exists in the gazetteer as an area inside coverage',
    (_label, end) => {
      const hits = resolve(end);
      expect(hits.some((h) => h.kind === 'area')).toBe(true);
    },
  );

  it('"Centru" in Cisnădie resolves to exactly one area (the locality filter guards against future duplicates)', () => {
    const cis = resolve({ name: 'Centru', locality: 'Cisnădie' }).filter((r) => r.kind === 'area');
    expect(cis).toHaveLength(1);
  });

  it('never joins a place to itself', () => {
    for (const r of CURATED_PILOT_ROUTES) {
      expect(nameKey(r.from.label ?? r.from.name)).not.toBe(nameKey(r.to.label ?? r.to.name));
    }
  });

  it('shows route 1 as Cisnădie while the point is the centre of Cisnădie', () => {
    const first = CURATED_PILOT_ROUTES[0]?.from;
    expect(first?.label).toBe('Cisnădie');
    expect(first && resolve(first)[0]?.point.lat).toBeGreaterThanOrEqual(45.68);
  });
});
