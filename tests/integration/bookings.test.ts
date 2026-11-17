import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bookingListResponseSchema,
  bookingViewSchema,
  summaryResponseSchema,
  type BookingView,
} from '../../supabase/functions/_shared/contracts/bookings.ts';
import { errorEnvelopeSchema } from '../../supabase/functions/_shared/contracts/errors.ts';
import {
  previewResponseSchema,
  rideOwnerViewSchema,
  type RideOwnerView,
} from '../../supabase/functions/_shared/contracts/rides.ts';
import { matchResponseSchema } from '../../supabase/functions/_shared/contracts/search.ts';
import {
  quoteUpTo,
  seatPriceBani,
  segmentCostMicro,
} from '../../supabase/functions/_shared/domain/pricing.ts';
import {
  bucharestDayKey,
  bucharestLocalToUtc,
} from '../../supabase/functions/_shared/domain/time.ts';
import { BASE, SECRET, createBareUser, createUser, type TestUser } from './factories.ts';

/**
 * Black-box booking tests against the local stack (see api.test.ts for how to start it), with
 * ROUTING_PROVIDER=fixture and EMAIL_PROVIDER=console. Skipped without the stack.
 *
 * Isolation: every scenario publishes on its OWN random lane on a random day 2 to 12 days ahead
 * (a straight ride the fixture router does not know) with freshly created users, and asserts only on
 * what it created.
 *
 * Needs the database directly (expiry, the 24 h reveal window, blocks, invariants after the
 * concurrency cases): connects as the local superuser.
 *   INT_DB_URL   default postgresql://postgres:postgres@127.0.0.1:54322/postgres
 *   INT_DB=skip  skips every test that needs it (and so the concurrency suite)
 *   CRON_SECRET  same value as the function's: lets the suite call POST /internal/tick (the tests that
 *                run the tick are skipped without it)
 */
const DB_URL = process.env.INT_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DB_SKIP = process.env.INT_DB === 'skip';
const CRON = process.env.CRON_SECRET;
const RATE_MICRO_DIESEL = 651_000; // energy price v1, diesel
const PLATE = 'SB12ABC';
const DRIVER_PHONE = '+40733111222';
const PASSENGER_PHONE = '+40744555666';

type Point = { lat: number; lng: number };
type Lane = { from: Point; to: Point };

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
const LANE_DLAT = 0.008;
const LANE_DLNG = 0.05;
function lane(): Lane {
  const lat = r5(45.7 + Math.random() * 0.14);
  const lng = r5(24.0 + Math.random() * 0.2);
  return { from: { lat, lng }, to: { lat: r5(lat + LANE_DLAT), lng: r5(lng + LANE_DLNG) } };
}
const lerp = (l: Lane, t: number): Point => ({
  lat: r5(l.from.lat + (l.to.lat - l.from.lat) * t),
  lng: r5(l.from.lng + (l.to.lng - l.from.lng) * t),
});

/** A random Bucharest day 2 to 12 days ahead at 10:00 to 16:00. */
function departure(): Date {
  const day = bucharestDayKey(
    new Date(Date.now() + (2 + Math.floor(Math.random() * 11)) * 86_400_000),
  );
  const hour = String(10 + Math.floor(Math.random() * 7)).padStart(2, '0');
  return bucharestLocalToUtc(day, `${hour}:00`);
}
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;

async function publish(driver: TestUser, l: Lane, at: Date, seats = 3) {
  const pRes = await driver.send('POST', '/rides/preview', { origin: l.from, destination: l.to });
  expect(pRes.status).toBe(200);
  const preview = previewResponseSchema.parse(await pRes.json());
  const res = await driver.send('POST', '/rides', {
    previewId: preview.previewId,
    departureAt: iso(at),
    seats,
  });
  expect(res.status).toBe(201);
  return rideOwnerViewSchema.parse(await res.json());
}

/** An onboarded user with their own phone (the factory gives everyone the same one). */
async function user(firstName: string, phone: string): Promise<TestUser> {
  const u = await createUser({ firstName });
  const res = await u.send('PATCH', '/me/profile', { phone });
  expect(res.status).toBe(200);
  return u;
}

type Trip = { from: Point; to: Point };
/** The passenger rides the middle part of the lane: pickup and dropoff differ from the ride's ends. */
const middle = (l: Lane): Trip => ({ from: lerp(l, 0.3), to: lerp(l, 0.8) });
const whole = (l: Lane): Trip => ({ from: l.from, to: l.to });

const newKey = (): string => crypto.randomUUID();

function requestSeat(p: TestUser, rideId: string, trip: Trip, key: string = newKey()) {
  return p.call('/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ rideId, ...trip }),
  });
}

async function book(
  p: TestUser,
  rideId: string,
  trip: Trip,
  key: string = newKey(),
): Promise<BookingView> {
  const res = await requestSeat(p, rideId, trip, key);
  expect(res.status).toBe(201);
  return bookingViewSchema.parse(await res.json());
}

async function getBooking(who: TestUser, id: string): Promise<BookingView> {
  const res = await who.call(`/bookings/${id}`);
  expect(res.status).toBe(200);
  return bookingViewSchema.parse(await res.json());
}

async function ownerView(driver: TestUser, rideId: string): Promise<RideOwnerView> {
  const res = await driver.call(`/me/rides/${rideId}`);
  expect(res.status).toBe(200);
  return rideOwnerViewSchema.parse(await res.json());
}

const approve = (driver: TestUser, id: string) =>
  driver.send('POST', `/bookings/${id}/approve`, {});
const reject = (driver: TestUser, id: string) => driver.send('POST', `/bookings/${id}/reject`, {});
const cancel = (p: TestUser, id: string) => p.send('POST', `/bookings/${id}/cancel`, {});

async function approveOk(driver: TestUser, id: string): Promise<RideOwnerView> {
  const res = await approve(driver, id);
  expect(res.status).toBe(200);
  return rideOwnerViewSchema.parse(await res.json());
}

const tick = () =>
  fetch(`${BASE}/internal/tick`, { method: 'POST', headers: { 'x-cron-secret': CRON ?? '' } });

/** Every number in a JSON value, with its path, that is in `bad`. */
function pathsOfNumbers(value: unknown, bad: ReadonlySet<number>, path = '$'): string[] {
  if (typeof value === 'number') return bad.has(value) ? [`${path}=${value}`] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => pathsOfNumbers(v, bad, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => pathsOfNumbers(v, bad, `${path}.${k}`));
  }
  return [];
}

/** Drops the trimmed public route (its interior vertices are points of the road, checked separately). */
function withoutRoutes(text: string): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [
          k,
          k === 'route' || k === 'routePublic' ? null : strip(x),
        ]),
      );
    }
    return v;
  };
  return strip(JSON.parse(text));
}

describe.skipIf(!BASE || !SECRET)('booking lifecycle against the local stack', () => {
  it('request, replay, approve, reveal, cancel and request again', async () => {
    const [driver, p] = await Promise.all([
      user('Radu', DRIVER_PHONE),
      user('Ioana', PASSENGER_PHONE),
    ]);
    const l = lane();
    const ride = await publish(driver, l, departure());
    const trip = whole(l);
    const key = newKey();

    // request: the server prices it (a client-sent price is ignored) and the points stay approximate
    const res = await p.call('/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify({ rideId: ride.id, ...trip, priceBani: 1 }),
    });
    expect(res.status).toBe(201);
    const view = bookingViewSchema.parse(await res.json());
    expect(view).toMatchObject({ status: 'requested', viewerRole: 'passenger', rideId: ride.id });
    expect(view.price.quotedBani).toBe(quoteUpTo(view.segmentM, RATE_MICRO_DIESEL, false));
    expect(view.price.quotedBani).toBeGreaterThan(1);
    expect(view.pickup.point).toMatchObject({ approx: true, radiusM: 300 });
    expect(view.contact).toBeNull();
    expect(view.car.plate).toBeNull();
    expect(view.pickup.label.length).toBeGreaterThan(0);
    // expires_at = least(requested_at + 30 min, departure - 10 min): the ride is days away
    expect(new Date(view.expiresAt).getTime() - new Date(view.requestedAt).getTime()).toBe(
      30 * 60_000,
    );

    // idempotent replay: same key, same ride, same booking, no second row
    const replay = await requestSeat(p, ride.id, trip, key);
    expect(replay.status).toBe(201);
    expect(bookingViewSchema.parse(await replay.json()).id).toBe(view.id);

    // a key reused for another ride is a validation error
    const other = await publish(await user('Mihai', '0722 000 111'), lane(), departure());
    const reused = await requestSeat(p, other.id, trip, key);
    expect(reused.status).toBe(400);
    expect(await errorOf(reused)).toMatchObject({ fields: { idempotencyKey: 'reused' } });

    // the header is required and must be a uuid
    const noKey = await p.send('POST', '/bookings', { rideId: ride.id, ...trip });
    expect(noKey.status).toBe(400);
    expect((await errorOf(noKey)).fields).toMatchObject({ idempotencyKey: 'required' });
    const badKey = await requestSeat(p, ride.id, trip, 'nope');
    expect((await errorOf(badKey)).fields).toMatchObject({ idempotencyKey: 'invalid' });

    // a second request on the same ride is refused, and the match endpoint says why
    const again = await requestSeat(p, ride.id, trip);
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('ALREADY_REQUESTED');
    const match = matchResponseSchema.parse(
      await (await p.send('POST', `/rides/${ride.id}/match`, trip)).json(),
    );
    expect(match).toMatchObject({ bookable: false, notBookableReason: 'ALREADY_REQUESTED' });

    // the driver sees the request without any point, with the price if accepted
    const owner = await ownerView(driver, ride.id);
    expect(owner.requests).toHaveLength(1);
    expect(owner.requests[0]).toMatchObject({
      bookingId: view.id,
      passenger: { firstName: 'Ioana' },
      priceIfAcceptedBani: quoteUpTo(view.segmentM, RATE_MICRO_DIESEL, false),
    });
    expect(JSON.stringify(owner.requests)).not.toMatch(/"(lat|lng|point)"/);
    expect(JSON.stringify(owner.requests)).not.toContain(PASSENGER_PHONE);

    // badges
    const dSummary = summaryResponseSchema.parse(await (await driver.call('/me/summary')).json());
    expect(dSummary.driverPendingRequests).toBe(1);
    expect(dSummary.nextRide).toMatchObject({ kind: 'ride', id: ride.id });
    expect(
      summaryResponseSchema.parse(await (await p.call('/me/summary')).json())
        .passengerUnseenUpdates,
    ).toBe(0);

    // approve: seat taken, contact revealed to both
    const afterApprove = await approveOk(driver, view.id);
    expect(afterApprove).toMatchObject({ seatsBooked: 1, requests: [] });
    expect(afterApprove.passengers).toHaveLength(1);
    expect(afterApprove.passengers[0]).toMatchObject({
      status: 'confirmed',
      phoneE164: PASSENGER_PHONE,
      priceLockedBani: view.price.quotedBani,
    });
    expect(afterApprove.passengers[0]?.pickup.point).not.toHaveProperty('approx');

    const confirmed = await getBooking(p, view.id);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.pickup.point).not.toHaveProperty('approx');
    expect(confirmed.contact?.phoneE164).toBe(DRIVER_PHONE);
    expect(confirmed.car.plate).toBe(PLATE);
    expect(confirmed.route).not.toBeNull();
    expect(confirmed.price.lockedBani).toBe(view.price.quotedBani);
    expect(confirmed.unseen).toBe(true);
    expect(JSON.stringify(confirmed)).not.toContain(PASSENGER_PHONE);

    // seen clears the badge; someone else's ids are ignored
    const pSummary = summaryResponseSchema.parse(await (await p.call('/me/summary')).json());
    expect(pSummary).toMatchObject({ passengerUnseenUpdates: 1 });
    expect(pSummary.nextRide).toMatchObject({ kind: 'booking', id: view.id });
    expect((await p.send('POST', '/me/summary/seen', { bookingIds: [view.id] })).status).toBe(204);
    expect(
      summaryResponseSchema.parse(await (await p.call('/me/summary')).json())
        .passengerUnseenUpdates,
    ).toBe(0);
    const bookingsList = bookingListResponseSchema.parse(
      await (await p.call('/me/bookings')).json(),
    );
    expect(bookingsList.items.find((i) => i.id === view.id)).toMatchObject({
      status: 'confirmed',
      unseen: false,
    });

    // the driver sees the booking as a driver; a stranger gets 404
    const asDriver = await getBooking(driver, view.id);
    expect(asDriver).toMatchObject({ viewerRole: 'driver', unseen: false });
    expect(asDriver.contact?.phoneE164).toBe(PASSENGER_PHONE);
    const stranger = await user('Vlad', '0755 222 333');
    expect((await stranger.call(`/bookings/${view.id}`)).status).toBe(404);
    expect((await fetch(`${BASE}/bookings/${view.id}`)).status).toBe(401);

    // cancel (not late): seat freed, booking cancelled
    const cancelRes = await cancel(p, view.id);
    expect(cancelRes.status).toBe(200);
    const cancelled = bookingViewSchema.parse(await cancelRes.json());
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelledBy: 'passenger' });
    expect(cancelled.actions.canCancel).toBe(false);
    expect((await ownerView(driver, ride.id)).seatsBooked).toBe(0);
    expect((await cancel(p, view.id)).status).toBe(409);

    // asking again after a cancel is allowed
    const second = await book(p, ride.id, trip);
    expect(second.id).not.toBe(view.id);
  });

  it('reject is final: the declined passenger cannot ask again', async () => {
    const [driver, p] = await Promise.all([
      user('Radu', DRIVER_PHONE),
      user('Ioana', PASSENGER_PHONE),
    ]);
    const l = lane();
    const ride = await publish(driver, l, departure());
    const b = await book(p, ride.id, whole(l));

    const res = await reject(driver, b.id);
    expect(res.status).toBe(200);
    expect(rideOwnerViewSchema.parse(await res.json())).toMatchObject({
      requests: [],
      seatsBooked: 0,
    });
    expect((await getBooking(p, b.id)).status).toBe('rejected');
    expect((await getBooking(p, b.id)).unseen).toBe(true);

    const again = await requestSeat(p, ride.id, whole(l));
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('ALREADY_REQUESTED');
    expect((await approve(driver, b.id)).status).toBe(409);
    expect((await cancel(p, b.id)).status).toBe(409);
  });

  it('only the ride driver can approve or reject: anyone else gets 404', async () => {
    const [driver, p, other] = await Promise.all([
      user('Radu', DRIVER_PHONE),
      user('Ioana', PASSENGER_PHONE),
      user('Vlad', '0755 222 333'),
    ]);
    const l = lane();
    const ride = await publish(driver, l, departure());
    const b = await book(p, ride.id, whole(l));
    for (const who of [p, other]) {
      expect((await approve(who, b.id)).status).toBe(404);
      expect((await reject(who, b.id)).status).toBe(404);
    }
    expect((await cancel(other, b.id)).status).toBe(404);
    expect((await driver.send('POST', `/bookings/${b.id}/cancel`, {})).status).toBe(404);
    expect((await approve(driver, 'not-a-uuid')).status).toBe(404);
  });

  it('mixed segments: a second approval lowers the first price, a cancel never raises it back', async () => {
    const [driver, p1, p2] = await Promise.all([
      user('Radu', DRIVER_PHONE),
      user('Ioana', PASSENGER_PHONE),
      user('Mara', '0766 111 000'),
    ]);
    const l = lane();
    const ride = await publish(driver, l, departure());
    const b1 = await book(p1, ride.id, whole(l));
    const b2 = await book(p2, ride.id, { from: lerp(l, 0.4), to: l.to });
    expect(b2.segmentM).toBeLessThan(b1.segmentM);

    await approveOk(driver, b1.id);
    expect((await getBooking(p1, b1.id)).price.lockedBani).toBe(b1.price.quotedBani);

    const owner = await approveOk(driver, b2.id);
    expect(owner.seatsBooked).toBe(2);
    const v1 = await getBooking(p1, b1.id);
    const v2 = await getBooking(p2, b2.id);
    // n = 2: P1 pays less than alone, P2 pays its own segment share
    expect(v1.price.lockedBani).toBe(seatPriceBani(b1.segmentM, RATE_MICRO_DIESEL, 2, false));
    expect(v1.price.lockedBani).toBeLessThan(b1.price.quotedBani);
    expect(v1.price).toMatchObject({
      quotedBani: b1.price.quotedBani,
      droppedFromBani: b1.price.quotedBani,
    });
    expect(v1.unseen).toBe(true); // the price drop is an update P1 did not cause
    expect(v2.price.lockedBani).toBe(seatPriceBani(b2.segmentM, RATE_MICRO_DIESEL, 2, false));
    // the driver never collects more than 2/3 of the trip cost
    const sum = (v1.price.lockedBani ?? 0) + (v2.price.lockedBani ?? 0);
    expect(sum * 10_000 * 3).toBeLessThanOrEqual(
      2 * segmentCostMicro(ride.distanceM, RATE_MICRO_DIESEL),
    );

    // P2 leaves: P1's lock stays where it was
    expect((await cancel(p2, b2.id)).status).toBe(200);
    expect((await getBooking(p1, b1.id)).price.lockedBani).toBe(v1.price.lockedBani);
    expect((await ownerView(driver, ride.id)).seatsBooked).toBe(1);
  });

  it('a driver cancel cascades: every active booking is cancelled, passengers keep their view', async () => {
    const [driver, p1, p2, stranger] = await Promise.all([
      user('Radu', DRIVER_PHONE),
      user('Ioana', PASSENGER_PHONE),
      user('Mara', '0766 111 000'),
      user('Vlad', '0755 222 333'),
    ]);
    const l = lane();
    const ride = await publish(driver, l, departure());
    const b1 = await book(p1, ride.id, whole(l));
    const b2 = await book(p2, ride.id, whole(l));
    await approveOk(driver, b1.id);

    const res = await driver.send('POST', `/rides/${ride.id}/cancel`, {});
    expect(res.status).toBe(200);
    expect(rideOwnerViewSchema.parse(await res.json())).toMatchObject({
      status: 'cancelled',
      seatsBooked: 0,
      requests: [],
      passengers: [],
    });

    for (const [p, b] of [
      [p1, b1],
      [p2, b2],
    ] as const) {
      const v = await getBooking(p, b.id);
      expect(v).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'driver',
        rideStatus: 'cancelled',
      });
      expect(v.timeline.at(-1)?.status).toBe('ride_cancelled');
      expect(v.unseen).toBe(true);
      expect(v.contact).toBeNull();
      expect(v.actions.canCancel).toBe(false);
      // a cancelled ride stays visible to its passengers (party rule) and to nobody else
      const pub = await p.call(`/rides/${ride.id}`);
      expect(pub.status).toBe(200);
      expect(await pub.json()).toMatchObject({
        viewer: { bookingId: b.id, bookingStatus: 'cancelled' },
      });
    }
    expect((await stranger.call(`/rides/${ride.id}`)).status).toBe(404);
  });

  it('answers each request rule with its own code', async () => {
    const [driver, p1, p2] = await Promise.all([
      user('Radu', DRIVER_PHONE),
      user('Ioana', PASSENGER_PHONE),
      user('Mara', '0766 111 000'),
    ]);
    const l = lane();
    const ride = await publish(driver, l, departure(), 1);

    const own = await requestSeat(driver, ride.id, whole(l));
    expect((await errorOf(own)).code).toBe('OWN_RIDE');

    const away = await requestSeat(p1, ride.id, {
      from: { lat: r5(l.from.lat + 0.03), lng: l.from.lng },
      to: { lat: r5(l.to.lat + 0.03), lng: l.to.lng },
    });
    expect((await errorOf(away)).code).toBe('NO_LONGER_MATCHES');

    const outside = await requestSeat(p1, ride.id, { from: { lat: 50, lng: 10 }, to: l.to });
    expect(outside.status).toBe(400);

    const unknown = await requestSeat(p1, crypto.randomUUID(), whole(l));
    expect(unknown.status).toBe(404);

    const b1 = await book(p1, ride.id, whole(l));
    const b2 = await book(p2, ride.id, whole(l));
    await approveOk(driver, b1.id);
    // the ride is full: a new request is refused and the open one cannot be approved
    const p3 = await user('Dan', '0777 000 999');
    const full = await requestSeat(p3, ride.id, whole(l));
    expect((await errorOf(full)).code).toBe('RIDE_FULL');
    const lost = await approve(driver, b2.id);
    expect(lost.status).toBe(409);
    expect((await errorOf(lost)).code).toBe('RIDE_FULL');
    // ...and the match endpoint names it
    const match = matchResponseSchema.parse(
      await (await p3.send('POST', `/rides/${ride.id}/match`, whole(l))).json(),
    );
    expect(match.notBookableReason).toBe('RIDE_FULL');
  });

  it('a request needs consent and a complete profile', async () => {
    const driver = await user('Radu', DRIVER_PHONE);
    const l = lane();
    const ride = await publish(driver, l, departure());
    const bare = await createBareUser();
    const res = await requestSeat(bare, ride.id, whole(l));
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('CONSENT_REQUIRED');
  });
});

// ---- database backed: late cancel, expiry, reveal window, blocks, leak scan, concurrency -------------------------

describe.skipIf(!BASE || !SECRET || DB_SKIP)('bookings against the database', () => {
  let sql: postgres.Sql;
  beforeAll(() => {
    sql = postgres(DB_URL, { max: 4, connect_timeout: 15, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** The tick resolves email addresses through auth.users: give a test user a row there. */
  async function withAuthRow(u: TestUser) {
    await sql`
      insert into auth.users (id, instance_id, aud, role, email)
      values (${u.id}::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${u.email})
      on conflict (id) do nothing`;
  }

  type RideRow = { seats_booked: number; seats_offered: number; status: string };
  /**
   * The invariants after every concurrency case: seats_booked = accepted seats, i.e. confirmed + completed + no_show
   * (E5; also on a cancelled ride), no seat over the offer, every lock at or below its quote, and the driver never collects
   * more than n/(n+1) of the trip cost.
   */
  async function assertInvariants(rideId: string) {
    const [ride] = await sql<RideRow[]>`
      select seats_booked, seats_offered, status::text from app.rides where id = ${rideId}::uuid`;
    const confirmed = await sql<{ price_locked_bani: number; price_quoted_bani: number }[]>`
      select price_locked_bani, price_quoted_bani from app.bookings
      where ride_id = ${rideId}::uuid and status = 'confirmed'`;
    // E5: seats_booked counts accepted seats (confirmed, completed, no_show). Prices relock confirmed only.
    const [accepted] = await sql<{ n: number }[]>`
      select count(*)::int as n from app.bookings
      where ride_id = ${rideId}::uuid and status in ('confirmed', 'completed', 'no_show')`;
    expect(ride?.seats_booked).toBe(accepted?.n);
    expect(ride?.seats_booked ?? 99).toBeLessThanOrEqual(ride?.seats_offered ?? 0);
    for (const c of confirmed) expect(c.price_locked_bani).toBeLessThanOrEqual(c.price_quoted_bani);
    const [rideCost] = await sql<{ distance_m: number; rate_micro_per_km: number }[]>`
      select distance_m, rate_micro_per_km from app.rides where id = ${rideId}::uuid`;
    const n = confirmed.length;
    if (n > 0 && rideCost) {
      const sum = confirmed.reduce((s, c) => s + c.price_locked_bani, 0);
      expect(sum * 10_000 * (n + 1)).toBeLessThanOrEqual(
        n * segmentCostMicro(rideCost.distance_m, rideCost.rate_micro_per_km),
      );
    }
  }

  const statusOf = async (id: string) =>
    (
      await sql<{ status: string }[]>`select status::text from app.bookings where id = ${id}::uuid`
    )[0]?.status;

  it('a confirmed cancel within 30 minutes of departure is a late cancellation', async () => {
    const [driver, p] = await Promise.all([
      user('Radu', DRIVER_PHONE),
      user('Ioana', PASSENGER_PHONE),
    ]);
    const l = lane();
    const ride = await publish(driver, l, new Date(Date.now() + 20 * 60_000));
    const b = await book(p, ride.id, whole(l));
    // 20 minutes ahead: the request cutoff (10 min) has not passed, the request expires in 10 minutes
    expect(new Date(b.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    await approveOk(driver, b.id);
    expect((await getBooking(p, b.id)).actions).toMatchObject({
      canCancel: true,
      lateCancelIfNow: true,
    });

    const res = await cancel(p, b.id);
    expect(res.status).toBe(200);
    const events = await sql<{ n: number }[]>`
      select count(*)::int as n from app.reliability_events
      where user_id = ${p.id}::uuid and kind = 'late_cancellation' and booking_id = ${b.id}::uuid`;
    expect(events[0]?.n).toBe(1);
    const [row] = await sql<{ late_cancel: boolean }[]>`
      select late_cancel from app.bookings where id = ${b.id}::uuid`;
    expect(row?.late_cancel).toBe(true);
    await assertInvariants(ride.id);
  });

  it('a request is refused within 10 minutes of departure, and by a block either way', async () => {
    const [driver, p] = await Promise.all([
      user('Radu', DRIVER_PHONE),
      user('Ioana', PASSENGER_PHONE),
    ]);
    const l = lane();
    const ride = await publish(driver, l, departure());

    await sql`update app.rides set departure_at = now() + interval '9 minutes' where id = ${ride.id}::uuid`;
    const soon = await requestSeat(p, ride.id, whole(l));
    expect((await errorOf(soon)).code).toBe('RIDE_NOT_BOOKABLE');
    await sql`update app.rides set departure_at = ${departure()} where id = ${ride.id}::uuid`;

    for (const [blocker, blocked] of [
      [p, driver],
      [driver, p],
    ] as const) {
      await sql`insert into app.blocks (blocker_id, blocked_id) values (${blocker.id}::uuid, ${blocked.id}::uuid)`;
      try {
        const res = await requestSeat(p, ride.id, whole(l));
        expect(res.status).toBe(409);
        expect((await errorOf(res)).code).toBe('BLOCKED');
      } finally {
        await sql`delete from app.blocks where blocker_id = ${blocker.id}::uuid`;
      }
    }
    expect((await requestSeat(p, ride.id, whole(l))).status).toBe(201);
  });

  it('a block placed after the request stops the approval', async () => {
    const [driver, p] = await Promise.all([
      user('Radu', DRIVER_PHONE),
      user('Ioana', PASSENGER_PHONE),
    ]);
    const l = lane();
    const ride = await publish(driver, l, departure());
    const b = await book(p, ride.id, whole(l));
    await sql`insert into app.blocks (blocker_id, blocked_id) values (${driver.id}::uuid, ${p.id}::uuid)`;
    try {
      const res = await approve(driver, b.id);
      expect(res.status).toBe(409);
      expect((await errorOf(res)).code).toBe('BLOCKED');
    } finally {
      await sql`delete from app.blocks where blocker_id = ${driver.id}::uuid`;
    }
    expect(await statusOf(b.id)).toBe('requested');
  });

  it.skipIf(!CRON)(
    'an unanswered request expires: approve says so, the tick expires it and emails the passenger',
    async () => {
      const [driver, p] = await Promise.all([
        user('Radu', DRIVER_PHONE),
        user('Ioana', PASSENGER_PHONE),
      ]);
      await withAuthRow(p);
      const l = lane();
      const ride = await publish(driver, l, departure());
      const b = await book(p, ride.id, whole(l));

      await sql`
      update app.bookings set requested_at = now() - interval '40 minutes',
                              expires_at = now() - interval '1 minute'
      where id = ${b.id}::uuid`;
      // before the tick the guard in approve already refuses an expired request
      const early = await approve(driver, b.id);
      expect(early.status).toBe(409);
      expect((await errorOf(early)).code).toBe('REQUEST_EXPIRED');
      expect(await statusOf(b.id)).toBe('requested');
      expect((await reject(driver, b.id)).status).toBe(409);
      // an expired request is not open any more
      expect((await ownerView(driver, ride.id)).requests).toEqual([]);

      const res = await tick();
      expect(res.status).toBe(200);
      expect((await res.json()) as { expired: number }).toMatchObject({
        expired: expect.any(Number),
      });
      expect(await statusOf(b.id)).toBe('expired');
      expect((await getBooking(p, b.id)).unseen).toBe(true);

      // the outbox row was queued in the same transaction and sent by the console provider
      const rows = await sql<
        { status: string; template: string; payload: Record<string, unknown> }[]
      >`
      select status::text, template, payload from app.outbox
      where user_id = ${p.id}::uuid and template = 'booking_expired'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('sent');
      expect(JSON.stringify(rows[0]?.payload)).not.toMatch(/\d+\.\d{4,}|\+40|SB12|@/);
      // a second tick finds nothing left to do for this booking
      await tick();
      expect(await statusOf(b.id)).toBe('expired');
      // after expiry the passenger may ask again
      expect((await requestSeat(p, ride.id, whole(l))).status).toBe(201);
    },
  );

  it.skipIf(!CRON)(
    'emails go out for a request and an acceptance, never with an exact detail',
    async () => {
      const [driver, p] = await Promise.all([
        user('Radu', DRIVER_PHONE),
        user('Ioana', PASSENGER_PHONE),
      ]);
      await Promise.all([withAuthRow(driver), withAuthRow(p)]);
      const l = lane();
      const ride = await publish(driver, l, departure());
      const b = await book(p, ride.id, middle(l));
      await approveOk(driver, b.id);
      await tick();
      const rows = await sql<
        { user_id: string; template: string; status: string; payload: unknown }[]
      >`
      select user_id::text, template, status::text, payload from app.outbox
      where user_id in (${driver.id}::uuid, ${p.id}::uuid) order by created_at`;
      expect(
        rows.map((r) => `${r.template}:${r.user_id === driver.id ? 'driver' : 'passenger'}`),
      ).toEqual(['booking_requested:driver', 'booking_confirmed:passenger']);
      expect(rows.every((r) => r.status === 'sent')).toBe(true);
      for (const r of rows) {
        expect(JSON.stringify(r.payload)).not.toMatch(/\d+\.\d{4,}|\+40|SB12|@/);
      }
    },
  );

  it('after departure + 24 h nothing exact is left in any view; before that it is all there', async () => {
    const [driver, p] = await Promise.all([
      user('Radu', DRIVER_PHONE),
      user('Ioana', PASSENGER_PHONE),
    ]);
    const l = lane();
    const ride = await publish(driver, l, departure());
    const b = await book(p, ride.id, middle(l));
    await approveOk(driver, b.id);

    const [stored] = await sql<{ plat: number; plng: number; dlat: number; dlng: number }[]>`
      select round(ST_Y(pickup)::numeric, 5)::float8 as plat, round(ST_X(pickup)::numeric, 5)::float8 as plng,
             round(ST_Y(dropoff)::numeric, 5)::float8 as dlat, round(ST_X(dropoff)::numeric, 5)::float8 as dlng
      from app.bookings where id = ${b.id}::uuid`;
    expect(stored).toBeDefined();
    const exact = new Set([
      stored?.plat ?? 0,
      stored?.plng ?? 0,
      stored?.dlat ?? 0,
      stored?.dlng ?? 0,
    ]);

    const visible = await getBooking(p, b.id);
    expect(visible.pickup.point).toEqual({ lat: stored?.plat, lng: stored?.plng });
    expect(visible.contact?.phoneE164).toBe(DRIVER_PHONE);

    // exactly 24 h after departure the window closes
    await sql`update app.rides set departure_at = now() - interval '25 hours' where id = ${ride.id}::uuid`;
    const hidden: [string, TestUser, string][] = [
      ['booking as passenger', p, `/bookings/${b.id}`],
      ['booking as driver', driver, `/bookings/${b.id}`],
      ['my bookings (past)', p, '/me/bookings?scope=past'],
      ['owner ride', driver, `/me/rides/${ride.id}`],
      ['public ride as passenger', p, `/rides/${ride.id}`],
    ];
    for (const [name, who, path] of hidden) {
      const res = await who.call(path);
      expect(res.status, name).toBe(200);
      const text = await res.text();
      const hits = pathsOfNumbers(withoutRoutes(text), exact);
      expect(hits, `${name} leaks exact numbers at ${hits.join(', ')}`).toEqual([]);
      if (who === p) {
        expect(text, name).not.toContain(DRIVER_PHONE);
        expect(text, name).not.toContain(PLATE);
      }
      if (who === driver) expect(text, name).not.toContain(PASSENGER_PHONE);
    }
    const view = bookingViewSchema.parse(await (await p.call(`/bookings/${b.id}`)).json());
    expect(view.pickup.point).toMatchObject({ approx: true });
    expect(view.contact).toBeNull();
    expect(view.car.plate).toBeNull();
    const owner = await ownerView(driver, ride.id);
    expect(owner.passengers[0]?.phoneE164).toBeNull();
    expect(owner.passengers[0]?.pickup.point).toMatchObject({ approx: true });
  });

  it('leak scan: no exact coordinate, phone or plate for requested, rejected, expired or cancelled bookings', async () => {
    const [driver, p, p2, p3, p4, stranger] = await Promise.all([
      user('Radu', DRIVER_PHONE),
      user('Ioana', PASSENGER_PHONE),
      user('Mara', '0766 111 000'),
      user('Dan', '0777 000 999'),
      user('Ana', '0788 000 111'),
      user('Vlad', '0755 222 333'),
    ]);
    const l = lane();
    const ride = await publish(driver, l, departure(), 3);
    const trip = middle(l);
    const bRequested = await book(p, ride.id, trip);
    const bRejected = await book(p2, ride.id, trip);
    const bCancelled = await book(p3, ride.id, trip);
    const bExpired = await book(p4, ride.id, trip);
    expect((await reject(driver, bRejected.id)).status).toBe(200);
    expect((await cancel(p3, bCancelled.id)).status).toBe(200);
    await sql`
      update app.bookings set requested_at = now() - interval '40 minutes',
                              expires_at = now() - interval '1 minute',
                              status = 'expired', passenger_event_at = now()
      where id = ${bExpired.id}::uuid`;

    const cases: [string, BookingView, TestUser][] = [
      ['requested', bRequested, p],
      ['rejected', bRejected, p2],
      ['cancelled', bCancelled, p3],
      ['expired', bExpired, p4],
    ];
    for (const [name, b, passenger] of cases) {
      const [stored] = await sql<{ a: number; b: number; c: number; d: number }[]>`
        select round(ST_Y(pickup)::numeric, 5)::float8 as a, round(ST_X(pickup)::numeric, 5)::float8 as b,
               round(ST_Y(dropoff)::numeric, 5)::float8 as c, round(ST_X(dropoff)::numeric, 5)::float8 as d
        from app.bookings where id = ${b.id}::uuid`;
      const exact = new Set([stored?.a ?? 0, stored?.b ?? 0, stored?.c ?? 0, stored?.d ?? 0]);
      const urls: [string, TestUser, string][] = [
        [`${name}: booking as passenger`, passenger, `/bookings/${b.id}`],
        [`${name}: booking as driver`, driver, `/bookings/${b.id}`],
        [`${name}: my bookings (upcoming)`, passenger, '/me/bookings?scope=upcoming'],
        [`${name}: my bookings (past)`, passenger, '/me/bookings?scope=past'],
        [`${name}: owner ride`, driver, `/me/rides/${ride.id}`],
        [`${name}: public ride as passenger`, passenger, `/rides/${ride.id}`],
        [`${name}: public ride as stranger`, stranger, `/rides/${ride.id}`],
      ];
      for (const [label, who, path] of urls) {
        const res = await who.call(path);
        expect(res.status, label).toBe(200);
        const text = await res.text();
        const hits = pathsOfNumbers(withoutRoutes(text), exact);
        expect(hits, `${label} leaks exact numbers at ${hits.join(', ')}`).toEqual([]);
        if (who !== driver) {
          expect(text, label).not.toContain(PLATE);
          expect(text, label).not.toContain(DRIVER_PHONE);
        }
        expect(text, label).not.toContain(PASSENGER_PHONE);
      }
      // a stranger cannot even see that the booking exists
      expect((await stranger.call(`/bookings/${b.id}`)).status, name).toBe(404);
    }
    // the owner view lists no request point for the one still open
    const owner = await ownerView(driver, ride.id);
    expect(JSON.stringify(owner.requests)).not.toMatch(/"(lat|lng|point)"/);
  });

  // ---- concurrency (ADR 0021) ----------------------------------------------------------------------------------

  describe('concurrency', () => {
    it('C1: 6 approvals race for 2 seats: exactly 2 succeed, 4 are RIDE_FULL (5 rounds)', async () => {
      const driver = await user('Radu', DRIVER_PHONE);
      const passengers = await Promise.all(
        ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => user(`Pass${n}`, '0721 000 000')),
      );
      for (let round = 0; round < 5; round++) {
        const l = lane();
        const ride = await publish(driver, l, departure(), 2);
        const bookings = await Promise.all(passengers.map((p) => book(p, ride.id, whole(l))));
        const results = await Promise.all(bookings.map((b) => approve(driver, b.id)));
        const codes = await Promise.all(
          results.map(async (r) => (r.status === 200 ? 'ok' : (await errorOf(r)).code)),
        );
        expect(
          codes.filter((c) => c === 'ok'),
          `round ${round}`,
        ).toHaveLength(2);
        expect(
          codes.filter((c) => c === 'RIDE_FULL'),
          `round ${round}`,
        ).toHaveLength(4);
        await assertInvariants(ride.id);
      }
    }, 180_000);

    it('C2: the same booking approved twice in parallel: one 200, one INVALID_STATE', async () => {
      const [driver, p] = await Promise.all([
        user('Radu', DRIVER_PHONE),
        user('Ioana', PASSENGER_PHONE),
      ]);
      const l = lane();
      const ride = await publish(driver, l, departure());
      const b = await book(p, ride.id, whole(l));
      const [x, y] = await Promise.all([approve(driver, b.id), approve(driver, b.id)]);
      const statuses = [x.status, y.status].sort();
      expect(statuses).toEqual([200, 409]);
      const failed = x.status === 409 ? x : y;
      expect((await errorOf(failed)).code).toBe('INVALID_STATE');
      await assertInvariants(ride.id);
      expect((await ownerView(driver, ride.id)).seatsBooked).toBe(1);
    });

    it('C3: approve racing a ride cancel never leaves a confirmed booking on a cancelled ride', async () => {
      for (let i = 0; i < 3; i++) {
        const [driver, p] = await Promise.all([
          user('Radu', DRIVER_PHONE),
          user('Ioana', PASSENGER_PHONE),
        ]);
        const l = lane();
        const ride = await publish(driver, l, departure());
        const b = await book(p, ride.id, whole(l));
        const [a, c] = await Promise.all([
          approve(driver, b.id),
          driver.send('POST', `/rides/${ride.id}/cancel`, {}),
        ]);
        expect(c.status).toBe(200);
        if (a.status !== 200) expect((await errorOf(a)).code).toBe('INVALID_STATE');
        const [row] = await sql<
          { status: string }[]
        >`select status::text from app.rides where id = ${ride.id}::uuid`;
        expect(row?.status).toBe('cancelled');
        const confirmed = await sql<{ n: number }[]>`
          select count(*)::int as n from app.bookings where ride_id = ${ride.id}::uuid and status = 'confirmed'`;
        expect(confirmed[0]?.n).toBe(0);
        expect(await statusOf(b.id)).toBe('cancelled');
        await assertInvariants(ride.id);
      }
    }, 120_000);

    it.skipIf(!CRON)(
      'C4: approve racing the tick on an expired request never confirms it',
      async () => {
        const [driver, p] = await Promise.all([
          user('Radu', DRIVER_PHONE),
          user('Ioana', PASSENGER_PHONE),
        ]);
        const l = lane();
        const ride = await publish(driver, l, departure());
        const b = await book(p, ride.id, whole(l));
        await sql`
        update app.bookings set requested_at = now() - interval '40 minutes',
                                expires_at = now() - interval '1 minute'
        where id = ${b.id}::uuid`;
        const [a, t] = await Promise.all([approve(driver, b.id), tick()]);
        expect(t.status).toBe(200);
        expect(a.status).toBe(409);
        expect((await errorOf(a)).code).toBe('REQUEST_EXPIRED');
        expect(await statusOf(b.id)).toBe('expired');
        await assertInvariants(ride.id);
      },
    );

    it('C5: a passenger cancel racing the approval of another booking keeps the counters exact', async () => {
      const [driver, p1, p2] = await Promise.all([
        user('Radu', DRIVER_PHONE),
        user('Ioana', PASSENGER_PHONE),
        user('Mara', '0766 111 000'),
      ]);
      const l = lane();
      const ride = await publish(driver, l, departure(), 2);
      const b1 = await book(p1, ride.id, whole(l));
      const b2 = await book(p2, ride.id, whole(l));
      await approveOk(driver, b1.id);
      const [c, a] = await Promise.all([cancel(p1, b1.id), approve(driver, b2.id)]);
      expect(c.status).toBe(200);
      expect(a.status).toBe(200);
      expect(await statusOf(b1.id)).toBe('cancelled');
      expect(await statusOf(b2.id)).toBe('confirmed');
      expect((await ownerView(driver, ride.id)).seatsBooked).toBe(1);
      await assertInvariants(ride.id);
    });

    it('C6: three parallel requests with the same key create one booking', async () => {
      const [driver, p] = await Promise.all([
        user('Radu', DRIVER_PHONE),
        user('Ioana', PASSENGER_PHONE),
      ]);
      const l = lane();
      const ride = await publish(driver, l, departure());
      const key = newKey();
      const results = await Promise.all(
        [1, 2, 3].map(() => requestSeat(p, ride.id, whole(l), key)),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
      const ids = new Set(
        await Promise.all(results.map(async (r) => bookingViewSchema.parse(await r.json()).id)),
      );
      expect(ids.size).toBe(1);
      const rows = await sql<{ n: number }[]>`
        select count(*)::int as n from app.bookings
        where ride_id = ${ride.id}::uuid and passenger_id = ${p.id}::uuid`;
      expect(rows[0]?.n).toBe(1);
      const requested = await sql<{ n: number }[]>`
        select count(*)::int as n from app.outbox where template = 'booking_requested' and user_id = ${driver.id}::uuid`;
      expect(requested[0]?.n).toBe(1);
    });
  });
});
