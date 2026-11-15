import type { MiddlewareHandler } from 'hono';
import { newRequestId, sha256Hex } from '../../_shared/hash.ts';
import type { AppBindings } from '../types.ts';

/** Request id + one JSON log line per request. Logs the route template, never the raw URL. */
export const requestLogging: MiddlewareHandler<AppBindings> = async (c, next) => {
  const deps = c.get('deps');
  const started = deps.clock.now().getTime();
  const reqId = newRequestId(deps.clock.now());
  c.set('reqId', reqId);
  c.set('auth', null);
  await next();
  c.header('x-request-id', reqId);
  const auth = c.get('auth');
  deps.log('info', 'request', {
    reqId,
    method: c.req.method,
    route: c.req.routePath,
    status: c.res.status,
    ms: deps.clock.now().getTime() - started,
    user: auth ? (await sha256Hex(auth.userId)).slice(0, 12) : null,
  });
};
