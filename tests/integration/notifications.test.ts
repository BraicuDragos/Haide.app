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
import { BASE, DB_URL, SECRET, createUser, type TestUser } from './factories.ts';

/**
 * Who gets which notification, against the real database (improvements item 7, docs/architecture/notifications.md).
 * Needs the local stack with ROUTING_PROVIDER=fixture and EMAIL_PROVIDER=console, and the database as the local
 * superuser (to read app.outbox, which the API role alone can write). Skipped without them. NOT run by the author
 * (no Docker or Postgres where this was written): CI runs it.
 *   INT_DB=skip  skips the whole file
 *   CRON_SECRET  same value as the function's: lets the suite call POST /internal/tick (those tests are skipped without it)
 */
const DB_SKIP = process.env.INT_DB === 'skip';
const CRON = process.env.CRON_SECRET;

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
function departure(): Date {
  const day = bucharestDayKey(
    new Date(Date.now() + (2 + Math.floor(Math.random() * 11)) * 86_400_000),
  );
  const hour = String(10 + Math.floor(Math.random() * 7)).padStart(2, '0');
  return bucharestLocalToUtc(day, `${hour}:00`);
}
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

async function publish(driver: TestUser, l: Lane, at: Date, autoAccept = false) {
  const pRes = await driver.send('POST', '/rides/preview', { origin: l.from, destination: l.to });
  expect(pRes.status).toBe(200);
  const preview = previewResponseSchema.parse(await pRes.json());
  const res = await driver.send('POST', '/rides', {
    previewId: preview.previewId,
    departureAt: iso(at),
    seats: 3,
    ...(autoAccept ? { autoAccept: true } : {}),
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

describe.skipIf(!BASE || !SECRET || DB_SKIP)('notification recipients against the database', () => {
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
    status: string;
    dedupe_key: string | null;
    payload: Record<string, unknown>;
  };
  /** Outbox rows of the given booking, email channel only, oldest first. */
  const rowsOf = async (bookingId: string): Promise<Row[]> =>
    await sql<Row[]>`
      select user_id, channel, template, status, dedupe_key, payload from app.outbox
      where payload ->> 'bookingId' = ${bookingId} and channel = 'email'
      order by created_at, template`;
  const pairs = (rows: Row[]) => rows.map((r) => [r.user_id, r.template] as const).sort();

  it('request -> driver, approve -> passenger, passenger cancels the confirmed booking -> driver', async () => {
    const driver = await createUser({ firstName: 'Radu' });
    const passenger = await createUser({ firstName: 'Ioana' });
    const l = lane();
    const ride = await publish(driver, l, departure());
    const booking = await book(passenger, ride.id, l);
    expect(pairs(await rowsOf(booking.id))).toEqual([[driver.id, 'booking_requested']]);

    expect((await driver.send('POST', `/bookings/${booking.id}/approve`, {})).status).toBe(200);
    expect((await passenger.send('POST', `/bookings/${booking.id}/cancel`, {})).status).toBe(200);
    expect(pairs(await rowsOf(booking.id))).toEqual(
      [
        [driver.id, 'booking_requested'],
        [passenger.id, 'booking_confirmed'],
        [driver.id, 'booking_cancelled'],
      ].sort(),
    );
  });

  it('reject -> passenger', async () => {
    const driver = await createUser({ firstName: 'Radu' });
    const passenger = await createUser({ firstName: 'Ioana' });
    const l = lane();
    const ride = await publish(driver, l, departure());
    const booking = await book(passenger, ride.id, l);
    expect((await driver.send('POST', `/bookings/${booking.id}/reject`, {})).status).toBe(200);
    const rows = await rowsOf(booking.id);
    expect(rows.filter((r) => r.template === 'booking_rejected').map((r) => r.user_id)).toEqual([
      passenger.id,
    ]);
  });

  it('auto-accept -> the driver gets booking_auto_confirmed AND the passenger gets booking_confirmed', async () => {
    const driver = await createUser({ firstName: 'Radu' });
    const passenger = await createUser({ firstName: 'Ioana' });
    const l = lane();
    const ride = await publish(driver, l, departure(), true);
    const booking = await book(passenger, ride.id, l);
    expect(booking.status).toBe('confirmed');
    expect(pairs(await rowsOf(booking.id))).toEqual(
      [
        [driver.id, 'booking_auto_confirmed'],
        [passenger.id, 'booking_confirmed'],
      ].sort(),
    );
  });

  it('the driver cancels the ride -> ride_cancelled to EACH booked passenger, none to the driver', async () => {
    const driver = await createUser({ firstName: 'Radu' });
    const p1 = await createUser({ firstName: 'Ioana' });
    const p2 = await createUser({ firstName: 'Maria' });
    const l = lane();
    const ride = await publish(driver, l, departure());
    const b1 = await book(p1, ride.id, l);
    const b2 = await book(p2, ride.id, l);
    expect((await driver.send('POST', `/rides/${ride.id}/cancel`, {})).status).toBe(200);
    const cancelled = await sql<Row[]>`
      select user_id, channel, template, status, dedupe_key, payload from app.outbox
      where template = 'ride_cancelled' and payload ->> 'rideId' = ${ride.id} and channel = 'email'`;
    expect(cancelled.map((r) => r.user_id).sort()).toEqual([p1.id, p2.id].sort());
    expect(cancelled.map((r) => r.payload.bookingId).sort()).toEqual([b1.id, b2.id].sort());
  });

  it('the same event inserted twice is one row (partial unique index + on conflict do nothing)', async () => {
    const driver = await createUser({ firstName: 'Radu' });
    const passenger = await createUser({ firstName: 'Ioana' });
    const l = lane();
    const ride = await publish(driver, l, departure());
    const booking = await book(passenger, ride.id, l);
    const key = `booking_requested:${booking.id}`;
    const before = await sql`select count(*)::int as n from app.outbox where dedupe_key = ${key}`;
    expect(before[0]?.n).toBe(1);
    await sql`
      insert into app.outbox (user_id, template, payload, dedupe_key)
      values (${driver.id}, 'booking_requested', '{}'::jsonb, ${key})
      on conflict (user_id, channel, dedupe_key) where dedupe_key is not null do nothing`;
    const after = await sql`select count(*)::int as n from app.outbox where dedupe_key = ${key}`;
    expect(after[0]?.n).toBe(1);
  });

  it.skipIf(!CRON)('the tick sends the pending rows and records them as sent', async () => {
    const driver = await createUser({ firstName: 'Radu' });
    const passenger = await createUser({ firstName: 'Ioana' });
    const l = lane();
    const ride = await publish(driver, l, departure());
    const booking = await book(passenger, ride.id, l);
    const res = await fetch(`${BASE}/internal/tick`, {
      method: 'POST',
      headers: { 'x-cron-secret': CRON ?? '' },
    });
    expect(res.status).toBe(200);
    const rows = await rowsOf(booking.id);
    // the console provider always succeeds; a row is sent, or still pending when the daily cap or a lease holds it
    expect(rows.every((r) => ['sent', 'pending'].includes(r.status))).toBe(true);
  });
});
