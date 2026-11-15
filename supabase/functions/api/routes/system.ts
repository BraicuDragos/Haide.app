import { Hono } from 'hono';
import type { HealthResponse, TickResponse } from '../../_shared/contracts/system.ts';
import { telemetryErrorBodySchema } from '../../_shared/contracts/system.ts';
import { AppError } from '../../_shared/errors.ts';
import { safeEqual, sha256Hex } from '../../_shared/hash.ts';
import { RATE_LIMITS } from '../../_shared/domain/rules.ts';
import { scrubText } from '../../_shared/scrub.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { pingDb, recordAppError } from '../repo/system.ts';
import type { AppBindings } from '../types.ts';
import { parse, readJson } from '../validate.ts';

export const systemRoutes = new Hono<AppBindings>();

// GET /health: public. 503 when the database is unreachable so uptime checks fail loudly.
systemRoutes.get('/health', async (c) => {
  const { sql, env, log } = c.get('deps');
  let db: HealthResponse['db'] = 'down';
  try {
    db = (await pingDb(sql)) ? 'ok' : 'down';
  } catch {
    log('warn', 'health_db_down', { reqId: c.get('reqId') });
  }
  const body: HealthResponse = {
    status: db === 'ok' ? 'ok' : 'degraded',
    db,
    version: env.APP_VERSION,
  };
  return c.json(body, db === 'ok' ? 200 : 503);
});

// POST /telemetry/error: public, 20/min. Truncated and scrubbed of emails, phones, coordinates.
systemRoutes.post('/telemetry/error', rateLimit('telemetry', RATE_LIMITS.telemetry), async (c) => {
  const deps = c.get('deps');
  const body = parse(telemetryErrorBodySchema, await readJson(c));
  const auth = c.get('auth');
  await recordAppError(deps.sql, {
    source: 'client',
    message: scrubText(body.message, 500),
    stack: body.stack ? scrubText(body.stack, 4000) : null,
    route: body.route ? scrubText(body.route, 200) : null,
    appVersion: body.appVersion ? scrubText(body.appVersion, 64) : null,
    userIdHash: auth ? (await sha256Hex(auth.userId)).slice(0, 16) : null,
  });
  return c.body(null, 204);
});

// POST /internal/tick: called by pg_cron through pg_net every minute. Skeleton for E0.
systemRoutes.post('/internal/tick', (c) => {
  const secret = c.req.header('x-cron-secret') ?? '';
  if (!safeEqual(secret, c.get('deps').env.CRON_SECRET)) {
    // Same answer as an unknown route: do not reveal that the endpoint exists.
    throw new AppError('NOT_FOUND', 'Not found.');
  }
  // E4 adds: expire requests, dispatch outbox (<= 50 per run), purge expired route previews.
  const result: TickResponse = { expired: 0, sent: 0, failed: 0 };
  return c.json(result);
});
