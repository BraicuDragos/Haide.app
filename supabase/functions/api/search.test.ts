import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from '../_shared/contracts/errors.ts';
import {
  matchResponseSchema,
  searchItemSchema,
  searchResponseSchema,
} from '../_shared/contracts/search.ts';
import { fixedClock } from '../_shared/domain/clock.ts';
import { BASE, makeApp, signToken, type Handler, type Query } from './testing.ts';

const USER = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';
const DRIVER = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const RIDE_ID = '5b0c7f0e-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const RIDE_2 = '6c1d8a1f-7b2e-4d22-9e3f-a04b5c6d7e8f';
const RIDE_3 = '7d2e9b20-8c3f-4e33-8f40-b15c6d7e8f90';
const RIDE_4 = '8e3fac31-9d40-4f44-9051-c26d7e8f90a1';
const PLATE = 'SB12ABC';

// Shopping City to Zona Industrială Vest (Trip B); the typed points are a little off the route.
const FROM = { lat: 45.7416, lng: 24.1858 };
const TO = { lat: 45.7851, lng: 24.0903 };
const BODY = { from: FROM, to: TO, date: '2026-11-16', time: '07:30', windowMin: 30 };

// positions of the parameters of app.match_rides in the recorded query
const P = {
  fromAt: 4,
  toAt: 5,
  desiredAt: 6,
  searcher: 7,
  now: 8,
  rideId: 9,
  includeBlocked: 10,
  excludeFrom: 11,
  excludeTo: 12,
  limit: 15,
} as const;

const matchRow = (over: Record<string, unknown> = {}) => ({
  ride_id: RIDE_ID,
  driver_id: DRIVER,
  ride_status: 'published',
  departure_at: new Date('2026-11-16T05:25:00Z'),
  duration_s: 1020,
  distance_m: 9588,
  seats_offered: 3,
  seats_booked: 1,
  is_free: false,
  rate_micro_per_km: 651000,
  segment_m: 9588,
  walk_pickup_m: 123.4,
  walk_dropoff_m: 76.9,
  pickup_eta_at: new Date('2026-11-16T05:27:10Z'),
  pickup_lat: 45.7413,
  pickup_lng: 24.1861,
  dropoff_lat: 45.785,
  dropoff_lng: 24.09,
  pickup_area: 'Șelimbăr',
  dropoff_area: 'Zona Industrială Vest',
  blocked: false,
  ...over,
});

const profileRow = (over: Record<string, unknown> = {}) => ({
  id: DRIVER,
  first_name: 'Radu',
  bio: 'secret bio',
  photo_path: null,
  status: 'active',
  created_at: new Date('2026-10-01T10:00:00Z'),
  rating_count: 23,
  rating_avg: 4.84,
  late_cancellations: 0,
  no_shows: 0,
  ...over,
});

const publicRow = (over: Record<string, unknown> = {}) => ({
  id: RIDE_ID,
  status: 'published',
  departure_at: new Date('2026-11-16T07:00:00Z'),
  duration_s: 1020,
  distance_m: 9588,
  seats_offered: 3,
  seats_booked: 1,
  note: null,
  is_free: false,
  rate_micro_per_km: 651000,
  driver_id: DRIVER,
  driver_status: 'active',
  car: { make: 'Dacia', model: 'Logan', colour: 'Grey' },
  origin_lat: 45.74,
  origin_lng: 24.1862,
  destination_lat: 45.7855,
  destination_lng: 24.0905,
  origin_area: 'Șelimbăr',
  destination_area: 'Zona Industrială Vest',
  route_public: null,
  blocked: false,
  ...over,
});

type Opts = {
  /** Answers app.match_rides. Receives the recorded query so it can tell the calls apart. */
  rides?: (q: Query) => Record<string, unknown>[];
  publicRide?: Record<string, unknown> | null;
  profiles?: Record<string, unknown>[];
  rateAllowed?: boolean;
  eventFails?: boolean;
};

function searchDb(opts: Opts = {}) {
  const handler: Handler = (q) => {
    const t = q.text;
    if (t.includes('app.rate_limit_hit')) return [{ allowed: opts.rateAllowed ?? true }];
    if (t.includes('from app.match_rides')) return (opts.rides ?? (() => [matchRow()]))(q);
    if (t.includes('as route_public')) {
      const row = opts.publicRide === undefined ? publicRow() : opts.publicRide;
      return row ? [row] : [];
    }
    if (t.includes('rating_count')) return opts.profiles ?? [profileRow()];
    if (t.includes('ST_DWithin(pl.geom')) {
      return [{ area_id: 'a1', area_name: 'Șelimbăr', place_name: null }];
    }
    if (t.startsWith('insert into app.analytics_events')) {
      if (opts.eventFails) throw new Error('events are down');
      return [];
    }
    return undefined;
  };
  return handler;
}

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const auth = async (sub = USER) => ({
  authorization: `Bearer ${await signToken(sub, { email: 'it@example.com' })}`,
});
const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;
const matchCalls = (calls: Query[]) => calls.filter((c) => c.text.includes('from app.match_rides'));

// ---- POST /search -------------------------------------------------------------------------------------

describe('POST /search', () => {
  it('works signed out and returns a result card the client can render', async () => {
    const { app, calls } = makeApp([searchDb()]);
    const res = await app.request(`${BASE}/search`, post(BODY));
    expect(res.status).toBe(200);
    const text = await res.text();
    const out = searchResponseSchema.parse(JSON.parse(text));
    expect(out.hiddenBlockedCount).toBe(0);
    expect(out.nearestOutsideWindow).toEqual([]);
    expect(out.items).toHaveLength(1);
    const item = searchItemSchema.parse(out.items[0]);
    expect(item).toMatchObject({
      rideId: RIDE_ID,
      departureAt: '2026-11-16T05:25:00.000Z',
      // 05:27:10 rounds to the nearest 5 minutes
      pickupEtaAt: '2026-11-16T05:25:00.000Z',
      segmentM: 9588,
      // Trip B, diesel, alone with the driver: 3.10 RON (pricing.md section 5)
      priceUpToBani: 310,
      isFree: false,
      seatsLeft: 2,
      pickup: { label: 'Șelimbăr', walkM: 100, point: { approx: true, radiusM: 300 } },
      dropoff: { label: 'Zona Industrială Vest', walkM: 100 },
      driver: { id: DRIVER, firstName: 'Radu', rating: { average: 4.8, count: 23 } },
    });
    // signed out: no searcher id reaches the database
    expect(matchCalls(calls)[0]?.values[P.searcher]).toBeNull();
    // nothing private or exact in the payload
    for (const bad of [
      PLATE,
      'plate',
      'phone',
      'secret bio',
      '123.4',
      '76.9',
      '45.7416',
      '24.1858',
    ]) {
      expect(text).not.toContain(bad);
    }
    // the exact walk distances and the rate snapshot do not leave either
    expect(text).not.toContain('rate');
    expect(text).not.toContain('fraction');
  });

  it('converts Bucharest date and time to the UTC window and passes the caller as searcher', async () => {
    const { app, calls } = makeApp([searchDb()]);
    const res = await app.request(`${BASE}/search`, post(BODY, await auth()));
    expect(res.status).toBe(200);
    const q = matchCalls(calls)[0];
    expect(q).toBeDefined();
    // 2026-11-16 07:30 Europe/Bucharest (UTC+2) = 05:30Z, window 30 min
    expect(q?.values[P.fromAt]).toEqual(new Date('2026-11-16T05:00:00Z'));
    expect(q?.values[P.toAt]).toEqual(new Date('2026-11-16T06:00:00Z'));
    expect(q?.values[P.desiredAt]).toEqual(new Date('2026-11-16T05:30:00Z'));
    expect(q?.values[P.searcher]).toBe(USER);
    expect(q?.values[P.now]).toEqual(new Date('2026-11-16T05:00:00Z'));
    expect(q?.values[P.rideId]).toBeNull();
    expect(q?.values[P.limit]).toBe(50);
    // coordinates travel in the body, never in the URL
    expect(res.url).not.toContain('45.74');
  });

  it('defaults the window to 30 minutes', async () => {
    const { app, calls } = makeApp([searchDb()]);
    const { windowMin: _drop, ...noWindow } = BODY;
    expect((await app.request(`${BASE}/search`, post(noWindow))).status).toBe(200);
    const q = matchCalls(calls)[0];
    expect(q?.values[P.toAt]).toEqual(new Date('2026-11-16T06:00:00Z'));
  });

  it('prices from the ride snapshot and ignores any price sent by the client', async () => {
    const rows = [
      matchRow({ ride_id: RIDE_ID, is_free: true }),
      matchRow({ ride_id: RIDE_2, segment_m: 5000, rate_micro_per_km: 686700 }),
    ];
    const { app } = makeApp([searchDb({ rides: () => rows })]);
    const res = await app.request(`${BASE}/search`, post({ ...BODY, priceBani: 1, price: 1 }));
    const out = searchResponseSchema.parse(await res.json());
    expect(out.items[0]).toMatchObject({ isFree: true, priceUpToBani: 0 });
    // 5 km at 0.6867 RON/km, alone with the driver: floor(3433.5 / 2) -> 1.70 RON
    expect(out.items[1]?.priceUpToBani).toBe(170);
  });

  it('hides blocked rides and counts them', async () => {
    const rows = [
      matchRow({ ride_id: RIDE_ID }),
      matchRow({ ride_id: RIDE_2, blocked: true }),
      matchRow({ ride_id: RIDE_3, blocked: true }),
    ];
    const { app } = makeApp([searchDb({ rides: () => rows })]);
    const out = searchResponseSchema.parse(
      await (await app.request(`${BASE}/search`, post(BODY, await auth()))).json(),
    );
    expect(out.items.map((i) => i.rideId)).toEqual([RIDE_ID]);
    expect(out.hiddenBlockedCount).toBe(2);
    expect(out.nearestOutsideWindow).toEqual([]);
  });

  it('keeps the order the database gave (walk, then time)', async () => {
    const rows = [
      matchRow({ ride_id: RIDE_2 }),
      matchRow({ ride_id: RIDE_ID }),
      matchRow({ ride_id: RIDE_3 }),
    ];
    const { app } = makeApp([searchDb({ rides: () => rows })]);
    const out = searchResponseSchema.parse(
      await (await app.request(`${BASE}/search`, post(BODY))).json(),
    );
    expect(out.items.map((i) => i.rideId)).toEqual([RIDE_2, RIDE_ID, RIDE_3]);
  });

  it('empty window: returns up to 3 nearest rides of the same day, nearest in time first', async () => {
    const at = (iso: string, id: string) =>
      matchRow({ ride_id: id, departure_at: new Date(iso), pickup_eta_at: new Date(iso) });
    const sameDay = [
      at('2026-11-16T11:00:00Z', RIDE_ID), // 5.5 h after 05:30Z
      at('2026-11-16T04:00:00Z', RIDE_2), // 1.5 h before (the "past" ones are cut in SQL)
      at('2026-11-16T07:10:00Z', RIDE_3), // 1 h 40 min after
      at('2026-11-16T09:00:00Z', RIDE_4), // 3.5 h after
    ];
    const { app, calls } = makeApp([
      searchDb({ rides: (q) => (q.values[P.excludeFrom] === null ? [] : sameDay) }),
    ]);
    const out = searchResponseSchema.parse(
      await (await app.request(`${BASE}/search`, post(BODY))).json(),
    );
    expect(out.items).toEqual([]);
    expect(out.nearestOutsideWindow.map((i) => i.rideId)).toEqual([RIDE_2, RIDE_3, RIDE_4]);
    out.nearestOutsideWindow.forEach((i) => searchItemSchema.parse(i));

    // second query: the whole Bucharest day, excluding the requested window
    const second = matchCalls(calls)[1];
    expect(second?.values[P.fromAt]).toEqual(new Date('2026-11-15T22:00:00Z'));
    expect(second?.values[P.toAt]).toEqual(new Date('2026-11-16T21:59:59.999Z'));
    expect(second?.values[P.excludeFrom]).toEqual(new Date('2026-11-16T05:00:00Z'));
    expect(second?.values[P.excludeTo]).toEqual(new Date('2026-11-16T06:00:00Z'));
    expect(second?.values[P.includeBlocked]).toBe(false);
  });

  it('does not run the nearest query when the window has results', async () => {
    const { app, calls } = makeApp([searchDb()]);
    await app.request(`${BASE}/search`, post(BODY));
    expect(matchCalls(calls)).toHaveLength(1);
  });

  it('a window with only blocked rides still shows the empty state (and the blocked note)', async () => {
    const { app } = makeApp([
      searchDb({
        rides: (q) =>
          q.values[P.excludeFrom] === null
            ? [matchRow({ blocked: true })]
            : [matchRow({ ride_id: RIDE_2 })],
      }),
    ]);
    const out = searchResponseSchema.parse(
      await (await app.request(`${BASE}/search`, post(BODY, await auth()))).json(),
    );
    expect(out.items).toEqual([]);
    expect(out.hiddenBlockedCount).toBe(1);
    expect(out.nearestOutsideWindow.map((i) => i.rideId)).toEqual([RIDE_2]);
  });

  it('skips a row whose driver profile is gone', async () => {
    const { app } = makeApp([searchDb({ profiles: [] })]);
    const out = searchResponseSchema.parse(
      await (await app.request(`${BASE}/search`, post(BODY))).json(),
    );
    expect(out.items).toEqual([]);
  });

  it('logs search_performed with a count, area labels and the corridor, never coordinates', async () => {
    const { app, calls } = makeApp([searchDb()]);
    await app.request(`${BASE}/search`, post(BODY, await auth()));
    const ev = calls.find((c) => c.text.startsWith('insert into app.analytics_events'));
    expect(ev).toBeDefined();
    expect(ev?.values[0]).toBe(USER);
    const props = JSON.parse(String(ev?.values[1])) as Record<string, unknown>;
    expect(props).toEqual({
      resultsCount: 1,
      fromArea: 'Șelimbăr',
      toArea: 'Șelimbăr',
      windowMin: 30,
      corridor: 'south',
    });
    expect(JSON.stringify(ev?.values)).not.toMatch(/45\.7|24\.1/);
    // the JSON parameter is passed as text (postgres.js double-encodes a bare ::jsonb cast)
    expect(ev?.text).toContain('::text::jsonb');
  });

  it('records the event without a user id when signed out', async () => {
    const { app, calls } = makeApp([searchDb()]);
    await app.request(`${BASE}/search`, post(BODY));
    const ev = calls.find((c) => c.text.startsWith('insert into app.analytics_events'));
    expect(ev?.values[0]).toBeNull();
  });

  it('a failing analytics write never fails the search', async () => {
    const { app } = makeApp([searchDb({ eventFails: true })]);
    const res = await app.request(`${BASE}/search`, post(BODY));
    expect(res.status).toBe(200);
    expect(searchResponseSchema.parse(await res.json()).items).toHaveLength(1);
  });

  it('is rate limited (429 with Retry-After), keyed per user or per IP hash', async () => {
    const limited = makeApp([searchDb({ rateAllowed: false })]);
    const res = await limited.app.request(`${BASE}/search`, post(BODY));
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe('RATE_LIMITED');
    expect(res.headers.get('retry-after')).toBe('60');
    expect(matchCalls(limited.calls)).toHaveLength(0);

    const ok = makeApp([searchDb()]);
    await ok.app.request(`${BASE}/search`, post(BODY));
    await ok.app.request(`${BASE}/search`, post(BODY, await auth()));
    const keys = ok.calls
      .filter((c) => c.text.includes('app.rate_limit_hit'))
      .map((c) => String(c.values[0]));
    expect(keys[0]).toMatch(/^search:ip:[0-9a-f]+$/);
    expect(keys[1]).toBe(`search:u:${USER}`);
    // the raw IP is never part of the key
    expect(keys[0]).not.toContain('unknown');
  });

  it.each([
    [
      'from outside the coverage area',
      { ...BODY, from: { lat: 46.5, lng: 24.1 } },
      'VALIDATION_FAILED',
      'from',
    ],
    [
      'to outside the coverage area',
      { ...BODY, to: { lat: 45.75, lng: 25.5 } },
      'VALIDATION_FAILED',
      'to',
    ],
    [
      'from and to less than 1 km apart',
      { ...BODY, to: { lat: 45.7456, lng: 24.1861 } },
      'SAME_PLACE',
      'to',
    ],
    ['an unsupported window', { ...BODY, windowMin: 45 }, 'VALIDATION_FAILED', 'windowMin'],
    ['a malformed date', { ...BODY, date: '16/11/2026' }, 'VALIDATION_FAILED', 'date'],
    ['a malformed time', { ...BODY, time: '25:00' }, 'VALIDATION_FAILED', 'time'],
    [
      'an impossible calendar date',
      { ...BODY, date: '2026-02-30' },
      'VALIDATION_FAILED',
      undefined,
    ],
    ['a date far in the past', { ...BODY, date: '2026-01-01' }, 'VALIDATION_FAILED', 'date'],
    ['a date too far ahead', { ...BODY, date: '2027-06-01' }, 'VALIDATION_FAILED', 'date'],
    ['missing points', { date: BODY.date, time: BODY.time }, 'VALIDATION_FAILED', 'from'],
  ])('rejects %s with 400 and never queries the matcher', async (_name, body, code, field) => {
    const { app, calls } = makeApp([searchDb()]);
    const res = await app.request(`${BASE}/search`, post(body));
    expect(res.status).toBe(400);
    const err = await errorOf(res);
    expect(err.code).toBe(code);
    if (field) expect(err.fields).toHaveProperty(field);
    expect(matchCalls(calls)).toHaveLength(0);
  });

  it('rejects a body that is not JSON', async () => {
    const { app } = makeApp([searchDb()]);
    const res = await app.request(`${BASE}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('VALIDATION_FAILED');
  });

  it('is not available as GET (coordinates never belong in a URL)', async () => {
    const { app } = makeApp([searchDb()]);
    const res = await app.request(`${BASE}/search?from=45.7,24.1`);
    expect(res.status).toBe(404);
  });

  it('SQL: only the typed parameters reach the matcher, the select list is explicit', async () => {
    const { app, calls } = makeApp([searchDb()]);
    await app.request(`${BASE}/search`, post(BODY));
    const q = matchCalls(calls)[0];
    expect(q?.text).not.toMatch(/select \*/);
    expect(q?.text).toContain('app.match_rides(');
    expect(q?.text).not.toContain('plate');
  });
});

// ---- POST /rides/{id}/match ---------------------------------------------------------------------------

describe('POST /rides/{id}/match', () => {
  const body = { from: FROM, to: TO };
  const url = (id = RIDE_ID) => `${BASE}/rides/${id}/match`;

  it('is public: returns the passenger view with an "up to" price from the ride snapshot', async () => {
    const { app, calls } = makeApp([searchDb()]);
    const res = await app.request(url(), post(body));
    expect(res.status).toBe(200);
    const text = await res.text();
    const out = matchResponseSchema.parse(JSON.parse(text));
    expect(out).toEqual({
      pickup: {
        point: { lat: 45.7413, lng: 24.1861, approx: true, radiusM: 300 },
        label: 'Șelimbăr',
        walkM: 100,
      },
      dropoff: {
        point: { lat: 45.785, lng: 24.09, approx: true, radiusM: 300 },
        label: 'Zona Industrială Vest',
        walkM: 100,
      },
      segmentM: 9588,
      priceUpToBani: 310,
      pickupEtaAt: '2026-11-16T05:25:00.000Z',
      seatsLeft: 2,
      bookable: true,
      notBookableReason: null,
    });
    expect(text).not.toContain('45.7416');
    // a single-ride re-check: the matcher gets the ride id and returns blocked pairs flagged
    const q = matchCalls(calls)[0];
    expect(q?.values[P.rideId]).toBe(RIDE_ID);
    expect(q?.values[P.includeBlocked]).toBe(true);
    expect(q?.values[P.searcher]).toBeNull();
  });

  it('passes the caller so own rides can be recognised', async () => {
    const { app, calls } = makeApp([searchDb({ publicRide: publicRow({ driver_id: USER }) })]);
    const res = await app.request(url(), post(body, await auth()));
    const out = matchResponseSchema.parse(await res.json());
    expect(out).toMatchObject({ bookable: false, notBookableReason: 'OWN_RIDE' });
    expect(matchCalls(calls)[0]?.values[P.searcher]).toBe(USER);
  });

  it('names the reason when the ride is full', async () => {
    const { app } = makeApp([searchDb({ publicRide: publicRow({ seats_booked: 3 }) })]);
    const out = matchResponseSchema.parse(await (await app.request(url(), post(body))).json());
    expect(out).toMatchObject({ bookable: false, notBookableReason: 'RIDE_FULL', seatsLeft: 0 });
    // the points still match, so the price and places are still there
    expect(out.priceUpToBani).toBe(310);
  });

  it('is not bookable when the ride departs in under 10 minutes or has already departed', async () => {
    for (const iso of ['2026-11-16T05:05:00Z', '2026-11-16T04:00:00Z']) {
      const { app } = makeApp([
        searchDb({ publicRide: publicRow({ departure_at: new Date(iso) }) }),
      ]);
      const out = matchResponseSchema.parse(await (await app.request(url(), post(body))).json());
      expect(out.notBookableReason).toBe('RIDE_NOT_BOOKABLE');
    }
  });

  it('a completed ride is visible but not bookable', async () => {
    const { app } = makeApp([searchDb({ publicRide: publicRow({ status: 'completed' }) })]);
    const out = matchResponseSchema.parse(await (await app.request(url(), post(body))).json());
    expect(out.notBookableReason).toBe('RIDE_NOT_BOOKABLE');
  });

  it('NO_LONGER_MATCHES when the typed points do not fit: no places, no price', async () => {
    const { app } = makeApp([searchDb({ rides: () => [] })]);
    const res = await app.request(url(), post(body));
    expect(res.status).toBe(200);
    expect(matchResponseSchema.parse(await res.json())).toEqual({
      pickup: null,
      dropoff: null,
      segmentM: null,
      priceUpToBani: null,
      pickupEtaAt: null,
      seatsLeft: 2,
      bookable: false,
      notBookableReason: 'NO_LONGER_MATCHES',
    });
  });

  it('free rides quote 0', async () => {
    const { app } = makeApp([searchDb({ rides: () => [matchRow({ is_free: true })] })]);
    const out = matchResponseSchema.parse(await (await app.request(url(), post(body))).json());
    expect(out.priceUpToBani).toBe(0);
  });

  it('answers 404 for a blocked pair (either direction), so nobody learns who blocked whom', async () => {
    const byPublic = makeApp([searchDb({ publicRide: publicRow({ blocked: true }) })]);
    const a = await byPublic.app.request(url(), post(body, await auth()));
    expect(a.status).toBe(404);
    expect((await errorOf(a)).code).toBe('NOT_FOUND');
    expect(matchCalls(byPublic.calls)).toHaveLength(0);

    const byMatcher = makeApp([searchDb({ rides: () => [matchRow({ blocked: true })] })]);
    const b = await byMatcher.app.request(url(), post(body, await auth()));
    expect(b.status).toBe(404);
  });

  it.each([
    ['an unknown ride', { publicRide: null }],
    ['a cancelled ride (not the driver)', { publicRide: publicRow({ status: 'cancelled' }) }],
    ['an expired ride', { publicRide: publicRow({ status: 'expired' }) }],
    ['a suspended driver', { publicRide: publicRow({ driver_status: 'suspended' }) }],
  ] as const)('answers 404 for %s', async (_name, opts) => {
    const { app, calls } = makeApp([searchDb(opts)]);
    const res = await app.request(url(), post(body));
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('NOT_FOUND');
    expect(matchCalls(calls)).toHaveLength(0);
  });

  it('answers 404 for a malformed id without touching the database', async () => {
    const { app, calls } = makeApp([searchDb()]);
    const res = await app.request(url('not-a-uuid'), post(body));
    expect(res.status).toBe(404);
    expect(calls.filter((c) => !c.text.includes('rate_limit_hit'))).toHaveLength(0);
  });

  it('validates the body (400) and the coverage area', async () => {
    const { app } = makeApp([searchDb()]);
    const bad = await app.request(url(), post({ from: FROM }));
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).fields).toHaveProperty('to');
    const outside = await app.request(url(), post({ from: FROM, to: { lat: 40, lng: 24 } }));
    expect(outside.status).toBe(400);
    expect((await errorOf(outside)).fields).toEqual({ to: 'outside_coverage' });
  });

  it('is rate limited', async () => {
    const { app } = makeApp([searchDb({ rateAllowed: false })]);
    const res = await app.request(url(), post(body));
    expect(res.status).toBe(429);
  });

  it('uses the injected clock for the 10 minute cutoff', async () => {
    const { app } = makeApp(
      [searchDb({ publicRide: publicRow({ departure_at: new Date('2026-11-16T07:00:00Z') }) })],
      {},
      { clock: fixedClock('2026-11-16T06:55:00Z') },
    );
    const out = matchResponseSchema.parse(await (await app.request(url(), post(body))).json());
    expect(out.notBookableReason).toBe('RIDE_NOT_BOOKABLE');
  });
});

// ---- GET /rides/{id}: the block check that arrives with E3 --------------------------------------------

describe('GET /rides/{id} with blocks', () => {
  it('is a 404 for a blocked pair and asks the database with the viewer id', async () => {
    const { app, calls } = makeApp([searchDb({ publicRide: publicRow({ blocked: true }) })]);
    const res = await app.request(`${BASE}/rides/${RIDE_ID}`, { headers: await auth() });
    expect(res.status).toBe(404);
    const q = calls.find((c) => c.text.includes('as route_public'));
    expect(q?.text).toContain('from app.blocks');
    expect(q?.values).toContain(USER);
  });

  it('signed out: no viewer id, so no block can apply', async () => {
    const { app, calls } = makeApp([searchDb()]);
    const res = await app.request(`${BASE}/rides/${RIDE_ID}`);
    expect(res.status).toBe(200);
    const q = calls.find((c) => c.text.includes('as route_public'));
    expect(q?.values.filter((v) => v === null).length).toBeGreaterThanOrEqual(2);
  });
});
