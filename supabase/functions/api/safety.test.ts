import { describe, expect, it } from 'vitest';
import { bookingViewSchema } from '../_shared/contracts/bookings.ts';
import { errorEnvelopeSchema } from '../_shared/contracts/errors.ts';
import { rideOwnerViewSchema } from '../_shared/contracts/rides.ts';
import {
  blocksResponseSchema,
  ratingGivenSchema,
  reportResponseSchema,
  shareLinkResponseSchema,
  sharedTripSchema,
} from '../_shared/contracts/safety.ts';
import { fixedClock } from '../_shared/domain/clock.ts';
import { RATE_LIMITS } from '../_shared/domain/rules.ts';
import { hashShareToken, newShareToken } from '../_shared/shareToken.ts';
import { BASE, makeApp, signToken, type Handler, type Query } from './testing.ts';

const PASSENGER = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';
const DRIVER = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const STRANGER = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const ADMIN = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
const RIDE = '5b0c7f0e-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const BOOKING = 'b1b1b1b1-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const REPORT = 'c2c2c2c2-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const PLATE = 'SB12ABC';
const DEPARTURE = new Date('2026-11-16T07:00:00Z');

const ALL_ACCEPTED = [
  { kind: 'age_18', version: null },
  { kind: 'terms', version: '1.0' },
  { kind: 'privacy', version: '1.0' },
];

const profile = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  first_name: id === DRIVER ? 'Radu' : 'Ioana',
  phone_e164: id === DRIVER ? '+40731111222' : '+40722333444',
  bio: null,
  photo_path: null,
  status: 'active',
  role: 'user',
  created_at: new Date('2026-10-01T10:00:00Z'),
  has_vehicle: id === DRIVER,
  ...over,
});

const publicProfile = (id: string) => ({
  id,
  first_name: id === DRIVER ? 'Radu' : 'Ioana',
  bio: null,
  photo_path: null,
  status: 'active',
  created_at: new Date('2026-10-01T10:00:00Z'),
  rating_count: 0,
  rating_avg: null,
  rides_completed: 0,
  late_cancellations: 0,
  no_shows: 0,
});

const lockedRide = (over: Record<string, unknown> = {}) => ({
  id: RIDE,
  driver_id: DRIVER,
  status: 'published',
  departure_at: DEPARTURE,
  duration_s: 1020,
  seats_offered: 3,
  seats_booked: 1,
  is_free: false,
  rate_micro_per_km: 686_700,
  driver_status: 'active',
  ...over,
});

const noShowCtx = (over: Record<string, unknown> = {}) => ({
  id: BOOKING,
  status: 'confirmed',
  passenger_id: PASSENGER,
  ride_id: RIDE,
  driver_id: DRIVER,
  departure_at: DEPARTURE,
  rated: false,
  passenger_first_name: 'Ioana',
  driver_first_name: 'Radu',
  ...over,
});

const ratingCtx = (over: Record<string, unknown> = {}) => ({
  id: BOOKING,
  status: 'completed',
  passenger_id: PASSENGER,
  driver_id: DRIVER,
  ride_id: RIDE,
  completed_at: new Date('2026-11-16T09:05:00Z'),
  rated_by_passenger: false,
  rated_by_driver: false,
  ...over,
});

const stateRow = (over: Record<string, unknown> = {}) => ({
  id: BOOKING,
  ride_id: RIDE,
  passenger_id: PASSENGER,
  status: 'confirmed',
  pickup_label: 'Șelimbăr',
  dropoff_label: 'Centru',
  pickup_fraction: 0.45,
  segment_m: 5390,
  price_quoted_bani: 180,
  price_locked_bani: 120,
  requested_at: new Date('2026-11-16T04:50:00Z'),
  expires_at: new Date('2026-11-16T05:20:00Z'),
  passenger_first_name: 'Ioana',
  ...over,
});

const viewRow = (over: Record<string, unknown> = {}) => ({
  id: BOOKING,
  ride_id: RIDE,
  passenger_id: PASSENGER,
  driver_id: DRIVER,
  status: 'no_show',
  ride_status: 'published',
  departure_at: DEPARTURE,
  duration_s: 1020,
  pickup_label: 'Șelimbăr',
  dropoff_label: 'Centru',
  pickup_lat: 45.74132,
  pickup_lng: 24.18611,
  dropoff_lat: 45.79712,
  dropoff_lng: 24.15211,
  pickup_grid_lat: 45.7412,
  pickup_grid_lng: 24.1869,
  dropoff_grid_lat: 45.7967,
  dropoff_grid_lng: 24.1522,
  pickup_fraction: 0.45,
  segment_m: 5390,
  walk_pickup_m: 163,
  walk_dropoff_m: 41,
  price_quoted_bani: 180,
  price_locked_bani: 120,
  final_price_bani: null,
  requested_at: new Date('2026-11-16T04:50:00Z'),
  expires_at: new Date('2026-11-16T05:20:00Z'),
  decided_at: new Date('2026-11-16T05:00:00Z'),
  cancelled_at: null,
  cancelled_by: null,
  completed_at: null,
  no_show_at: new Date('2026-11-16T07:30:00Z'),
  no_show_by: 'driver',
  rp_stars: null,
  rp_tags: null,
  rp_created_at: null,
  rd_stars: null,
  rd_tags: null,
  rd_created_at: null,
  share_expires_at: null,
  unseen: true,
  car_make: 'Dacia',
  car_model: 'Logan',
  car_colour: 'Grey',
  car_plate: PLATE,
  driver_phone: '+40731111222',
  passenger_phone: '+40722333444',
  segment_geojson: null,
  route_public: null,
  ...over,
});

const ownerRow = () => ({
  id: RIDE,
  status: 'published',
  departure_at: DEPARTURE,
  origin_label: 'Șelimbăr',
  destination_label: 'Centru',
  origin_lat: 45.7413,
  origin_lng: 24.1861,
  destination_lat: 45.785,
  destination_lng: 24.09,
  route_geojson: null,
  distance_m: 9588,
  duration_s: 1020,
  seats_offered: 3,
  seats_booked: 1,
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
  completed_at: null,
});

type Opts = {
  callerId?: string;
  suspended?: boolean;
  ride?: Record<string, unknown> | null;
  noShow?: Record<string, unknown> | null;
  rating?: Record<string, unknown> | null;
  state?: Record<string, unknown> | null;
  view?: Record<string, unknown> | null;
  /** Throw this from the first query that contains the fragment. */
  failOn?: { fragment: string; error: unknown };
  rateAllowed?: boolean;
};

/** Answers every query the E5 endpoints make. Unknown queries fall through to []. */
function safetyDb(o: Opts = {}): Handler {
  const callerId = o.callerId ?? PASSENGER;
  return (q: Query) => {
    const t = q.text;
    if (o.failOn && t.includes(o.failOn.fragment)) throw o.failOn.error;
    if (t.includes('app.rate_limit_hit')) return [{ allowed: o.rateAllowed !== false }];
    if (t.includes('from app.legal_documents')) {
      return [
        { kind: 'terms', version: '1.0', url: '/policy/terms' },
        { kind: 'privacy', version: '1.0', url: '/policy/privacy' },
      ];
    }
    if (t.includes('has_vehicle')) {
      return [profile(callerId, o.suspended ? { status: 'suspended' } : {})];
    }
    if (t.includes('from app.consents')) return ALL_ACCEPTED;
    if (t.includes('for update of r')) return o.ride === null ? [] : [o.ride ?? lockedRide()];
    if (t.includes('dp.first_name as driver_first_name')) {
      return o.noShow === null ? [] : [o.noShow ?? noShowCtx()];
    }
    if (t.includes('as rated_by_passenger'))
      return o.rating === null ? [] : [o.rating ?? ratingCtx()];
    if (t.includes('p.first_name as passenger_first_name')) {
      return o.state === null ? [] : [o.state ?? stateRow()];
    }
    if (t.includes('as segment_geojson') && t.includes('rp_stars')) {
      return o.view === null ? [] : [o.view ?? viewRow()];
    }
    if (t.includes('as route_geojson') && t.includes('from app.rides r')) return [ownerRow()];
    if (t.includes('rating_count')) return [publicProfile(DRIVER), publicProfile(PASSENGER)];
    if (t.startsWith('update app.bookings') && t.includes("status = 'no_show'"))
      return [{ id: BOOKING }];
    if (t.startsWith('update app.bookings') && t.includes("status = 'cancelled'")) {
      return [{ id: BOOKING }];
    }
    if (t.startsWith('insert into app.ratings')) {
      return [{ stars: 5, tags: ['punctual'], created_at: new Date('2026-11-16T10:00:00Z') }];
    }
    return undefined;
  };
}

const send = async (
  app: ReturnType<typeof makeApp>['app'],
  method: string,
  path: string,
  who: string | null,
  body?: unknown,
) =>
  app.request(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(who
        ? { authorization: `Bearer ${await signToken(who, { email: 'u@example.com' })}` }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;
const has = (calls: Query[], fragment: string) => calls.some((c) => c.text.includes(fragment));
const find = (calls: Query[], fragment: string) => calls.find((c) => c.text.includes(fragment));
const idx = (calls: Query[], fragment: string) => calls.findIndex((c) => c.text.includes(fragment));
const appAt = (iso: string, o: Opts = {}, extra: Handler[] = [], env = {}) =>
  makeApp([...extra, safetyDb(o)], env, { clock: fixedClock(iso) });

const AFTER_DEPARTURE = '2026-11-16T07:30:00Z';
const RATING_TIME = '2026-11-16T10:00:00Z';

// ---- gates shared by every protected route -------------------------------------------------------------------------

describe('E5 gates', () => {
  const routes: [string, string, unknown?][] = [
    ['POST', `/bookings/${BOOKING}/no-show`, {}],
    ['POST', `/bookings/${BOOKING}/ratings`, { stars: 5, tags: [] }],
    ['POST', `/bookings/${BOOKING}/share-link`, {}],
    ['DELETE', `/bookings/${BOOKING}/share-link`],
    ['POST', '/reports', { reportedUserId: DRIVER, reason: 'harassment' }],
    ['POST', '/blocks', { userId: DRIVER }],
    ['DELETE', `/blocks/${DRIVER}`],
    ['GET', '/me/blocks'],
  ];

  it.each(routes)('%s %s needs a signed-in user', async (method, path, body) => {
    const { app } = appAt(AFTER_DEPARTURE);
    expect((await send(app, method, path, null, body)).status).toBe(401);
  });

  it.each(routes)('%s %s is blocked for a suspended user', async (method, path, body) => {
    const { app, calls } = appAt(AFTER_DEPARTURE, { suspended: true });
    const res = await send(app, method, path, PASSENGER, body);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('ACCOUNT_SUSPENDED');
    expect(has(calls, 'insert into app.')).toBe(false);
  });

  it('rate limits reports, blocks and the public page with the E5 limits', async () => {
    const { app, calls } = appAt(AFTER_DEPARTURE);
    await send(app, 'POST', '/reports', PASSENGER, {
      reportedUserId: DRIVER,
      reason: 'harassment',
    });
    await send(app, 'POST', '/blocks', PASSENGER, { userId: DRIVER });
    await app.request(`${BASE}/share/${newShareToken()}`);
    const hits = calls.filter((c) => c.text.includes('app.rate_limit_hit'));
    const key = (prefix: string) => hits.find((h) => String(h.values[0]).startsWith(prefix));
    expect(key('report:u:')?.values.slice(1)).toEqual([
      RATE_LIMITS.report.windowS,
      RATE_LIMITS.report.max,
    ]);
    expect(key('block:u:')?.values.slice(1)).toEqual([
      RATE_LIMITS.block.windowS,
      RATE_LIMITS.block.max,
    ]);
    expect(key('share-view:ip:')?.values.slice(1)).toEqual([
      RATE_LIMITS.shareView.windowS,
      RATE_LIMITS.shareView.max,
    ]);
  });

  it('answers 429 when over the limit', async () => {
    const { app } = appAt(AFTER_DEPARTURE, { rateAllowed: false });
    const res = await send(app, 'POST', '/blocks', PASSENGER, { userId: DRIVER });
    expect(res.status).toBe(429);
  });
});

// ---- POST /bookings/{id}/no-show ----------------------------------------------------------------------------------------

describe('POST /bookings/{id}/no-show', () => {
  const post = (app: ReturnType<typeof makeApp>['app'], who: string) =>
    send(app, 'POST', `/bookings/${BOOKING}/no-show`, who, {});

  it('driver: locks ride then booking, marks it, one reliability event for the passenger, owner view back', async () => {
    const { app, calls } = appAt(AFTER_DEPARTURE, { callerId: DRIVER });
    const res = await post(app, DRIVER);
    expect(res.status).toBe(200);
    rideOwnerViewSchema.parse(await res.json());

    expect(idx(calls, 'for update of r')).toBeLessThan(idx(calls, 'for update of b'));
    const update = find(calls, "status = 'no_show'") as Query;
    expect(update.values).toContain('driver');
    expect(update.text).toContain("status in ('confirmed', 'completed')");
    expect(update.text).toContain('final_price_bani = null');
    const event = find(calls, 'insert into app.reliability_events') as Query;
    expect(event.values.slice(0, 3)).toEqual([PASSENGER, BOOKING, RIDE]);
    const outbox = find(calls, 'insert into app.outbox') as Query;
    expect(outbox.values[0]).toBe(PASSENGER);
    expect(outbox.values[1]).toBe('no_show_reported');
    expect(JSON.parse(String(outbox.values[2]))).toMatchObject({
      reporterRole: 'driver',
      reporterFirstName: 'Radu',
    });
    expect(find(calls, 'insert into app.analytics_events')?.values[0]).toBe('no_show_reported');
  });

  it('passenger: the event goes to the driver and the booking view comes back', async () => {
    const { app, calls } = appAt(AFTER_DEPARTURE, { callerId: PASSENGER });
    const res = await post(app, PASSENGER);
    expect(res.status).toBe(200);
    const view = bookingViewSchema.parse(await res.json());
    expect(view.noShowBy).toBe('driver');
    expect(find(calls, "status = 'no_show'")?.values).toContain('passenger');
    expect(find(calls, 'insert into app.reliability_events')?.values[0]).toBe(DRIVER);
  });

  it('a completed booking can still become a no-show', async () => {
    const { app } = appAt(AFTER_DEPARTURE, { noShow: noShowCtx({ status: 'completed' }) });
    expect((await post(app, PASSENGER)).status).toBe(200);
  });

  it('404 for someone who is not a party, and for an unknown booking', async () => {
    const { app } = appAt(AFTER_DEPARTURE, { callerId: STRANGER, ride: null });
    expect((await post(app, STRANGER)).status).toBe(404);
    const bad = await send(app, 'POST', '/bookings/nope/no-show', STRANGER, {});
    expect(bad.status).toBe(404);
  });

  it('WINDOW_CLOSED before departure and from departure + 24 h', async () => {
    const early = appAt('2026-11-16T06:59:59Z');
    const e = await post(early.app, PASSENGER);
    expect(e.status).toBe(409);
    expect((await errorOf(e)).code).toBe('WINDOW_CLOSED');
    const late = appAt('2026-11-17T07:00:00Z');
    expect((await errorOf(await post(late.app, PASSENGER))).code).toBe('WINDOW_CLOSED');
    expect(has(late.calls, "status = 'no_show'")).toBe(false);
  });

  it('INVALID_STATE for a cancelled booking and once either party has rated', async () => {
    const cancelled = appAt(AFTER_DEPARTURE, { noShow: noShowCtx({ status: 'cancelled' }) });
    expect((await errorOf(await post(cancelled.app, PASSENGER))).code).toBe('INVALID_STATE');
    const rated = appAt(AFTER_DEPARTURE, {
      noShow: noShowCtx({ status: 'completed', rated: true }),
    });
    expect((await errorOf(await post(rated.app, PASSENGER))).code).toBe('INVALID_STATE');
    expect(has(rated.calls, "status = 'no_show'")).toBe(false);
  });

  it('INVALID_STATE when the guarded update loses a race', async () => {
    const { app } = makeApp(
      [(q) => (q.text.startsWith('update app.bookings') ? [] : undefined), safetyDb()],
      {},
      { clock: fixedClock(AFTER_DEPARTURE) },
    );
    expect((await errorOf(await post(app, PASSENGER))).code).toBe('INVALID_STATE');
  });
});

// ---- POST /bookings/{id}/ratings ------------------------------------------------------------------------------------------

describe('POST /bookings/{id}/ratings', () => {
  const rate = (app: ReturnType<typeof makeApp>['app'], who: string, body: unknown) =>
    send(app, 'POST', `/bookings/${BOOKING}/ratings`, who, body);

  it('stores a blind rating that becomes visible at completion + 7 days', async () => {
    const { app, calls } = appAt(RATING_TIME);
    const res = await rate(app, PASSENGER, { stars: 5, tags: ['punctual'] });
    expect(res.status).toBe(201);
    expect(ratingGivenSchema.parse(await res.json())).toMatchObject({
      stars: 5,
      tags: ['punctual'],
    });

    const insert = find(calls, 'insert into app.ratings') as Query;
    expect(insert.values.slice(0, 3)).toEqual([BOOKING, PASSENGER, DRIVER]);
    expect(insert.values).toContainEqual(new Date('2026-11-23T09:05:00Z'));
    expect(has(calls, 'update app.ratings')).toBe(false);
    expect(idx(calls, 'for update of r')).toBeLessThan(idx(calls, 'for update of b'));
  });

  it('the response never says whether the counterpart rated', async () => {
    const { app } = appAt(RATING_TIME, {}, [], {});
    const body = await (await rate(app, PASSENGER, { stars: 4, tags: [] })).json();
    expect(Object.keys(body as object).sort()).toEqual(['createdAt', 'stars', 'tags']);
  });

  it('the second rating of a pair pulls both visible_at to now', async () => {
    const { app, calls } = appAt(RATING_TIME, { rating: ratingCtx({ rated_by_driver: true }) });
    expect((await rate(app, PASSENGER, { stars: 3, tags: [] })).status).toBe(201);
    const insert = find(calls, 'insert into app.ratings') as Query;
    expect(insert.values).toContainEqual(new Date(RATING_TIME));
    const pull = find(calls, 'update app.ratings') as Query;
    expect(pull.text).toContain('least(visible_at');
    expect(pull.values).toContain(DRIVER); // the counter-rating is the driver's
  });

  it('the driver rates the passenger with passenger tags', async () => {
    const { app, calls } = appAt(RATING_TIME, { callerId: DRIVER });
    expect((await rate(app, DRIVER, { stars: 5, tags: ['respectful'] })).status).toBe(201);
    expect(find(calls, 'insert into app.ratings')?.values.slice(0, 3)).toEqual([
      BOOKING,
      DRIVER,
      PASSENGER,
    ]);
    const wrong = appAt(RATING_TIME, { callerId: DRIVER });
    const res = await rate(wrong.app, DRIVER, { stars: 5, tags: ['clean_car'] });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({ tags: 'invalid' });
  });

  it('400 for bad stars, unknown tags and duplicate tags: nothing is written', async () => {
    const { app, calls } = appAt(RATING_TIME);
    expect((await rate(app, PASSENGER, { stars: 0, tags: [] })).status).toBe(400);
    expect((await rate(app, PASSENGER, { stars: 6, tags: [] })).status).toBe(400);
    expect((await rate(app, PASSENGER, { stars: 3.5, tags: [] })).status).toBe(400);
    const unknown = await rate(app, PASSENGER, { stars: 5, tags: ['rude'] });
    expect((await errorOf(unknown)).fields).toEqual({ tags: 'invalid' });
    const dup = await rate(app, PASSENGER, { stars: 5, tags: ['punctual', 'punctual'] });
    expect((await errorOf(dup)).fields).toEqual({ tags: 'invalid' });
    expect(has(calls, 'insert into app.ratings')).toBe(false);
  });

  it('INVALID_STATE unless completed, WINDOW_CLOSED at exactly +7 d, ALREADY_RATED', async () => {
    const notDone = appAt(RATING_TIME, { rating: ratingCtx({ status: 'confirmed' }) });
    expect((await errorOf(await rate(notDone.app, PASSENGER, { stars: 5, tags: [] }))).code).toBe(
      'INVALID_STATE',
    );

    const lastMs = appAt('2026-11-23T09:04:59.999Z');
    expect((await rate(lastMs.app, PASSENGER, { stars: 5, tags: [] })).status).toBe(201);
    const closed = appAt('2026-11-23T09:05:00Z');
    expect((await errorOf(await rate(closed.app, PASSENGER, { stars: 5, tags: [] }))).code).toBe(
      'WINDOW_CLOSED',
    );

    const twice = appAt(RATING_TIME, { rating: ratingCtx({ rated_by_passenger: true }) });
    const res = await rate(twice.app, PASSENGER, { stars: 5, tags: [] });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('ALREADY_RATED');
  });

  it('a parallel duplicate (23505 on the unique key) is ALREADY_RATED', async () => {
    const error = Object.assign(new Error('dup'), {
      code: '23505',
      constraint_name: 'ratings_booking_id_rater_id_key',
    });
    const { app } = appAt(RATING_TIME, { failOn: { fragment: 'insert into app.ratings', error } });
    const res = await rate(app, PASSENGER, { stars: 5, tags: [] });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('ALREADY_RATED');
  });

  it('404 for a stranger', async () => {
    const { app } = appAt(RATING_TIME, { callerId: STRANGER, ride: null });
    expect((await rate(app, STRANGER, { stars: 5, tags: [] })).status).toBe(404);
  });
});

// ---- share link ----------------------------------------------------------------------------------------------------------------

describe('share link', () => {
  it('creates a link: only the hash is stored, the URL carries the token, expiry is departure + 24 h', async () => {
    const { app, calls } = appAt('2026-11-16T06:00:00Z');
    const res = await send(app, 'POST', `/bookings/${BOOKING}/share-link`, PASSENGER, {});
    expect(res.status).toBe(201);
    const out = shareLinkResponseSchema.parse(await res.json());
    expect(out.expiresAt).toBe('2026-11-17T07:00:00.000Z');
    const token = out.url.split('/s/')[1] as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const upsert = find(calls, 'insert into app.share_links') as Query;
    expect(upsert.text).toContain('on conflict (booking_id) do update');
    const hex = [...(await hashShareToken(token))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(upsert.values).toContain(hex);
    expect(JSON.stringify(upsert.values)).not.toContain(token);
  });

  it('creating again rotates: a different token each time', async () => {
    const a = appAt('2026-11-16T06:00:00Z');
    const b = appAt('2026-11-16T06:00:00Z');
    const one = shareLinkResponseSchema.parse(
      await (await send(a.app, 'POST', `/bookings/${BOOKING}/share-link`, PASSENGER, {})).json(),
    );
    const two = shareLinkResponseSchema.parse(
      await (await send(b.app, 'POST', `/bookings/${BOOKING}/share-link`, PASSENGER, {})).json(),
    );
    expect(one.url).not.toBe(two.url);
  });

  it('the driver gets 404: only the passenger can share', async () => {
    const { app, calls } = appAt('2026-11-16T06:00:00Z', { callerId: DRIVER, ride: null });
    const res = await send(app, 'POST', `/bookings/${BOOKING}/share-link`, DRIVER, {});
    expect(res.status).toBe(404);
    expect(has(calls, 'insert into app.share_links')).toBe(false);
  });

  it('INVALID_STATE for a requested booking or a cancelled ride, WINDOW_CLOSED after departure + 24 h', async () => {
    const requested = appAt('2026-11-16T06:00:00Z', { state: stateRow({ status: 'requested' }) });
    const r1 = await send(requested.app, 'POST', `/bookings/${BOOKING}/share-link`, PASSENGER, {});
    expect((await errorOf(r1)).code).toBe('INVALID_STATE');
    const cancelled = appAt('2026-11-16T06:00:00Z', { ride: lockedRide({ status: 'cancelled' }) });
    const r2 = await send(cancelled.app, 'POST', `/bookings/${BOOKING}/share-link`, PASSENGER, {});
    expect((await errorOf(r2)).code).toBe('INVALID_STATE');
    const late = appAt('2026-11-17T07:00:00Z');
    const r3 = await send(late.app, 'POST', `/bookings/${BOOKING}/share-link`, PASSENGER, {});
    expect((await errorOf(r3)).code).toBe('WINDOW_CLOSED');
  });

  it('revokes with 204, idempotently; 404 for the driver', async () => {
    const { app, calls } = appAt('2026-11-16T06:00:00Z');
    const res = await send(app, 'DELETE', `/bookings/${BOOKING}/share-link`, PASSENGER);
    expect(res.status).toBe(204);
    expect(find(calls, 'delete from app.share_links')?.values).toEqual([BOOKING]);
    const driver = appAt('2026-11-16T06:00:00Z', { callerId: DRIVER });
    expect(
      (await send(driver.app, 'DELETE', `/bookings/${BOOKING}/share-link`, DRIVER)).status,
    ).toBe(404);
  });

  describe('GET /share/{token} (public)', () => {
    const sharedRow = (over: Record<string, unknown> = {}) => ({
      departure_at: DEPARTURE,
      duration_s: 1020,
      expires_at: new Date('2026-11-17T07:00:00Z'),
      status: 'confirmed',
      ride_status: 'published',
      driver_first_name: 'Radu',
      driver_photo_path: null,
      car_make: 'Dacia',
      car_model: 'Logan',
      car_colour: 'Grey',
      car_plate: PLATE,
      pickup_label: 'Șelimbăr',
      dropoff_label: 'Centru',
      pickup_fraction: 0.45,
      segment_geojson: JSON.stringify({
        type: 'LineString',
        coordinates: [
          [24.18611, 45.74132],
          [24.15211, 45.79712],
        ],
      }),
      // Columns a buggy query could add: they must never leave the API.
      passenger_phone: '+40722333444',
      driver_phone: '+40731111222',
      passenger_first_name: 'Ioana',
      ...over,
    });
    const sharedDb =
      (row: Record<string, unknown> | null): Handler =>
      (q) =>
        q.text.includes('from app.share_links sl') ? (row ? [row] : []) : undefined;

    it('shows the trip with the hardening headers and without phone or passenger', async () => {
      const token = newShareToken();
      const { app, calls } = makeApp(
        [sharedDb(sharedRow())],
        {},
        { clock: fixedClock('2026-11-16T06:30:00Z') },
      );
      const res = await app.request(`${BASE}/share/${token}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('x-robots-tag')).toContain('noindex');
      const text = await res.text();
      const trip = sharedTripSchema.parse(JSON.parse(text));
      expect(trip).toMatchObject({
        phase: 'before',
        driver: { firstName: 'Radu' },
        car: { plate: PLATE },
      });
      expect(trip.route?.coordinates).toHaveLength(2);
      expect(text).not.toContain('+407');
      expect(text).not.toContain('Ioana');
      const query = find(calls, 'from app.share_links sl') as Query;
      expect(query.text).toContain('sl.expires_at >');
      expect(query.text).toContain("dp.status = 'active' and pp.status = 'active'");
      expect(query.text).toContain("r.status <> 'cancelled'");
      expect(JSON.stringify(query.values)).not.toContain(token);
    });

    it('phase follows the clock: before, underway, done', async () => {
      const at = async (iso: string, over: Record<string, unknown> = {}) => {
        const { app } = makeApp([sharedDb(sharedRow(over))], {}, { clock: fixedClock(iso) });
        return sharedTripSchema.parse(
          await (await app.request(`${BASE}/share/${newShareToken()}`)).json(),
        ).phase;
      };
      expect(await at('2026-11-16T06:59:59Z')).toBe('before');
      expect(await at('2026-11-16T07:00:00Z')).toBe('underway');
      expect(await at('2026-11-16T08:59:59Z')).toBe('underway');
      expect(await at('2026-11-16T09:00:00Z')).toBe('done');
      expect(await at('2026-11-16T07:30:00Z', { status: 'completed' })).toBe('done');
    });

    it('malformed tokens are 404 without any database call, even the rate limit hit is the only one', async () => {
      const { app, calls } = makeApp([], {}, { clock: fixedClock('2026-11-16T06:30:00Z') });
      for (const bad of ['short', 'x'.repeat(23), `${'a'.repeat(21)}!`, '%20'.repeat(8)]) {
        expect((await app.request(`${BASE}/share/${bad}`)).status).toBe(404);
      }
      expect(has(calls, 'share_links')).toBe(false);
    });

    it('an unknown, expired, revoked or cancelled link is the same 404', async () => {
      const { app } = makeApp([sharedDb(null)], {}, { clock: fixedClock('2026-11-16T06:30:00Z') });
      const res = await app.request(`${BASE}/share/${newShareToken()}`);
      expect(res.status).toBe(404);
      expect((await errorOf(res)).code).toBe('NOT_FOUND');
    });

    it('needs no sign-in', async () => {
      const { app } = makeApp(
        [sharedDb(sharedRow())],
        {},
        { clock: fixedClock('2026-11-16T06:30:00Z') },
      );
      const res = await app.request(`${BASE}/share/${newShareToken()}`, {
        headers: { authorization: 'Bearer junk' },
      });
      expect(res.status).toBe(200);
    });

    it('the log line carries the route template, never the token', async () => {
      const lines: string[] = [];
      const token = newShareToken();
      const { app } = makeApp(
        [sharedDb(sharedRow())],
        {},
        {
          clock: fixedClock('2026-11-16T06:30:00Z'),
          log: (level, event, fields) => lines.push(JSON.stringify({ level, event, fields })),
        },
      );
      await app.request(`${BASE}/share/${token}`);
      const all = lines.join('\n');
      expect(all).toContain('/share/:token');
      expect(all).not.toContain(token);
    });
  });
});

// ---- POST /reports -----------------------------------------------------------------------------------------------------------------

describe('POST /reports', () => {
  const reportDb = (extra: Handler[] = []): Handler[] => [
    ...extra,
    (q) =>
      q.text.includes('select exists (select 1 from app.profiles') ? [{ found: true }] : undefined,
    (q) => (q.text.startsWith('insert into app.reports') ? [{ id: REPORT }] : undefined),
    (q) => (q.text.includes("role = 'admin'") ? [{ id: ADMIN }] : undefined),
    (q) =>
      q.text.includes('from app.bookings b join app.rides r on r.id = b.ride_id where b.id =')
        ? [{ passenger_id: PASSENGER, driver_id: DRIVER, ride_id: RIDE }]
        : undefined,
  ];
  const post = (app: ReturnType<typeof makeApp>['app'], body: unknown) =>
    send(app, 'POST', '/reports', PASSENGER, body);

  it('stores the report with a snapshot, notifies each admin with the id and reason only', async () => {
    const { app, calls } = appAt(AFTER_DEPARTURE, {}, reportDb());
    const res = await post(app, {
      reportedUserId: DRIVER,
      reason: 'unsafe_driving',
      details: '  Brakes hard  ',
      bookingId: BOOKING,
    });
    expect(res.status).toBe(201);
    expect(reportResponseSchema.parse(await res.json()).id).toBe(REPORT);

    const insert = find(calls, 'insert into app.reports') as Query;
    expect(insert.text).toContain(
      "jsonb_build_object('firstName', p.first_name, 'phoneE164', p.phone_e164)",
    );
    expect(insert.values).toContain('Brakes hard'); // trimmed
    expect(insert.values).toContain(RIDE); // derived from the booking
    const outbox = find(calls, 'insert into app.outbox') as Query;
    expect(outbox.values[0]).toBe(ADMIN);
    expect(outbox.values[1]).toBe('report_received');
    expect(JSON.parse(String(outbox.values[2]))).toEqual({
      reportId: REPORT,
      reason: 'unsafe_driving',
    });
    expect(has(calls, 'insert into app.blocks')).toBe(false);
  });

  it('400 for a self report and for `other` without details, 404 for an unknown user', async () => {
    const { app, calls } = appAt(AFTER_DEPARTURE, {}, reportDb());
    const self = await post(app, { reportedUserId: PASSENGER, reason: 'harassment' });
    expect(self.status).toBe(400);
    expect((await errorOf(self)).fields).toEqual({ reportedUserId: 'self' });
    const other = await post(app, { reportedUserId: DRIVER, reason: 'other', details: '   ' });
    expect((await errorOf(other)).fields).toEqual({ details: 'required' });
    const long = await post(app, {
      reportedUserId: DRIVER,
      reason: 'other',
      details: 'x'.repeat(501),
    });
    expect((await errorOf(long)).fields).toEqual({ details: 'too_long' });
    expect(has(calls, 'insert into app.reports')).toBe(false);

    const unknown = appAt(AFTER_DEPARTURE, {}, [
      (q) =>
        q.text.includes('select exists (select 1 from app.profiles')
          ? [{ found: false }]
          : undefined,
    ]);
    expect((await post(unknown.app, { reportedUserId: DRIVER, reason: 'harassment' })).status).toBe(
      404,
    );
  });

  it('404 when the booking is not between the reporter and the reported user', async () => {
    const { app, calls } = appAt(AFTER_DEPARTURE, {}, reportDb());
    const res = await post(app, {
      reportedUserId: STRANGER,
      reason: 'harassment',
      bookingId: BOOKING,
    });
    expect(res.status).toBe(404);
    expect(has(calls, 'insert into app.reports')).toBe(false);
  });

  it('404 when only a ride is given and a side is not a party of it', async () => {
    const { app } = appAt(AFTER_DEPARTURE, {}, [
      ...reportDb(),
      (q) => (q.text.includes('as party') ? [{ party: false }] : undefined),
    ]);
    const res = await post(app, { reportedUserId: DRIVER, reason: 'harassment', rideId: RIDE });
    expect(res.status).toBe(404);
  });

  it('alsoBlock commits the block, then cancels what is left between the pair', async () => {
    const { app, calls } = appAt('2026-11-16T05:00:00Z', {}, [
      ...reportDb(),
      (q) =>
        q.text.includes('from app.bookings bk join app.rides r')
          ? [{ id: BOOKING, ride_id: RIDE, passenger_id: PASSENGER }]
          : undefined,
    ]);
    const res = await post(app, { reportedUserId: DRIVER, reason: 'harassment', alsoBlock: true });
    expect(res.status).toBe(201);
    expect(idx(calls, 'insert into app.reports')).toBeLessThan(
      idx(calls, 'insert into app.blocks'),
    );
    expect(idx(calls, 'insert into app.blocks')).toBeLessThan(
      idx(calls, "cancelled_by = 'system'"),
    );
  });
});

// ---- blocks -------------------------------------------------------------------------------------------------------------------------

describe('blocks', () => {
  const FUTURE = '2026-11-16T05:00:00Z';
  const blockDb = (extra: Handler[] = []): Handler[] => [
    ...extra,
    (q) =>
      q.text.includes('select exists (select 1 from app.profiles') ? [{ found: true }] : undefined,
  ];
  const pairBooking: Handler = (q) =>
    q.text.includes('from app.bookings bk join app.rides r')
      ? [{ id: BOOKING, ride_id: RIDE, passenger_id: PASSENGER }]
      : undefined;

  it('POST /blocks: 204, idempotent insert, then the cascade cancels a confirmed booking', async () => {
    const { app, calls } = appAt(FUTURE, { callerId: PASSENGER }, blockDb([pairBooking]));
    const res = await send(app, 'POST', '/blocks', PASSENGER, { userId: DRIVER });
    expect(res.status).toBe(204);
    const insert = find(calls, 'insert into app.blocks') as Query;
    expect(insert.text).toContain('on conflict (blocker_id, blocked_id) do nothing');
    expect(insert.values.slice(0, 2)).toEqual([PASSENGER, DRIVER]);

    const cancel = find(calls, "cancelled_by = 'system'") as Query;
    expect(cancel.text).toContain('late_cancel = false');
    expect(cancel.values).toContain('confirmed');
    expect(has(calls, 'seats_booked = seats_booked +')).toBe(true);
    expect(has(calls, 'insert into app.reliability_events')).toBe(false);
    // The blocker is the passenger: the driver is told a booking was cancelled.
    const outbox = find(calls, 'insert into app.outbox') as Query;
    expect(outbox.values[0]).toBe(DRIVER);
    expect(outbox.values[1]).toBe('booking_cancelled');
  });

  it('a block by the driver rejects the passenger and marks the update unseen', async () => {
    const { app, calls } = appAt(FUTURE, { callerId: DRIVER }, blockDb([pairBooking]));
    expect((await send(app, 'POST', '/blocks', DRIVER, { userId: PASSENGER })).status).toBe(204);
    const outbox = find(calls, 'insert into app.outbox') as Query;
    expect(outbox.values[0]).toBe(PASSENGER);
    expect(outbox.values[1]).toBe('booking_rejected');
    expect(find(calls, "cancelled_by = 'system'")?.values).toContain(true); // notify the passenger
  });

  it('a departed ride is left alone', async () => {
    const { app, calls } = appAt(AFTER_DEPARTURE, { callerId: PASSENGER }, blockDb([pairBooking]));
    expect((await send(app, 'POST', '/blocks', PASSENGER, { userId: DRIVER })).status).toBe(204);
    expect(has(calls, "cancelled_by = 'system'")).toBe(false);
  });

  it('still answers 204 when the cascade fails (the sweep finishes the job)', async () => {
    const { app, calls } = appAt(
      FUTURE,
      {
        callerId: PASSENGER,
        failOn: { fragment: "cancelled_by = 'system'", error: new Error('boom') },
      },
      blockDb([pairBooking]),
    );
    expect((await send(app, 'POST', '/blocks', PASSENGER, { userId: DRIVER })).status).toBe(204);
    expect(has(calls, 'insert into app.blocks')).toBe(true);
  });

  it('400 for blocking yourself or a malformed id, 404 for an unknown user', async () => {
    const { app, calls } = appAt(FUTURE, {}, blockDb());
    const self = await send(app, 'POST', '/blocks', PASSENGER, { userId: PASSENGER });
    expect(self.status).toBe(400);
    expect((await errorOf(self)).fields).toEqual({ userId: 'self' });
    expect((await send(app, 'POST', '/blocks', PASSENGER, { userId: 'nope' })).status).toBe(400);
    expect(has(calls, 'insert into app.blocks')).toBe(false);
    const unknown = appAt(FUTURE, {}, [
      (q) =>
        q.text.includes('select exists (select 1 from app.profiles')
          ? [{ found: false }]
          : undefined,
    ]);
    expect((await send(unknown.app, 'POST', '/blocks', PASSENGER, { userId: DRIVER })).status).toBe(
      404,
    );
  });

  it('DELETE /blocks/{userId} removes only the caller own row, 204 also when nothing is there', async () => {
    const { app, calls } = appAt(FUTURE);
    expect((await send(app, 'DELETE', `/blocks/${DRIVER}`, PASSENGER)).status).toBe(204);
    const del = find(calls, 'delete from app.blocks') as Query;
    expect(del.text).toContain('blocker_id =');
    expect(del.values).toEqual([PASSENGER, DRIVER]);
    expect((await send(app, 'DELETE', '/blocks/not-a-uuid', PASSENGER)).status).toBe(400);
  });

  it('GET /me/blocks lists outgoing blocks only, newest first, with public users', async () => {
    const { app, calls } = appAt(FUTURE, {}, [
      (q) =>
        q.text.includes('from app.blocks') && q.text.includes('blocker_id =')
          ? [{ blocked_id: DRIVER, created_at: new Date('2026-11-15T10:00:00Z') }]
          : undefined,
    ]);
    const res = await send(app, 'GET', '/me/blocks', PASSENGER);
    expect(res.status).toBe(200);
    const out = blocksResponseSchema.parse(await res.json());
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.user.firstName).toBe('Radu');
    expect(out.items[0]?.blockedAt).toBe('2026-11-15T10:00:00.000Z');
    const q = find(calls, 'from app.blocks') as Query;
    expect(q.text).toContain('order by created_at desc');
    expect(q.values).toContain(200);
    expect(JSON.stringify(out)).not.toMatch(/\+40\d+/);
  });
});

// ---- tick: completion and sweep ------------------------------------------------------------------------------------------------------

describe('tick steps', () => {
  const TICK = '2026-11-16T09:30:00Z';
  const tick = (app: ReturnType<typeof makeApp>['app']) =>
    app.request(`${BASE}/internal/tick`, {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-cron-secret-0123456789' },
    });
  const counts: Handler = (q) =>
    q.text.includes('select count(*)::int as n') ? [{ n: 0 }] : undefined;

  it('completes rides 2 h after departure, queues a prompt per passenger and one for the driver', async () => {
    const { app, calls } = makeApp(
      [
        (q) =>
          q.text.includes('from app.complete_rides')
            ? [
                {
                  ride_id: RIDE,
                  driver_id: DRIVER,
                  driver_first_name: 'Radu',
                  departure_at: DEPARTURE,
                  outcome: 'completed',
                  booking_ids: [BOOKING],
                  passenger_ids: [PASSENGER],
                },
              ]
            : undefined,
        counts,
      ],
      {},
      { clock: fixedClock(TICK) },
    );
    const out = (await (await tick(app)).json()) as Record<string, number>;
    expect(out.completed).toBe(1);

    const fn = find(calls, 'from app.complete_rides') as Query;
    expect(fn.values).toEqual([new Date(TICK), new Date('2026-11-16T07:30:00Z'), 200]);
    const outbox = calls.filter((c) => c.text.includes('insert into app.outbox'));
    expect(outbox.map((c) => [c.values[0], c.values[1]])).toEqual([
      [PASSENGER, 'rating_prompt'],
      [DRIVER, 'rating_prompt_driver'],
    ]);
    expect(JSON.parse(String(outbox[0]?.values[2]))).toEqual({
      bookingId: BOOKING,
      driverFirstName: 'Radu',
      departureAt: '2026-11-16T07:00:00.000Z',
    });
    const event = find(calls, 'insert into app.analytics_events') as Query;
    expect(event.values[0]).toBe('ride_completed');
  });

  it('an expired ride (no completed booking) sends no prompt and no analytics', async () => {
    const { app, calls } = makeApp(
      [
        (q) =>
          q.text.includes('from app.complete_rides')
            ? [
                {
                  ride_id: RIDE,
                  driver_id: DRIVER,
                  driver_first_name: 'Radu',
                  departure_at: DEPARTURE,
                  outcome: 'expired',
                  booking_ids: '{}',
                  passenger_ids: '{}',
                },
              ]
            : undefined,
        counts,
      ],
      {},
      { clock: fixedClock(TICK) },
    );
    expect(((await (await tick(app)).json()) as Record<string, number>).completed).toBe(1);
    expect(has(calls, 'insert into app.outbox')).toBe(false);
    expect(has(calls, 'insert into app.analytics_events')).toBe(false);
  });

  it('the sweep cancels the future rides of a suspended driver, with the system wording', async () => {
    const { app, calls } = makeApp(
      [
        (q) =>
          q.text.includes("p.status in ('suspended', 'deleted')") &&
          q.text.includes('select r.id from app.rides r')
            ? [{ id: RIDE }]
            : undefined,
        (q) =>
          q.text.includes('for update of r')
            ? [
                lockedRide({
                  departure_at: new Date('2026-11-16T12:00:00Z'),
                  driver_status: 'suspended',
                }),
              ]
            : undefined,
        (q) =>
          q.text.includes('select first_name from app.profiles')
            ? [{ first_name: 'Radu' }]
            : undefined,
        (q) =>
          q.text.includes("update app.bookings set status = 'cancelled'") ||
          q.text.includes("cancelled_by = 'system'")
            ? [
                {
                  id: BOOKING,
                  passenger_id: PASSENGER,
                  pickup_label: 'Șelimbăr',
                  dropoff_label: 'Centru',
                },
              ]
            : undefined,
        counts,
      ],
      {},
      { clock: fixedClock(TICK) },
    );
    const out = (await (await tick(app)).json()) as Record<string, number>;
    expect(out.swept).toBe(1);
    const ride = find(calls, "set status = 'cancelled', cancelled_at") as Query;
    expect(ride.text).toContain('update app.rides');
    const outbox = find(calls, 'insert into app.outbox') as Query;
    expect(outbox.values[1]).toBe('ride_cancelled');
    expect(JSON.parse(String(outbox.values[2]))).toMatchObject({ by: 'system' });
    expect(has(calls, 'insert into app.reliability_events')).toBe(false);
  });

  it('a failing sweep is recorded and dispatch still runs', async () => {
    const { app, calls } = makeApp(
      [
        (q) => {
          if (q.text.includes("p.status in ('suspended', 'deleted')")) throw new Error('db down');
          return undefined;
        },
        counts,
      ],
      {},
      { clock: fixedClock(TICK) },
    );
    expect((await tick(app)).status).toBe(200);
    expect(String(find(calls, 'insert into app.app_errors')?.values[1])).toContain('tick sweep');
    expect(has(calls, 'update app.outbox set attempts')).toBe(true);
  });

  it('runs the steps in order: expire, complete, sweep, dispatch, purge', async () => {
    const { app, calls } = makeApp([counts], {}, { clock: fixedClock(TICK) });
    await tick(app);
    const order = [
      'from app.expire_requests',
      'from app.complete_rides',
      "p.status in ('suspended', 'deleted')",
      'update app.outbox set attempts',
      'delete from app.route_previews',
      'delete from app.share_links',
    ].map((f) => idx(calls, f));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
