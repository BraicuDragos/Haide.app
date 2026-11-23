-- Address search accepts any house number (ADR 0042): app.route_previews and app.rides remember whether the
-- origin or the destination was a synthetic (estimated) address. Additive, NOT NULL, default false.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- route_previews ---------------------------------------------------------------------------------------------
select has_column('app', 'route_previews', 'origin_approximate', 'route_previews.origin_approximate exists');
select has_column('app', 'route_previews', 'destination_approximate', 'route_previews.destination_approximate exists');
select col_type_is('app', 'route_previews', 'origin_approximate', 'boolean', 'route_previews.origin_approximate is boolean');
select col_type_is('app', 'route_previews', 'destination_approximate', 'boolean', 'route_previews.destination_approximate is boolean');
select col_not_null('app', 'route_previews', 'origin_approximate', 'route_previews.origin_approximate is NOT NULL');
select col_not_null('app', 'route_previews', 'destination_approximate', 'route_previews.destination_approximate is NOT NULL');
select ok((select column_default = 'false' from information_schema.columns where table_schema = 'app' and table_name = 'route_previews' and column_name = 'origin_approximate'), 'route_previews.origin_approximate defaults to false');
select ok((select column_default = 'false' from information_schema.columns where table_schema = 'app' and table_name = 'route_previews' and column_name = 'destination_approximate'), 'route_previews.destination_approximate defaults to false');

-- rides ------------------------------------------------------------------------------------------------------
select has_column('app', 'rides', 'origin_approximate', 'rides.origin_approximate exists');
select has_column('app', 'rides', 'destination_approximate', 'rides.destination_approximate exists');
select col_type_is('app', 'rides', 'origin_approximate', 'boolean', 'rides.origin_approximate is boolean');
select col_type_is('app', 'rides', 'destination_approximate', 'boolean', 'rides.destination_approximate is boolean');
select col_not_null('app', 'rides', 'origin_approximate', 'rides.origin_approximate is NOT NULL');
select col_not_null('app', 'rides', 'destination_approximate', 'rides.destination_approximate is NOT NULL');
select ok((select column_default = 'false' from information_schema.columns where table_schema = 'app' and table_name = 'rides' and column_name = 'origin_approximate'), 'rides.origin_approximate defaults to false');
select ok((select column_default = 'false' from information_schema.columns where table_schema = 'app' and table_name = 'rides' and column_name = 'destination_approximate'), 'rides.destination_approximate defaults to false');

-- A row that does not mention the flags gets false; an explicit null is rejected ------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-000000001501', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ap1@example.com');

select lives_ok($$
  insert into app.route_previews (id, driver_id, origin, destination, origin_label, destination_label, route,
                                  distance_m, duration_s, provider, created_at, expires_at)
  values ('c5000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000001501',
          ST_SetSRID(ST_MakePoint(24.1861, 45.7413), 4326), ST_SetSRID(ST_MakePoint(24.09, 45.785), 4326),
          'Strada Negoveanu 2', 'Birou',
          ST_GeomFromText('LINESTRING(24.1861 45.7413, 24.09 45.785)', 4326),
          9588, 1020, 'fixture', now(), now() + interval '30 minutes')
$$, 'a preview that does not mention the flags is accepted');

select throws_ok($$
  update app.route_previews set origin_approximate = null where id = 'c5000000-0000-4000-8000-000000000001'
$$, '23502', null, 'a NULL flag is rejected');

select * from finish();
rollback;
