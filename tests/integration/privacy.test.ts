import { existsSync, readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  publicUserSchema,
  meResponseSchema,
} from '../../supabase/functions/_shared/contracts/account.ts';
import {
  bookingViewSchema,
  type BookingView,
} from '../../supabase/functions/_shared/contracts/bookings.ts';
import { errorEnvelopeSchema } from '../../supabase/functions/_shared/contracts/errors.ts';
import { dataExportRequestResponseSchema } from '../../supabase/functions/_shared/contracts/privacy.ts';
import {
  previewResponseSchema,
  rideOwnerViewSchema,
  type RideOwnerView,
} from '../../supabase/functions/_shared/contracts/rides.ts';
import { tickResponseSchema } from '../../supabase/functions/_shared/contracts/system.ts';
import {
  bucharestDayKey,
  bucharestLocalToUtc,
} from '../../supabase/functions/_shared/domain/time.ts';
import {
  BASE,
  DB_URL,
  SECRET,
  ageRide,
  createBareUser,
  createUser,
  type TestUser,
} from './factories.ts';

/**
 * Black-box privacy tests against the local stack (e6-privacy-spec §10), with ROUTING_PROVIDER=fixture
 * and EMAIL_PROVIDER=console. Skipped without the stack. They need the database directly to age rides
 * (retention), to give throw-away users an auth.users row (so the purge has something to remove) and to
 * run the leak scan: connects as the local superuser.
 *   INT_DB_URL       default postgresql://postgres:postgres@127.0.0.1:54322/postgres
 *   INT_DB=skip      skips the whole file
 *   CRON_SECRET      same value as the function's: lets the suite call POST /internal/tick (the tests that
 *                    run the tick are skipped without it)
 *   INT_LEGAL_BUMP=1 also runs the test that publishes legal text v1.3. It changes the current document
 *                    version for everyone for a moment, so run this file alone when you set it.
 * The function needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (set by `supabase functions serve`)
 * for the avatar and auth-user removal.
 */
const DB_SKIP = process.env.INT_DB === 'skip';
const CRON = process.env.CRON_SECRET;
const LEGAL_BUMP = process.env.INT_LEGAL_BUMP === '1';
/** Local stack API root and its service_role key (JWT form): for GoTrue's admin API. */
const AUTH_URL = (process.env.INT_SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/+$/, '');
const SERVICE_KEY = process.env.INT_SERVICE_ROLE_KEY;

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
const digits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const letters = (n: number) =>
  Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(
    '',
  );

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
const deleteMe = (who: TestUser, body: unknown = { confirm: 'DELETE' }) =>
  who.send('DELETE', '/me', body);

const tick = async () => {
  const res = await fetch(`${BASE}/internal/tick`, {
    method: 'POST',
    headers: { 'x-cron-secret': CRON ?? '' },
  });
  expect(res.status).toBe(200);
  return tickResponseSchema.parse(await res.json());
};

describe.skipIf(!BASE || !SECRET || DB_SKIP)('privacy against the local stack', () => {
  let sql: postgres.Sql;
  beforeAll(() => {
    sql = postgres(DB_URL, { max: 6, connect_timeout: 15, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  // ---- helpers over the database ------------------------------------------------------------------------------------

  /**
   * The purge removes the auth user, and the tick resolves addresses through it: give the user a real one.
   * Created through GoTrue's admin API so every column is the way GoTrue writes it (a hand-made row with NULL
   * columns makes GoTrue fail to load it). The profile trigger is on conflict do nothing, so the profile
   * that createUser made is kept. Falls back to a raw insert without the service key.
   */
  const withAuthRow = async (u: TestUser) => {
    if (SERVICE_KEY) {
      const res = await fetch(`${AUTH_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ id: u.id, email: u.email, email_confirm: true }),
      });
      // 422 = this id or email already exists (a second call for the same user)
      if (res.ok || res.status === 422) return;
    }
    await sql`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
      values (${u.id}::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${u.email}, '',
        '', '', '', '', '', '', '', '', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        now(), now(), now())
      on conflict (id) do nothing`;
  };
  const count = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;
  const rideRow = async (id: string) =>
    (
      await sql<{ status: string; seats_booked: number; coarsened_at: Date | null }[]>`
        select status::text, seats_booked, coarsened_at from app.rides where id = ${id}::uuid`
    )[0];
  const bookingRow = async (id: string) =>
    (
      await sql<{ status: string; cancelled_by: string | null; coarsened_at: Date | null }[]>`
        select status::text, cancelled_by, coarsened_at from app.bookings where id = ${id}::uuid`
    )[0];
  const profileRow = async (id: string) =>
    (
      await sql<
        {
          status: string;
          first_name: string | null;
          phone_e164: string | null;
          bio: string | null;
          photo_path: string | null;
        }[]
      >`select status::text, first_name, phone_e164, bio, photo_path from app.profiles where id = ${id}::uuid`
    )[0];
  /** Rows (any app table) whose text form contains the needle. `reports` keep their snapshot by design. */
  async function leaks(needles: string[]): Promise<string[]> {
    const tables = await sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'app' and tablename <> 'reports'`;
    const found: string[] = [];
    for (const { tablename } of tables) {
      for (const needle of needles) {
        const rows = await sql.unsafe<{ n: number }[]>(
          `select count(*)::int as n from app."${tablename}" t where t::text like $1`,
          [`%${needle}%`],
        );
        if ((rows[0]?.n ?? 0) > 0) found.push(`${tablename}:${needle}`);
      }
    }
    return found;
  }
  const violations = async (ids?: string[]) =>
    count(
      ids
        ? sql`select count(*)::int as n from app.location_retention_violations(now())
              where id = any(${ids}::uuid[])`
        : sql`select count(*)::int as n from app.location_retention_violations(now())`,
    );

  /** A user with a unique phone, plate and bio, so the leak scan can look for them. */
  async function marked(firstName: string) {
    const phone = `07${digits(8)}`;
    const plate = `SB${digits(2)}${letters(3)}`;
    const bio = `bio-${crypto.randomUUID().slice(0, 8)}`;
    const u = await createUser({ firstName, vehicle: { plate } });
    expect((await u.send('PATCH', '/me/profile', { phone, bio })).status).toBe(200);
    const me = meResponseSchema.parse(await (await u.call('/me')).json());
    const row = await profileRow(u.id);
    return {
      u,
      me,
      phoneE164: row?.phone_e164 as string,
      plate,
      bio,
      photoPath: row?.photo_path as string,
    };
  }

  /** A published future ride with one booking requested by `p` (approved when `approve`). */
  async function seat(driver: TestUser, p: TestUser, approve: boolean) {
    const l = lane();
    const ride = await publish(driver, l, departure());
    const res = await requestSeat(p, ride.id, middle(l));
    expect(res.status).toBe(201);
    const b = bookingViewSchema.parse(await res.json());
    if (approve)
      expect((await driver.send('POST', `/bookings/${b.id}/approve`, {})).status).toBe(200);
    return { l, ride, bookingId: b.id };
  }

  // ---- DELETE /me: a driver ----------------------------------------------------------------------------------------------------

  it('a driver with a future ride deletes: passengers are told, the account is a tombstone, nothing leaks', async () => {
    const d = await marked('Radu');
    const [p1, p2] = await Promise.all([
      createUser({ firstName: 'Ioana' }),
      createUser({ firstName: 'Mihai' }),
    ]);
    await withAuthRow(d.u);
    const l = lane();
    const ride = await publish(d.u, l, departure());
    const one = bookingViewSchema.parse(await (await requestSeat(p1, ride.id, middle(l))).json());
    expect((await d.u.send('POST', `/bookings/${one.id}/approve`, {})).status).toBe(200); // confirmed
    const two = bookingViewSchema.parse(await (await requestSeat(p2, ride.id, middle(l))).json()); // requested
    expect(await rideRow(ride.id)).toMatchObject({ status: 'published', seats_booked: 1 });

    // the avatar is public before deletion
    expect((await fetch(d.me.photoUrl as string)).ok).toBe(true);
    expect(await leaks([d.phoneE164, d.plate, d.bio])).not.toEqual([]); // the scan can find them

    expect((await deleteMe(d.u)).status).toBe(204);

    // the future ride is cancelled by the system and both seats are gone
    expect(await rideRow(ride.id)).toMatchObject({ status: 'cancelled', seats_booked: 0 });
    expect(await bookingRow(one.id)).toMatchObject({ status: 'cancelled', cancelled_by: 'system' });
    expect(await bookingRow(two.id)).toMatchObject({ status: 'cancelled', cancelled_by: 'system' });
    for (const [p, b] of [
      [p1, one],
      [p2, two],
    ] as const) {
      expect(
        await count(sql`select count(*)::int as n from app.outbox
          where template = 'ride_cancelled' and user_id = ${p.id}::uuid
            and payload ->> 'bookingId' = ${b.id} and payload ->> 'by' = 'system'`),
      ).toBe(1);
    }

    // the account is gone for the owner and a tombstone for everyone else
    const gone = await d.u.call('/me');
    expect(gone.status).toBe(403);
    expect((await errorOf(gone)).code).toBe('ACCOUNT_DELETED');
    expect((await deleteMe(d.u)).status).toBe(204); // idempotent
    expect(await getProfile(p1, d.u.id)).toMatchObject({
      firstName: null,
      photoUrl: null,
      bio: null,
      rating: null,
    });
    expect(await profileRow(d.u.id)).toMatchObject({
      status: 'deleted',
      first_name: null,
      phone_e164: null,
      bio: null,
      photo_path: null,
    });

    // outside systems: the avatar object and the auth user are removed, the queue row is closed
    expect((await fetch(d.me.photoUrl as string)).status).toBeGreaterThanOrEqual(400);
    expect(
      await count(sql`select count(*)::int as n from auth.users where id = ${d.u.id}::uuid`),
    ).toBe(0);
    const [queue] = await sql<{ completed_at: Date | null; photo_path: string | null }[]>`
      select completed_at, photo_path from app.account_deletions where user_id = ${d.u.id}::uuid`;
    expect(queue?.completed_at).not.toBeNull();
    expect(queue?.photo_path).toBeNull();

    // no phone, plate, bio, photo path or vehicle left anywhere (reports keep their snapshot by design)
    expect(await leaks([d.phoneE164, d.plate, d.bio, d.photoPath])).toEqual([]);
    expect(
      await count(
        sql`select count(*)::int as n from app.vehicles where owner_id = ${d.u.id}::uuid`,
      ),
    ).toBe(0);
  });

  // ---- DELETE /me: a passenger ----------------------------------------------------------------------------------------------

  it('a passenger deletes: the driver hears about the confirmed seat and the seat is free again', async () => {
    const driver = await createUser({ firstName: 'Radu' });
    const p = await marked('Ioana');
    const { ride, bookingId } = await seat(driver, p.u, true);
    expect(await rideRow(ride.id)).toMatchObject({ seats_booked: 1 });

    expect((await deleteMe(p.u)).status).toBe(204);

    expect(await bookingRow(bookingId)).toMatchObject({
      status: 'cancelled',
      cancelled_by: 'system',
    });
    expect(await rideRow(ride.id)).toMatchObject({ status: 'published', seats_booked: 0 });
    expect(
      await count(sql`select count(*)::int as n from app.outbox
        where template = 'booking_cancelled' and user_id = ${driver.id}::uuid
          and payload ->> 'bookingId' = ${bookingId}`),
    ).toBe(1);
    expect(await leaks([p.phoneE164, p.bio, p.photoPath])).toEqual([]);
  });

  it('a suspended user, and one who never accepted the terms, can delete', async () => {
    const s = await createUser({ firstName: 'Ana' });
    await sql`select app.admin_suspend_user(${s.id}::uuid, 'privacy test')`;
    expect((await s.call('/me')).status).toBe(403);
    expect((await deleteMe(s)).status).toBe(204);
    expect((await profileRow(s.id))?.status).toBe('deleted');

    const bare = await createBareUser();
    expect((await bare.call('/me/profile', { method: 'PATCH' })).status).toBeGreaterThanOrEqual(
      400,
    );
    expect((await deleteMe(bare)).status).toBe(204);
    expect((await profileRow(bare.id))?.status).toBe('deleted');
  });

  it('refuses a missing or wrong confirmation and deletes nothing', async () => {
    const u = await createUser({ firstName: 'Vlad' });
    // No body at all goes through send() directly: deleteMe's default would add the confirmation.
    const attempts = [
      () => u.send('DELETE', '/me'),
      () => deleteMe(u, {}),
      () => deleteMe(u, { confirm: 'delete' }),
      () => deleteMe(u, { confirm: 'yes' }),
    ];
    for (const attempt of attempts) {
      const res = await attempt();
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe('CONFIRMATION_REQUIRED');
    }
    expect((await profileRow(u.id))?.status).toBe('active');
    expect((await u.call('/me')).status).toBe(200);
  });

  it('a deleted account stays anonymous in the booking and the ratings stay', async () => {
    if (!CRON) return;
    const driver = await createUser({ firstName: 'Radu' });
    const p = await createUser({ firstName: 'Ioana' });
    await Promise.all([withAuthRow(driver), withAuthRow(p)]);
    const { ride, bookingId } = await seat(driver, p, true);
    await sql`update app.rides set departure_at = now() - interval '130 minutes' where id = ${ride.id}::uuid`;
    await tick();
    expect((await rideRow(ride.id))?.status).toBe('completed');

    // the passenger rates the driver, then the driver deletes the account
    expect(
      (await p.send('POST', `/bookings/${bookingId}/ratings`, { stars: 5, tags: [] })).status,
    ).toBe(201);
    expect((await deleteMe(driver)).status).toBe(204);

    const view = await getBooking(p, bookingId);
    expect(view.driver).toMatchObject({ firstName: null, photoUrl: null, bio: null });
    expect(view.status).toBe('completed'); // a finished ride is not cancelled
    expect(
      await count(
        sql`select count(*)::int as n from app.ratings where booking_id = ${bookingId}::uuid`,
      ),
    ).toBe(1);
    // the driver's phone disappeared from the reveal with the account (accepted, ADR 0029)
    expect(view.contact).toBeNull();
    // the deleted driver cannot call anything any more
    expect((await driver.call(`/bookings/${bookingId}`)).status).toBe(403);
    // ratings are kept for the counterpart, but the public summary of a tombstone is empty
    expect(await getProfile(p, driver.id)).toMatchObject({ firstName: null, rating: null });
  });

  // ---- retention: coarsening through the tick -----------------------------------------------------------------------------

  it.skipIf(!CRON)(
    'the tick coarsens rides and bookings older than 90 days and leaves younger ones',
    async () => {
      const make = async (days: number) => {
        const driver = await createUser({ firstName: 'Radu' });
        const p = await createUser({ firstName: 'Ioana' });
        await Promise.all([withAuthRow(driver), withAuthRow(p)]);
        const c = await seat(driver, p, true);
        await ageRide(sql, c.ride.id, days);
        return { driver, p, ...c };
      };
      const old = await make(91);
      const young = await make(89);

      const out = await tick();
      expect(out.coarsened).toBeGreaterThanOrEqual(2);
      // a busy shared database may need more than one batch
      for (let i = 0; i < 3 && (await violations([old.ride.id, old.bookingId])) > 0; i++)
        await tick();

      // the proof, by geometry: nothing exact left on the old ride or booking, and the whole table is clean
      expect(await violations([old.ride.id, old.bookingId])).toBe(0);
      expect(await violations()).toBe(0);
      expect((await rideRow(old.ride.id))?.coarsened_at).not.toBeNull();
      expect((await bookingRow(old.bookingId))?.coarsened_at).not.toBeNull();
      const [kept] = await sql<
        { route_is_null: boolean; note_is_null: boolean; has_plate: boolean; distance_m: number }[]
      >`
      select route is null as route_is_null, note is null as note_is_null,
             jsonb_exists(vehicle_snapshot, 'plate') as has_plate, distance_m
      from app.rides where id = ${old.ride.id}::uuid`;
      expect(kept).toMatchObject({ route_is_null: true, note_is_null: true, has_plate: false });
      expect(kept?.distance_m).toBeGreaterThan(0);

      // the passenger still sees the booking, with approximate points and no route
      const view = await getBooking(old.p, old.bookingId);
      expect(view.status).toBe('completed');
      expect(view.pickup.point).toMatchObject({ approx: true });
      expect(view.route).toBeNull();
      expect(view.price.finalBani).not.toBeNull();

      // a ride 89 days old is untouched
      expect((await rideRow(young.ride.id))?.coarsened_at).toBeNull();
      expect((await bookingRow(young.bookingId))?.coarsened_at).toBeNull();
      expect(await violations([young.ride.id, young.bookingId])).toBe(0); // not due yet, so not a violation
    },
  );

  // ---- legal texts ------------------------------------------------------------------------------------------------------------------

  it('the newest published legal versions equal the version in the web content files', async () => {
    const files = {
      terms: '../../apps/web/src/features/policy/content/terms.v1_2.en.ts',
      privacy: '../../apps/web/src/features/policy/content/privacy.v1_2.en.ts',
    } as const;
    for (const kind of ['terms', 'privacy'] as const) {
      const path = new URL(files[kind], import.meta.url);
      if (!existsSync(path)) continue; // the web content ships in the same PR
      const version = /version:\s*'([^']+)'/.exec(readFileSync(path, 'utf8'))?.[1];
      const [row] = await sql<{ version: string }[]>`
        select version from app.legal_documents where kind = ${kind}::app.consent_kind
        order by published_at desc limit 1`;
      expect(version).toBe(row?.version);
    }
  });

  it.skipIf(!LEGAL_BUMP)(
    'a new legal version asks for re-acceptance but never blocks deletion',
    async () => {
      const u = await createUser({ firstName: 'Legal' });
      const before = await (await fetch(`${BASE}/legal/current`)).json();
      try {
        await sql`
        insert into app.legal_documents (kind, version, published_at, url) values
          ('terms', '1.3', now() - interval '1 minute', '/policy/terms'),
          ('privacy', '1.3', now() - interval '1 minute', '/policy/privacy')`;
        const me = meResponseSchema.parse(await (await u.call('/me')).json());
        expect(me.consent).toMatchObject({ upToDate: false, reaccept: true });
        expect(me.consent.required).toEqual(['terms', 'privacy']);
        const gated = await u.send('PATCH', '/me/profile', { bio: 'x' });
        expect(gated.status).toBe(403);
        expect((await errorOf(gated)).code).toBe('CONSENT_REQUIRED');

        // accepting needs no age18 again
        const ok = await u.send('POST', '/me/consents', {
          termsVersion: '1.3',
          privacyVersion: '1.3',
        });
        expect(ok.status).toBe(204);
        expect(meResponseSchema.parse(await (await u.call('/me')).json()).consent).toMatchObject({
          upToDate: true,
          reaccept: false,
        });

        // a user who has not accepted can still delete
        const other = await createUser({ firstName: 'Late' });
        await sql`delete from app.consents where user_id = ${other.id}::uuid and document_version = '1.3'`;
        expect((await deleteMe(other)).status).toBe(204);
      } finally {
        await sql`delete from app.legal_documents where version = '1.3'`;
      }
      expect(await (await fetch(`${BASE}/legal/current`)).json()).toEqual(before);
    },
  );

  // ---- request my data --------------------------------------------------------------------------------------------------------------

  it('a data request is recorded, mailed to support and acknowledged, and a repeat is deduplicated', async () => {
    const u = await createUser({ firstName: 'Data' });
    await withAuthRow(u); // the export reads the address from auth.users
    const first = await u.send('POST', '/me/data-export-request', {});
    expect(first.status).toBe(202);
    const body = dataExportRequestResponseSchema.parse(await first.json());
    expect(new Date(body.dueBy).getTime() - new Date(body.requestedAt).getTime()).toBe(
      30 * 86_400_000,
    );

    const rows = await sql<{ id: string; kind: string; fulfilled_at: Date | null }[]>`
      select id, kind, fulfilled_at from app.data_requests where user_id = ${u.id}::uuid`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: body.requestId, kind: 'export', fulfilled_at: null });
    const mails = await sql<{ template: string; payload: Record<string, unknown> }[]>`
      select template, payload from app.outbox
      where user_id = ${u.id}::uuid and template in ('data_export_requested', 'data_export_ack')
      order by template`;
    expect(mails.map((m) => m.template)).toEqual(['data_export_ack', 'data_export_requested']);
    expect(JSON.stringify(mails)).not.toContain(u.email); // addresses are looked up at send time

    const again = await u.send('POST', '/me/data-export-request', {});
    expect(again.status).toBe(202);
    expect(dataExportRequestResponseSchema.parse(await again.json()).requestId).toBe(
      body.requestId,
    );
    expect(
      await count(
        sql`select count(*)::int as n from app.data_requests where user_id = ${u.id}::uuid`,
      ),
    ).toBe(1);
    expect(
      await count(sql`select count(*)::int as n from app.outbox
        where user_id = ${u.id}::uuid and template in ('data_export_requested', 'data_export_ack')`),
    ).toBe(2);

    // there is no way to download the export through the API role
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role haide_api`;
        await tx`select app.export_user_data(${u.id}::uuid)`;
      }),
    ).rejects.toThrow();
    const exported = await sql<{ data: { account: { email: string } } }[]>`
      select app.export_user_data(${u.id}::uuid) as data`;
    expect(exported[0]?.data.account.email).toBe(u.email);
  });

  it('a deleted account cannot ask for its data', async () => {
    const u = await createUser({ firstName: 'Gone' });
    expect((await deleteMe(u)).status).toBe(204);
    const res = await u.send('POST', '/me/data-export-request', {});
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('ACCOUNT_DELETED');
  });

  // ---- concurrency (spec D1, D2) ---------------------------------------------------------------------------------------------------

  it.skipIf(!CRON)(
    'D1: a deletion racing a booking request leaves no active booking after one tick',
    async () => {
      const driver = await createUser({ firstName: 'Radu' });
      const p = await createUser({ firstName: 'Ioana' });
      await Promise.all([withAuthRow(driver), withAuthRow(p)]);
      const l = lane();
      const ride = await publish(driver, l, departure());
      const [del, req] = await Promise.all([deleteMe(driver), requestSeat(p, ride.id, middle(l))]);
      expect(del.status).toBe(204);
      expect([201, 404, 409]).toContain(req.status); // the request wins, loses cleanly or is refused

      await tick();
      expect(await rideRow(ride.id)).toMatchObject({ status: 'cancelled', seats_booked: 0 });
      expect(
        await count(sql`select count(*)::int as n from app.bookings
        where ride_id = ${ride.id}::uuid and status in ('requested', 'confirmed')`),
      ).toBe(0);
    },
  );

  it('D2: two parallel deletions both answer 204 and leave one purge queue row', async () => {
    const u = await createUser({ firstName: 'Twice' });
    const [a, b] = await Promise.all([deleteMe(u), deleteMe(u)]);
    expect([a.status, b.status]).toEqual([204, 204]);
    expect(
      await count(
        sql`select count(*)::int as n from app.account_deletions where user_id = ${u.id}::uuid`,
      ),
    ).toBe(1);
    expect((await profileRow(u.id))?.status).toBe('deleted');
  });

  it.skipIf(!CRON)('the tick retries a deletion whose outside steps are still open', async () => {
    const u = await createUser({ firstName: 'Retry' });
    await withAuthRow(u);
    expect((await deleteMe(u)).status).toBe(204);
    // put the row back as if both outside calls had failed once, then let the tick finish it
    await withAuthRow(u);
    await sql`update app.account_deletions
      set completed_at = null, auth_done_at = null, attempts = 1, next_attempt_at = now() - interval '1 minute'
      where user_id = ${u.id}::uuid`;
    const out = await tick();
    expect(out.accountsPurged).toBeGreaterThanOrEqual(1);
    expect(
      await count(sql`select count(*)::int as n from auth.users where id = ${u.id}::uuid`),
    ).toBe(0);
    expect(
      await count(sql`select count(*)::int as n from app.account_deletions
        where user_id = ${u.id}::uuid and completed_at is not null`),
    ).toBe(1);
  });
});
