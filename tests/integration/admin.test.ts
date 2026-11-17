import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminErrorsResponseSchema,
  adminMetricsResponseSchema,
  adminOpsResponseSchema,
  adminReportsResponseSchema,
  adminUsersResponseSchema,
  createEnergyPriceResponseSchema,
  energyPricesResponseSchema,
} from '../../supabase/functions/_shared/contracts/admin.ts';
import { bookingViewSchema } from '../../supabase/functions/_shared/contracts/bookings.ts';
import { errorEnvelopeSchema } from '../../supabase/functions/_shared/contracts/errors.ts';
import {
  previewResponseSchema,
  rideOwnerViewSchema,
  type RideOwnerView,
} from '../../supabase/functions/_shared/contracts/rides.ts';
import { reportResponseSchema } from '../../supabase/functions/_shared/contracts/safety.ts';
import { tickResponseSchema } from '../../supabase/functions/_shared/contracts/system.ts';
import {
  bucharestDayKey,
  bucharestLocalToUtc,
} from '../../supabase/functions/_shared/domain/time.ts';
import {
  BASE,
  DB_URL,
  SECRET,
  SEEDED_ANSWERS,
  SEEDED_WEEK,
  createUser,
  makeAdmin,
  seedMetricsWeek,
  type TestUser,
} from './factories.ts';

/**
 * Black-box admin tests against the local stack (e7-metrics-admin-spec §9), with ROUTING_PROVIDER=fixture
 * and EMAIL_PROVIDER=console. Skipped without the stack. They connect to the database as the local superuser
 * to promote an admin (no endpoint can), to seed the metrics week and to check audit rows.
 *   INT_DB_URL   default postgresql://postgres:postgres@127.0.0.1:54322/postgres
 *   INT_DB=skip  skips the whole file
 *   CRON_SECRET  same value as the function's: lets the suite call POST /internal/tick (the tests that
 *                run the tick are skipped without it)
 *
 * Isolation: scenarios use freshly created users and their own lane and day. The energy tests use the
 * `electric` fuel type, which no other suite prices, and move its timeline forward only.
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
const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();

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

const requestSeat = (p: TestUser, rideId: string, trip: Trip) =>
  p.call('/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': uuid() },
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

/** The values of every string and the keys of every object, recursively. */
function walk(value: unknown, onKey: (k: string) => void, onString: (s: string) => void): void {
  if (typeof value === 'string') onString(value);
  else if (Array.isArray(value)) for (const v of value) walk(v, onKey, onString);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      onKey(k);
      walk(v, onKey, onString);
    }
  }
}

describe.skipIf(!BASE || !SECRET || DB_SKIP)('admin against the local stack', () => {
  let sql: postgres.Sql;
  let admin: TestUser;
  let plain: TestUser;

  beforeAll(async () => {
    sql = postgres(DB_URL, { max: 6, connect_timeout: 15, onnotice: () => {} });
    admin = await makeAdmin(sql);
    plain = await createUser({ vehicle: null });
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** The tick resolves email addresses through auth.users: give a test user a row there. */
  const withAuthRow = async (u: TestUser) => {
    await sql`
      insert into auth.users (id, instance_id, aud, role, email)
      values (${u.id}::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${u.email})
      on conflict (id) do nothing`;
  };
  const count = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;
  const profileStatus = async (id: string) =>
    (
      await sql<{ status: string }[]>`select status::text from app.profiles where id = ${id}::uuid`
    )[0]?.status;
  const outboxRows = (userId: string, template: string) =>
    sql<{ payload: Record<string, unknown>; status: string }[]>`
      select payload, status::text from app.outbox
      where user_id = ${userId}::uuid and template = ${template} order by created_at`;
  const auditRows = (action: string, filter: { target?: string; report?: string }) =>
    sql<{ admin_id: string | null; details: Record<string, unknown>; report_id: string | null }[]>`
      select admin_id, details, report_id from app.admin_actions
      where action = ${action}
        and (${filter.target ?? null}::uuid is null or target_user_id = ${filter.target ?? null}::uuid)
        and (${filter.report ?? null}::uuid is null or report_id = ${filter.report ?? null}::uuid)
      order by created_at`;

  const fileReport = async (
    reporter: TestUser,
    reported: TestUser,
    extra: Record<string, unknown> = {},
  ) => {
    const res = await reporter.send('POST', '/reports', {
      reportedUserId: reported.id,
      reason: 'harassment',
      details: 'Repeated unwanted messages.',
      ...extra,
    });
    expect(res.status).toBe(201);
    return reportResponseSchema.parse(await res.json()).id;
  };

  const STATEMENT = 'You sent repeated unwanted messages after a passenger asked you to stop.';

  // ---- gates: every route, anonymous and plain user ----------------------------------------------------------

  const ROUTES: [string, string, unknown?][] = [
    ['GET', '/admin/metrics'],
    ['GET', '/admin/reports'],
    ['POST', `/admin/reports/${uuid()}/dismiss`, {}],
    ['POST', `/admin/users/${uuid()}/suspend`, { reasonCode: 'other', statement: STATEMENT }],
    ['POST', `/admin/users/${uuid()}/unsuspend`, {}],
    ['GET', '/admin/users?status=suspended'],
    ['GET', '/admin/energy-prices'],
    [
      'POST',
      '/admin/energy-prices',
      { fuelType: 'electric', priceMilli: 1400, consumptionCenti: 1700, sourceNote: 'gate test' },
    ],
    ['GET', '/admin/ops'],
    ['GET', '/admin/errors'],
  ];

  it.each(ROUTES)(
    '%s %s: 401 for nobody, 403 FORBIDDEN for a plain user',
    async (method, path, body) => {
      const anon = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      expect(anon.status).toBe(401);
      const res = await plain.send(method, path, body);
      expect(res.status).toBe(403);
      expect((await errorOf(res)).code).toBe('FORBIDDEN');
    },
  );

  it('a suspended admin gets ACCOUNT_SUSPENDED, and the role is read on every request', async () => {
    const other = await makeAdmin(sql, { firstName: 'Temp' });
    expect((await other.call('/admin/ops')).status).toBe(200);
    await sql`update app.profiles set role = 'user' where id = ${other.id}::uuid`;
    expect((await other.call('/admin/ops')).status).toBe(403);
    await sql`update app.profiles set role = 'admin', status = 'suspended' where id = ${other.id}::uuid`;
    const res = await other.call('/admin/ops');
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('ACCOUNT_SUSPENDED');
  });

  // ---- reports: list and dismiss -------------------------------------------------------------------------------------

  it('a report is listed in the queue, dismissed once, and audited', async () => {
    const [reporter, reported] = await Promise.all([
      createUser({ vehicle: null }),
      createUser({ vehicle: null }),
    ]);
    const reportId = await fileReport(reporter, reported);

    const open = await admin.call('/admin/reports?status=open&limit=50');
    expect(open.status).toBe(200);
    const queue = adminReportsResponseSchema.parse(await open.json());
    const item = queue.items.find((i) => i.id === reportId);
    expect(item).toBeDefined();
    expect(item?.status).toBe('open');
    expect(item?.reporter.id).toBe(reporter.id);
    expect(item?.reported.id).toBe(reported.id);
    expect(item?.reported.openReports).toBeGreaterThanOrEqual(1);
    expect(item?.details).toBe('Repeated unwanted messages.');

    const dismissed = await admin.send('POST', `/admin/reports/${reportId}/dismiss`, {
      note: 'No evidence.',
    });
    expect(dismissed.status).toBe(204);
    expect(
      (
        await sql<{ status: string; resolved_by: string }[]>`
          select status::text, resolved_by from app.reports where id = ${reportId}::uuid`
      )[0],
    ).toEqual({ status: 'dismissed', resolved_by: admin.id });
    const audit = await auditRows('dismiss_report', { report: reportId });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.admin_id).toBe(admin.id);
    expect(audit[0]?.details).toEqual({ note: 'No evidence.' });
    // Nobody is told about a dismissal.
    expect(
      await count(
        sql`select count(*)::int as n from app.outbox where user_id = ${reported.id}::uuid`,
      ),
    ).toBe(0);

    const list = adminReportsResponseSchema.parse(
      await (await admin.call('/admin/reports?status=dismissed&limit=50')).json(),
    );
    expect(list.items.some((i) => i.id === reportId)).toBe(true);
    expect(
      adminReportsResponseSchema
        .parse(await (await admin.call('/admin/reports?status=open&limit=50')).json())
        .items.some((i) => i.id === reportId),
    ).toBe(false);

    const again = await admin.send('POST', `/admin/reports/${reportId}/dismiss`, {});
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('INVALID_STATE');
    expect((await admin.send('POST', `/admin/reports/${uuid()}/dismiss`, {})).status).toBe(404);
  });

  it('pages the queue with a cursor', async () => {
    const first = adminReportsResponseSchema.parse(
      await (await admin.call('/admin/reports?status=all&limit=1')).json(),
    );
    expect(first.items).toHaveLength(1);
    if (first.nextCursor === null) return; // a database with a single report
    const second = adminReportsResponseSchema.parse(
      await (
        await admin.call(
          `/admin/reports?status=all&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
        )
      ).json(),
    );
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect((await admin.call('/admin/reports?cursor=%40%40')).status).toBe(400);
  });

  // ---- suspend, the tick sweep, unsuspend --------------------------------------------------------------------------------

  it('suspending from a report: audited, the user is told, the sweep cancels, unsuspend reinstates', async () => {
    const [driver, p] = await Promise.all([
      createUser({ firstName: 'Radu' }),
      createUser({ firstName: 'Ioana' }),
    ]);
    await Promise.all([withAuthRow(driver), withAuthRow(p)]);
    const l = lane();
    const ride = await publish(driver, l, departure());
    const booked = await requestSeat(p, ride.id, middle(l));
    expect(booked.status).toBe(201);
    const bookingId = bookingViewSchema.parse(await booked.json()).id;
    expect((await driver.send('POST', `/bookings/${bookingId}/approve`, {})).status).toBe(200);
    const reportId = await fileReport(p, driver, { bookingId });

    const res = await admin.send('POST', `/admin/users/${driver.id}/suspend`, {
      reasonCode: 'harassment',
      statement: STATEMENT,
      reportId,
    });
    expect(res.status).toBe(204);

    // State, audit and the report.
    expect(await profileStatus(driver.id)).toBe('suspended');
    const audit = await auditRows('suspend', { target: driver.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      admin_id: admin.id,
      report_id: reportId,
      details: { reason: STATEMENT, reasonCode: 'harassment' },
    });
    expect(
      (
        await sql<
          { status: string }[]
        >`select status::text from app.reports where id = ${reportId}::uuid`
      )[0]?.status,
    ).toBe('actioned');

    // The statement of reasons is queued for the suspended user: ground and statement, nothing else.
    const notices = await outboxRows(driver.id, 'account_suspended');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.payload).toEqual({ reasonCode: 'harassment', statement: STATEMENT });

    // The suspended user is locked out and listed.
    const locked = await driver.call('/me/rides');
    expect(locked.status).toBe(403);
    expect((await errorOf(locked)).code).toBe('ACCOUNT_SUSPENDED');
    const listed = adminUsersResponseSchema.parse(
      await (await admin.call('/admin/users?status=suspended')).json(),
    );
    const row = listed.items.find((i) => i.user.id === driver.id);
    expect(row).toMatchObject({
      reasonCode: 'harassment',
      statement: STATEMENT,
      adminFirstName: 'Admina',
    });
    expect(row?.user.status).toBe('suspended');

    // A second suspension is a conflict, a wrong report a validation error.
    const twice = await admin.send('POST', `/admin/users/${driver.id}/suspend`, {
      reasonCode: 'other',
      statement: STATEMENT,
    });
    expect(twice.status).toBe(409);
    expect((await errorOf(twice)).code).toBe('INVALID_STATE');

    if (CRON) {
      // The sweep cancels the future ride within a tick and notifies the passenger; the dispatcher
      // sends the suspension notice although the account is suspended (ANY_STATUS_TEMPLATES).
      for (let i = 0; i < 5; i++) {
        await tick();
        const [sent] = await outboxRows(driver.id, 'account_suspended');
        if (sent?.status === 'sent') break;
      }
      expect(
        (
          await sql<
            { status: string }[]
          >`select status::text from app.rides where id = ${ride.id}::uuid`
        )[0]?.status,
      ).toBe('cancelled');
      const cancelled = await outboxRows(p.id, 'ride_cancelled');
      expect(
        cancelled.some((r) => r.payload.bookingId === bookingId && r.payload.by === 'system'),
      ).toBe(true);
      expect((await outboxRows(driver.id, 'account_suspended'))[0]?.status).toBe('sent');
    }

    // Unsuspend: back to active, a reinstatement notice, the cancelled ride stays cancelled.
    const back = await admin.send('POST', `/admin/users/${driver.id}/unsuspend`, {
      note: 'Appeal accepted.',
    });
    expect(back.status).toBe(204);
    expect(await profileStatus(driver.id)).toBe('active');
    expect((await auditRows('unsuspend', { target: driver.id }))[0]).toMatchObject({
      admin_id: admin.id,
      details: { note: 'Appeal accepted.' },
    });
    const reinstated = await outboxRows(driver.id, 'account_reinstated');
    expect(reinstated).toHaveLength(1);
    expect(reinstated[0]?.payload).toEqual({});
    expect((await driver.call('/me/rides')).status).toBe(200);
    expect((await admin.send('POST', `/admin/users/${driver.id}/unsuspend`, {})).status).toBe(409);
  });

  it('two suspensions in parallel: one 204, one 409, one audit row', async () => {
    const victim = await createUser({ vehicle: null });
    const body = { reasonCode: 'other', statement: STATEMENT };
    const results = await Promise.all([
      admin.send('POST', `/admin/users/${victim.id}/suspend`, body),
      admin.send('POST', `/admin/users/${victim.id}/suspend`, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(await auditRows('suspend', { target: victim.id })).toHaveLength(1);
    expect(await outboxRows(victim.id, 'account_suspended')).toHaveLength(1);
  });

  it('suspend validation: self, unknown user, wrong report, bad statement', async () => {
    const [victim, other] = await Promise.all([
      createUser({ vehicle: null }),
      createUser({ vehicle: null }),
    ]);
    const self = await admin.send('POST', `/admin/users/${admin.id}/suspend`, {
      reasonCode: 'other',
      statement: STATEMENT,
    });
    expect(self.status).toBe(400);
    expect((await errorOf(self)).fields).toEqual({ userId: 'self' });
    expect(
      (
        await admin.send('POST', `/admin/users/${uuid()}/suspend`, {
          reasonCode: 'other',
          statement: STATEMENT,
        })
      ).status,
    ).toBe(404);

    const reportAboutOther = await fileReport(victim, other);
    const mismatch = await admin.send('POST', `/admin/users/${victim.id}/suspend`, {
      reasonCode: 'harassment',
      statement: STATEMENT,
      reportId: reportAboutOther,
    });
    expect(mismatch.status).toBe(400);
    expect((await errorOf(mismatch)).fields).toEqual({ reportId: 'mismatch' });

    for (const statement of [
      'too short',
      'x'.repeat(301),
      'Call him on +40721234567 to settle this.',
    ]) {
      const bad = await admin.send('POST', `/admin/users/${victim.id}/suspend`, {
        reasonCode: 'other',
        statement,
      });
      expect(bad.status).toBe(400);
      expect((await errorOf(bad)).fields).toHaveProperty('statement');
    }
    expect(await profileStatus(victim.id)).toBe('active');
    await sql`update app.reports set status = 'dismissed', resolved_at = now() where id = ${reportAboutOther}::uuid`;
  });

  // ---- energy prices -------------------------------------------------------------------------------------------------------

  it('adds versions append-only with the 30 percent guard, and a publish after the date uses the new row', async () => {
    const current = async () => {
      const res = await admin.call('/admin/energy-prices');
      expect(res.status).toBe(200);
      const body = energyPricesResponseSchema.parse(await res.json());
      const f = body.fuels.find((x) => x.fuelType === 'electric');
      expect(f).toBeDefined();
      return { body, electric: f! };
    };
    const first = await current();
    expect(first.body.fuels.map((f) => f.fuelType)).toEqual(
      expect.arrayContaining(['petrol', 'diesel', 'lpg', 'hybrid', 'electric']),
    );
    const latest = new Date(
      Math.max(
        new Date(first.electric.current.effectiveFrom).getTime(),
        first.electric.scheduled ? new Date(first.electric.scheduled.effectiveFrom).getTime() : 0,
      ),
    );
    // The timeline only moves forward: wait for the next free minute after the latest version
    // (an earlier run of this test leaves rows up to 4 minutes ahead), then read the price in force.
    const free = new Date(latest.getTime() + 60_000);
    if (free.getTime() > Date.now()) await sleep(free.getTime() - Date.now() + 500);
    const { electric } = await current();

    const post = (over: Record<string, unknown>) =>
      admin.send('POST', '/admin/energy-prices', {
        fuelType: 'electric',
        priceMilli: electric.current.priceMilli,
        consumptionCenti: electric.current.consumptionCenti,
        sourceNote: 'integration test',
        ...over,
      });

    // +40 % is refused, with the field named; nothing was inserted.
    const big = Math.round(electric.current.priceMilli * 1.4) + 1;
    const refused = await post({ priceMilli: big });
    expect(refused.status).toBe(409);
    const e = await errorOf(refused);
    expect(e.code).toBe('LARGE_CHANGE');
    expect(e.fields).toEqual({ priceMilli: 'large_change' });

    // A past date, a date too far ahead, and an unreadable one.
    for (const [effectiveFrom, field] of [
      [iso(new Date(Date.now() - 3_600_000)), 'past'],
      [iso(new Date(Date.now() + 40 * 86_400_000)), 'too_far'],
    ] as const) {
      const res = await post({ effectiveFrom });
      expect(res.status).toBe(400);
      expect((await errorOf(res)).fields).toEqual({ effectiveFrom: field });
    }

    // +10 % is saved, effective now, and audited.
    const next = Math.round(electric.current.priceMilli * 1.1);
    const ok = await post({ priceMilli: next });
    expect(ok.status).toBe(201);
    const created = createEnergyPriceResponseSchema.parse(await ok.json());
    expect(created.item).toMatchObject({
      fuelType: 'electric',
      unit: 'kWh',
      priceMilli: next,
      createdBy: { id: admin.id, firstName: 'Admina' },
    });
    const audit = await sql<{ admin_id: string; details: Record<string, unknown> }[]>`
      select admin_id, details from app.admin_actions
      where action = 'energy_price_added' and details ->> 'energyPriceId' = ${created.item.id}`;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.admin_id).toBe(admin.id);
    expect(audit[0]?.details).toMatchObject({
      fuelType: 'electric',
      priceMilli: next,
      prevPriceMilli: electric.current.priceMilli,
      override: false,
    });

    // The row cannot be edited or removed through the API role (append-only).
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role haide_api`;
        await tx`update app.energy_prices set price_milli = 1 where id = ${created.item.id}::uuid`;
      }),
    ).rejects.toThrow();

    // A ride published by an electric car now uses the new version.
    const driver = await createUser({ vehicle: { fuelType: 'electric', seats: 3 } });
    const ride = await publish(driver, lane(), departure());
    const used = await sql<{ energy_price_id: string }[]>`
      select energy_price_id from app.rides where id = ${ride.id}::uuid`;
    expect(used[0]?.energy_price_id).toBe(created.item.id);

    // Two parallel posts for the next minute: one 201, one 400 not_after_latest.
    const when = iso(new Date(Date.now() + 120_000));
    const parallel = await Promise.all([
      post({ priceMilli: next, effectiveFrom: when, sourceNote: 'parallel a' }),
      post({ priceMilli: next, effectiveFrom: when, sourceNote: 'parallel b' }),
    ]);
    expect(parallel.map((r) => r.status).sort()).toEqual([201, 400]);
    const loser = parallel.find((r) => r.status === 400);
    expect((await errorOf(loser as Response)).fields).toEqual({
      effectiveFrom: 'not_after_latest',
    });

    // Override: +40 % over the scheduled row is saved and the audit row says so.
    const { electric: after } = await current();
    const latestPrice = after.scheduled ?? after.current;
    const forced = await post({
      priceMilli: Math.round(latestPrice.priceMilli * 1.4) + 1,
      effectiveFrom: iso(new Date(Date.now() + 180_000)),
      overrideLargeChange: true,
      sourceNote: 'override test',
    });
    expect(forced.status).toBe(201);
    const forcedItem = createEnergyPriceResponseSchema.parse(await forced.json()).item;
    const forcedAudit = await sql<{ details: Record<string, unknown> }[]>`
      select details from app.admin_actions
      where action = 'energy_price_added' and details ->> 'energyPriceId' = ${forcedItem.id}`;
    expect(forcedAudit[0]?.details.override).toBe(true);

    // Put the price back (also a large change, so also an override) so that repeated runs on one database stay in range.
    const restored = await post({
      priceMilli: electric.current.priceMilli,
      effectiveFrom: iso(new Date(Date.now() + 240_000)),
      overrideLargeChange: true,
      sourceNote: 'restore',
    });
    expect(restored.status).toBe(201);
  });

  // ---- metrics ------------------------------------------------------------------------------------------------------------------

  it('the default week and the week bounds', async () => {
    const res = await admin.call('/admin/metrics');
    expect(res.status).toBe(200);
    const body = adminMetricsResponseSchema.parse(await res.json());
    expect(body.partial).toBe(true);
    expect(body.series).toHaveLength(12);
    for (const week of ['2026-W45', '2099-W01', 'nope']) {
      const bad = await admin.call(`/admin/metrics?week=${week}`);
      expect(bad.status, week).toBe(400);
      expect((await errorOf(bad)).fields).toHaveProperty('week');
    }
  });

  it('a seeded week gives exactly the hand-computed answers of the pgTAP fixture', async (ctx) => {
    const { clean } = await seedMetricsWeek(sql);
    if (!clean) ctx.skip(); // another suite wrote to the first launch week on this database
    const res = await admin.call(`/admin/metrics?week=${SEEDED_WEEK.label}`);
    expect(res.status).toBe(200);
    const m = adminMetricsResponseSchema.parse(await res.json());
    const A = SEEDED_ANSWERS;
    expect(m.week).toBe(SEEDED_WEEK.label);
    expect(m.partial).toBe(false);
    expect(m.northStar).toMatchObject({
      value: A.completedSeats,
      status: 'below_kill',
      n: A.completedSeats,
    });
    expect(m.fillRate).toMatchObject({
      value: A.fillRate,
      n: A.ridesDeparted,
      status: 'on_target',
    });
    expect(m.medianResponseMin).toMatchObject({
      value: A.medianResponseMin,
      n: 8,
      status: 'between',
    });
    expect(m.retention4w).toMatchObject({
      value: A.retention,
      n: A.cohort.size,
      cohortWeek: A.cohort.week,
      closed: true,
      status: 'on_target',
    });
    expect(m.reportsPer100).toMatchObject({
      value: A.reportsPer100,
      n: A.ridesCompleted,
      status: 'below_kill',
    });
    expect(m.cancellationRate).toMatchObject({
      value: A.cancellationRate,
      n: A.accepted,
      status: 'on_target',
    });
    expect(m.matchRate.launch).toMatchObject({
      value: A.matchLaunch.value,
      n: A.matchLaunch.searches,
      status: 'on_target',
    });
    expect(m.matchRate.overall).toMatchObject({
      value: A.matchOverall.value,
      n: A.matchOverall.searches,
    });
    expect(m.matchRate.byCorridor).toEqual(A.corridors.map((c) => ({ ...c })));
    expect(m.series.map((s) => s.completedSeats)).toEqual([...A.series]);
    expect(m.series[11]?.week).toBe(SEEDED_WEEK.label);
    expect(m.flags.highVolumeDrivers).toEqual([]);

    // The same numbers straight from the database function.
    const [row] = await sql<
      { completed_seats: number; rides_departed: number; requests_decided: number }[]
    >`
      select completed_seats, rides_departed, requests_decided
      from app.metrics_week(${SEEDED_WEEK.monday}::date, now())`;
    expect(row).toEqual({
      completed_seats: A.completedSeats,
      rides_departed: A.ridesDeparted,
      requests_decided: 8,
    });
  });

  // ---- ops and errors --------------------------------------------------------------------------------------------------------------

  it('ops tiles and recent errors have the contract shape and no stack', async () => {
    const ops = adminOpsResponseSchema.parse(await (await admin.call('/admin/ops')).json());
    expect(ops.emailCap).toBeGreaterThan(0);
    expect(ops.dbSizeMb).toBeGreaterThan(0);
    const errors = await admin.call('/admin/errors?limit=5');
    expect(errors.status).toBe(200);
    const body = adminErrorsResponseSchema.parse(await errors.json());
    expect(body.items.length).toBeLessThanOrEqual(5);
    expect(JSON.stringify(body)).not.toMatch(/"stack"|userIdHash|user_id_hash/);
    expect((await admin.call('/admin/errors?limit=101')).status).toBe(400);
  });

  // ---- nothing private leaves ---------------------------------------------------------------------------------------------------

  it('no admin response holds a phone, plate, email or coordinate', async () => {
    const PHONE = /\+40\d{9}/;
    const PLATE = /\b[A-Z]{1,2}\s?\d{2,3}\s?[A-Z]{3}\b/;
    const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
    const COORD = /^-?\d{1,3}\.\d{4,}$/;
    const FORBIDDEN_KEY =
      /^(phone|phonee164|plate|email|lat|lng|latitude|longitude|coordinates|stack|userIdHash)$/i;
    const paths = [
      '/admin/metrics',
      `/admin/metrics?week=${SEEDED_WEEK.label}`,
      '/admin/reports?status=all&limit=50',
      '/admin/users?status=suspended',
      '/admin/energy-prices',
      '/admin/ops',
      '/admin/errors?limit=100',
    ];
    for (const path of paths) {
      const res = await admin.call(path);
      expect(res.status, path).toBe(200);
      const json = (await res.json()) as unknown;
      walk(
        json,
        (k) => expect(FORBIDDEN_KEY.test(k), `${path}: key ${k}`).toBe(false),
        (s) => {
          // Error messages are free text written by clients: the scrub removes contact data, so they must pass too.
          expect(PHONE.test(s), `${path}: phone in "${s}"`).toBe(false);
          expect(PLATE.test(s), `${path}: plate in "${s}"`).toBe(false);
          expect(EMAIL.test(s), `${path}: email in "${s}"`).toBe(false);
          expect(COORD.test(s), `${path}: coordinate "${s}"`).toBe(false);
        },
      );
    }
  });
});
