import { describe, expect, it } from 'vitest';
import { placeSchema, placesResponseSchema } from '../_shared/contracts/geo.ts';
import { BASE, makeApp, type Handler, type Query } from './testing.ts';

/**
 * GET /places with a house number (ADR 0042): synthetic approximate suggestions in front of the
 * normal results. The fake database answers the three queries by their text: the street lookup
 * (`street_key`), the area lookup and the normal autocomplete (`word_similarity`).
 */

type Row = { name: string; kind: string; locality: string | null; lat: number; lng: number };

const NEGOVEANU_4: Row = {
  name: 'Strada Negoveanu 4',
  kind: 'address',
  locality: 'Sibiu',
  lat: 45.785588,
  lng: 24.174657,
};

const normalRow = (name: string, over: Record<string, unknown> = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  name,
  kind: 'address',
  locality: 'Sibiu',
  area_name: 'Terezian',
  lat: 45.785588,
  lng: 24.174657,
  ...over,
});

function db(opts: {
  streets?: Row[];
  normal?: ReturnType<typeof normalRow>[];
  area?: string | null;
}) {
  const handler: Handler = (q: Query) => {
    if (q.text.includes('street_key')) return opts.streets ?? [];
    if (q.text.includes('select a.name from app.areas a')) {
      return opts.area === null ? [] : [{ name: opts.area ?? 'Terezian' }];
    }
    if (q.text.includes('word_similarity')) return opts.normal ?? [];
    return undefined;
  };
  return handler;
}

async function search(handlers: Handler[], q: string, limit?: number) {
  const { app, calls } = makeApp(handlers);
  const qs = `q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ''}`;
  const res = await app.request(`${BASE}/places?${qs}`);
  expect(res.status).toBe(200);
  const body = placesResponseSchema.parse(await res.json());
  return { items: body.items, calls };
}

describe('GET /places: approximate house numbers', () => {
  it('offers the missing number first and keeps the existing address after it', async () => {
    const { items } = await search(
      [db({ streets: [NEGOVEANU_4], normal: [normalRow('Strada Negoveanu 4')] })],
      'Negoveanu 2',
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: 'Strada Negoveanu 2',
      kind: 'address',
      secondary: 'Sibiu, Terezian',
      areaName: 'Terezian',
      approximate: true,
      point: { lat: 45.78559, lng: 24.17466 },
    });
    expect(items[0]?.id).toMatch(/^approx:[A-Za-z0-9_-]+$/);
    // the normal result is untouched and carries no flag at all
    expect(items[1]?.name).toBe('Strada Negoveanu 4');
    expect(items[1]).not.toHaveProperty('approximate');
  });

  it('does not duplicate an address that exists with exactly that number', async () => {
    const { items } = await search(
      [db({ streets: [NEGOVEANU_4], normal: [normalRow('Strada Negoveanu 4')] })],
      'Negoveanu 4',
    );
    expect(items.map((p) => p.name)).toEqual(['Strada Negoveanu 4']);
    expect(items.some((p) => p.approximate)).toBe(false);
  });

  it('a different suffix is not the exact number: 4A is offered next to 4', async () => {
    const { items } = await search(
      [db({ streets: [NEGOVEANU_4], normal: [normalRow('Strada Negoveanu 4')] })],
      'negoveanu 4a',
    );
    expect(items[0]).toMatchObject({ name: 'Strada Negoveanu 4A', approximate: true });
    // same number known: the point is the known one
    expect(items[0]?.point).toEqual({ lat: 45.78559, lng: 24.17466 });
  });

  it('returns only the normal results when the data has nothing for the street', async () => {
    const { items } = await search(
      [db({ streets: [], normal: [normalRow('Strada Nedefinită 3')] })],
      'Nedefinita 9',
    );
    expect(items.map((p) => p.name)).toEqual(['Strada Nedefinită 3']);
  });

  it('places the number between its neighbours of the same side of the street', async () => {
    const streets: Row[] = [
      { name: 'Strada Test 2', kind: 'address', locality: 'Sibiu', lat: 45.78, lng: 24.1 },
      { name: 'Strada Test 6', kind: 'address', locality: 'Sibiu', lat: 45.78, lng: 24.102 },
      { name: 'Strada Test 3', kind: 'address', locality: 'Sibiu', lat: 45.7805, lng: 24.1 },
    ];
    const { items } = await search([db({ streets })], 'test 4');
    expect(items[0]).toMatchObject({
      name: 'Strada Test 4',
      approximate: true,
      point: { lat: 45.78, lng: 24.101 },
    });
  });

  it('uses the street row when only the street is known', async () => {
    const streets: Row[] = [
      { name: 'Strada Veche', kind: 'street', locality: 'Cisnădie', lat: 45.71, lng: 24.15 },
    ];
    const { items } = await search([db({ streets, area: null })], 'Veche 12');
    expect(items[0]).toMatchObject({
      name: 'Strada Veche 12',
      secondary: 'Cisnădie',
      areaName: 'Cisnădie',
      approximate: true,
      point: { lat: 45.71, lng: 24.15 },
    });
  });

  it('offers at most one suggestion per locality and two localities', async () => {
    const mk = (loc: string, n: number): Row => ({
      name: `Strada Eminescu ${n}`,
      kind: 'address',
      locality: loc,
      lat: 45.7 + n / 1000,
      lng: 24.1,
    });
    const streets = [
      mk('Sibiu', 4),
      mk('Sibiu', 6),
      mk('Cisnădie', 4),
      mk('Șelimbăr', 8),
      mk('Șelimbăr', 10),
      mk('Șelimbăr', 12),
    ];
    const { items } = await search([db({ streets, area: null })], 'Eminescu 2');
    const approx = items.filter((p) => p.approximate);
    expect(approx).toHaveLength(2);
    expect(approx.map((p) => p.secondary)).toEqual(['Șelimbăr', 'Sibiu']);
    expect(approx.map((p) => p.id)).not.toContain(undefined);
    expect(new Set(approx.map((p) => p.id)).size).toBe(2);
  });

  it('keeps the typed number and the extras in the label', async () => {
    const { items } = await search(
      [db({ streets: [NEGOVEANU_4] })],
      'str. negoveanu nr. 2 a bl 5 sc 2',
    );
    expect(items[0]?.name).toBe('Strada Negoveanu 2A, bl. 5, sc. 2');
    expect(items[0]?.name.length).toBeLessThanOrEqual(80);
    const slash = await search([db({ streets: [NEGOVEANU_4] })], '2/B Negoveanu');
    expect(slash.items[0]?.name).toBe('Strada Negoveanu 2/B');
  });

  it('respects the limit: the suggestion stays first, the tail is trimmed', async () => {
    const normal = Array.from({ length: 8 }, (_, i) =>
      normalRow(`Strada Negoveanu ${i + 10}`, { id: `00000000-0000-4000-8000-00000000000${i}` }),
    );
    const all = await search([db({ streets: [NEGOVEANU_4], normal })], 'negoveanu 2');
    expect(all.items).toHaveLength(8);
    expect(all.items[0]?.approximate).toBe(true);
    expect(all.items[7]?.name).toBe('Strada Negoveanu 16');
    const one = await search([db({ streets: [NEGOVEANU_4], normal })], 'negoveanu 2', 1);
    expect(one.items.map((p) => p.name)).toEqual(['Strada Negoveanu 2']);
  });

  it('the id is stable across calls and ignores letter case and diacritics of the query', async () => {
    const a = await search([db({ streets: [NEGOVEANU_4] })], 'Negoveanu 2');
    const b = await search([db({ streets: [NEGOVEANU_4] })], 'NEGOVEANU 2');
    expect(a.items[0]?.id).toBe(b.items[0]?.id);
    const c = await search([db({ streets: [NEGOVEANU_4] })], 'Negoveanu 2A');
    expect(c.items[0]?.id).not.toBe(a.items[0]?.id);
  });

  it('matches diacritics-insensitively (the street key is unaccented)', async () => {
    const streets: Row[] = [
      {
        name: 'Strada Ștefan cel Mare 8',
        kind: 'address',
        locality: 'Sibiu',
        lat: 45.79,
        lng: 24.15,
      },
    ];
    const { items, calls } = await search([db({ streets })], 'ȘTEFAN CEL MARE 3');
    expect(items[0]).toMatchObject({ name: 'Strada Ștefan cel Mare 3', approximate: true });
    const lookup = calls.find((c) => c.text.includes('street_key'));
    expect(lookup?.values[0]).toBe('stefan cel mare');
  });

  it('binds the street key as a parameter, escapes wildcards in SQL and bounds the rows', async () => {
    const { calls } = await search([db({ streets: [] })], '100%_ Negoveanu 2');
    const lookup = calls.find((c) => c.text.includes('street_key'));
    expect(lookup).toBeDefined();
    expect(lookup?.text).toContain("'\\%'");
    expect(lookup?.text).toContain('limit ?');
    expect(lookup?.values).toContain(1200);
    expect(lookup?.values.every((v) => !Array.isArray(v))).toBe(true);
    // the user text is never part of the SQL text
    expect(lookup?.text).not.toContain('negoveanu');
  });

  it('runs exactly the old query for a query without a number', async () => {
    const { items, calls } = await search(
      [db({ normal: [normalRow('Piața Mare', { kind: 'poi' })] })],
      'piata mare',
    );
    expect(items.map((p) => p.name)).toEqual(['Piața Mare']);
    expect(calls.some((c) => c.text.includes('street_key'))).toBe(false);
    expect(calls.filter((c) => c.text.includes('from app.places'))).toHaveLength(1);
  });

  it('does not look for a street when the street part is too short', async () => {
    const { calls } = await search([db({})], 'ab 2');
    expect(calls.some((c) => c.text.includes('street_key'))).toBe(false);
    const digits = await search([db({})], '12');
    expect(digits.calls.some((c) => c.text.includes('street_key'))).toBe(false);
  });

  it('q validation is unchanged (min 2, max 80)', async () => {
    const { app } = makeApp([db({})]);
    expect((await app.request(`${BASE}/places?q=a`)).status).toBe(400);
    expect((await app.request(`${BASE}/places?q=${'x'.repeat(81)}`)).status).toBe(400);
  });
});

describe('place contract', () => {
  const base = {
    id: 'x',
    name: 'Strada Negoveanu 2',
    secondary: 'Sibiu',
    kind: 'address',
    point: { lat: 45.78, lng: 24.17 },
    areaName: 'Terezian',
  };
  it('approximate is optional and boolean', () => {
    expect(placeSchema.parse(base)).not.toHaveProperty('approximate');
    expect(placeSchema.parse({ ...base, approximate: true }).approximate).toBe(true);
    expect(placeSchema.safeParse({ ...base, approximate: 'yes' }).success).toBe(false);
  });
});
