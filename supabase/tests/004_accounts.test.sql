-- E1 accounts schema: RLS, grants, constraints, the auth.users trigger and legal seed data.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- Structure, RLS and public-role grants for every new table ------------------------------------
select has_table('app', t::name, t || ' exists')
  from unnest(array['profiles', 'vehicles', 'legal_documents', 'consents', 'reliability_events', 'ratings']) t;

select ok(
  (select relrowsecurity from pg_class where oid = ('app.' || t)::regclass),
  t || ' has row level security enabled')
  from unnest(array['profiles', 'vehicles', 'legal_documents', 'consents', 'reliability_events', 'ratings']) t;

select is(
  (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname in
      ('profiles', 'vehicles', 'legal_documents', 'consents', 'reliability_events', 'ratings')),
  0::bigint, 'new tables have no RLS policies (deny-all)');

select ok(
  not has_table_privilege('anon', ('app.' || t)::regclass, 'SELECT')
  and not has_table_privilege('authenticated', ('app.' || t)::regclass, 'SELECT')
  and not has_table_privilege('anon', ('app.' || t)::regclass, 'INSERT')
  and not has_table_privilege('authenticated', ('app.' || t)::regclass, 'INSERT'),
  t || ' is unreachable for anon and authenticated')
  from unnest(array['profiles', 'vehicles', 'legal_documents', 'consents', 'reliability_events', 'ratings']) t;

-- haide_api grants: append-only consents and ratings, reference-only legal documents ------------
select ok(has_table_privilege('haide_api', 'app.profiles', 'UPDATE'), 'haide_api can update profiles');
select ok(has_table_privilege('haide_api', 'app.vehicles', 'INSERT') and has_table_privilege('haide_api', 'app.vehicles', 'UPDATE'),
  'haide_api can insert and update vehicles');
select ok(has_table_privilege('haide_api', 'app.consents', 'INSERT') and has_table_privilege('haide_api', 'app.consents', 'SELECT'),
  'haide_api can read and append consents');
select ok(not has_table_privilege('haide_api', 'app.consents', 'UPDATE')
  and not has_table_privilege('haide_api', 'app.consents', 'DELETE'), 'consents are append-only for haide_api');
select ok(not has_table_privilege('haide_api', 'app.ratings', 'UPDATE')
  and not has_table_privilege('haide_api', 'app.ratings', 'DELETE'), 'ratings are immutable for haide_api');
select ok(has_table_privilege('haide_api', 'app.legal_documents', 'SELECT')
  and not has_table_privilege('haide_api', 'app.legal_documents', 'INSERT')
  and not has_table_privilege('haide_api', 'app.legal_documents', 'UPDATE')
  and not has_table_privilege('haide_api', 'app.legal_documents', 'DELETE'),
  'legal_documents is read-only for haide_api');

-- Functions: nothing in app is executable by PUBLIC (carry-forward), nor by anon/authenticated -----
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'app' and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  0::bigint, 'no app function is executable by PUBLIC');
select ok(not has_function_privilege('anon', 'app.handle_new_user()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app.handle_new_user()', 'EXECUTE'),
  'handle_new_user is not callable by anon or authenticated');

-- Constraints (as the table owner so grants do not interfere) ---------------------------------------
insert into app.profiles (id) values ('00000000-0000-4000-8000-000000000001');

select throws_ok($$update app.profiles set phone_e164 = '0721234567' where id = '00000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'phone must be E.164 +40');
select throws_ok($$update app.profiles set first_name = '' where id = '00000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'first name cannot be empty');
select throws_ok($$update app.profiles set bio = repeat('a', 201) where id = '00000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'bio is at most 200 characters');
select lives_ok($$update app.profiles set first_name = 'Ștefan', phone_e164 = '+40721234567', bio = repeat('ă', 200)
  where id = '00000000-0000-4000-8000-000000000001'$$, 'diacritics and a 200-char bio are accepted');

select throws_ok($$insert into app.vehicles (owner_id, make, model, colour, plate, fuel_type, seats)
  values ('00000000-0000-4000-8000-000000000001', 'Dacia', 'Logan', 'Grey', 'sb 12 abc', 'petrol', 3)$$,
  '23514', null, 'plate must be normalised');
select throws_ok($$insert into app.vehicles (owner_id, make, model, colour, plate, fuel_type, seats)
  values ('00000000-0000-4000-8000-000000000001', 'Dacia', 'Logan', 'Grey', 'SB12ABC', 'petrol', 5)$$,
  '23514', null, 'seats are 1 to 4');
insert into app.vehicles (owner_id, make, model, colour, plate, fuel_type, seats)
  values ('00000000-0000-4000-8000-000000000001', 'Dacia', 'Logan', 'Grey', 'SB12ABC', 'petrol', 3);
select throws_ok($$insert into app.vehicles (owner_id, make, model, colour, plate, fuel_type, seats)
  values ('00000000-0000-4000-8000-000000000001', 'Ford', 'Fiesta', 'Red', 'SB99XYZ', 'diesel', 3)$$,
  '23505', null, 'one vehicle per user');

select throws_ok($$insert into app.consents (user_id, kind, document_version)
  values ('00000000-0000-4000-8000-000000000001', 'age_18', '1.0')$$,
  '23514', null, 'age_18 consent has no document version');
select throws_ok($$insert into app.consents (user_id, kind)
  values ('00000000-0000-4000-8000-000000000001', 'terms')$$,
  '23514', null, 'terms consent needs a document version');

select throws_ok($$insert into app.ratings (booking_id, rater_id, ratee_id, stars, visible_at)
  values (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 5, now())$$,
  '23514', null, 'a user cannot rate themselves');

-- Trigger on auth.users --------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
  values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'trigger-test@example.com');
select is(
  (select count(*) from app.profiles where id = '00000000-0000-4000-8000-0000000000aa'),
  1::bigint, 'inserting an auth user creates its profile');
select is(
  (select status::text || '/' || role::text from app.profiles where id = '00000000-0000-4000-8000-0000000000aa'),
  'active/user', 'new profiles are active users');

-- Seed legal documents -----------------------------------------------------------------------------
select is(
  (select version from app.legal_documents where kind = 'terms' and published_at <= now()
    order by published_at desc limit 1), '1.0', 'terms 1.0 is current');
select is(
  (select version from app.legal_documents where kind = 'privacy' and published_at <= now()
    order by published_at desc limit 1), '1.0', 'privacy 1.0 is current');

-- Behaviour as the API role -------------------------------------------------------------------------
set local role haide_api;
select lives_ok($$insert into app.consents (user_id, kind, document_version)
  values ('00000000-0000-4000-8000-000000000001', 'terms', '1.0')$$, 'haide_api can append a consent');
select throws_ok($$delete from app.consents$$, '42501', null, 'haide_api cannot delete consents');
reset role;

select * from finish();
rollback;
