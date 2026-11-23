import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from '../_shared/contracts/errors.ts';
import {
  previewResponseSchema,
  rideListResponseSchema,
  rideOwnerViewSchema,
  ridePublicViewSchema,
} from '../_shared/contracts/rides.ts';
import { AppError } from '../_shared/errors.ts';
import type { RoutingProvider } from '../_shared/providers/routing/types.ts';
import { markRideCancelled } from './repo/rides.ts';
import { decodeCursor, encodeCursor } from './services/rides.ts';
import { BASE, fakeSql, makeApp, signToken, type Handler, type Query } from './testing.ts';

const USER = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';
const OTHER = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const RIDE_ID = '5b0c7f0e-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const PREVIEW_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PLATE = 'SB12ABC';

// Trip B (pricing.md §5): Shopping City to Zona Industrială Vest, diesel
const SHOPPING_CITY = { lat: 45.7413, lng: 24.1861 };
const ZI_VEST = { lat: 45.785, lng: 24.09 };

const PRICES: Record<string, { id: string; price_milli: number; consumption_centi: number }> = {
  petrol: { id: 'ep-petrol', price_milli: 9810, consumption_centi: 700 },
  diesel: { id: 'ep-diesel', price_milli: 10850, consumption_centi: 600 },
};

const ALL_ACCEPTED = [
  { kind: 'age_18', version: null },
  { kind: 'terms', version: '1.0' },
  { kind: 'privacy', version: '1.0' },
];

const profile = (over: Record<string, unknown> = {}) => ({
  id: USER,
  first_name: 'Radu',
  phone_e164: '+40721234567',
  bio: null,
  photo_path: 'avatars/6f9619ff-8b86-4d11-b42d-00c04fc964ff.jpg',
  status: 'active',
  role: 'user',
  created_at: new Date('2026-10-01T10:00:00Z'),
  has_vehicle: true,
  ...over,
});

const vehicleRow = (over: Record<string, unknown> = {}) => ({
  make: 'Dacia',
  model: 'Logan',
  colour: 'Grey',
  plate: PLATE,
  fuel_type: 'diesel',
  seats: 3,
  ...over,
});

const ROUTE_GEOJSON = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [24.1861, 45.7413],
    [24.1, 45.78],
    [24.09, 45.785],
  ],
});

const ownerRow = (over: Record<string, unknown> = {}) => ({
  id: RIDE_ID,
  status: 'published',
  departure_at: new Date('2026-11-16T07:00:00Z'),
  origin_label: 'Șelimbăr, Shopping City Sibiu',
  destination_label: 'Zona Industrială Vest, Str. Salzburg',
  origin_lat: 45.7413,
  origin_lng: 24.1861,
  destination_lat: 45.785,
  destination_lng: 24.09,
  route_geojson: ROUTE_GEOJSON,
  distance_m: 9588,
  duration_s: 1020,
  seats_offered: 3,
  seats_booked: 0,
  note: null,
  is_free: false,
  rate_micro_per_km: 651000,
  vehicle_snapshot: {
    make: 'Dacia',
    model: 'Logan',
    colour: 'Grey',
    plate: PLATE,
    fuelType: 'diesel',
  },
  late_cancel: false,
  cancelled_at: null,
  created_at: new Date('2026-11-16T04:00:00Z'),
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
  note: 'Blue backpack',
  is_free: false,
  rate_micro_per_km: 651000,
  driver_id: USER,
  driver_status: 'active',
  // The query strips the plate in SQL. A rogue extra field here proves the serializer drops it too.
  car: { make: 'Dacia', model: 'Logan', colour: 'Grey', plate: PLATE },
  origin_lat: 45.74,
  origin_lng: 24.1862,
  destination_lat: 45.7855,
  destination_lng: 24.0905,
  origin_area: 'Șelimbăr',
  destination_area: 'Zona Industrială Vest',
  route_public: JSON.stringify({
    type: 'LineString',
    coordinates: [
      [24.17, 45.745],
      [24.1, 45.78],
    ],
  }),
  ...over,
});

const publicProfileRow = (over: Record<string, unknown> = {}) => ({
  id: USER,
  first_name: 'Radu',
  bio: null,
  photo_path: null,
  status: 'active',
  created_at: new Date('2026-10-01T10:00:00Z'),
  rating_count: 0,
  rating_avg: null,
  late_cancellations: 0,
  no_shows: 0,
  ...over,
});

type State = {
  profile: Record<string, unknown> | null;
  vehicle: Record<string, unknown> | null;
  accepted: typeof ALL_ACCEPTED;
  ownerRide: Record<string, unknown> | null;
  /** After a cancel update the owner select returns this instead. */
  ownerRideAfterCancel: Record<string, unknown> | null;
  publicRide: Record<string, unknown> | null;
  publicProfile: Record<string, unknown> | null;
  dailyCount: number;
  previewValid: boolean;
  list: Record<string, unknown>[];
  cancelled: boolean;
};

function rideDb(init: Partial<State> = {}) {
  const state: State = {
    profile: profile(),
    vehicle: vehicleRow(),
    accepted: ALL_ACCEPTED,
    ownerRide: ownerRow(),
    ownerRideAfterCancel: null,
    publicRide: publicRow(),
    publicProfile: publicProfileRow(),
    dailyCount: 0,
    previewValid: true,
    list: [],
    cancelled: false,
    ...init,
  };
  const handler: Handler = (q) => {
    const t = q.text;
    if (t.includes('from app.legal_documents')) {
      return [
        { kind: 'terms', version: '1.0', url: '/policy/terms' },
        { kind: 'privacy', version: '1.0', url: '/policy/privacy' },
      ];
    }
    if (t.includes('has_vehicle')) return state.profile ? [state.profile] : [];
    if (t.includes('from app.consents')) return state.accepted;
    if (t.includes('from app.vehicles where owner_id')) return state.vehicle ? [state.vehicle] : [];
    if (t.includes('from app.energy_prices')) {
      const price = PRICES[String(q.values[0])];
      return price ? [price] : [];
    }
    if (t.includes('ST_DWithin(pl.geom')) {
      return [{ area_id: 'area-1', area_name: 'Șelimbăr', place_name: 'Shopping City Sibiu' }];
    }
    if (t.startsWith('insert into app.route_previews')) {
      return [{ id: PREVIEW_ID, route_geojson: ROUTE_GEOJSON }];
    }
    if (t.includes('pg_advisory_xact_lock')) return [];
    if (t.includes('for share')) return [{ ok: 1 }];
    if (t.includes('select count(*)::int as n from app.rides')) return [{ n: state.dailyCount }];
    if (t.startsWith('insert into app.rides')) return state.previewValid ? [{ id: RIDE_ID }] : [];
    if (t.startsWith('insert into app.analytics_events')) return [];
    if (t.startsWith('update app.rides set status')) {
      state.cancelled = true;
      return [];
    }
    if (t.startsWith('insert into app.reliability_events')) return [];
    if (t.includes('as route_geojson') && t.includes('from app.rides r')) {
      const row = state.cancelled
        ? (state.ownerRideAfterCancel ?? state.ownerRide)
        : state.ownerRide;
      return row ? [row] : [];
    }
    if (t.includes('as route_public')) return state.publicRide ? [state.publicRide] : [];
    if (t.includes('rating_count')) return state.publicProfile ? [state.publicProfile] : [];
    if (t.includes('order by r.departure_at asc') || t.includes('order by r.departure_at desc')) {
      return state.list;
    }
    return undefined;
  };
  return { state, handler };
}

const auth = async (sub = USER) => ({
  authorization: `Bearer ${await signToken(sub, { email: 'radu@example.com' })}`,
});
const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;
const has = (calls: Query[], fragment: string) => calls.some((c) => c.text.includes(fragment));
const find = (calls: Query[], fragment: string) => calls.find((c) => c.text.includes(fragment));
const indexOf = (calls: Query[], fragment: string) =>
  calls.findIndex((c) => c.text.includes(fragment));

const failingRouter = (code: 'ROUTE_NOT_FOUND' | 'ROUTING_UNAVAILABLE'): RoutingProvider => ({
  name: 'fixture',
  route: () => Promise.reject(new AppError(code)),
});

// ---- POST /rides/preview ---------------------------------------------------------------------

describe('POST /rides/preview', () => {
  const body = { origin: SHOPPING_CITY, destination: ZI_VEST };

  it('needs a signed-in driver with consent, a complete profile and a vehicle', async () => {
    const anon = makeApp([rideDb().handler]).app;
    expect((await anon.request(`${BASE}/rides/preview`, post(body))).status).toBe(401);

    const noCar = makeApp([rideDb({ profile: profile({ has_vehicle: false }) }).handler]).app;
    const res = await noCar.request(`${BASE}/rides/preview`, {
      ...post(body),
      headers: { 'content-type': 'application/json', ...(await auth()) },
    });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('VEHICLE_REQUIRED');
  });

  it('prices Trip B for a diesel car to the exact bani (3.10 / 2.00 / 1.50)', async () => {
    const { handler } = rideDb();
    const { app, calls } = makeApp([handler]);
    const res = await app.request(`${BASE}/rides/preview`, {
      ...post(body),
      headers: { 'content-type': 'application/json', ...(await auth()) },
    });
    expect(res.status).toBe(200);
    const out = previewResponseSchema.parse(await res.json());
    expect(out).toMatchObject({
      previewId: PREVIEW_ID,
      expiresAt: '2026-11-16T05:30:00.000Z',
      distanceM: 9588,
      durationS: 1020,
      tripCostBani: 624,
      rateMicroPerKm: 651000,
      fuelType: 'diesel',
      originLabel: 'Șelimbăr, Shopping City Sibiu',
      destinationLabel: 'Șelimbăr, Shopping City Sibiu',
    });
    expect(out.priceTable).toEqual([
      { passengers: 1, priceBani: 310 },
      { passengers: 2, priceBani: 200 },
      { passengers: 3, priceBani: 150 },
    ]);
    expect(out.route.type).toBe('LineString');
    const insert = find(calls, 'insert into app.route_previews');
    expect(insert?.values).toContain('fixture');
    // simplified in SQL on insert
    expect(insert?.text).toContain('app.simplify_route(');
  });

  it('the price table follows the vehicle seats and fuel (petrol, 1 seat)', async () => {
    const { handler } = rideDb({ vehicle: vehicleRow({ fuel_type: 'petrol', seats: 1 }) });
    const { app } = makeApp([handler]);
    const res = await app.request(`${BASE}/rides/preview`, {
      ...post({
        origin: { lat: 45.709, lng: 24.151 },
        destination: { lat: 45.7977, lng: 24.1505 },
      }),
      headers: { 'content-type': 'application/json', ...(await auth()) },
    });
    const out = previewResponseSchema.parse(await res.json());
    expect(out.distanceM).toBe(11514); // Trip A
    expect(out.priceTable).toEqual([{ passengers: 1, priceBani: 390 }]);
    expect(out.rateMicroPerKm).toBe(686700);
  });

  it('uses the labels the driver gives and skips the place lookup', async () => {
    const { handler } = rideDb();
    const { app, calls } = makeApp([handler]);
    const res = await app.request(`${BASE}/rides/preview`, {
      ...post({ ...body, originLabel: ' Casa  mea ', destinationLabel: 'Birou' }),
      headers: { 'content-type': 'application/json', ...(await auth()) },
    });
    const out = previewResponseSchema.parse(await res.json());
    expect(out.originLabel).toBe('Casa mea');
    expect(out.destinationLabel).toBe('Birou');
    expect(has(calls, 'ST_DWithin(pl.geom')).toBe(false);
  });

  it('answers 400 for the same place, outside the coverage area and malformed bodies', async () => {
    const { app } = makeApp([rideDb().handler]);
    const headers = { 'content-type': 'application/json', ...(await auth()) };
    const call = (b: unknown) => app.request(`${BASE}/rides/preview`, { ...post(b), headers });

    expect((await errorOf(await call({ origin: ZI_VEST, destination: ZI_VEST }))).code).toBe(
      'SAME_PLACE',
    );
    const far = await call({ origin: { lat: 44.43, lng: 26.1 }, destination: ZI_VEST });
    expect(far.status).toBe(400);
    const farErr = await errorOf(far);
    expect(farErr.code).toBe('VALIDATION_FAILED');
    expect(farErr.fields).toEqual({ origin: 'outside_coverage' });

    const bad = await call({ origin: { lat: 'x' }, destination: ZI_VEST });
    expect((await errorOf(bad)).code).toBe('VALIDATION_FAILED');
    const malformed = await app.request(`${BASE}/rides/preview`, {
      method: 'POST',
      headers,
      body: '{nope',
    });
    expect((await errorOf(malformed)).fields).toEqual({ _: 'invalid_json' });
  });

  it('rejects routes under 1 km and over 40 km', async () => {
    const { app } = makeApp([rideDb().handler]);
    const headers = { 'content-type': 'application/json', ...(await auth()) };
    // ~600 m apart, the fixture router returns 780 m
    const short = await app.request(`${BASE}/rides/preview`, {
      ...post({ origin: ZI_VEST, destination: { lat: 45.7904, lng: 24.09 } }),
      headers,
    });
    expect(short.status).toBe(400);
    expect((await errorOf(short)).code).toBe('ROUTE_TOO_SHORT');
    // opposite corners of the coverage box: about 43 km by road
    const long = await app.request(`${BASE}/rides/preview`, {
      ...post({ origin: { lat: 45.681, lng: 23.981 }, destination: { lat: 45.859, lng: 24.319 } }),
      headers,
    });
    expect(long.status).toBe(400);
    expect((await errorOf(long)).code).toBe('ROUTE_TOO_LONG');
  });

  it('maps router failures: 422 ROUTE_NOT_FOUND, 503 ROUTING_UNAVAILABLE', async () => {
    const headers = { 'content-type': 'application/json', ...(await auth()) };
    const nf = makeApp([rideDb().handler], {}, { routing: failingRouter('ROUTE_NOT_FOUND') });
    const r1 = await nf.app.request(`${BASE}/rides/preview`, { ...post(body), headers });
    expect(r1.status).toBe(422);
    expect((await errorOf(r1)).code).toBe('ROUTE_NOT_FOUND');
    expect(has(nf.calls, 'insert into app.route_previews')).toBe(false);

    const down = makeApp([rideDb().handler], {}, { routing: failingRouter('ROUTING_UNAVAILABLE') });
    const r2 = await down.app.request(`${BASE}/rides/preview`, { ...post(body), headers });
    expect(r2.status).toBe(503);
    expect((await errorOf(r2)).code).toBe('ROUTING_UNAVAILABLE');
  });

  it('is limited to 20 per hour', async () => {
    const { handler } = rideDb();
    const { app, calls } = makeApp([
      (q) => (q.text.includes('rate_limit_hit') ? [{ allowed: false }] : undefined),
      handler,
    ]);
    const res = await app.request(`${BASE}/rides/preview`, {
      ...post(body),
      headers: { 'content-type': 'application/json', ...(await auth()) },
    });
    expect(res.status).toBe(429);
    const limit = find(calls, 'app.rate_limit_hit');
    expect(limit?.values).toEqual([`ride-preview:u:${USER}`, 3600, 20]);
  });
});

// ---- POST /rides -----------------------------------------------------------------------------------

describe('POST /rides', () => {
  const base = { previewId: PREVIEW_ID, departureAt: '2026-11-16T07:00:00Z', seats: 3 };
  const publish = async (app: ReturnType<typeof makeApp>['app'], b: unknown, sub = USER) =>
    app.request(`${BASE}/rides`, {
      ...post(b),
      headers: { 'content-type': 'application/json', ...(await auth(sub)) },
    });

  it('publishes inside one transaction: lock, count, insert from the preview, analytics', async () => {
    const { app, calls } = makeApp([rideDb().handler]);
    const res = await publish(app, { ...base, note: '  Blue backpack  ' });
    expect(res.status).toBe(201);
    const out = rideOwnerViewSchema.parse(await res.json());
    expect(out).toMatchObject({
      id: RIDE_ID,
      status: 'published',
      seatsOffered: 3,
      seatsBooked: 0,
      tripCostBani: 624,
      fuelType: 'diesel',
      canCancel: true,
      lateCancelIfNow: false,
      requests: [],
      passengers: [],
    });
    expect(out.priceTable.map((r) => r.priceBani)).toEqual([310, 200, 150]);
    expect(out.car.plate).toBe(PLATE);

    const lock = indexOf(calls, 'pg_advisory_xact_lock');
    const count = indexOf(calls, 'select count(*)::int as n from app.rides');
    const insert = indexOf(calls, 'insert into app.rides');
    const event = indexOf(calls, 'insert into app.analytics_events');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(count);
    expect(count).toBeLessThan(insert);
    expect(insert).toBeLessThan(event);

    const ins = calls[insert];
    // vehicle snapshot and rate snapshot, taken server-side
    const snapshot = ins?.values.find((v) => typeof v === 'string' && v.includes('"fuelType"'));
    expect(JSON.parse(snapshot as string)).toEqual({
      make: 'Dacia',
      model: 'Logan',
      colour: 'Grey',
      plate: PLATE,
      fuelType: 'diesel',
    });
    expect(ins?.values).toContain('ep-diesel');
    expect(ins?.values).toContain(651000);
    expect(ins?.values).toContain('Blue backpack');
    // the insert copies points, labels, route and distance from the stored preview
    expect(ins?.text).toContain('from app.route_previews p');
    expect(ins?.text).toContain('p.expires_at >');
    expect(calls[event]?.text).toContain("'ride_published'");
  });

  it('ignores any price the client sends (there is no price field)', async () => {
    const { app, calls } = makeApp([rideDb().handler]);
    const res = await publish(app, { ...base, priceBani: 1, price: 1, priceTable: [] });
    expect(res.status).toBe(201);
    const ins = find(calls, 'insert into app.rides');
    expect(ins?.values).not.toContain(1);
  });

  it('counts the daily limit over the Bucharest day of the departure', async () => {
    const { app, calls } = makeApp([rideDb().handler]);
    // 22:30 UTC = 00:30 the next day in Bucharest
    await publish(app, { ...base, departureAt: '2026-11-16T22:30:00Z' });
    const count = find(calls, 'select count(*)::int as n from app.rides');
    expect((count?.values[1] as Date).toISOString()).toBe('2026-11-16T22:00:00.000Z');
    expect((count?.values[2] as Date).toISOString()).toBe('2026-11-17T22:00:00.000Z');
    expect(count?.text).toContain("status <> 'cancelled'");
  });

  it('rejects the 5th ride of the day with DAILY_RIDE_LIMIT', async () => {
    const four = makeApp([rideDb({ dailyCount: 4 }).handler]);
    const res = await publish(four.app, base);
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('DAILY_RIDE_LIMIT');
    expect(has(four.calls, 'insert into app.rides')).toBe(false);

    const three = makeApp([rideDb({ dailyCount: 3 }).handler]);
    expect((await publish(three.app, base)).status).toBe(201);
  });

  it('answers PREVIEW_EXPIRED when the preview is gone, expired or not the driver’s own', async () => {
    const { app } = makeApp([rideDb({ previewValid: false }).handler]);
    const res = await publish(app, base);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('PREVIEW_EXPIRED');
  });

  it('enforces 15 minutes to 14 days ahead, with the injected clock', async () => {
    const { app } = makeApp([rideDb().handler]); // clock: 2026-11-16T05:00:00Z
    const soon = await publish(app, { ...base, departureAt: '2026-11-16T05:14:00Z' });
    expect((await errorOf(soon)).code).toBe('DEPARTURE_TOO_SOON');
    const far = await publish(app, { ...base, departureAt: '2026-11-30T05:01:00Z' });
    expect((await errorOf(far)).code).toBe('DEPARTURE_TOO_FAR');
    expect((await publish(app, { ...base, departureAt: '2026-11-16T05:15:00Z' })).status).toBe(201);
    expect((await publish(app, { ...base, departureAt: '2026-11-30T05:00:00Z' })).status).toBe(201);
  });

  it('a deleted driver (account deleted after the gate) publishes nothing', async () => {
    const live: Handler = (q) => (q.text.includes('for share') ? [] : rideDb().handler(q));
    const { app, calls } = makeApp([live]);
    const res = await publish(app, base);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('ACCOUNT_DELETED');
    expect(has(calls, 'insert into app.rides')).toBe(false);
    // the check shares the profile row with DELETE /me's no-key-update lock, inside the transaction
    expect(calls.find((c) => c.text.includes('for share'))?.text).toContain("status <> 'deleted'");
  });

  it('refuses more seats than the vehicle has', async () => {
    const { app, calls } = makeApp([rideDb().handler]);
    const res = await publish(app, { ...base, seats: 4 });
    expect(res.status).toBe(400);
    const err = await errorOf(res);
    expect(err.code).toBe('SEATS_EXCEED_VEHICLE');
    expect(err.fields).toEqual({ seats: 'too_many' });
    expect(has(calls, 'pg_advisory_xact_lock')).toBe(false);
  });

  it('validates the body: seats 0 or 5, missing preview, bad time, long note', async () => {
    const { app } = makeApp([rideDb().handler]);
    for (const bad of [
      { ...base, seats: 0 },
      { ...base, seats: 5 },
      { ...base, seats: 1.5 },
      { departureAt: base.departureAt, seats: 2 },
      { ...base, previewId: 'nope' },
      { ...base, departureAt: 'tomorrow' },
      { ...base, note: 'x'.repeat(201) },
    ]) {
      const res = await publish(app, bad);
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe('VALIDATION_FAILED');
    }
  });

  it('a free ride has a zero price table', async () => {
    const free = ownerRow({ is_free: true });
    const { app, calls } = makeApp([rideDb({ ownerRide: free }).handler]);
    const res = await publish(app, { ...base, isFree: true });
    expect(res.status).toBe(201);
    const out = rideOwnerViewSchema.parse(await res.json());
    expect(out.isFree).toBe(true);
    expect(out.priceTable.map((r) => r.priceBani)).toEqual([0, 0, 0]);
    expect(find(calls, 'insert into app.rides')?.values).toContain(true);
  });

  it('is gated: 401 without a token, VEHICLE_REQUIRED without a vehicle', async () => {
    const { app } = makeApp([rideDb({ profile: profile({ has_vehicle: false }) }).handler]);
    expect((await app.request(`${BASE}/rides`, post(base))).status).toBe(401);
    expect((await errorOf(await publish(app, base))).code).toBe('VEHICLE_REQUIRED');
  });
});

// ---- GET /me/rides, GET /me/rides/{id} ---------------------------------------------------------------

describe('GET /me/rides', () => {
  const row = (n: number) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    departure_at: new Date(Date.UTC(2026, 10, 16, 6 + n)),
    origin_label: 'Șelimbăr',
    destination_label: 'ZI Vest',
    status: 'published',
    seats_offered: 3,
    seats_booked: 1,
  });

  it('lists upcoming rides ascending with an opaque next cursor when there are more', async () => {
    const { app, calls } = makeApp([rideDb({ list: [row(1), row(2), row(3)] }).handler]);
    const res = await app.request(`${BASE}/me/rides?scope=upcoming&limit=2`, {
      headers: await auth(),
    });
    expect(res.status).toBe(200);
    const out = rideListResponseSchema.parse(await res.json());
    expect(out.items.map((i) => i.id)).toEqual([row(1).id, row(2).id]);
    expect(out.items[0]).toMatchObject({ seatsOffered: 3, seatsBooked: 1, pendingRequests: 0 });
    expect(out.nextCursor).not.toBeNull();
    const cursor = decodeCursor(out.nextCursor as string);
    expect(cursor.id).toBe(row(2).id);
    const q = find(calls, 'order by r.departure_at asc');
    expect(q?.text).toContain("r.status = 'published'");
    expect(q?.values.at(-1)).toBe(3); // limit + 1
  });

  it('has no next cursor on the last page, and past is newest first', async () => {
    const { app, calls } = makeApp([rideDb({ list: [row(2), row(1)] }).handler]);
    const res = await app.request(`${BASE}/me/rides?scope=past`, { headers: await auth() });
    const out = rideListResponseSchema.parse(await res.json());
    expect(out.nextCursor).toBeNull();
    expect(find(calls, 'order by r.departure_at desc')).toBeDefined();
  });

  it('defaults to upcoming, passes the cursor to the keyset query, and rejects bad input', async () => {
    const { app, calls } = makeApp([rideDb().handler]);
    const cursor = encodeCursor({ departureAt: new Date('2026-11-16T08:00:00Z'), id: row(2).id });
    expect(
      (await app.request(`${BASE}/me/rides?cursor=${cursor}`, { headers: await auth() })).status,
    ).toBe(200);
    const q = find(calls, 'order by r.departure_at asc');
    expect(q?.values).toContain(row(2).id);

    for (const bad of ['scope=soon', 'limit=0', 'limit=51', 'cursor=!!!']) {
      const res = await app.request(`${BASE}/me/rides?${bad}`, { headers: await auth() });
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe('VALIDATION_FAILED');
    }
  });

  it('needs a token', async () => {
    const { app } = makeApp([rideDb().handler]);
    expect((await app.request(`${BASE}/me/rides`)).status).toBe(401);
  });

  const cancelledRow = (n: number, over: Record<string, unknown> = {}) => ({
    ...row(n),
    status: 'cancelled',
    cancelled_at: new Date(Date.UTC(2026, 10, 15, 9)),
    cancelled_by: 'driver',
    ...over,
  });

  it('cancelled scope: own cancelled rides, newest first, with who and when (old rows read as driver)', async () => {
    const { app, calls } = makeApp([
      rideDb({
        list: [
          cancelledRow(3),
          cancelledRow(2, { cancelled_by: 'system' }),
          cancelledRow(1, { cancelled_by: null }),
        ],
      }).handler,
    ]);
    const res = await app.request(`${BASE}/me/rides?scope=cancelled`, { headers: await auth() });
    expect(res.status).toBe(200);
    const out = rideListResponseSchema.parse(await res.json());
    expect(out.items.map((i) => i.cancelledBy)).toEqual(['driver', 'system', 'driver']);
    expect(out.items[0]).toMatchObject({
      status: 'cancelled',
      cancelledAt: '2026-11-15T09:00:00.000Z',
    });
    const q = find(calls, "r.status = 'cancelled'");
    expect(q?.text).toContain('r.driver_id =');
    expect(q?.text).toContain('order by r.departure_at desc');
    expect(q?.values).toContain(USER);
  });

  it('past excludes cancelled rides, upcoming is published only, other items carry null cancel fields', async () => {
    const { app, calls } = makeApp([rideDb({ list: [row(1)] }).handler]);
    const res = await app.request(`${BASE}/me/rides?scope=past`, { headers: await auth() });
    const out = rideListResponseSchema.parse(await res.json());
    expect(out.items[0]).toMatchObject({ cancelledAt: null, cancelledBy: null });
    const q = find(calls, 'order by r.departure_at desc');
    expect(q?.text).toContain("r.status <> 'cancelled'");
    expect(q?.text).toContain('r.driver_id =');
    await app.request(`${BASE}/me/rides?scope=upcoming`, { headers: await auth() });
    expect(find(calls, 'order by r.departure_at asc')?.text).toContain("r.status = 'published'");
  });

  it('cancelled scope keeps cursor pagination', async () => {
    const { app } = makeApp([
      rideDb({ list: [cancelledRow(3), cancelledRow(2), cancelledRow(1)] }).handler,
    ]);
    const res = await app.request(`${BASE}/me/rides?scope=cancelled&limit=2`, {
      headers: await auth(),
    });
    const out = rideListResponseSchema.parse(await res.json());
    expect(out.items).toHaveLength(2);
    expect(decodeCursor(out.nextCursor as string).id).toBe(row(2).id);
  });

  it('markRideCancelled records who cancelled (default driver)', async () => {
    const { sql, calls } = fakeSql();
    const at = new Date('2026-11-16T05:00:00Z');
    await markRideCancelled(sql, RIDE_ID, at, false);
    await markRideCancelled(sql, RIDE_ID, at, false, 'system');
    const updates = calls.filter((c) => c.text.includes("set status = 'cancelled'"));
    expect(updates[0]?.text).toContain('cancelled_by =');
    expect(updates[0]?.values).toContain('driver');
    expect(updates[1]?.values).toContain('system');
  });

  it('cursors round trip', () => {
    const c = { departureAt: new Date('2026-11-16T08:00:00Z'), id: row(7).id };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(() => decodeCursor('bm9wZQ')).toThrow(AppError);
  });
});

describe('GET /me/rides/{id}', () => {
  it('returns the owner view with exact points, the full route and the plate', async () => {
    const { app, calls } = makeApp([rideDb().handler]);
    const res = await app.request(`${BASE}/me/rides/${RIDE_ID}`, { headers: await auth() });
    expect(res.status).toBe(200);
    const out = rideOwnerViewSchema.parse(await res.json());
    expect(out.origin.point).toEqual({ lat: 45.7413, lng: 24.1861 });
    expect(out.route.coordinates).toHaveLength(3);
    expect(out.car).toEqual({ make: 'Dacia', model: 'Logan', colour: 'Grey', plate: PLATE });
    expect(out.requests).toEqual([]);
    expect(out.passengers).toEqual([]);
    // scoped to the caller in SQL
    expect(find(calls, 'from app.rides r')?.text).toContain('r.driver_id =');
    expect(find(calls, 'from app.rides r')?.values).toEqual([RIDE_ID, USER]);
  });

  it('another driver’s ride and unknown ids are a plain 404', async () => {
    const { app } = makeApp([rideDb({ ownerRide: null }).handler]);
    const res = await app.request(`${BASE}/me/rides/${RIDE_ID}`, { headers: await auth(OTHER) });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('NOT_FOUND');
    const bad = await app.request(`${BASE}/me/rides/not-a-uuid`, { headers: await auth() });
    expect(bad.status).toBe(404);
  });

  it('flags a ride that departs in 20 minutes as a late cancel if cancelled now', async () => {
    const soon = ownerRow({ departure_at: new Date('2026-11-16T05:20:00Z') });
    const { app } = makeApp([rideDb({ ownerRide: soon }).handler]);
    const res = await app.request(`${BASE}/me/rides/${RIDE_ID}`, { headers: await auth() });
    const out = rideOwnerViewSchema.parse(await res.json());
    expect(out.canCancel).toBe(true);
    expect(out.lateCancelIfNow).toBe(true);
  });

  it('a coarsened ride (no route any more) still has a drawable route', async () => {
    const old = ownerRow({ route_geojson: null });
    const { app } = makeApp([rideDb({ ownerRide: old }).handler]);
    const res = await app.request(`${BASE}/me/rides/${RIDE_ID}`, { headers: await auth() });
    const out = rideOwnerViewSchema.parse(await res.json());
    expect(out.route.coordinates).toEqual([
      [24.1861, 45.7413],
      [24.09, 45.785],
    ]);
  });
});

// ---- POST /rides/{id}/cancel --------------------------------------------------------------------------

describe('POST /rides/{id}/cancel', () => {
  const cancel = async (
    app: ReturnType<typeof makeApp>['app'],
    id = RIDE_ID,
    init: RequestInit = post({}),
  ) =>
    app.request(`${BASE}/rides/${id}/cancel`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(await auth()) },
    });

  it('cancels a published ride in one transaction with the row locked', async () => {
    const cancelled = ownerRow({
      status: 'cancelled',
      cancelled_at: new Date('2026-11-16T05:00:00Z'),
    });
    const { app, calls } = makeApp([rideDb({ ownerRideAfterCancel: cancelled }).handler]);
    const res = await cancel(app);
    expect(res.status).toBe(200);
    const out = rideOwnerViewSchema.parse(await res.json());
    expect(out).toMatchObject({ status: 'cancelled', canCancel: false, lateCancel: false });
    expect(out.cancelledAt).toBe('2026-11-16T05:00:00.000Z');

    const lockedRead = calls.find(
      (c) => c.text.includes('from app.rides r') && c.text.includes('for update of r'),
    );
    expect(lockedRead).toBeDefined();
    const update = find(calls, 'update app.rides set status');
    expect(update?.values).toContain(false); // not a late cancel
    expect(has(calls, 'insert into app.reliability_events')).toBe(false);
    // no booking was affected, so there are no outbox rows
    expect(has(calls, 'insert into app.outbox')).toBe(false);
  });

  it('accepts an empty body', async () => {
    const { app } = makeApp([rideDb().handler]);
    expect((await cancel(app, RIDE_ID, { method: 'POST' })).status).toBe(200);
  });

  it('within 30 minutes of departure it is a late cancel with a reliability event', async () => {
    const soon = ownerRow({ departure_at: new Date('2026-11-16T05:25:00Z') });
    const after = ownerRow({
      departure_at: new Date('2026-11-16T05:25:00Z'),
      status: 'cancelled',
      cancelled_at: new Date('2026-11-16T05:00:00Z'),
      late_cancel: true,
    });
    const { app, calls } = makeApp([
      rideDb({ ownerRide: soon, ownerRideAfterCancel: after }).handler,
    ]);
    const res = await cancel(app);
    expect(res.status).toBe(200);
    expect(rideOwnerViewSchema.parse(await res.json()).lateCancel).toBe(true);
    expect(find(calls, 'update app.rides set status')?.values).toContain(true);
    const event = find(calls, 'insert into app.reliability_events');
    expect(event?.text).toContain("'late_cancellation'");
    expect(event?.values).toContain(USER);
  });

  it('exactly 31 minutes ahead is not late', async () => {
    const ride = ownerRow({ departure_at: new Date('2026-11-16T05:31:00Z') });
    const { app, calls } = makeApp([rideDb({ ownerRide: ride }).handler]);
    await cancel(app);
    expect(has(calls, 'insert into app.reliability_events')).toBe(false);
  });

  it('INVALID_STATE when already cancelled, completed or departed', async () => {
    for (const ride of [
      ownerRow({ status: 'cancelled', cancelled_at: new Date('2026-11-16T04:00:00Z') }),
      ownerRow({ status: 'completed' }),
      ownerRow({ departure_at: new Date('2026-11-16T04:59:00Z') }),
    ]) {
      const { app, calls } = makeApp([rideDb({ ownerRide: ride }).handler]);
      const res = await cancel(app);
      expect(res.status).toBe(409);
      expect((await errorOf(res)).code).toBe('INVALID_STATE');
      expect(has(calls, 'update app.rides set status')).toBe(false);
    }
  });

  it('404 for someone else’s ride and for ids that are not UUIDs', async () => {
    const { app } = makeApp([rideDb({ ownerRide: null }).handler]);
    expect((await cancel(app)).status).toBe(404);
    expect((await cancel(app, 'nope')).status).toBe(404);
  });

  it('rejects a malformed or non-empty body, and needs a token', async () => {
    const { app } = makeApp([rideDb().handler]);
    expect((await cancel(app, RIDE_ID, { method: 'POST', body: '{nope' })).status).toBe(400);
    expect((await cancel(app, RIDE_ID, post({ reason: 'x' }))).status).toBe(400);
    expect((await app.request(`${BASE}/rides/${RIDE_ID}/cancel`, post({}))).status).toBe(401);
  });
});

// ---- GET /rides/{id} (public) -------------------------------------------------------------------------------

describe('GET /rides/{id} (public view)', () => {
  it('is public: grid points, area labels, trimmed route, no plate, no exact origin', async () => {
    const { app } = makeApp([rideDb().handler]);
    const res = await app.request(`${BASE}/rides/${RIDE_ID}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const out = ridePublicViewSchema.parse(JSON.parse(text));
    expect(out).toMatchObject({
      id: RIDE_ID,
      seatsOffered: 3,
      seatsLeft: 2,
      note: 'Blue backpack',
      origin: { label: 'Șelimbăr', point: { approx: true, radiusM: 300 } },
      destination: { label: 'Zona Industrială Vest' },
      viewer: { isDriver: false, bookingId: null, bookingStatus: null, blocked: false },
    });
    expect(out.car).toEqual({ make: 'Dacia', model: 'Logan', colour: 'Grey' });
    expect(out.priceTable.map((r) => r.priceBani)).toEqual([310, 200, 150]);
    expect(out.driver).toMatchObject({ id: USER, firstName: 'Radu' });
    // nothing exact and nothing private anywhere in the payload
    expect(text).not.toContain(PLATE);
    expect(text).not.toContain('plate');
    expect(text).not.toContain('45.7413');
    expect(text).not.toContain('24.1861');
    expect(text).not.toContain('phone');
    expect(text).not.toContain('+40721');
    expect(text).not.toContain('Salzburg');
  });

  it('reads only the public projection from the database (SQL helpers, no plate column)', async () => {
    const { app, calls } = makeApp([rideDb().handler]);
    await app.request(`${BASE}/rides/${RIDE_ID}`);
    const q = find(calls, 'as route_public');
    expect(q?.text).toContain('app.grid_point(r.origin, 300)');
    expect(q?.text).toContain('app.public_route(r.route)');
    expect(q?.text).not.toContain('plate');
    expect(q?.text).not.toContain('ST_AsGeoJSON(r.route');
  });

  it('works with an invalid token (still public) and marks the driver as the viewer', async () => {
    const { app } = makeApp([rideDb().handler]);
    const bad = await app.request(`${BASE}/rides/${RIDE_ID}`, {
      headers: { authorization: 'Bearer garbage' },
    });
    expect(bad.status).toBe(200);
    const mine = await app.request(`${BASE}/rides/${RIDE_ID}`, { headers: await auth() });
    expect(ridePublicViewSchema.parse(await mine.json()).viewer.isDriver).toBe(true);
    const other = await app.request(`${BASE}/rides/${RIDE_ID}`, { headers: await auth(OTHER) });
    expect(ridePublicViewSchema.parse(await other.json()).viewer.isDriver).toBe(false);
  });

  it('a cancelled ride is a 404 for everyone except its driver', async () => {
    const cancelled = publicRow({ status: 'cancelled' });
    const { app } = makeApp([rideDb({ publicRide: cancelled }).handler]);
    expect((await app.request(`${BASE}/rides/${RIDE_ID}`)).status).toBe(404);
    expect(
      (await app.request(`${BASE}/rides/${RIDE_ID}`, { headers: await auth(OTHER) })).status,
    ).toBe(404);
    const driver = await app.request(`${BASE}/rides/${RIDE_ID}`, { headers: await auth() });
    expect(driver.status).toBe(200);
    expect(ridePublicViewSchema.parse(await driver.json()).status).toBe('cancelled');
  });

  it('expired and completed rides are hidden from non-parties', async () => {
    const expired = makeApp([rideDb({ publicRide: publicRow({ status: 'expired' }) }).handler]);
    expect((await expired.app.request(`${BASE}/rides/${RIDE_ID}`)).status).toBe(404);
    const done = makeApp([rideDb({ publicRide: publicRow({ status: 'completed' }) }).handler]);
    expect((await done.app.request(`${BASE}/rides/${RIDE_ID}`)).status).toBe(404);
  });

  it('a suspended driver’s ride is a 404, a deleted driver shows as "Deleted user"', async () => {
    const suspended = makeApp([
      rideDb({ publicRide: publicRow({ driver_status: 'suspended' }) }).handler,
    ]);
    expect((await suspended.app.request(`${BASE}/rides/${RIDE_ID}`)).status).toBe(404);

    const gone = makeApp([
      rideDb({ publicProfile: publicProfileRow({ status: 'deleted' }) }).handler,
    ]);
    const res = await gone.app.request(`${BASE}/rides/${RIDE_ID}`);
    const out = ridePublicViewSchema.parse(await res.json());
    expect(out.driver).toMatchObject({ firstName: null, photoUrl: null, bio: null });
  });

  it('unknown ride and malformed id are 404, a short route has no public polyline', async () => {
    const none = makeApp([rideDb({ publicRide: null }).handler]);
    expect((await none.app.request(`${BASE}/rides/${RIDE_ID}`)).status).toBe(404);
    expect((await none.app.request(`${BASE}/rides/xyz`)).status).toBe(404);

    const coarse = makeApp([rideDb({ publicRide: publicRow({ route_public: null }) }).handler]);
    const out = ridePublicViewSchema.parse(
      await (await coarse.app.request(`${BASE}/rides/${RIDE_ID}`)).json(),
    );
    expect(out.routePublic).toBeNull();
  });

  it('a ride of a deleted driver has no car details left and still matches the contract (E6 QA)', async () => {
    // scrub_account keeps only the fuel type in the snapshot: the SQL projection yields nulls.
    const scrubbed = publicRow({
      status: 'published',
      driver_status: 'deleted',
      route_public: null,
      note: null,
      car: { make: null, model: null, colour: null },
    });
    const { app } = makeApp([
      rideDb({
        publicRide: scrubbed,
        publicProfile: publicProfileRow({ status: 'deleted' }),
      }).handler,
    ]);
    const res = await app.request(`${BASE}/rides/${RIDE_ID}`, { headers: await auth(OTHER) });
    expect(res.status).toBe(200);
    const out = ridePublicViewSchema.parse(await res.json());
    expect(out.car).toEqual({ make: '', model: '', colour: '' });
    expect(out.routePublic).toBeNull();
  });

  it('a free ride shows zero prices', async () => {
    const { app } = makeApp([rideDb({ publicRide: publicRow({ is_free: true }) }).handler]);
    const out = ridePublicViewSchema.parse(
      await (await app.request(`${BASE}/rides/${RIDE_ID}`)).json(),
    );
    expect(out.isFree).toBe(true);
    expect(out.priceTable.map((r) => r.priceBani)).toEqual([0, 0, 0]);
  });
});

// ---- Approximate addresses (ADR 0042) ------------------------------------------------------------------

describe('approximate address flags', () => {
  const previewBody = { origin: SHOPPING_CITY, destination: ZI_VEST };
  const preview = async (b: unknown) => {
    const { app, calls } = makeApp([rideDb().handler]);
    const res = await app.request(`${BASE}/rides/preview`, {
      ...post(b),
      headers: { 'content-type': 'application/json', ...(await auth()) },
    });
    return { res, calls };
  };

  it('preview stores the flags next to the labels; the label sent is kept as is', async () => {
    const { res, calls } = await preview({
      ...previewBody,
      originLabel: 'Strada Negoveanu 2A',
      destinationLabel: 'Birou',
      originApproximate: true,
    });
    expect(res.status).toBe(200);
    const out = previewResponseSchema.parse(await res.json());
    expect(out.originLabel).toBe('Strada Negoveanu 2A');
    const insert = find(calls, 'insert into app.route_previews');
    expect(insert?.text).toContain('origin_approximate, destination_approximate');
    const vals = insert?.values ?? [];
    const at = vals.indexOf('Strada Negoveanu 2A');
    expect(vals.slice(at, at + 4)).toEqual(['Strada Negoveanu 2A', 'Birou', true, false]);
    // a typed label means no reverse lookup that could replace it
    expect(has(calls, 'ST_DWithin(pl.geom')).toBe(false);
  });

  it('the flags default to false and only a real true counts', async () => {
    const plain = await preview(previewBody);
    const vals = find(plain.calls, 'insert into app.route_previews')?.values ?? [];
    expect(vals).toContain(false);
    expect(vals).not.toContain(true);
    const odd = await preview({
      ...previewBody,
      originApproximate: false,
      destinationApproximate: true,
    });
    const v2 = find(odd.calls, 'insert into app.route_previews')?.values ?? [];
    expect(v2.filter((v) => typeof v === 'boolean')).toEqual([false, true]);
  });

  it('rejects flags that are not booleans', async () => {
    const { res } = await preview({ ...previewBody, originApproximate: 'yes' });
    expect(res.status).toBe(400);
  });

  it('publish copies the flags from the stored preview (the client cannot send them)', async () => {
    const { app, calls } = makeApp([rideDb().handler]);
    const res = await app.request(`${BASE}/rides`, {
      ...post({
        previewId: PREVIEW_ID,
        departureAt: '2026-11-16T07:00:00Z',
        seats: 3,
        originApproximate: true,
      }),
      headers: { 'content-type': 'application/json', ...(await auth()) },
    });
    expect(res.status).toBe(201);
    const ins = find(calls, 'insert into app.rides');
    expect(ins?.text).toContain('origin_approximate, destination_approximate');
    expect(ins?.text).toContain('p.origin_approximate, p.destination_approximate');
    expect(ins?.values).not.toContain(true);
  });

  it('the owner view carries approximate per place, false for old rows', async () => {
    const flagged = makeApp([
      rideDb({ ownerRide: ownerRow({ origin_approximate: true, destination_approximate: false }) })
        .handler,
    ]);
    const res = await flagged.app.request(`${BASE}/me/rides/${RIDE_ID}`, {
      headers: await auth(),
    });
    const out = rideOwnerViewSchema.parse(await res.json());
    expect(out.origin.approximate).toBe(true);
    expect(out.destination.approximate).toBe(false);
    // the stored label is shown unchanged
    expect(out.origin.label).toBe('Șelimbăr, Shopping City Sibiu');
    expect(find(flagged.calls, 'from app.rides r')?.text).toContain('r.origin_approximate');

    const old = makeApp([rideDb().handler]);
    const res2 = await old.app.request(`${BASE}/me/rides/${RIDE_ID}`, { headers: await auth() });
    const out2 = rideOwnerViewSchema.parse(await res2.json());
    expect(out2.origin.approximate).toBe(false);
    expect(out2.destination.approximate).toBe(false);
  });
});
