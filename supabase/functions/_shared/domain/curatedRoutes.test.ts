import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURATED_PILOT_ROUTES, nameKey } from './popularRoutes.ts';

/**
 * The curated pilot routes are resolved by NAME against the gazetteer (app.places, loaded from
 * supabase/seed/gazetteer/places.csv). A name that is not there makes the route silently disappear
 * (the original bug: "Piața Mare" exists only as street addresses, "Zona Industrială Vest" not at all).
 * Every end must be an existing place of kind `area`, and the two ends must differ.
 */
const csv = readFileSync(
  new URL('../../../seed/gazetteer/places.csv', import.meta.url),
  'utf8',
).split(/\r?\n/);

// osm_id,name,kind,locality,rank,lat,lng. Area names never contain a comma, so a plain split is enough.
const areaNames = new Set(
  csv
    .slice(1)
    .map((l) => l.split(','))
    .filter((c) => c[2] === 'area')
    .map((c) => nameKey(c[1] ?? '')),
);

describe('CURATED_PILOT_ROUTES', () => {
  it('has three routes', () => {
    expect(CURATED_PILOT_ROUTES).toHaveLength(3);
  });

  it.each(CURATED_PILOT_ROUTES.flatMap((r) => [r.from, r.to]))('%s is a gazetteer area', (name) => {
    expect(areaNames.has(nameKey(name))).toBe(true);
  });

  it('never joins a place to itself', () => {
    for (const r of CURATED_PILOT_ROUTES) expect(nameKey(r.from)).not.toBe(nameKey(r.to));
  });
});
