import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from '../_shared/contracts/errors.ts';
import { dataExportRequestResponseSchema } from '../_shared/contracts/privacy.ts';
import { fixedClock } from '../_shared/domain/clock.ts';
import { BASE, makeApp, signToken, type Handler, type Query } from './testing.ts';

const USER = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';
const OTHER = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const RIDE = '5b0c7f0e-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const MY_RIDE = '6c1d8f1f-7b2e-4d22-9e3f-0a4b5c6d7e8f';
const BOOKING = 'b1b1b1b1-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const MY_BOOKING = 'b2b2b2b2-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const REQUEST = 'd4d4d4d4-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const PHOTO = 'avatars/6f1d8a5e-0000-4000-8000-000000000001.jpg';
const NOW = '2026-11-16T05:00:00Z';
const DEPARTURE = new Date('2026-11-17T07:00:00Z');

const ACCEPTED = [
  { kind: 'age_18', version: null },
  { kind: 'terms', version: '1.0' },
  { kind: 'privacy', version: '1.0' },
];
const LEGAL = [
  { kind: 'terms', version: '1.0', url: '/policy/terms', published_at: new Date(NOW) },
  { kind: 'privacy', version: '1.0', url: '/policy/privacy', published_at: new Date(NOW) },
];

const profileRow = (over: Record<string, unknown> = {}) => ({
  id: USER,
  first_name: 'Ioana',
  phone_e164: '+40722333444',
  bio: null,
  photo_path: PHOTO,
  status: 'active',
  role: 'user',
  created_at: new Date('2026-10-01T10:00:00Z'),
  has_vehicle: true,
  ...over,
});

const lockedRide = (id: string, driverId: string) => ({
  id,
  driver_id: driverId,
  status: 'published',
  departure_at: DEPARTURE,
  duration_s: 1020,
  seats_offered: 3,
  seats_booked: 1,
  is_free: false,
  rate_micro_per_km: 686_700,
  driver_status: 'active',
});

type Opts = {
  /** The caller's profile as loaded by the gate. */
  profile?: Record<string, unknown>;
  accepted?: Record<string, unknown>[];
  /** Status the profile has when the deletion transaction locks it. */
  lockedStatus?: 'active' | 'suspended' | 'deleted';
  /** Throw a deadlock on the first N attempts to lock the profile. */
  deadlocks?: number;
  /** The purge queue row, when the test wants the post-commit purge to find one. */
  deletion?: Record<string, unknown> | null;
  dataRequest?: Record<string, unknown> | null;
  rateLimited?: boolean;
};

/** Fake of every query DELETE /me and the data request issue, in the order the services run them. */
function privacyDb(o: Opts = {}) {
  let locks = 0;
  const deletion =
    o.deletion === undefined
      ? {
          user_id: USER,
          requested_at: new Date(NOW),
          photo_path: PHOTO,
          storage_done_at: null,
          auth_done_at: null,
          attempts: 0,
        }
      : o.deletion;
  const handler: Handler = (q) => {
    const t = q.text;
    if (t.includes('app.rate_limit_hit')) return [{ allowed: !o.rateLimited }];
    if (t.includes('from app.legal_documents')) return LEGAL;
    if (t.includes('has_vehicle')) return [profileRow(o.profile)];
    if (t.includes('from app.consents')) return o.accepted ?? ACCEPTED;
    if (t.includes('from app.profiles where id =') && t.includes('for no key update')) {
      locks++;
      if (locks <= (o.deadlocks ?? 0))
        throw Object.assign(new Error('deadlock'), { code: '40P01' });
      return [{ id: USER, first_name: 'Ioana', status: o.lockedStatus ?? 'active' }];
    }
    // the driver's own future rides
    if (t.includes('from app.rides where driver_id =')) return [{ id: MY_RIDE }];
    // lockRide (by ride id) and lockRideOfBooking (by booking id)
    if (t.includes('where r.id =') && t.includes('for update of r'))
      return [lockedRide(MY_RIDE, USER)];
    if (t.includes('where b.id =') && t.includes('for update of r'))
      return [lockedRide(RIDE, OTHER)];
    if (
      t.includes("update app.bookings set status = 'cancelled', cancelled_at") &&
      t.includes("cancelled_by = 'system'") &&
      t.includes('where ride_id =')
    ) {
      return [
        { id: BOOKING, passenger_id: OTHER, pickup_label: 'Șelimbăr', dropoff_label: 'Centru' },
      ];
    }
    // the user's own seats
    if (t.includes('where b.passenger_id =') && t.includes('departure_at >'))
      return [{ id: MY_BOOKING }];
    if (
      t.includes('from app.bookings b join app.profiles p on p.id = b.passenger_id where b.id =')
    ) {
      return [
        {
          id: MY_BOOKING,
          ride_id: RIDE,
          passenger_id: USER,
          status: 'confirmed',
          pickup_label: 'Șelimbăr',
          dropoff_label: 'Centru',
          pickup_fraction: 0.4,
          segment_m: 5000,
          price_quoted_bani: 180,
          price_locked_bani: 120,
          requested_at: new Date('2026-11-16T04:00:00Z'),
          expires_at: new Date('2026-11-16T04:30:00Z'),
          passenger_first_name: 'Ioana',
        },
      ];
    }
    if (t.includes("update app.bookings set status = 'cancelled'") && t.includes('where id ='))
      return [{ id: MY_BOOKING }];
    if (t.startsWith('select user_id, requested_at, photo_path')) return deletion ? [deletion] : [];
    if (t.includes('set completed_at =')) return [{ user_id: USER }];
    if (t.includes('from app.data_requests')) return o.dataRequest ? [o.dataRequest] : [];
    if (t.startsWith('insert into app.data_requests')) {
      return [{ id: REQUEST, requested_at: new Date(NOW), fulfilled_at: null }];
    }
    return undefined;
  };
  return handler;
}

const auth = async () => ({
  authorization: `Bearer ${await signToken(USER, { email: 'ioana@example.com' })}`,
});
const del = async (body: unknown, headers?: Record<string, string>) => ({
  method: 'DELETE',
  headers: { 'content-type': 'application/json', ...(headers ?? (await auth())) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;
const idx = (calls: Query[], fragment: string) => calls.findIndex((c) => c.text.includes(fragment));
const has = (calls: Query[], fragment: string) => idx(calls, fragment) >= 0;
const clock = { clock: fixedClock(NOW) };

describe('DELETE /me', () => {
  it('answers 401 anonymously', async () => {
    const { app } = makeApp([privacyDb()]);
    const res = await app.request(`${BASE}/me`, { method: 'DELETE', body: '{"confirm":"DELETE"}' });
    expect(res.status).toBe(401);
  });

  it.each([
    ['no body', undefined],
    ['an empty object', {}],
    ['the wrong word', { confirm: 'delete' }],
    ['a boolean', { confirm: true }],
  ])(
    'asks for confirmation with %s (400 CONFIRMATION_REQUIRED) and changes nothing',
    async (_n, body) => {
      const { app, calls, removedStrict, authDeleted } = makeApp([privacyDb()], {}, clock);
      const res = await app.request(`${BASE}/me`, await del(body));
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe('CONFIRMATION_REQUIRED');
      expect(has(calls, 'app.scrub_account')).toBe(false);
      expect(removedStrict).toHaveLength(0);
      expect(authDeleted).toHaveLength(0);
    },
  );

  it('is rate limited', async () => {
    const { app } = makeApp([privacyDb({ rateLimited: true })], {}, clock);
    const res = await app.request(`${BASE}/me`, await del({ confirm: 'DELETE' }));
    expect(res.status).toBe(429);
  });

  it('cancels the future ride and the own seat, scrubs last, then removes the photo and the auth user', async () => {
    const { app, calls, removedStrict, authDeleted } = makeApp([privacyDb()], {}, clock);
    const res = await app.request(`${BASE}/me`, await del({ confirm: 'DELETE' }));
    expect(res.status).toBe(204);

    // order inside the transaction: lock, ride cancellation, own booking, scrub
    const order = [
      'from app.profiles where id = ? for no key update',
      "update app.rides set status = 'cancelled'",
      "update app.bookings set status = 'cancelled', cancelled_at = ?, cancelled_by = 'system'",
      "update app.bookings set status = 'cancelled', cancelled_at = ?, cancelled_by = 'system', late_cancel = false",
      'app.scrub_account',
    ].map((f) => idx(calls, f));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const scrub = calls.find((c) => c.text.includes('app.scrub_account')) as Query;
    expect(scrub.values).toEqual([USER, new Date(NOW)]);

    // the passenger of the cancelled ride hears it, in the neutral system wording
    const outbox = calls.filter((c) => c.text.startsWith('insert into app.outbox'));
    const ride = outbox.find((c) => c.values[1] === 'ride_cancelled') as Query;
    expect(ride.values[0]).toBe(OTHER);
    expect(JSON.parse(String(ride.values[2]))).toMatchObject({
      by: 'system',
      driverFirstName: 'Ioana',
    });
    // the driver of the ride the user had a seat on hears about the confirmed booking
    const cancelled = outbox.find((c) => c.values[1] === 'booking_cancelled') as Query;
    expect(cancelled.values[0]).toBe(OTHER);

    // after the commit: storage and auth, then the row is closed
    expect(removedStrict).toEqual([PHOTO]);
    expect(authDeleted).toEqual([USER]);
    expect(has(calls, 'set completed_at =')).toBe(true);
    expect(idx(calls, 'set completed_at =')).toBeGreaterThan(idx(calls, 'app.scrub_account'));
  });

  it('is idempotent: an account that is already deleted answers 204 and is not scrubbed again', async () => {
    const { app, calls } = makeApp(
      [
        privacyDb({
          profile: { status: 'deleted', first_name: null },
          lockedStatus: 'deleted',
          deletion: null,
        }),
      ],
      {},
      clock,
    );
    const res = await app.request(`${BASE}/me`, await del({ confirm: 'DELETE' }));
    expect(res.status).toBe(204);
    expect(has(calls, 'app.scrub_account')).toBe(false);
    expect(has(calls, "update app.rides set status = 'cancelled'")).toBe(false);
  });

  it('a parallel second call finds the tombstone after waiting on the profile lock', async () => {
    const { app, calls } = makeApp(
      [privacyDb({ lockedStatus: 'deleted', deletion: null })],
      {},
      clock,
    );
    const res = await app.request(`${BASE}/me`, await del({ confirm: 'DELETE' }));
    expect(res.status).toBe(204);
    expect(has(calls, 'app.scrub_account')).toBe(false);
  });

  it('lets a suspended user, or one who has not accepted the new terms, delete', async () => {
    const suspended = makeApp(
      [privacyDb({ profile: { status: 'suspended' }, lockedStatus: 'suspended' })],
      {},
      clock,
    );
    expect(
      (await suspended.app.request(`${BASE}/me`, await del({ confirm: 'DELETE' }))).status,
    ).toBe(204);
    expect(has(suspended.calls, 'app.scrub_account')).toBe(true);

    const noConsent = makeApp([privacyDb({ accepted: [] })], {}, clock);
    expect(
      (await noConsent.app.request(`${BASE}/me`, await del({ confirm: 'DELETE' }))).status,
    ).toBe(204);
    expect(has(noConsent.calls, 'app.scrub_account')).toBe(true);
  });

  it('retries once after a deadlock, and answers 503 TEMPORARILY_UNAVAILABLE after two', async () => {
    const once = makeApp([privacyDb({ deadlocks: 1 })], {}, clock);
    expect((await once.app.request(`${BASE}/me`, await del({ confirm: 'DELETE' }))).status).toBe(
      204,
    );
    expect(once.calls.filter((c) => c.text.includes('app.scrub_account'))).toHaveLength(1);

    const twice = makeApp([privacyDb({ deadlocks: 2 })], {}, clock);
    const res = await twice.app.request(`${BASE}/me`, await del({ confirm: 'DELETE' }));
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('TEMPORARILY_UNAVAILABLE');
    expect(has(twice.calls, 'app.scrub_account')).toBe(false);
  });

  it('does not fail when storage and auth are down: the row stays open with a backoff', async () => {
    const { app, calls, storageControl, authControl } = makeApp([privacyDb()], {}, clock);
    storageControl.failStrict = true;
    authControl.fail = true;
    const res = await app.request(`${BASE}/me`, await del({ confirm: 'DELETE' }));
    expect(res.status).toBe(204);
    const failure = calls.find((c) => c.text.includes('set attempts =')) as Query;
    expect(failure.values[0]).toEqual(new Date('2026-11-16T05:01:00Z')); // 1 minute
    expect(String(failure.values[1])).toContain('storage:');
    expect(String(failure.values[1])).toContain('auth:');
    expect(has(calls, 'set completed_at =')).toBe(false);
  });

  it('does not touch a deleted row twice: a second purge sees no open row', async () => {
    const { app, removedStrict, authDeleted } = makeApp([privacyDb({ deletion: null })], {}, clock);
    expect((await app.request(`${BASE}/me`, await del({ confirm: 'DELETE' }))).status).toBe(204);
    expect(removedStrict).toHaveLength(0);
    expect(authDeleted).toHaveLength(0);
  });
});

describe('after deletion', () => {
  it('GET /me answers 403 ACCOUNT_DELETED', async () => {
    const { app } = makeApp([privacyDb({ profile: { status: 'deleted' } })], {}, clock);
    const res = await app.request(`${BASE}/me`, { headers: await auth() });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('ACCOUNT_DELETED');
  });
});

describe('POST /me/data-export-request', () => {
  const post = async (body: unknown = {}) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await auth()) },
    body: JSON.stringify(body),
  });

  it('answers 401 anonymously and 403 ACCOUNT_DELETED for a deleted account', async () => {
    const anon = makeApp([privacyDb()]);
    expect(
      (await anon.app.request(`${BASE}/me/data-export-request`, { method: 'POST' })).status,
    ).toBe(401);

    const gone = makeApp([privacyDb({ profile: { status: 'deleted' } })]);
    const res = await gone.app.request(`${BASE}/me/data-export-request`, await post());
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('ACCOUNT_DELETED');
  });

  it('records the request and queues one mail to support and one acknowledgement, due in 30 days', async () => {
    const { app, calls } = makeApp([privacyDb()], {}, clock);
    const res = await app.request(`${BASE}/me/data-export-request`, await post());
    expect(res.status).toBe(202);
    expect(dataExportRequestResponseSchema.parse(await res.json())).toEqual({
      requestId: REQUEST,
      requestedAt: '2026-11-16T05:00:00.000Z',
      dueBy: '2026-12-16T05:00:00.000Z',
    });
    expect(calls.filter((c) => c.text.startsWith('insert into app.data_requests'))).toHaveLength(1);
    const outbox = calls.filter((c) => c.text.startsWith('insert into app.outbox'));
    expect(outbox.map((c) => c.values[1])).toEqual(['data_export_requested', 'data_export_ack']);
    expect(outbox.every((c) => c.values[0] === USER)).toBe(true);
    expect(JSON.parse(String(outbox[0]?.values[2]))).toEqual({
      requestId: REQUEST,
      userId: USER,
      requestedAt: '2026-11-16T05:00:00.000Z',
    });
    // neither payload may carry the email or phone: the dispatcher looks the address up
    expect(JSON.stringify(outbox.map((c) => c.values))).not.toMatch(/@|\+40/);
  });

  it('a suspended user may ask', async () => {
    const { app } = makeApp([privacyDb({ profile: { status: 'suspended' } })], {}, clock);
    expect((await app.request(`${BASE}/me/data-export-request`, await post())).status).toBe(202);
  });

  it('repeats an open request from the last 30 days: same answer, no new row, no new mail', async () => {
    const { app, calls } = makeApp(
      [
        privacyDb({
          dataRequest: {
            id: REQUEST,
            requested_at: new Date('2026-11-01T10:00:00Z'),
            fulfilled_at: null,
          },
        }),
      ],
      {},
      clock,
    );
    const res = await app.request(`${BASE}/me/data-export-request`, await post());
    expect(res.status).toBe(202);
    expect(dataExportRequestResponseSchema.parse(await res.json())).toMatchObject({
      requestId: REQUEST,
      requestedAt: '2026-11-01T10:00:00.000Z',
      dueBy: '2026-12-01T10:00:00.000Z',
    });
    expect(has(calls, 'insert into app.data_requests')).toBe(false);
    expect(has(calls, 'insert into app.outbox')).toBe(false);
    // the lookup window is the last 30 days and only unfulfilled requests
    const lookup = calls.find((c) => c.text.includes('from app.data_requests')) as Query;
    expect(lookup.text).toContain('fulfilled_at is null');
    expect(lookup.values).toContainEqual(new Date('2026-10-17T05:00:00Z'));
  });

  it('serialises parallel taps on the profile row lock', async () => {
    const { app, calls } = makeApp([privacyDb()], {}, clock);
    await app.request(`${BASE}/me/data-export-request`, await post());
    expect(idx(calls, 'from app.profiles where id = ? for no key update')).toBeLessThan(
      idx(calls, 'from app.data_requests'),
    );
  });

  it('is limited to 3 a day and rejects unknown body fields', async () => {
    const limited = makeApp([privacyDb({ rateLimited: true })], {}, clock);
    expect((await limited.app.request(`${BASE}/me/data-export-request`, await post())).status).toBe(
      429,
    );
    const bad = makeApp([privacyDb()], {}, clock);
    const res = await bad.app.request(
      `${BASE}/me/data-export-request`,
      await post({ userId: OTHER }),
    );
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('VALIDATION_FAILED');
  });
});
