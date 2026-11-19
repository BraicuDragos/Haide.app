import { Jimp, JimpMime } from 'jimp';
import type postgres from 'postgres';
import { SignJWT } from 'jose';
import {
  bucharestDayKey,
  bucharestLocalToUtc,
} from '../../supabase/functions/_shared/domain/time.ts';

/**
 * Test factories for the integration suite (architecture §13). They talk to the real local API:
 * `createUser` signs up a throw-away user with a locally minted token, then runs the real
 * onboarding endpoints (consent, profile, photo, vehicle), so every ride test starts from a
 * driver the gates accept.
 */
export const BASE = process.env.API_BASE_URL;
export const SECRET = process.env.LOCAL_JWT_SECRET;
const ISSUER = process.env.JWT_ISSUER ?? 'http://127.0.0.1:54321/auth/v1';

export async function tokenFor(userId: string, email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(SECRET));
}

export type VehicleInput = {
  make: string;
  model: string;
  colour: string;
  plate: string;
  fuelType: 'petrol' | 'diesel' | 'lpg' | 'hybrid' | 'electric';
  seats: number;
};

export const DEFAULT_VEHICLE: VehicleInput = {
  make: 'Dacia',
  model: 'Logan',
  colour: 'Gri',
  plate: 'SB12ABC',
  fuelType: 'diesel',
  seats: 3,
};

export type TestUser = {
  id: string;
  email: string;
  headers: Record<string, string>;
  /** Authenticated request. */
  call(path: string, init?: RequestInit): Promise<Response>;
  /** Authenticated JSON request. */
  send(method: string, path: string, body?: unknown): Promise<Response>;
};

function makeUser(id: string, email: string, token: string): TestUser {
  const headers = { authorization: `Bearer ${token}` };
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  return {
    id,
    email,
    headers,
    call,
    send: (method, path, body) =>
      call(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
  };
}

type LegalVersions = { terms: { version: string }; privacy: { version: string } };
let legalPromise: Promise<LegalVersions> | undefined;

/**
 * Current document versions, fetched once per test process. `GET /legal/current` is rate limited
 * per IP (60/min): a call per created user trips 429 for every later test.
 */
function currentLegal(): Promise<LegalVersions> {
  legalPromise ??= fetch(`${BASE}/legal/current`).then(async (res) => {
    if (!res.ok) throw new Error(`legal/current failed with ${res.status}`);
    return (await res.json()) as LegalVersions;
  });
  return legalPromise;
}

/** A user that is signed in only: no consent, no profile. */
export async function createBareUser(): Promise<TestUser> {
  const id = crypto.randomUUID();
  const email = `it-${id.slice(0, 8)}@example.com`;
  return makeUser(id, email, await tokenFor(id, email));
}

/**
 * A fully onboarded user: consent, first name, phone, photo and (unless `vehicle: null`) a vehicle.
 */
export async function createUser(
  opts: { vehicle?: Partial<VehicleInput> | null; firstName?: string } = {},
): Promise<TestUser> {
  const user = await createBareUser();
  const must = async (res: Response, what: string) => {
    if (!res.ok) throw new Error(`${what} failed with ${res.status}: ${await res.text()}`);
  };
  // Onboarding calls are idempotent: one retry on a 5xx absorbs a transient hiccup on a busy runner.
  const retry5xx = async (call: () => Promise<Response>): Promise<Response> => {
    const res = await call();
    if (res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 300));
    return call();
  };
  // The current document versions change with each legal text (1.0, then 1.1 from E6): ask the API.
  const legal = await currentLegal();
  await must(
    await user.send('POST', '/me/consents', {
      age18: true,
      termsVersion: legal.terms.version,
      privacyVersion: legal.privacy.version,
    }),
    'consent',
  );
  await must(
    await retry5xx(() =>
      user.send('PATCH', '/me/profile', {
        firstName: opts.firstName ?? 'Radu',
        phone: '0721 234 567',
      }),
    ),
    'profile',
  );
  const photo = new Jimp({ width: 64, height: 48, color: 0x1e8c5aff });
  const form = new FormData();
  form.set(
    'photo',
    new File([(await photo.getBuffer(JimpMime.png)) as BlobPart], 'p.png', { type: 'image/png' }),
  );
  await must(await user.call('/me/photo', { method: 'PUT', body: form }), 'photo');
  if (opts.vehicle !== null) {
    await must(
      await user.send('PUT', '/me/vehicle', { ...DEFAULT_VEHICLE, ...opts.vehicle }),
      'vehicle',
    );
  }
  return user;
}

/** Trip B (pricing.md §5): Shopping City to Zona Industrială Vest, 9.588 km. */
export const TRIP_B = {
  origin: { lat: 45.7413, lng: 24.1861 },
  destination: { lat: 45.785, lng: 24.09 },
};

/** ISO UTC without milliseconds, `minutes` from now. */
export const inMinutes = (minutes: number): string =>
  new Date(Date.now() + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * ISO UTC for 12:00 Europe/Bucharest on a day at least 6 hours ahead, plus `plusMinutes`.
 * All rides built with it land on the same Bucharest calendar day whenever the test runs
 * (a midnight crossing would otherwise make daily-limit tests flaky).
 */
export function noonTomorrow(plusMinutes = 0): string {
  const day = bucharestDayKey(new Date(Date.now() + 30 * 3_600_000));
  const noon = bucharestLocalToUtc(day, '12:00');
  return new Date(noon.getTime() + plusMinutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Direct database access for the suites that move time (superuser of the local stack). */
export const DB_URL =
  process.env.INT_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Makes a ride and its bookings `days` old (E6 retention tests): the ride departed `days` days ago
 * and each booking was requested a day before that, so `bookings.created_at` stays before departure
 * (the coarsening prefilter relies on it). A published ride is then completed by the next tick.
 */
export async function ageRide(sql: postgres.Sql, rideId: string, days: number): Promise<void> {
  await sql`
    update app.rides
    set departure_at = now() - make_interval(days => ${days}::int),
        completed_at = case when status = 'completed'
          then now() - make_interval(days => ${days}::int) + interval '2 hours' else completed_at end
    where id = ${rideId}::uuid`;
  await sql`
    update app.bookings b
    set created_at = r.departure_at - interval '1 day',
        requested_at = r.departure_at - interval '1 day',
        expires_at = r.departure_at - interval '23 hours'
    from app.rides r
    where r.id = b.ride_id and b.ride_id = ${rideId}::uuid`;
}

// ---- E7: admin and metrics ----------------------------------------------------------------------------------

/**
 * An onboarded user promoted to admin. No endpoint can grant the role (ADR 0033), so it is set in the
 * database, the way the owner does it in the SQL editor.
 */
export async function makeAdmin(
  sql: postgres.Sql,
  opts: { firstName?: string } = {},
): Promise<TestUser> {
  const admin = await createUser({ vehicle: null, firstName: opts.firstName ?? 'Admina' });
  await sql`update app.profiles set role = 'admin' where id = ${admin.id}::uuid`;
  return admin;
}

/** The Monday of the seeded metrics week (2026-W46, the first launch week). */
export const SEEDED_WEEK = { label: '2026-W46', monday: '2026-11-09' } as const;

/**
 * The expected answers of `seedMetricsWeek`, hand-computed. Same shape as the pgTAP fixture in
 * supabase/tests/010_metrics_admin.test.sql (week 2026-W38 there, with the same edges: Monday 00:30 and
 * Sunday 23:30 local), moved to the first launch week because the API accepts no earlier one. The seat
 * series of the 12 weeks 2026-W35 to W46 is [0, 0, 0, 0, 0, 0, 1, 4, 1, 0, 2, 4].
 */
export const SEEDED_ANSWERS = {
  completedSeats: 4,
  ridesDeparted: 5,
  fillRate: 0.8,
  medianResponseMin: 22.5,
  cohort: { size: 3, week: '2026-W42' },
  retention: 0.667,
  ridesCompleted: 3,
  reportsPer100: 66.67,
  accepted: 7,
  cancellationRate: 0.143,
  matchLaunch: { searches: 5, value: 0.4 },
  matchOverall: { searches: 8, value: 0.5 },
  corridors: [
    { corridor: 'south', searches: 3, value: 0.667 },
    { corridor: 'west', searches: 2, value: 0 },
    { corridor: 'campus', searches: 0, value: null },
    { corridor: 'other', searches: 3, value: 0.667 },
  ],
  series: [0, 0, 0, 0, 0, 0, 1, 4, 1, 0, 2, 4],
} as const;

/** Fixed ids: `...0000000` + kind (e1 profile, e2 ride, e3 booking, e4 report) + 3 digits. */
const SEED_PREFIX = '00000000-0000-4000-8000-0000000';
const seedId = (kind: 'e1' | 'e2' | 'e3' | 'e4', n: number) =>
  `${SEED_PREFIX}${kind}${String(n).padStart(3, '0')}`;

/**
 * Makes the first launch week hold exactly the data of SEEDED_ANSWERS (the story is in the header of the
 * pgTAP file: edges one hour either side of the local week boundaries, a no-show, a system cancel, a
 * retention cohort with a retained, an unretained and an out-of-cohort passenger, searches in four
 * corridors). Rows have fixed ids and the events carry `seed: 'e7'`, so a second call first removes the
 * first call's rows. Needs the superuser connection of the suites that move time.
 *
 * Returns `clean: false` when the week already holds data that is not the seed (another suite ran on the
 * same database in the same days): the exact-answer checks must then be skipped, not failed.
 */
export async function seedMetricsWeek(sql: postgres.Sql): Promise<{ clean: boolean }> {
  const L = (day: string, time: string) => bucharestLocalToUtc(day, time);
  const u = (n: number) => seedId('e1', n);
  const like = (kind: 'e1' | 'e2' | 'e3' | 'e4') => `${SEED_PREFIX}${kind}%`;

  // 1. Remove what an earlier call left.
  await sql`delete from app.bookings where id::text like ${like('e3')}`;
  await sql`delete from app.reports where id::text like ${like('e4')}`;
  await sql`delete from app.rides where id::text like ${like('e2')}`;
  await sql`delete from app.analytics_events where props ->> 'seed' = 'e7'`;
  await sql`delete from app.profiles where id::text like ${like('e1')}`;

  // 2. The window must hold nothing else (counts straight from the database functions).
  const [week] = await sql<{ n: number }[]>`
    select (completed_seats + rides_departed + requests + reports + accepted)::int as n
    from app.metrics_week(${SEEDED_WEEK.monday}::date, now())`;
  const [seats] = await sql<{ n: number }[]>`
    select coalesce(sum(completed_seats), 0)::int as n
    from app.metrics_seats_series(${SEEDED_WEEK.monday}::date, 12)`;
  const [searches] = await sql<{ n: number }[]>`
    select coalesce(sum(searches), 0)::int as n
    from app.metrics_match_by_corridor(${SEEDED_WEEK.monday}::date)`;
  const clean = (week?.n ?? 0) === 0 && (seats?.n ?? 0) === 0 && (searches?.n ?? 0) === 0;

  // 3. People: drivers u1 and u2, passengers and reporters u11..u18, cohort u21..u24.
  for (const n of [1, 2, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24]) {
    await sql`
      insert into app.profiles (id, first_name)
      values (${u(n)}::uuid, ${`Seed${n}`}) on conflict (id) do nothing`;
  }

  const [diesel] = await sql<{ id: string }[]>`
    select id from app.energy_prices where fuel_type = 'diesel' order by effective_from limit 1`;
  const [area] = await sql<{ id: string }[]>`select id from app.areas order by name limit 1`;
  const ride = async (
    n: number,
    driver: number,
    at: Date,
    status: 'completed' | 'published' | 'cancelled' = 'completed',
  ) => {
    await sql`
      insert into app.rides (id, driver_id, origin, destination, origin_label, destination_label,
        origin_area_id, destination_area_id, route, distance_m, duration_s, departure_at, seats_offered,
        energy_price_id, rate_micro_per_km, vehicle_snapshot, status, completed_at, cancelled_at)
      values (${seedId('e2', n)}::uuid, ${u(driver)}::uuid,
        ST_SetSRID(ST_MakePoint(24.15123, 45.70987), 4326), ST_SetSRID(ST_MakePoint(24.18654, 45.74321), 4326),
        'Strada Lunga 5', 'Piata Mare 1', ${area?.id ?? null}::uuid, ${area?.id ?? null}::uuid,
        ST_GeomFromText('LINESTRING(24.15123 45.70987, 24.17 45.725, 24.18654 45.74321)', 4326),
        5000, 600, ${at}::timestamptz, 3, ${diesel?.id ?? null}::uuid, 651000,
        '{"make":"Dacia","model":"Logan","colour":"Grey","plate":"SB12ABC","fuelType":"diesel"}'::jsonb,
        ${status}::app.ride_status,
        ${status === 'completed' ? new Date(at.getTime() + 2 * 3_600_000) : null}::timestamptz,
        ${status === 'cancelled' ? new Date(at.getTime() - 3_600_000) : null}::timestamptz)`;
  };
  const booking = async (
    n: number,
    passenger: number,
    rideN: number,
    status: 'completed' | 'no_show' | 'cancelled' | 'rejected' | 'expired' | 'requested',
    requested: Date,
    decidedAfterS: number | null,
    cancelledBy: 'driver' | 'system' | null = null,
  ) => {
    const locked = status === 'completed' || status === 'no_show';
    await sql`
      insert into app.bookings (id, ride_id, passenger_id, status, pickup, dropoff, pickup_label, dropoff_label,
        pickup_fraction, dropoff_fraction, segment_m, walk_pickup_m, walk_dropoff_m, price_quoted_bani,
        price_locked_bani, final_price_bani, requested_at, expires_at, decided_at, cancelled_at, cancelled_by,
        no_show_at, no_show_by, created_at)
      values (${seedId('e3', n)}::uuid, ${seedId('e2', rideN)}::uuid, ${u(passenger)}::uuid, ${status}::app.booking_status,
        ST_SetSRID(ST_MakePoint(24.16234, 45.71876), 4326), ST_SetSRID(ST_MakePoint(24.18123, 45.74012), 4326),
        'Selimbar', 'Centru', 0.2, 0.9, 3500, 100, 100, 180,
        ${locked ? 120 : null}::integer, ${status === 'completed' ? 120 : null}::integer,
        ${requested}::timestamptz, ${new Date(requested.getTime() + 30 * 60_000)}::timestamptz,
        ${decidedAfterS === null ? null : new Date(requested.getTime() + decidedAfterS * 1000)}::timestamptz,
        ${status === 'cancelled' ? new Date(requested.getTime() + 3_600_000) : null}::timestamptz,
        ${status === 'cancelled' ? cancelledBy : null}::text,
        ${status === 'no_show' ? new Date(requested.getTime() + 2 * 3_600_000) : null}::timestamptz,
        ${status === 'no_show' ? 'driver' : null}::text,
        ${requested}::timestamptz)`;
  };

  // 4. The week (Monday 2026-11-09, local time) and its neighbours.
  await ride(1, 1, L('2026-11-09', '00:30'));
  await ride(2, 1, L('2026-11-11', '08:00'));
  await ride(3, 1, L('2026-11-15', '23:30'));
  await ride(4, 2, L('2026-11-16', '00:30')); // next week
  await ride(5, 2, L('2026-11-12', '08:00'), 'published');
  await ride(6, 2, L('2026-11-13', '08:00'), 'cancelled');
  await ride(7, 2, L('2026-11-08', '23:30')); // previous week
  // Cohort rides (W-4 is 2026-10-12 to 18 local): a1 = 11, a2 = 12 (just after it), a3 = 13, a6 = 16, a7 = 17 (W-5).
  const cohortRides = {
    11: L('2026-10-13', '08:00'),
    12: L('2026-10-19', '00:30'),
    13: L('2026-11-03', '08:00'),
    16: L('2026-10-17', '23:30'),
    17: L('2026-10-11', '23:30'),
  } as const;
  await ride(11, 1, cohortRides[11]);
  await ride(12, 1, cohortRides[12]);
  await ride(13, 1, cohortRides[13]);
  await ride(16, 2, cohortRides[16]);
  await ride(17, 2, cohortRides[17]);

  await booking(1, 11, 1, 'completed', L('2026-11-09', '00:15'), 600);
  await booking(2, 12, 1, 'completed', L('2026-11-09', '10:00'), 1200);
  await booking(3, 11, 2, 'completed', L('2026-11-10', '10:00'), 1800);
  await booking(4, 13, 3, 'completed', L('2026-11-11', '10:00'), 300);
  await booking(5, 14, 4, 'completed', L('2026-11-16', '00:30'), 600);
  await booking(6, 15, 7, 'completed', L('2026-11-08', '23:30'), 600);
  await booking(7, 16, 2, 'no_show', L('2026-11-11', '11:00'), 900);
  await booking(8, 17, 6, 'cancelled', L('2026-11-12', '10:00'), 1500, 'driver');
  await booking(9, 18, 3, 'cancelled', L('2026-11-13', '10:00'), 2400, 'system');
  await booking(11, 12, 5, 'rejected', L('2026-11-10', '12:00'), 2700);
  await booking(12, 13, 5, 'expired', L('2026-11-10', '13:00'), null);
  await booking(13, 14, 5, 'requested', L('2026-11-15', '22:30'), null);
  const dayBefore = (ride: keyof typeof cohortRides) =>
    new Date(cohortRides[ride].getTime() - 86_400_000);
  await booking(21, 21, 11, 'completed', dayBefore(11), 300);
  await booking(22, 22, 11, 'completed', dayBefore(11), 300);
  await booking(23, 24, 11, 'completed', dayBefore(11), 300);
  await booking(24, 21, 13, 'completed', dayBefore(13), 300);
  await booking(25, 23, 16, 'completed', dayBefore(16), 300);
  await booking(26, 23, 12, 'completed', dayBefore(12), 300);
  await booking(27, 24, 17, 'completed', dayBefore(17), 300);

  const report = async (n: number, reporter: number, reported: number, at: Date) => {
    await sql`
      insert into app.reports (id, reporter_id, reported_id, reason, details, reported_snapshot, created_at)
      values (${seedId('e4', n)}::uuid, ${u(reporter)}::uuid, ${u(reported)}::uuid, 'harassment', ${`seed ${n}`},
              '{"firstName":"Seed1"}'::jsonb, ${at}::timestamptz)`;
  };
  await report(1, 11, 1, L('2026-11-09', '12:00'));
  await report(2, 12, 1, L('2026-11-15', '22:30'));
  await report(3, 13, 1, L('2026-11-16', '00:30')); // next week
  await report(4, 14, 1, L('2026-11-08', '22:30')); // previous week

  const search = async (props: Record<string, string | number>, at: Date) => {
    await sql`
      insert into app.analytics_events (name, user_id, props, occurred_at)
      values ('search_performed', null, ${JSON.stringify({ ...props, seed: 'e7' })}::text::jsonb, ${at}::timestamptz)`;
  };
  await search({ corridor: 'south', resultsCount: 3 }, L('2026-11-10', '12:00'));
  await search({ corridor: 'south', resultsCount: 0 }, L('2026-11-10', '12:01'));
  await search({ corridor: 'south', resultsCount: 1 }, L('2026-11-10', '12:02'));
  await search({ corridor: 'west', resultsCount: 0 }, L('2026-11-11', '12:00'));
  await search({ corridor: 'west', resultsCount: 'n/a' }, L('2026-11-11', '12:01'));
  await search({ corridor: 'other', resultsCount: 2 }, L('2026-11-12', '12:00'));
  await search({ resultsCount: 5 }, L('2026-11-12', '12:01'));
  await search({ corridor: 'mars', resultsCount: 0 }, L('2026-11-12', '12:02'));
  await search({ corridor: 'south', resultsCount: 1 }, L('2026-11-16', '00:30')); // next week
  await search({ corridor: 'south', resultsCount: 1 }, L('2026-11-08', '23:30')); // previous week
  return { clean };
}

// ---- E8: alerts and push ----------------------------------------------------------------------------------------

/** The ISO weekday (Monday = 1) and the `HH:MM` of an instant in Europe/Bucharest. */
export function localSlot(at: Date): { weekday: number; time: string; day: string } {
  const day = bucharestDayKey(at);
  const d = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bucharest',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  return { weekday: ((d + 6) % 7) + 1, time: p, day };
}

type Point = { lat: number; lng: number };

/**
 * POST /alerts for a route and a departure: a weekly alert for that local weekday and time (window 30
 * minutes) unless `over` says otherwise. Returns the raw response so tests can assert on errors.
 */
export function makeAlert(
  user: TestUser,
  route: { from: Point; to: Point },
  departure: Date,
  over: Record<string, unknown> = {},
): Promise<Response> {
  const slot = localSlot(departure);
  return user.send('POST', '/alerts', {
    from: route.from,
    to: route.to,
    fromLabel: 'Home',
    toLabel: 'Work',
    schedule: { kind: 'weekly', weekdays: [slot.weekday] },
    time: slot.time,
    windowMin: 30,
    ...over,
  });
}

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** Whether the stack has web push switched on (VAPID keys set): `GET /push/config`. */
export async function pushEnabled(): Promise<boolean> {
  const res = await fetch(`${BASE}/push/config`);
  if (!res.ok) return false;
  return ((await res.json()) as { vapidPublicKey: string | null }).vapidPublicKey !== null;
}

/**
 * PUT /me/push-subscription with a real P-256 key (what `PushSubscription.toJSON()` would send) on a
 * known push host. Returns the endpoint and the response.
 */
export async function makeSubscription(
  user: TestUser,
): Promise<{ endpoint: string; res: Response }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const endpoint = `https://fcm.googleapis.com/fcm/send/it-${crypto.randomUUID()}`;
  const res = await user.send('PUT', '/me/push-subscription', {
    endpoint,
    keys: { p256dh, auth },
    expirationTime: null,
  });
  return { endpoint, res };
}
