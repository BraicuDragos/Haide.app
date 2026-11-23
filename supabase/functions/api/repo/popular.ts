import type { Place } from '../../_shared/contracts/geo.ts';
import type { Db } from '../../_shared/db.ts';
import { toPlace } from './places.ts';

export type PopularRow = {
  origin_area: string;
  destination_area: string;
  ride_count: number;
  booking_count: number;
  score: number;
};

/** The ranking: app.popular_routes (window, min 2 drivers, score and order live in SQL). */
export async function selectPopularRoutes(
  sql: Db,
  now: Date,
  limit: number,
): Promise<PopularRow[]> {
  return await sql<PopularRow[]>`
    select origin_area, destination_area, ride_count, booking_count, score
    from app.popular_routes(${now}::timestamptz, ${limit}::int)`;
}

type AreaPlaceRow = {
  area_id: string;
  id: string;
  name: string;
  kind: Place['kind'];
  locality: string | null;
  area_name: string | null;
  lat: number;
  lng: number;
};

/**
 * One Place per area id: the gazetteer place of kind 'area' (rank 1) for that area, else the area
 * centroid with the area id as a stable Place id (the same fallback reversePlace uses).
 */
export async function areaPlaces(sql: Db, areaIds: string[]): Promise<Map<string, Place>> {
  const out = new Map<string, Place>();
  if (areaIds.length === 0) return out;
  const rows = await sql<AreaPlaceRow[]>`
    select a.id::text as area_id,
           coalesce(p.id::text, a.id::text) as id,
           coalesce(p.name, a.name) as name,
           'area'::text as kind,
           coalesce(p.locality, a.locality) as locality,
           a.name as area_name,
           ST_Y(coalesce(p.geom, a.centroid)) as lat,
           ST_X(coalesce(p.geom, a.centroid)) as lng
    from app.areas a
    left join lateral (
      select pl.id, pl.name, pl.locality, pl.geom
      from app.places pl
      where pl.area_id = a.id and pl.kind = 'area' and pl.rank = 1
      order by pl.osm_id asc nulls last, pl.id asc
      limit 1
    ) p on true
    where a.id = any(${areaIds}::uuid[])`;
  for (const r of rows) out.set(r.area_id, toPlace(r));
  return out;
}

/**
 * Gazetteer place by exact (diacritics and case insensitive) name, best kind first (area, poi,
 * street, address). Null when nothing matches. Used to resolve the curated corridors.
 */
export async function placeByName(sql: Db, name: string): Promise<Place | null> {
  const rows = await sql<AreaPlaceRow[]>`
    select p.id::text as area_id, p.id::text as id, p.name, p.kind, p.locality, a.name as area_name,
           ST_Y(p.geom) as lat, ST_X(p.geom) as lng
    from app.places p
    left join app.areas a on a.id = p.area_id
    where app.immutable_unaccent(lower(p.name)) = app.immutable_unaccent(lower(${name}::text))
    order by p.rank asc, p.osm_id asc nulls last, p.id asc
    limit 1`;
  const hit = rows[0];
  return hit ? toPlace(hit) : null;
}
