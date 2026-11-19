import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from '../_shared/contracts/errors.ts';
import {
  alertListResponseSchema,
  createAlertResponseSchema,
  createSeriesResponseSchema,
  monthStatsResponseSchema,
  pushConfigResponseSchema,
} from '../_shared/contracts/liquidity.ts';
import { BASE, makeApp, signToken, type Handler, type Query } from './testing.ts';

const USER = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';
const RIDE_ID = '5b0c7f0e-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const PREVIEW_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const SERIES_ID = 'c1c1c1c1-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const ALERT_ID = 'd1d1d1d1-6a1d-4c11-8d2e-9f3a4b5c6d7e';

const ALL_ACCEPTED = [
  { kind: 'age_18', version: null },
  { kind: 'terms', version: '1.0' },
  { kind: 'privacy', version: '1.0' },
];

// 87 and 22 base64url characters, the first one 'B' (an uncompressed point)
const P256DH = `B${'a'.repeat(86)}`;
const AUTH = 'b'.repeat(22);
const VAPID = {
  VAPID_PUBLIC_KEY: `B${'c'.repeat(86)}`,
  VAPID_PRIVATE_KEY: 'd'.repeat(43),
  VAPID_SUBJECT: 'mailto:support@haide.ro',
};

const alertRow = {
  id: ALERT_ID,
  from_lat: 45.7413,
  from_lng: 24.1861,
  to_lat: 45.785,
  to_lng: 24.09,
  origin_label: 'Shopping City',
  destination_label: 'Zona Industrială Vest',
  alert_date: null,
  weekdays: [1, 3],
  local_time: '07:30',
  window_min: 30,
  created_at: new Date('2026-11-16T05:00:00Z'),
  expires_at: new Date('2026-11-30T05:00:00Z'),
  last_notified_at: null,
  matches_sent: 0,
};

type State = {
  status: string;
  accepted: typeof ALL_ACCEPTED;
  hasVehicle: boolean;
  identical: boolean;
  alertCount: number;
  alertDeleted: boolean;
  dailyCount: number;
  previewValid: boolean;
  ownerStatus: string;
};

function liquidityDb(init: Partial<State> = {}) {
  const state: State = {
    status: 'active',
    accepted: ALL_ACCEPTED,
    hasVehicle: true,
    identical: false,
    alertCount: 0,
    alertDeleted: true,
    dailyCount: 0,
    previewValid: true,
    ownerStatus: 'published',
    ...init,
  };
  const handler: Handler = (q) => {
    const t = q.text;
    if (t.includes('from app.legal_documents')) {
      return [
        { kind: 'terms', version: '1.0', url: '/policy/terms' },
        { kind: 'privacy', version: '1.0', url: '/policy/privacy' },
      ];
    }
    if (t.includes('has_vehicle')) {
      return [
        {
          id: USER,
          first_name: 'Radu',
          phone_e164: '+40721234567',
          bio: null,
          photo_path: 'avatars/6f9619ff-8b86-4d11-b42d-00c04fc964ff.jpg',
          status: state.status,
          role: 'user',
          created_at: new Date('2026-10-01T10:00:00Z'),
          has_vehicle: state.hasVehicle,
        },
      ];
    }
    if (t.includes('from app.consents')) return state.accepted;
    if (t.includes('from app.vehicles where owner_id')) {
      return [
        {
          make: 'Dacia',
          model: 'Logan',
          colour: 'Grey',
          plate: 'SB12ABC',
          fuel_type: 'diesel',
          seats: 3,
        },
      ];
    }
    if (t.includes('from app.energy_prices')) {
      return [{ id: 'ep-diesel', price_milli: 10850, consumption_centi: 600 }];
    }
    if (t.includes('ST_DWithin(pl.geom')) {
      return [{ area_id: 'area-1', area_name: 'Șelimbăr', place_name: null }];
    }
    if (t.includes('for no key update')) return [{ id: USER }];
    if (t.includes('ST_Equals(a.origin')) return state.identical ? [alertRow] : [];
    if (t.includes('select count(*)::int as n from app.ride_alerts'))
      return [{ n: state.alertCount }];
    if (t.startsWith('insert into app.ride_alerts')) return [alertRow];
    if (t.includes('from app.ride_alerts a') && t.includes('order by a.created_at desc'))
      return [alertRow];
    if (t.startsWith('delete from app.ride_alerts'))
      return state.alertDeleted ? [{ id: ALERT_ID }] : [];
    if (t.includes('pg_advisory_xact_lock')) return [];
    if (t.startsWith('insert into app.ride_series')) return [{ id: SERIES_ID }];
    if (t.includes('from app.ride_series s')) {
      return [
        {
          id: SERIES_ID,
          weekdays: [1, 3],
          departure_time: '09:00',
          starts_on: '2026-11-16',
          ends_on: '2026-12-02',
          status: 'active',
          upcoming_count: 5,
        },
      ];
    }
    if (t.includes('select count(*)::int as n from app.rides')) return [{ n: state.dailyCount }];
    if (t.startsWith('insert into app.rides')) return state.previewValid ? [{ id: RIDE_ID }] : [];
    if (t.includes('from app.user_month_stats')) {
      return [
        {
          driver_shared_bani: '1250',
          driver_passengers: 3,
          driver_rides: 2,
          passenger_paid_bani: 0,
          passenger_rides: 0,
        },
      ];
    }
    if (t.includes('as route_geojson') && t.includes('for update')) {
      return [
        {
          id: RIDE_ID,
          status: state.ownerStatus,
          departure_at: new Date('2026-11-20T07:00:00Z'),
        },
      ];
    }
    return undefined;
  };
  return { handler, state };
}

async function call(opts: {
  method: string;
  path: string;
  body?: unknown;
  token?: boolean;
  db?: Partial<State>;
  env?: Record<string, string>;
}) {
  const { handler } = liquidityDb(opts.db);
  const ctx = makeApp([handler], opts.env ?? {});
  const headers: Record<string, string> = {};
  if (opts.token !== false) headers.authorization = `Bearer ${await signToken(USER)}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await ctx.app.request(`${BASE}${opts.path}`, {
    method: opts.method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { res, calls: ctx.calls as Query[] };
}

const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;

const alertBody = {
  from: { lat: 45.7413, lng: 24.1861 },
  to: { lat: 45.785, lng: 24.09 },
  fromLabel: 'Shopping City',
  toLabel: 'Zona Industrială Vest',
  schedule: { kind: 'weekly', weekdays: [1, 3] },
  time: '07:30',
  windowMin: 30,
};
const seriesBody = {
  previewId: PREVIEW_ID,
  weekdays: [1, 3],
  departureTime: '09:00',
  endsOn: '2026-12-02',
  seats: 2,
};
const subBody = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: P256DH, auth: AUTH },
};

const WRITES: { method: string; path: string; body?: unknown }[] = [
  { method: 'POST', path: '/ride-series', body: seriesBody },
  { method: 'POST', path: `/ride-series/${SERIES_ID}/cancel`, body: {} },
  { method: 'PATCH', path: `/me/rides/${RIDE_ID}`, body: { autoAccept: true } },
  { method: 'POST', path: '/alerts', body: alertBody },
  { method: 'DELETE', path: `/alerts/${ALERT_ID}` },
  { method: 'PUT', path: '/me/push-subscription', body: subBody },
  { method: 'DELETE', path: '/me/push-subscription', body: {} },
];
const READS = [
  { method: 'GET', path: '/me/alerts' },
  { method: 'GET', path: '/me/stats/month' },
];

describe('E8 gates', () => {
  it('every route but /push/config needs a signed-in user (401)', async () => {
    for (const r of [...WRITES, ...READS]) {
      const { res } = await call({ ...r, token: false, env: VAPID });
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });

  it('a suspended account is refused everywhere (403 ACCOUNT_SUSPENDED)', async () => {
    for (const r of [...WRITES, ...READS]) {
      const { res } = await call({ ...r, db: { status: 'suspended' }, env: VAPID });
      expect(res.status, `${r.method} ${r.path}`).toBe(403);
      expect((await errorOf(res)).code).toBe('ACCOUNT_SUSPENDED');
    }
  });

  it('writes need consent (CONSENT_REQUIRED); reads do not', async () => {
    for (const r of WRITES) {
      const { res } = await call({ ...r, db: { accepted: [] }, env: VAPID });
      expect(res.status, `${r.method} ${r.path}`).toBe(403);
      expect((await errorOf(res)).code).toBe('CONSENT_REQUIRED');
    }
    for (const r of READS) {
      const { res } = await call({ ...r, db: { accepted: [] } });
      expect(res.status, `${r.method} ${r.path}`).toBe(200);
    }
  });

  it('a series also needs a vehicle (VEHICLE_REQUIRED)', async () => {
    const { res } = await call({
      method: 'POST',
      path: '/ride-series',
      body: seriesBody,
      db: { hasVehicle: false },
    });
    expect((await errorOf(res)).code).toBe('VEHICLE_REQUIRED');
  });

  it('ids that are not UUIDs are 404', async () => {
    for (const r of [
      { method: 'POST', path: '/ride-series/nope/cancel', body: {} },
      { method: 'PATCH', path: '/me/rides/nope', body: { autoAccept: true } },
      { method: 'DELETE', path: '/alerts/nope' },
    ]) {
      const { res } = await call(r);
      expect(res.status, r.path).toBe(404);
    }
  });
});

describe('POST /ride-series', () => {
  it('creates every instance, one published event each, and reports the series', async () => {
    const { res, calls } = await call({ method: 'POST', path: '/ride-series', body: seriesBody });
    expect(res.status).toBe(201);
    const out = createSeriesResponseSchema.parse(await res.json());
    // Mon and Wed from 16 Nov to 2 Dec: 16, 18, 23, 25, 30 Nov and 2 Dec
    expect(out.created).toHaveLength(6);
    expect(out.skipped).toEqual([]);
    expect(out.series.id).toBe(SERIES_ID);
    expect(calls.filter((c) => c.text.startsWith('insert into app.rides'))).toHaveLength(6);
    // one lock for the whole series, taken before anything is inserted
    const lock = calls.findIndex((c) => c.text.includes('pg_advisory_xact_lock'));
    const firstInsert = calls.findIndex((c) => c.text.startsWith('insert into app.ride_series'));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(firstInsert);
  });

  it('skips a full day as DAILY_RIDE_LIMIT and the rest still go through', async () => {
    const { handler } = liquidityDb();
    let n = 0;
    const wrapped: Handler = (q) => {
      if (q.text.includes('select count(*)::int as n from app.rides'))
        return [{ n: n++ === 1 ? 4 : 0 }];
      return handler(q);
    };
    const ctx = makeApp([wrapped]);
    const res = await ctx.app.request(`${BASE}/ride-series`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await signToken(USER)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(seriesBody),
    });
    const out = createSeriesResponseSchema.parse(await res.json());
    expect(out.created).toHaveLength(5);
    expect(out.skipped).toEqual([{ date: '2026-11-18', code: 'DAILY_RIDE_LIMIT' }]);
  });

  it('409 DAILY_RIDE_LIMIT when nothing could be created', async () => {
    const { res } = await call({
      method: 'POST',
      path: '/ride-series',
      body: seriesBody,
      db: { dailyCount: 4 },
    });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('DAILY_RIDE_LIMIT');
  });

  it('PREVIEW_EXPIRED when the preview is unknown or expired', async () => {
    const { res } = await call({
      method: 'POST',
      path: '/ride-series',
      body: seriesBody,
      db: { previewValid: false },
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('PREVIEW_EXPIRED');
  });

  it('SEATS_EXCEED_VEHICLE and the field codes', async () => {
    const seats = await call({
      method: 'POST',
      path: '/ride-series',
      body: { ...seriesBody, seats: 4 },
    });
    expect((await errorOf(seats.res)).code).toBe('SEATS_EXCEED_VEHICLE');

    const cases: [Record<string, unknown>, string, string][] = [
      [{ weekdays: [] }, 'weekdays', 'invalid'],
      [{ weekdays: [1, 1] }, 'weekdays', 'invalid'],
      [{ departureTime: '9:00' }, 'departureTime', 'invalid'],
      [{ startsOn: '2026-11-15' }, 'startsOn', 'past'],
      [{ startsOn: '2026-12-01' }, 'startsOn', 'too_far'],
      [{ startsOn: '2026-11-20', endsOn: '2026-11-19' }, 'endsOn', 'before_start'],
      [{ endsOn: '2026-12-15' }, 'endsOn', 'too_far'],
      [{ weekdays: [2], startsOn: '2026-11-18', endsOn: '2026-11-18' }, 'endsOn', 'no_dates'],
    ];
    for (const [over, field, code] of cases) {
      const { res } = await call({
        method: 'POST',
        path: '/ride-series',
        body: { ...seriesBody, ...over },
      });
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect((await errorOf(res)).fields?.[field], JSON.stringify(over)).toBe(code);
    }
  });

  it('never sends a price: an unknown price field is dropped', async () => {
    const { res, calls } = await call({
      method: 'POST',
      path: '/ride-series',
      body: { ...seriesBody, priceBani: 1, autoAccept: true },
    });
    expect(res.status).toBe(201);
    expect(JSON.stringify(calls.map((c) => c.values))).not.toContain('priceBani');
  });
});

describe('POST /ride-series/{id}/cancel and PATCH /me/rides/{id}', () => {
  it('PATCH 404 for a ride that is not the caller own', async () => {
    const { handler } = liquidityDb();
    const ctx = makeApp([(q) => (q.text.includes('as route_geojson') ? [] : handler(q))]);
    const res = await ctx.app.request(`${BASE}/me/rides/${RIDE_ID}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${await signToken(USER)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ autoAccept: true }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH 409 INVALID_STATE for a cancelled ride; 400 for a non-boolean', async () => {
    const a = await call({
      method: 'PATCH',
      path: `/me/rides/${RIDE_ID}`,
      body: { autoAccept: true },
      db: { ownerStatus: 'cancelled' },
    });
    expect(a.res.status).toBe(409);
    expect((await errorOf(a.res)).code).toBe('INVALID_STATE');
    const b = await call({
      method: 'PATCH',
      path: `/me/rides/${RIDE_ID}`,
      body: { autoAccept: 'yes' },
    });
    expect(b.res.status).toBe(400);
  });

  it('the series cancel is 404 for an unknown series', async () => {
    const { res } = await call({
      method: 'POST',
      path: `/ride-series/${SERIES_ID}/cancel`,
      body: {},
    });
    expect(res.status).toBe(404);
  });
});

describe('alerts', () => {
  it('POST /alerts 201 with the alert, and an alert_created event with areas only', async () => {
    const { res, calls } = await call({ method: 'POST', path: '/alerts', body: alertBody });
    expect(res.status).toBe(201);
    const out = createAlertResponseSchema.parse(await res.json());
    expect(out.item.schedule).toEqual({ kind: 'weekly', weekdays: [1, 3] });
    const ev = calls.find((c) => c.text.startsWith('insert into app.analytics_events'));
    expect(ev?.values[0]).toBe('alert_created');
    const props = JSON.parse(String(ev?.values[2])) as Record<string, unknown>;
    expect(props).toMatchObject({
      alertId: ALERT_ID,
      kind: 'weekly',
      windowMin: 30,
      fromArea: 'Șelimbăr',
    });
  });

  it('an identical active alert is 200 and writes nothing', async () => {
    const { res, calls } = await call({
      method: 'POST',
      path: '/alerts',
      body: alertBody,
      db: { identical: true },
    });
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.text.startsWith('insert into app.ride_alerts'))).toBe(false);
  });

  it('the 6th active alert is 409 ALERT_LIMIT', async () => {
    const { res } = await call({
      method: 'POST',
      path: '/alerts',
      body: alertBody,
      db: { alertCount: 5 },
    });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('ALERT_LIMIT');
  });

  it('the field codes', async () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ from: { lat: 44, lng: 24.1 } }, 'from', 'outside_coverage'],
      [{ to: { lat: 45.7418, lng: 24.1865 } }, 'to', 'too_close'],
      [{ schedule: { kind: 'date', date: '2026-11-15' } }, 'schedule', 'past'],
      [{ schedule: { kind: 'date', date: '2026-12-01' } }, 'schedule', 'too_far'],
      [{ schedule: { kind: 'weekly', weekdays: [9] } }, 'schedule', 'invalid'],
      [{ time: '25:00' }, 'time', 'invalid'],
      [{ windowMin: 20 }, 'windowMin', 'invalid'],
      [{ fromLabel: '' }, 'fromLabel', 'required'],
      [{ toLabel: 'x'.repeat(81) }, 'toLabel', 'too_long'],
    ];
    for (const [over, field, code] of cases) {
      const { res } = await call({
        method: 'POST',
        path: '/alerts',
        body: { ...alertBody, ...over },
      });
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect((await errorOf(res)).fields?.[field], JSON.stringify(over)).toBe(code);
    }
  });

  it('GET /me/alerts lists, DELETE /alerts/{id} is 204 or 404', async () => {
    const list = await call({ method: 'GET', path: '/me/alerts' });
    expect(alertListResponseSchema.parse(await list.res.json()).items).toHaveLength(1);
    expect((await call({ method: 'DELETE', path: `/alerts/${ALERT_ID}` })).res.status).toBe(204);
    const gone = await call({
      method: 'DELETE',
      path: `/alerts/${ALERT_ID}`,
      db: { alertDeleted: false },
    });
    expect(gone.res.status).toBe(404);
  });
});

describe('push', () => {
  it('GET /push/config is public, cacheable, and null without VAPID keys', async () => {
    const off = await call({ method: 'GET', path: '/push/config', token: false });
    expect(off.res.status).toBe(200);
    expect(pushConfigResponseSchema.parse(await off.res.json())).toEqual({ vapidPublicKey: null });
    expect(off.res.headers.get('cache-control')).toBe('public, max-age=3600');

    const on = await call({ method: 'GET', path: '/push/config', token: false, env: VAPID });
    expect(pushConfigResponseSchema.parse(await on.res.json()).vapidPublicKey).toBe(
      VAPID.VAPID_PUBLIC_KEY,
    );
  });

  it('PUT stores the subscription (204), keyed by endpoint', async () => {
    const { res, calls } = await call({
      method: 'PUT',
      path: '/me/push-subscription',
      body: subBody,
      env: VAPID,
    });
    expect(res.status).toBe(204);
    const up = calls.find((c) => c.text.includes('insert into app.push_subscriptions'));
    expect(up?.text).toContain('on conflict (endpoint)');
    expect(up?.values).toContain(subBody.endpoint);
  });

  it('PUT is 503 when push is disabled', async () => {
    const { res } = await call({ method: 'PUT', path: '/me/push-subscription', body: subBody });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('TEMPORARILY_UNAVAILABLE');
  });

  it('PUT refuses unsupported services, plain http and bad keys', async () => {
    const bad = async (body: unknown) =>
      (await call({ method: 'PUT', path: '/me/push-subscription', body, env: VAPID })).res;
    const a = await bad({ ...subBody, endpoint: 'https://evil.example/x' });
    expect(a.status).toBe(400);
    expect((await errorOf(a)).fields?.endpoint).toBe('unsupported_service');
    const b = await bad({ ...subBody, endpoint: 'http://fcm.googleapis.com/x' });
    expect((await errorOf(b)).fields?.endpoint).toBe('invalid');
    const c = await bad({ ...subBody, keys: { p256dh: 'x', auth: AUTH } });
    expect((await errorOf(c)).fields?.keys).toBe('invalid');
    expect((await bad({ endpoint: subBody.endpoint })).status).toBe(400);
  });

  it('DELETE is 204 and idempotent; without an endpoint it removes all of the caller', async () => {
    const one = await call({
      method: 'DELETE',
      path: '/me/push-subscription',
      body: { endpoint: subBody.endpoint },
    });
    expect(one.res.status).toBe(204);
    expect(
      one.calls.find((c) => c.text.startsWith('delete from app.push_subscriptions'))?.text,
    ).toContain('endpoint =');
    const all = await call({ method: 'DELETE', path: '/me/push-subscription' });
    expect(all.res.status).toBe(204);
    expect(
      all.calls.find((c) => c.text.startsWith('delete from app.push_subscriptions'))?.text,
    ).not.toContain('endpoint =');
  });
});

describe('GET /me/stats/month', () => {
  it('defaults to the current local month and returns zeros-or-numbers', async () => {
    const { res, calls } = await call({ method: 'GET', path: '/me/stats/month' });
    expect(res.status).toBe(200);
    const out = monthStatsResponseSchema.parse(await res.json());
    expect(out).toMatchObject({ month: '2026-11', from: '2026-11-01', to: '2026-12-01' });
    expect(out.driver).toEqual({
      sharedFuelCostBani: 1250,
      passengersCarried: 3,
      ridesCompleted: 2,
    });
    expect(calls.find((c) => c.text.includes('user_month_stats'))?.values[1]).toBe('2026-11-01');
  });

  it('400 with fields.month = invalid, before_launch or future', async () => {
    for (const [month, code] of [
      ['2026-13', 'invalid'],
      ['nope', 'invalid'],
      ['2026-10', 'before_launch'],
      ['2026-12', 'future'],
    ] as const) {
      const { res } = await call({ method: 'GET', path: `/me/stats/month?month=${month}` });
      expect(res.status, month).toBe(400);
      expect((await errorOf(res)).fields?.month, month).toBe(code);
    }
  });
});
