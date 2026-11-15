import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../types.ts';

/**
 * CORS allow-list from CORS_ORIGINS. `/internal/*` is never exposed to browsers:
 * it gets no CORS headers at all (and preflights are refused).
 */
export const corsMiddleware: MiddlewareHandler<AppBindings> = (c, next) => {
  if (c.req.path.includes('/internal/')) return next();
  const allowed = c.get('deps').env.CORS_ORIGINS;
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-client-info', 'apikey'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['retry-after', 'x-request-id'],
    maxAge: 600,
  })(c, next);
};
