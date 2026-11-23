import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from '../_shared/contracts/errors.ts';
import { rideOwnerViewSchema } from '../_shared/contracts/rides.ts';
import { BASE, makeApp, signToken, type Handler, type Query } from './testing.ts';

/**
 * PATCH /rides/{id} (ADR 0041) against a recording fake database: the rules, the order of the
 * statements inside the transaction, and exactly who gets a `ride_updated` outbox row. The real
 * database behaviour (locks, constraints, the dedupe index) is covered by
 * tests/integration/ride-edit.test.ts, which CI runs.
 */

const USER = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';
const RIDE_ID = '5b0c7f0e-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const B1 = '11111111-1111-4111-8111-111111111111';
const B2 = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const P2 = '44444444-4444-4444-8444-444444444444';
const OLD_DEP = '2026-11-16T07:00:00.000Z'; // the fixed clock is 05:00Z
const NEW_DEP = '2026-11-16T09:30:00.000Z';

const ROUTE = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [24.1861, 45.7413],
    [24.09, 45.785],
  ],
});

const ownerRow = (over: Record<string, unknown> = {}) => ({
  id: RIDE_ID,
  status: 'published',
  departure_at: new Date(OLD_DEP),
  origin_label: 'Șelimbăr, Shopping City Sibiu',
  destination_label: 'Zona Industrială Vest',
  origin_lat: 45.7413,
  origin_lng: 24.1861,
  destination_lat: 45.785,
  destination_lng: 24.09,
  route_geojson: ROUTE,
  distance_m: 9588,
  duration_s: 1020,
  seats_offered: 3,
  seats_booked: 1,
  note: 'Blue backpack',
  is_free: false,
  auto_accept: false,
  series_id: null,
  rate_micro_per_km: 651000,
  vehicle_snapshot: {
    make: 'Dacia',
    model: 'Logan',
    colour: 'Grey',
    plate: 'SB12ABC',
    fuelType: 'diesel',
  },
  late_cancel: false,
  cancelled_at: null,
  created_at: new Date('2026-11-16T04:00:00Z'),
  completed_at: null,
  ...over,
});

type State = {
  ride: Record<string, unknown> | null;
  vehicleSeats: number;
  otherRidesThatDay: number;
  accepted: { kind: string; version: string | null }[];
  moved: { id: string; passenger_id: string; pickup_label: string; dropoff_label: string }[];
};

function world(init: Partial<State> = {}) {
  const state: State = {
    ride: ownerRow(),
    vehicleSeats: 3,
    otherRidesThatDay: 0,
    accepted: [
      { kind: 'age_18', version: null },
      { kind: 'terms', version: '1.0' },
      { kind: 'privacy', version: '1.0' },
    ],
    moved: [
      { id: B1, passenger_id: P1, pickup_label: 'Turnișor', dropoff_label: 'Centru' },
      { id: B2, passenger_id: P2, pickup_label: 'Șelimbăr', dropoff_label: 'Centru' },
    ],
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
    if (t.includes('has_vehicle')) {
      return [
        {
          id: USER,
          first_name: 'Radu',
          phone_e164: '+40721234567',
          bio: null,
          photo_path: null,
          status: 'active',
          role: 'user',
          created_at: new Date('2026-10-01T10:00:00Z'),
          has_vehicle: true,
        },
      ];
    }
    if (t.includes('from app.consents')) return state.accepted;
    if (t.includes('from app.vehicles where owner_id')) {
      return [
        {
          make: 'Dacia',
          model: 'Logan',
          colour: 'Grey',
          plate: 'SB12ABC',
          fuel_type: 'diesel',
          seats: state.vehicleSeats,
        },
      ];
    }
    if (t.includes('pg_advisory_xact_lock')) return [];
    if (t.includes('for share')) return [{ ok: 1 }];
    if (t.includes('select count(*)::int as n from app.rides')) {
      return [{ n: state.otherRidesThatDay }];
    }
    if (t.startsWith('update app.rides set departure_at')) {
      // values: departureAt, seats, note, autoAccept, now, rideId
      const [departureAt, seats, note, autoAccept] = q.values;
      if (state.ride) {
        state.ride = {
          ...state.ride,
          departure_at: departureAt,
          seats_offered: seats,
          note,
          auto_accept: autoAccept,
        };
      }
      return [{ id: RIDE_ID }];
    }
    if (t.startsWith('update app.bookings')) return state.moved;
    if (t.includes('as route_geojson') && t.includes('from app.rides r')) {
      return state.ride ? [state.ride] : [];
    }
    return undefined;
  };
  return { state, handler };
}

const auth = async (sub = USER) => ({
  authorization: `Bearer ${await signToken(sub, { email: 'radu@example.com' })}`,
});

async function patch(
  app: ReturnType<typeof makeApp>['app'],
  body: unknown,
  opts: { id?: string; sub?: string; raw?: string; token?: boolean } = {},
) {
  return app.request(`${BASE}/rides/${opts.id ?? RIDE_ID}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(opts.token === false ? {} : await auth(opts.sub)),
    },
    body: opts.raw ?? JSON.stringify(body),
  });
}

const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;
const has = (calls: Query[], fragment: string) => calls.some((c) => c.text.includes(fragment));
const find = (calls: Query[], fragment: string) => calls.find((c) => c.text.includes(fragment));
const indexOf = (calls: Query[], fragment: string) =>
  calls.findIndex((c) => c.text.includes(fragment));
const outboxRows = (calls: Query[]) =>
  calls.filter((c) => c.text.startsWith('insert into app.outbox'));
const wroteNothing = (calls: Query[]) =>
  !has(calls, 'update app.rides set') &&
  !has(calls, 'update app.bookings') &&
  !has(calls, 'insert into app.outbox');

describe('PATCH /rides/{id}: a time change', () => {
  it('updates the ride and tells each requested or confirmed passenger, in one locked transaction', async () => {
    const w = world();
    const { app, calls } = makeApp([w.handler]);
    const res = await patch(app, { departureAt: NEW_DEP });
    expect(res.status).toBe(200);
    const out = rideOwnerViewSchema.parse(await res.json());
    expect(out).toMatchObject({
      id: RIDE_ID,
      status: 'published',
      departureAt: NEW_DEP,
      canEdit: true,
      canCancel: true,
    });

    const lockRead = calls.findIndex(
      (c) => c.text.includes('from app.rides r') && c.text.includes('for update of r'),
    );
    const advisory = indexOf(calls, 'pg_advisory_xact_lock');
    const count = indexOf(calls, 'select count(*)::int as n from app.rides');
    const update = indexOf(calls, 'update app.rides set departure_at');
    const bookings = indexOf(calls, 'update app.bookings');
    const outbox = indexOf(calls, 'insert into app.outbox');
    expect(lockRead).toBeGreaterThan(-1);
    expect(lockRead).toBeLessThan(advisory);
    expect(advisory).toBeLessThan(count);
    expect(count).toBeLessThan(update);
    expect(update).toBeLessThan(bookings);
    expect(bookings).toBeLessThan(outbox);

    // The ride row: only the editable columns, updated_at set, guarded by status.
    const ride = calls[update];
    expect(ride?.text).toContain("status = 'published'");
    expect(ride?.text).toContain('updated_at');
    expect(ride?.text).not.toMatch(/origin|destination|route|price|vehicle/);
    expect(ride?.values.slice(0, 4)).toEqual([new Date(NEW_DEP), 3, 'Blue backpack', false]);
  });

  it('notifies exactly the requested and confirmed bookings: one row each, the passenger’s own areas', async () => {
    const w = world();
    const { app, calls } = makeApp([w.handler]);
    await patch(app, { departureAt: NEW_DEP });

    // Only active bookings are touched (cancelled, rejected, expired, completed never are).
    const touch = find(calls, 'update app.bookings');
    expect(touch?.text).toContain("status in ('requested', 'confirmed')");
    expect(touch?.text).toContain('passenger_event_at');

    const rows = outboxRows(calls);
    expect(rows).toHaveLength(2);
    // values: user id, template, payload, dedupe key (insertOutboxRows)
    expect(rows.map((r) => [r.values[0], r.values[1]])).toEqual([
      [P1, 'ride_updated'],
      [P2, 'ride_updated'],
    ]);
    expect(JSON.parse(rows[0]?.values[2] as string)).toEqual({
      bookingId: B1,
      rideId: RIDE_ID,
      driverFirstName: 'Radu',
      previousDepartureAt: OLD_DEP,
      departureAt: NEW_DEP,
      pickupArea: 'Turnișor',
      dropoffArea: 'Centru',
    });
    // the dedupe key comes from the single helper: template + booking + NEW departure
    expect(rows[0]?.values[3]).toBe(`ride_updated:${B1}:${NEW_DEP}`);
    expect(rows[1]?.values[3]).toBe(`ride_updated:${B2}:${NEW_DEP}`);
    // nobody else (the driver) is told, and no analytics event is added
    expect(rows.some((r) => r.values[0] === USER)).toBe(false);
    expect(has(calls, 'insert into app.analytics_events')).toBe(false);
    // ids, times, a first name and area labels only: no coordinates, phones or plates
    for (const r of rows) {
      expect(r.values[2] as string).not.toMatch(/\d{1,3}\.\d{4,}|\+\d{6,}|SB12ABC/);
    }
  });

  it('writes no outbox row when nobody has a requested or confirmed booking', async () => {
    const w = world({ moved: [] });
    const { app, calls } = makeApp([w.handler]);
    expect((await patch(app, { departureAt: NEW_DEP })).status).toBe(200);
    expect(has(calls, 'update app.bookings')).toBe(true);
    expect(outboxRows(calls)).toHaveLength(0);
  });

  it('clamps open requests so none outlives the new departure (departure minus 10 minutes)', async () => {
    const w = world();
    const { app, calls } = makeApp([w.handler]);
    await patch(app, { departureAt: '2026-11-16T05:30:00Z' });
    const touch = find(calls, 'update app.bookings');
    expect(touch?.text).toContain("case when status = 'requested' then least(expires_at,");
    // cap = 05:30 - 10 min; the first bound parameter, ahead of the timestamp of the update
    expect(touch?.values[0]).toEqual(new Date('2026-11-16T05:20:00.000Z'));
    expect(touch?.values).toContain(RIDE_ID);
  });

  it('moving to a time the driver already sent is a no-op: nothing written, nobody told', async () => {
    const w = world();
    const { app, calls } = makeApp([w.handler]);
    const res = await patch(app, { departureAt: OLD_DEP });
    expect(res.status).toBe(200);
    expect(wroteNothing(calls)).toBe(true);
    expect(has(calls, 'pg_advisory_xact_lock')).toBe(false);
  });
});

describe('PATCH /rides/{id}: seats, note and auto-accept notify nobody', () => {
  it('changes the editable columns and leaves bookings and the outbox alone', async () => {
    const w = world();
    const { app, calls } = makeApp([w.handler]);
    const res = await patch(app, { seats: 2, note: '  Meet at the gate ', autoAccept: true });
    expect(res.status).toBe(200);
    const out = rideOwnerViewSchema.parse(await res.json());
    expect(out).toMatchObject({
      seatsOffered: 2,
      note: 'Meet at the gate',
      autoAccept: true,
      departureAt: OLD_DEP,
    });
    expect(find(calls, 'update app.rides set departure_at')?.values.slice(0, 4)).toEqual([
      new Date(OLD_DEP),
      2,
      'Meet at the gate',
      true,
    ]);
    expect(has(calls, 'update app.bookings')).toBe(false);
    expect(outboxRows(calls)).toHaveLength(0);
    // no time change, so no daily-limit count and no publish lock
    expect(has(calls, 'pg_advisory_xact_lock')).toBe(false);
    expect(has(calls, 'select count(*)::int as n from app.rides')).toBe(false);
  });

  it('null clears the note, an empty body field set to the same values is a no-op', async () => {
    const w = world();
    const { app, calls } = makeApp([w.handler]);
    expect((await patch(app, { note: null })).status).toBe(200);
    expect(find(calls, 'update app.rides set departure_at')?.values[2]).toBeNull();

    const w2 = world();
    const second = makeApp([w2.handler]);
    expect(
      (await patch(second.app, { seats: 3, note: 'Blue backpack', autoAccept: false })).status,
    ).toBe(200);
    expect(wroteNothing(second.calls)).toBe(true);
  });

  it('refuses fewer seats than are already booked with SEATS_BELOW_BOOKED', async () => {
    const w = world({ ride: ownerRow({ seats_booked: 2 }) });
    const { app, calls } = makeApp([w.handler]);
    const res = await patch(app, { seats: 1 });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({
      code: 'SEATS_BELOW_BOOKED',
      fields: { seats: 'below_booked' },
    });
    expect(wroteNothing(calls)).toBe(true);
    // exactly the booked number is fine
    const ok = makeApp([world({ ride: ownerRow({ seats_booked: 2 }) }).handler]);
    expect((await patch(ok.app, { seats: 2 })).status).toBe(200);
  });

  it('more seats than the vehicle has is SEATS_EXCEED_VEHICLE; fewer is never checked against it', async () => {
    const tooMany = makeApp([world({ vehicleSeats: 3 }).handler]);
    const res = await patch(tooMany.app, { seats: 4 });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('SEATS_EXCEED_VEHICLE');
    expect(wroteNothing(tooMany.calls)).toBe(true);

    const fits = makeApp([world({ vehicleSeats: 4 }).handler]);
    expect((await patch(fits.app, { seats: 4 })).status).toBe(200);

    // the car shrank to 2 seats since publishing: lowering 3 -> 2 needs no vehicle lookup
    const lower = makeApp([world({ vehicleSeats: 2 }).handler]);
    expect((await patch(lower.app, { seats: 2 })).status).toBe(200);
    expect(has(lower.calls, 'from app.vehicles where owner_id')).toBe(false);
  });
});

describe('PATCH /rides/{id}: the time rules are the publish rules', () => {
  it('needs 15 minutes to 14 days ahead (the injected clock is 05:00Z)', async () => {
    for (const [at, code] of [
      ['2026-11-16T05:14:00Z', 'DEPARTURE_TOO_SOON'],
      ['2026-11-16T04:00:00Z', 'DEPARTURE_TOO_SOON'],
      ['2026-11-30T05:01:00Z', 'DEPARTURE_TOO_FAR'],
    ] as const) {
      const { app, calls } = makeApp([world().handler]);
      const res = await patch(app, { departureAt: at });
      expect(res.status, at).toBe(400);
      expect((await errorOf(res)).code).toBe(code);
      expect(wroteNothing(calls)).toBe(true);
    }
    const edge = makeApp([world().handler]);
    expect((await patch(edge.app, { departureAt: '2026-11-16T05:15:00Z' })).status).toBe(200);
  });

  it('keeps the 4 rides a day on the new day, counting the other rides and not this one', async () => {
    const full = world({ otherRidesThatDay: 4 });
    const { app, calls } = makeApp([full.handler]);
    const res = await patch(app, { departureAt: '2026-11-17T09:00:00Z' });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('DAILY_RIDE_LIMIT');
    expect(wroteNothing(calls)).toBe(true);

    const count = find(calls, 'select count(*)::int as n from app.rides');
    expect(count?.text).toContain('id <> ');
    expect(count?.values).toContain(USER);
    expect(count?.values).toContain(RIDE_ID);
    // the Europe/Bucharest day of the NEW departure: [2026-11-16T22:00Z, 2026-11-17T22:00Z)
    expect(count?.values).toContain(
      (count?.values as Date[]).find(
        (v) => v instanceof Date && v.toISOString() === '2026-11-16T22:00:00.000Z',
      ),
    );

    // three other rides that day: the fourth slot is this ride's
    const three = makeApp([world({ otherRidesThatDay: 3 }).handler]);
    expect((await patch(three.app, { departureAt: '2026-11-17T09:00:00Z' })).status).toBe(200);
  });
});

describe('PATCH /rides/{id}: who and when', () => {
  it('only the driver: someone else’s ride, a missing ride and a bad id are 404', async () => {
    const other = makeApp([world({ ride: null }).handler]);
    expect((await patch(other.app, { seats: 2 })).status).toBe(404);
    expect(wroteNothing(other.calls)).toBe(true);
    // the ride is looked up by id AND driver
    const read = find(other.calls, 'for update of r');
    expect(read?.values).toEqual([RIDE_ID, USER]);
    const bad = makeApp([world().handler]);
    expect((await patch(bad.app, { seats: 2 }, { id: 'nope' })).status).toBe(404);
  });

  it('a cancelled, completed or departed ride is RIDE_NOT_EDITABLE', async () => {
    for (const ride of [
      ownerRow({ status: 'cancelled', cancelled_at: new Date('2026-11-16T04:00:00Z') }),
      ownerRow({ status: 'completed' }),
      ownerRow({ status: 'expired' }),
      ownerRow({ departure_at: new Date('2026-11-16T04:59:00Z') }),
    ]) {
      const { app, calls } = makeApp([world({ ride }).handler]);
      const res = await patch(app, { seats: 2 });
      expect(res.status).toBe(409);
      expect((await errorOf(res)).code).toBe('RIDE_NOT_EDITABLE');
      expect(wroteNothing(calls)).toBe(true);
    }
  });

  it('a ride that leaves in 5 minutes can still change seats, but not move to another time within 15', async () => {
    const soon = ownerRow({ departure_at: new Date('2026-11-16T05:05:00Z') });
    const a = makeApp([world({ ride: soon }).handler]);
    expect((await patch(a.app, { seats: 2 })).status).toBe(200);
    const b = makeApp([world({ ride: soon }).handler]);
    const res = await patch(b.app, { departureAt: '2026-11-16T05:10:00Z' });
    expect((await errorOf(res)).code).toBe('DEPARTURE_TOO_SOON');
  });

  it('is gated: 401 without a token, CONSENT_REQUIRED before new terms are accepted', async () => {
    const { app } = makeApp([world().handler]);
    expect((await patch(app, { seats: 2 }, { token: false })).status).toBe(401);
    const stale = makeApp([world({ accepted: [] }).handler]);
    const res = await patch(stale.app, { seats: 2 });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('CONSENT_REQUIRED');
  });

  it('is limited to 20 per hour', async () => {
    const { app, calls } = makeApp([
      (q) => (q.text.includes('rate_limit_hit') ? [{ allowed: false }] : undefined),
      world().handler,
    ]);
    expect((await patch(app, { seats: 2 })).status).toBe(429);
    expect(find(calls, 'app.rate_limit_hit')?.values).toEqual([`ride-edit:u:${USER}`, 3600, 20]);
  });
});

describe('PATCH /rides/{id}: the body', () => {
  it('route, price and vehicle fields are ROUTE_NOT_EDITABLE with the offending fields', async () => {
    const { app, calls } = makeApp([world().handler]);
    const res = await patch(app, {
      seats: 2,
      origin: { lat: 45.7, lng: 24.1 },
      price: 100,
      vehicle: { plate: 'SB01XYZ' },
    });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({
      code: 'ROUTE_NOT_EDITABLE',
      fields: { origin: 'not_editable', price: 'not_editable', vehicle: 'not_editable' },
    });
    expect(wroteNothing(calls)).toBe(true);
    for (const key of ['destination', 'route', 'previewId', 'isFree', 'priceTable', 'car']) {
      const r = makeApp([world().handler]);
      expect((await errorOf(await patch(r.app, { [key]: 1 }))).code, key).toBe(
        'ROUTE_NOT_EDITABLE',
      );
    }
  });

  it('is a strict schema with at least one field: unknown keys, empty body, bad types and bad JSON are 400', async () => {
    for (const body of [
      {},
      { color: 'red' },
      { seats: 0 },
      { seats: 5 },
      { seats: '2' },
      { departureAt: 'soon' },
      { autoAccept: 'yes' },
      { note: 'x'.repeat(201) },
    ]) {
      const { app, calls } = makeApp([world().handler]);
      const res = await patch(app, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await errorOf(res)).code).toBe('VALIDATION_FAILED');
      expect(wroteNothing(calls)).toBe(true);
    }
    const bad = makeApp([world().handler]);
    expect((await patch(bad.app, null, { raw: '{nope' })).status).toBe(400);
  });

  it('never accepts a price: the response price table still comes from the stored rate', async () => {
    const { app } = makeApp([world().handler]);
    const res = await patch(app, { seats: 2 });
    const out = rideOwnerViewSchema.parse(await res.json());
    expect(out.priceTable.map((r) => r.priceBani)).toEqual([310, 200]);
    expect(out.tripCostBani).toBe(624);
  });
});
