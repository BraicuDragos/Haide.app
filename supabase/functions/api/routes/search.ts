import { Hono } from 'hono';
import { matchBodySchema, searchBodySchema } from '../../_shared/contracts/search.ts';
import { RATE_LIMITS } from '../../_shared/domain/rules.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { matchRide, searchRides } from '../services/search.ts';
import type { AppBindings } from '../types.ts';
import { parse, readJson } from '../validate.ts';

/**
 * Search and matching (E3). Both endpoints are public: they work signed out, and a valid token
 * (when sent) hides own rides and blocked pairs. Locations are in the POST body, never in URLs.
 */
export const searchRoutes = new Hono<AppBindings>();

// POST /search: rate limit 30/min per user, or per salted IP hash when signed out
searchRoutes.post('/search', rateLimit('search', RATE_LIMITS.search), async (c) => {
  const body = parse(searchBodySchema, await readJson(c));
  const viewerId = c.get('auth')?.userId ?? null;
  return c.json(await searchRides(c.get('deps'), viewerId, body));
});

// POST /rides/{id}/match: the passenger's view of one ride (disabled-button reasons, price)
searchRoutes.post('/rides/:id/match', rateLimit('match', RATE_LIMITS.publicRead), async (c) => {
  const body = parse(matchBodySchema, await readJson(c));
  const viewerId = c.get('auth')?.userId ?? null;
  return c.json(await matchRide(c.get('deps'), viewerId, c.req.param('id'), body));
});
