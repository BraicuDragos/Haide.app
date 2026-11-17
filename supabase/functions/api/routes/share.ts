import { Hono } from 'hono';
import { RATE_LIMITS } from '../../_shared/domain/rules.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { getSharedTrip } from '../services/shareLinks.ts';
import type { AppBindings } from '../types.ts';

/**
 * GET /share/{token}: the public page behind a share-trip link (E5-6, ADR 0026). No account needed.
 * Rate limited per IP. The response is never cached, never sent a referrer and not indexed. The log
 * line carries the route template `/share/:token`, never the token.
 */
export const shareRoutes = new Hono<AppBindings>();

shareRoutes.get('/share/:token', rateLimit('share-view', RATE_LIMITS.shareView), async (c) => {
  const trip = await getSharedTrip(c.get('deps'), c.req.param('token'));
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  return c.json(trip);
});
