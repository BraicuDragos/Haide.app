-- E1 accounts: profiles (+ trigger on auth.users), vehicles, legal documents, consents,
-- reliability events and ratings (table only). data-model.md sections 4.1 and 4.5.
-- Forward-only. RLS is enabled on every table with NO policies (deny-all except haide_api).

-- ---------------------------------------------------------------------------------------------
-- profiles: one row per auth user. No FK to auth.users, so the tombstone survives deletion.
-- ---------------------------------------------------------------------------------------------
create table app.profiles (
  id uuid primary key,
  first_name text check (char_length(first_name) between 1 and 30),
  phone_e164 text check (phone_e164 ~ '^\+40[0-9]{9}$'),
  bio text check (char_length(bio) <= 200),
  photo_path text check (photo_path ~ '^avatars/[0-9a-f-]{36}\.jpg$'),
  status app.profile_status not null default 'active',
  role app.user_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_seen_summary_at timestamptz
);

-- Creates the profile when Supabase Auth creates a user. SECURITY DEFINER because the trigger
-- fires as supabase_auth_admin, which has no access to schema app.
create function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
begin
  insert into app.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Users that signed up before this migration (local resets, early testers).
insert into app.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- vehicles: one per user, plate normalised by the API (uppercase, no separators).
-- ---------------------------------------------------------------------------------------------
create table app.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references app.profiles (id) on delete cascade,
  make text not null check (char_length(make) between 1 and 30),
  model text not null check (char_length(model) between 1 and 30),
  colour text not null check (char_length(colour) between 1 and 30),
  plate text not null check (plate ~ '^[A-Z0-9]{4,10}$'),
  fuel_type app.fuel_type not null,
  seats smallint not null check (seats between 1 and 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- legal documents (versioned) and consents (append-only proof)
-- ---------------------------------------------------------------------------------------------
create table app.legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind app.consent_kind not null check (kind in ('terms', 'privacy')),
  version text not null check (char_length(version) between 1 and 20),
  published_at timestamptz not null,
  url text not null,
  unique (kind, version)
);

create table app.consents (
  id uuid primary key default gen_random_uuid(),
  -- no FK: kept 3 years after account deletion as proof (data-model 4.1)
  user_id uuid not null,
  kind app.consent_kind not null,
  document_version text,
  accepted_at timestamptz not null default now(),
  check ((kind = 'age_18') = (document_version is null))
);
create index consents_user_kind_idx on app.consents (user_id, kind, accepted_at desc);

-- Placeholder texts, versioned (E6-3 fills the content). Current = latest published_at <= now().
insert into app.legal_documents (kind, version, published_at, url) values
  ('terms', '1.0', '2026-11-15T00:00:00Z', '/policy/terms'),
  ('privacy', '1.0', '2026-11-15T00:00:00Z', '/policy/privacy');

-- ---------------------------------------------------------------------------------------------
-- trust: reliability events (profile counters) and ratings (public rating summary)
-- ---------------------------------------------------------------------------------------------
create table app.reliability_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles (id),
  kind app.reliability_kind not null,
  booking_id uuid,
  ride_id uuid,
  occurred_at timestamptz not null default now()
);
create index reliability_events_user_idx on app.reliability_events (user_id, occurred_at);

-- booking_id gets its foreign key with the bookings table (E3/E4). Rows are immutable.
create table app.ratings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  rater_id uuid not null references app.profiles (id),
  ratee_id uuid not null references app.profiles (id),
  stars smallint not null check (stars between 1 and 5),
  tags text[] not null default '{}' check (cardinality(tags) <= 5),
  created_at timestamptz not null default now(),
  check (rater_id <> ratee_id),
  unique (booking_id, rater_id)
);
create index ratings_ratee_idx on app.ratings (ratee_id, created_at);

-- outbox.user_id was waiting for profiles (baseline comment).
alter table app.outbox
  add constraint outbox_user_id_fkey foreign key (user_id) references app.profiles (id);

-- ---------------------------------------------------------------------------------------------
-- Row level security (no policies) and grants
-- ---------------------------------------------------------------------------------------------
alter table app.profiles enable row level security;
alter table app.vehicles enable row level security;
alter table app.legal_documents enable row level security;
alter table app.consents enable row level security;
alter table app.reliability_events enable row level security;
alter table app.ratings enable row level security;

-- Append-only proof and immutable ratings. Legal documents are reference data loaded by migrations.
-- (The retention job of E6 gets its own, narrower grant for consents.)
revoke update, delete on app.consents, app.ratings from haide_api;
revoke insert, update, delete on app.legal_documents from haide_api;

-- No access for the public roles, and nothing executable by PUBLIC (carry-forward finding):
-- Postgres grants EXECUTE to PUBLIC on every new function unless revoked.
revoke all on all tables in schema app from anon, authenticated;
revoke all on function app.handle_new_user() from public, anon, authenticated;
-- The trigger fires as the table owner path; the API never calls it.
revoke execute on function app.handle_new_user() from haide_api;
