import type { Place } from '../../_shared/contracts/geo.ts';
import type { PopularRoutesResponse } from '../../_shared/contracts/popular.ts';
import {
  CURATED_PILOT_ROUTES,
  MIN_REAL_ROUTES,
  mergePopularRoutes,
  withLabel,
} from '../../_shared/domain/popularRoutes.ts';
import { areaPlaces, placeByName, selectPopularRoutes } from '../repo/popular.ts';
import type { Deps } from '../types.ts';

/**
 * GET /popular-routes. Real routes come from app.popular_routes (min 2 distinct drivers, 30 days back
 * to 14 days ahead). Only when fewer than MIN_REAL_ROUTES qualify are the curated pilot corridors
 * resolved (by name, server-side) and added, marked `source: 'curated'`.
 */
export async function getPopularRoutes(deps: Deps, limit: number): Promise<PopularRoutesResponse> {
  const { sql, clock } = deps;
  const rows = await selectPopularRoutes(sql, clock.now(), limit);
  const places = await areaPlaces(
    sql,
    rows.flatMap((r) => [r.origin_area, r.destination_area]),
  );
  const real = rows.flatMap((r) => {
    const from = places.get(r.origin_area);
    const to = places.get(r.destination_area);
    return from && to ? [{ from, to, rides: Number(r.ride_count) }] : [];
  });

  let curated: { from: Place | null; to: Place | null }[] = [];
  if (real.length < MIN_REAL_ROUTES) {
    curated = await Promise.all(
      CURATED_PILOT_ROUTES.map(async (c) => {
        const [from, to] = await Promise.all([
          placeByName(sql, c.from.name, c.from.locality ?? null),
          placeByName(sql, c.to.name, c.to.locality ?? null),
        ]);
        return {
          from: from && withLabel(from, c.from.label),
          to: to && withLabel(to, c.to.label),
        };
      }),
    );
  }
  return { items: mergePopularRoutes(real, curated, limit) };
}
