import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { placesResponseSchema } from '../../supabase/functions/_shared/contracts/geo.ts';
import { haversineM } from '../../supabase/functions/_shared/domain/address.ts';
import { BASE, DB_URL } from './factories.ts';

/**
 * Approximate house numbers against the local stack with the real seeded gazetteer (ADR 0042; see
 * api.test.ts for how to start it). Skipped without the stack or with INT_DB=skip. Read-only.
 */
const DB_SKIP = process.env.INT_DB === 'skip';

async function places(q: string) {
  const res = await fetch(`${BASE}/places?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return placesResponseSchema.parse(await res.json()).items;
}

describe.skipIf(!BASE || DB_SKIP)('GET /places with a house number (real gazetteer)', () => {
  const sql = postgres(DB_URL, { max: 1 });
  afterAll(async () => {
    await sql.end({ timeout: 2 });
  });

  it('Negoveanu 2 is offered, approximate, within 100 m of the only known number (4)', async () => {
    const [known] = await sql<{ lat: number; lng: number }[]>`
      select ST_Y(geom) as lat, ST_X(geom) as lng from app.places
      where kind = 'address' and name = 'Strada Negoveanu 4' limit 1`;
    expect(known).toBeDefined();
    const items = await places('Negoveanu 2');
    const first = items[0];
    expect(first).toMatchObject({
      name: 'Strada Negoveanu 2',
      kind: 'address',
      approximate: true,
    });
    expect(first?.id).toMatch(/^approx:/);
    expect(haversineM(first!.point, known!)).toBeLessThan(100);
    // the existing address still follows, without the flag
    const exact = items.find((p) => p.name === 'Strada Negoveanu 4');
    expect(exact).toBeDefined();
    expect(exact).not.toHaveProperty('approximate');
  });

  it('keeps the number as typed, with its suffix and extras', async () => {
    const items = await places('negoveanu 2a bl 5');
    expect(items[0]).toMatchObject({ name: 'Strada Negoveanu 2A, bl. 5', approximate: true });
  });

  it('an existing number returns no synthetic duplicate', async () => {
    const items = await places('Negoveanu 4');
    expect(items.some((p) => p.approximate)).toBe(false);
    expect(items[0]?.name).toBe('Strada Negoveanu 4');
  });

  it('a street from the seed: a missing number between two known ones lands near its neighbours', async () => {
    type Row = { street: string; nums: number[] };
    const rows = await sql<Row[]>`
      select substring(name from '^(.*) [0-9]+$') as street,
             array_agg(substring(name from ' ([0-9]+)$')::int order by substring(name from ' ([0-9]+)$')::int) as nums
      from app.places
      where kind = 'address' and name ~ '^[^0-9]+ [0-9]+$'
      group by 1
      having count(distinct locality) = 1 and count(*) between 6 and 40
      order by 1
      limit 300`;
    // a street whose stripped name is unique among the candidates, with a gap on its own side
    const stripped = (s: string) => s.replace(/^\S+ /, '').toLowerCase();
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(stripped(r.street), (counts.get(stripped(r.street)) ?? 0) + 1);
    let picked: { street: string; missing: number; nums: number[] } | null = null;
    for (const r of rows) {
      if ((counts.get(stripped(r.street)) ?? 0) !== 1) continue;
      const set = new Set(r.nums);
      const lo = r.nums[0] ?? 0;
      const hi = r.nums[r.nums.length - 1] ?? 0;
      for (let m = lo + 1; m < hi; m++) {
        if (!set.has(m)) {
          picked = { street: r.street, missing: m, nums: r.nums };
          break;
        }
      }
      if (picked) break;
    }
    expect(picked, 'the seed has a street with a gap in its numbers').not.toBeNull();
    const p = picked!;

    const items = await places(`${p.street} ${p.missing}`);
    const first = items[0];
    expect(first?.approximate).toBe(true);
    expect(first?.name).toBe(`${p.street} ${p.missing}`);

    // never farther than 600 m from the nearest known number of that street
    const known = await sql<{ lat: number; lng: number }[]>`
      select ST_Y(geom) as lat, ST_X(geom) as lng from app.places
      where kind = 'address' and name like ${`${p.street} %`}`;
    const nearest = Math.min(...known.map((k) => haversineM(first!.point, k)));
    expect(nearest).toBeLessThan(600);

    // and a number that exists returns no synthetic suggestion
    const existing = p.nums[0] ?? 0;
    const again = await places(`${p.street} ${existing}`);
    expect(again.some((x) => x.approximate && x.name === `${p.street} ${existing}`)).toBe(false);
  });

  it('a street that is not in the data gets no invented position', async () => {
    const items = await places('Zzzqxv 12');
    expect(items.some((p) => p.approximate)).toBe(false);
  });
});
