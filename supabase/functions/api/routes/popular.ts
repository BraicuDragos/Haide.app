import { Hono } from 'hono';
import { popularRoutesQuerySchema } from '../../_shared/contracts/popular.ts';
import { RATE_LIMITS } from '../../_shared/domain/rules.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { getPopularRoutes } from '../services/popular.ts';
import type { AppBindings } from '../types.ts';
import { parse } from '../validate.ts';

export const popularRoutes = new Hono<AppBindings>();

// GET /popular-routes?limit=5: public, no personal data, cacheable for 5 minutes.
popularRoutes.get(
  '/popular-routes',
  rateLimit('public-read', RATE_LIMITS.publicRead),
  async (c) => {
    const query = parse(popularRoutesQuerySchema, c.req.query());
    const body = await getPopularRoutes(c.get('deps'), query.limit);
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(body);
  },
);
