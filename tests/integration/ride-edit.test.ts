import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookingViewSchema } from '../../supabase/functions/_shared/contracts/bookings.ts';
import {
  previewResponseSchema,
  rideOwnerViewSchema,
} from '../../supabase/functions/_shared/contracts/rides.ts';
import {
  bucharestDayKey,
  bucharestLocalToUtc,
} from '../../supabase/functions/_shared/domain/time.ts';
import { BASE, DB_URL, SECRET, createUser, inMinutes, type TestUser } from './factories.ts';

/**
 * PATCH /rides/{id} against the real database (ADR 0041): the ride lock, the editable columns, the
 * expiry clamp of open requests, the daily limit on the new day and the `ride_updated` outbox rows
 * (who gets one, the dedupe key). Needs the local stack and the database as the local superuser (to read
 * app.outbox and app.bookings). Skipped without them. NOT run by the author (no Docker or Postgres where
 * this was written): CI runs it.
 *   INT_DB=skip  skips the whole file
 */
const DB_SKIP = process.env.INT_DB === 'skip';

type Point = { lat: number; lng: number };
type Lane = { from: Point; to: Point };
const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
function lane(): Lane {
  const lat = r5(45.7 + Math.random() * 0.14);
  const lng = r5(24.0 + Math.random() * 0.2);
  return { from: { lat, lng }, to: { lat: r5(lat + 0.008), lng: r5(lng + 0.05) } };
}
const lerp = (l: Lane, t: number): Point => ({
  lat: r5(l.from.lat + (l.to.lat - l.from.lat) * t),
  lng: r5(l.from.lng + (l.to.lng - l.from.lng) * t),
});
const middle = (l: Lane) => ({ from: lerp(l, 0.3), to: lerp(l, 0.8) });
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
/** `HH:00` Europe/Bucharest, `days` days from now. */
const slot = (days: number, hour: number): Date =>
  bucharestLocalToUtc(
    bucharestDayKey(new Date(Date.now() + days * 86_400_000)),
    `${String(hour).padStart(2, '0')}:00`,
  );

async function publish(driver: TestUser, l: Lane, at: Date | string, seats = 3) {
  const pRes = await driver.send('POST', '/rides/preview', { origin: l.from, destination: l.to });
  expect(pRes.status).toBe(200);
  const preview = previewResponseSchema.parse(await pRes.json());
  const res = await driver.send('POST', '/rides', {
    previewId: preview.previewId,
    departureAt: typeof at === 'string' ? at : iso(at),
    seats,
  });
  expect(res.status).toBe(201);
  return rideOwnerViewSchema.parse(await res.json());
}

async function book(p: TestUser, rideId: string, l: Lane) {
  const res = await p.call('/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ rideId, ...middle(l) }),
  });
  expect(res.status).toBe(201);
  return bookingViewSchema.parse(await res.json());
}

const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe.skipIf(!BASE || !SECRET || DB_SKIP)('editing a ride against the database', () => {
  let sql: postgres.Sql;
  beforeAll(() => {
    sql = postgres(DB_URL, { max: 2, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql.end();
  });

  type Row = {
    user_id: string;
    channel: string;
    template: string;
    dedupe_key: string | null;
    payload: Record<string, unknown>;
  };
  const updatedRows = async (rideId: string): Promise<Row[]> =>
    await sql<Row[]>`
      select user_id, channel, template, dedupe_key, payload from app.outbox
      where template = 'ride_updated' and payload ->> 'rideId' = ${rideId} and channel = 'email'
      order by created_at, user_id`;

  it('a time change tells the requested and confirmed passengers (not the cancelled one, not the driver) and clamps open requests', async () => {
    const driver = await createUser({ firstName: 'Radu' });
    const confirmed = await createUser({ firstName: 'Ioana' });
    const requested = await createUser({ firstName: 'Mihai' });
    const cancelled = await createUser({ firstName: 'Ana' });
    const outsider = await createUser({ firstName: 'Vlad' });
    const l = lane();
    const ride = await publish(driver, l, slot(3, 12));
    const bConfirmed = await book(confirmed, ride.id, l);
    expect((await driver.send('POST', `/bookings/${bConfirmed.id}/approve`, {})).status).toBe(200);
    const bRequested = await book(requested, ride.id, l);
    const bCancelled = await book(cancelled, ride.id, l);
    expect((await cancelled.send('POST', `/bookings/${bCancelled.id}/cancel`, {})).status).toBe(
      200,
    );

    // someone who does not drive the ride gets a plain 404, a passenger too
    expect((await outsider.send('PATCH', `/rides/${ride.id}`, { seats: 2 })).status).toBe(404);
    expect((await confirmed.send('PATCH', `/rides/${ride.id}`, { seats: 2 })).status).toBe(404);
    expect(await updatedRows(ride.id)).toHaveLength(0);

    const newDeparture = inMinutes(20);
    const res = await driver.send('PATCH', `/rides/${ride.id}`, { departureAt: newDeparture });
    expect(res.status).toBe(200);
    const view = rideOwnerViewSchema.parse(await res.json());
    expect(new Date(view.departureAt).getTime()).toBe(new Date(newDeparture).getTime());
    expect(view.canEdit).toBe(true);
    expect(view.passengers.map((p) => p.bookingId)).toEqual([bConfirmed.id]);

    const rows = await updatedRows(ride.id);
    expect(rows.map((r) => r.user_id).sort()).toEqual([confirmed.id, requested.id].sort());
    expect(rows.some((r) => r.user_id === driver.id || r.user_id === cancelled.id)).toBe(false);
    const mine = rows.find((r) => r.user_id === confirmed.id);
    expect(mine?.dedupe_key).toBe(`ride_updated:${bConfirmed.id}:${view.departureAt}`);
    expect(mine?.payload).toMatchObject({
      bookingId: bConfirmed.id,
      rideId: ride.id,
      driverFirstName: 'Radu',
      previousDepartureAt: ride.departureAt,
      departureAt: view.departureAt,
    });

    // the open request cannot outlive the new departure (departure - 10 minutes)
    const [req] = await sql<{ expires_at: Date }[]>`
      select expires_at from app.bookings where id = ${bRequested.id}`;
    expect(req?.expires_at.getTime()).toBeLessThanOrEqual(
      new Date(newDeparture).getTime() - 10 * 60_000,
    );

    // the same time again changes nothing and adds no row
    expect(
      (await driver.send('PATCH', `/rides/${ride.id}`, { departureAt: view.departureAt })).status,
    ).toBe(200);
    expect(await updatedRows(ride.id)).toHaveLength(2);
  });

  it('seats, note and auto-accept notify nobody; seats cannot go below the booked ones', async () => {
    const driver = await createUser({ firstName: 'Radu' });
    const passenger = await createUser({ firstName: 'Ioana' });
    const l = lane();
    const ride = await publish(driver, l, slot(4, 12));
    const booking = await book(passenger, ride.id, l);
    expect((await driver.send('POST', `/bookings/${booking.id}/approve`, {})).status).toBe(200);

    const res = await driver.send('PATCH', `/rides/${ride.id}`, {
      seats: 2,
      note: 'Meet at the gate',
      autoAccept: true,
    });
    expect(res.status).toBe(200);
    expect(rideOwnerViewSchema.parse(await res.json())).toMatchObject({
      seatsOffered: 2,
      seatsBooked: 1,
      note: 'Meet at the gate',
      autoAccept: true,
    });
    expect(await updatedRows(ride.id)).toHaveLength(0);

    const below = await driver.send('PATCH', `/rides/${ride.id}`, { seats: 1 });
    expect(below.status).toBe(200); // one seat is booked: 1 is allowed
    const zero = await driver.send('PATCH', `/rides/${ride.id}`, { seats: 0 });
    expect(zero.status).toBe(400);

    // a second passenger fills seat 1; going below 2 booked is refused
    const second = await createUser({ firstName: 'Mihai' });
    // auto-accept was switched on above: turn it off so the request stays pending for the manual approve
    expect(
      (await driver.send('PATCH', `/rides/${ride.id}`, { seats: 2, autoAccept: false })).status,
    ).toBe(200);
    const b2 = await book(second, ride.id, l);
    expect((await driver.send('POST', `/bookings/${b2.id}/approve`, {})).status).toBe(200);
    const refused = await driver.send('PATCH', `/rides/${ride.id}`, { seats: 1 });
    expect(refused.status).toBe(409);
    expect(await errorCode(refused)).toBe('SEATS_BELOW_BOOKED');
  });

  it('the route, price and vehicle are fixed, and a cancelled ride cannot be edited', async () => {
    const driver = await createUser({ firstName: 'Radu' });
    const ride = await publish(driver, lane(), slot(5, 12));
    const fixed = await driver.send('PATCH', `/rides/${ride.id}`, {
      seats: 2,
      origin: { lat: 45.74, lng: 24.1 },
    });
    expect(fixed.status).toBe(400);
    expect(await errorCode(fixed)).toBe('ROUTE_NOT_EDITABLE');
    expect((await driver.send('PATCH', `/rides/${ride.id}`, {})).status).toBe(400);

    const tooSoon = await driver.send('PATCH', `/rides/${ride.id}`, { departureAt: inMinutes(5) });
    expect(await errorCode(tooSoon)).toBe('DEPARTURE_TOO_SOON');

    expect((await driver.send('POST', `/rides/${ride.id}/cancel`, {})).status).toBe(200);
    const gone = await driver.send('PATCH', `/rides/${ride.id}`, { seats: 2 });
    expect(gone.status).toBe(409);
    expect(await errorCode(gone)).toBe('RIDE_NOT_EDITABLE');
  });

  it('the 4 rides a day still hold on the new day, without counting the moved ride itself', async () => {
    const driver = await createUser({ firstName: 'Radu' });
    const l = lane();
    for (const hour of [8, 9, 10, 11]) await publish(driver, l, slot(6, hour));
    const other = await publish(driver, l, slot(7, 12));

    const full = await driver.send('PATCH', `/rides/${other.id}`, {
      departureAt: iso(slot(6, 14)),
    });
    expect(full.status).toBe(409);
    expect(await errorCode(full)).toBe('DAILY_RIDE_LIMIT');

    // moving within its own day never counts against itself
    const sameDay = await driver.send('PATCH', `/rides/${other.id}`, {
      departureAt: iso(slot(7, 15)),
    });
    expect(sameDay.status).toBe(200);
  });
});
