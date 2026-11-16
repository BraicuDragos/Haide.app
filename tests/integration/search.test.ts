import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from '../../supabase/functions/_shared/contracts/errors.ts';
import {
  previewResponseSchema,
  rideOwnerViewSchema,
  ridePublicViewSchema,
} from '../../supabase/functions/_shared/contracts/rides.ts';
import {
  matchResponseSchema,
  searchResponseSchema,
  type SearchItem,
} from '../../supabase/functions/_shared/contracts/search.ts';
import { quoteUpTo } from '../../supabase/functions/_shared/domain/pricing.ts';
import { gridPoint } from '../../supabase/functions/_shared/domain/privacy.ts';
import {
  bucharestDayKey,
  bucharestLocalToUtc,
} from '../../supabase/functions/_shared/domain/time.ts';
import { BASE, SECRET, createBareUser, createUser, type TestUser } from './factories.ts';

/**
 * Black-box search and matching against the local stack (see api.test.ts for how to start it), with
 * ROUTING_PROVIDER=fixture. Skipped without the stack.
 *
 * Isolation (the suite shares one database with the other integration files, possibly running at the
 * same time, and with earlier runs): every scenario publishes on its OWN random "lane" (a straight
 * ride somewhere in the Sibiu box, unknown to the fixture router so it is drawn as a straight line)
 * on a random day 2 to 12 days ahead, and asserts on the rides it created, never on exact result
 * lists of a shared area. The first request after start-up may take a few seconds (cold start).
 *
 * Tests that need the database directly (blocks have no endpoint before E5, analytics rows, the
 * 500-ride performance run) connect as the local superuser:
 *   INT_DB_URL   default postgresql://postgres:postgres@127.0.0.1:54322/postgres (the `supabase start` DB)
 *   INT_DB=skip  skips every test that needs it
 * Performance test knobs:
 *   SEARCH_P95_MS   p95 budget in milliseconds, default 300 (local budget; production budget is 2 s)
 *   SEARCH_PERF     "skip" does not run it; "soft" runs it and only warns when the budget is missed
 *                   (for a slow shared runner). Unset: the budget is enforced.
 */
const DB_URL = process.env.INT_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DB_SKIP = process.env.INT_DB === 'skip';
const PERF_MODE = process.env.SEARCH_PERF ?? 'hard';
const P95_BUDGET_MS = Number(process.env.SEARCH_P95_MS ?? 300);
const RATE_MICRO_DIESEL = 651_000; // energy price v1, diesel 6.00 l/100 km at 10.85 RON/l

type Point = { lat: number; lng: number };
type Lane = { from: Point; to: Point };

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

/**
 * A random straight ride of about 4 km (5.2 km by the fixture router) inside the coverage box. It is
 * slanted on purpose: an axis-aligned lane would share its latitude with its trimmed public route,
 * and the no-exact-coordinate check compares numbers.
 */
const LANE_DLAT = 0.008;
const LANE_DLNG = 0.05;
function lane(): Lane {
  const lat = r5(45.7 + Math.random() * 0.14);
  const lng = r5(24.0 + Math.random() * 0.2);
  return { from: { lat, lng }, to: { lat: r5(lat + LANE_DLAT), lng: r5(lng + LANE_DLNG) } };
}

const shiftLat = (l: Lane, dLat: number): Lane => ({
  from: { lat: r5(l.from.lat + dLat), lng: l.from.lng },
  to: { lat: r5(l.to.lat + dLat), lng: l.to.lng },
});

type Slot = { dayKey: string; time: string; at: Date };

/** A random Bucharest day 2 to 12 days ahead at `hour`:minute. */
function slot(hour = 10 + Math.floor(Math.random() * 7), minute = 0): Slot {
  const day = bucharestDayKey(
    new Date(Date.now() + (2 + Math.floor(Math.random() * 11)) * 86_400_000),
  );
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { dayKey: day, time, at: bucharestLocalToUtc(day, time) };
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const plusMin = (s: Slot, min: number): Date => new Date(s.at.getTime() + min * 60_000);

const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;

async function publish(driver: TestUser, l: Lane, departureAt: Date, seats = 3, isFree = false) {
  const pRes = await driver.send('POST', '/rides/preview', { origin: l.from, destination: l.to });
  expect(pRes.status).toBe(200);
  const preview = previewResponseSchema.parse(await pRes.json());
  const res = await driver.send('POST', '/rides', {
    previewId: preview.previewId,
    departureAt: iso(departureAt),
    seats,
    isFree,
  });
  expect(res.status).toBe(201);
  return { ride: rideOwnerViewSchema.parse(await res.json()), preview };
}

const searchBody = (l: Lane, s: Slot, windowMin = 30) => ({
  from: l.from,
  to: l.to,
  date: s.dayKey,
  time: s.time,
  windowMin,
});

async function search(who: TestUser | null, body: unknown): Promise<Response> {
  if (who) return who.send('POST', '/search', body);
  return fetch(`${BASE}/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function searchOk(who: TestUser | null, body: unknown) {
  const res = await search(who, body);
  expect(res.status).toBe(200);
  return searchResponseSchema.parse(await res.json());
}

const ids = (items: readonly SearchItem[]) => items.map((i) => i.rideId);

/** Every number found anywhere in a JSON value. */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(numbersIn);
  return [];
}

/** JSON paths (`$.items[0].pickup.point.lat=45.7`) of every number in `value` that is in `bad`. */
function pathsOfNumbers(value: unknown, bad: ReadonlySet<number>, path = '$'): string[] {
  if (typeof value === 'number') return bad.has(value) ? [`${path}=${value}`] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => pathsOfNumbers(v, bad, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => pathsOfNumbers(v, bad, `${path}.${k}`));
  }
  return [];
}

const isGridCentre = (p: Point) => {
  const g = gridPoint(p, 300);
  return g.lat === p.lat && g.lng === p.lng;
};

describe.skipIf(!BASE || !SECRET)('search and matching against the local stack', () => {
  it('signed out: finds a published ride, prices it server-side, shows approximate points only', async () => {
    const driver = await createUser();
    const l = lane();
    const s = slot();
    const { ride, preview } = await publish(driver, l, s.at);

    // no token; a price sent by the client is ignored
    const out = await searchOk(null, { ...searchBody(l, s), priceBani: 1, price: 1 });
    const item = out.items.find((i) => i.rideId === ride.id);
    expect(item).toBeDefined();
    if (!item) return;

    // from and to are the ride's own ends: the whole route is the segment
    expect(Math.abs(item.segmentM - preview.distanceM)).toBeLessThanOrEqual(2);
    // "up to" = alone with the driver, from the rate snapshot (diesel v1), computed on the segment
    expect(item.priceUpToBani).toBe(quoteUpTo(item.segmentM, RATE_MICRO_DIESEL, false));
    expect(item.priceUpToBani % 10).toBe(0);
    expect(item.priceUpToBani).toBeGreaterThan(0);
    expect(item).toMatchObject({
      isFree: false,
      seatsLeft: 3,
      driver: { id: driver.id, firstName: 'Radu' },
      pickup: { walkM: expect.any(Number), point: { approx: true, radiusM: 300 } },
      dropoff: { point: { approx: true, radiusM: 300 } },
    });
    expect(item.pickup.label.length).toBeGreaterThan(0);
    expect(item.dropoff.label.length).toBeGreaterThan(0);
    expect(item.pickup.walkM % 50).toBe(0);
    expect(item.dropoff.walkM % 50).toBe(0);
    expect(item.pickup.walkM).toBeLessThanOrEqual(50);
    expect(new Date(item.departureAt).getTime()).toBe(s.at.getTime());
    // the driver passes the pickup at departure (f = 0): ETA within the 5 minute rounding of it
    expect(new Date(item.pickupEtaAt).getTime() % 300_000).toBe(0);
    expect(Math.abs(new Date(item.pickupEtaAt).getTime() - s.at.getTime())).toBeLessThanOrEqual(
      150_000,
    );
    // the window had a hit, so the empty-state list is empty
    expect(out.nearestOutsideWindow).toEqual([]);
    expect(out.hiddenBlockedCount).toBe(0);
  });

  it('a free ride is offered at 0 RON', async () => {
    const driver = await createUser();
    const l = lane();
    const s = slot();
    const { ride } = await publish(driver, l, s.at, 2, true);
    const out = await searchOk(null, searchBody(l, s));
    const item = out.items.find((i) => i.rideId === ride.id);
    expect(item).toMatchObject({ isFree: true, priceUpToBani: 0, seatsLeft: 2 });
  });

  it('never returns exact coordinates, the plate or the phone: every point is a grid centre', async () => {
    const driver = await createUser();
    const viewer = await createBareUser();
    const l = lane();
    const s = slot();
    const { ride } = await publish(driver, l, s.at);

    // what is really stored (owner view): exact origin, destination and every route vertex
    const exact = numbersIn([ride.origin.point, ride.destination.point, ride.route.coordinates]);
    expect(exact.length).toBeGreaterThanOrEqual(8);

    // typed points a little off the ride so that the typed values differ from the stored ones too
    const typedFrom = { lat: r5(l.from.lat + 0.0008), lng: r5(l.from.lng + 0.0004) };
    const typedTo = { lat: r5(l.to.lat - 0.0008), lng: r5(l.to.lng - 0.0004) };
    const body = { ...searchBody(l, s), from: typedFrom, to: typedTo };

    const searchRes = await search(viewer, body);
    const searchText = await searchRes.text();
    const matchRes = await viewer.send('POST', `/rides/${ride.id}/match`, {
      from: typedFrom,
      to: typedTo,
    });
    const matchText = await matchRes.text();
    const publicRes = await viewer.call(`/rides/${ride.id}`);
    const publicText = await publicRes.text();
    expect([searchRes.status, matchRes.status, publicRes.status]).toEqual([200, 200, 200]);

    const found = searchResponseSchema
      .parse(JSON.parse(searchText))
      .items.find((i) => i.rideId === ride.id);
    expect(found).toBeDefined();
    const match = matchResponseSchema.parse(JSON.parse(matchText));
    const publicRide = ridePublicViewSchema.parse(JSON.parse(publicText));

    const points: Point[] = [
      found?.pickup.point,
      found?.dropoff.point,
      match.pickup?.point,
      match.dropoff?.point,
      publicRide.origin.point,
      publicRide.destination.point,
    ].filter((p): p is NonNullable<typeof p> => p !== undefined && p !== null);
    expect(points).toHaveLength(6);
    for (const p of points) expect(isGridCentre({ lat: p.lat, lng: p.lng })).toBe(true);

    // no number in any response equals a stored coordinate or a typed one
    const typed = numbersIn([typedFrom, typedTo]);
    // (a stored value may coincide with a returned grid centre by chance: that is not a leak)
    const gridNumbers = new Set(points.flatMap((p) => [p.lat, p.lng]));
    // The only intended exception is the public route's INTERIOR vertices (api-contract: trimmed
    // at both ends, simplified at 25 m): they are points of the road, checked separately below.
    // The failure message names the JSON path of any offending number.
    const forbidden = new Set([...exact, ...typed].filter((e) => !gridNumbers.has(e)));
    const withoutRoute = (text: string): unknown => {
      const v = JSON.parse(text) as Record<string, unknown>;
      return 'routePublic' in v ? { ...v, routePublic: null } : v;
    };
    for (const [name, text] of [
      ['search', searchText],
      ['match', matchText],
      ['public', publicText],
    ] as const) {
      const hits = pathsOfNumbers(withoutRoute(text), forbidden);
      expect(hits, `${name} contains exact or typed numbers at: ${hits.join(', ')}`).toEqual([]);
      expect(text).not.toContain('SB12ABC');
      expect(text).not.toContain('plate');
      expect(text).not.toContain('+4072');
      expect(text).not.toContain('phone');
    }
    // search and match carry no route at all
    expect(searchText).not.toContain('routePublic');
    expect(matchText).not.toContain('routePublic');
    // The public route is trimmed (min(500 m, 10 %) at both ends): no vertex is within 300 m of the
    // stored start or end, nor of a typed point.
    expect(publicRide.routePublic).not.toBeNull();
    const metres = (a: Point, b: Point) =>
      Math.hypot(
        (a.lat - b.lat) * 111_000,
        (a.lng - b.lng) * 111_000 * Math.cos((a.lat * Math.PI) / 180),
      );
    for (const c of publicRide.routePublic?.coordinates ?? []) {
      const v = { lat: c[1] as number, lng: c[0] as number };
      for (const e of [ride.origin.point, ride.destination.point, typedFrom, typedTo]) {
        expect(metres(v, e), `public route vertex ${JSON.stringify(c)}`).toBeGreaterThan(300);
      }
    }
  });

  it('walks are rounded to 50 m and measured from the typed point to the road', async () => {
    const driver = await createUser();
    const l = lane();
    const s = slot();
    const { ride } = await publish(driver, l, s.at);
    // 0.0011 degrees of latitude is about 122 m north of the ride's start
    const body = {
      ...searchBody(l, s),
      from: { lat: r5(l.from.lat + 0.0011), lng: l.from.lng },
    };
    const out = await searchOk(null, body);
    const item = out.items.find((i) => i.rideId === ride.id);
    expect(item).toBeDefined();
    expect(item?.pickup.walkM).toBeGreaterThanOrEqual(100);
    expect(item?.pickup.walkM).toBeLessThanOrEqual(150);
    expect(item?.pickup.walkM ?? 1).toBe(Math.round((item?.pickup.walkM ?? 1) / 50) * 50);
  });

  it('orders by total walk first, then by time: the closer ride wins even when it leaves later', async () => {
    const [a, b, c] = await Promise.all([createUser(), createUser(), createUser()]);
    const l = lane();
    const s = slot();
    // X and Z on the lane (Z leaves 10 min later); Y about 330 m north of it, leaving at the desired time
    const x = (await publish(a, l, plusMin(s, -5))).ride.id;
    const z = (await publish(b, l, plusMin(s, 10))).ride.id;
    const y = (await publish(c, shiftLat(l, 0.003), s.at)).ride.id;

    const out = await searchOk(null, searchBody(l, s));
    const mine = ids(out.items).filter((id) => [x, y, z].includes(id));
    expect(mine).toEqual([x, z, y]);
    const walks = out.items
      .filter((i) => [x, y, z].includes(i.rideId))
      .map((i) => i.pickup.walkM + i.dropoff.walkM);
    expect(walks[0]).toBeLessThan(walks[2] as number);
  });

  it('time window: inside it the ride is found, outside it is not; the window edge is inclusive', async () => {
    const driver = await createUser();
    const l = lane();
    const s = slot(11, 0);
    const { ride } = await publish(driver, l, s.at);
    // searching 30 min before departure: windows of 15 miss it, 30 (edge) and 60 find it
    const early = { ...searchBody(l, s), time: '10:30' };
    expect(ids((await searchOk(null, { ...early, windowMin: 15 })).items)).not.toContain(ride.id);
    expect(ids((await searchOk(null, { ...early, windowMin: 30 })).items)).toContain(ride.id);
    expect(ids((await searchOk(null, { ...early, windowMin: 60 })).items)).toContain(ride.id);
  });

  it('the direction matters: the reverse trip finds nothing', async () => {
    const driver = await createUser();
    const l = lane();
    const s = slot();
    const { ride } = await publish(driver, l, s.at);
    expect(ids((await searchOk(null, searchBody(l, s))).items)).toContain(ride.id);
    const reverse = await searchOk(null, searchBody({ from: l.to, to: l.from }, s));
    expect(ids(reverse.items)).not.toContain(ride.id);
  });

  it('own rides and cancelled rides are excluded; the same ride is visible to others', async () => {
    const driver = await createUser();
    const other = await createBareUser();
    const l = lane();
    const s = slot();
    const { ride } = await publish(driver, l, s.at);

    expect(ids((await searchOk(driver, searchBody(l, s))).items)).not.toContain(ride.id);
    expect(ids((await searchOk(other, searchBody(l, s))).items)).toContain(ride.id);

    expect((await driver.send('POST', `/rides/${ride.id}/cancel`, {})).status).toBe(200);
    expect(ids((await searchOk(other, searchBody(l, s))).items)).not.toContain(ride.id);
    expect(ids((await searchOk(null, searchBody(l, s))).items)).not.toContain(ride.id);
  });

  it('empty window: the nearest rides of the same day appear, never rides of another day', async () => {
    const driver = await createUser();
    const l = lane();
    const s = slot(8, 0); // the ride leaves at 08:00
    const { ride } = await publish(driver, l, s.at);
    // another day, same time: must not show up in the empty state
    const otherDay = new Date(s.at.getTime() + 86_400_000);
    const second = await publish(driver, l, otherDay);

    const noon = { ...searchBody(l, s), time: '12:00', windowMin: 15 };
    const out = await searchOk(null, noon);
    expect(out.items).toEqual([]);
    expect(ids(out.nearestOutsideWindow)).toContain(ride.id);
    expect(ids(out.nearestOutsideWindow)).not.toContain(second.ride.id);
    expect(out.nearestOutsideWindow.length).toBeLessThanOrEqual(3);
    // same card shape, same privacy
    for (const i of out.nearestOutsideWindow) {
      expect(i.pickup.point.approx).toBe(true);
      expect(i.priceUpToBani).toBeGreaterThan(0);
    }
    // a window that covers the ride: found, and the empty-state list is empty again
    const covering = await searchOk(null, { ...noon, time: '08:10', windowMin: 15 });
    expect(ids(covering.items)).toContain(ride.id);
    expect(covering.nearestOutsideWindow).toEqual([]);
  });

  it('validation: points outside Sibiu, points under 1 km apart, bad window, date and time', async () => {
    const user = await createBareUser();
    const l = lane();
    const s = slot();
    const base = searchBody(l, s);
    const cases: [string, object, number, string, string | undefined][] = [
      [
        'from outside the box',
        { ...base, from: { lat: 46.5, lng: 24.1 } },
        400,
        'VALIDATION_FAILED',
        'from',
      ],
      [
        'to outside the box',
        { ...base, to: { lat: 45.75, lng: 25.5 } },
        400,
        'VALIDATION_FAILED',
        'to',
      ],
      [
        'points 450 m apart',
        { ...base, to: { lat: l.from.lat, lng: r5(l.from.lng + 0.006) } },
        400,
        'SAME_PLACE',
        'to',
      ],
      ['window 45', { ...base, windowMin: 45 }, 400, 'VALIDATION_FAILED', 'windowMin'],
      ['date format', { ...base, date: '16/11/2026' }, 400, 'VALIDATION_FAILED', 'date'],
      ['time format', { ...base, time: '9:5' }, 400, 'VALIDATION_FAILED', 'time'],
      ['date in the past', { ...base, date: '2020-01-01' }, 400, 'VALIDATION_FAILED', 'date'],
      ['no body at all', {}, 400, 'VALIDATION_FAILED', 'from'],
    ];
    for (const [name, body, status, code, field] of cases) {
      const res = await search(user, body);
      expect(res.status, name).toBe(status);
      const err = await errorOf(res);
      expect(err.code, name).toBe(code);
      if (field) expect(err.fields, name).toHaveProperty(field);
    }
    // not JSON
    const bad = await user.call('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    });
    expect(bad.status).toBe(400);
  });

  it('rate limit: the 31st search within a minute is 429 with Retry-After (30 per user)', async () => {
    const user = await createBareUser();
    // the limiter runs before validation, so cheap invalid bodies are enough
    // (the window is a fixed minute: a loop that straddles a minute boundary needs up to 60 requests)
    let limited: Response | null = null;
    let allowed = 0;
    for (let i = 0; i < 70; i++) {
      const res = await search(user, {});
      if (res.status === 429) {
        limited = res;
        break;
      }
      expect(res.status).toBe(400);
      allowed += 1;
      await res.text();
    }
    expect(allowed).toBeGreaterThanOrEqual(1);
    expect(limited).not.toBeNull();
    expect(limited?.headers.get('retry-after')).toBe('60');
    expect((await errorOf(limited as Response)).code).toBe('RATE_LIMITED');
    // another user is not affected
    const fresh = await createBareUser();
    expect((await search(fresh, {})).status).toBe(400);
  });

  describe('POST /rides/{id}/match', () => {
    it('signed out: the passenger view with the same price as the search card', async () => {
      const driver = await createUser();
      const l = lane();
      const s = slot();
      const { ride } = await publish(driver, l, s.at);
      const card = (await searchOk(null, searchBody(l, s))).items.find((i) => i.rideId === ride.id);
      expect(card).toBeDefined();

      const res = await fetch(`${BASE}/rides/${ride.id}/match`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: l.from, to: l.to }),
      });
      expect(res.status).toBe(200);
      const m = matchResponseSchema.parse(await res.json());
      expect(m).toMatchObject({
        bookable: true,
        notBookableReason: null,
        seatsLeft: 3,
        segmentM: card?.segmentM,
        priceUpToBani: card?.priceUpToBani,
        pickupEtaAt: card?.pickupEtaAt,
      });
      expect(m.pickup).toEqual(card?.pickup);
      expect(m.dropoff).toEqual(card?.dropoff);
    });

    it('names the reason: own ride, points that no longer fit; 404 for unknown and cancelled rides', async () => {
      const driver = await createUser();
      const passenger = await createBareUser();
      const l = lane();
      const s = slot();
      const { ride } = await publish(driver, l, s.at);
      const body = { from: l.from, to: l.to };

      const own = matchResponseSchema.parse(
        await (await driver.send('POST', `/rides/${ride.id}/match`, body)).json(),
      );
      expect(own).toMatchObject({ bookable: false, notBookableReason: 'OWN_RIDE' });

      // reverse direction: the ride no longer fits, and no place or price is given
      const reverse = matchResponseSchema.parse(
        await (
          await passenger.send('POST', `/rides/${ride.id}/match`, { from: l.to, to: l.from })
        ).json(),
      );
      expect(reverse).toEqual({
        pickup: null,
        dropoff: null,
        segmentM: null,
        priceUpToBani: null,
        pickupEtaAt: null,
        seatsLeft: 3,
        bookable: false,
        notBookableReason: 'NO_LONGER_MATCHES',
      });

      const unknown = await passenger.send('POST', `/rides/${crypto.randomUUID()}/match`, body);
      expect(unknown.status).toBe(404);
      expect((await errorOf(unknown)).code).toBe('NOT_FOUND');
      expect((await passenger.send('POST', '/rides/not-a-uuid/match', body)).status).toBe(404);
      expect(
        (await passenger.send('POST', `/rides/${ride.id}/match`, { from: l.from })).status,
      ).toBe(400);

      expect((await driver.send('POST', `/rides/${ride.id}/cancel`, {})).status).toBe(200);
      const cancelled = await passenger.send('POST', `/rides/${ride.id}/match`, body);
      expect(cancelled.status).toBe(404);
    });
  });
});

// ---- tests that need the database directly ---------------------------------------------------------------

describe.skipIf(!BASE || !SECRET || DB_SKIP)('search against the database', () => {
  let sql: postgres.Sql;
  beforeAll(() => {
    sql = postgres(DB_URL, { max: 2, connect_timeout: 15, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('blocks hide a ride in both directions: search (with a count), detail and match', async () => {
    const driver = await createUser();
    const passenger = await createUser({ firstName: 'Ioana' });
    const l = lane();
    const s = slot();
    const { ride } = await publish(driver, l, s.at);
    const body = { from: l.from, to: l.to };

    const visible = async () => {
      const out = await searchOk(passenger, searchBody(l, s));
      const detail = await passenger.call(`/rides/${ride.id}`);
      const match = await passenger.send('POST', `/rides/${ride.id}/match`, body);
      return { out, detail: detail.status, match: match.status };
    };

    try {
      const before = await visible();
      expect(ids(before.out.items)).toContain(ride.id);
      expect([before.detail, before.match]).toEqual([200, 200]);

      // the passenger blocks the driver
      await sql`insert into app.blocks (blocker_id, blocked_id) values (${passenger.id}::uuid, ${driver.id}::uuid)`;
      const a = await visible();
      expect(ids(a.out.items)).not.toContain(ride.id);
      expect(ids(a.out.nearestOutsideWindow)).not.toContain(ride.id);
      expect(a.out.hiddenBlockedCount).toBeGreaterThanOrEqual(1);
      expect([a.detail, a.match]).toEqual([404, 404]);
      // signed out, the ride is still public
      expect(ids((await searchOk(null, searchBody(l, s))).items)).toContain(ride.id);
      await sql`delete from app.blocks where blocker_id = ${passenger.id}::uuid`;

      // the driver blocks the passenger: hidden the same way, and nothing reveals who blocked whom
      await sql`insert into app.blocks (blocker_id, blocked_id) values (${driver.id}::uuid, ${passenger.id}::uuid)`;
      const b = await visible();
      expect(ids(b.out.items)).not.toContain(ride.id);
      expect(b.out.hiddenBlockedCount).toBeGreaterThanOrEqual(1);
      expect([b.detail, b.match]).toEqual([404, 404]);
      await sql`delete from app.blocks where blocker_id = ${driver.id}::uuid`;

      const after = await visible();
      expect(ids(after.out.items)).toContain(ride.id);
      expect([after.detail, after.match]).toEqual([200, 200]);
    } finally {
      await sql`delete from app.blocks where blocker_id in (${passenger.id}::uuid, ${driver.id}::uuid)`;
    }
  });

  it('a suspended driver disappears from search, detail and match', async () => {
    const driver = await createUser();
    const passenger = await createBareUser();
    const l = lane();
    const s = slot();
    const { ride } = await publish(driver, l, s.at);
    try {
      await sql`update app.profiles set status = 'suspended' where id = ${driver.id}::uuid`;
      expect(ids((await searchOk(passenger, searchBody(l, s))).items)).not.toContain(ride.id);
      expect((await passenger.call(`/rides/${ride.id}`)).status).toBe(404);
      expect(
        (await passenger.send('POST', `/rides/${ride.id}/match`, { from: l.from, to: l.to }))
          .status,
      ).toBe(404);
    } finally {
      await sql`update app.profiles set status = 'active' where id = ${driver.id}::uuid`;
    }
  });

  it('a full ride is not offered in search and the match names RIDE_FULL', async () => {
    const driver = await createUser();
    const passenger = await createBareUser();
    const l = lane();
    const s = slot();
    const { ride } = await publish(driver, l, s.at, 2);
    await sql`update app.rides set seats_booked = seats_offered where id = ${ride.id}::uuid`;
    expect(ids((await searchOk(passenger, searchBody(l, s))).items)).not.toContain(ride.id);
    const m = matchResponseSchema.parse(
      await (
        await passenger.send('POST', `/rides/${ride.id}/match`, { from: l.from, to: l.to })
      ).json(),
    );
    expect(m).toMatchObject({ bookable: false, notBookableReason: 'RIDE_FULL', seatsLeft: 0 });
    // the points still fit, so the card details are still there
    expect(m.priceUpToBani).toBeGreaterThan(0);
  });

  it('logs search_performed with a count, area labels and the corridor, and no coordinates', async () => {
    const user = await createBareUser();
    const l = lane();
    const s = slot();
    await searchOk(user, searchBody(l, s, 60));
    const rows = await sql<{ props: Record<string, unknown>; user_id: string | null }[]>`
      select props, user_id from app.analytics_events
      where name = 'search_performed' and user_id = ${user.id}::uuid
      order by id desc limit 1`;
    expect(rows).toHaveLength(1);
    const props = rows[0]?.props ?? {};
    expect(Object.keys(props).sort()).toEqual([
      'corridor',
      'fromArea',
      'resultsCount',
      'toArea',
      'windowMin',
    ]);
    expect(props.windowMin).toBe(60);
    expect(typeof props.resultsCount).toBe('number');
    expect(['south', 'west', 'campus', 'other']).toContain(props.corridor);
    // area names only: the two counts are the only numbers in the payload
    expect(numbersIn(props)).toHaveLength(2);
    expect(JSON.stringify(props)).not.toMatch(/lat|lng|\d\d\.\d/);

    // signed out: the event has no user
    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from app.analytics_events where name = 'search_performed' and user_id is null`;
    await searchOk(null, searchBody(l, s));
    const after = await sql<{ n: number }[]>`
      select count(*)::int as n from app.analytics_events where name = 'search_performed' and user_id is null`;
    expect((after[0]?.n ?? 0) - (before[0]?.n ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it.skipIf(PERF_MODE === 'skip')(
    'performance: 500 published rides in one window, POST /search p95 under budget',
    { timeout: 90_000 },
    async () => {
      const l = lane();
      const s = slot(12, 0);
      const tag = `perf-${crypto.randomUUID().slice(0, 8)}`;
      const dLng = r5(l.to.lng - l.from.lng);
      const dLat = r5(l.to.lat - l.from.lat);
      await sql`
        insert into app.profiles (id, bio)
        select gen_random_uuid(), ${tag}::text from generate_series(1, 25)`;
      try {
        // 500 rides, 60-vertex routes with some wobble, lateral offsets up to about 280 m, departures
        // spread over +-20 min of the desired time: every one of them is a candidate for the geometry stage
        const inserted = await sql`
          insert into app.rides
            (driver_id, origin, destination, origin_label, destination_label, route, distance_m,
             duration_s, departure_at, seats_offered, energy_price_id, rate_micro_per_km, vehicle_snapshot)
          select d.id, ST_StartPoint(r.g), ST_EndPoint(r.g), ${tag}::text, ${tag}::text, r.g, 5000, 600,
                 ${iso(s.at)}::timestamptz + ((s.i % 41) - 20) * interval '1 minute', 3,
                 (select id from app.energy_prices where fuel_type = 'diesel' limit 1), 651000,
                 '{"make":"Dacia","model":"Logan","colour":"Grey","plate":"SB12ABC","fuelType":"diesel"}'::jsonb
          from generate_series(0, 499) s(i)
          join (select id, row_number() over (order by id) as rn from app.profiles where bio = ${tag}::text) d
            on d.rn = 1 + (s.i % 25)
          cross join lateral (
            select ((s.i % 7) - 3) * 0.0005 as dx, ((s.i % 11) - 5) * 0.0005 as dy) o
          cross join lateral (
            select ST_SetSRID(ST_MakeLine(array(
              select ST_MakePoint(
                       ${l.from.lng}::float8 + o.dx + k * ${dLng}::float8 / 59.0,
                       ${l.from.lat}::float8 + o.dy + k * ${dLat}::float8 / 59.0
                         + 0.0003 * sin((k * 0.7 + s.i)::float8))
              from generate_series(0, 59) k order by k)), 4326) as g) r
          returning 1`;
        expect(inserted).toHaveLength(500);
        await sql`analyze app.rides`;

        const user = await createBareUser(); // 1 warm-up + 25 timed requests stay under 30 per minute
        const body = searchBody(l, s, 60);
        const warm = await searchOk(user, body);
        expect(warm.items).toHaveLength(50);

        const times: number[] = [];
        for (let i = 0; i < 25; i++) {
          const t0 = performance.now();
          const res = await user.send('POST', '/search', body);
          const text = await res.text();
          times.push(performance.now() - t0);
          expect(res.status).toBe(200);
          const out = searchResponseSchema.parse(JSON.parse(text));
          expect(out.items).toHaveLength(50);
          // sorted by total walk, as promised
          const walk = out.items.map((it) => it.pickup.walkM + it.dropoff.walkM);
          expect([...walk].sort((x, y) => x - y)).toEqual(walk);
        }
        times.sort((x, y) => x - y);
        const p95 = times[Math.ceil(0.95 * times.length) - 1] as number;
        const median = times[Math.floor(times.length / 2)] as number;
        console.log(
          `search perf (500 rides in window): median ${median.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, max ${(times.at(-1) ?? 0).toFixed(0)} ms, budget ${P95_BUDGET_MS} ms, mode ${PERF_MODE}`,
        );
        if (PERF_MODE === 'soft') {
          if (p95 >= P95_BUDGET_MS)
            console.warn(`PERF SOFT-FAIL: p95 ${p95.toFixed(0)} ms >= ${P95_BUDGET_MS} ms`);
        } else {
          expect(p95).toBeLessThan(P95_BUDGET_MS);
        }
      } finally {
        await sql`delete from app.rides where origin_label = ${tag}::text`;
        await sql`delete from app.profiles where bio = ${tag}::text`;
      }
    },
  );
});
