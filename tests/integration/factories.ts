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
  // The current document versions change with each legal text (1.0, then 1.1 from E6): ask the API.
  const legal = (await (await fetch(`${BASE}/legal/current`)).json()) as {
    terms: { version: string };
    privacy: { version: string };
  };
  await must(
    await user.send('POST', '/me/consents', {
      age18: true,
      termsVersion: legal.terms.version,
      privacyVersion: legal.privacy.version,
    }),
    'consent',
  );
  await must(
    await user.send('PATCH', '/me/profile', {
      firstName: opts.firstName ?? 'Radu',
      phone: '0721 234 567',
    }),
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
