import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bookingViewSchema,
  type BookingView,
} from '../../supabase/functions/_shared/contracts/bookings.ts';
import { errorEnvelopeSchema } from '../../supabase/functions/_shared/contracts/errors.ts';
import { publicUserSchema } from '../../supabase/functions/_shared/contracts/account.ts';
import {
  previewResponseSchema,
  rideOwnerViewSchema,
  type RideOwnerView,
} from '../../supabase/functions/_shared/contracts/rides.ts';
import {
  blocksResponseSchema,
  ratingGivenSchema,
  reportResponseSchema,
  shareLinkResponseSchema,
  sharedTripSchema,
} from '../../supabase/functions/_shared/contracts/safety.ts';
import { tickResponseSchema } from '../../supabase/functions/_shared/contracts/system.ts';
import {
  bucharestDayKey,
  bucharestLocalToUtc,
} from '../../supabase/functions/_shared/domain/time.ts';
import { BASE, SECRET, createUser, type TestUser } from './factories.ts';

/**
 * Black-box trust and safety tests against the local stack (e5-trust-safety-spec §10), with
 * ROUTING_PROVIDER=fixture and EMAIL_PROVIDER=console. Skipped without the stack. They need the
 * database directly to move time (a ride that already left, a completion time in the past, a rating
 * that has become visible) and to check invariants: connects as the local superuser.
 *   INT_DB_URL   default postgresql://postgres:postgres@127.0.0.1:54322/postgres
 *   INT_DB=skip  skips the whole file
 *   CRON_SECRET  same value as the function's: lets the suite call POST /internal/tick (the tests that
 *                run the tick, and so the concurrency suite, are skipped without it)
 *
 * Isolation: every scenario publishes on its OWN random lane on a random day with freshly created
 * users and asserts only on what it created.
 */
const DB_URL = process.env.INT_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DB_SKIP = process.env.INT_DB === 'skip';
const CRON = process.env.CRON_SECRET;
const DRIVER_PHONE = '+40733111222';
const PASSENGER_PHONE = '+40744555666';

type Point = { lat: number; lng: number };
type Lane = { from: Point; to: Point };
type Trip = { from: Point; to: Point };

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
const middle = (l: Lane): Trip => ({ from: lerp(l, 0.3), to: lerp(l, 0.8) });

function departure(): Date {
  const day = bucharestDayKey(
    new Date(Date.now() + (2 + Math.floor(Math.random() * 11)) * 86_400_000),
  );
  const hour = String(10 + Math.floor(Math.random() * 7)).padStart(2, '0');
  return bucharestLocalToUtc(day, `${hour}:00`);
}
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;

async function publish(driver: TestUser, l: Lane, at: Date, seats = 3): Promise<RideOwnerView> {
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

async function user(firstName: string, phone: string): Promise<TestUser> {
  const u = await createUser({ firstName });
  expect((await u.send('PATCH', '/me/profile', { phone })).status).toBe(200);
  return u;
}

function requestSeat(p: TestUser, rideId: string, trip: Trip) {
  return p.call('/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ rideId, ...trip }),
  });
}

const getBooking = async (who: TestUser, id: string): Promise<BookingView> => {
  const res = await who.call(`/bookings/${id}`);
  expect(res.status).toBe(200);
  return bookingViewSchema.parse(await res.json());
};
const getProfile = async (who: TestUser, id: string) => {
  const res = await who.call(`/users/${id}`);
  expect(res.status).toBe(200);
  return publicUserSchema.parse(await res.json());
};

const tick = async () => {
  const res = await fetch(`${BASE}/internal/tick`, {
    method: 'POST',
    headers: { 'x-cron-secret': CRON ?? '' },
  });
  expect(res.status).toBe(200);
  return tickResponseSchema.parse(await res.json());
};
const noShow = (who: TestUser, bookingId: string) =>
  who.send('POST', `/bookings/${bookingId}/no-show`, {});
const rate = (who: TestUser, bookingId: string, stars: number, tags: string[] = []) =>
  who.send('POST', `/bookings/${bookingId}/ratings`, { stars, tags });

describe.skipIf(!BASE || !SECRET || DB_SKIP)('trust and safety against the local stack', () => {
  let sql: postgres.Sql;
  beforeAll(() => {
    sql = postgres(DB_URL, { max: 6, connect_timeout: 15, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  // ---- time machine and invariants (factory helpers, spec §10) ----------------------------------------------------

  /** The ride left `minutesAgo` minutes ago. */
  const departRide = async (rideId: string, minutesAgo: number) => {
    await sql`update app.rides set departure_at = now() - make_interval(mins => ${minutesAgo}::int) where id = ${rideId}::uuid`;
  };
  /** The ride was completed `minutesAgo` minutes ago (moves the rating window). */
  const setCompletedAt = async (rideId: string, minutesAgo: number) => {
    await sql`update app.rides set completed_at = now() - make_interval(mins => ${minutesAgo}::int) where id = ${rideId}::uuid`;
  };
  /** The tick resolves email addresses through auth.users: give a test user a row there. */
  const withAuthRow = async (u: TestUser) => {
    await sql`
      insert into auth.users (id, instance_id, aud, role, email)
      values (${u.id}::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${u.email})
      on conflict (id) do nothing`;
  };

  /** The accepted-seat invariant after every case: seats_booked = count(confirmed, completed, no_show). */
  async function assertSeats(rideId: string) {
    const [row] = await sql<{ seats_booked: number; accepted: number }[]>`
      select r.seats_booked,
             (select count(*)::int from app.bookings b
               where b.ride_id = r.id and b.status in ('confirmed', 'completed', 'no_show')) as accepted
      from app.rides r where r.id = ${rideId}::uuid`;
    expect(row?.seats_booked).toBe(row?.accepted);
  }
  const bookingRow = async (id: string) =>
    (
      await sql<
        {
          status: string;
          final_price_bani: number | null;
          price_locked_bani: number | null;
          cancelled_by: string | null;
          late_cancel: boolean;
        }[]
      >`
        select status::text, final_price_bani, price_locked_bani, cancelled_by, late_cancel
        from app.bookings where id = ${id}::uuid`
    )[0];
  const rideStatus = async (id: string) =>
    (await sql<{ status: string }[]>`select status::text from app.rides where id = ${id}::uuid`)[0]
      ?.status;
  const count = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;

  /** A published ride with one confirmed booking, in the future. */
  async function confirmed(driverName = 'Radu', passengerName = 'Ioana') {
    const [driver, p] = await Promise.all([
      user(driverName, DRIVER_PHONE),
      user(passengerName, PASSENGER_PHONE),
    ]);
    const l = lane();
    const ride = await publish(driver, l, departure());
    const res = await requestSeat(p, ride.id, middle(l));
    expect(res.status).toBe(201);
    const b = bookingViewSchema.parse(await res.json());
    expect((await driver.send('POST', `/bookings/${b.id}/approve`, {})).status).toBe(200);
    return { driver, p, l, ride, bookingId: b.id };
  }

  /** A confirmed booking whose ride has been completed by the tick. */
  async function completed() {
    const c = await confirmed();
    await Promise.all([withAuthRow(c.driver), withAuthRow(c.p)]);
    await departRide(c.ride.id, 125);
    await tick();
    expect(await rideStatus(c.ride.id)).toBe('completed');
    return c;
  }

  // ---- completion via the tick ---------------------------------------------------------------------------------------

  it.skipIf(!CRON)(
    'the tick completes a ride 2 h after departure: final price, prompts, analytics',
    async () => {
      const c = await confirmed();
      await Promise.all([withAuthRow(c.driver), withAuthRow(c.p)]);

      await departRide(c.ride.id, 119); // 1 h 59: too recent
      await tick();
      expect(await rideStatus(c.ride.id)).toBe('published');

      await departRide(c.ride.id, 121);
      const out = await tick();
      expect(out.completed).toBeGreaterThanOrEqual(1);
      expect(await rideStatus(c.ride.id)).toBe('completed');

      const row = await bookingRow(c.bookingId);
      expect(row?.status).toBe('completed');
      expect(row?.final_price_bani).toBe(row?.price_locked_bani);
      const view = await getBooking(c.p, c.bookingId);
      expect(view.completedAt).not.toBeNull();
      expect(view.price.finalBani).toBe(row?.price_locked_bani);
      expect(view.actions).toMatchObject({ canRate: true, canCancel: false });
      expect(view.rating).toMatchObject({ given: null });
      const owner = rideOwnerViewSchema.parse(
        await (await c.driver.call(`/me/rides/${c.ride.id}`)).json(),
      );
      expect(owner.completedAt).not.toBeNull();
      expect(owner.passengers[0]).toMatchObject({ status: 'completed', canRate: true });

      // rating prompts: one per passenger booking, one for the driver, and the analytics event
      expect(
        await count(sql`select count(*)::int as n from app.outbox
        where template = 'rating_prompt' and user_id = ${c.p.id}::uuid and payload ->> 'bookingId' = ${c.bookingId}`),
      ).toBe(1);
      expect(
        await count(sql`select count(*)::int as n from app.outbox
        where template = 'rating_prompt_driver' and user_id = ${c.driver.id}::uuid and payload ->> 'rideId' = ${c.ride.id}`),
      ).toBe(1);
      expect(
        await count(sql`select count(*)::int as n from app.analytics_events
        where name = 'ride_completed' and user_id = ${c.driver.id}::uuid and props ->> 'rideId' = ${c.ride.id}`),
      ).toBe(1);
      await assertSeats(c.ride.id);

      // idempotent: a second tick changes nothing
      await tick();
      expect(
        await count(
          sql`select count(*)::int as n from app.outbox where template = 'rating_prompt' and user_id = ${c.p.id}::uuid`,
        ),
      ).toBe(1);
    },
  );

  it.skipIf(!CRON)('a ride with no accepted booking expires instead of completing', async () => {
    const driver = await user('Radu', DRIVER_PHONE);
    const ride = await publish(driver, lane(), departure());
    await departRide(ride.id, 130);
    await tick();
    expect(await rideStatus(ride.id)).toBe('expired');
  });

  // ---- no-show ---------------------------------------------------------------------------------------------------------

  it('a driver marks a no-show: window, state, reliability event, no second report', async () => {
    const c = await confirmed();

    // before departure: the window is closed
    const early = await noShow(c.driver, c.bookingId);
    expect(early.status).toBe(409);
    expect((await errorOf(early)).code).toBe('WINDOW_CLOSED');

    await departRide(c.ride.id, 5);
    const view = await getBooking(c.p, c.bookingId);
    expect(view.actions).toMatchObject({ canReportDriverNoShow: true, show112: true });
    expect(await getBooking(c.driver, c.bookingId)).toMatchObject({
      actions: { canMarkNoShow: true },
    });

    const res = await noShow(c.driver, c.bookingId);
    expect(res.status).toBe(200);
    const owner = rideOwnerViewSchema.parse(await res.json());
    expect(owner.passengers[0]).toMatchObject({
      status: 'no_show',
      noShowBy: 'driver',
      canMarkNoShow: false,
    });

    const after = await getBooking(c.p, c.bookingId);
    expect(after).toMatchObject({ status: 'no_show', noShowBy: 'driver' });
    expect(after.price.finalBani).toBeNull();
    expect((await bookingRow(c.bookingId))?.final_price_bani).toBeNull();
    expect((await getProfile(c.driver, c.p.id)).noShows90d).toBe(1);
    expect(
      await count(sql`select count(*)::int as n from app.outbox
        where template = 'no_show_reported' and user_id = ${c.p.id}::uuid`),
    ).toBe(1);

    const again = await noShow(c.driver, c.bookingId);
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('INVALID_STATE');
    expect((await getProfile(c.driver, c.p.id)).noShows90d).toBe(1); // counted once
    await assertSeats(c.ride.id);
  });

  it('a passenger reports that the driver did not show: the driver gets the reliability event', async () => {
    const c = await confirmed();
    await departRide(c.ride.id, 30);
    const res = await noShow(c.p, c.bookingId);
    expect(res.status).toBe(200);
    expect(bookingViewSchema.parse(await res.json())).toMatchObject({
      status: 'no_show',
      noShowBy: 'passenger',
    });
    expect((await getProfile(c.p, c.driver.id)).noShows90d).toBe(1);
    expect((await getProfile(c.driver, c.p.id)).noShows90d).toBe(0);
    await assertSeats(c.ride.id);
  });

  it('a stranger gets 404 on no-show, rating and share link', async () => {
    const c = await confirmed();
    const stranger = await user('Mihai', '0722 000 111');
    expect((await noShow(stranger, c.bookingId)).status).toBe(404);
    expect((await rate(stranger, c.bookingId, 5)).status).toBe(404);
    expect((await stranger.send('POST', `/bookings/${c.bookingId}/share-link`, {})).status).toBe(
      404,
    );
  });

  // ---- ratings -----------------------------------------------------------------------------------------------------------

  it.skipIf(!CRON)(
    'ratings: tags per role, duplicate, blind until both rated, window, no no-show afterwards',
    async () => {
      const c = await completed();

      // a confirmed booking cannot be rated yet; wrong or duplicate tags are validation errors
      const wrong = await rate(c.p, c.bookingId, 5, ['respectful']); // a passenger rates a driver
      expect(wrong.status).toBe(400);
      expect((await errorOf(wrong)).fields).toEqual({ tags: 'invalid' });
      expect((await rate(c.p, c.bookingId, 5, ['punctual', 'punctual'])).status).toBe(400);
      expect((await rate(c.p, c.bookingId, 0)).status).toBe(400);

      const first = await rate(c.p, c.bookingId, 5, ['clean_car', 'punctual']);
      expect(first.status).toBe(201);
      expect(ratingGivenSchema.parse(await first.json())).toMatchObject({
        stars: 5,
        tags: ['clean_car', 'punctual'],
      });

      // blind: stored, but not visible to anybody yet (visible_at = completion + 7 d)
      const [stored] = await sql<{ visible_at: Date; completed_at: Date }[]>`
      select x.visible_at, r.completed_at from app.ratings x
      join app.bookings b on b.id = x.booking_id join app.rides r on r.id = b.ride_id
      where x.booking_id = ${c.bookingId}::uuid`;
      expect(stored?.visible_at.getTime()).toBe(
        (stored?.completed_at.getTime() ?? 0) + 7 * 86_400_000,
      );
      expect(
        await count(
          sql`select count(*)::int as n from app.ratings where ratee_id = ${c.driver.id}::uuid and visible_at <= now()`,
        ),
      ).toBe(0);

      // the booking shows only the viewer's own rating, and the passenger cannot rate twice
      expect((await getBooking(c.p, c.bookingId)).rating.given).toMatchObject({ stars: 5 });
      expect((await getBooking(c.driver, c.bookingId)).rating.given).toBeNull();
      const dup = await rate(c.p, c.bookingId, 4);
      expect(dup.status).toBe(409);
      expect((await errorOf(dup)).code).toBe('ALREADY_RATED');

      // a no-show is refused once a rating exists
      const ns = await noShow(c.driver, c.bookingId);
      expect(ns.status).toBe(409);
      expect((await errorOf(ns)).code).toBe('INVALID_STATE');

      // the driver rates back: both become visible together
      const back = await rate(c.driver, c.bookingId, 4, ['respectful']);
      expect(back.status).toBe(201);
      expect(
        await count(
          sql`select count(*)::int as n from app.ratings where booking_id = ${c.bookingId}::uuid and visible_at <= now()`,
        ),
      ).toBe(2);
      expect(
        await count(
          sql`select count(*)::int as n from app.ratings where ratee_id = ${c.p.id}::uuid and visible_at <= now()`,
        ),
      ).toBe(1);
    },
  );

  it.skipIf(!CRON)(
    'ratings: one side plus day 7 becomes visible; the window closes at 7 days',
    async () => {
      const c = await completed();
      expect((await rate(c.p, c.bookingId, 3)).status).toBe(201);
      // Day 7 arrives: the stored visible_at has passed.
      await sql`update app.ratings set visible_at = now() - interval '1 second' where booking_id = ${c.bookingId}::uuid`;
      expect(
        await count(
          sql`select count(*)::int as n from app.ratings where ratee_id = ${c.driver.id}::uuid and visible_at <= now()`,
        ),
      ).toBe(1);

      // a second booking whose window is over
      const old = await completed();
      await setCompletedAt(old.ride.id, 7 * 24 * 60 + 1);
      const late = await rate(old.p, old.bookingId, 5);
      expect(late.status).toBe(409);
      expect((await errorOf(late)).code).toBe('WINDOW_CLOSED');
      expect(await getBooking(old.p, old.bookingId)).toMatchObject({ actions: { canRate: false } });

      // an unfinished booking cannot be rated at all
      const open = await confirmed();
      const notDone = await rate(open.p, open.bookingId, 5);
      expect((await errorOf(notDone)).code).toBe('INVALID_STATE');
    },
  );

  it.skipIf(!CRON)(
    'the public rating only counts visible ratings, across profile and the list of rides',
    async () => {
      const driver = await user('Radu', DRIVER_PHONE);
      const rides: { p: TestUser; bookingId: string; rideId: string }[] = [];
      for (let i = 0; i < 3; i += 1) {
        const p = await user(`Pas${String.fromCharCode(97 + i)}`, PASSENGER_PHONE);
        const l = lane();
        const ride = await publish(driver, l, departure());
        const b = bookingViewSchema.parse(await (await requestSeat(p, ride.id, middle(l))).json());
        expect((await driver.send('POST', `/bookings/${b.id}/approve`, {})).status).toBe(200);
        rides.push({ p, bookingId: b.id, rideId: ride.id });
      }
      await withAuthRow(driver);
      for (const r of rides) {
        await withAuthRow(r.p);
        await departRide(r.rideId, 125);
      }
      await tick();
      for (const r of rides)
        expect((await rate(r.p, r.bookingId, 5, ['punctual'])).status).toBe(201);
      // three stored ratings, none visible: the profile shows no rating yet
      expect((await getProfile(rides[0]?.p as TestUser, driver.id)).rating).toBeNull();

      for (const r of rides) expect((await rate(driver, r.bookingId, 4)).status).toBe(201);
      const seen = await getProfile(rides[0]?.p as TestUser, driver.id);
      expect(seen.rating).toMatchObject({ count: 3, average: 5 });
      expect(seen.ridesCompleted).toBe(3);
    },
  );

  // ---- reports -----------------------------------------------------------------------------------------------------------

  it('reports: validation, parties, snapshot, admin email, alsoBlock', async () => {
    const c = await confirmed();
    const stranger = await user('Mihai', '0722 000 111');
    const body = {
      reportedUserId: c.driver.id,
      reason: 'unsafe_driving',
      details: 'Braked hard',
      bookingId: c.bookingId,
    };

    const self = await c.p.send('POST', '/reports', { ...body, reportedUserId: c.p.id });
    expect(self.status).toBe(400);
    expect((await errorOf(self)).fields).toEqual({ reportedUserId: 'self' });
    expect(
      (
        await c.p.send('POST', '/reports', {
          reportedUserId: crypto.randomUUID(),
          reason: 'harassment',
        })
      ).status,
    ).toBe(404);
    const noDetails = await c.p.send('POST', '/reports', {
      reportedUserId: c.driver.id,
      reason: 'other',
    });
    expect((await errorOf(noDetails)).fields).toEqual({ details: 'required' });
    // a booking the reporter is not part of
    expect((await stranger.send('POST', '/reports', body)).status).toBe(404);
    expect(
      (await c.p.send('POST', '/reports', { ...body, reportedUserId: stranger.id })).status,
    ).toBe(404);

    // an active admin is told (the reported user never is)
    const admin = await user('Admin', '0722 111 000');
    await sql`update app.profiles set role = 'admin' where id = ${admin.id}::uuid`;
    const ok = await c.p.send('POST', '/reports', body);
    expect(ok.status).toBe(201);
    const { id } = reportResponseSchema.parse(await ok.json());
    const [report] = await sql<
      {
        reported_snapshot: { firstName: string; phoneE164: string };
        ride_id: string;
        status: string;
      }[]
    >`
      select reported_snapshot, ride_id, status::text from app.reports where id = ${id}::uuid`;
    expect(report?.reported_snapshot).toEqual({ firstName: 'Radu', phoneE164: DRIVER_PHONE });
    expect(report?.ride_id).toBe(c.ride.id);
    expect(report?.status).toBe('open');
    const mail = await sql<{ payload: Record<string, string> }[]>`
      select payload from app.outbox where template = 'report_received' and user_id = ${admin.id}::uuid`;
    expect(mail.map((m) => m.payload)).toContainEqual({ reportId: id, reason: 'unsafe_driving' });
    expect(JSON.stringify(mail)).not.toContain('Braked');
    expect(
      await count(
        sql`select count(*)::int as n from app.outbox where user_id = ${c.driver.id}::uuid and template = 'report_received'`,
      ),
    ).toBe(0);

    // alsoBlock: the report and the block, and the booking between them is cancelled
    const both = await c.p.send('POST', '/reports', { ...body, alsoBlock: true });
    expect(both.status).toBe(201);
    expect(
      await count(
        sql`select count(*)::int as n from app.blocks where blocker_id = ${c.p.id}::uuid and blocked_id = ${c.driver.id}::uuid`,
      ),
    ).toBe(1);
    expect((await bookingRow(c.bookingId))?.status).toBe('cancelled');
  });

  // ---- blocks ------------------------------------------------------------------------------------------------------------

  it('a block by the passenger cancels the confirmed booking: seat freed, no late flag, no reliability event', async () => {
    const c = await confirmed();
    expect((await c.p.send('POST', '/blocks', { userId: c.driver.id })).status).toBe(204);
    expect((await c.p.send('POST', '/blocks', { userId: c.driver.id })).status).toBe(204); // idempotent

    const row = await bookingRow(c.bookingId);
    expect(row).toMatchObject({ status: 'cancelled', cancelled_by: 'system', late_cancel: false });
    expect(
      await count(
        sql`select count(*)::int as n from app.reliability_events where booking_id = ${c.bookingId}::uuid`,
      ),
    ).toBe(0);
    expect(
      await count(
        sql`select count(*)::int as n from app.outbox where user_id = ${c.driver.id}::uuid and template = 'booking_cancelled' and payload ->> 'bookingId' = ${c.bookingId}`,
      ),
    ).toBe(1);
    const owner = rideOwnerViewSchema.parse(
      await (await c.driver.call(`/me/rides/${c.ride.id}`)).json(),
    );
    expect(owner.seatsBooked).toBe(0);
    await assertSeats(c.ride.id);

    const view = await getBooking(c.p, c.bookingId);
    expect(view).toMatchObject({ status: 'cancelled', cancelledBy: 'system' });

    // the list shows outgoing blocks only; the blocked driver sees nothing
    const list = blocksResponseSchema.parse(await (await c.p.call('/me/blocks')).json());
    expect(list.items.map((i) => i.user.id)).toEqual([c.driver.id]);
    expect(
      blocksResponseSchema.parse(await (await c.driver.call('/me/blocks')).json()).items,
    ).toEqual([]);

    // new requests are refused either way until unblocked; unblocking restores nothing
    const l = c.l;
    expect((await errorOf(await requestSeat(c.p, c.ride.id, middle(l)))).code).toBe('BLOCKED');
    expect((await c.p.send('DELETE', `/blocks/${c.driver.id}`)).status).toBe(204);
    expect((await c.p.send('DELETE', `/blocks/${c.driver.id}`)).status).toBe(204); // idempotent
    expect(blocksResponseSchema.parse(await (await c.p.call('/me/blocks')).json()).items).toEqual(
      [],
    );
    expect((await bookingRow(c.bookingId))?.status).toBe('cancelled');
    expect((await c.p.send('DELETE', '/blocks/not-a-uuid')).status).toBe(400);
  });

  it('a block by the driver rejects the passenger, who is emailed and sees the update', async () => {
    const c = await confirmed();
    expect((await c.driver.send('POST', '/blocks', { userId: c.p.id })).status).toBe(204);
    expect((await bookingRow(c.bookingId))?.status).toBe('cancelled');
    expect(
      await count(
        sql`select count(*)::int as n from app.outbox where user_id = ${c.p.id}::uuid and template = 'booking_rejected' and payload ->> 'bookingId' = ${c.bookingId}`,
      ),
    ).toBe(1);
    expect((await getBooking(c.p, c.bookingId)).unseen).toBe(true);
    await assertSeats(c.ride.id);
    const self = await c.p.send('POST', '/blocks', { userId: c.p.id });
    expect((await errorOf(self)).fields).toEqual({ userId: 'self' });
    expect((await c.p.send('POST', '/blocks', { userId: crypto.randomUUID() })).status).toBe(404);
  });

  // ---- suspension --------------------------------------------------------------------------------------------------------

  it.skipIf(!CRON)(
    'a suspended passenger is blocked at the gates and the tick cancels their bookings',
    async () => {
      const c = await confirmed();
      await Promise.all([withAuthRow(c.driver), withAuthRow(c.p)]);
      await sql`select app.admin_suspend_user(${c.p.id}::uuid, 'test')`;

      const gate = await c.p.call('/me/bookings');
      expect(gate.status).toBe(403);
      expect((await errorOf(gate)).code).toBe('ACCOUNT_SUSPENDED');
      expect((await c.p.send('POST', '/blocks', { userId: c.driver.id })).status).toBe(403);

      const out = await tick();
      expect(out.swept).toBeGreaterThanOrEqual(1);
      expect(await bookingRow(c.bookingId)).toMatchObject({
        status: 'cancelled',
        cancelled_by: 'system',
        late_cancel: false,
      });
      await assertSeats(c.ride.id);
      expect(
        await count(
          sql`select count(*)::int as n from app.reliability_events where booking_id = ${c.bookingId}::uuid`,
        ),
      ).toBe(0);
    },
  );

  it.skipIf(!CRON)(
    'a suspended driver: future rides are cancelled by the system and passengers told neutrally',
    async () => {
      const c = await confirmed();
      await Promise.all([withAuthRow(c.driver), withAuthRow(c.p)]);
      await sql`select app.admin_suspend_user(${c.driver.id}::uuid, 'test')`;

      expect(
        (
          await errorOf(
            await c.driver.send('POST', '/rides/preview', {
              origin: c.l.from,
              destination: c.l.to,
            }),
          )
        ).code,
      ).toBe('ACCOUNT_SUSPENDED');
      await tick();
      expect(await rideStatus(c.ride.id)).toBe('cancelled');
      const view = await getBooking(c.p, c.bookingId);
      expect(view).toMatchObject({
        status: 'cancelled',
        rideStatus: 'cancelled',
        cancelledBy: 'system',
      });
      expect(view.timeline.at(-1)?.status).toBe('ride_cancelled');
      const [mail] = await sql<{ payload: Record<string, string> }[]>`
      select payload from app.outbox where user_id = ${c.p.id}::uuid and template = 'ride_cancelled'`;
      expect(mail?.payload.by).toBe('system');
      expect(
        await count(
          sql`select count(*)::int as n from app.reliability_events where ride_id = ${c.ride.id}::uuid`,
        ),
      ).toBe(0);
      // the ride is gone for everybody else
      const stranger = await user('Mihai', '0722 000 111');
      expect((await stranger.call(`/rides/${c.ride.id}`)).status).toBe(404);
    },
  );

  // ---- share link --------------------------------------------------------------------------------------------------------

  it('share link: create, public page without leaks, rotate, revoke, expire, cancel', async () => {
    const c = await confirmed('Radu', 'Ioana');
    expect((await c.driver.send('POST', `/bookings/${c.bookingId}/share-link`, {})).status).toBe(
      404,
    ); // passenger only

    const res = await c.p.send('POST', `/bookings/${c.bookingId}/share-link`, {});
    expect(res.status).toBe(201);
    const link = shareLinkResponseSchema.parse(await res.json());
    const token = link.url.split('/s/')[1] as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await getBooking(c.p, c.bookingId)).toMatchObject({
      share: { active: true },
      actions: { canShare: true },
    });
    expect((await getBooking(c.driver, c.bookingId)).share).toBeNull();

    // the public page: no sign-in, hardening headers, only what the passenger already sees
    const page = await fetch(`${BASE}/share/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('x-robots-tag')).toContain('noindex');
    const text = await page.text();
    const trip = sharedTripSchema.parse(JSON.parse(text));
    expect(trip).toMatchObject({
      phase: 'before',
      driver: { firstName: 'Radu' },
      car: { plate: 'SB12ABC' },
    });
    expect(text).not.toContain(DRIVER_PHONE);
    expect(text).not.toContain(PASSENGER_PHONE);
    expect(text).not.toContain('Ioana');
    expect(text).not.toContain(c.p.id);
    // leak scan: the route is the passenger's own segment, not the driver's start or end
    const own = (await getBooking(c.p, c.bookingId)).route;
    expect(trip.route?.coordinates).toEqual(own?.coordinates);
    expect(text).not.toContain(String(c.ride.origin.point.lat));
    expect(text).not.toContain(String(c.ride.destination.point.lat));

    // rotation: the old token dies, the new one lives
    const second = shareLinkResponseSchema.parse(
      await (await c.p.send('POST', `/bookings/${c.bookingId}/share-link`, {})).json(),
    );
    const token2 = second.url.split('/s/')[1] as string;
    expect(token2).not.toBe(token);
    expect((await fetch(`${BASE}/share/${token}`)).status).toBe(404);
    expect((await fetch(`${BASE}/share/${token2}`)).status).toBe(200);

    // expiry at departure + 24 h
    await sql`update app.share_links set created_at = now() - interval '1 hour', expires_at = now() - interval '1 second' where booking_id = ${c.bookingId}::uuid`;
    expect((await fetch(`${BASE}/share/${token2}`)).status).toBe(404);
    await sql`update app.share_links set expires_at = now() + interval '1 hour' where booking_id = ${c.bookingId}::uuid`;
    expect((await fetch(`${BASE}/share/${token2}`)).status).toBe(200);

    // malformed and unknown tokens
    expect((await fetch(`${BASE}/share/short`)).status).toBe(404);
    expect((await fetch(`${BASE}/share/${'A'.repeat(22)}`)).status).toBe(404);

    // the booking is cancelled: the page is gone, and a new link cannot be made
    expect((await c.p.send('POST', `/bookings/${c.bookingId}/cancel`, {})).status).toBe(200);
    expect((await fetch(`${BASE}/share/${token2}`)).status).toBe(404);
    expect(
      (await errorOf(await c.p.send('POST', `/bookings/${c.bookingId}/share-link`, {}))).code,
    ).toBe('INVALID_STATE');
  });

  it('share link: revoke is idempotent and kills the page', async () => {
    const c = await confirmed();
    const link = shareLinkResponseSchema.parse(
      await (await c.p.send('POST', `/bookings/${c.bookingId}/share-link`, {})).json(),
    );
    const token = link.url.split('/s/')[1] as string;
    expect((await c.p.send('DELETE', `/bookings/${c.bookingId}/share-link`)).status).toBe(204);
    expect((await c.p.send('DELETE', `/bookings/${c.bookingId}/share-link`)).status).toBe(204);
    expect((await fetch(`${BASE}/share/${token}`)).status).toBe(404);
    expect((await c.driver.send('DELETE', `/bookings/${c.bookingId}/share-link`)).status).toBe(404);
    expect((await getBooking(c.p, c.bookingId)).share).toMatchObject({ active: false });
  });

  it('Call 112: the window is computed by the server', async () => {
    const c = await confirmed();
    const before = await getBooking(c.p, c.bookingId);
    expect(before.actions.show112).toBe(false);
    expect(before.actions.call112Window).not.toBeNull();
    await departRide(c.ride.id, -10); // departs in 10 minutes: inside the 15 minute lead
    expect((await getBooking(c.p, c.bookingId)).actions.show112).toBe(true);
    expect(
      rideOwnerViewSchema.parse(await (await c.driver.call(`/me/rides/${c.ride.id}`)).json())
        .show112,
    ).toBe(true);
    await departRide(c.ride.id, 121); // 2 h 01 after departure
    expect((await getBooking(c.p, c.bookingId)).actions.show112).toBe(false);
  });

  // ---- concurrency (S1 to S4) ----------------------------------------------------------------------------------------------

  describe.skipIf(!CRON)('concurrency', () => {
    it('S1: the tick completing a ride in parallel with a driver no-show ends consistent', async () => {
      const c = await confirmed();
      await Promise.all([withAuthRow(c.driver), withAuthRow(c.p)]);
      await departRide(c.ride.id, 125);
      const [ns] = await Promise.all([noShow(c.driver, c.bookingId), tick()]);
      expect(ns.status).toBe(200);
      await tick(); // a ride the first tick skipped (locked) is finished now
      const row = await bookingRow(c.bookingId);
      expect(row).toMatchObject({ status: 'no_show', final_price_bani: null });
      expect(['completed', 'expired']).toContain(await rideStatus(c.ride.id));
      expect(
        await count(
          sql`select count(*)::int as n from app.reliability_events where booking_id = ${c.bookingId}::uuid and kind = 'no_show'`,
        ),
      ).toBe(1);
      await assertSeats(c.ride.id);
    });

    it('S2: both parties rating in parallel: both ratings count at once', async () => {
      const c = await completed();
      const [a, b] = await Promise.all([
        rate(c.p, c.bookingId, 5, ['punctual']),
        rate(c.driver, c.bookingId, 4, ['friendly']),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(
        await count(
          sql`select count(*)::int as n from app.ratings where booking_id = ${c.bookingId}::uuid and visible_at <= now()`,
        ),
      ).toBe(2);
    });

    it('S3: a rating in parallel with a no-show: exactly one wins (5 rounds)', async () => {
      for (let round = 0; round < 5; round += 1) {
        const c = await completed();
        const [r, n] = await Promise.all([
          rate(c.p, c.bookingId, 5),
          noShow(c.driver, c.bookingId),
        ]);
        const wins = [r, n].filter((x) => x.status === 200 || x.status === 201).length;
        expect(wins).toBe(1);
        const loser = r.status === 201 ? n : r;
        expect(loser.status).toBe(409);
        expect((await errorOf(loser)).code).toBe('INVALID_STATE');
        const ratings = await count(
          sql`select count(*)::int as n from app.ratings where booking_id = ${c.bookingId}::uuid`,
        );
        const status = (await bookingRow(c.bookingId))?.status;
        expect(ratings === 1 ? status === 'completed' : status === 'no_show').toBe(true);
        await assertSeats(c.ride.id);
      }
    });

    it('S4: a block in parallel with an approval and a new request, then one tick: no active booking is left between them', async () => {
      const [driver, p] = await Promise.all([
        user('Radu', DRIVER_PHONE),
        user('Ioana', PASSENGER_PHONE),
      ]);
      await Promise.all([withAuthRow(driver), withAuthRow(p)]);
      const l1 = lane();
      const l2 = lane();
      const ride1 = await publish(driver, l1, departure());
      const ride2 = await publish(driver, l2, departure());
      const pending = bookingViewSchema.parse(
        await (await requestSeat(p, ride1.id, middle(l1))).json(),
      );

      await Promise.all([
        driver.send('POST', '/blocks', { userId: p.id }),
        driver.send('POST', `/bookings/${pending.id}/approve`, {}),
        requestSeat(p, ride2.id, middle(l2)),
      ]);
      await tick();

      const active = await count(sql`
        select count(*)::int as n from app.bookings b join app.rides r on r.id = b.ride_id
        where b.status in ('requested', 'confirmed') and r.departure_at > now()
          and ((b.passenger_id = ${p.id}::uuid and r.driver_id = ${driver.id}::uuid)
            or (b.passenger_id = ${driver.id}::uuid and r.driver_id = ${p.id}::uuid))`);
      expect(active).toBe(0);
      await assertSeats(ride1.id);
      await assertSeats(ride2.id);
    });
  });
});
