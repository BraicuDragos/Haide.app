import type { Db } from '../../_shared/db.ts';
import type { LatLng, Place } from '../../_shared/contracts/geo.ts';
import { roundCoord } from '../../_shared/domain/privacy.ts';

type PlaceRow = {
  id: string;
  name: string;
  kind: Place['kind'];
  locality: string | null;
  area_name: string | null;
  lat: number;
  lng: number;
};

export function toPlace(r: PlaceRow): Place {
  const areaName = r.area_name ?? r.locality ?? '';
  const secondary = [r.locality, r.area_name]
    .filter((v): v is string => !!v && v !== r.name)
    .filter((v, i, all) => all.indexOf(v) === i)
    .join(', ');
  return {
    id: r.id,
    name: r.name,
    secondary,
    kind: r.kind,
    point: { lat: roundCoord(r.lat), lng: roundCoord(r.lng) },
    areaName,
  };
}

/**
 * Diacritics-insensitive autocomplete (data-model §4.6). Prefix and word-prefix matches rank first,
 * then trigram word similarity, then kind rank (area > poi > street > address), then distance to
 * the centre of Sibiu. LIKE wildcards in the user input are escaped.
 */
export async function searchPlaces(sql: Db, q: string, limit: number): Promise<Place[]> {
  const rows = await sql<PlaceRow[]>`
    with q as (
      select app.immutable_unaccent(lower(${q}::text)) as t
    ), qe as (
      select t, replace(replace(replace(t, '\\', '\\\\'), '%', '\\%'), '_', '\\_') as esc,
             char_length(regexp_replace(t, '[^a-z0-9]', '', 'g')) >= 3 as fuzzy
      from q
    )
    select p.id::text as id, p.name, p.kind, p.locality, a.name as area_name,
           ST_Y(p.geom) as lat, ST_X(p.geom) as lng
    from app.places p
    left join app.areas a on a.id = p.area_id
    cross join qe
    where p.search_text like qe.esc || '%'
       or p.search_text like '% ' || qe.esc || '%'
       or (qe.fuzzy and (p.search_text % qe.t or qe.t <% p.search_text))
    order by (p.search_text like qe.esc || '%') desc,
             word_similarity(qe.t, p.search_text) desc,
             p.rank asc,
             p.geom <-> ST_SetSRID(ST_MakePoint(24.1503, 45.7983), 4326) asc,
             p.name asc
    limit ${limit}`;
  return rows.map(toPlace);
}

/** Nearest street, POI or address within 500 m, else the containing/nearest area. */
export async function reversePlace(sql: Db, point: LatLng): Promise<Place | null> {
  const nearby = await sql<PlaceRow[]>`
    with pt as (select ST_SetSRID(ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326) as g)
    select p.id::text as id, p.name, p.kind, p.locality, a.name as area_name,
           ST_Y(p.geom) as lat, ST_X(p.geom) as lng
    from app.places p
    left join app.areas a on a.id = p.area_id
    cross join pt
    where p.kind <> 'area'
      and ST_DWithin(p.geom::geography, pt.g::geography, 500)
    order by p.geom <-> pt.g asc
    limit 1`;
  const hit = nearby[0];
  if (hit) return toPlace(hit);

  const areas = await sql<PlaceRow[]>`
    with pt as (select ST_SetSRID(ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326) as g)
    select a.id::text as id, a.name, 'area'::text as kind, a.locality, a.name as area_name,
           ST_Y(a.centroid) as lat, ST_X(a.centroid) as lng
    from app.areas a
    cross join pt
    where a.id = app.area_for(pt.g)
    limit 1`;
  const area = areas[0];
  return area ? toPlace(area) : null;
}
