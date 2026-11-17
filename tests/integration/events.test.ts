import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookingViewSchema } from '../../supabase/functions/_shared/contracts/bookings.ts';
import {
  previewResponseSchema,
  rideOwnerViewSchema,
  type RideOwnerView,
} from '../../supabase/functions/_shared/contracts/rides.ts';
import { tickResponseSchema } from '../../supabase/functions/_shared/contracts/system.ts';
import {
  EVENT_NAMES,
  EVENT_PROP_KEYS,
  FORBIDDEN_EVENT_KEYS,
  eventPropsOk,
  type EventName,
} from '../../supabase/functions/_shared/domain/events.ts';
import {
  bucharestDayKey,
  bucharestLocalToUtc,
} from '../../supabase/functions/_shared/domain/time.ts';
import { BASE, DB_URL, SECRET, createUser, type TestUser } from './factories.ts';

/**
 * Event audit against the local stack (e7-metrics-admin-spec §2, §9, ADR 0032), with ROUTING_PROVIDER=fixture
 * and EMAIL_PROVIDER=console. Skipped without the stack. Drives every one of the 11 analytics flows once and
 * checks that EXACTLY ONE row is written for it, with exactly the allow-listed prop keys, flat values that
 * pass the guard, and no forbidden key anywhere. The database connects as the local superuser, to move time.
 *   INT_DB_URL   default postgresql://postgres:postgres@127.0.0.1:54322/postgres
 *   INT_DB=skip  skips the whole file
 *   CRON_SECRET  same value as the function's: needed for the flows that run in the tick
 *                (booking_expired, ride_completed and what follows it); those tests are skipped without it
 */
const DB_SKIP = process.env.INT_DB === 'skip';
const CRON = process.env.CRON_SECRET;

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

async function publish(driver: TestUser, l: Lane, at: Date): Promise<RideOwnerView> {
  const pRes = await driver.send('POST', '/rides/preview', { origin: l.from, destination: l.to });
  expect(pRes.status).toBe(200);
  const preview = previewResponseSchema.parse(await pRes.json());
  const res = await driver.send('POST', '/rides', {
    previewId: preview.previewId,
    departureAt: iso(at),
    seats: 3,
  });
  expect(res.status).toBe(201);
  return rideOwnerViewSchema.parse(await res.json());
}

const requestSeat = (p: TestUser, rideId: string, trip: Trip) =>
  p.call('/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ rideId, ...trip }),
  });

const tick = async () => {
  const res = await fetch(`${BASE}/internal/tick`, {
    method: 'POST',
    headers: { 'x-cron-secret': CRON ?? '' },
  });
  expect(res.status).toBe(200);
  return tickResponseSchema.parse(await res.json());
};

type EventRow = { name: string; user_id: string | null; props: Record<string, unknown> };

describe.skipIf(!BASE || !SECRET || DB_SKIP)('analytics events against the local stack', () => {
  let sql: postgres.Sql;
  beforeAll(() => {
    sql = postgres(DB_URL, { max: 4, connect_timeout: 15, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** The events the audit has checked so far. */
  const seen = new Set<EventName>();

  const rowsFor = (name: EventName, by: { userId?: string; prop?: [string, string] }) =>
    sql<EventRow[]>`
      select name, user_id::text, props from app.analytics_events
      where name = ${name}
        and (${by.userId ?? null}::uuid is null or user_id = ${by.userId ?? null}::uuid)
        and (${by.prop?.[0] ?? null}::text is null or props ->> ${by.prop?.[0] ?? ''} = ${by.prop?.[1] ?? null})`;

  /** Exactly one row; its keys are the allow-list; the props pass the guard; no forbidden key at any depth. */
  async function expectOne(
    name: EventName,
    by: { userId?: string; prop?: [string, string] },
    actor: string | null,
  ): Promise<Record<string, unknown>> {
    seen.add(name);
    const rows = await rowsFor(name, by);
    expect(rows, `${name}: one row per flow`).toHaveLength(1);
    const row = rows[0] as EventRow;
    expect(row.user_id, `${name}: actor`).toBe(actor);
    expect(Object.keys(row.props).sort(), `${name}: props keys`).toEqual(
      [...EVENT_PROP_KEYS[name]].sort(),
    );
    expect(eventPropsOk(row.props), `${name}: the guard`).toBe(true);
    const text = JSON.stringify(row.props);
    for (const key of FORBIDDEN_EVENT_KEYS) {
      expect(text.toLowerCase(), `${name}: key ${key}`).not.toContain(`"${key}":`);
    }
    // No coordinate-looking number, phone or plate in any value.
    expect(text).not.toMatch(/-?\d{1,3}\.\d{4,}/);
    expect(text).not.toMatch(/\+40\d{9}/);
    expect(text).not.toMatch(/\b[A-Z]{1,2}\s?\d{2,3}\s?[A-Z]{3}\b/);
    return row.props;
  }

  it('search, publish, request, approve, reject, late cancel and report: one row each', async () => {
    const [driver, p1, p2, p3] = await Promise.all([
      createUser({ firstName: 'Radu' }),
      createUser({ firstName: 'Ioana' }),
      createUser({ firstName: 'Matei' }),
      createUser({ firstName: 'Ana' }),
    ]);
    const l = lane();
    const at = departure();

    // search_performed (signed in: the actor is the searcher)
    const search = await p1.send('POST', '/search', {
      ...middle(l),
      date: bucharestDayKey(at),
      time: '12:00',
      windowMin: 30,
    });
    expect(search.status).toBe(200);
    const searchProps = await expectOne('search_performed', { userId: p1.id }, p1.id);
    expect(typeof searchProps.resultsCount).toBe('number');
    expect(typeof searchProps.windowMin).toBe('number');
    expect(typeof searchProps.corridor).toBe('string');

    // ride_published
    const ride = await publish(driver, l, at);
    const published = await expectOne('ride_published', { prop: ['rideId', ride.id] }, driver.id);
    expect(published).toMatchObject({ seats: 3, isFree: false });
    expect(typeof published.distanceM).toBe('number');

    // booking_requested, booking_confirmed
    const b1 = bookingViewSchema.parse(await (await requestSeat(p1, ride.id, middle(l))).json());
    const requested = await expectOne('booking_requested', { prop: ['bookingId', b1.id] }, p1.id);
    expect(requested.rideId).toBe(ride.id);
    expect(typeof requested.segmentM).toBe('number');
    expect((await driver.send('POST', `/bookings/${b1.id}/approve`, {})).status).toBe(200);
    const confirmed = await expectOne(
      'booking_confirmed',
      { prop: ['bookingId', b1.id] },
      driver.id,
    );
    expect(Number.isInteger(confirmed.responseSeconds)).toBe(true);

    // booking_rejected
    const b2 = bookingViewSchema.parse(await (await requestSeat(p2, ride.id, middle(l))).json());
    expect((await driver.send('POST', `/bookings/${b2.id}/reject`, {})).status).toBe(200);
    const rejected = await expectOne('booking_rejected', { prop: ['bookingId', b2.id] }, driver.id);
    expect(rejected.rideId).toBe(ride.id);

    // booking_cancelled: late (the ride leaves in 20 minutes), by the passenger
    const l2 = lane();
    const ride2 = await publish(driver, l2, departure());
    const b3 = bookingViewSchema.parse(await (await requestSeat(p3, ride2.id, middle(l2))).json());
    expect((await driver.send('POST', `/bookings/${b3.id}/approve`, {})).status).toBe(200);
    await sql`update app.rides set departure_at = now() + interval '20 minutes' where id = ${ride2.id}::uuid`;
    expect((await p3.send('POST', `/bookings/${b3.id}/cancel`, {})).status).toBe(200);
    const cancelled = await expectOne('booking_cancelled', { prop: ['bookingId', b3.id] }, p3.id);
    expect(cancelled).toMatchObject({ by: 'passenger', late: true, rideId: ride2.id });

    // report_submitted
    const report = await p1.send('POST', '/reports', {
      reportedUserId: driver.id,
      reason: 'unsafe_driving',
      details: 'A free text that must never reach the analytics table.',
    });
    expect(report.status).toBe(201);
    const reported = await expectOne('report_submitted', { userId: p1.id }, p1.id);
    expect(reported).toEqual({ reason: 'unsafe_driving', alsoBlock: false });
    // The free text of the report never reaches an event.
    expect(
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from app.analytics_events
          where props::text like '%free text that must never%'`
      )[0]?.n,
    ).toBe(0);
  });

  it.skipIf(!CRON)(
    'expire, complete, no-show and rate: one row each, written by the tick or by the party',
    async () => {
      const [driver, pa, pb, pc] = await Promise.all([
        createUser({ firstName: 'Radu' }),
        createUser({ firstName: 'Ioana' }),
        createUser({ firstName: 'Matei' }),
        createUser({ firstName: 'Ana' }),
      ]);
      const l = lane();
      const ride = await publish(driver, l, departure());

      // booking_expired (tick step 1): a request nobody answered
      const expired = bookingViewSchema.parse(
        await (await requestSeat(pc, ride.id, middle(l))).json(),
      );
      await sql`
        update app.bookings
        set requested_at = now() - interval '2 hours', created_at = now() - interval '2 hours',
            expires_at = now() - interval '1 hour'
        where id = ${expired.id}::uuid`;

      // Two confirmed bookings on the same ride for the completion flows.
      const ba = bookingViewSchema.parse(await (await requestSeat(pa, ride.id, middle(l))).json());
      const bb = bookingViewSchema.parse(await (await requestSeat(pb, ride.id, middle(l))).json());
      for (const b of [ba, bb]) {
        expect((await driver.send('POST', `/bookings/${b.id}/approve`, {})).status).toBe(200);
      }
      await tick();
      const gone = await expectOne('booking_expired', { prop: ['bookingId', expired.id] }, pc.id);
      expect(gone.rideId).toBe(ride.id);

      // ride_completed (tick step 2): the ride left 2 h 5 min ago
      await sql`update app.rides set departure_at = now() - interval '125 minutes' where id = ${ride.id}::uuid`;
      for (let i = 0; i < 3; i++) {
        await tick();
        const status = (
          await sql<
            { status: string }[]
          >`select status::text from app.rides where id = ${ride.id}::uuid`
        )[0]?.status;
        if (status === 'completed') break;
      }
      const completed = await expectOne('ride_completed', { prop: ['rideId', ride.id] }, driver.id);
      expect(completed.seats).toBe(2);

      // no_show_reported: the driver says passenger B did not show
      expect((await driver.send('POST', `/bookings/${bb.id}/no-show`, {})).status).toBe(200);
      const noShow = await expectOne('no_show_reported', { prop: ['bookingId', bb.id] }, driver.id);
      expect(noShow).toMatchObject({ by: 'driver', rideId: ride.id });

      // rating_submitted: passenger A rates the driver
      const rated = await pa.send('POST', `/bookings/${ba.id}/ratings`, { stars: 5, tags: [] });
      expect(rated.status).toBe(201);
      const rating = await expectOne('rating_submitted', { prop: ['bookingId', ba.id] }, pa.id);
      expect(rating).toEqual({ bookingId: ba.id, stars: 5, tagCount: 0, raterRole: 'passenger' });
    },
  );

  it('the registry names exactly the 11 events the audit drives', () => {
    expect(EVENT_NAMES).toHaveLength(11);
    // The first test covers 7 flows, the tick test 4: together all 11 (the second needs CRON_SECRET).
    const expected = CRON ? 11 : 7;
    expect(seen.size).toBe(expected);
    if (CRON) expect([...seen].sort()).toEqual([...EVENT_NAMES].sort());
  });
});
