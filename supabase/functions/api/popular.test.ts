import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from '../_shared/contracts/errors.ts';
import { popularRoutesResponseSchema } from '../_shared/contracts/popular.ts';
import { fixedClock } from '../_shared/domain/clock.ts';
import { BASE, makeApp, type Handler, type Query } from './testing.ts';

const NOW = '2026-11-16T05:00:00Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const PLACE_IDS: Record<string, string> = {
  Cisnădie: 'aaaaaaaa-0000-4000-8000-000000000001',
  'Piața Mare': 'aaaaaaaa-0000-4000-8000-000000000002',
  Șelimbăr: 'aaaaaaaa-0000-4000-8000-000000000003',
  'Zona Industrială Vest': 'aaaaaaaa-0000-4000-8000-000000000004',
  Hipodrom: 'aaaaaaaa-0000-4000-8000-000000000005',
};

const areaRow = (areaId: string, name: string, lat: number, lng: number) => ({
  area_id: areaId,
  id: areaId,
  name,
  kind: 'area',
  locality: 'Sibiu',
  area_name: name,
  lat,
  lng,
});

type Opts = { ranked?: Record<string, unknown>[]; unresolved?: string[] };
function popularDb(opts: Opts = {}): Handler {
  return (q: Query) => {
    if (q.text.includes('from app.popular_routes')) return opts.ranked ?? [];
    if (q.text.includes('from app.areas a left join lateral')) {
      return [
        areaRow(A, 'Turnișor', 45.79, 24.118),
        areaRow(B, 'Gușterița', 45.81, 24.183),
        areaRow(C, 'Ștrand', 45.78, 24.136),
      ];
    }
    if (q.text.includes('where app.immutable_unaccent(lower(p.name))')) {
      const name = String(q.values[0]);
      if (opts.unresolved?.includes(name)) return [];
      const id = PLACE_IDS[name];
      return id
        ? [
            {
              area_id: id,
              id,
              name,
              kind: 'poi',
              locality: 'Sibiu',
              area_name: name,
              lat: 45.79,
              lng: 24.15,
            },
          ]
        : [];
    }
    return undefined;
  };
}

const get = (app: ReturnType<typeof makeApp>['app'], path = '/popular-routes') =>
  app.request(`${BASE}${path}`);

describe('GET /popular-routes', () => {
  it('is public, cacheable for 5 minutes and answers the Place shape the web can search with', async () => {
    const ranked = [
      { origin_area: A, destination_area: B, ride_count: 6, booking_count: 4, score: 10 },
      { origin_area: B, destination_area: C, ride_count: 2, booking_count: 0, score: 2 },
      { origin_area: C, destination_area: A, ride_count: 2, booking_count: 0, score: 2 },
    ];
    const { app, calls } = makeApp([popularDb({ ranked })], {}, { clock: fixedClock(NOW) });
    const res = await get(app);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const out = popularRoutesResponseSchema.parse(await res.json());
    expect(out.items).toHaveLength(3);
    expect(out.items[0]).toMatchObject({
      rides: 6,
      source: 'data',
      from: { id: A, name: 'Turnișor', kind: 'area', point: { lat: 45.79, lng: 24.118 } },
      to: { id: B, name: 'Gușterița' },
    });
    const rank = calls.find((c) => c.text.includes('from app.popular_routes'));
    expect(rank?.values).toEqual([new Date(NOW), 5]);
    // no curated lookup when 3 real routes qualify
    expect(calls.some((c) => c.text.includes('immutable_unaccent(lower(p.name))'))).toBe(false);
  });

  it('fills up with curated corridors (source curated, rides 0) when fewer than 3 qualify', async () => {
    const ranked = [
      { origin_area: A, destination_area: B, ride_count: 3, booking_count: 1, score: 4 },
    ];
    const { app } = makeApp([popularDb({ ranked })], {}, { clock: fixedClock(NOW) });
    const out = popularRoutesResponseSchema.parse(await (await get(app)).json());
    expect(out.items.map((i) => i.source)).toEqual(['data', 'curated', 'curated']);
    expect(out.items[1]).toMatchObject({
      rides: 0,
      from: { name: 'Cisnădie' },
      to: { name: 'Piața Mare' },
    });
  });

  it('with no data returns the three curated corridors, and skips one that cannot be resolved', async () => {
    const { app } = makeApp([popularDb()], {}, { clock: fixedClock(NOW) });
    const out = popularRoutesResponseSchema.parse(await (await get(app)).json());
    expect(out.items.map((i) => i.from.name)).toEqual(['Cisnădie', 'Șelimbăr', 'Hipodrom']);

    const { app: app2 } = makeApp(
      [popularDb({ unresolved: ['Șelimbăr'] })],
      {},
      { clock: fixedClock(NOW) },
    );
    const out2 = popularRoutesResponseSchema.parse(await (await get(app2)).json());
    expect(out2.items.map((i) => i.from.name)).toEqual(['Cisnădie', 'Hipodrom']);
  });

  it('passes the limit to the ranking and rejects a bad one', async () => {
    const { app, calls } = makeApp([popularDb()], {}, { clock: fixedClock(NOW) });
    expect((await get(app, '/popular-routes?limit=10')).status).toBe(200);
    expect(calls.find((c) => c.text.includes('from app.popular_routes'))?.values[1]).toBe(10);
    for (const bad of ['limit=0', 'limit=11', 'limit=abc']) {
      const res = await get(app, `/popular-routes?${bad}`);
      expect(res.status).toBe(400);
      expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('is rate limited like other public reads and exposes no personal data', async () => {
    const limited: Handler = (q) =>
      q.text.includes('app.rate_limit_hit') ? [{ allowed: false }] : undefined;
    const { app } = makeApp([limited, popularDb()], {}, { clock: fixedClock(NOW) });
    const res = await get(app);
    expect(res.status).toBe(429);

    const { app: ok } = makeApp([popularDb()], {}, { clock: fixedClock(NOW) });
    const body = JSON.stringify(await (await get(ok)).json());
    expect(body).not.toMatch(/driver|passenger|email|phone/i);
  });
});
