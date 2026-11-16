import { describe, expect, it } from 'vitest';
import { FIXTURE_DETOUR_FACTOR, createFixtureProvider } from './fixture.ts';
import { FIXTURE_ROUTES } from './fixtures.ts';
import { haversineM } from './geo.ts';

const provider = createFixtureProvider();
const shoppingCity = { lat: 45.7413, lng: 24.1861 };
const ziVest = { lat: 45.785, lng: 24.09 };
const piataMare = { lat: 45.7977, lng: 24.1505 };
const maguriiStreet = { lat: 45.709, lng: 24.151 };

describe('fixture routing provider', () => {
  it('is named fixture', () => {
    expect(provider.name).toBe('fixture');
  });

  it('returns the stored route for Trip B (Shopping City to Zona Industrială Vest)', async () => {
    const r = await provider.route(shoppingCity, ziVest);
    expect(r.distanceM).toBe(9_588);
    expect(r.durationS).toBe(1_020);
    expect(r.coordinates[0]).toEqual([24.1861, 45.7413]);
    expect(r.coordinates.at(-1)).toEqual([24.09, 45.785]);
  });

  it('returns Trip A and Trip C', async () => {
    expect((await provider.route(maguriiStreet, piataMare)).distanceM).toBe(11_514);
    const hipodrom = { lat: 45.772, lng: 24.133 };
    const oldTown = { lat: 45.7955, lng: 24.149 };
    expect((await provider.route(hipodrom, oldTown)).distanceM).toBe(4_234);
  });

  it('matches within 600 m of the endpoints, so area centroids work too', async () => {
    // Șelimbăr and Zona Industrială Vest area centroids from the seed gazetteer
    const r = await provider.route({ lat: 45.744, lng: 24.188 }, { lat: 45.785, lng: 24.093 });
    expect(r.distanceM).toBe(9_588);
  });

  it('works in the reverse direction with the vertices reversed', async () => {
    const forward = await provider.route(shoppingCity, ziVest);
    const back = await provider.route(ziVest, shoppingCity);
    expect(back.distanceM).toBe(forward.distanceM);
    expect(back.coordinates).toEqual([...forward.coordinates].reverse());
  });

  it('falls back to a straight line with distance x 1.3 for unknown pairs', async () => {
    const a = { lat: 45.76, lng: 24.12 };
    const b = { lat: 45.79, lng: 24.17 };
    const r = await provider.route(a, b);
    expect(r.distanceM).toBe(Math.round(haversineM(a, b) * FIXTURE_DETOUR_FACTOR));
    expect(r.coordinates).toEqual([
      [24.12, 45.76],
      [24.17, 45.79],
    ]);
    expect(r.durationS).toBeGreaterThan(0);
  });

  it('is deterministic', async () => {
    const a = { lat: 45.76, lng: 24.12 };
    const b = { lat: 45.79, lng: 24.17 };
    expect(await provider.route(a, b)).toEqual(await provider.route(a, b));
  });

  it('stored routes have at least two vertices and stay inside the coverage box', () => {
    for (const fx of FIXTURE_ROUTES) {
      expect(fx.coordinates.length).toBeGreaterThanOrEqual(2);
      for (const [lng, lat] of fx.coordinates) {
        expect(lat).toBeGreaterThan(45.68);
        expect(lat).toBeLessThan(45.86);
        expect(lng).toBeGreaterThan(23.98);
        expect(lng).toBeLessThan(24.32);
      }
    }
  });
});
