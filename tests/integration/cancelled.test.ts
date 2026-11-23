import { describe, expect, it } from 'vitest';
import {
  bookingListResponseSchema,
  bookingViewSchema,
} from '../../supabase/functions/_shared/contracts/bookings.ts';
import {
  previewResponseSchema,
  rideListResponseSchema,
  rideOwnerViewSchema,
} from '../../supabase/functions/_shared/contracts/rides.ts';
import {
  bucharestDayKey,
  bucharestLocalToUtc,
} from '../../supabase/functions/_shared/domain/time.ts';
import { BASE, SECRET, createUser, type TestUser } from './factories.ts';

/**
 * Canceled tab (improvement 5) against the local stack (see api.test.ts for how to start it), with
 * ROUTING_PROVIDER=fixture. Skipped without the stack.
 *
 * Isolation proof: driver A publishes, passenger B books, A cancels the ride. A and B see the
 * cancelled ride and booking in `scope=cancelled`, never in `past`; outsider C sees neither, and a GET
 * by id answers 404. The app tables have RLS on with no policies and the API role bypasses it, so this
 * is the test that the `driver_id = me` / `passenger_id = me` scoping holds end to end.
 */
const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** A random straight lane the fixture router does not know, and a day 2 to 12 days ahead. */
function lane() {
  const lat = r5(45.7 + Math.random() * 0.14);
  const lng = r5(24.0 + Math.random() * 0.2);
  return { from: { lat, lng }, to: { lat: r5(lat + 0.008), lng: r5(lng + 0.05) } };
}
function departure(): Date {
  const day = bucharestDayKey(
    new Date(Date.now() + (2 + Math.floor(Math.random() * 11)) * 86_400_000),
  );
  return bucharestLocalToUtc(day, '11:00');
}

async function publish(driver: TestUser, l: ReturnType<typeof lane>, at: Date) {
  const p = await driver.send('POST', '/rides/preview', { origin: l.from, destination: l.to });
  expect(p.status).toBe(200);
  const preview = previewResponseSchema.parse(await p.json());
  const res = await driver.send('POST', '/rides', {
    previewId: preview.previewId,
    departureAt: iso(at),
    seats: 3,
  });
  expect(res.status).toBe(201);
  return rideOwnerViewSchema.parse(await res.json());
}

/** An onboarded user with their own phone (the factory gives everyone the same one). */
async function user(firstName: string, phone: string, vehicle = true): Promise<TestUser> {
  const u = await createUser(vehicle ? { firstName } : { firstName, vehicle: null });
  const res = await u.send('PATCH', '/me/profile', { phone });
  expect(res.status).toBe(200);
  return u;
}

async function rideIds(who: TestUser, scope: string): Promise<string[]> {
  const res = await who.call(`/me/rides?scope=${scope}&limit=50`);
  expect(res.status).toBe(200);
  return rideListResponseSchema.parse(await res.json()).items.map((i) => i.id);
}
async function bookingItems(who: TestUser, scope: string) {
  const res = await who.call(`/me/bookings?scope=${scope}&limit=50`);
  expect(res.status).toBe(200);
  return bookingListResponseSchema.parse(await res.json()).items;
}

describe.skipIf(!BASE || !SECRET)('canceled rides and bookings against the local stack', () => {
  it('A and B see the cancelled ride and booking, C sees nothing and gets 404 by id', async () => {
    const [a, b, c] = await Promise.all([
      user('Radu', '+40733111301'),
      user('Ioana', '+40744555302', false),
      user('Mihai', '+40755666303', false),
    ]);
    const l = lane();
    const ride = await publish(a, l, departure());

    // B requests a seat on the whole lane
    const bookRes = await b.call('/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ rideId: ride.id, from: l.from, to: l.to }),
    });
    expect(bookRes.status).toBe(201);
    const booking = bookingViewSchema.parse(await bookRes.json());

    // Before the cancel: the ride is upcoming for A, the booking upcoming for B, nothing cancelled.
    expect(await rideIds(a, 'upcoming')).toContain(ride.id);
    expect(await rideIds(a, 'cancelled')).not.toContain(ride.id);
    expect((await bookingItems(b, 'upcoming')).map((i) => i.id)).toContain(booking.id);
    expect((await bookingItems(b, 'cancelled')).map((i) => i.id)).not.toContain(booking.id);

    // A cancels the whole ride (no body, no reason: none is stored).
    const cancelRes = await a.send('POST', `/rides/${ride.id}/cancel`, {});
    expect(cancelRes.status).toBe(200);

    // A: in Cancelled with who and when, no longer in Past or Upcoming.
    const aRes = await a.call('/me/rides?scope=cancelled&limit=50');
    const aItems = rideListResponseSchema.parse(await aRes.json()).items;
    const mine = aItems.find((i) => i.id === ride.id);
    expect(mine).toMatchObject({ status: 'cancelled', cancelledBy: 'driver' });
    expect(mine?.cancelledAt).not.toBeNull();
    expect(await rideIds(a, 'past')).not.toContain(ride.id);
    expect(await rideIds(a, 'upcoming')).not.toContain(ride.id);

    // B: the booking is in Cancelled (cancelled by the driver), not in Past or Upcoming.
    const bItem = (await bookingItems(b, 'cancelled')).find((i) => i.id === booking.id);
    expect(bItem).toMatchObject({
      status: 'cancelled',
      rideStatus: 'cancelled',
      cancelledBy: 'driver',
    });
    expect(bItem?.cancelledAt).not.toBeNull();
    expect((await bookingItems(b, 'past')).map((i) => i.id)).not.toContain(booking.id);
    expect((await bookingItems(b, 'upcoming')).map((i) => i.id)).not.toContain(booking.id);

    // C (outsider): sees none of it, in any scope, and a GET by id is a plain 404.
    for (const scope of ['upcoming', 'past', 'cancelled']) {
      expect(await rideIds(c, scope)).not.toContain(ride.id);
      expect((await bookingItems(c, scope)).map((i) => i.id)).not.toContain(booking.id);
    }
    expect((await c.call(`/me/rides/${ride.id}`)).status).toBe(404);
    expect((await c.call(`/bookings/${booking.id}`)).status).toBe(404);

    // A passenger never sees the driver's list entry, and the driver never sees the passenger's one.
    expect(await rideIds(b, 'cancelled')).not.toContain(ride.id);
    expect((await bookingItems(a, 'cancelled')).map((i) => i.id)).not.toContain(booking.id);

    // Both A and B can still open their own record by id.
    expect((await a.call(`/me/rides/${ride.id}`)).status).toBe(200);
    expect((await b.call(`/bookings/${booking.id}`)).status).toBe(200);
  });

  it('rejects an unknown scope and needs a token', async () => {
    const u = await createUser({ vehicle: null });
    expect((await u.call('/me/rides?scope=archived')).status).toBe(400);
    expect((await u.call('/me/bookings?scope=archived')).status).toBe(400);
    expect((await fetch(`${BASE}/me/rides?scope=cancelled`)).status).toBe(401);
    expect((await fetch(`${BASE}/me/bookings?scope=cancelled`)).status).toBe(401);
  });
});
