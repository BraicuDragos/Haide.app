-- Autocomplete behaviour. The helper below is the same query as searchPlaces() in
-- supabase/functions/api/repo/places.ts: keep them in sync.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create function pg_temp.search(q text, lim integer default 8)
returns table (name text, kind text)
language sql
as $$
  with qq as (
    select app.immutable_unaccent(lower(q)) as t
  ), qe as (
    select t, replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') as esc,
           char_length(regexp_replace(t, '[^a-z0-9]', '', 'g')) >= 3 as fuzzy
    from qq
  )
  select p.name, p.kind
  from app.places p
  cross join qe
  where p.osm_id < 0 -- sample rows only (see seed.sql)
    and (p.search_text like qe.esc || '%'
     or p.search_text like '% ' || qe.esc || '%'
     or (qe.fuzzy and (p.search_text % qe.t or qe.t <% p.search_text)))
  order by (p.search_text like qe.esc || '%') desc,
           word_similarity(qe.t, p.search_text) desc,
           p.rank asc,
           p.geom <-> ST_SetSRID(ST_MakePoint(24.1503, 45.7983), 4326) asc,
           p.name asc
  limit lim
$$;

select is((select name from pg_temp.search('selimbar') limit 1), 'Șelimbăr', 'selimbar finds Șelimbăr first');
select is((select kind from pg_temp.search('selimbar') limit 1), 'area', 'Șelimbăr first result is the area');
select is((select name from pg_temp.search('Șelimbăr') limit 1), 'Șelimbăr', 'diacritics in the query work too');
select is((select name from pg_temp.search('SELIMBAR') limit 1), 'Șelimbăr', 'case does not matter');
select is((select name from pg_temp.search('piata mare') limit 1), 'Piața Mare', 'piata mare finds Piața Mare first');
select is((select name from pg_temp.search('mare') limit 1), 'Piața Mare', 'word-prefix match finds Piața Mare');
select is((select name from pg_temp.search('selimbarului') limit 1), 'Strada Selimbarului', 'street prefix match');
select is(
  (select array_agg(name order by name) from pg_temp.search('piata', 2)),
  array['Piața Mare', 'Piața Mică'], 'piata lists both squares');
select ok((select count(*) from pg_temp.search('sibiu', 3)) <= 3, 'limit is honoured');
select is((select count(*) from pg_temp.search('%%')), 0::bigint, 'LIKE wildcards in input are escaped (%)');
select is((select count(*) from pg_temp.search('_a')), 0::bigint, 'LIKE wildcards in input are escaped (_)');
select is((select count(*) from pg_temp.search('zzzzqqqq')), 0::bigint, 'unknown text returns nothing');

select * from finish();
rollback;
