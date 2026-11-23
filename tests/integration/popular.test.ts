import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { popularRoutesResponseSchema } from '../../supabase/functions/_shared/contracts/popular.ts';
import { BASE, DB_URL, SECRET, createUser } from './factories.ts';

/**
 * Popular routes against the local stack (see api.test.ts for how to start it). Skipped without the
 * stack or with INT_DB=skip. Rides are inserted straight into the database (superuser) for three
 * areas picked at random, then removed. Assertions only concern the routes this test created, so
 * other suites' data cannot break it.
 */
const DB_SKIP = process.env.INT_DB === 'skip';

type Area = { id: string; name: string };

describe.skipIf(!BASE || !SECRET || DB_SKIP)('GET /popular-routes against the local stack', () => {
  const sql = postgres(DB_URL, { max: 2 });
  const rideIds: string[] = [];
  let areas: Area[] = [];

  async function insertRide(driverId: string, from: Area, to: Area, hoursAhead: number) {
    const [diesel] = await sql<{ id: string }[]>`
      select id from app.energy_prices where fuel_type = 'diesel' order by effective_from limit 1`;
    const [row] = await sql<{ id: string }[]>`
      insert into app.rides (driver_id, origin, destination, origin_label, destination_label,
        origin_area_id, destination_area_id, route, distance_m, duration_s, departure_at, seats_offered,
        energy_price_id, rate_micro_per_km, vehicle_snapshot, status)
      values (${driverId}::uuid,
        ST_SetSRID(ST_MakePoint(24.15123, 45.70987), 4326), ST_SetSRID(ST_MakePoint(24.18654, 45.74321), 4326),
        'Origin', 'Destination', ${from.id}::uuid, ${to.id}::uuid,
        ST_GeomFromText('LINESTRING(24.15123 45.70987, 24.17 45.725, 24.18654 45.74321)', 4326),
        5000, 600, now() + make_interval(hours => ${hoursAhead}::int), 3, ${diesel?.id ?? null}::uuid, 651000,
        '{"make":"Dacia","model":"Logan","colour":"Grey","plate":"SB12ABC","fuelType":"diesel"}'::jsonb,
        'published')
      returning id`;
    if (row) rideIds.push(row.id);
  }

  beforeAll(async () => {
    areas = await sql<Area[]>`select id, name from app.areas order by random() limit 3`;
  });

  afterAll(async () => {
    if (rideIds.length > 0) await sql`delete from app.rides where id = any(${rideIds}::uuid[])`;
    await sql.end();
  });

  it('is public, cacheable, and shows a 2-driver route but hides a 1-driver route', async () => {
    expect(areas).toHaveLength(3);
    const [a, b, c] = areas as [Area, Area, Area];
    const [d1, d2] = await Promise.all([createUser(), createUser()]);

    // a -> b: two drivers (shown). b -> c: one driver, twice (hidden).
    await insertRide(d1.id, a, b, 30);
    await insertRide(d2.id, a, b, 31);
    await insertRide(d1.id, b, c, 32);
    await insertRide(d1.id, b, c, 33);

    // Public: no token. Ask for 10 so a busy database cannot push the route off the list.
    const res = await fetch(`${BASE}/popular-routes?limit=10`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const out = popularRoutesResponseSchema.parse(await res.json());

    const shown = out.items.find(
      (i) => i.source === 'data' && i.from.areaName === a.name && i.to.areaName === b.name,
    );
    expect(shown).toBeDefined();
    expect(shown?.rides).toBeGreaterThanOrEqual(2);
    // The Place is usable as it is: a point inside the coverage area.
    expect(shown?.from.point.lat).toBeGreaterThan(45);
    expect(shown?.to.point.lng).toBeGreaterThan(23);

    expect(
      out.items.some(
        (i) =>
          i.source === 'data' &&
          i.from.areaName === b.name &&
          i.to.areaName === c.name &&
          i.rides <= 2,
      ),
    ).toBe(false);

    // Curated items, when present, never carry a popularity count and never repeat a real route.
    for (const i of out.items.filter((x) => x.source === 'curated')) expect(i.rides).toBe(0);
    const keys = out.items.map((i) => `${i.from.name}>${i.to.name}`);
    expect(new Set(keys).size).toBe(keys.length);

    // No personal data.
    expect(JSON.stringify(out)).not.toMatch(/driver|passenger|email|phone|plate/i);
  });

  it('validates the limit', async () => {
    expect((await fetch(`${BASE}/popular-routes?limit=0`)).status).toBe(400);
    expect((await fetch(`${BASE}/popular-routes?limit=11`)).status).toBe(400);
    const res = await fetch(`${BASE}/popular-routes?limit=1`);
    expect(res.status).toBe(200);
    expect(popularRoutesResponseSchema.parse(await res.json()).items.length).toBeLessThanOrEqual(1);
  });
});
