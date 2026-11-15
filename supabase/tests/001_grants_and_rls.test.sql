-- Grants and RLS baseline (data-model 5.1): the public roles must not reach schema `app`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select has_schema('app', 'schema app exists');

select ok(not has_schema_privilege('anon', 'app', 'USAGE'), 'anon has no USAGE on schema app');
select ok(not has_schema_privilege('authenticated', 'app', 'USAGE'), 'authenticated has no USAGE on schema app');
select ok(has_schema_privilege('haide_api', 'app', 'USAGE'), 'haide_api has USAGE on schema app');
select ok(not has_schema_privilege('haide_api', 'app', 'CREATE'), 'haide_api cannot create objects in app');

select cmp_ok(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'p')),
  '>', 0::bigint, 'app has tables');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0::bigint, 'every app table has row level security enabled');

select is(
  (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app'),
  0::bigint, 'no RLS policies in app (deny-all for everyone except haide_api)');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'p')
      and (has_table_privilege('anon', c.oid, 'SELECT')
        or has_table_privilege('authenticated', c.oid, 'SELECT'))),
  0::bigint, 'anon and authenticated cannot SELECT from any app table');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0::bigint, 'anon and authenticated cannot EXECUTE any app function');

-- Behaviour, not just catalog flags.
set local role anon;
select throws_ok($$select 1 from app.places$$, '42501', null, 'anon cannot read app.places');
select throws_ok($$select 1 from app.rate_limits$$, '42501', null, 'anon cannot read app.rate_limits');
reset role;

set local role authenticated;
select throws_ok($$select 1 from app.places$$, '42501', null, 'authenticated cannot read app.places');
select throws_ok($$select app.rate_limit_hit('k', 60, 1)$$, '42501', null, 'authenticated cannot call app functions');
reset role;

set local role haide_api;
select ok((select count(*) from app.places) > 0, 'haide_api reads rows despite RLS (BYPASSRLS), seed gazetteer present');
select lives_ok($$select app.rate_limit_hit('grants-test', 60, 5)$$, 'haide_api can call app functions');
select throws_ok(
  $$insert into app.areas (name, locality, kind, geom, centroid)
    values ('x', 'x', 'locality', ST_Multi(ST_MakeEnvelope(0, 0, 1, 1, 4326)), ST_SetSRID(ST_MakePoint(0, 0), 4326))$$,
  '42501', null, 'haide_api cannot modify the gazetteer');
select throws_ok($$create table app.sneaky (i int)$$, '42501', null, 'haide_api cannot run DDL in app');
reset role;

select * from finish();
rollback;
