-- Helper functions: unaccent, grid rounding (must mirror _shared/domain/privacy.ts), route trimming,
-- rate limiting and area lookup.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- immutable_unaccent -------------------------------------------------------------------------
select is(app.immutable_unaccent(lower('Șelimbăr')), 'selimbar', 'comma-below s and breve a are folded');
select is(app.immutable_unaccent(lower('Piața Mare')), 'piata mare', 'Piața Mare is folded');
select is(app.immutable_unaccent(lower('ȘTEFAN ȚEPEȘ')), 'stefan tepes', 'Ștefan Țepeș is folded');
select is(app.immutable_unaccent(lower('Ţară Şcoală')), 'tara scoala', 'legacy cedilla forms are folded');
select is(
  (select provolatile::text from pg_proc where oid = 'app.immutable_unaccent(text)'::regprocedure),
  'i', 'immutable_unaccent is marked IMMUTABLE');

-- grid_point: expected values come from gridPoint() in privacy.ts (UTM 35N, 5 decimals) -----
select is(
  (select round(ST_X(g)::numeric, 5) || ',' || round(ST_Y(g)::numeric, 5)
     from (select app.grid_point(ST_SetSRID(ST_MakePoint(24.15211, 45.79712), 4326), 300) g) s),
  '24.15040,45.79797', '300 m grid centre matches the TypeScript mirror');
select is(
  (select round(ST_X(g)::numeric, 5) || ',' || round(ST_Y(g)::numeric, 5)
     from (select app.grid_point(ST_SetSRID(ST_MakePoint(24.15211, 45.79712), 4326), 1000) g) s),
  '24.14979,45.79750', '1 km grid centre matches the TypeScript mirror');
select is(
  (select round(ST_X(g)::numeric, 5) || ',' || round(ST_Y(g)::numeric, 5)
     from (select app.grid_point(ST_SetSRID(ST_MakePoint(24.153, 45.7105), 4326), 300) g) s),
  '24.15480,45.71167', 'second 300 m reference point matches the TypeScript mirror');
select ok(
  ST_Equals(
    app.grid_point(ST_SetSRID(ST_MakePoint(24.15211, 45.79712), 4326), 300),
    app.grid_point(ST_SetSRID(ST_MakePoint(24.15213, 45.79714), 4326), 300)),
  'nearby points land in the same cell');
select ok(
  ST_Distance(
    ST_Transform(app.grid_point(ST_SetSRID(ST_MakePoint(24.15211, 45.79712), 4326), 300), 32635),
    ST_Transform(ST_SetSRID(ST_MakePoint(24.15211, 45.79712), 4326), 32635)) < 300 * 0.7072 + 1,
  'a snapped point stays within half a cell diagonal of the original');

-- trim_route ----------------------------------------------------------------------------------
select ok(
  abs(
    ST_Length(ST_Transform(app.trim_route(
      ST_SetSRID(ST_MakeLine(ST_MakePoint(24.10, 45.78), ST_MakePoint(24.16, 45.78)), 4326), 300, 0.2), 32635))
    - (ST_Length(ST_Transform(
        ST_SetSRID(ST_MakeLine(ST_MakePoint(24.10, 45.78), ST_MakePoint(24.16, 45.78)), 4326), 32635)) - 600)
  ) < 1,
  'trim_route removes max_m from both ends of a long route');
select ok(
  app.trim_route(
    ST_SetSRID(ST_MakeLine(ST_MakePoint(24.100, 45.78), ST_MakePoint(24.1065, 45.78)), 4326), 300, 0.5) is null,
  'trim_route returns NULL when nothing would remain');
select ok(
  ST_Distance(
    ST_StartPoint(app.trim_route(
      ST_SetSRID(ST_MakeLine(ST_MakePoint(24.10, 45.78), ST_MakePoint(24.16, 45.78)), 4326), 300, 0.2))::geography,
    ST_SetSRID(ST_MakePoint(24.10, 45.78), 4326)::geography) > 250,
  'the exact origin is not part of the trimmed route');

-- rate_limit_hit ------------------------------------------------------------------------------
select is(app.rate_limit_hit('test:a', 3600, 3), true, 'hit 1 of 3 allowed');
select is(app.rate_limit_hit('test:a', 3600, 3), true, 'hit 2 of 3 allowed');
select is(app.rate_limit_hit('test:a', 3600, 3), true, 'hit 3 of 3 allowed');
select is(app.rate_limit_hit('test:a', 3600, 3), false, 'hit 4 of 3 refused');
select is(app.rate_limit_hit('test:b', 3600, 3), true, 'other keys are independent');

-- area_for (fixture areas far away from any real gazetteer data) -----------------------------
insert into app.areas (name, locality, kind, geom, centroid, osm_id) values
  ('Test North', 'Testville', 'quarter', ST_Multi(ST_MakeEnvelope(10.0, 10.0, 10.1, 10.1, 4326)),
   ST_SetSRID(ST_MakePoint(10.05, 10.05), 4326), -9001),
  ('Test South', 'Testville', 'quarter', ST_Multi(ST_MakeEnvelope(10.0, 9.8, 10.1, 9.9, 4326)),
   ST_SetSRID(ST_MakePoint(10.05, 9.85), 4326), -9002);

select is(
  (select name from app.areas where id = app.area_for(ST_SetSRID(ST_MakePoint(10.05, 10.05), 4326))),
  'Test North', 'area_for finds the containing area');
select is(
  (select name from app.areas where id = app.area_for(ST_SetSRID(ST_MakePoint(10.05, 9.93), 4326))),
  'Test South', 'area_for falls back to the nearest centroid outside every area');

select * from finish();
rollback;
