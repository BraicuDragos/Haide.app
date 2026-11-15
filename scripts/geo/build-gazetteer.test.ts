import { describe, expect, it } from 'vitest';
import {
  RELATION_OFFSET,
  areaPlaces,
  areasCsv,
  buildAreas,
  buildPlaces,
  centroidOf,
  csvField,
  loaderSql,
  localityFor,
  localityPlaces,
  parseLocalities,
  parsePlaceNodes,
  placesCsv,
  pointInMulti,
  sqlString,
  stitchRings,
  toWkt,
  type Locality,
  type MultiPolygon,
  type OsmElement,
  type Pos,
} from './build-gazetteer.ts';

const square = (x0: number, y0: number, x1: number, y1: number): MultiPolygon => [
  [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
];

const locality = (name: string, mp: MultiPolygon, osmId = RELATION_OFFSET + 1): Locality => ({
  osmId,
  name,
  polygon: mp,
  centroid: centroidOf(mp),
});

describe('geometry', () => {
  it('stitches way fragments (including reversed ones) into a closed ring', () => {
    const a: Pos[] = [
      [0, 0],
      [1, 0],
    ];
    const b: Pos[] = [
      [1, 1],
      [1, 0],
    ]; // reversed
    const c: Pos[] = [
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    const rings = stitchRings([a, b, c]);
    expect(rings).toHaveLength(1);
    expect(rings[0]?.[0]).toEqual(rings[0]?.[rings[0].length - 1]);
    expect(rings[0]).toHaveLength(5);
  });

  it('drops fragments that never close', () => {
    expect(
      stitchRings([
        [
          [0, 0],
          [1, 1],
        ],
      ]),
    ).toEqual([]);
  });

  it('tests point in polygon with holes', () => {
    const donut: MultiPolygon = [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
          [4, 4],
        ],
      ],
    ];
    expect(pointInMulti([1, 1], donut)).toBe(true);
    expect(pointInMulti([5, 5], donut)).toBe(false);
    expect(pointInMulti([11, 5], donut)).toBe(false);
  });

  it('computes a centroid for the largest ring', () => {
    const c = centroidOf(square(0, 0, 4, 2));
    expect(c[0]).toBeCloseTo(2, 6);
    expect(c[1]).toBeCloseTo(1, 6);
    expect(centroidOf([])).toEqual([0, 0]);
  });
});

describe('areas', () => {
  const loc = locality('Sibiu', square(24.0, 45.7, 24.2, 45.9));

  it('builds Voronoi cells clipped to the locality, one per place node', () => {
    const nodes = parsePlaceNodes([
      { type: 'node', id: 1, lat: 45.8, lon: 24.05, tags: { name: 'Vest', place: 'suburb' } },
      { type: 'node', id: 2, lat: 45.8, lon: 24.15, tags: { name: 'Est', place: 'quarter' } },
      { type: 'node', id: 3, lat: 45.8, lon: 24.15, tags: { place: 'quarter' } }, // no name
      { type: 'node', id: 4, lat: 45.8, lon: 24.1, tags: { name: 'Sat', place: 'village' } }, // wrong kind
    ]);
    expect(nodes.map((n) => n.name)).toEqual(['Vest', 'Est']);
    const areas = buildAreas([loc], nodes);
    expect(areas.map((a) => a.name)).toEqual(['Vest', 'Est']);
    expect(areas.every((a) => a.locality === 'Sibiu')).toBe(true);
    // Each cell contains its own node and not the other one, and stays inside the locality.
    expect(pointInMulti([24.05, 45.8], areas[0]!.geom)).toBe(true);
    expect(pointInMulti([24.15, 45.8], areas[0]!.geom)).toBe(false);
    expect(pointInMulti([24.15, 45.8], areas[1]!.geom)).toBe(true);
    for (const a of areas) {
      for (const ring of a.geom.flat()) {
        for (const [x, y] of ring) {
          expect(x).toBeGreaterThanOrEqual(24.0 - 1e-9);
          expect(x).toBeLessThanOrEqual(24.2 + 1e-9);
          expect(y).toBeGreaterThanOrEqual(45.7 - 1e-9);
          expect(y).toBeLessThanOrEqual(45.9 + 1e-9);
        }
      }
    }
  });

  it('turns a locality without place nodes into one area', () => {
    const areas = buildAreas([loc], []);
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ name: 'Sibiu', kind: 'locality', osmId: RELATION_OFFSET + 1 });
  });

  it('uses the single place node as the area name when there is only one', () => {
    const areas = buildAreas(
      [loc],
      [{ osmId: 9, name: 'Centru', kind: 'quarter', lng: 24.1, lat: 45.8 }],
    );
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ name: 'Centru', kind: 'quarter', osmId: 9 });
  });

  it('parses administrative relations into localities', () => {
    const rel: OsmElement = {
      type: 'relation',
      id: 77,
      tags: { name: 'Cisnădie', boundary: 'administrative' },
      members: [
        {
          type: 'way',
          role: 'outer',
          geometry: [
            { lat: 45.7, lon: 24.1 },
            { lat: 45.7, lon: 24.2 },
            { lat: 45.8, lon: 24.2 },
          ],
        },
        {
          type: 'way',
          role: 'outer',
          geometry: [
            { lat: 45.8, lon: 24.2 },
            { lat: 45.8, lon: 24.1 },
            { lat: 45.7, lon: 24.1 },
          ],
        },
        { type: 'node', role: 'admin_centre' },
      ],
    };
    const [l] = parseLocalities([rel, { type: 'relation', id: 78, tags: {} }]);
    expect(l?.name).toBe('Cisnădie');
    expect(l?.osmId).toBe(RELATION_OFFSET + 77);
    expect(pointInMulti([24.15, 45.75], l?.polygon ?? [])).toBe(true);
  });

  it('assigns the containing locality, else the nearest, else Sibiu', () => {
    const a = locality('A', square(0, 0, 1, 1), 1);
    const b = locality('B', square(10, 10, 11, 11), 2);
    expect(localityFor([0.5, 0.5], [a, b])).toBe('A');
    expect(localityFor([9, 9], [a, b])).toBe('B');
    expect(localityFor([9, 9], [])).toBe('Sibiu');
  });
});

describe('places', () => {
  const loc = locality('Sibiu', square(23.98, 45.68, 24.32, 45.86));
  const way = (id: number, name: string, lat: number, lon: number): OsmElement => ({
    type: 'way',
    id,
    center: { lat, lon },
    tags: { highway: 'residential', name },
  });

  it('keeps one street per name and locality (lowest id) and ignores footways', () => {
    const places = buildPlaces(
      [
        way(5, 'Strada Mitropoliei', 45.797, 24.149),
        way(2, 'Strada Mitropoliei', 45.798, 24.15),
        {
          type: 'way',
          id: 3,
          center: { lat: 45.8, lon: 24.1 },
          tags: { highway: 'footway', name: 'Alee' },
        },
      ],
      [loc],
      { addresses: true },
    );
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ osmId: 2, kind: 'street', rank: 3, locality: 'Sibiu' });
  });

  it('collects POIs and addresses and can skip addresses', () => {
    const els: OsmElement[] = [
      {
        type: 'node',
        id: 10,
        lat: 45.7977,
        lon: 24.1505,
        tags: { name: 'Piața Mare', tourism: 'attraction' },
      },
      {
        type: 'way',
        id: 11,
        center: { lat: 45.74, lon: 24.18 },
        tags: { name: 'Shopping City', shop: 'mall' },
      },
      {
        type: 'node',
        id: 12,
        lat: 45.79,
        lon: 24.14,
        tags: { 'addr:street': 'Strada Turnului', 'addr:housenumber': '12' },
      },
      { type: 'node', id: 13, lat: 45.9, lon: 24.14, tags: { name: 'Outside', amenity: 'cafe' } },
    ];
    const withAddr = buildPlaces(els, [loc], { addresses: true });
    expect(withAddr.map((p) => `${p.kind}:${p.name}`)).toEqual([
      'poi:Piața Mare',
      'poi:Shopping City',
      'address:Strada Turnului 12',
    ]);
    expect(withAddr.find((p) => p.kind === 'address')?.rank).toBe(4);
    expect(buildPlaces(els, [loc], { addresses: false }).some((p) => p.kind === 'address')).toBe(
      false,
    );
  });

  it('collapses the same POI mapped as a node and a way', () => {
    const places = buildPlaces(
      [
        {
          type: 'node',
          id: 7,
          lat: 45.79231,
          lon: 24.14777,
          tags: { name: 'Hotel Forum', tourism: 'hotel' },
        },
        {
          type: 'way',
          id: 7,
          center: { lat: 45.79232, lon: 24.14778 },
          tags: { name: 'Hotel Forum', tourism: 'hotel' },
        },
        {
          type: 'node',
          id: 8,
          lat: 45.7,
          lon: 24.1,
          tags: { name: 'Hotel Forum', tourism: 'hotel' },
        },
      ],
      [loc],
      { addresses: false },
    );
    expect(places).toHaveLength(2);
  });

  it('turns areas into rank-1 places', () => {
    const areas = buildAreas([loc], []);
    expect(areaPlaces(areas)[0]).toMatchObject({ kind: 'area', rank: 1, name: 'Sibiu' });
  });

  it('makes every locality searchable by name unless an area already carries it', () => {
    const alpha = locality('Sibiu', square(0, 0, 1, 1), RELATION_OFFSET + 3); // no nodes: becomes the area Sibiu
    const other = locality('Șelimbăr', square(24.1, 45.7, 24.2, 45.8), RELATION_OFFSET + 2);
    const nodes = [
      { osmId: 1, name: 'Tineretului', kind: 'suburb' as const, lng: 24.12, lat: 45.72 },
      { osmId: 2, name: 'Doamna Stanca', kind: 'suburb' as const, lng: 24.18, lat: 45.78 },
    ];
    const areas = buildAreas([alpha, other], nodes);
    const extra = localityPlaces([alpha, other], areas);
    expect(extra.map((p) => p.name)).toEqual(['Șelimbăr']); // Sibiu already is an area
    expect(extra[0]).toMatchObject({ kind: 'area', rank: 1, locality: 'Șelimbăr' });
  });
});

describe('serialisation', () => {
  it('quotes CSV fields only when needed and keeps UTF-8', () => {
    expect(csvField('Piața Mare')).toBe('Piața Mare');
    expect(csvField('Strada "X", 12')).toBe('"Strada ""X"", 12"');
  });

  it('writes WKT, areas.csv and places.csv', () => {
    expect(toWkt(square(1, 2, 3, 4))).toBe('MULTIPOLYGON(((1 2,3 2,3 4,1 4,1 2)))');
    const loc = locality('Șelimbăr', square(24, 45.7, 24.2, 45.8));
    const areas = buildAreas([loc], []);
    const csv = areasCsv(areas);
    expect(csv.split('\n')[0]).toBe('osm_id,name,locality,kind,centroid_lat,centroid_lng,geom_wkt');
    expect(csv).toContain('Șelimbăr');
    expect(placesCsv(areaPlaces(areas)).split('\n')[1]).toContain(',Șelimbăr,area,Șelimbăr,1,');
  });

  it('escapes SQL strings and generates an idempotent loader', () => {
    expect(sqlString("Strada Sf. Ioan's")).toBe("'Strada Sf. Ioan''s'");
    const loc = locality("O'Neil", square(24, 45.7, 24.2, 45.8));
    const areas = buildAreas([loc], []);
    const sql = loaderSql(areas, areaPlaces(areas), '2026-11-15');
    expect(sql).toContain("'O''Neil'");
    expect(sql).toContain('on conflict (osm_id) do update');
    expect(sql).toContain('delete from app.places where osm_id is null or osm_id > 0;');
    expect(sql).toContain('app.area_for(g.geom)');
    expect(sql).toContain('ODbL');
  });
});
