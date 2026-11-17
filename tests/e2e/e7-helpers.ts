import type { Page, Route } from '@playwright/test';
import { mockAccountApi, newAccount, seedSession, type FakeAccount } from './accounts-helpers';

/** What the E7 specs record about the mocked admin endpoints. */
export interface AdminCalls {
  dismiss: Array<{ id: string; body: Record<string, unknown> }>;
  suspend: Array<{ id: string; body: Record<string, unknown> }>;
  unsuspend: Array<{ id: string; body: Record<string, unknown> }>;
  energy: Array<Record<string, unknown>>;
  metricsWeeks: Array<string | null>;
  adminRequests: number;
}

export interface E7Options {
  theme?: 'dark' | 'light';
  role?: 'admin' | 'user';
  /** The first POST /admin/energy-prices without overrideLargeChange answers 409 even below 30 % (server is the authority). */
  serverLargeOnce?: boolean;
  /** Make the metrics call fail once (error state). */
  metricsFail?: boolean;
  /** Empty reports and suspended lists (empty states). */
  empty?: boolean;
}

const user = (id: string, firstName: string | null, over: Record<string, unknown> = {}) => ({
  id,
  firstName,
  photoUrl: null,
  status: 'active',
  memberSince: '2026-09',
  ridesCompleted: 12,
  reports90d: 0,
  ...over,
});

const price = (over: Record<string, unknown>) => ({
  id: 'ep-1',
  fuelType: 'petrol',
  priceMilli: 7200,
  consumptionCenti: 650,
  unit: 'l',
  effectiveFrom: '2026-11-01T00:00:00Z',
  sourceNote: 'Average pump price, week 44',
  createdBy: { id: 'a-1', firstName: 'Dragoș' },
  createdAt: '2026-11-01T08:00:00Z',
  ...over,
});

const metric = (value: number | null, target: number, kill: number, status: string, n: number) => ({
  value,
  target,
  kill,
  status,
  n,
});

export const metricsFor = (week: string, partial: boolean) => ({
  week,
  from: '2026-11-15T22:00:00Z',
  to: '2026-11-22T22:00:00Z',
  partial,
  northStar: metric(64, 100, 30, 'between', 64),
  matchRate: {
    overall: metric(0.298, 0.3, 0.15, 'between', 454),
    launch: metric(0.342, 0.3, 0.15, 'on_target', 412),
    byCorridor: [
      { corridor: 'south', value: 0.38, searches: 160 },
      { corridor: 'west', value: 0.31, searches: 120 },
      { corridor: 'campus', value: 0.33, searches: 90 },
      { corridor: 'other', value: 0.12, searches: 42 },
    ],
  },
  fillRate: metric(0.18, 0.25, 0.1, 'between', 77),
  medianResponseMin: metric(11.4, 15, 60, 'on_target', 58),
  retention4w: {
    ...metric(0.22, 0.4, 0.2, 'between', 18),
    cohortWeek: '2026-W43',
    closed: false,
  },
  reportsPer100: metric(2.1, 1, 3, 'between', 48),
  cancellationRate: metric(0.34, 0.15, 0.3, 'below_kill', 83),
  series: Array.from({ length: 12 }, (_, i) => ({
    week: `2026-W${String(36 + i).padStart(2, '0')}`,
    completedSeats: [3, 5, 9, 14, 22, 27, 35, 41, 48, 52, 58, 64][i],
  })),
  flags: {
    highVolumeDrivers: [{ user: user('u-9', 'Mihai', { ridesCompleted: 90 }), completed7d: 43 }],
  },
});

const reportItem = (over: Record<string, unknown> = {}) => ({
  id: 'rep-1',
  status: 'open',
  reason: 'harassment',
  details:
    'Kept messaging me after I asked them to stop and then called the number from the ride more than once.',
  createdAt: '2026-11-16T18:20:00Z',
  resolvedAt: null,
  reporter: user('u-2', 'Ioana', { memberSince: '2026-10' }),
  reported: { ...user('u-3', 'Radu', { reports90d: 2 }), openReports: 2 },
  ride: {
    id: 'ride-1',
    departureAt: '2026-11-16T05:30:00Z',
    fromArea: 'Terezian',
    toArea: 'Campus',
  },
  bookingId: 'b-1',
  history: [
    {
      action: 'dismiss_report',
      adminFirstName: 'Dragoș',
      at: '2026-10-20T09:00:00Z',
      note: 'Not a ToS issue',
    },
  ],
  ...over,
});

const err = (route: Route, status: number, code: string, fields?: Record<string, string>) =>
  route.fulfill({
    status,
    json: { error: { code, message: code, requestId: 'r', ...(fields ? { fields } : {}) } },
  });

/**
 * Mocked API for the E7 admin screens (e7 spec section 6). The gates, metrics SQL and audit rows are covered by the
 * backend suites; these specs check what the admin sees and sends at 360x800 (and 1280x800 for the screenshots).
 */
export async function setupE7(page: Page, opts: E7Options = {}) {
  const calls: AdminCalls = {
    dismiss: [],
    suspend: [],
    unsuspend: [],
    energy: [],
    metricsWeeks: [],
    adminRequests: 0,
  };
  // The metrics week is derived from the clock: pin it to Tuesday of 2026-W47.
  await page.clock.setFixedTime(new Date('2026-11-17T10:00:00Z'));
  await page.addInitScript(
    (th) => window.localStorage.setItem('haide.theme', th),
    opts.theme ?? 'dark',
  );
  await seedSession(page);
  const acc: FakeAccount = newAccount({
    firstName: 'Dragoș',
    phoneE164: '+40721234567',
    profileComplete: true,
    consent: { upToDate: true, required: [] },
    role: opts.role ?? 'admin',
  });
  await mockAccountApi(page, acc);
  await page.route('**/api/v1/rides*', (r) => r.fulfill({ json: { items: [] } }));

  // State the screens change.
  let reportStatus: 'open' | 'dismissed' | 'actioned' = 'open';
  let reportedStatus: 'active' | 'suspended' = 'active';
  let metricsFails = 0;
  let largeOnce = opts.serverLargeOnce === true;
  const energy = {
    current: price({}),
    scheduled: null as ReturnType<typeof price> | null,
    history: [
      price({
        id: 'ep-0',
        priceMilli: 7000,
        effectiveFrom: '2026-10-01T00:00:00Z',
        sourceNote: 'Average pump price, week 40',
      }),
      price({}),
    ],
    diesel: price({ id: 'ep-d', fuelType: 'diesel', priceMilli: 7500, consumptionCenti: 600 }),
    lpg: price({ id: 'ep-l', fuelType: 'lpg', priceMilli: 3400, consumptionCenti: 900 }),
    electric: price({
      id: 'ep-e',
      fuelType: 'electric',
      priceMilli: 1900,
      consumptionCenti: 1800,
      unit: 'kWh',
    }),
  };

  await page.route('**/api/v1/admin/**', async (route) => {
    calls.adminRequests += 1;
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/api\/v1\/admin/, '');
    const body = () => (req.postData() ? (req.postDataJSON() as Record<string, unknown>) : {});

    if (opts.role === 'user') return err(route, 403, 'FORBIDDEN');

    if (path === '/metrics') {
      calls.metricsWeeks.push(url.searchParams.get('week'));
      if (opts.metricsFail && metricsFails < 2) {
        metricsFails += 1; // the app retries a 5xx once, so fail twice
        return err(route, 500, 'INTERNAL');
      }
      const week = url.searchParams.get('week') ?? '2026-W47';
      return route.fulfill({ json: metricsFor(week, week === '2026-W47') });
    }
    if (path === '/reports') {
      if (opts.empty) return route.fulfill({ json: { items: [], nextCursor: null } });
      const wanted = url.searchParams.get('status') ?? 'open';
      const item = reportItem({
        status: reportStatus,
        reported: {
          ...user('u-3', 'Radu', { reports90d: 2, status: reportedStatus }),
          openReports: reportStatus === 'open' ? 2 : 1,
        },
      });
      const show = wanted === 'all' || wanted === reportStatus;
      return route.fulfill({ json: { items: show ? [item] : [], nextCursor: null } });
    }
    const dismiss = /^\/reports\/([^/]+)\/dismiss$/.exec(path);
    if (dismiss) {
      calls.dismiss.push({ id: dismiss[1]!, body: body() });
      reportStatus = 'dismissed';
      return route.fulfill({ status: 204 });
    }
    const suspend = /^\/users\/([^/]+)\/suspend$/.exec(path);
    if (suspend) {
      calls.suspend.push({ id: suspend[1]!, body: body() });
      reportedStatus = 'suspended';
      if (body().reportId) reportStatus = 'actioned';
      return route.fulfill({ status: 204 });
    }
    const unsuspend = /^\/users\/([^/]+)\/unsuspend$/.exec(path);
    if (unsuspend) {
      calls.unsuspend.push({ id: unsuspend[1]!, body: body() });
      reportedStatus = 'active';
      return route.fulfill({ status: 204 });
    }
    if (path === '/users') {
      const items =
        reportedStatus === 'suspended' && !opts.empty
          ? [
              {
                user: user('u-3', 'Radu', { status: 'suspended' }),
                suspendedAt: '2026-11-17T09:00:00Z',
                reasonCode: 'harassment',
                statement: 'Repeated unwanted contact after a request to stop.',
                adminFirstName: 'Dragoș',
              },
            ]
          : [];
      return route.fulfill({ json: { items } });
    }
    if (path === '/energy-prices' && req.method() === 'GET') {
      return route.fulfill({
        json: {
          fuels: [
            { fuelType: 'petrol', unit: 'l', current: energy.current, scheduled: energy.scheduled },
            { fuelType: 'diesel', unit: 'l', current: energy.diesel, scheduled: null },
            { fuelType: 'lpg', unit: 'l', current: energy.lpg, scheduled: null },
            { fuelType: 'electric', unit: 'kWh', current: energy.electric, scheduled: null },
          ],
          history: energy.history,
        },
      });
    }
    if (path === '/energy-prices' && req.method() === 'POST') {
      const b = body();
      calls.energy.push(b);
      const fuel = b.fuelType as 'petrol' | 'diesel' | 'lpg' | 'electric';
      const prev = fuel === 'petrol' ? energy.current : energy[fuel];
      const big =
        Math.abs((b.priceMilli as number) - prev.priceMilli) * 100 > 30 * prev.priceMilli ||
        Math.abs((b.consumptionCenti as number) - prev.consumptionCenti) * 100 >
          30 * prev.consumptionCenti;
      if ((big || largeOnce) && b.overrideLargeChange !== true) {
        largeOnce = false;
        return err(route, 409, 'LARGE_CHANGE', { priceMilli: 'large_change' });
      }
      const item = price({
        id: `ep-${calls.energy.length + 10}`,
        priceMilli: b.priceMilli,
        consumptionCenti: b.consumptionCenti,
        sourceNote: b.sourceNote,
        effectiveFrom: (b.effectiveFrom as string | undefined) ?? '2026-11-17T12:00:00Z',
      });
      if (fuel === 'petrol') energy.current = item;
      else energy[fuel] = { ...item, fuelType: fuel, unit: fuel === 'electric' ? 'kWh' : 'l' };
      energy.history = [...energy.history, item];
      return route.fulfill({ status: 201, json: { item } });
    }
    if (path === '/ops') {
      return route.fulfill({
        json: {
          dbSizeMb: 212,
          emailsToday: 37,
          emailCap: 100,
          outboxPending: 2,
          outboxFailed24h: 0,
          routePreviewsToday: 64,
          errors24h: 3,
          openReports: 1,
          openDataRequests: 0,
          overdueDeletions: 0,
          cron: [
            { job: 'haide-tick', status: 'succeeded', startedAt: '2026-11-17T12:59:00Z' },
            { job: 'haide-retention', status: 'succeeded', startedAt: '2026-11-17T03:00:00Z' },
          ],
        },
      });
    }
    if (path === '/errors') {
      return route.fulfill({
        json: {
          items: opts.empty
            ? []
            : [
                {
                  id: 1,
                  source: 'client',
                  message: 'Failed to fetch',
                  route: '/find',
                  appVersion: '0.0.0',
                  createdAt: '2026-11-17T11:40:00Z',
                },
                {
                  id: 2,
                  source: 'server',
                  message: 'ORS timeout',
                  route: null,
                  appVersion: null,
                  createdAt: '2026-11-17T10:12:00Z',
                },
              ],
        },
      });
    }
    return err(route, 404, 'NOT_FOUND');
  });
  return { calls, acc };
}
