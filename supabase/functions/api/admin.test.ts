import { describe, expect, it } from 'vitest';
import {
  adminErrorsResponseSchema,
  adminMetricsResponseSchema,
  adminOpsResponseSchema,
  adminReportsResponseSchema,
  adminUsersResponseSchema,
  createEnergyPriceResponseSchema,
  energyPricesResponseSchema,
} from '../_shared/contracts/admin.ts';
import { errorEnvelopeSchema } from '../_shared/contracts/errors.ts';
import { fixedClock } from '../_shared/domain/clock.ts';
import { RATE_LIMITS } from '../_shared/domain/rules.ts';
import {
  decodeReportCursor,
  encodeReportCursor,
  normalizeNote,
  normalizeStatement,
} from './services/admin.ts';
import { BASE, makeApp, signToken, type Handler, type Query } from './testing.ts';

const ADMIN = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
const USER = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';
const REPORTER = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const OTHER = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const REPORT = 'c2c2c2c2-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const RIDE = '5b0c7f0e-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const PRICE = 'e1e1e1e1-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const NOW = '2026-11-17T09:00:00Z'; // Tuesday of 2026-W47

const ALL_ACCEPTED = [
  { kind: 'age_18', version: null },
  { kind: 'terms', version: '1.0' },
  { kind: 'privacy', version: '1.0' },
];

const account = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  first_name: 'Dragoș',
  phone_e164: '+40731111222',
  bio: null,
  photo_path: null,
  status: 'active',
  role: id === ADMIN ? 'admin' : 'user',
  created_at: new Date('2026-10-01T10:00:00Z'),
  has_vehicle: false,
  ...over,
});

/** A row of selectAdminUsers. The extra contact columns prove the serializer never forwards them. */
const userRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  first_name: id === USER ? 'Radu' : 'Ioana',
  photo_path: null,
  status: 'active',
  created_at: new Date('2026-10-01T10:00:00Z'),
  rides_completed: 7,
  reports_90d: 2,
  phone_e164: '+40731111222',
  plate: 'SB12ABC',
  email: 'radu@example.com',
  lat: 45.74132,
  lng: 24.18611,
  ...over,
});

const reportRow = (over: Record<string, unknown> = {}) => ({
  id: REPORT,
  status: 'open',
  reason: 'harassment',
  details: 'Sent messages after I asked to stop.',
  created_at: new Date('2026-11-16T10:00:00.123Z'),
  created_at_text: '2026-11-16 10:00:00.123+00',
  resolved_at: null,
  reporter_id: REPORTER,
  reported_id: USER,
  ride_id: RIDE,
  booking_id: null,
  snapshot_first_name: 'Radu',
  ride_departure_at: new Date('2026-11-16T07:00:00Z'),
  ride_from_area: 'Turnișor',
  ride_to_area: 'Centru',
  reported_snapshot: { firstName: 'Radu', phoneE164: '+40731111222' },
  ...over,
});

const priceRow = (over: Record<string, unknown> = {}) => ({
  id: PRICE,
  fuel_type: 'petrol',
  price_milli: 9810,
  consumption_centi: 700,
  unit: 'l',
  effective_from: new Date('2026-11-15T00:00:00Z'),
  source_note: 'v1',
  created_by: null,
  created_by_first_name: null,
  created_at: new Date('2026-11-15T00:00:00Z'),
  ...over,
});

const weekCounts = {
  completed_seats: 120,
  rides_departed: 40,
  rides_filled: 12,
  requests: 50,
  requests_decided: 30,
  requests_expired: 5,
  median_response_s: 540,
  cohort_size: 10,
  cohort_retained: 5,
  cohort_closed: false,
  reports: 1,
  rides_completed: 60,
  accepted: 40,
  cancelled_after_accept: 4,
};

type Opts = {
  caller?: string;
  role?: 'user' | 'admin';
  suspended?: boolean;
  /** Profile row answered to `for no key update`; null = unknown user. */
  locked?: { status: string } | null;
  report?: { status: string; reported_id: string } | null;
  reports?: Record<string, unknown>[];
  functionResult?: boolean;
  latestPrice?: { price_milli: number; consumption_centi: number; effective_from: Date } | null;
  prices?: Record<string, unknown>[];
  drivers?: { driver_id: string; completed: number }[];
  failOn?: { fragment: string; error: unknown };
};

function adminDb(o: Opts = {}): Handler {
  const caller = o.caller ?? ADMIN;
  return (q: Query) => {
    const t = q.text;
    if (o.failOn && t.includes(o.failOn.fragment)) throw o.failOn.error;
    if (t.includes('app.rate_limit_hit')) return [{ allowed: true }];
    if (t.includes('from app.legal_documents')) {
      return [
        { kind: 'terms', version: '1.0', url: '/policy/terms' },
        { kind: 'privacy', version: '1.0', url: '/policy/privacy' },
      ];
    }
    if (t.includes('has_vehicle')) {
      return [
        account(caller, {
          ...(o.role ? { role: o.role } : {}),
          ...(o.suspended ? { status: 'suspended' } : {}),
        }),
      ];
    }
    if (t.includes('from app.consents')) return ALL_ACCEPTED;

    // reads
    if (t.includes('from app.reports r left join app.rides rd')) return o.reports ?? [reportRow()];
    if (t.includes('as reports_90d')) {
      return [userRow(USER), userRow(REPORTER), userRow(ADMIN, { first_name: 'Dragoș' })];
    }
    if (t.includes('count(*)::int as n from app.reports')) return [{ reported_id: USER, n: 2 }];
    if (t.includes('row_number() over')) {
      return [
        {
          target_user_id: USER,
          action: 'suspend',
          admin_first_name: 'Dragoș',
          created_at: new Date('2026-10-20T10:00:00Z'),
          note: 'Earlier statement.',
        },
      ];
    }
    if (t.includes('select id, status, reported_id from app.reports')) {
      return o.report === null
        ? []
        : [{ id: REPORT, ...(o.report ?? { status: 'open', reported_id: USER }) }];
    }
    if (t.includes('for no key update')) {
      return o.locked === null
        ? []
        : [{ id: USER, first_name: 'Radu', ...(o.locked ?? { status: 'active' }) }];
    }
    if (t.includes('from app.admin_actions x') || t.includes('left join lateral')) {
      return [
        {
          id: USER,
          suspended_at: new Date('2026-11-16T12:00:00Z'),
          reason_code: 'harassment',
          statement: 'You sent repeated unwanted messages.',
          admin_first_name: 'Dragoș',
        },
      ];
    }

    // audited functions
    if (/select app\.admin_(dismiss_report|suspend_user|unsuspend_user)\(/.test(t)) {
      return [{ ok: o.functionResult !== false }];
    }

    // metrics
    if (t.includes('from app.metrics_week(')) return [weekCounts];
    if (t.includes('from app.metrics_match_by_corridor(')) {
      return [
        { corridor: 'south', searches: 10, matched: 4 },
        { corridor: 'west', searches: 10, matched: 2 },
        { corridor: 'campus', searches: 0, matched: 0 },
        { corridor: 'other', searches: 20, matched: 10 },
      ];
    }
    if (t.includes('from app.metrics_seats_series(')) {
      return Array.from({ length: 12 }, (_, i) => ({
        week: new Date(Date.UTC(2026, 8, 7 + 7 * i)).toISOString().slice(0, 10),
        completed_seats: i * 10,
      }));
    }
    if (t.includes('from app.metrics_high_volume_drivers(')) {
      return o.drivers ?? [{ driver_id: USER, completed: 41 }];
    }

    // energy
    if (t.includes('pg_advisory_xact_lock')) return [];
    if (t.includes('from app.energy_prices where fuel_type')) {
      return o.latestPrice === null
        ? []
        : [
            o.latestPrice ?? {
              price_milli: 9810,
              consumption_centi: 700,
              effective_from: new Date('2026-11-15T00:00:00Z'),
            },
          ];
    }
    if (t.startsWith('insert into app.energy_prices')) return [{ id: PRICE }];
    if (t.includes('left join app.profiles p on p.id = e.created_by where e.id =')) {
      return [priceRow({ created_by: ADMIN, created_by_first_name: 'Dragoș' })];
    }
    if (
      t.includes(
        'from app.energy_prices e left join app.profiles p on p.id = e.created_by order by',
      )
    ) {
      return o.prices ?? [priceRow()];
    }

    // ops
    if (t.includes('pg_database_size')) {
      return [
        {
          db_size_mb: 71.46,
          emails_today: 12,
          outbox_pending: 3,
          outbox_failed_24h: 1,
          route_previews_today: 44,
          errors_24h: 2,
          open_reports: 4,
          open_data_requests: 1,
          overdue_deletions: 0,
        },
      ];
    }
    if (t.includes('from app.admin_cron_runs()')) {
      return [
        { job: 'haide-tick', status: 'succeeded', started_at: new Date('2026-11-17T08:59:00Z') },
      ];
    }
    if (t.includes('from app.app_errors')) {
      return [
        {
          id: 9,
          source: 'client',
          message: 'TypeError: x is undefined',
          route: '/search',
          app_version: 'abc123',
          created_at: new Date('2026-11-17T08:00:00Z'),
        },
      ];
    }
    return undefined;
  };
}

const send = async (
  app: ReturnType<typeof makeApp>['app'],
  method: string,
  path: string,
  who: string | null,
  body?: unknown,
) =>
  app.request(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(who
        ? { authorization: `Bearer ${await signToken(who, { email: 'a@example.com' })}` }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;
const has = (calls: Query[], fragment: string) => calls.some((c) => c.text.includes(fragment));
const find = (calls: Query[], fragment: string) => calls.find((c) => c.text.includes(fragment));
const appWith = (o: Opts = {}, iso = NOW) => makeApp([adminDb(o)], {}, { clock: fixedClock(iso) });

const SUSPEND_BODY = {
  reasonCode: 'harassment',
  statement: 'You sent repeated unwanted messages after a passenger asked you to stop.',
  reportId: REPORT,
};

// ---- gates ---------------------------------------------------------------------------------------------------

type RouteCase = [method: string, path: string, body: unknown, okStatus: number];
const ROUTES: RouteCase[] = [
  ['GET', '/admin/metrics', undefined, 200],
  ['GET', '/admin/reports', undefined, 200],
  ['POST', `/admin/reports/${REPORT}/dismiss`, {}, 204],
  ['POST', `/admin/users/${USER}/suspend`, SUSPEND_BODY, 204],
  ['POST', `/admin/users/${USER}/unsuspend`, {}, 204],
  ['GET', '/admin/users?status=suspended', undefined, 200],
  ['GET', '/admin/energy-prices', undefined, 200],
  [
    'POST',
    '/admin/energy-prices',
    { fuelType: 'petrol', priceMilli: 10_000, consumptionCenti: 700, sourceNote: 'avg' },
    201,
  ],
  ['GET', '/admin/ops', undefined, 200],
  ['GET', '/admin/errors', undefined, 200],
];

describe('admin gates', () => {
  it.each(ROUTES)('%s %s answers 401 to nobody', async (method, path, body) => {
    const { app, calls } = appWith();
    expect((await send(app, method, path, null, body)).status).toBe(401);
    expect(has(calls, 'insert into')).toBe(false);
  });

  it.each(ROUTES)('%s %s answers 403 FORBIDDEN to a plain user', async (method, path, body) => {
    const { app, calls } = appWith({ caller: USER, role: 'user' });
    const res = await send(app, method, path, USER, body);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('FORBIDDEN');
    expect(has(calls, 'insert into')).toBe(false);
    expect(has(calls, 'app.admin_')).toBe(false);
  });

  it.each(ROUTES)(
    '%s %s answers 403 ACCOUNT_SUSPENDED to a suspended admin',
    async (method, path, body) => {
      const { app } = appWith({ suspended: true });
      const res = await send(app, method, path, ADMIN, body);
      expect(res.status).toBe(403);
      expect((await errorOf(res)).code).toBe('ACCOUNT_SUSPENDED');
    },
  );

  it.each(ROUTES)('%s %s works for an active admin', async (method, path, body, ok) => {
    const { app } = appWith({
      locked: { status: path.endsWith('/unsuspend') ? 'suspended' : 'active' },
    });
    expect((await send(app, method, path, ADMIN, body)).status).toBe(ok);
  });

  it('re-reads the role from the database on every request', async () => {
    let role: 'admin' | 'user' = 'admin';
    const { app } = makeApp([(q) => adminDb({ role })(q)], {}, { clock: fixedClock(NOW) });
    expect((await send(app, 'GET', '/admin/ops', ADMIN)).status).toBe(200);
    role = 'user';
    expect((await send(app, 'GET', '/admin/ops', ADMIN)).status).toBe(403);
  });

  it('shares one rate limit, per admin', async () => {
    const { app, calls } = appWith();
    await send(app, 'GET', '/admin/ops', ADMIN);
    const hit = calls.find(
      (c) => c.text.includes('app.rate_limit_hit') && String(c.values[0]).startsWith('admin:u:'),
    );
    expect(hit?.values.slice(1)).toEqual([RATE_LIMITS.admin.windowS, RATE_LIMITS.admin.max]);
    expect(RATE_LIMITS.admin).toEqual({ max: 120, windowS: 60 });
  });
});

// ---- metrics ---------------------------------------------------------------------------------------------------------

describe('GET /admin/metrics', () => {
  it('returns the contract, for the current week by default, partial while it runs', async () => {
    const { app, calls } = appWith();
    const res = await send(app, 'GET', '/admin/metrics', ADMIN);
    expect(res.status).toBe(200);
    const body = adminMetricsResponseSchema.parse(await res.json());
    expect(body.week).toBe('2026-W47');
    expect(body.from).toBe('2026-11-15T22:00:00.000Z');
    expect(body.to).toBe('2026-11-22T22:00:00.000Z');
    expect(body.partial).toBe(true);
    expect(body.northStar).toEqual({
      value: 120,
      target: 100,
      kill: 30,
      status: 'on_target',
      n: 120,
    });
    expect(body.matchRate.launch).toMatchObject({ value: 0.3, n: 20, status: 'on_target' });
    expect(body.matchRate.overall).toMatchObject({ value: 0.4, n: 40 });
    expect(body.matchRate.byCorridor).toHaveLength(4);
    expect(body.fillRate).toMatchObject({ value: 0.3, n: 40 });
    expect(body.medianResponseMin).toMatchObject({ value: 9, n: 30, status: 'on_target' });
    expect(body.retention4w).toMatchObject({ cohortWeek: '2026-W43', closed: false, value: 0.5 });
    expect(body.reportsPer100).toMatchObject({ value: 1.67, status: 'between' });
    expect(body.cancellationRate).toMatchObject({ value: 0.1, status: 'on_target' });
    expect(body.series).toHaveLength(12);
    expect(body.series[11]?.week).toMatch(/^\d{4}-W\d{2}$/);
    expect(body.flags.highVolumeDrivers).toEqual([
      expect.objectContaining({
        completed7d: 41,
        user: expect.objectContaining({ id: USER, firstName: 'Radu' }),
      }),
    ]);

    const weekCall = find(calls, 'from app.metrics_week(');
    expect(weekCall?.values[0]).toBe('2026-11-16');
    const driversCall = find(calls, 'from app.metrics_high_volume_drivers(');
    expect(driversCall?.values[1]).toBe(40);
  });

  it('a finished week is not partial and its 7-day window ends with the week', async () => {
    const { app, calls } = appWith({}, '2026-11-24T09:00:00Z');
    const body = adminMetricsResponseSchema.parse(
      await (await send(app, 'GET', '/admin/metrics?week=2026-W47', ADMIN)).json(),
    );
    expect(body.partial).toBe(false);
    const until = find(calls, 'from app.metrics_high_volume_drivers(')?.values[0] as Date;
    expect(until.toISOString()).toBe('2026-11-22T22:00:00.000Z');
  });

  it('does not look up the drivers when nobody is flagged', async () => {
    const { app, calls } = appWith({ drivers: [] });
    await send(app, 'GET', '/admin/metrics', ADMIN);
    expect(has(calls, 'as reports_90d')).toBe(false);
  });

  it.each(['2026-W45', '2026-W48', '2026-47', 'nope', '2027-W53', '2026-W00'])(
    'rejects week=%s with fields.week',
    async (week) => {
      const { app, calls } = appWith();
      const res = await send(app, 'GET', `/admin/metrics?week=${week}`, ADMIN);
      expect(res.status).toBe(400);
      const e = await errorOf(res);
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.fields).toHaveProperty('week');
      expect(has(calls, 'metrics_week')).toBe(false);
    },
  );
});

// ---- reports -------------------------------------------------------------------------------------------------------------

describe('GET /admin/reports', () => {
  it('lists the open queue with people, history and area names only', async () => {
    const { app, calls } = appWith();
    const res = await send(app, 'GET', '/admin/reports', ADMIN);
    const body = adminReportsResponseSchema.parse(await res.json());
    expect(body.nextCursor).toBeNull();
    const item = body.items[0];
    expect(item).toMatchObject({
      id: REPORT,
      status: 'open',
      reason: 'harassment',
      reporter: { id: REPORTER, firstName: 'Ioana' },
      reported: { id: USER, firstName: 'Radu', openReports: 2, status: 'active' },
      ride: { id: RIDE, fromArea: 'Turnișor', toArea: 'Centru' },
    });
    expect(item?.history).toEqual([
      {
        action: 'suspend',
        adminFirstName: 'Dragoș',
        at: '2026-10-20T10:00:00.000Z',
        note: 'Earlier statement.',
      },
    ]);
    const list = find(calls, 'from app.reports r left join app.rides rd');
    expect(list?.values).toContain('open');
    expect(list?.values).toContain(21); // limit 20 + 1 to detect a next page
  });

  it('a deleted reported user keeps the name from the report snapshot', async () => {
    const { app } = makeApp(
      [
        (q) =>
          q.text.includes('as reports_90d')
            ? [
                userRow(USER, { status: 'deleted', first_name: null, photo_path: 'avatars/x.jpg' }),
                userRow(REPORTER),
              ]
            : undefined,
        adminDb(),
      ],
      {},
      { clock: fixedClock(NOW) },
    );
    const body = adminReportsResponseSchema.parse(
      await (await send(app, 'GET', '/admin/reports', ADMIN)).json(),
    );
    expect(body.items[0]?.reported).toMatchObject({
      status: 'deleted',
      firstName: 'Radu',
      photoUrl: null,
    });
  });

  it('pages with a keyset cursor that keeps the exact timestamp', async () => {
    const rows = [
      reportRow({ id: REPORT, created_at_text: '2026-11-16 10:00:00.123456+00' }),
      reportRow({ id: OTHER, created_at_text: '2026-11-16 09:00:00+00' }),
    ];
    const { app, calls } = appWith({ reports: rows });
    const first = adminReportsResponseSchema.parse(
      await (await send(app, 'GET', '/admin/reports?limit=1', ADMIN)).json(),
    );
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    expect(decodeReportCursor(first.nextCursor as string)).toEqual({
      createdAtText: '2026-11-16 10:00:00.123456+00',
      id: REPORT,
    });
    await send(app, 'GET', `/admin/reports?status=all&cursor=${first.nextCursor}`, ADMIN);
    const second = calls.filter((c) =>
      c.text.includes('from app.reports r left join app.rides rd'),
    )[1];
    expect(second?.values).toContain('2026-11-16 10:00:00.123456+00');
    expect(second?.values).toContain('all');
  });

  it('cursor round trip and rejection of garbage', () => {
    const c = encodeReportCursor('2026-11-16 10:00:00.5+00', REPORT);
    expect(decodeReportCursor(c)).toEqual({
      createdAtText: '2026-11-16 10:00:00.5+00',
      id: REPORT,
    });
    expect(() => decodeReportCursor('@@@')).toThrow();
    expect(() => decodeReportCursor(encodeReportCursor('yesterday', REPORT))).toThrow();
    expect(() => decodeReportCursor(encodeReportCursor('2026-11-16 10:00:00+00', 'x'))).toThrow();
  });

  it.each([
    ['status=pending', 'status'],
    ['limit=51', 'limit'],
    ['limit=0', 'limit'],
    ['limit=abc', 'limit'],
    ['cursor=%40%40', 'cursor'],
  ])('rejects ?%s with fields.%s', async (query, field) => {
    const { app } = appWith();
    const res = await send(app, 'GET', `/admin/reports?${query}`, ADMIN);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toHaveProperty(field);
  });
});

describe('POST /admin/reports/{id}/dismiss', () => {
  it('dismisses an open report through the audited function and tells nobody', async () => {
    const { app, calls } = appWith();
    const res = await send(app, 'POST', `/admin/reports/${REPORT}/dismiss`, ADMIN, {
      note: '  no evidence  ',
    });
    expect(res.status).toBe(204);
    const call = find(calls, 'app.admin_dismiss_report(');
    expect(call?.values).toEqual([REPORT, ADMIN, 'no evidence']);
    expect(has(calls, 'insert into app.outbox')).toBe(false);
  });

  it('answers 404 for an unknown or malformed report, 409 when it is not open', async () => {
    const unknown = appWith({ report: null });
    expect(
      (await send(unknown.app, 'POST', `/admin/reports/${REPORT}/dismiss`, ADMIN, {})).status,
    ).toBe(404);
    const malformed = appWith();
    expect(
      (await send(malformed.app, 'POST', '/admin/reports/nope/dismiss', ADMIN, {})).status,
    ).toBe(404);
    const resolved = appWith({ report: { status: 'dismissed', reported_id: USER } });
    const res = await send(resolved.app, 'POST', `/admin/reports/${REPORT}/dismiss`, ADMIN, {});
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('INVALID_STATE');
    expect(has(resolved.calls, 'app.admin_dismiss_report(')).toBe(false);
  });

  it('is 409 when another admin resolved it between the check and the function', async () => {
    const { app } = appWith({ functionResult: false });
    const res = await send(app, 'POST', `/admin/reports/${REPORT}/dismiss`, ADMIN, {});
    expect(res.status).toBe(409);
  });

  it('accepts an empty body and rejects a note over 200 characters', async () => {
    const empty = appWith();
    expect((await send(empty.app, 'POST', `/admin/reports/${REPORT}/dismiss`, ADMIN)).status).toBe(
      204,
    );
    const long = appWith();
    const res = await send(long.app, 'POST', `/admin/reports/${REPORT}/dismiss`, ADMIN, {
      note: 'x'.repeat(201),
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({ note: 'too_long' });
  });
});

// ---- suspend and unsuspend ----------------------------------------------------------------------------------------------------

describe('POST /admin/users/{id}/suspend', () => {
  it('locks the profile, calls the audited function, and queues the statement of reasons', async () => {
    const { app, calls } = appWith();
    const res = await send(app, 'POST', `/admin/users/${USER}/suspend`, ADMIN, SUSPEND_BODY);
    expect(res.status).toBe(204);
    const lock = calls.findIndex((c) => c.text.includes('for no key update'));
    const fn = calls.findIndex((c) => c.text.includes('app.admin_suspend_user('));
    const outbox = calls.findIndex((c) => c.text.includes('insert into app.outbox'));
    expect(lock).toBeGreaterThan(-1);
    expect(fn).toBeGreaterThan(lock);
    expect(outbox).toBeGreaterThan(fn);
    expect(calls[fn]?.values).toEqual([USER, SUSPEND_BODY.statement, ADMIN, REPORT, 'harassment']);
    expect(calls[outbox]?.values[0]).toBe(USER);
    expect(calls[outbox]?.values[1]).toBe('account_suspended');
    expect(JSON.parse(String(calls[outbox]?.values[2]))).toEqual({
      reasonCode: 'harassment',
      statement: SUSPEND_BODY.statement,
    });
  });

  it('works without a report', async () => {
    const { app, calls } = appWith();
    const res = await send(app, 'POST', `/admin/users/${USER}/suspend`, ADMIN, {
      reasonCode: 'fake_profile',
      statement: 'The photo and the name belong to someone else.',
    });
    expect(res.status).toBe(204);
    expect(find(calls, 'app.admin_suspend_user(')?.values[3]).toBeNull();
    expect(has(calls, 'select id, status, reported_id from app.reports')).toBe(false);
  });

  it('normalises the statement (NFC, trimmed)', async () => {
    const { app, calls } = appWith();
    await send(app, 'POST', `/admin/users/${USER}/suspend`, ADMIN, {
      reasonCode: 'other',
      statement: '  Ş̦elimbar rule broken twice.  ',
    });
    expect(find(calls, 'app.admin_suspend_user(')?.values[1]).toBe(
      'Ş̦elimbar rule broken twice.'.normalize('NFC'),
    );
  });

  it('refuses to suspend yourself before touching the database', async () => {
    const { app, calls } = appWith();
    const res = await send(app, 'POST', `/admin/users/${ADMIN}/suspend`, ADMIN, SUSPEND_BODY);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({ userId: 'self' });
    expect(has(calls, 'for no key update')).toBe(false);
  });

  it.each([
    [{ ...SUSPEND_BODY, statement: 'too short' }, 'too_short'],
    [{ ...SUSPEND_BODY, statement: 'x'.repeat(301) }, 'too_long'],
    [{ ...SUSPEND_BODY, statement: '        ' }, 'required'],
    [{ ...SUSPEND_BODY, statement: 'Call him on +40731111222 to settle it.' }, 'contact_details'],
    [
      { ...SUSPEND_BODY, statement: 'Write to radu@example.com about the rules.' },
      'contact_details',
    ],
  ])('rejects a bad statement (%#)', async (body, code) => {
    const { app, calls } = appWith();
    const res = await send(app, 'POST', `/admin/users/${USER}/suspend`, ADMIN, body);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({ statement: code });
    expect(has(calls, 'app.admin_suspend_user(')).toBe(false);
  });

  it('validates the body shape', async () => {
    const { app } = appWith();
    for (const body of [
      {},
      { statement: SUSPEND_BODY.statement },
      { reasonCode: 'rude', statement: SUSPEND_BODY.statement },
      { ...SUSPEND_BODY, reportId: 'nope' },
    ]) {
      const res = await send(app, 'POST', `/admin/users/${USER}/suspend`, ADMIN, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('answers 404 for an unknown user, 409 when the user is not active', async () => {
    const unknown = appWith({ locked: null });
    expect(
      (await send(unknown.app, 'POST', `/admin/users/${USER}/suspend`, ADMIN, SUSPEND_BODY)).status,
    ).toBe(404);
    const malformed = appWith();
    expect(
      (await send(malformed.app, 'POST', '/admin/users/nope/suspend', ADMIN, SUSPEND_BODY)).status,
    ).toBe(404);
    for (const status of ['suspended', 'deleted']) {
      const t = appWith({ locked: { status } });
      const res = await send(t.app, 'POST', `/admin/users/${USER}/suspend`, ADMIN, SUSPEND_BODY);
      expect(res.status, status).toBe(409);
      expect((await errorOf(res)).code).toBe('INVALID_STATE');
      expect(has(t.calls, 'insert into app.outbox')).toBe(false);
    }
  });

  it('checks the report: unknown 404, about someone else 400, not open 409', async () => {
    const unknown = appWith({ report: null });
    expect(
      (await send(unknown.app, 'POST', `/admin/users/${USER}/suspend`, ADMIN, SUSPEND_BODY)).status,
    ).toBe(404);
    const other = appWith({ report: { status: 'open', reported_id: OTHER } });
    const res = await send(other.app, 'POST', `/admin/users/${USER}/suspend`, ADMIN, SUSPEND_BODY);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({ reportId: 'mismatch' });
    const closed = appWith({ report: { status: 'actioned', reported_id: USER } });
    expect(
      (await send(closed.app, 'POST', `/admin/users/${USER}/suspend`, ADMIN, SUSPEND_BODY)).status,
    ).toBe(409);
    for (const t of [unknown, other, closed])
      expect(has(t.calls, 'app.admin_suspend_user(')).toBe(false);
  });

  it('is 409 and queues nothing when the function loses a race', async () => {
    const { app, calls } = appWith({ functionResult: false });
    const res = await send(app, 'POST', `/admin/users/${USER}/suspend`, ADMIN, SUSPEND_BODY);
    expect(res.status).toBe(409);
    expect(has(calls, 'insert into app.outbox')).toBe(false);
  });
});

describe('POST /admin/users/{id}/unsuspend', () => {
  it('reinstates a suspended user and queues the notice', async () => {
    const { app, calls } = appWith({ locked: { status: 'suspended' } });
    const res = await send(app, 'POST', `/admin/users/${USER}/unsuspend`, ADMIN, {
      note: 'Appeal accepted',
    });
    expect(res.status).toBe(204);
    expect(find(calls, 'app.admin_unsuspend_user(')?.values).toEqual([
      USER,
      'Appeal accepted',
      ADMIN,
    ]);
    const outbox = find(calls, 'insert into app.outbox');
    expect(outbox?.values.slice(0, 2)).toEqual([USER, 'account_reinstated']);
    expect(JSON.parse(String(outbox?.values[2]))).toEqual({});
  });

  it('answers 404 for an unknown user and 409 for an active or deleted one', async () => {
    expect(
      (
        await send(
          appWith({ locked: null }).app,
          'POST',
          `/admin/users/${USER}/unsuspend`,
          ADMIN,
          {},
        )
      ).status,
    ).toBe(404);
    for (const status of ['active', 'deleted']) {
      const t = appWith({ locked: { status } });
      const res = await send(t.app, 'POST', `/admin/users/${USER}/unsuspend`, ADMIN, {});
      expect(res.status, status).toBe(409);
      expect(has(t.calls, 'app.admin_unsuspend_user(')).toBe(false);
    }
  });
});

describe('GET /admin/users', () => {
  it('lists the suspended with the ground, statement and admin', async () => {
    const { app } = appWith();
    const body = adminUsersResponseSchema.parse(
      await (await send(app, 'GET', '/admin/users?status=suspended', ADMIN)).json(),
    );
    expect(body.items[0]).toMatchObject({
      user: { id: USER },
      suspendedAt: '2026-11-16T12:00:00.000Z',
      reasonCode: 'harassment',
      statement: 'You sent repeated unwanted messages.',
      adminFirstName: 'Dragoș',
    });
  });

  it('only knows status=suspended', async () => {
    const { app } = appWith();
    expect((await send(app, 'GET', '/admin/users?status=active', ADMIN)).status).toBe(400);
  });
});

// ---- statement and note helpers ------------------------------------------------------------------------------------------

describe('normalizeStatement and normalizeNote', () => {
  it('counts code points: 10 and 300 pass, 9 and 301 fail', () => {
    expect(normalizeStatement('1234567890')).toBe('1234567890');
    expect(() => normalizeStatement('123456789')).toThrow();
    expect(normalizeStatement('😀'.repeat(300))).toHaveLength(600);
    expect(() => normalizeStatement('😀'.repeat(301))).toThrow();
  });

  it('a note is optional, trimmed, at most 200 characters', () => {
    expect(normalizeNote(undefined)).toBeNull();
    expect(normalizeNote('   ')).toBeNull();
    expect(normalizeNote(' ok ')).toBe('ok');
    expect(normalizeNote('x'.repeat(200))).toHaveLength(200);
    expect(() => normalizeNote('x'.repeat(201))).toThrow();
  });
});

// ---- energy prices --------------------------------------------------------------------------------------------------------------

const PRICE_BODY = {
  fuelType: 'petrol',
  priceMilli: 10_300,
  consumptionCenti: 700,
  sourceNote: 'National average 17 Nov',
};

describe('GET /admin/energy-prices', () => {
  it('shows the price in force, the next scheduled one and the history', async () => {
    const rows = [
      priceRow({
        id: 'a1a1a1a1-6a1d-4c11-8d2e-9f3a4b5c6d7e',
        effective_from: new Date('2026-11-20T00:00:00Z'),
        price_milli: 10_500,
      }),
      priceRow({
        id: 'b2b2b2b2-6a1d-4c11-8d2e-9f3a4b5c6d7e',
        effective_from: new Date('2026-11-15T00:00:00Z'),
      }),
      priceRow({
        id: 'c3c3c3c3-6a1d-4c11-8d2e-9f3a4b5c6d7e',
        fuel_type: 'electric',
        unit: 'kWh',
        price_milli: 2_000,
        consumption_centi: 1_800,
      }),
    ];
    const { app } = appWith({ prices: rows });
    const body = energyPricesResponseSchema.parse(
      await (await send(app, 'GET', '/admin/energy-prices', ADMIN)).json(),
    );
    expect(body.fuels.map((f) => f.fuelType)).toEqual(['petrol', 'electric']);
    expect(body.fuels[0]).toMatchObject({
      unit: 'l',
      current: { id: 'b2b2b2b2-6a1d-4c11-8d2e-9f3a4b5c6d7e' },
      scheduled: { id: 'a1a1a1a1-6a1d-4c11-8d2e-9f3a4b5c6d7e', priceMilli: 10_500 },
    });
    expect(body.fuels[1]).toMatchObject({ unit: 'kWh', scheduled: null });
    expect(body.history).toHaveLength(3);
  });
});

describe('POST /admin/energy-prices', () => {
  it('takes the lock, inserts, audits, and answers 201 with the item', async () => {
    const { app, calls } = appWith();
    const res = await send(app, 'POST', '/admin/energy-prices', ADMIN, PRICE_BODY);
    expect(res.status).toBe(201);
    const body = createEnergyPriceResponseSchema.parse(await res.json());
    expect(body.item.createdBy).toEqual({ id: ADMIN, firstName: 'Dragoș' });

    const order = [
      'pg_advisory_xact_lock',
      'from app.energy_prices where fuel_type',
      'insert into app.energy_prices',
      "'energy_price_added'",
    ].map((f) => calls.findIndex((c) => c.text.includes(f)));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const insert = find(calls, 'insert into app.energy_prices');
    expect(insert?.values).toEqual([
      'petrol',
      10_300,
      700,
      'l',
      new Date('2026-11-17T09:00:00Z'),
      'National average 17 Nov',
      ADMIN,
      new Date(NOW),
    ]);
    const audit = JSON.parse(String(find(calls, "'energy_price_added'")?.values[1]));
    expect(audit).toEqual({
      energyPriceId: PRICE,
      fuelType: 'petrol',
      priceMilli: 10_300,
      prevPriceMilli: 9810,
      consumptionCenti: 700,
      prevConsumptionCenti: 700,
      effectiveFrom: '2026-11-17T09:00:00.000Z',
      override: false,
    });
  });

  it('uses kWh for electric and needs no baseline for a first row', async () => {
    const { app, calls } = appWith({ latestPrice: null });
    const res = await send(app, 'POST', '/admin/energy-prices', ADMIN, {
      ...PRICE_BODY,
      fuelType: 'electric',
      priceMilli: 2_500,
      consumptionCenti: 1_800,
    });
    expect(res.status).toBe(201);
    expect(find(calls, 'insert into app.energy_prices')?.values[3]).toBe('kWh');
  });

  it('answers 409 LARGE_CHANGE over 30 percent and inserts nothing', async () => {
    const { app, calls } = appWith();
    const res = await send(app, 'POST', '/admin/energy-prices', ADMIN, {
      ...PRICE_BODY,
      priceMilli: 14_000,
    });
    expect(res.status).toBe(409);
    const e = await errorOf(res);
    expect(e.code).toBe('LARGE_CHANGE');
    expect(e.fields).toEqual({ priceMilli: 'large_change' });
    expect(has(calls, 'insert into app.energy_prices')).toBe(false);
  });

  it('exactly +30 percent passes; consumption alone can trip the guard', async () => {
    const ok = appWith();
    expect(
      (
        await send(ok.app, 'POST', '/admin/energy-prices', ADMIN, {
          ...PRICE_BODY,
          priceMilli: 12_753,
        })
      ).status,
    ).toBe(201);
    const cons = appWith();
    const res = await send(cons.app, 'POST', '/admin/energy-prices', ADMIN, {
      ...PRICE_BODY,
      consumptionCenti: 1_000,
    });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).fields).toEqual({ consumptionCenti: 'large_change' });
  });

  it('with overrideLargeChange it saves and the audit row says so', async () => {
    const { app, calls } = appWith();
    const res = await send(app, 'POST', '/admin/energy-prices', ADMIN, {
      ...PRICE_BODY,
      priceMilli: 14_000,
      overrideLargeChange: true,
    });
    expect(res.status).toBe(201);
    expect(JSON.parse(String(find(calls, "'energy_price_added'")?.values[1])).override).toBe(true);
  });

  it('schedules a future price and rejects past, too-far and not-after-latest dates', async () => {
    const future = appWith();
    expect(
      (
        await send(future.app, 'POST', '/admin/energy-prices', ADMIN, {
          ...PRICE_BODY,
          effectiveFrom: '2026-11-25T06:00:00Z',
        })
      ).status,
    ).toBe(201);
    for (const [effectiveFrom, code] of [
      ['2026-11-10T00:00:00Z', 'past'],
      ['2026-12-31T00:00:00Z', 'too_far'],
      ['2026-11-15T00:00:00Z', 'past'],
    ]) {
      const t = appWith();
      const res = await send(t.app, 'POST', '/admin/energy-prices', ADMIN, {
        ...PRICE_BODY,
        effectiveFrom,
      });
      expect(res.status, effectiveFrom).toBe(400);
      expect((await errorOf(res)).fields).toEqual({ effectiveFrom: code });
    }
    const behind = appWith({
      latestPrice: {
        price_milli: 9810,
        consumption_centi: 700,
        effective_from: new Date('2026-11-17T09:00:00Z'),
      },
    });
    const res = await send(behind.app, 'POST', '/admin/energy-prices', ADMIN, PRICE_BODY);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({ effectiveFrom: 'not_after_latest' });
  });

  it.each([
    [{ priceMilli: 99 }, 'priceMilli'],
    [{ priceMilli: 50_001 }, 'priceMilli'],
    [{ consumptionCenti: 5_001 }, 'consumptionCenti'],
    [{ sourceNote: '' }, 'sourceNote'],
    [{ sourceNote: 'x'.repeat(201) }, 'sourceNote'],
    [{ priceMilli: 10_300.5 }, 'priceMilli'],
  ])('rejects %j with fields.%s', async (patch, field) => {
    const { app, calls } = appWith();
    const res = await send(app, 'POST', '/admin/energy-prices', ADMIN, { ...PRICE_BODY, ...patch });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toHaveProperty(field);
    expect(has(calls, 'insert into app.energy_prices')).toBe(false);
  });

  it('rejects an unknown fuel and a missing note', async () => {
    const { app } = appWith();
    expect(
      (await send(app, 'POST', '/admin/energy-prices', ADMIN, { ...PRICE_BODY, fuelType: 'coal' }))
        .status,
    ).toBe(400);
    const { sourceNote: _n, ...noNote } = PRICE_BODY;
    expect((await send(app, 'POST', '/admin/energy-prices', ADMIN, noNote)).status).toBe(400);
  });
});

// ---- ops and errors -----------------------------------------------------------------------------------------------------------------

describe('GET /admin/ops and /admin/errors', () => {
  it('returns the tiles with the email cap from the environment and the cron runs', async () => {
    const { app, calls } = appWith();
    const body = adminOpsResponseSchema.parse(
      await (await send(app, 'GET', '/admin/ops', ADMIN)).json(),
    );
    expect(body).toMatchObject({
      dbSizeMb: 71.5,
      emailsToday: 12,
      emailCap: 280,
      outboxPending: 3,
      outboxFailed24h: 1,
      routePreviewsToday: 44,
      errors24h: 2,
      openReports: 4,
      openDataRequests: 1,
      overdueDeletions: 0,
      cron: [{ job: 'haide-tick', status: 'succeeded', startedAt: '2026-11-17T08:59:00.000Z' }],
    });
    const ops = find(calls, 'pg_database_size');
    expect((ops?.values[0] as Date).toISOString()).toBe('2026-11-17T00:00:00.000Z'); // UTC midnight
    expect((ops?.values[1] as Date).toISOString()).toBe('2026-11-16T09:00:00.000Z'); // 24 h
    expect((ops?.values[4] as Date).toISOString()).toBe('2026-11-10T09:00:00.000Z'); // overdue after 7 days
  });

  it('still answers when the cron view fails', async () => {
    const { app } = appWith({
      failOn: { fragment: 'app.admin_cron_runs()', error: new Error('boom') },
    });
    const body = adminOpsResponseSchema.parse(
      await (await send(app, 'GET', '/admin/ops', ADMIN)).json(),
    );
    expect(body.cron).toEqual([]);
  });

  it('lists recent errors without a stack or a user hash, limit 50 by default and 100 at most', async () => {
    const { app, calls } = appWith();
    const body = adminErrorsResponseSchema.parse(
      await (await send(app, 'GET', '/admin/errors', ADMIN)).json(),
    );
    expect(body.items[0]).toEqual({
      id: 9,
      source: 'client',
      message: 'TypeError: x is undefined',
      route: '/search',
      appVersion: 'abc123',
      createdAt: '2026-11-17T08:00:00.000Z',
    });
    const q = find(calls, 'from app.app_errors');
    expect(q?.text).not.toMatch(/stack|user_id_hash/);
    expect(q?.values).toEqual([50]);
    expect((await send(app, 'GET', '/admin/errors?limit=100', ADMIN)).status).toBe(200);
    expect((await send(app, 'GET', '/admin/errors?limit=101', ADMIN)).status).toBe(400);
  });
});

// ---- nothing private leaves ------------------------------------------------------------------------------------------------------------

const FORBIDDEN_KEY =
  /^(phone|phonee164|plate|email|lat|lng|latitude|longitude|coordinates|geom|stack|userIdHash)$/i;

function scan(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => scan(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(FORBIDDEN_KEY.test(k) ? [`${path}.${k}`] : []),
      ...scan(v, `${path}.${k}`),
    ]);
  }
  return [];
}

describe('admin responses never carry private data', () => {
  const READS = [
    '/admin/metrics',
    '/admin/reports',
    '/admin/users?status=suspended',
    '/admin/energy-prices',
    '/admin/ops',
    '/admin/errors',
  ];

  it.each(READS)(
    'GET %s has no phone, plate, email, coordinate or stack key and no such value',
    async (path) => {
      const { app } = appWith();
      const text = await (await send(app, 'GET', path, ADMIN)).text();
      expect(scan(JSON.parse(text))).toEqual([]);
      expect(text).not.toMatch(/\+40\d{9}/);
      expect(text).not.toMatch(/SB12ABC/);
      expect(text).not.toMatch(/@example\.com/);
      expect(text).not.toMatch(/-?\d{1,3}\.\d{4,}\b/);
    },
  );

  it('the report queue shows area names, never street labels', async () => {
    const { app, calls } = appWith();
    await send(app, 'GET', '/admin/reports', ADMIN);
    const q = find(calls, 'from app.reports r left join app.rides rd');
    expect(q?.text).not.toMatch(
      /origin_label|destination_label|phone|ST_AsGeoJSON|origin\b|destination\b/,
    );
  });
});
