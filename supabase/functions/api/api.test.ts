import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from '../_shared/contracts/errors.ts';
import { healthResponseSchema, tickResponseSchema } from '../_shared/contracts/system.ts';
import { placesResponseSchema, reverseResponseSchema } from '../_shared/contracts/geo.ts';
import { authMiddleware, requireAuth } from './middleware/auth.ts';
import { onError, pgDiagnostics } from './middleware/errors.ts';
import type { AppBindings } from './types.ts';
import { BASE, TEST_CRON_SECRET, makeApp, signToken, type Handler } from './testing.ts';

const json = (body: unknown, extra: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...extra },
  body: JSON.stringify(body),
});

const USER = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';

const placeRow = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Șelimbăr',
  kind: 'area',
  locality: 'Șelimbăr',
  area_name: 'Șelimbăr',
  lat: 45.7421234,
  lng: 24.1881234,
};

describe('GET /health', () => {
  it('returns 200 with db ok and the version', async () => {
    const { app } = makeApp([(q) => (q.text.includes('select 1 as ok') ? [{ ok: 1 }] : undefined)]);
    const res = await app.request(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body).toEqual({ status: 'ok', db: 'ok', version: 'test-sha' });
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('returns 503 degraded when the database is down', async () => {
    const down: Handler = (q) => {
      if (q.text.includes('select 1 as ok')) throw new Error('connection refused');
      return undefined;
    };
    const { app } = makeApp([down]);
    const res = await app.request(`${BASE}/health`);
    expect(res.status).toBe(503);
    expect(healthResponseSchema.parse(await res.json())).toMatchObject({
      status: 'degraded',
      db: 'down',
    });
  });
});

describe('error envelope', () => {
  it('answers unknown routes with a NOT_FOUND envelope and a request id', async () => {
    const { app } = makeApp();
    const res = await app.request(`${BASE}/nope`);
    expect(res.status).toBe(404);
    const body = errorEnvelopeSchema.parse(await res.json());
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(res.headers.get('x-request-id'));
  });

  it('turns unexpected errors into 500 INTERNAL without leaking details, and records them', async () => {
    const boom: Handler = (q) => {
      if (q.text.includes('app.places')) throw new Error('relation "app.places" does not exist');
      return undefined;
    };
    const { app, calls } = makeApp([boom]);
    const res = await app.request(`${BASE}/places?q=selimbar`);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('relation');
    expect(errorEnvelopeSchema.parse(JSON.parse(text)).error.code).toBe('INTERNAL');
    const logged = calls.find((c) => c.text.includes('insert into app.app_errors'));
    expect(logged?.values[0]).toBe('server');
  });
});

describe('unhandled_error log', () => {
  it('logs scrubbed Postgres diagnostics and never the detail or row values', async () => {
    const pgErr = Object.assign(
      new Error('new row for relation "rides" violates check constraint'),
      {
        name: 'PostgresError',
        code: '23514',
        constraint_name: 'rides_vehicle_snapshot_check',
        table_name: 'rides',
        column_name: 'vehicle_snapshot',
        routine: 'ExecConstraints',
        detail: 'Failing row contains (ana@example.com, 45.79712, 24.15211)',
      },
    );
    const boom: Handler = (q) => {
      if (q.text.includes('app.places')) throw pgErr;
      return undefined;
    };
    const lines: { event: string; fields: Record<string, unknown> }[] = [];
    const { app } = makeApp(
      [boom],
      {},
      { log: (_level, event, fields = {}) => void lines.push({ event, fields }) },
    );
    const res = await app.request(`${BASE}/places?q=selimbar`);
    expect(res.status).toBe(500);
    const line = lines.find((l) => l.event === 'unhandled_error');
    expect(line?.fields).toMatchObject({
      name: 'PostgresError',
      pgCode: '23514',
      pgConstraint: 'rides_vehicle_snapshot_check',
      pgTable: 'rides',
      pgColumn: 'vehicle_snapshot',
      pgRoutine: 'ExecConstraints',
    });
    const dump = JSON.stringify(line);
    expect(dump).not.toContain('ana@example.com');
    expect(dump).not.toContain('45.79712');
  });

  it('scrubs emails and coordinates from the server message', () => {
    const e = Object.assign(new Error('bad value ana@example.com at 45.79712, 24.15211'), {
      name: 'PostgresError',
      code: '22P02',
    });
    const d = pgDiagnostics(e);
    expect(d.pgMessage).toBe('bad value [email] at [coords]');
    expect(d.pgCode).toBe('22P02');
  });

  it('adds nothing for non-Postgres errors', () => {
    expect(pgDiagnostics(new Error('x'))).toEqual({});
  });
});

describe('GET /places', () => {
  it('returns mapped places (5 decimals, secondary label)', async () => {
    const { app, calls } = makeApp([
      (q) => (q.text.includes('from app.places') ? [placeRow] : undefined),
    ]);
    const res = await app.request(`${BASE}/places?q=selimbar&limit=3`);
    expect(res.status).toBe(200);
    const body = placesResponseSchema.parse(await res.json());
    expect(body.items).toEqual([
      {
        id: placeRow.id,
        name: 'Șelimbăr',
        secondary: '',
        kind: 'area',
        point: { lat: 45.74212, lng: 24.18812 },
        areaName: 'Șelimbăr',
      },
    ]);
    const search = calls.find((c) => c.text.includes('from app.places'));
    expect(search?.values).toEqual(['selimbar', 3]);
  });

  it('adds locality and area to the secondary label', async () => {
    const row = {
      ...placeRow,
      name: 'Piața Mare',
      kind: 'poi',
      locality: 'Sibiu',
      area_name: 'Centru',
    };
    const { app } = makeApp([(q) => (q.text.includes('from app.places') ? [row] : undefined)]);
    const body = placesResponseSchema.parse(
      await (await app.request(`${BASE}/places?q=piata mare`)).json(),
    );
    expect(body.items[0]?.secondary).toBe('Sibiu, Centru');
  });

  it('defaults limit to 8 and trims the query', async () => {
    const { app, calls } = makeApp();
    const res = await app.request(`${BASE}/places?q=%20%20piata%20`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
    expect(calls.find((c) => c.text.includes('from app.places'))?.values).toEqual(['piata', 8]);
  });

  it.each([
    ['missing q', '/places'],
    ['q too short', '/places?q=a'],
    ['q too long', `/places?q=${'x'.repeat(81)}`],
    ['limit too high', '/places?q=sibiu&limit=9'],
    ['limit not a number', '/places?q=sibiu&limit=abc'],
  ])('rejects %s with VALIDATION_FAILED', async (_name, path) => {
    const { app } = makeApp();
    const res = await app.request(`${BASE}${path}`);
    expect(res.status).toBe(400);
    const body = errorEnvelopeSchema.parse(await res.json());
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(body.error.fields ?? {}).length).toBeGreaterThan(0);
  });

  it('is rate limited with Retry-After', async () => {
    const { app } = makeApp([
      (q) => (q.text.includes('app.rate_limit_hit') ? [{ allowed: false }] : undefined),
    ]);
    const res = await app.request(`${BASE}/places?q=sibiu`);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe('RATE_LIMITED');
  });

  it('keys the limiter by hashed IP for anonymous callers and by user id when signed in', async () => {
    const { app, calls } = makeApp();
    await app.request(`${BASE}/places?q=sibiu`, {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    });
    const anonKey = String(calls.find((c) => c.text.includes('rate_limit_hit'))?.values[0]);
    expect(anonKey).toMatch(/^places:ip:[0-9a-f]{32}$/);
    expect(anonKey).not.toContain('203.0.113.9');

    const token = await signToken(USER);
    const second = makeApp();
    await second.app.request(`${BASE}/places?q=sibiu`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.calls.find((c) => c.text.includes('rate_limit_hit'))?.values[0]).toBe(
      `places:u:${USER}`,
    );
  });

  it('fails open when the rate limiter itself is unavailable', async () => {
    const { app } = makeApp([
      (q) => {
        if (q.text.includes('app.rate_limit_hit')) throw new Error('db down');
        return undefined;
      },
    ]);
    expect((await app.request(`${BASE}/places?q=sibiu`)).status).toBe(200);
  });
});

describe('POST /places/reverse', () => {
  const point = { lat: 45.7972, lng: 24.1521 };

  it('returns the nearest street/POI', async () => {
    const row = {
      ...placeRow,
      name: 'Strada Mitropoliei',
      kind: 'street',
      locality: 'Sibiu',
      area_name: 'Centru',
    };
    const { app, calls } = makeApp([(q) => (q.text.includes('p.kind <> ') ? [row] : undefined)]);
    const res = await app.request(`${BASE}/places/reverse`, json({ point }));
    expect(res.status).toBe(200);
    expect(reverseResponseSchema.parse(await res.json()).place.name).toBe('Strada Mitropoliei');
    // location is sent as bound parameters, never in the URL
    expect(calls.some((c) => c.values.includes(point.lng))).toBe(true);
  });

  it('falls back to the containing area', async () => {
    const { app } = makeApp([
      (q) => (q.text.includes('from app.areas a') ? [{ ...placeRow, kind: 'area' }] : undefined),
    ]);
    const res = await app.request(`${BASE}/places/reverse`, json({ point }));
    expect(res.status).toBe(200);
    expect(reverseResponseSchema.parse(await res.json()).place.kind).toBe('area');
  });

  it('returns 404 when nothing is found', async () => {
    const { app } = makeApp();
    const res = await app.request(`${BASE}/places/reverse`, json({ point }));
    expect(res.status).toBe(404);
    expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('returns 404 outside the coverage bbox without touching the database', async () => {
    const { app, calls } = makeApp();
    const res = await app.request(
      `${BASE}/places/reverse`,
      json({ point: { lat: 44.43, lng: 26.1 } }),
    );
    expect(res.status).toBe(404);
    expect(calls.filter((c) => c.text.includes('app.places'))).toHaveLength(0);
  });

  it.each([
    ['no point', {}],
    ['bad latitude', { point: { lat: 120, lng: 24 } }],
    ['string coords', { point: { lat: '45.8', lng: '24.1' } }],
  ])('rejects %s', async (_n, body) => {
    const { app } = makeApp();
    const res = await app.request(`${BASE}/places/reverse`, json(body));
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON as a validation error, not a 500', async () => {
    const { app } = makeApp();
    const res = await app.request(`${BASE}/places/reverse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    });
    expect(res.status).toBe(400);
    expect(errorEnvelopeSchema.parse(await res.json()).error.fields).toEqual({ _: 'invalid_json' });
  });
});

describe('POST /telemetry/error', () => {
  it('stores a scrubbed, truncated record and answers 204', async () => {
    const { app, calls } = makeApp();
    const res = await app.request(
      `${BASE}/telemetry/error`,
      json({
        message: 'Failed for ana@example.com at 45.79712, 24.15211 phone +40 721 234 567',
        stack: 'Bearer abc.def.ghi at x',
        route: '/ride/:id',
        appVersion: 'abc123',
      }),
    );
    expect(res.status).toBe(204);
    const insert = calls.find((c) => c.text.includes('insert into app.app_errors'));
    expect(insert?.values[0]).toBe('client');
    const message = String(insert?.values[1]);
    expect(message).not.toMatch(/ana@example\.com|45\.79712|721 234/);
    expect(message).toContain('[email]');
    expect(message).toContain('[coords]');
    expect(message).toContain('[phone]');
    expect(String(insert?.values[2])).toContain('Bearer [token]');
  });

  it('records an anonymised user hash for signed-in callers', async () => {
    const { app, calls } = makeApp();
    const token = await signToken(USER);
    await app.request(
      `${BASE}/telemetry/error`,
      json({ message: 'x' }, { authorization: `Bearer ${token}` }),
    );
    const hash = String(
      calls.find((c) => c.text.includes('insert into app.app_errors'))?.values[5],
    );
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).not.toContain(USER.slice(0, 8));
  });

  it('rejects an empty message and enforces the rate limit', async () => {
    const { app } = makeApp();
    expect((await app.request(`${BASE}/telemetry/error`, json({ message: '' }))).status).toBe(400);
    const limited = makeApp([
      (q) => (q.text.includes('rate_limit_hit') ? [{ allowed: false }] : undefined),
    ]);
    expect(
      (await limited.app.request(`${BASE}/telemetry/error`, json({ message: 'x' }))).status,
    ).toBe(429);
  });
});

describe('POST /internal/tick', () => {
  it('requires the cron secret (anything else looks like an unknown route)', async () => {
    const { app } = makeApp();
    expect((await app.request(`${BASE}/internal/tick`, { method: 'POST' })).status).toBe(404);
    const bad = await app.request(`${BASE}/internal/tick`, {
      method: 'POST',
      headers: { 'x-cron-secret': 'nope' },
    });
    expect(bad.status).toBe(404);
  });

  it('runs the tick with the right secret (nothing to do: all zeros)', async () => {
    const { app } = makeApp();
    const res = await app.request(`${BASE}/internal/tick`, {
      method: 'POST',
      headers: { 'x-cron-secret': TEST_CRON_SECRET },
    });
    expect(res.status).toBe(200);
    expect(tickResponseSchema.parse(await res.json())).toEqual({
      expired: 0,
      sent: 0,
      failed: 0,
      purged: 0,
    });
  });
});

describe('CORS', () => {
  it('echoes an allowed origin and exposes Retry-After', async () => {
    const { app } = makeApp();
    const res = await app.request(`${BASE}/health`, { headers: { origin: 'https://haide.ro' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://haide.ro');
    expect(res.headers.get('access-control-expose-headers')).toContain('retry-after');
  });

  it('gives other origins no CORS headers', async () => {
    const { app } = makeApp();
    const res = await app.request(`${BASE}/health`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers preflights with the allowed methods and headers', async () => {
    const { app } = makeApp();
    const res = await app.request(`${BASE}/places/reverse`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('never adds CORS headers on /internal', async () => {
    const { app } = makeApp();
    const res = await app.request(`${BASE}/internal/tick`, {
      method: 'POST',
      headers: { origin: 'https://haide.ro', 'x-cron-secret': TEST_CRON_SECRET },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('auth', () => {
  const anonKey = (calls: { text: string; values: unknown[] }[]) =>
    String(calls.find((c) => c.text.includes('rate_limit_hit'))?.values[0]);

  it('treats an invalid token as anonymous on public routes', async () => {
    const { app } = makeApp();
    const res = await app.request(`${BASE}/places?q=sibiu`, {
      headers: { authorization: 'Bearer garbage' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects wrong audience, wrong signature and non-UUID subjects', async () => {
    for (const token of [
      await signToken(USER, { aud: 'anon' }),
      await signToken(USER, { secret: 'a-different-secret-with-32-characters!!' }),
      await signToken('not-a-uuid'),
    ]) {
      const { app, calls } = makeApp();
      await app.request(`${BASE}/places?q=sibiu`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(anonKey(calls)).toContain('places:ip:');
    }
  });

  it('never accepts HS256 tokens in production, even with a secret configured', async () => {
    const { app, calls } = makeApp([], {
      APP_ENV: 'production',
      SUPABASE_URL: 'https://example.supabase.co',
    });
    const token = await signToken(USER);
    await app.request(`${BASE}/places?q=sibiu`, { headers: { authorization: `Bearer ${token}` } });
    expect(anonKey(calls)).toContain('places:ip:');
  });

  it('requireAuth answers 401 UNAUTHENTICATED for anonymous callers and passes valid tokens', async () => {
    const { deps } = makeApp();
    const probe = new Hono<AppBindings>().basePath('/api/v1');
    probe.use('*', async (c, next) => {
      c.set('deps', deps);
      c.set('reqId', 'req-1');
      await next();
    });
    probe.use('*', authMiddleware);
    probe.get('/_probe', requireAuth, (c) => c.json({ userId: c.get('auth')?.userId }));
    probe.onError(onError);

    const anon = await probe.request(`${BASE}/_probe`);
    expect(anon.status).toBe(401);
    expect(errorEnvelopeSchema.parse(await anon.json()).error.code).toBe('UNAUTHENTICATED');

    const ok = await probe.request(`${BASE}/_probe`, {
      headers: { authorization: `Bearer ${await signToken(USER)}` },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ userId: USER });
  });
});
