/**
 * Build the Sibiu gazetteer from OpenStreetMap (Overpass API). Output: areas.csv and places.csv in
 * supabase/seed/gazetteer/, plus (with --emit-migration) a loader migration for `supabase db push`.
 *
 * Data licence: OpenStreetMap contributors, ODbL 1.0. Keep the attribution in the app's About screen.
 *
 *   pnpm gazetteer                          # CSVs only
 *   pnpm gazetteer -- --emit-migration      # CSVs + supabase/migrations/<ts>_gazetteer_data.sql
 *   pnpm gazetteer -- --no-addresses        # skip house numbers (much smaller output)
 *   pnpm gazetteer -- --cache-dir ./.cache  # keep raw Overpass answers, rebuild offline
 *
 * Method (data-model 4.6, ADR 0014):
 *   areas  = Voronoi cells of OSM place nodes (suburb / quarter / neighbourhood), clipped to the
 *            administrative boundary (admin_level 8) of the locality they sit in. A locality with no
 *            such node becomes a single area.
 *   places = areas (kind area) + named streets (one per name and locality) + named POIs
 *            + addresses (street + house number).
 *
 * Refresh quarterly (deploy.md 6). The generated loader migration upserts areas by osm_id and
 * replaces the OSM-derived places, so it is safe to apply on top of an earlier one. Sample rows from
 * supabase/seed.sql have negative osm_id and are never touched.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Delaunay } from 'd3-delaunay';
import polygonClipping from 'polygon-clipping';
import { COVERAGE_BBOX } from '../../supabase/functions/_shared/domain/rules.ts';

// --- Types ----------------------------------------------------------------------------------

export type Pos = [number, number]; // [lng, lat]
export type Ring = Pos[];
export type Polygon = Ring[]; // outer ring first
export type MultiPolygon = Polygon[];

export type OsmElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
};

export type Locality = {
  osmId: number;
  name: string;
  polygon: MultiPolygon;
  centroid: Pos;
};

export type PlaceNode = {
  osmId: number;
  name: string;
  kind: AreaPlaceKind;
  lng: number;
  lat: number;
};
export type AreaPlaceKind = 'suburb' | 'quarter' | 'neighbourhood';

export type AreaRow = {
  osmId: number;
  name: string;
  locality: string;
  kind: AreaPlaceKind | 'locality';
  geom: MultiPolygon;
  centroid: Pos;
};

export type PlaceKind = 'street' | 'poi' | 'address' | 'area';
export type PlaceRow = {
  osmId: number;
  name: string;
  kind: PlaceKind;
  locality: string;
  rank: 1 | 2 | 3 | 4;
  lng: number;
  lat: number;
};

export const RANK: Record<PlaceKind, PlaceRow['rank']> = { area: 1, poi: 2, street: 3, address: 4 };
/** Relation ids are offset so they can never collide with node ids in areas.osm_id. */
export const RELATION_OFFSET = 1_000_000_000_000;
const DEFAULT_LOCALITY = 'Sibiu';

// --- Geometry helpers -----------------------------------------------------------------------

/** Join way fragments (arrays of positions) into closed rings by matching end points. */
export function stitchRings(fragments: Pos[][]): Ring[] {
  const key = (p: Pos) => `${p[0]},${p[1]}`;
  const pool = fragments.filter((f) => f.length >= 2).map((f) => f.slice());
  const rings: Ring[] = [];
  while (pool.length > 0) {
    let current = pool.shift() as Pos[];
    let progressed = true;
    while (key(current[0] as Pos) !== key(current[current.length - 1] as Pos) && progressed) {
      progressed = false;
      const tail = key(current[current.length - 1] as Pos);
      for (let i = 0; i < pool.length; i++) {
        const f = pool[i] as Pos[];
        if (key(f[0] as Pos) === tail) {
          current = current.concat(f.slice(1));
        } else if (key(f[f.length - 1] as Pos) === tail) {
          current = current.concat(f.slice(0, -1).reverse());
        } else {
          continue;
        }
        pool.splice(i, 1);
        progressed = true;
        break;
      }
    }
    if (current.length >= 4 && key(current[0] as Pos) === key(current[current.length - 1] as Pos)) {
      rings.push(current);
    }
  }
  return rings;
}

export function pointInRing(p: Pos, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as Pos;
    const [xj, yj] = ring[j] as Pos;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Inside an outer ring and outside its holes, for any polygon of the multipolygon. */
export function pointInMulti(p: Pos, mp: MultiPolygon): boolean {
  return mp.some((poly) => {
    const [outer, ...holes] = poly;
    return !!outer && pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h));
  });
}

export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as Pos;
    const [xj, yj] = ring[j] as Pos;
    a += xj * yi - xi * yj;
  }
  return a / 2;
}

/** Area-weighted centroid of the largest outer ring (good enough for a label anchor). */
export function centroidOf(mp: MultiPolygon): Pos {
  let best: Ring | undefined;
  let bestArea = 0;
  for (const poly of mp) {
    const outer = poly[0];
    if (!outer) continue;
    const a = Math.abs(ringArea(outer));
    if (a > bestArea) {
      bestArea = a;
      best = outer;
    }
  }
  if (!best || bestArea === 0) return [0, 0];
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const [xi, yi] = best[i] as Pos;
    const [xj, yj] = best[j] as Pos;
    const f = xj * yi - xi * yj;
    cx += (xj + xi) * f;
    cy += (yj + yi) * f;
    a2 += f;
  }
  return [cx / (3 * a2), cy / (3 * a2)];
}

function bboxOf(mp: MultiPolygon): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of mp)
    for (const ring of poly)
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
  return [minX, minY, maxX, maxY];
}

// --- OSM interpretation ---------------------------------------------------------------------

/** Administrative boundary relations (admin_level 8) with geometry -> localities. */
export function parseLocalities(elements: OsmElement[]): Locality[] {
  const out: Locality[] = [];
  for (const el of elements) {
    if (el.type !== 'relation' || !el.tags?.name) continue;
    const outer = (el.members ?? [])
      .filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry)
      .map((m) => (m.geometry ?? []).map((g): Pos => [g.lon, g.lat]));
    const rings = stitchRings(outer);
    if (rings.length === 0) continue;
    const polygon: MultiPolygon = rings.map((r) => [r]);
    out.push({
      osmId: RELATION_OFFSET + el.id,
      name: el.tags.name,
      polygon,
      centroid: centroidOf(polygon),
    });
  }
  return out.sort((a, b) => a.osmId - b.osmId);
}

const AREA_PLACE_KINDS = new Set<string>(['suburb', 'quarter', 'neighbourhood']);

export function parsePlaceNodes(elements: OsmElement[]): PlaceNode[] {
  const out: PlaceNode[] = [];
  for (const el of elements) {
    const place = el.tags?.place;
    if (el.type !== 'node' || !el.tags?.name || !place || !AREA_PLACE_KINDS.has(place)) continue;
    if (el.lat === undefined || el.lon === undefined) continue;
    out.push({
      osmId: el.id,
      name: el.tags.name,
      kind: place as AreaPlaceKind,
      lng: el.lon,
      lat: el.lat,
    });
  }
  return out.sort((a, b) => a.osmId - b.osmId);
}

/** Voronoi of the place nodes inside each locality, clipped to the locality polygon. */
export function buildAreas(localities: Locality[], nodes: PlaceNode[]): AreaRow[] {
  const areas: AreaRow[] = [];
  for (const loc of localities) {
    const inside = nodes.filter((n) => pointInMulti([n.lng, n.lat], loc.polygon));
    if (inside.length < 2) {
      const only = inside[0];
      areas.push({
        osmId: only ? only.osmId : loc.osmId,
        name: only ? only.name : loc.name,
        locality: loc.name,
        kind: only ? only.kind : 'locality',
        geom: loc.polygon,
        centroid: only ? [only.lng, only.lat] : loc.centroid,
      });
      continue;
    }
    const [minX, minY, maxX, maxY] = bboxOf(loc.polygon);
    const pad = 0.01;
    const voronoi = Delaunay.from(inside.map((n): [number, number] => [n.lng, n.lat])).voronoi([
      minX - pad,
      minY - pad,
      maxX + pad,
      maxY + pad,
    ]);
    inside.forEach((n, i) => {
      const cell = voronoi.cellPolygon(i);
      if (!cell) return;
      const clipped = polygonClipping.intersection(
        [cell as Ring],
        loc.polygon as never,
      ) as MultiPolygon;
      if (clipped.length === 0) return;
      areas.push({
        osmId: n.osmId,
        name: n.name,
        locality: loc.name,
        kind: n.kind,
        geom: clipped,
        centroid: [n.lng, n.lat],
      });
    });
  }
  return areas;
}

export function localityFor(p: Pos, localities: Locality[]): string {
  const hit = localities.find((l) => pointInMulti(p, l.polygon));
  if (hit) return hit.name;
  let best = DEFAULT_LOCALITY;
  let bestD = Infinity;
  for (const l of localities) {
    const d = (l.centroid[0] - p[0]) ** 2 + (l.centroid[1] - p[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = l.name;
    }
  }
  return best;
}

const STREET_HIGHWAYS = new Set([
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'pedestrian',
]);

function positionOf(el: OsmElement): Pos | null {
  if (el.lat !== undefined && el.lon !== undefined) return [el.lon, el.lat];
  if (el.center) return [el.center.lon, el.center.lat];
  return null;
}

export function inBbox(p: Pos): boolean {
  return (
    p[1] >= COVERAGE_BBOX.south &&
    p[1] <= COVERAGE_BBOX.north &&
    p[0] >= COVERAGE_BBOX.west &&
    p[0] <= COVERAGE_BBOX.east
  );
}

function poiKind(tags: Record<string, string>): boolean {
  return Boolean(
    tags.amenity ||
    tags.shop ||
    tags.tourism ||
    tags.leisure ||
    tags.railway === 'station' ||
    tags.public_transport === 'station',
  );
}

/**
 * Streets, POIs and addresses. Streets are deduplicated per (name, locality), addresses per
 * (street + number, locality): the first element by OSM id wins, so the output is deterministic.
 */
export function buildPlaces(
  elements: OsmElement[],
  localities: Locality[],
  options: { addresses: boolean },
): PlaceRow[] {
  const sorted = [...elements].sort((a, b) => a.id - b.id || a.type.localeCompare(b.type));
  const seen = new Set<string>();
  const out: PlaceRow[] = [];
  const push = (kind: PlaceKind, name: string, pos: Pos, osmId: number) => {
    if (!inBbox(pos)) return;
    const locality = localityFor(pos, localities);
    // Streets and addresses: one per name and locality. POIs: one per name within ~100 m (the same
    // building is often mapped as both a node and a way).
    const where = kind === 'poi' ? `|${pos[1].toFixed(3)},${pos[0].toFixed(3)}` : '';
    const k = `${kind}|${name.toLowerCase()}|${locality}${where}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ osmId, name, kind, locality, rank: RANK[kind], lng: pos[0], lat: pos[1] });
  };

  for (const el of sorted) {
    const tags = el.tags;
    const pos = positionOf(el);
    if (!tags || !pos) continue;
    if (tags.highway && tags.name && STREET_HIGHWAYS.has(tags.highway) && el.type === 'way') {
      push('street', tags.name, pos, el.id);
    } else if (tags.name && poiKind(tags)) {
      push('poi', tags.name, pos, el.id);
    } else if (options.addresses && tags['addr:street'] && tags['addr:housenumber']) {
      push('address', `${tags['addr:street']} ${tags['addr:housenumber']}`, pos, el.id);
    }
  }
  return out;
}

/** Areas are searchable places too (rank 1). */
export function areaPlaces(areas: AreaRow[]): PlaceRow[] {
  return areas.map((a) => ({
    osmId: a.osmId,
    name: a.name,
    kind: 'area',
    locality: a.locality,
    rank: 1,
    lng: a.centroid[0],
    lat: a.centroid[1],
  }));
}

/**
 * Every locality is searchable by its own name ("selimbar" must find Șelimbăr, not only its quarters).
 * Skipped when an area of the same name and locality already exists.
 */
export function localityPlaces(localities: Locality[], areas: AreaRow[]): PlaceRow[] {
  const taken = new Set(areas.map((a) => `${a.name.toLowerCase()}|${a.locality}`));
  return localities
    .filter((l) => !taken.has(`${l.name.toLowerCase()}|${l.name}`))
    .map((l) => ({
      osmId: l.osmId,
      name: l.name,
      kind: 'area',
      locality: l.name,
      rank: 1,
      lng: l.centroid[0],
      lat: l.centroid[1],
    }));
}

// --- Serialisation --------------------------------------------------------------------------

export function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(fields: (string | number)[]): string {
  return fields.map(csvField).join(',');
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function toWkt(mp: MultiPolygon): string {
  const rings = (poly: Polygon) =>
    `(${poly.map((r) => `(${r.map(([x, y]) => `${r6(x)} ${r6(y)}`).join(',')})`).join(',')})`;
  return `MULTIPOLYGON(${mp.map(rings).join(',')})`;
}

export function areasCsv(areas: AreaRow[]): string {
  const head = 'osm_id,name,locality,kind,centroid_lat,centroid_lng,geom_wkt';
  const rows = areas.map((a) =>
    csvLine([
      a.osmId,
      a.name,
      a.locality,
      a.kind,
      r6(a.centroid[1]),
      r6(a.centroid[0]),
      toWkt(a.geom),
    ]),
  );
  return `${[head, ...rows].join('\n')}\n`;
}

export function placesCsv(places: PlaceRow[]): string {
  const head = 'osm_id,name,kind,locality,rank,lat,lng';
  const rows = places.map((p) =>
    csvLine([p.osmId, p.name, p.kind, p.locality, p.rank, r6(p.lat), r6(p.lng)]),
  );
  return `${[head, ...rows].join('\n')}\n`;
}

export const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

const CHUNK = 500;

/** Idempotent loader: upsert areas by osm_id, replace OSM-derived places (osm_id > 0). */
export function loaderSql(areas: AreaRow[], places: PlaceRow[], generatedOn: string): string {
  const out: string[] = [
    '-- Generated by scripts/geo/build-gazetteer.ts. Do not edit by hand.',
    `-- Source: OpenStreetMap contributors (ODbL 1.0), Overpass snapshot ${generatedOn}.`,
    '-- Upserts areas by osm_id and replaces OSM-derived places. Sample rows (osm_id < 0) are untouched.',
    '',
  ];
  for (let i = 0; i < areas.length; i += CHUNK) {
    const values = areas
      .slice(i, i + CHUNK)
      .map(
        (a) =>
          `(${sqlString(a.name)}, ${sqlString(a.locality)}, ${sqlString(a.kind)}, ` +
          `ST_Multi(ST_GeomFromText(${sqlString(toWkt(a.geom))}, 4326)), ` +
          `ST_SetSRID(ST_MakePoint(${r6(a.centroid[0])}, ${r6(a.centroid[1])}), 4326), ${a.osmId})`,
      )
      .join(',\n  ');
    out.push(
      'insert into app.areas (name, locality, kind, geom, centroid, osm_id) values',
      `  ${values}`,
      'on conflict (osm_id) do update set name = excluded.name, locality = excluded.locality,',
      '  kind = excluded.kind, geom = excluded.geom, centroid = excluded.centroid;',
      '',
    );
  }
  out.push('delete from app.places where osm_id is null or osm_id > 0;', '');
  for (let i = 0; i < places.length; i += CHUNK) {
    const values = places
      .slice(i, i + CHUNK)
      .map(
        (p) =>
          `(${sqlString(p.name)}, ${sqlString(p.locality)}, ${sqlString(p.kind)}, ` +
          `${r6(p.lng)}, ${r6(p.lat)}, ${p.rank}, ${p.osmId})`,
      )
      .join(',\n  ');
    out.push(
      'insert into app.places (name, locality, kind, geom, rank, osm_id, area_id)',
      'select v.name, v.locality, v.kind, g.geom, v.rank, v.osm_id, app.area_for(g.geom)',
      'from (values',
      `  ${values}`,
      ') as v(name, locality, kind, lng, lat, rank, osm_id),',
      'lateral (select ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326) as geom) g;',
      '',
    );
  }
  return out.join('\n');
}

// --- Overpass -------------------------------------------------------------------------------

const { south, west, north, east } = COVERAGE_BBOX;
const BBOX = `${south},${west},${north},${east}`;

export const QUERIES = {
  boundaries: `[out:json][timeout:120];relation["boundary"="administrative"]["admin_level"="8"](${BBOX});out geom;`,
  placeNodes: `[out:json][timeout:60];node["place"~"^(suburb|quarter|neighbourhood)$"]["name"](${BBOX});out;`,
  streets: `[out:json][timeout:120];way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian)$"]["name"](${BBOX});out center tags;`,
  pois: `[out:json][timeout:120];(nwr["name"]["amenity"~"^(hospital|clinic|university|college|school|kindergarten|bus_station|marketplace|cinema|theatre|library|townhall|police|post_office|pharmacy|bank|restaurant|cafe)$"](${BBOX});nwr["name"]["shop"~"^(mall|supermarket|department_store|doityourself)$"](${BBOX});nwr["name"]["railway"="station"](${BBOX});nwr["name"]["public_transport"="station"](${BBOX});nwr["name"]["tourism"~"^(attraction|museum|hotel)$"](${BBOX});nwr["name"]["leisure"~"^(park|stadium|sports_centre)$"](${BBOX}););out center tags;`,
  addresses: `[out:json][timeout:180];nwr["addr:street"]["addr:housenumber"](${BBOX});out center tags;`,
} as const;

async function overpass(query: string, cacheDir: string | undefined): Promise<OsmElement[]> {
  const cacheFile = cacheDir
    ? join(cacheDir, `${createHash('sha1').update(query).digest('hex').slice(0, 12)}.json`)
    : undefined;
  if (cacheFile && existsSync(cacheFile)) {
    return (JSON.parse(await readFile(cacheFile, 'utf8')) as { elements: OsmElement[] }).elements;
  }
  const url = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
  let lastError = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'haide-gazetteer-build/1.0',
        accept: 'application/json',
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (res.ok) {
      const text = await res.text();
      if (cacheFile && cacheDir) {
        await mkdir(cacheDir, { recursive: true });
        await writeFile(cacheFile, text);
      }
      return (JSON.parse(text) as { elements: OsmElement[] }).elements;
    }
    lastError = `${res.status} ${res.statusText}`;
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
  throw new Error(`Overpass request failed: ${lastError}`);
}

// --- CLI ------------------------------------------------------------------------------------

export async function main(argv: string[]): Promise<void> {
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const outDir = resolve(root, value('out') ?? 'supabase/seed/gazetteer');
  const cacheDir = value('cache-dir') ? resolve(value('cache-dir') as string) : undefined;
  const withAddresses = !flag('no-addresses');

  console.log(`Overpass bbox ${BBOX}`);
  const [boundaries, nodes, streets, pois] = [
    await overpass(QUERIES.boundaries, cacheDir),
    await overpass(QUERIES.placeNodes, cacheDir),
    await overpass(QUERIES.streets, cacheDir),
    await overpass(QUERIES.pois, cacheDir),
  ];
  const addresses = withAddresses ? await overpass(QUERIES.addresses, cacheDir) : [];

  const localities = parseLocalities(boundaries);
  const areas = buildAreas(localities, parsePlaceNodes(nodes));
  const places = [
    ...areaPlaces(areas),
    ...localityPlaces(localities, areas),
    ...buildPlaces([...streets, ...pois, ...addresses], localities, { addresses: withAddresses }),
  ];
  console.log(`${localities.length} localities, ${areas.length} areas, ${places.length} places`);

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'areas.csv'), areasCsv(areas));
  await writeFile(join(outDir, 'places.csv'), placesCsv(places));

  if (flag('emit-migration')) {
    const today = new Date().toISOString().slice(0, 10);
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const file = join(root, 'supabase/migrations', `${stamp}_gazetteer_data.sql`);
    await writeFile(file, loaderSql(areas, places, today));
    console.log(`Wrote ${file}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
