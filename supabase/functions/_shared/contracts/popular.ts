import { z } from 'zod';
import { placeSchema } from './geo.ts';

/**
 * Popular routes: GET /popular-routes (public, rate limited, `Cache-Control: public, max-age=300`).
 * Shared with the web app (import through @contracts). STABLE: additive changes only.
 *
 * "Popular" (server-side only, app.popular_routes): rides departing from 30 days ago to 14 days ahead,
 * status published or completed, grouped by (origin area, destination area), both known and different.
 * score = rides + bookings in confirmed or completed. A route is shown only when at least 2 DISTINCT
 * drivers published it. Order: score, rides, names. Top 5 by default (max 10).
 *
 * `from` and `to` are ordinary gazetteer Places (area level), so the web can use them as they are:
 * POST /search takes `from: place.point`, `to: place.point`. No personal data is in the response.
 *
 * `source`:
 * - `data`: a real route that met the rule above; `rides` is the number of rides in the window.
 * - `curated`: a pilot corridor added only while fewer than 3 real routes qualify (never a duplicate
 *   of a real one); `rides` is 0 and MUST NOT be shown as a popularity count.
 */
export const POPULAR_LIMITS = { defaultLimit: 5, maxLimit: 10, minRealBeforeFallback: 3 } as const;

export const popularRoutesQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(POPULAR_LIMITS.maxLimit)
    .default(POPULAR_LIMITS.defaultLimit),
});
export type PopularRoutesQuery = z.input<typeof popularRoutesQuerySchema>;

export const popularRouteSourceSchema = z.enum(['data', 'curated']);
export type PopularRouteSource = z.infer<typeof popularRouteSourceSchema>;

export const popularRouteSchema = z.object({
  from: placeSchema,
  to: placeSchema,
  rides: z.number().int().min(0),
  source: popularRouteSourceSchema,
});
export type PopularRoute = z.infer<typeof popularRouteSchema>;

export const popularRoutesResponseSchema = z.object({ items: z.array(popularRouteSchema) });
export type PopularRoutesResponse = z.infer<typeof popularRoutesResponseSchema>;
