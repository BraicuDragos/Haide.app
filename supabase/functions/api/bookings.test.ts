import { describe, expect, it } from 'vitest';
import {
  bookingListResponseSchema,
  bookingViewSchema,
  summaryResponseSchema,
} from '../_shared/contracts/bookings.ts';
import { errorEnvelopeSchema } from '../_shared/contracts/errors.ts';
import { rideOwnerViewSchema } from '../_shared/contracts/rides.ts';
import { fixedClock } from '../_shared/domain/clock.ts';
import { RATE_LIMITS } from '../_shared/domain/rules.ts';
import { mapBookingDbError } from './services/bookings.ts';
import { BASE, makeApp, signToken, type Handler, type Query } from './testing.ts';

const PASSENGER = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';
const DRIVER = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const STRANGER = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const RIDE = '5b0c7f0e-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const OTHER_RIDE = '7c0c7f0e-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const BOOKING = 'b1b1b1b1-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const KEY = 'd4d4d4d4-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const PLATE = 'SB12ABC';
const DRIVER_PHONE = '+40731111222';
const PASSENGER_PHONE = '+40722333444';

const NOW = '2026-11-16T05:00:00Z';
const DEPARTURE = new Date('2026-11-16T07:00:00Z');

const ALL_ACCEPTED = [
  { kind: 'age_18', version: null },
  { kind: 'terms', version: '1.0' },
  { kind: 'privacy', version: '1.0' },
];

const profile = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  first_name: id === DRIVER ? 'Radu' : 'Ioana',
  phone_e164: id === DRIVER ? DRIVER_PHONE : PASSENGER_PHONE,
  bio: null,
  photo_path: 'avatars/6f9619ff-8b86-4d11-b42d-00c04fc964ff.jpg',
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
  seats_booked: 0,
  is_free: false,
  rate_micro_per_km: 686_700,
  driver_status: 'active',
  ...over,
});

const matchRow = (over: Record<string, unknown> = {}) => ({
  f_pickup: 0.45,
  f_dropoff: 0.97,
  segment_m: 5390,
  walk_pickup_m: 163.4,
  walk_dropoff_m: 41.2,
  ...over,
});

const stateRow = (over: Record<string, unknown> = {}) => ({
  id: BOOKING,
  ride_id: RIDE,
  passenger_id: PASSENGER,
  status: 'requested',
  pickup_label: 'Șelimbăr',
  dropoff_label: 'Centru',
  pickup_fraction: 0.45,
  segment_m: 5390,
  price_quoted_bani: 180,
  price_locked_bani: null,
  requested_at: new Date('2026-11-16T04:50:00Z'),
  expires_at: new Date('2026-11-16T05:20:00Z'),
  passenger_first_name: 'Ioana',
  ...over,
});

// Exact numbers that must never appear for a hidden booking.
const EXACT = { pickup: [45.74132, 24.18611], dropoff: [45.79712, 24.15211] };
const SEGMENT = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [24.18611, 45.74132],
    [24.17, 45.77],
    [24.15211, 45.79712],
  ],
});
const PUBLIC_ROUTE = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [24.19, 45.75],
    [24.16, 45.79],
  ],
});

const viewRow = (over: Record<string, unknown> = {}) => ({
  id: BOOKING,
  ride_id: RIDE,
  passenger_id: PASSENGER,
  driver_id: DRIVER,
  status: 'requested',
  ride_status: 'published',
  departure_at: DEPARTURE,
  duration_s: 1020,
  pickup_label: 'Șelimbăr',
  dropoff_label: 'Centru',
  pickup_lat: EXACT.pickup[0],
  pickup_lng: EXACT.pickup[1],
  dropoff_lat: EXACT.dropoff[0],
  dropoff_lng: EXACT.dropoff[1],
  pickup_grid_lat: 45.7412,
  pickup_grid_lng: 24.1869,
  dropoff_grid_lat: 45.7967,
  dropoff_grid_lng: 24.1522,
  pickup_fraction: 0.45,
  segment_m: 5390,
  walk_pickup_m: 163,
  walk_dropoff_m: 41,
  price_quoted_bani: 180,
  price_locked_bani: null,
  final_price_bani: null,
  requested_at: new Date('2026-11-16T04:50:00Z'),
  expires_at: new Date('2026-11-16T05:20:00Z'),
  decided_at: null,
  cancelled_at: null,
  cancelled_by: null,
  unseen: false,
  car_make: 'Dacia',
  car_model: 'Logan',
  car_colour: 'Grey',
  car_plate: PLATE,
  driver_phone: DRIVER_PHONE,
  passenger_phone: PASSENGER_PHONE,
  segment_geojson: SEGMENT,
  route_public: PUBLIC_ROUTE,
  ...over,
});

type Opts = {
  callerId?: string;
  ride?: Record<string, unknown> | null;
  keyRow?: Record<string, unknown> | null;
  blocked?: boolean;
  already?: boolean;
  match?: Record<string, unknown> | null;
  state?: Record<string, unknown> | null;
  view?: Record<string, unknown> | null;
  confirmed?: Record<string, unknown>[];
  /** Throw this from the first write that matches the fragment. */
  failOn?: { fragment: string; error: unknown };
  /** A guarded update that matches no row (lost race). */
  noRowOn?: string;
  consent?: typeof ALL_ACCEPTED;
};

/** Handler that answers every query the booking code makes. Unknown queries fall through to []. */
function bookingDb(o: Opts = {}): Handler {
  const callerId = o.callerId ?? PASSENGER;
  return (q: Query) => {
    const t = q.text;
    if (o.failOn && t.includes(o.failOn.fragment)) throw o.failOn.error;
    if (o.noRowOn && t.includes(o.noRowOn)) return [];
    if (t.includes('from app.legal_documents')) {
      return [
        { kind: 'terms', version: '1.0', url: '/policy/terms' },
        { kind: 'privacy', version: '1.0', url: '/policy/privacy' },
      ];
    }
    if (t.includes('has_vehicle')) return [profile(callerId)];
    if (t.includes('from app.consents')) return o.consent ?? ALL_ACCEPTED;
    if (t.includes('for update of r')) return o.ride === null ? [] : [o.ride ?? lockedRide()];
    if (t.includes('idempotency_key = ')) return o.keyRow ? [o.keyRow] : [];
    if (t.includes('as blocked')) return [{ blocked: o.blocked === true }];
    if (t.includes('as found')) return [{ found: o.already === true }];
    if (t.includes('from app.match_rides')) return o.match === null ? [] : [o.match ?? matchRow()];
    if (t.startsWith('with pts as')) {
      return [{ id: BOOKING, pickup_label: 'Șelimbăr', dropoff_label: 'Centru' }];
    }
    if (
      t.includes('b.passenger_first_name') ||
      t.includes('p.first_name as passenger_first_name')
    ) {
      return o.state === null ? [] : [o.state ?? stateRow()];
    }
    if (t.includes('as segment_geojson')) return o.view === null ? [] : [o.view ?? viewRow()];
    if (t.includes('rating_count')) return [publicProfile(DRIVER), publicProfile(PASSENGER)];
    if (t.startsWith('update app.bookings') && t.includes("status = 'confirmed'")) {
      return [{ id: BOOKING }];
    }
    if (t.startsWith('update app.bookings') && t.includes("status = 'rejected'")) {
      return [{ id: BOOKING }];
    }
    if (t.startsWith('update app.bookings') && t.includes("status = 'cancelled'")) {
      return [{ id: BOOKING }];
    }
    if (t.includes('select id, segment_m, price_quoted_bani, price_locked_bani')) {
      return o.confirmed ?? [];
    }
    return undefined;
  };
}

const token = async (sub: string) => ({
  authorization: `Bearer ${await signToken(sub, { email: 'user@example.com' })}`,
});
const send = async (
  app: ReturnType<typeof makeApp>['app'],
  method: string,
  path: string,
  who: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(await token(who)),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;
const has = (calls: Query[], fragment: string) => calls.some((c) => c.text.includes(fragment));
const find = (calls: Query[], fragment: string) => calls.find((c) => c.text.includes(fragment));
const idx = (calls: Query[], fragment: string) => calls.findIndex((c) => c.text.includes(fragment));

const REQUEST = {
  rideId: RIDE,
  from: { lat: 45.7413, lng: 24.1861 },
  to: { lat: 45.7977, lng: 24.1505 },
};
const withKey = { 'idempotency-key': KEY };

const makeBookingApp = (o: Opts = {}, extra: Handler[] = []) =>
  makeApp([...extra, bookingDb(o)], {}, { clock: fixedClock(NOW) });

// ---- POST /bookings --------------------------------------------------------------------------------------

describe('POST /bookings', () => {
  const post = (app: ReturnType<typeof makeApp>['app'], body: unknown = REQUEST, h = withKey) =>
    send(app, 'POST', '/bookings', PASSENGER, body, h);

  it('requires sign-in, consent and a complete profile', async () => {
    const { app } = makeBookingApp();
    const anon = await app.request(`${BASE}/bookings`, { method: 'POST' });
    expect(anon.status).toBe(401);

    const noConsent = makeBookingApp({ consent: [] });
    const res = await post(noConsent.app);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('CONSENT_REQUIRED');
  });

  it('PROFILE_INCOMPLETE when the profile has no first name or phone', async () => {
    const { app } = makeApp(
      [
        (q) =>
          q.text.includes('has_vehicle')
            ? [profile(PASSENGER, { first_name: null, phone_e164: null })]
            : undefined,
        bookingDb(),
      ],
      {},
      { clock: fixedClock(NOW) },
    );
    const res = await post(app);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('PROFILE_INCOMPLETE');
  });

  it('needs an Idempotency-Key header that is a uuid', async () => {
    const { app, calls } = makeBookingApp();
    const missing = await post(app, REQUEST, {} as typeof withKey);
    expect(missing.status).toBe(400);
    expect(await errorOf(missing)).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { idempotencyKey: 'required' },
    });
    const bad = await post(app, REQUEST, { 'idempotency-key': 'not-a-uuid' });
    expect(await errorOf(bad)).toMatchObject({ fields: { idempotencyKey: 'invalid' } });
    expect(has(calls, 'insert')).toBe(false);
  });

  it('validates the body at the boundary and ignores any price field', async () => {
    const { app } = makeBookingApp();
    const bad = await post(app, { ...REQUEST, rideId: 'nope' });
    expect(bad.status).toBe(400);
    const outside = await post(app, { ...REQUEST, from: { lat: 50, lng: 10 } });
    expect(outside.status).toBe(400);
    expect((await errorOf(outside)).fields).toMatchObject({ from: 'outside_coverage' });
    const noJson = await app.request(`${BASE}/bookings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await token(PASSENGER)), ...withKey },
      body: '{',
    });
    expect(noJson.status).toBe(400);
  });

  it('creates the request: lock first, server-side price, outbox and analytics in the same transaction', async () => {
    const { app, calls } = makeBookingApp();
    const res = await post(app);
    expect(res.status).toBe(201);
    const view = bookingViewSchema.parse(await res.json());
    expect(view).toMatchObject({
      id: BOOKING,
      status: 'requested',
      viewerRole: 'passenger',
      contact: null,
      price: { quotedBani: 180, lockedBani: null, finalBani: null, droppedFromBani: null },
    });
    expect(view.car.plate).toBeNull();

    // timeout, then the ride lock, then the guards, then the insert
    expect(idx(calls, "set local statement_timeout = '5s'")).toBeGreaterThanOrEqual(0);
    const lock = idx(calls, 'for update of r');
    const insert = idx(calls, 'insert into app.bookings');
    expect(lock).toBeGreaterThan(idx(calls, 'statement_timeout'));
    expect(insert).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(idx(calls, 'from app.match_rides'));

    const ins = find(calls, 'insert into app.bookings') as Query;
    // quoteUpTo(5390 m, 686700 micro/km, n = 1) = 1.80 RON: never taken from the client
    expect(ins.values).toContain(180);
    expect(ins.values).toContain(KEY);
    // expires_at = least(now + 30 min, departure - 10 min) = 05:30
    expect(
      ins.values.some((v) => v instanceof Date && v.toISOString() === '2026-11-16T05:30:00.000Z'),
    ).toBe(true);

    const outbox = find(calls, 'insert into app.outbox') as Query;
    expect(outbox.values[0]).toBe(DRIVER);
    expect(outbox.values[1]).toBe('booking_requested');
    const payload = JSON.parse(String(outbox.values[2]));
    expect(payload).toMatchObject({
      bookingId: BOOKING,
      rideId: RIDE,
      pickupArea: 'Șelimbăr',
      dropoffArea: 'Centru',
    });
    expect(JSON.stringify(payload)).not.toMatch(/\d+\.\d{4,}|\+40|SB12/);
    expect(has(calls, 'insert into app.analytics_events')).toBe(true);
  });

  it('a hidden booking carries grid points, never an exact coordinate, phone or plate', async () => {
    const { app } = makeBookingApp();
    const text = await (await post(app)).text();
    for (const n of [...EXACT.pickup, ...EXACT.dropoff]) expect(text).not.toContain(String(n));
    expect(text).not.toContain(PLATE);
    expect(text).not.toContain('+4073');
    expect(text).not.toContain('+4072');
    expect(text).toContain('"approx":true');
    expect(text).toContain('"walkM":150'); // 163 m rounds to 150
  });

  it('answers each rule with its own 409', async () => {
    const cases: [Opts, string][] = [
      [{ ride: lockedRide({ driver_id: PASSENGER }) }, 'OWN_RIDE'],
      [{ blocked: true }, 'BLOCKED'],
      [{ already: true }, 'ALREADY_REQUESTED'],
      [{ ride: lockedRide({ status: 'cancelled' }) }, 'RIDE_NOT_BOOKABLE'],
      [
        { ride: lockedRide({ departure_at: new Date('2026-11-16T05:09:00Z') }) },
        'RIDE_NOT_BOOKABLE',
      ],
      [{ ride: lockedRide({ seats_booked: 3 }) }, 'RIDE_FULL'],
      [{ match: null }, 'NO_LONGER_MATCHES'],
    ];
    for (const [opts, code] of cases) {
      const { app, calls } = makeBookingApp(opts);
      const res = await post(app);
      expect(res.status, code).toBe(409);
      expect((await errorOf(res)).code).toBe(code);
      expect(has(calls, 'insert into app.bookings'), code).toBe(false);
    }
  });

  it('an unknown ride or an inactive driver is a 404', async () => {
    const unknown = makeBookingApp({ ride: null });
    expect((await post(unknown.app)).status).toBe(404);
    const suspended = makeBookingApp({ ride: lockedRide({ driver_status: 'suspended' }) });
    expect((await post(suspended.app)).status).toBe(404);
  });

  it('the request cutoff at exactly 10 minutes leaves nothing to answer: not bookable', async () => {
    const { app } = makeBookingApp({
      ride: lockedRide({ departure_at: new Date('2026-11-16T05:10:00Z') }),
    });
    const res = await post(app);
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('RIDE_NOT_BOOKABLE');
  });

  it('a replay with the same key returns the current view without inserting', async () => {
    const { app, calls } = makeBookingApp({ keyRow: { id: BOOKING, ride_id: RIDE } });
    const res = await post(app);
    expect(res.status).toBe(201);
    expect(bookingViewSchema.parse(await res.json()).id).toBe(BOOKING);
    expect(has(calls, 'insert into app.bookings')).toBe(false);
    expect(has(calls, 'insert into app.outbox')).toBe(false);
  });

  it('the same key for another ride is a 400 reused key', async () => {
    const { app } = makeBookingApp({ keyRow: { id: BOOKING, ride_id: OTHER_RIDE } });
    const res = await post(app);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { idempotencyKey: 'reused' },
    });
  });

  it('maps the database backstops: one-active index, seats CHECK, key index', async () => {
    const pg = (code: string, constraint_name: string) => ({ code, constraint_name });
    const one = makeBookingApp({
      failOn: {
        fragment: 'insert into app.bookings',
        error: pg('23505', 'bookings_one_active_uidx'),
      },
    });
    expect((await errorOf(await post(one.app))).code).toBe('ALREADY_REQUESTED');
    const key = makeBookingApp({
      failOn: {
        fragment: 'insert into app.bookings',
        error: pg('23505', 'bookings_idempotency_uniq'),
      },
    });
    expect(await errorOf(await post(key.app))).toMatchObject({
      fields: { idempotencyKey: 'reused' },
    });
    expect(() => mapBookingDbError(pg('23514', 'rides_seats_booked_range'))).toThrow(/full/i);
    expect(() => mapBookingDbError(new Error('boom'))).toThrow('boom');
    expect(() => mapBookingDbError(pg('23505', 'something_else'))).toThrow();
  });

  it('is rate limited to 10 per hour', async () => {
    const seen: string[] = [];
    const { app } = makeApp(
      [
        (q) => {
          if (q.text.includes('app.rate_limit_hit')) {
            seen.push(`${q.values[0]}|${q.values[1]}|${q.values[2]}`);
            return [{ allowed: false }];
          }
          return undefined;
        },
        bookingDb(),
      ],
      {},
      { clock: fixedClock(NOW) },
    );
    const res = await post(app);
    expect(res.status).toBe(429);
    expect(seen[0]).toBe(
      `booking-request:u:${PASSENGER}|${RATE_LIMITS.bookingRequest.windowS}|${RATE_LIMITS.bookingRequest.max}`,
    );
  });
});

// ---- GET /bookings/{id} -------------------------------------------------------------------------------------

describe('GET /bookings/{id}', () => {
  const confirmed = (over: Record<string, unknown> = {}) =>
    viewRow({
      status: 'confirmed',
      price_quoted_bani: 390,
      price_locked_bani: 260,
      decided_at: new Date('2026-11-16T04:55:00Z'),
      ...over,
    });

  it('shows the passenger the exact own segment, the driver phone and the plate once confirmed', async () => {
    const { app } = makeBookingApp({ view: confirmed() });
    const res = await send(app, 'GET', `/bookings/${BOOKING}`, PASSENGER);
    expect(res.status).toBe(200);
    const view = bookingViewSchema.parse(await res.json());
    expect(view.pickup.point).toEqual({ lat: 45.74132, lng: 24.18611 });
    expect(view.dropoff.point).toEqual({ lat: 45.79712, lng: 24.15211 });
    expect(view.route?.coordinates).toHaveLength(3);
    expect(view.contact).toEqual({
      phoneE164: DRIVER_PHONE,
      revealedUntil: '2026-11-17T07:00:00.000Z',
    });
    expect(view.car.plate).toBe(PLATE);
    expect(view.price).toMatchObject({ quotedBani: 390, lockedBani: 260, droppedFromBani: 390 });
    expect(view.timeline.map((t) => t.status)).toEqual(['requested', 'confirmed']);
    expect(view.actions).toMatchObject({ canCancel: true, lateCancelIfNow: false });
    // the passenger never sees the passenger phone
    expect(JSON.stringify(view)).not.toContain(PASSENGER_PHONE);
  });

  it('shows the driver the passenger phone, and the plate they own', async () => {
    const { app } = makeApp(
      [bookingDb({ view: confirmed(), callerId: DRIVER })],
      {},
      {
        clock: fixedClock(NOW),
      },
    );
    const view = bookingViewSchema.parse(
      await (await send(app, 'GET', `/bookings/${BOOKING}`, DRIVER)).json(),
    );
    expect(view.viewerRole).toBe('driver');
    expect(view.contact?.phoneE164).toBe(PASSENGER_PHONE);
    expect(view.actions.canCancel).toBe(false);
    expect(view.unseen).toBe(false);
  });

  it('hides everything again at exactly departure + 24 h', async () => {
    for (const [now, hidden] of [
      ['2026-11-17T06:59:59Z', false],
      ['2026-11-17T07:00:00Z', true],
    ] as const) {
      const { app } = makeApp([bookingDb({ view: confirmed() })], {}, { clock: fixedClock(now) });
      const text = await (await send(app, 'GET', `/bookings/${BOOKING}`, PASSENGER)).text();
      expect(text.includes(DRIVER_PHONE), now).toBe(!hidden);
      expect(text.includes(PLATE), now).toBe(!hidden);
      expect(text.includes('45.74132'), now).toBe(!hidden);
    }
  });

  it.each(['requested', 'rejected', 'expired', 'cancelled'])(
    'leaks no exact coordinate, phone or plate for a %s booking',
    async (status) => {
      const view = viewRow({
        status,
        decided_at: status === 'rejected' ? new Date('2026-11-16T04:55:00Z') : null,
        cancelled_at: status === 'cancelled' ? new Date('2026-11-16T04:56:00Z') : null,
        cancelled_by: status === 'cancelled' ? 'passenger' : null,
      });
      for (const who of [PASSENGER, DRIVER]) {
        const { app } = makeApp(
          [bookingDb({ view, callerId: who })],
          {},
          {
            clock: fixedClock(NOW),
          },
        );
        const res = await send(app, 'GET', `/bookings/${BOOKING}`, who);
        expect(res.status).toBe(200);
        const text = await res.text();
        for (const n of [...EXACT.pickup, ...EXACT.dropoff]) expect(text).not.toContain(String(n));
        expect(text).not.toContain(PASSENGER_PHONE);
        expect(text).not.toContain(DRIVER_PHONE);
        if (who === PASSENGER) expect(text).not.toContain(PLATE);
        // the route is the trimmed public one, not the exact segment
        expect(text).not.toContain('24.17,45.77');
      }
    },
  );

  it('a stranger, an unknown id and a malformed id are all the same 404', async () => {
    const stranger = makeApp([bookingDb({ callerId: STRANGER })], {}, { clock: fixedClock(NOW) });
    const a = await send(stranger.app, 'GET', `/bookings/${BOOKING}`, STRANGER);
    const missing = makeBookingApp({ view: null });
    const b = await send(missing.app, 'GET', `/bookings/${BOOKING}`, PASSENGER);
    const c = await send(missing.app, 'GET', '/bookings/not-a-uuid', PASSENGER);
    for (const r of [a, b, c]) {
      expect(r.status).toBe(404);
      expect((await errorOf(r)).code).toBe('NOT_FOUND');
    }
  });

  it('a driver cancel reads as ride_cancelled in the timeline', async () => {
    const { app } = makeBookingApp({
      view: viewRow({
        status: 'cancelled',
        cancelled_at: new Date('2026-11-16T04:56:00Z'),
        cancelled_by: 'driver',
        ride_status: 'cancelled',
      }),
    });
    const view = bookingViewSchema.parse(
      await (await send(app, 'GET', `/bookings/${BOOKING}`, PASSENGER)).json(),
    );
    expect(view.timeline.map((t) => t.status)).toEqual(['requested', 'ride_cancelled']);
    expect(view.cancelledBy).toBe('driver');
    expect(view.actions.canCancel).toBe(false);
  });

  it('flags an unseen update for the passenger only', async () => {
    const { app } = makeBookingApp({ view: viewRow({ unseen: true }) });
    const view = bookingViewSchema.parse(
      await (await send(app, 'GET', `/bookings/${BOOKING}`, PASSENGER)).json(),
    );
    expect(view.unseen).toBe(true);
  });
});

// The owner view read (select ... as route_geojson from app.rides r) is not part of bookingDb.
const ownerRide: Handler = (q) =>
  q.text.includes('as route_geojson')
    ? [
        {
          id: RIDE,
          status: 'published',
          departure_at: DEPARTURE,
          origin_label: 'Șelimbăr',
          destination_label: 'Centru',
          origin_lat: 45.7413,
          origin_lng: 24.1861,
          destination_lat: 45.785,
          destination_lng: 24.09,
          route_geojson: PUBLIC_ROUTE,
          distance_m: 11514,
          duration_s: 1020,
          seats_offered: 3,
          seats_booked: 1,
          note: null,
          is_free: false,
          rate_micro_per_km: 686_700,
          vehicle_snapshot: {
            make: 'Dacia',
            model: 'Logan',
            colour: 'Grey',
            plate: PLATE,
            fuelType: 'petrol',
          },
          late_cancel: false,
          cancelled_at: null,
          created_at: new Date('2026-11-16T03:00:00Z'),
        },
      ]
    : undefined;

// ---- approve and reject ---------------------------------------------------------------------------------------

describe('POST /bookings/{id}/approve', () => {
  const approve = (app: ReturnType<typeof makeApp>['app']) =>
    send(app, 'POST', `/bookings/${BOOKING}/approve`, DRIVER, {});
  const driverApp = (o: Opts = {}, extra: Handler[] = []) =>
    makeApp([...extra, bookingDb({ callerId: DRIVER, ...o })], {}, { clock: fixedClock(NOW) });

  it('confirms under the ride lock, takes a seat, relocks every confirmed price and queues the email', async () => {
    const confirmedRows = [
      { id: 'c-old', segment_m: 11514, price_quoted_bani: 390, price_locked_bani: 390 },
      { id: BOOKING, segment_m: 5390, price_quoted_bani: 180, price_locked_bani: 180 },
    ];
    const { app, calls } = driverApp({ confirmed: confirmedRows }, [ownerRide]);
    const res = await approve(app);
    expect(res.status).toBe(200);
    rideOwnerViewSchema.parse(await res.json());

    const lock = idx(calls, 'for update of r');
    const confirm = idx(calls, "status = 'confirmed'");
    const seats = idx(calls, 'seats_booked = seats_booked +');
    expect(lock).toBeGreaterThan(0);
    expect(confirm).toBeGreaterThan(lock);
    expect(seats).toBeGreaterThan(confirm);

    // the guarded update checks the state and the expiry
    const upd = find(calls, "set status = 'confirmed'") as Query;
    expect(upd.text).toContain("status = 'requested'");
    expect(upd.text).toContain('expires_at >');

    // P1 relocks 3.90 -> 2.60 (badge), the new booking 1.80 -> 1.20 (already flagged)
    const locks = calls.filter((c) =>
      c.text.startsWith('update app.bookings set price_locked_bani'),
    );
    expect(locks).toHaveLength(2);
    expect(locks[0]?.values).toContain(260);
    expect(locks[0]?.values).toContain(true); // notify the other passenger
    expect(locks[1]?.values).toContain(120);
    expect(locks[1]?.values).toContain(false);

    const outbox = find(calls, 'insert into app.outbox') as Query;
    expect(outbox.values[0]).toBe(PASSENGER);
    expect(outbox.values[1]).toBe('booking_confirmed');
    expect(JSON.parse(String(outbox.values[2]))).toMatchObject({
      pickupArea: 'Șelimbăr',
      driverFirstName: 'Radu',
    });
    expect(has(calls, 'insert into app.analytics_events')).toBe(true);
  });

  it('is a 404 for anyone who does not drive the ride', async () => {
    const { app } = driverApp({ ride: null });
    const res = await approve(app);
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('NOT_FOUND');
  });

  it('answers REQUEST_EXPIRED, RIDE_FULL, BLOCKED and INVALID_STATE', async () => {
    const cases: [Opts, string][] = [
      [{ state: stateRow({ expires_at: new Date('2026-11-16T04:59:59Z') }) }, 'REQUEST_EXPIRED'],
      [{ state: stateRow({ status: 'expired' }) }, 'REQUEST_EXPIRED'],
      [{ ride: lockedRide({ seats_booked: 3 }) }, 'RIDE_FULL'],
      [{ blocked: true }, 'BLOCKED'],
      [{ state: stateRow({ status: 'confirmed' }) }, 'INVALID_STATE'],
      [{ state: stateRow({ status: 'cancelled' }) }, 'INVALID_STATE'],
      [{ ride: lockedRide({ status: 'cancelled' }) }, 'INVALID_STATE'],
    ];
    for (const [opts, code] of cases) {
      const { app, calls } = driverApp(opts, [ownerRide]);
      const res = await approve(app);
      expect(res.status, code).toBe(409);
      expect((await errorOf(res)).code).toBe(code);
      expect(has(calls, "set status = 'confirmed'"), code).toBe(false);
      expect(has(calls, 'seats_booked = seats_booked'), code).toBe(false);
    }
  });

  it('losing a race on the guarded update is reported, not swallowed', async () => {
    const lostToExpiry = driverApp(
      { noRowOn: "set status = 'confirmed'", state: stateRow({ status: 'expired' }) },
      [ownerRide],
    );
    // state is read first (requested then); simulate the re-read answering expired
    let reads = 0;
    const racing = makeApp(
      [
        (q) => {
          if (q.text.includes('p.first_name as passenger_first_name')) {
            reads++;
            return [stateRow(reads === 1 ? {} : { status: 'expired' })];
          }
          return undefined;
        },
        bookingDb({ callerId: DRIVER, noRowOn: "set status = 'confirmed'" }),
        ownerRide,
      ],
      {},
      { clock: fixedClock(NOW) },
    );
    const res = await approve(racing.app);
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('REQUEST_EXPIRED');
    expect(lostToExpiry.calls).toBeDefined();
  });

  it('maps a seats CHECK violation (backstop) to RIDE_FULL and rolls back', async () => {
    const { app } = driverApp({
      failOn: {
        fragment: 'seats_booked = seats_booked +',
        error: { code: '23514', constraint_name: 'rides_seats_booked_range' },
      },
    });
    const res = await approve(app);
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('RIDE_FULL');
  });

  it('rejects a non-empty body', async () => {
    const { app } = driverApp();
    const res = await send(app, 'POST', `/bookings/${BOOKING}/approve`, DRIVER, { x: 1 });
    expect(res.status).toBe(400);
  });
});

describe('POST /bookings/{id}/reject', () => {
  const reject = (app: ReturnType<typeof makeApp>['app']) =>
    send(app, 'POST', `/bookings/${BOOKING}/reject`, DRIVER, {});
  const driverApp = (o: Opts = {}) =>
    makeApp([bookingDb({ callerId: DRIVER, ...o }), ownerRide], {}, { clock: fixedClock(NOW) });

  it('declines a live request without touching seats and tells the passenger', async () => {
    const { app, calls } = driverApp();
    const res = await reject(app);
    expect(res.status).toBe(200);
    expect(has(calls, "set status = 'rejected'")).toBe(true);
    expect(has(calls, 'seats_booked = seats_booked')).toBe(false);
    const outbox = find(calls, 'insert into app.outbox') as Query;
    expect(outbox.values[0]).toBe(PASSENGER);
    expect(outbox.values[1]).toBe('booking_rejected');
  });

  it('REQUEST_EXPIRED, INVALID_STATE and 404', async () => {
    const expired = driverApp({
      state: stateRow({ expires_at: new Date('2026-11-16T04:00:00Z') }),
    });
    expect((await errorOf(await reject(expired.app))).code).toBe('REQUEST_EXPIRED');
    const done = driverApp({ state: stateRow({ status: 'confirmed' }) });
    expect((await errorOf(await reject(done.app))).code).toBe('INVALID_STATE');
    const stranger = driverApp({ ride: null });
    expect((await reject(stranger.app)).status).toBe(404);
  });
});

// ---- cancel ---------------------------------------------------------------------------------------------------------------

describe('POST /bookings/{id}/cancel', () => {
  const cancel = (app: ReturnType<typeof makeApp>['app']) =>
    send(app, 'POST', `/bookings/${BOOKING}/cancel`, PASSENGER, {});

  const cancelled = viewRow({
    status: 'cancelled',
    cancelled_at: new Date(NOW),
    cancelled_by: 'passenger',
  });

  it('withdraws a request: no seat change, no email, one analytics event', async () => {
    const { app, calls } = makeBookingApp({ view: cancelled });
    const res = await cancel(app);
    expect(res.status).toBe(200);
    expect(bookingViewSchema.parse(await res.json()).status).toBe('cancelled');
    const upd = find(calls, "set status = 'cancelled'") as Query;
    expect(upd.values).toContain(false); // not late
    expect(has(calls, 'seats_booked = seats_booked')).toBe(false);
    expect(has(calls, 'insert into app.outbox')).toBe(false);
    expect(has(calls, 'insert into app.reliability_events')).toBe(false);
    expect(has(calls, 'insert into app.analytics_events')).toBe(true);
  });

  it('a confirmed cancel frees the seat, keeps the remaining lock and emails the driver', async () => {
    const { app, calls } = makeBookingApp({
      state: stateRow({ status: 'confirmed', price_locked_bani: 180 }),
      view: cancelled,
      confirmed: [
        { id: 'c-other', segment_m: 11514, price_quoted_bani: 390, price_locked_bani: 260 },
      ],
    });
    const res = await cancel(app);
    expect(res.status).toBe(200);
    expect(has(calls, 'seats_booked = seats_booked +')).toBe(true);
    expect(find(calls, 'seats_booked = seats_booked +')?.values).toContain(-1);
    // a lock never goes back up: 2.60 stays, so there is no price update
    expect(calls.some((c) => c.text.startsWith('update app.bookings set price_locked_bani'))).toBe(
      false,
    );
    const outbox = find(calls, 'insert into app.outbox') as Query;
    expect(outbox.values[0]).toBe(DRIVER);
    expect(outbox.values[1]).toBe('booking_cancelled');
    expect(has(calls, 'insert into app.reliability_events')).toBe(false);
  });

  it('within 30 minutes of departure a confirmed cancel is late: flag and reliability event', async () => {
    const soon = lockedRide({ departure_at: new Date('2026-11-16T05:20:00Z') });
    const { app, calls } = makeBookingApp({
      ride: soon,
      state: stateRow({ status: 'confirmed', price_locked_bani: 180 }),
      view: viewRow({ ...cancelled, departure_at: new Date('2026-11-16T05:20:00Z') }),
    });
    const res = await cancel(app);
    expect(res.status).toBe(200);
    expect((find(calls, "set status = 'cancelled'") as Query).values).toContain(true);
    expect(has(calls, 'insert into app.reliability_events')).toBe(true);
  });

  it('INVALID_STATE for a terminal booking or a ride that already left, 404 for strangers', async () => {
    for (const state of ['rejected', 'expired', 'cancelled'] as const) {
      const { app } = makeBookingApp({ state: stateRow({ status: state }) });
      expect((await errorOf(await cancel(app))).code, state).toBe('INVALID_STATE');
    }
    const left = makeBookingApp({
      ride: lockedRide({ departure_at: new Date('2026-11-16T04:00:00Z') }),
      state: stateRow({ status: 'confirmed', price_locked_bani: 180 }),
    });
    expect((await errorOf(await cancel(left.app))).code).toBe('INVALID_STATE');
    const stranger = makeBookingApp({ ride: null });
    expect((await cancel(stranger.app)).status).toBe(404);
  });
});

// ---- lists and summary -----------------------------------------------------------------------------------------------------

describe('GET /me/bookings', () => {
  const listRow = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    ride_id: RIDE,
    status: 'confirmed',
    ride_status: 'published',
    departure_at: DEPARTURE,
    duration_s: 1020,
    pickup_fraction: 0.45,
    pickup_label: 'Șelimbăr',
    dropoff_label: 'Centru',
    driver_id: DRIVER,
    price_quoted_bani: 390,
    price_locked_bani: 260,
    final_price_bani: null,
    unseen: true,
    ...over,
  });
  const listDb =
    (rows: Record<string, unknown>[]): Handler =>
    (q) =>
      q.text.includes(
        'from app.bookings b join app.rides r on r.id = b.ride_id where b.passenger_id',
      )
        ? rows
        : undefined;

  it('lists upcoming bookings with area labels, the price to show and a cursor', async () => {
    const rows = [listRow(BOOKING), listRow(OTHER_RIDE), listRow(STRANGER)];
    const { app, calls } = makeApp([listDb(rows), bookingDb()], {}, { clock: fixedClock(NOW) });
    const res = await send(app, 'GET', '/me/bookings?limit=2', PASSENGER);
    expect(res.status).toBe(200);
    const out = bookingListResponseSchema.parse(await res.json());
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({
      pickupLabel: 'Șelimbăr',
      priceBani: 260,
      unseen: true,
      driver: { id: DRIVER },
    });
    expect(out.nextCursor).not.toBeNull();
    expect(find(calls, 'r.departure_at > ')?.text).toContain(
      "b.status in ('requested', 'confirmed')",
    );
    const text = JSON.stringify(out);
    expect(text).not.toContain(PLATE);
    expect(text).not.toContain(DRIVER_PHONE);
  });

  it('past scope, bad scope and bad cursor', async () => {
    const { app, calls } = makeApp([listDb([]), bookingDb()], {}, { clock: fixedClock(NOW) });
    expect((await send(app, 'GET', '/me/bookings?scope=past', PASSENGER)).status).toBe(200);
    expect(has(calls, 'order by r.departure_at desc')).toBe(true);
    expect((await send(app, 'GET', '/me/bookings?scope=all', PASSENGER)).status).toBe(400);
    const bad = await send(app, 'GET', '/me/bookings?cursor=zzz', PASSENGER);
    expect(bad.status).toBe(400);
  });

  it('needs sign-in', async () => {
    const { app } = makeBookingApp();
    expect((await app.request(`${BASE}/me/bookings`)).status).toBe(401);
  });
});

describe('GET /me/summary and POST /me/summary/seen', () => {
  it('returns the counts and the next ride', async () => {
    const { app } = makeApp(
      [
        (q) =>
          q.text.includes('as driver_pending')
            ? [{ driver_pending: 2, passenger_unseen: 1 }]
            : q.text.includes('select kind, id, departure_at from')
              ? [{ kind: 'booking', id: BOOKING, departure_at: DEPARTURE }]
              : undefined,
        bookingDb(),
      ],
      {},
      { clock: fixedClock(NOW) },
    );
    const res = await send(app, 'GET', '/me/summary', PASSENGER);
    expect(res.status).toBe(200);
    expect(summaryResponseSchema.parse(await res.json())).toEqual({
      driverPendingRequests: 2,
      passengerUnseenUpdates: 1,
      nextRide: { kind: 'booking', id: BOOKING, departureAt: '2026-11-16T07:00:00.000Z' },
    });
  });

  it('is zero and null for a new user', async () => {
    const { app } = makeBookingApp();
    const out = summaryResponseSchema.parse(
      await (await send(app, 'GET', '/me/summary', PASSENGER)).json(),
    );
    expect(out).toEqual({ driverPendingRequests: 0, passengerUnseenUpdates: 0, nextRide: null });
  });

  it('seen marks only the caller own bookings and answers 204', async () => {
    const { app, calls } = makeBookingApp();
    const res = await send(app, 'POST', '/me/summary/seen', PASSENGER, { bookingIds: [BOOKING] });
    expect(res.status).toBe(204);
    const upd = find(calls, 'set seen_by_passenger_at') as Query;
    expect(upd.text).toContain('passenger_id =');
    expect(upd.values).toContain(PASSENGER);
  });

  it('seen validates 1 to 50 uuids', async () => {
    const { app } = makeBookingApp();
    expect(
      (await send(app, 'POST', '/me/summary/seen', PASSENGER, { bookingIds: [] })).status,
    ).toBe(400);
    expect(
      (await send(app, 'POST', '/me/summary/seen', PASSENGER, { bookingIds: ['x'] })).status,
    ).toBe(400);
    const many = Array(51).fill(BOOKING);
    expect(
      (await send(app, 'POST', '/me/summary/seen', PASSENGER, { bookingIds: many })).status,
    ).toBe(400);
  });
});

// ---- the ride cancel cascade (E2 endpoint, E4 behaviour) --------------------------------------------------------------------------

describe('POST /rides/{id}/cancel cascade', () => {
  it('cancels every active booking, zeroes the seats and writes one ride_cancelled row per booking', async () => {
    const owner = {
      id: RIDE,
      status: 'published',
      departure_at: DEPARTURE,
      origin_label: 'Șelimbăr',
      destination_label: 'Centru',
      origin_lat: 45.7413,
      origin_lng: 24.1861,
      destination_lat: 45.785,
      destination_lng: 24.09,
      route_geojson: PUBLIC_ROUTE,
      distance_m: 11514,
      duration_s: 1020,
      seats_offered: 3,
      seats_booked: 2,
      note: null,
      is_free: false,
      rate_micro_per_km: 686_700,
      vehicle_snapshot: {
        make: 'Dacia',
        model: 'Logan',
        colour: 'Grey',
        plate: PLATE,
        fuelType: 'petrol',
      },
      late_cancel: false,
      cancelled_at: null,
      created_at: new Date('2026-11-16T03:00:00Z'),
    };
    const { app, calls } = makeApp(
      [
        (q) => {
          if (q.text.includes('as route_geojson')) return [owner];
          if (
            q.text.startsWith('update app.bookings') &&
            q.text.includes("cancelled_by = 'driver'")
          ) {
            return [
              {
                id: 'b-1',
                passenger_id: PASSENGER,
                pickup_label: 'Șelimbăr',
                dropoff_label: 'Centru',
              },
              {
                id: 'b-2',
                passenger_id: PASSENGER,
                pickup_label: 'Turnișor',
                dropoff_label: 'Centru',
              },
            ];
          }
          return undefined;
        },
        bookingDb({ callerId: DRIVER }),
      ],
      {},
      { clock: fixedClock(NOW) },
    );
    const res = await send(app, 'POST', `/rides/${RIDE}/cancel`, DRIVER, {});
    expect(res.status).toBe(200);

    const update = find(calls, "cancelled_by = 'driver'") as Query;
    expect(update.text).toContain("status in ('requested', 'confirmed')");
    expect(has(calls, 'update app.rides set seats_booked = 0')).toBe(true);

    const rows = calls.filter((c) => c.text.startsWith('insert into app.outbox'));
    expect(rows).toHaveLength(2);
    const payloads = rows.map((r) => JSON.parse(String(r.values[2])));
    expect(payloads.map((p) => p.pickupArea)).toEqual(['Șelimbăr', 'Turnișor']);
    expect(payloads.map((p) => p.bookingId)).toEqual(['b-1', 'b-2']);
    expect(rows.every((r) => r.values[1] === 'ride_cancelled')).toBe(true);
    expect(JSON.stringify(payloads)).not.toMatch(/\d+\.\d{4,}|\+40|SB12/);
  });
});
