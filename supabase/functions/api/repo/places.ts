import type { Db } from '../../_shared/db.ts';
import type { LatLng, Place } from '../../_shared/contracts/geo.ts';
import { groupStreetCandidates, type StreetCandidate } from '../../_shared/domain/address.ts';
import { roundCoord } from '../../_shared/domain/privacy.ts';
import { COVERAGE_ENVELOPE } from '../../_shared/domain/rules.ts';

/** Coverage box bound as parameters (west, south, east, north): see COVERAGE_ENVELOPE. */
const [COV_W, COV_S, COV_E, COV_N] = COVERAGE_ENVELOPE;

export type PlaceRow = {
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
    ), cov as (
      select ST_MakeEnvelope(${COV_W}::float8, ${COV_S}::float8, ${COV_E}::float8, ${COV_N}::float8, 4326) as g
    )
    select p.id::text as id, p.name, p.kind, p.locality, a.name as area_name,
           ST_Y(p.geom) as lat, ST_X(p.geom) as lng
    from app.places p
    left join app.areas a on a.id = p.area_id
    cross join qe
    cross join cov
    where p.geom && cov.g
      and (p.search_text like qe.esc || '%'
        or p.search_text like '% ' || qe.esc || '%'
        or (qe.fuzzy and (p.search_text % qe.t or qe.t <% p.search_text)))
    order by (p.search_text like qe.esc || '%') desc,
             word_similarity(qe.t, p.search_text) desc,
             p.rank asc,
             p.geom <-> ST_SetSRID(ST_MakePoint(24.1503, 45.7983), 4326) asc,
             p.name asc
    limit ${limit}`;
  return rows.map(toPlace);
}

/** Upper bound of gazetteer rows read for one street key (streets first, then addresses). */
export const STREET_ROWS_LIMIT = 1200;

type StreetRow = { name: string; kind: string; locality: string | null; lat: number; lng: number };

/**
 * Candidate streets for a typed street key (ADR 0042): per locality (at most 2) the street row, if
 * the data has one, and the known address points of that street. Matching is on the unaccented name
 * at word boundaries, served by the trigram index on `search_text`; LIKE wildcards are escaped. At
 * most STREET_ROWS_LIMIT rows are read (street rows first), so the cost is bounded for any key.
 */
export async function findStreetCandidates(sql: Db, streetKey: string): Promise<StreetCandidate[]> {
  const rows = await sql<StreetRow[]>`
    with street_key as (
      select replace(replace(replace(app.immutable_unaccent(lower(${streetKey}::text)), '\\', '\\\\'), '%', '\\%'), '_', '\\_') as esc
    )
    select p.name, p.kind, p.locality, ST_Y(p.geom) as lat, ST_X(p.geom) as lng
    from app.places p
    cross join street_key k
    where p.kind in ('street', 'address')
      and (p.search_text like k.esc || '%' or p.search_text like '% ' || k.esc || '%')
      and app.immutable_unaccent(lower(p.name)) like '%' || k.esc || '%'
    order by (p.kind = 'street') desc, p.locality asc, p.name asc
    limit ${STREET_ROWS_LIMIT}`;
  return groupStreetCandidates(rows, streetKey, 2);
}

/** Name of the area that contains (or is nearest to) the point, null when there are no areas. */
export async function areaNameForPoint(sql: Db, point: LatLng): Promise<string | null> {
  const rows = await sql<{ name: string }[]>`
    select a.name
    from app.areas a
    where a.id = app.area_for(ST_SetSRID(ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326))
    limit 1`;
  return rows[0]?.name ?? null;
}

/** Nearest street, POI or address within 500 m, else the containing/nearest area. */
export async function reversePlace(sql: Db, point: LatLng): Promise<Place | null> {
  const nearby = await sql<PlaceRow[]>`
    with pt as (select ST_SetSRID(ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326) as g),
    cov as (
      select ST_MakeEnvelope(${COV_W}::float8, ${COV_S}::float8, ${COV_E}::float8, ${COV_N}::float8, 4326) as g
    )
    select p.id::text as id, p.name, p.kind, p.locality, a.name as area_name,
           ST_Y(p.geom) as lat, ST_X(p.geom) as lng
    from app.places p
    left join app.areas a on a.id = p.area_id
    cross join pt
    cross join cov
    where p.kind <> 'area'
      and p.geom && cov.g
      and ST_DWithin(p.geom::geography, pt.g::geography, 500)
    order by p.geom <-> pt.g asc
    limit 1`;
  const hit = nearby[0];
  if (hit) return toPlace(hit);

  const areas = await sql<PlaceRow[]>`
    with pt as (select ST_SetSRID(ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326) as g),
    cov as (
      select ST_MakeEnvelope(${COV_W}::float8, ${COV_S}::float8, ${COV_E}::float8, ${COV_N}::float8, 4326) as g
    )
    select a.id::text as id, a.name, 'area'::text as kind, a.locality, a.name as area_name,
           ST_Y(a.centroid) as lat, ST_X(a.centroid) as lng
    from app.areas a
    cross join pt
    cross join cov
    where a.id = app.area_for(pt.g)
      and a.centroid && cov.g
    limit 1`;
  const area = areas[0];
  return area ? toPlace(area) : null;
}
