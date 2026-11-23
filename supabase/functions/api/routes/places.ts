import { Hono } from 'hono';
import { placesQuerySchema, reverseBodySchema, type Place } from '../../_shared/contracts/geo.ts';
import { inCoverage } from '../../_shared/domain/privacy.ts';
import { RATE_LIMITS } from '../../_shared/domain/rules.ts';
import { AppError } from '../../_shared/errors.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { reversePlace } from '../repo/places.ts';
import { searchPlacesWithAddresses } from '../services/places.ts';
import type { AppBindings } from '../types.ts';
import { parse, readJson } from '../validate.ts';

export const placesRoutes = new Hono<AppBindings>();

// GET /places?q=selimbar&limit=8: public, 60/min
placesRoutes.get('/places', rateLimit('places', RATE_LIMITS.places), async (c) => {
  const query = parse(placesQuerySchema, c.req.query());
  const items: Place[] = await searchPlacesWithAddresses(c.get('deps').sql, query.q, query.limit);
  return c.json({ items });
});

// POST /places/reverse: public, 60/min. Location stays in the body, never in the URL.
placesRoutes.post('/places/reverse', rateLimit('places', RATE_LIMITS.places), async (c) => {
  const { point } = parse(reverseBodySchema, await readJson(c));
  if (!inCoverage(point)) throw new AppError('NOT_FOUND', 'Outside the coverage area.');
  const place = await reversePlace(c.get('deps').sql, point);
  if (!place) throw new AppError('NOT_FOUND', 'No place found nearby.');
  return c.json({ place });
});
