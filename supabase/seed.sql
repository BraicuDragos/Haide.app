-- Local and test seed (runs on `supabase db reset`, never in production).
--
-- 1. Local password for the API role (production sets its own via deploy.yml).
-- 2. A SMALL gazetteer sample for tests and local development. Coordinates and boundaries are
--    approximate and illustrative only. The real Sibiu gazetteer is built by
--    scripts/geo/build-gazetteer.ts (OpenStreetMap, ODbL) and loaded by its own migration.
-- 3. Legal documents v1 are seeded by the E1 migration. Energy prices v1 are seeded by the E2 migration (needed in every environment).

alter role haide_api with password 'haide_api_local';

-- Areas: rectangles around approximate centres (lng, lat). ~1.6 km x 1.2 km boxes.
insert into app.areas (name, locality, kind, geom, centroid, osm_id)
select v.name, v.locality, v.kind,
       ST_Multi(ST_MakeEnvelope(v.lng - v.dx, v.lat - v.dy, v.lng + v.dx, v.lat + v.dy, 4326)),
       ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326),
       v.osm_id
from (values
  ('Centru',                 'Sibiu',     'quarter',  24.1500, 45.7978, 0.010, 0.006, -1),
  ('Hipodrom',               'Sibiu',     'quarter',  24.1330, 45.7720, 0.010, 0.006, -2),
  ('Terezian',               'Sibiu',     'quarter',  24.1500, 45.7800, 0.004, 0.003, -3),
  ('Zona Industrială Vest',  'Sibiu',     'suburb',   24.0930, 45.7850, 0.012, 0.008, -4),
  ('Șelimbăr',               'Șelimbăr',  'locality', 24.1880, 45.7440, 0.012, 0.010, -5),
  ('Cisnădie',               'Cisnădie',  'locality', 24.1520, 45.7110, 0.014, 0.010, -6)
) as v(name, locality, kind, lng, lat, dx, dy, osm_id);

-- Areas are searchable places too (rank 1).
insert into app.places (name, locality, kind, area_id, geom, rank, osm_id)
select a.name, a.locality, 'area', a.id, a.centroid, 1, a.osm_id
from app.areas a;

-- Streets, POIs (illustrative coordinates). Sample rows have negative osm_id so tests can tell them
-- apart from real gazetteer data if that is loaded as well.
insert into app.places (name, locality, kind, area_id, geom, rank, osm_id)
select v.name, v.locality, v.kind, app.area_for(g.geom), g.geom, v.rank, v.osm_id
from (values
  ('Piața Mare',                  'Sibiu',     'poi',    24.1505, 45.7977, 2, -100),
  ('Piața Mică',                  'Sibiu',     'poi',    24.1485, 45.7985, 2, -101),
  ('Gara Sibiu',                  'Sibiu',     'poi',    24.1385, 45.7870, 2, -102),
  ('Shopping City Sibiu',         'Șelimbăr',  'poi',    24.1861, 45.7413, 2, -103),
  ('Spitalul Clinic Județean',    'Sibiu',     'poi',    24.1360, 45.7840, 2, -104),
  ('Universitatea Lucian Blaga',  'Sibiu',     'poi',    24.1330, 45.7960, 2, -105),
  ('Strada Mitropoliei',          'Sibiu',     'street', 24.1488, 45.7970, 3, -106),
  ('Strada Nicolae Bălcescu',     'Sibiu',     'street', 24.1520, 45.7990, 3, -107),
  ('Strada Salzburg',             'Sibiu',     'street', 24.0900, 45.7850, 3, -108),
  ('Strada Măgurii',              'Cisnădie',  'street', 24.1510, 45.7090, 3, -109),
  ('Strada Selimbarului',         'Sibiu',     'street', 24.1700, 45.7700, 3, -110)
) as v(name, locality, kind, lng, lat, rank, osm_id),
lateral (select ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326) as geom) g;
