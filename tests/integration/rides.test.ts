import { describe, expect, it } from 'vitest';
import { publicUserSchema } from '../../supabase/functions/_shared/contracts/account.ts';
import { errorEnvelopeSchema } from '../../supabase/functions/_shared/contracts/errors.ts';
import {
  previewResponseSchema,
  rideListResponseSchema,
  rideOwnerViewSchema,
  ridePublicViewSchema,
} from '../../supabase/functions/_shared/contracts/rides.ts';
import { gridPoint } from '../../supabase/functions/_shared/domain/privacy.ts';
import { haversineM } from '../../supabase/functions/_shared/providers/routing/geo.ts';
import {
  BASE,
  SECRET,
  TRIP_B,
  createBareUser,
  createUser,
  inMinutes,
  noonTomorrow,
  type TestUser,
} from './factories.ts';

/**
 * Black-box ride flow against the local stack (see api.test.ts for how to start it), with
 * ROUTING_PROVIDER=fixture so no test touches a third-party network. Skipped without the stack.
 * Every test uses its own throw-away driver, so the per-user rate limits and the daily limit of
 * one test never leak into another.
 */
const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;

async function preview(driver: TestUser, body: object = TRIP_B) {
  const res = await driver.send('POST', '/rides/preview', body);
  expect(res.status).toBe(200);
  return previewResponseSchema.parse(await res.json());
}

describe.skipIf(!BASE || !SECRET)('rides against the local stack', () => {
  it('preview, publish, list, read and cancel: the whole driver flow (Trip B, diesel)', async () => {
    const driver = await createUser();
    const p = await preview(driver);

    // pricing.md §5: Trip B, diesel, 3 seats: 3.10 / 2.00 / 1.50, fuel cost 6.24 RON
    expect(p).toMatchObject({
      distanceM: 9588,
      durationS: 1020,
      tripCostBani: 624,
      rateMicroPerKm: 651000,
      fuelType: 'diesel',
    });
    expect(p.priceTable).toEqual([
      { passengers: 1, priceBani: 310 },
      { passengers: 2, priceBani: 200 },
      { passengers: 3, priceBani: 150 },
    ]);
    expect(p.originLabel.length).toBeGreaterThan(0);
    expect(p.route.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(new Date(p.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const departureAt = inMinutes(120);
    const create = await driver.send('POST', '/rides', {
      previewId: p.previewId,
      departureAt,
      seats: 3,
      note: 'Blue backpack on the dashboard',
    });
    expect(create.status).toBe(201);
    const ride = rideOwnerViewSchema.parse(await create.json());
    expect(ride).toMatchObject({
      status: 'published',
      seatsOffered: 3,
      seatsBooked: 0,
      isFree: false,
      note: 'Blue backpack on the dashboard',
      distanceM: 9588,
      tripCostBani: 624,
      canCancel: true,
      requests: [],
      passengers: [],
      car: { make: 'Dacia', model: 'Logan', colour: 'Gri', plate: 'SB12ABC' },
    });
    expect(ride.priceTable.map((r) => r.priceBani)).toEqual([310, 200, 150]);
    expect(new Date(ride.departureAt).getTime()).toBe(new Date(departureAt).getTime());

    const list = rideListResponseSchema.parse(
      await (await driver.call('/me/rides?scope=upcoming')).json(),
    );
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: ride.id,
      status: 'published',
      seatsOffered: 3,
      seatsBooked: 0,
      pendingRequests: 0,
    });
    const past = rideListResponseSchema.parse(
      await (await driver.call('/me/rides?scope=past')).json(),
    );
    expect(past.items).toHaveLength(0);

    const one = await driver.call(`/me/rides/${ride.id}`);
    expect(one.status).toBe(200);
    expect(rideOwnerViewSchema.parse(await one.json()).id).toBe(ride.id);

    const cancel = await driver.send('POST', `/rides/${ride.id}/cancel`, {});
    expect(cancel.status).toBe(200);
    const cancelled = rideOwnerViewSchema.parse(await cancel.json());
    expect(cancelled).toMatchObject({ status: 'cancelled', canCancel: false, lateCancel: false });
    expect(cancelled.cancelledAt).not.toBeNull();

    // moved from Upcoming to Past
    const after = rideListResponseSchema.parse(
      await (await driver.call('/me/rides?scope=upcoming')).json(),
    );
    expect(after.items).toHaveLength(0);
    const pastAfter = rideListResponseSchema.parse(
      await (await driver.call('/me/rides?scope=past')).json(),
    );
    expect(pastAfter.items.map((i) => i.id)).toEqual([ride.id]);
    expect(pastAfter.items[0]?.status).toBe('cancelled');

    // cancelling twice is an invalid transition
    const again = await driver.send('POST', `/rides/${ride.id}/cancel`, {});
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('INVALID_STATE');
  });

  it('a free ride has a zero price table', async () => {
    const driver = await createUser();
    const p = await preview(driver);
    const res = await driver.send('POST', '/rides', {
      previewId: p.previewId,
      departureAt: inMinutes(90),
      seats: 2,
      isFree: true,
    });
    expect(res.status).toBe(201);
    const ride = rideOwnerViewSchema.parse(await res.json());
    expect(ride.isFree).toBe(true);
    expect(ride.priceTable).toEqual([
      { passengers: 1, priceBani: 0 },
      { passengers: 2, priceBani: 0 },
    ]);
    expect(ride.tripCostBani).toBe(624); // the fuel cost is unchanged
  });

  it('the price table follows the fuel type and seats of the vehicle (Trip A, petrol)', async () => {
    const driver = await createUser({ vehicle: { fuelType: 'petrol', seats: 4 } });
    const p = await preview(driver, {
      origin: { lat: 45.709, lng: 24.151 },
      destination: { lat: 45.7977, lng: 24.1505 },
    });
    expect(p.distanceM).toBe(11514);
    expect(p.priceTable.map((r) => r.priceBani)).toEqual([390, 260, 190, 150]);
  });

  it('daily limit: the 5th ride on the same Bucharest day is rejected, a cancel frees a slot', async () => {
    const driver = await createUser();
    const p = await preview(driver);
    const publish = (minutes: number) =>
      driver.send('POST', '/rides', {
        previewId: p.previewId,
        departureAt: noonTomorrow(minutes),
        seats: 1,
      });

    const ids: string[] = [];
    for (const minutes of [0, 1, 2, 3]) {
      const res = await publish(minutes);
      expect(res.status).toBe(201);
      ids.push(rideOwnerViewSchema.parse(await res.json()).id);
    }
    const fifth = await publish(4);
    expect(fifth.status).toBe(409);
    expect((await errorOf(fifth)).code).toBe('DAILY_RIDE_LIMIT');

    // a cancelled ride no longer counts toward the day
    const first = ids[0] as string;
    expect((await driver.send('POST', `/rides/${first}/cancel`, {})).status).toBe(200);
    expect((await publish(5)).status).toBe(201);
    expect((await publish(6)).status).toBe(409);
  });

  it('daily limit under parallel publishes: exactly 4 of 6 succeed (advisory lock)', async () => {
    const driver = await createUser();
    const p = await preview(driver);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        driver.send('POST', '/rides', {
          previewId: p.previewId,
          departureAt: noonTomorrow(i),
          seats: 1,
        }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 201, 201, 409, 409]);
    for (const res of results.filter((r) => r.status === 409)) {
      expect((await errorOf(res)).code).toBe('DAILY_RIDE_LIMIT');
    }
    const list = rideListResponseSchema.parse(
      await (await driver.call('/me/rides?scope=upcoming&limit=50')).json(),
    );
    expect(list.items).toHaveLength(4);
  });

  it('the daily limit is per driver: another driver is not affected', async () => {
    const busy = await createUser();
    const free = await createUser();
    const pb = await preview(busy);
    for (const minutes of [0, 1, 2, 3]) {
      await busy.send('POST', '/rides', {
        previewId: pb.previewId,
        departureAt: noonTomorrow(minutes),
        seats: 1,
      });
    }
    const pf = await preview(free);
    const res = await free.send('POST', '/rides', {
      previewId: pf.previewId,
      departureAt: noonTomorrow(0),
      seats: 1,
    });
    expect(res.status).toBe(201);
  });

  it('PREVIEW_EXPIRED for an unknown preview and for someone else’s preview', async () => {
    const driver = await createUser();
    const thief = await createUser();
    const p = await preview(driver);
    const unknown = await driver.send('POST', '/rides', {
      previewId: crypto.randomUUID(),
      departureAt: inMinutes(120),
      seats: 1,
    });
    expect(unknown.status).toBe(400);
    expect((await errorOf(unknown)).code).toBe('PREVIEW_EXPIRED');

    const stolen = await thief.send('POST', '/rides', {
      previewId: p.previewId,
      departureAt: inMinutes(120),
      seats: 1,
    });
    expect(stolen.status).toBe(400);
    expect((await errorOf(stolen)).code).toBe('PREVIEW_EXPIRED');
  });

  it('validates departure time, seats and the body', async () => {
    const driver = await createUser({ vehicle: { seats: 2 } });
    const p = await preview(driver);
    const code = async (body: object) => {
      const res = await driver.send('POST', '/rides', {
        previewId: p.previewId,
        seats: 1,
        ...body,
      });
      expect(res.status).toBe(400);
      return (await errorOf(res)).code;
    };
    expect(await code({ departureAt: inMinutes(10) })).toBe('DEPARTURE_TOO_SOON');
    expect(await code({ departureAt: inMinutes(14 * 24 * 60 + 60) })).toBe('DEPARTURE_TOO_FAR');
    expect(await code({ departureAt: inMinutes(120), seats: 3 })).toBe('SEATS_EXCEED_VEHICLE');
    expect(await code({ departureAt: inMinutes(120), seats: 0 })).toBe('VALIDATION_FAILED');
    expect(await code({ departureAt: 'tomorrow' })).toBe('VALIDATION_FAILED');
    expect(await code({ departureAt: inMinutes(120), note: 'x'.repeat(201) })).toBe(
      'VALIDATION_FAILED',
    );
    // the edges are accepted
    const edge = await driver.send('POST', '/rides', {
      previewId: p.previewId,
      departureAt: inMinutes(16),
      seats: 2,
    });
    expect(edge.status).toBe(201);
  });

  it('preview validation: same place, outside Sibiu, too long, malformed', async () => {
    const driver = await createUser();
    const code = async (body: unknown) => {
      const res = await driver.send('POST', '/rides/preview', body);
      expect(res.status).toBe(400);
      return errorOf(res);
    };
    expect((await code({ origin: TRIP_B.origin, destination: TRIP_B.origin })).code).toBe(
      'SAME_PLACE',
    );
    const far = await code({ origin: { lat: 44.43, lng: 26.1 }, destination: TRIP_B.destination });
    expect(far.code).toBe('VALIDATION_FAILED');
    expect(far.fields).toEqual({ origin: 'outside_coverage' });
    const long = await code({
      origin: { lat: 45.681, lng: 23.981 },
      destination: { lat: 45.859, lng: 24.319 },
    });
    expect(long.code).toBe('ROUTE_TOO_LONG');
    const short = await code({
      origin: TRIP_B.destination,
      destination: { lat: TRIP_B.destination.lat + 0.005, lng: TRIP_B.destination.lng },
    });
    expect(short.code).toBe('ROUTE_TOO_SHORT');
    expect((await code({ origin: 'here' })).code).toBe('VALIDATION_FAILED');
  });

  it('gates: 401 without a token, consent, profile and vehicle are required in that order', async () => {
    expect(
      (
        await fetch(`${BASE}/rides/preview`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(TRIP_B),
        })
      ).status,
    ).toBe(401);

    const bare = await createBareUser();
    const consent = await bare.send('POST', '/rides/preview', TRIP_B);
    expect(consent.status).toBe(403);
    expect((await errorOf(consent)).code).toBe('CONSENT_REQUIRED');

    const noCar = await createUser({ vehicle: null });
    const res = await noCar.send('POST', '/rides/preview', TRIP_B);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('VEHICLE_REQUIRED');
    expect((await noCar.send('POST', '/rides', { previewId: crypto.randomUUID() })).status).toBe(
      403,
    );
  });

  it('another driver cannot read or cancel my ride (404), the list is private', async () => {
    const owner = await createUser();
    const other = await createUser();
    const p = await preview(owner);
    const ride = rideOwnerViewSchema.parse(
      await (
        await owner.send('POST', '/rides', {
          previewId: p.previewId,
          departureAt: inMinutes(120),
          seats: 2,
        })
      ).json(),
    );

    const read = await other.call(`/me/rides/${ride.id}`);
    expect(read.status).toBe(404);
    expect((await errorOf(read)).code).toBe('NOT_FOUND');
    expect((await other.send('POST', `/rides/${ride.id}/cancel`, {})).status).toBe(404);
    expect((await other.call('/me/rides/not-a-uuid')).status).toBe(404);
    const theirs = rideListResponseSchema.parse(await (await other.call('/me/rides')).json());
    expect(theirs.items).toHaveLength(0);
    // still published after the failed cancel
    const mine = rideOwnerViewSchema.parse(await (await owner.call(`/me/rides/${ride.id}`)).json());
    expect(mine.status).toBe('published');
  });

  it('cancelling within 30 minutes of departure is a late cancel and counts on the profile', async () => {
    const driver = await createUser();
    const p = await preview(driver);
    const ride = rideOwnerViewSchema.parse(
      await (
        await driver.send('POST', '/rides', {
          previewId: p.previewId,
          departureAt: inMinutes(17),
          seats: 1,
        })
      ).json(),
    );
    expect(ride.lateCancelIfNow).toBe(true);
    const cancelled = rideOwnerViewSchema.parse(
      await (await driver.send('POST', `/rides/${ride.id}/cancel`, {})).json(),
    );
    expect(cancelled).toMatchObject({ status: 'cancelled', lateCancel: true });

    const profile = publicUserSchema.parse(
      await (await fetch(`${BASE}/users/${driver.id}`)).json(),
    );
    expect(profile.lateCancellations90d).toBe(1);
  });

  it('an early cancel is not a late cancel', async () => {
    const driver = await createUser();
    const p = await preview(driver);
    const ride = rideOwnerViewSchema.parse(
      await (
        await driver.send('POST', '/rides', {
          previewId: p.previewId,
          departureAt: inMinutes(180),
          seats: 1,
        })
      ).json(),
    );
    expect(ride.lateCancelIfNow).toBe(false);
    await driver.send('POST', `/rides/${ride.id}/cancel`, {});
    const profile = publicUserSchema.parse(
      await (await fetch(`${BASE}/users/${driver.id}`)).json(),
    );
    expect(profile.lateCancellations90d).toBe(0);
  });

  it('lists page by page with an opaque cursor, upcoming ascending', async () => {
    const driver = await createUser();
    const p = await preview(driver);
    const ids: string[] = [];
    for (const minutes of [150, 120, 135]) {
      const res = await driver.send('POST', '/rides', {
        previewId: p.previewId,
        departureAt: inMinutes(minutes),
        seats: 1,
      });
      ids.push(rideOwnerViewSchema.parse(await res.json()).id);
    }
    const first = rideListResponseSchema.parse(
      await (await driver.call('/me/rides?limit=2')).json(),
    );
    expect(first.items.map((i) => i.id)).toEqual([ids[1], ids[2]]); // +120, +135
    expect(first.nextCursor).not.toBeNull();
    const second = rideListResponseSchema.parse(
      await (await driver.call(`/me/rides?limit=2&cursor=${first.nextCursor}`)).json(),
    );
    expect(second.items.map((i) => i.id)).toEqual([ids[0]]); // +150
    expect(second.nextCursor).toBeNull();
    expect((await driver.call('/me/rides?cursor=garbage')).status).toBe(400);
  });

  describe('public view', () => {
    const EXACT_LABEL = 'Casa mea, Str. Exacta 12';
    async function publishedRide(driver: TestUser) {
      const p = await preview(driver, { ...TRIP_B, originLabel: EXACT_LABEL });
      const res = await driver.send('POST', '/rides', {
        previewId: p.previewId,
        departureAt: inMinutes(120),
        seats: 3,
        note: 'Blue backpack',
      });
      return rideOwnerViewSchema.parse(await res.json());
    }

    it('has no exact origin or destination, no plate and no phone; points are 300 m grid centres', async () => {
      const driver = await createUser();
      const ride = await publishedRide(driver);

      const res = await fetch(`${BASE}/rides/${ride.id}`); // anonymous
      expect(res.status).toBe(200);
      const text = await res.text();
      const pub = ridePublicViewSchema.parse(JSON.parse(text));

      expect(pub).toMatchObject({
        id: ride.id,
        status: 'published',
        seatsOffered: 3,
        seatsLeft: 3,
        distanceM: 9588,
        note: 'Blue backpack',
        car: { make: 'Dacia', model: 'Logan', colour: 'Gri' },
        viewer: { isDriver: false, bookingId: null, bookingStatus: null, blocked: false },
      });
      expect(pub.priceTable.map((r) => r.priceBani)).toEqual([310, 200, 150]);
      expect(pub.driver.id).toBe(driver.id);

      // grid centres, computed independently by the TypeScript mirror of app.grid_point
      expect({ lat: pub.origin.point.lat, lng: pub.origin.point.lng }).toEqual(
        gridPoint(ride.origin.point, 300),
      );
      expect({ lat: pub.destination.point.lat, lng: pub.destination.point.lng }).toEqual(
        gridPoint(ride.destination.point, 300),
      );
      expect(pub.origin.point.approx).toBe(true);
      expect(pub.origin.point.radiusM).toBe(300);
      // area labels, never the driver's own (possibly exact) label
      expect(ride.origin.label).toBe(EXACT_LABEL);
      expect(pub.origin.label).not.toBe(EXACT_LABEL);
      expect(pub.origin.label.length).toBeGreaterThan(0);

      // the trimmed route never starts or ends at the exact points
      expect(pub.routePublic).not.toBeNull();
      const coords = pub.routePublic?.coordinates ?? [];
      const first = coords[0] as [number, number];
      const last = coords[coords.length - 1] as [number, number];
      const o = ride.origin.point;
      const d = ride.destination.point;
      expect(haversineM({ lng: first[0], lat: first[1] }, o)).toBeGreaterThan(400);
      expect(haversineM({ lng: last[0], lat: last[1] }, d)).toBeGreaterThan(400);
      // no vertex of the public route is the exact origin or destination
      for (const [lng, lat] of coords) {
        expect(lat === o.lat && lng === o.lng).toBe(false);
        expect(lat === d.lat && lng === d.lng).toBe(false);
      }

      // nothing exact or private anywhere in the payload
      for (const secret of ['SB12ABC', 'plate', 'phone', '+40721', 'Str. Exacta', EXACT_LABEL]) {
        expect(text, secret).not.toContain(secret);
      }
    });

    it('is the same for a signed-in stranger, and flags the driver as the viewer', async () => {
      const driver = await createUser();
      const stranger = await createUser({ vehicle: null });
      const ride = await publishedRide(driver);
      const mine = ridePublicViewSchema.parse(
        await (await driver.call(`/rides/${ride.id}`)).json(),
      );
      expect(mine.viewer.isDriver).toBe(true);
      const theirs = ridePublicViewSchema.parse(
        await (await stranger.call(`/rides/${ride.id}`)).json(),
      );
      expect(theirs.viewer.isDriver).toBe(false);
      expect(theirs.origin).toEqual(mine.origin);
    });

    it('a cancelled ride is a 404 for visitors and others, still readable by its driver', async () => {
      const driver = await createUser();
      const stranger = await createUser({ vehicle: null });
      const ride = await publishedRide(driver);
      await driver.send('POST', `/rides/${ride.id}/cancel`, {});

      expect((await fetch(`${BASE}/rides/${ride.id}`)).status).toBe(404);
      expect((await stranger.call(`/rides/${ride.id}`)).status).toBe(404);
      const own = await driver.call(`/rides/${ride.id}`);
      expect(own.status).toBe(200);
      expect(ridePublicViewSchema.parse(await own.json()).status).toBe('cancelled');
    });

    it('unknown and malformed ids are 404', async () => {
      expect((await fetch(`${BASE}/rides/${crypto.randomUUID()}`)).status).toBe(404);
      expect((await fetch(`${BASE}/rides/not-a-uuid`)).status).toBe(404);
    });
  });
});
