import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { bookingViewSchema } from '../../supabase/functions/_shared/contracts/bookings.ts';
import { errorEnvelopeSchema } from '../../supabase/functions/_shared/contracts/errors.ts';
import {
  alertListResponseSchema,
  cancelSeriesResponseSchema,
  createAlertResponseSchema,
  createSeriesResponseSchema,
  monthStatsResponseSchema,
} from '../../supabase/functions/_shared/contracts/liquidity.ts';
import {
  previewResponseSchema,
  rideListResponseSchema,
  rideOwnerViewSchema,
} from '../../supabase/functions/_shared/contracts/rides.ts';
import { addLocalDays } from '../../supabase/functions/_shared/domain/series.ts';
import {
  bucharestDayKey,
  bucharestLocalToUtc,
} from '../../supabase/functions/_shared/domain/time.ts';
import {
  BASE,
  DB_URL,
  SECRET,
  createUser,
  localSlot,
  makeAlert,
  makeSubscription,
  pushEnabled,
  type TestUser,
} from './factories.ts';

/**
 * Black-box tests of the E8 liquidity boosters against the local stack (see api.test.ts), with
 * ROUTING_PROVIDER=fixture and EMAIL_PROVIDER=console. Skipped without the stack. Push tests also need
 * the stack to have VAPID keys set (CI generates throw-away ones and runs PUSH_PROVIDER=console);
 * tests that run the tick need CRON_SECRET; the rest need the database (INT_DB=skip skips them).
 *
 * Isolation: every scenario uses its OWN random lane, fresh users and a random day, and asserts only
 * on what it created. The tick is global, so a test never assumes that ITS tick did the work, only
 * that the work has been done.
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

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;

/** A random local day 2 to 12 days ahead at 10:00 to 16:00. */
function departure(): Date {
  const day = bucharestDayKey(new Date(Date.now() + (2 + Math.floor(Math.random() * 11)) * DAY));
  const hour = String(10 + Math.floor(Math.random() * 7)).padStart(2, '0');
  return bucharestLocalToUtc(day, `${hour}:00`);
}

async function preview(driver: TestUser, l: Lane): Promise<string> {
  const res = await driver.send('POST', '/rides/preview', { origin: l.from, destination: l.to });
  expect(res.status).toBe(200);
  return previewResponseSchema.parse(await res.json()).previewId;
}

async function publish(
  driver: TestUser,
  l: Lane,
  at: Date,
  opts: { seats?: number; autoAccept?: boolean } = {},
) {
  const res = await driver.send('POST', '/rides', {
    previewId: await preview(driver, l),
    departureAt: iso(at),
    seats: opts.seats ?? 3,
    ...(opts.autoAccept === undefined ? {} : { autoAccept: opts.autoAccept }),
  });
  expect(res.status).toBe(201);
  return rideOwnerViewSchema.parse(await res.json());
}

const requestSeat = (p: TestUser, rideId: string, trip: { from: Point; to: Point }) =>
  p.call('/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ rideId, ...trip }),
  });

const tick = () =>
  fetch(`${BASE}/internal/tick`, { method: 'POST', headers: { 'x-cron-secret': CRON ?? '' } });

/**
 * Ticks until `read()` satisfies `done` (at most ~8 s). The tick is global: another suite's tick may hold
 * a ride's lock (the matcher skips locked rows) or have processed it already, so one tick is not proof.
 */
async function tickUntil<T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  let value = await read();
  for (let i = 0; i < 8 && !done(value); i++) {
    expect((await tick()).status).toBe(200);
    value = await read();
    if (!done(value)) await new Promise((r) => setTimeout(r, 1000));
  }
  return value;
}

const SERIES_TIME = '12:00';
/** Tomorrow (local) and the 28 days from it (offsets 0 to 27): exactly four of every weekday. */
function seriesWindow() {
  const startsOn = bucharestDayKey(new Date(Date.now() + DAY));
  const endsOn = addLocalDays(startsOn, 27);
  return { startsOn, endsOn };
}

describe.skipIf(!BASE || !SECRET)('ride series against the local stack', () => {
  it('Monday and Wednesday for four weeks creates 8 rides in one request', async () => {
    const driver = await createUser();
    const l = lane();
    const { startsOn, endsOn } = seriesWindow();
    const res = await driver.send('POST', '/ride-series', {
      previewId: await preview(driver, l),
      weekdays: [1, 3],
      departureTime: SERIES_TIME,
      startsOn,
      endsOn,
      seats: 2,
    });
    expect(res.status).toBe(201);
    const out = createSeriesResponseSchema.parse(await res.json());
    expect(out.created).toHaveLength(8);
    expect(out.skipped).toEqual([]);
    expect(out.series).toMatchObject({
      weekdays: [1, 3],
      departureTime: SERIES_TIME,
      status: 'active',
    });
    expect(out.series.upcomingCount).toBe(8);

    // every instance is a normal ride, tied to the series, priced by the server
    const list = rideListResponseSchema.parse(
      await (await driver.call('/me/rides?scope=upcoming&limit=50')).json(),
    );
    expect(list.items.filter((i) => i.seriesId === out.series.id)).toHaveLength(8);
    const view = rideOwnerViewSchema.parse(
      await (await driver.call(`/me/rides/${out.created[0]?.rideId}`)).json(),
    );
    expect(view.series?.id).toBe(out.series.id);
    expect(view.autoAccept).toBe(false);
  });

  it.skipIf(DB_SKIP)(
    'a date with 4 rides already is skipped as DAILY_RIDE_LIMIT, the rest are created',
    async () => {
      const driver = await createUser();
      const l = lane();
      const { startsOn, endsOn } = seriesWindow();
      // first Monday on or after tomorrow, at most 7 days ahead (normal rides allow 14)
      let first = startsOn;
      while (localSlot(bucharestLocalToUtc(first, '12:00')).weekday !== 1) {
        first = bucharestDayKey(new Date(bucharestLocalToUtc(first, '12:00').getTime() + DAY));
      }
      for (const t of ['06:00', '07:00', '08:00', '09:00']) {
        await publish(driver, l, bucharestLocalToUtc(first, t));
      }
      const res = await driver.send('POST', '/ride-series', {
        previewId: await preview(driver, l),
        weekdays: [1],
        departureTime: SERIES_TIME,
        startsOn,
        endsOn,
        seats: 2,
      });
      expect(res.status).toBe(201);
      const out = createSeriesResponseSchema.parse(await res.json());
      expect(out.skipped).toEqual([{ date: first, code: 'DAILY_RIDE_LIMIT' }]);
      expect(out.created).toHaveLength(3);
    },
  );

  it.skipIf(DB_SKIP)('POST /rides racing POST /ride-series never exceeds 4 a day', async () => {
    const sql = postgres(DB_URL, { max: 2 });
    try {
      const driver = await createUser();
      const l = lane();
      const at = departure();
      const { day, weekday } = localSlot(at);
      for (const t of ['06:00', '07:00', '08:00']) {
        await publish(driver, l, bucharestLocalToUtc(day, t));
      }
      const [single, series] = await Promise.all([
        (async () =>
          driver.send('POST', '/rides', {
            previewId: await preview(driver, l),
            departureAt: iso(bucharestLocalToUtc(day, '09:00')),
            seats: 2,
          }))(),
        (async () =>
          driver.send('POST', '/ride-series', {
            previewId: await preview(driver, l),
            weekdays: [weekday],
            departureTime: SERIES_TIME,
            startsOn: day,
            endsOn: day,
            seats: 2,
          }))(),
      ]);
      expect([single.status, series.status].sort()).toEqual([201, 409]);
      const [row_n] = await sql<{ n: number }[]>`
        select count(*)::int as n from app.rides
        where driver_id = ${driver.id}::uuid and status <> 'cancelled'
          and departure_at >= ${bucharestLocalToUtc(day, '00:00')}
          and departure_at < ${bucharestLocalToUtc(day, '23:59')}`;
      expect(row_n?.n).toBe(4);
    } finally {
      await sql.end();
    }
  });

  it.skipIf(DB_SKIP)(
    'cancelling a series cancels the future instances (passengers emailed), leaves past ones, and a second cancel is 409',
    async () => {
      const sql = postgres(DB_URL, { max: 2 });
      try {
        const [driver, passenger] = await Promise.all([createUser(), createUser()]);
        const l = lane();
        const { startsOn, endsOn } = seriesWindow();
        const created = createSeriesResponseSchema.parse(
          await (
            await driver.send('POST', '/ride-series', {
              previewId: await preview(driver, l),
              weekdays: [1, 3],
              departureTime: SERIES_TIME,
              startsOn,
              endsOn,
              seats: 2,
            })
          ).json(),
        );
        const [soon, past] = [created.created[0], created.created[1]];
        expect(soon && past).toBeTruthy();
        // a passenger with a request on the first instance
        const booked = await requestSeat(passenger, soon?.rideId ?? '', middle(l));
        expect(booked.status).toBe(201);
        const booking = bookingViewSchema.parse(await booked.json());
        // the second instance "already departed"
        await sql`update app.rides set departure_at = now() - interval '1 day' where id = ${past?.rideId ?? ''}::uuid`;

        const res = await driver.send('POST', `/ride-series/${created.series.id}/cancel`, {});
        expect(res.status).toBe(200);
        const out = cancelSeriesResponseSchema.parse(await res.json());
        expect(out.series.status).toBe('cancelled');
        expect(out.cancelledRideIds).toHaveLength(7);
        expect(out.cancelledRideIds).not.toContain(past?.rideId);

        const rows = await sql<{ id: string; status: string }[]>`
          select id, status from app.rides where series_id = ${created.series.id}::uuid`;
        expect(rows.filter((r) => r.status === 'cancelled')).toHaveLength(7);
        expect(rows.find((r) => r.id === past?.rideId)?.status).toBe('published');

        const mail = await sql<{ template: string }[]>`
          select template from app.outbox
          where user_id = ${passenger.id}::uuid and template = 'ride_cancelled'
            and payload ->> 'bookingId' = ${booking.id}`;
        expect(mail.length).toBeGreaterThanOrEqual(1);

        const again = await driver.send('POST', `/ride-series/${created.series.id}/cancel`, {});
        expect(again.status).toBe(409);
        expect((await errorOf(again)).code).toBe('INVALID_STATE');

        // someone else's series is simply unknown
        const other = await passenger.send('POST', `/ride-series/${created.series.id}/cancel`, {});
        expect(other.status).toBe(404);
      } finally {
        await sql.end();
      }
    },
  );
});

describe.skipIf(!BASE || !SECRET)('ride alerts against the local stack', () => {
  it('the 6th active alert is 409 ALERT_LIMIT and an identical alert is 200', async () => {
    const user = await createUser({ vehicle: null });
    const l = lane();
    const at = departure();
    const first = await makeAlert(user, l, at);
    expect(first.status).toBe(201);
    const firstItem = createAlertResponseSchema.parse(await first.json()).item;
    const same = await makeAlert(user, l, at);
    expect(same.status).toBe(200);
    expect(createAlertResponseSchema.parse(await same.json()).item.id).toBe(firstItem.id);

    for (const w of [15, 60]) {
      expect((await makeAlert(user, l, at, { windowMin: w })).status).toBe(201);
    }
    for (const time of ['05:00', '06:00']) {
      expect((await makeAlert(user, l, at, { time })).status).toBe(201);
    }
    const sixth = await makeAlert(user, l, at, { time: '07:00' });
    expect(sixth.status).toBe(409);
    expect((await errorOf(sixth)).code).toBe('ALERT_LIMIT');

    const list = alertListResponseSchema.parse(await (await user.call('/me/alerts')).json());
    expect(list.items).toHaveLength(5);
    expect((await user.send('DELETE', `/alerts/${firstItem.id}`)).status).toBe(204);
    expect((await user.send('DELETE', `/alerts/${firstItem.id}`)).status).toBe(404);
    expect((await makeAlert(user, l, at, { time: '07:00' })).status).toBe(201);
  });

  it.skipIf(DB_SKIP || !CRON)(
    'a matching ride gives exactly one ride_alert_match, a second tick none, a non-matching ride none',
    async () => {
      const sql = postgres(DB_URL, { max: 2 });
      try {
        const [driver, owner] = await Promise.all([createUser(), createUser({ vehicle: null })]);
        const l = lane();
        const at = departure();
        const created = await makeAlert(owner, middle(l), at);
        expect(created.status).toBe(201);

        const ride = await publish(driver, l, at);
        // a ride on another lane and at another time does not match
        await publish(driver, lane(), new Date(at.getTime() + 3 * 3_600_000));

        const rows = () =>
          sql<{ channel: string; payload: Record<string, unknown> }[]>`
            select channel::text as channel, payload from app.outbox
            where user_id = ${owner.id}::uuid and template = 'ride_alert_match'`;
        const first = await tickUntil(rows, (r) => r.length >= 1);
        expect(first).toHaveLength(1);
        expect(first[0]?.payload).toMatchObject({ rideId: ride.id, moreCount: 0 });
        // areas and a time only
        expect(JSON.stringify(first[0]?.payload)).not.toMatch(/-?\d{1,3}\.\d{4,}|\+40|SB12|@/);

        expect((await tick()).status).toBe(200);
        expect(await rows()).toHaveLength(1);
        const [row_hits] = await sql<{ hits: number }[]>`
          select count(*)::int as hits from app.ride_alert_hits h
          join app.ride_alerts a on a.id = h.alert_id where a.user_id = ${owner.id}::uuid`;
        expect(row_hits?.hits).toBe(1);
        const list = alertListResponseSchema.parse(await (await owner.call('/me/alerts')).json());
        expect(list.items[0]?.matchesSent).toBe(1);
        expect(list.items[0]?.lastNotifiedAt).not.toBeNull();
      } finally {
        await sql.end();
      }
    },
  );

  it.skipIf(DB_SKIP || !CRON)(
    'a weekly alert and a series: the 8 rides are one notification with moreCount',
    async () => {
      const sql = postgres(DB_URL, { max: 2 });
      try {
        const [driver, owner] = await Promise.all([createUser(), createUser({ vehicle: null })]);
        const l = lane();
        const { startsOn, endsOn } = seriesWindow();
        const alert = await owner.send('POST', '/alerts', {
          from: middle(l).from,
          to: middle(l).to,
          fromLabel: 'Home',
          toLabel: 'Work',
          schedule: { kind: 'weekly', weekdays: [1, 3] },
          time: SERIES_TIME,
          windowMin: 30,
        });
        expect(alert.status).toBe(201);
        const series = createSeriesResponseSchema.parse(
          await (
            await driver.send('POST', '/ride-series', {
              previewId: await preview(driver, l),
              weekdays: [1, 3],
              departureTime: SERIES_TIME,
              startsOn,
              endsOn,
              seats: 2,
            })
          ).json(),
        );
        expect(series.created).toHaveLength(8);

        const rows = await tickUntil(
          () =>
            sql<{ payload: { moreCount: number } }[]>`
              select payload from app.outbox
              where user_id = ${owner.id}::uuid and template = 'ride_alert_match'`,
          (r) => r.reduce((n, x) => n + 1 + x.payload.moreCount, 0) >= 8,
        );
        // normally one row (moreCount 7); a concurrent tick may split the batch, so count the rides
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows.reduce((n, r) => n + 1 + r.payload.moreCount, 0)).toBe(8);
        const [row_hits] = await sql<{ hits: number }[]>`
          select count(*)::int as hits from app.ride_alert_hits h
          join app.ride_alerts a on a.id = h.alert_id where a.user_id = ${owner.id}::uuid`;
        expect(row_hits?.hits).toBe(8);
      } finally {
        await sql.end();
      }
    },
  );
});

describe.skipIf(!BASE || !SECRET)('auto-accept against the local stack', () => {
  it('an eligible passenger is confirmed at once: 201 confirmed, seat taken, driver told once', async () => {
    const [driver, passenger] = await Promise.all([createUser(), createUser()]);
    const l = lane();
    const ride = await publish(driver, l, departure(), { autoAccept: true });
    expect(ride.autoAccept).toBe(true);

    const res = await requestSeat(passenger, ride.id, middle(l));
    expect(res.status).toBe(201);
    const view = bookingViewSchema.parse(await res.json());
    expect(view).toMatchObject({ status: 'confirmed', autoConfirmed: true });
    expect(view.price.lockedBani).not.toBeNull();

    const after = rideOwnerViewSchema.parse(
      await (await driver.call(`/me/rides/${ride.id}`)).json(),
    );
    expect(after.seatsBooked).toBe(1);
    expect(after.passengers).toHaveLength(1);
  });

  it.skipIf(DB_SKIP)(
    'outbox and events: booking_auto_confirmed to the driver instead of booking_requested; no email to the passenger',
    async () => {
      const sql = postgres(DB_URL, { max: 2 });
      try {
        const [driver, passenger] = await Promise.all([createUser(), createUser()]);
        const l = lane();
        const ride = await publish(driver, l, departure(), { autoAccept: true });
        const view = bookingViewSchema.parse(
          await (await requestSeat(passenger, ride.id, middle(l))).json(),
        );
        const driverRows = await sql<{ template: string }[]>`
          select template from app.outbox
          where user_id = ${driver.id}::uuid and channel = 'email' and payload ->> 'bookingId' = ${view.id}`;
        expect(driverRows.map((r) => r.template)).toEqual(['booking_auto_confirmed']);
        // Improvements item 7: the auto-accepted passenger is told too (booking_confirmed), the same
        // mail as when a driver approves by hand.
        const passengerRows = await sql<{ template: string }[]>`
          select template from app.outbox
          where user_id = ${passenger.id}::uuid and channel = 'email' and payload ->> 'bookingId' = ${view.id}`;
        expect(passengerRows.map((r) => r.template)).toEqual(['booking_confirmed']);
        const events = await sql<{ name: string; props: Record<string, unknown> }[]>`
          select name, props from app.analytics_events
          where props ->> 'bookingId' = ${view.id} order by id`;
        expect(events.map((e) => e.name)).toEqual(['booking_requested', 'booking_confirmed']);
        expect(events[1]?.props).toMatchObject({ auto: true, responseSeconds: 0 });
        const [b] = await sql<{ auto_confirmed: boolean }[]>`
          select auto_confirmed from app.bookings where id = ${view.id}::uuid`;
        expect(b?.auto_confirmed).toBe(true);
      } finally {
        await sql.end();
      }
    },
  );

  it.skipIf(DB_SKIP)(
    'a passenger rated 3.5 is not confirmed: the E4 request flow runs; a New one and 4.0 are',
    async () => {
      const sql = postgres(DB_URL, { max: 2 });
      try {
        const driver = await createUser();
        const l = lane();
        const at = departure();
        // ratings.booking_id has a foreign key (E4): each rating needs a real completed booking, so one
        // finished ride of this driver carries one completed booking per rating.
        const rate = async (passengerId: string, stars: number[]) => {
          const [past] = await sql<{ id: string }[]>`
            insert into app.rides (driver_id, origin, destination, origin_label, destination_label, route,
              distance_m, duration_s, departure_at, seats_offered, energy_price_id, rate_micro_per_km,
              vehicle_snapshot, status, completed_at)
            select ${driver.id}::uuid, ST_SetSRID(ST_MakePoint(24.15123, 45.70987), 4326),
              ST_SetSRID(ST_MakePoint(24.18654, 45.74321), 4326), 'Seed A', 'Seed B',
              ST_GeomFromText('LINESTRING(24.15123 45.70987, 24.17 45.725, 24.18654 45.74321)', 4326),
              5000, 600, now() - interval '40 days', 4, e.id, 651000,
              '{"fuelType":"diesel"}'::jsonb, 'completed'::app.ride_status,
              now() - interval '40 days' + interval '2 hours'
            from app.energy_prices e where e.fuel_type = 'diesel' order by e.effective_from limit 1
            returning id`;
          if (!past) throw new Error('no diesel energy price to seed a ride with');
          for (const s of stars) {
            const [booking] = await sql<{ id: string }[]>`
              insert into app.bookings (ride_id, passenger_id, status, pickup, dropoff, pickup_label,
                dropoff_label, pickup_fraction, dropoff_fraction, segment_m, walk_pickup_m, walk_dropoff_m,
                price_quoted_bani, price_locked_bani, final_price_bani, requested_at, expires_at, decided_at)
              values (${past.id}::uuid, ${passengerId}::uuid, 'completed'::app.booking_status,
                ST_SetSRID(ST_MakePoint(24.16234, 45.71876), 4326),
                ST_SetSRID(ST_MakePoint(24.18123, 45.74012), 4326), 'Selimbar', 'Centru', 0.2, 0.9, 3500,
                100, 100, 120, 120, 120, now() - interval '41 days',
                now() - interval '41 days' + interval '30 minutes',
                now() - interval '41 days' + interval '5 minutes')
              returning id`;
            if (!booking) throw new Error('booking insert returned no row');
            await sql`
              insert into app.ratings (booking_id, rater_id, ratee_id, stars, visible_at)
              values (${booking.id}::uuid, ${driver.id}::uuid, ${passengerId}::uuid, ${s}::smallint,
                      now() - interval '1 day')`;
          }
        };
        const cases: [number[], string][] = [
          [[3, 4, 3, 4], 'requested'], // 3.5
          [[4, 4, 4], 'confirmed'], // 4.0
          [[1, 1], 'confirmed'], // fewer than 3 visible ratings: New
        ];
        for (const [i, [stars, expected]] of cases.entries()) {
          const passenger = await createUser();
          await rate(passenger.id, stars);
          const ride = await publish(driver, l, new Date(at.getTime() + i * 3_600_000), {
            autoAccept: true,
          });
          const res = await requestSeat(passenger, ride.id, middle(l));
          expect(res.status).toBe(201);
          expect(bookingViewSchema.parse(await res.json()).status).toBe(expected);
        }
      } finally {
        await sql.end();
      }
    },
  );

  it.skipIf(DB_SKIP)(
    'two parallel requests for the last seat: one confirmed, one 409 RIDE_FULL, seats_booked = seats_offered',
    async () => {
      const sql = postgres(DB_URL, { max: 2 });
      try {
        const [driver, a, b] = await Promise.all([createUser(), createUser(), createUser()]);
        const l = lane();
        const ride = await publish(driver, l, departure(), { seats: 1, autoAccept: true });
        const [ra, rb] = await Promise.all([
          requestSeat(a, ride.id, middle(l)),
          requestSeat(b, ride.id, middle(l)),
        ]);
        expect([ra.status, rb.status].sort()).toEqual([201, 409]);
        const loser = ra.status === 409 ? ra : rb;
        expect((await errorOf(loser)).code).toBe('RIDE_FULL');
        const [r] = await sql<{ seats_booked: number; seats_offered: number }[]>`
          select seats_booked, seats_offered from app.rides where id = ${ride.id}::uuid`;
        expect(r?.seats_booked).toBe(r?.seats_offered);
        const [row_n] = await sql<{ n: number }[]>`
          select count(*)::int as n from app.bookings where ride_id = ${ride.id}::uuid and status = 'confirmed'`;
        expect(row_n?.n).toBe(1);
      } finally {
        await sql.end();
      }
    },
  );

  it.skipIf(DB_SKIP)(
    'PATCH /me/rides/{id} racing a request is serialised: switching on never confirms a pending request',
    async () => {
      const sql = postgres(DB_URL, { max: 2 });
      try {
        const [driver, passenger] = await Promise.all([createUser(), createUser()]);
        const l = lane();
        const ride = await publish(driver, l, departure());
        const [patch, booked] = await Promise.all([
          driver.send('PATCH', `/me/rides/${ride.id}`, { autoAccept: true }),
          requestSeat(passenger, ride.id, middle(l)),
        ]);
        expect(patch.status).toBe(200);
        expect(booked.status).toBe(201);
        const view = bookingViewSchema.parse(await booked.json());
        const [b] = await sql<{ status: string; auto_confirmed: boolean }[]>`
          select status::text as status, auto_confirmed from app.bookings where id = ${view.id}::uuid`;
        const [r] = await sql<{ seats_booked: number }[]>`
          select seats_booked from app.rides where id = ${ride.id}::uuid`;
        // either the switch won (confirmed at once) or the request did (still pending afterwards)
        expect(b?.auto_confirmed).toBe(b?.status === 'confirmed');
        expect(r?.seats_booked).toBe(b?.status === 'confirmed' ? 1 : 0);
        expect(['requested', 'confirmed']).toContain(b?.status);

        // the switch is for the driver of a published ride only
        expect(
          (await passenger.send('PATCH', `/me/rides/${ride.id}`, { autoAccept: false })).status,
        ).toBe(404);
        await driver.send('POST', `/rides/${ride.id}/cancel`, {});
        const late = await driver.send('PATCH', `/me/rides/${ride.id}`, { autoAccept: false });
        expect(late.status).toBe(409);
      } finally {
        await sql.end();
      }
    },
  );
});

describe.skipIf(!BASE || !SECRET)('web push against the local stack', () => {
  it('GET /push/config is public and says whether push is on', async () => {
    const res = await fetch(`${BASE}/push/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vapidPublicKey: string | null };
    expect(body.vapidPublicKey === null || body.vapidPublicKey.length === 87).toBe(true);
  });

  it('PUT stores a subscription, an unsupported service is 400, DELETE is idempotent', async () => {
    const on = await pushEnabled();
    const user = await createUser({ vehicle: null });
    const { endpoint, res } = await makeSubscription(user);
    if (!on) {
      expect(res.status).toBe(503);
      return;
    }
    expect(res.status).toBe(204);
    const bad = await user.send('PUT', '/me/push-subscription', {
      endpoint: 'https://evil.example/push/abc',
      keys: { p256dh: `B${'a'.repeat(86)}`, auth: 'b'.repeat(22) },
    });
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).fields?.endpoint).toBe('unsupported_service');
    expect((await user.send('DELETE', '/me/push-subscription', { endpoint })).status).toBe(204);
    expect((await user.send('DELETE', '/me/push-subscription', { endpoint })).status).toBe(204);
  });

  it.skipIf(DB_SKIP)(
    'a booking event queues an email row and a push row, and the push payload holds no phone, plate, coordinate, email or name',
    async () => {
      if (!(await pushEnabled())) return;
      const sql = postgres(DB_URL, { max: 2 });
      try {
        const driver = await createUser({ firstName: 'Radu' });
        const passenger = await createUser({ firstName: 'Zorica' });
        expect((await makeSubscription(driver)).res.status).toBe(204);
        const l = lane();
        const ride = await publish(driver, l, departure());
        const res = await requestSeat(passenger, ride.id, middle(l));
        expect(res.status).toBe(201);
        const booking = bookingViewSchema.parse(await res.json());

        const rows = await sql<{ channel: string; template: string; payload: unknown }[]>`
          select channel::text as channel, template, payload from app.outbox
          where user_id = ${driver.id}::uuid and payload ->> 'bookingId' = ${booking.id}`;
        expect(rows.map((r) => `${r.channel}:${r.template}`).sort()).toEqual([
          'email:booking_requested',
          'push:booking_requested',
        ]);
        // the push row carries what the renderer needs: ids, areas and times. Rendered, it must be label-only.
        const pushRow = rows.find((r) => r.channel === 'push');
        const text = JSON.stringify(pushRow?.payload);
        expect(text).not.toMatch(/\+40|SB12ABC|-?\d{1,3}\.\d{4,}|@/);
        // the payload keeps the first name for the email row only; the push renderer never reads it
        const { renderPush } = await import('../../supabase/functions/_shared/notify/push.ts');
        const rendered = renderPush(
          { template: 'booking_requested', payload: pushRow?.payload as never },
          { baseUrl: 'https://haide.ro', now: new Date() },
        );
        expect(JSON.stringify(rendered)).not.toMatch(/Zorica|\+40|SB12ABC|-?\d{1,3}\.\d{4,}|@/);
      } finally {
        await sql.end();
      }
    },
  );

  it.skipIf(DB_SKIP || !CRON)(
    'an alert match goes push-first to a subscribed owner and by email to one without a subscription',
    async () => {
      if (!(await pushEnabled())) return;
      const sql = postgres(DB_URL, { max: 2 });
      try {
        const [driver, withPush, without] = await Promise.all([
          createUser(),
          createUser({ vehicle: null }),
          createUser({ vehicle: null }),
        ]);
        expect((await makeSubscription(withPush)).res.status).toBe(204);
        const l = lane();
        const at = departure();
        expect((await makeAlert(withPush, middle(l), at)).status).toBe(201);
        expect((await makeAlert(without, middle(l), at)).status).toBe(201);
        await publish(driver, l, at);
        const channelOf = (id: string) =>
          sql<{ channel: string }[]>`
            select channel::text as channel from app.outbox
            where user_id = ${id}::uuid and template = 'ride_alert_match'`;
        const a = await tickUntil(
          () => channelOf(withPush.id),
          (r) => r.length >= 1,
        );
        const b = await tickUntil(
          () => channelOf(without.id),
          (r) => r.length >= 1,
        );
        expect(a.map((r) => r.channel)).toEqual(['push']);
        expect(b.map((r) => r.channel)).toEqual(['email']);
      } finally {
        await sql.end();
      }
    },
  );
});

describe.skipIf(!BASE || !SECRET || DB_SKIP)('privacy and stats against the local stack', () => {
  it('DELETE /me removes the alerts and the push subscriptions', async () => {
    const sql = postgres(DB_URL, { max: 2 });
    try {
      const user = await createUser({ vehicle: null });
      expect((await makeAlert(user, lane(), departure())).status).toBe(201);
      const pushOn = await pushEnabled();
      if (pushOn) expect((await makeSubscription(user)).res.status).toBe(204);
      const count = async () => {
        const [a] = await sql<{ n: number }[]>`
          select count(*)::int as n from app.ride_alerts where user_id = ${user.id}::uuid`;
        const [s] = await sql<{ n: number }[]>`
          select count(*)::int as n from app.push_subscriptions where user_id = ${user.id}::uuid`;
        return { alerts: a?.n, subs: s?.n };
      };
      expect(await count()).toEqual({ alerts: 1, subs: pushOn ? 1 : 0 });
      expect((await user.send('DELETE', '/me', { confirm: 'DELETE' })).status).toBe(204);
      expect(await count()).toEqual({ alerts: 0, subs: 0 });
    } finally {
      await sql.end();
    }
  });

  it('GET /me/stats/month on a seeded month, and the month field codes', async () => {
    const sql = postgres(DB_URL, { max: 2 });
    try {
      const [driver, passenger] = await Promise.all([createUser(), createUser()]);
      const l = lane();
      const ride = await publish(driver, l, departure());
      const booked = bookingViewSchema.parse(
        await (await requestSeat(passenger, ride.id, middle(l))).json(),
      );
      expect((await driver.send('POST', `/bookings/${booked.id}/approve`, {})).status).toBe(200);
      // move the ride into the past (inside the current local month when possible) and complete it
      const departed = new Date(Date.now() - 3 * 3_600_000);
      await sql`
        update app.rides set departure_at = ${departed}, status = 'completed',
          completed_at = ${new Date(departed.getTime() + 2 * 3_600_000)}
        where id = ${ride.id}::uuid`;
      await sql`
        update app.bookings set status = 'completed', final_price_bani = price_locked_bani
        where id = ${booked.id}::uuid`;
      const [row_paid] = await sql<{ paid: number }[]>`
        select final_price_bani as paid from app.bookings where id = ${booked.id}::uuid`;

      const month = bucharestDayKey(departed).slice(0, 7);
      const d = monthStatsResponseSchema.parse(
        await (await driver.call(`/me/stats/month?month=${month}`)).json(),
      );
      expect(d.driver).toEqual({
        sharedFuelCostBani: row_paid?.paid,
        passengersCarried: 1,
        ridesCompleted: 1,
      });
      const p = monthStatsResponseSchema.parse(
        await (await passenger.call(`/me/stats/month?month=${month}`)).json(),
      );
      expect(p.passenger).toEqual({ paidBani: row_paid?.paid, ridesCompleted: 1 });

      for (const [m, code] of [
        ['2026-10', 'before_launch'],
        ['2999-01', 'future'],
        ['2026-13', 'invalid'],
      ] as const) {
        const res = await driver.call(`/me/stats/month?month=${m}`);
        expect(res.status).toBe(400);
        expect((await errorOf(res)).fields?.month).toBe(code);
      }
    } finally {
      await sql.end();
    }
  });
});
