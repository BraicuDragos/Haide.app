import type { Context, MiddlewareHandler } from 'hono';
import { AppError } from '../../_shared/errors.ts';
import { hashIp } from '../../_shared/hash.ts';
import { bucharestDayKey } from '../../_shared/domain/time.ts';
import { rateLimitHit } from '../repo/system.ts';
import type { AppBindings } from '../types.ts';

function clientIp(c: Context<AppBindings>): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown'
  );
}

/**
 * Postgres-backed fixed-window limiter. Key = limit name + user id, or a daily-salted IP hash
 * (the raw IP is never stored). Fails open if the database is unreachable.
 */
export function rateLimit(
  name: string,
  limit: { max: number; windowS: number },
): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const deps = c.get('deps');
    const auth = c.get('auth');
    const who = auth
      ? `u:${auth.userId}`
      : `ip:${await hashIp(clientIp(c), deps.env.IP_HASH_SALT_SEED, bucharestDayKey(deps.clock.now()))}`;
    let allowed = true;
    try {
      allowed = await rateLimitHit(deps.sql, `${name}:${who}`, limit.windowS, limit.max);
    } catch {
      deps.log('warn', 'rate_limit_unavailable', { reqId: c.get('reqId'), limit: name });
    }
    if (!allowed) {
      throw new AppError('RATE_LIMITED', 'Too many requests. Try again shortly.', {
        headers: { 'retry-after': String(limit.windowS) },
      });
    }
    await next();
  };
}
