import type { Db } from '../../_shared/db.ts';
import type { VehicleResponse } from '../../_shared/contracts/account.ts';
import {
  requiredConsents,
  type AcceptedConsent,
  type CurrentLegal,
} from '../../_shared/domain/account.ts';
import type { Account } from '../types.ts';

type LegalRow = { kind: 'terms' | 'privacy'; version: string; url: string };

/** Current version per kind: the latest `published_at <= now()` (data-model 4.1). */
export async function currentLegal(
  sql: Db,
  at: Date,
): Promise<{ versions: CurrentLegal; urls: { terms: string; privacy: string } }> {
  const rows = await sql<LegalRow[]>`
    select distinct on (kind) kind, version, url
    from app.legal_documents
    where published_at <= ${at}
    order by kind, published_at desc`;
  const terms = rows.find((r) => r.kind === 'terms');
  const privacy = rows.find((r) => r.kind === 'privacy');
  if (!terms || !privacy) throw new Error('legal_documents is missing a current version');
  return {
    versions: { terms: terms.version, privacy: privacy.version },
    urls: { terms: terms.url, privacy: privacy.url },
  };
}

type ProfileRow = {
  id: string;
  first_name: string | null;
  phone_e164: string | null;
  bio: string | null;
  photo_path: string | null;
  status: Account['status'];
  role: Account['role'];
  created_at: Date | string;
  has_vehicle: boolean;
};

async function selectProfile(sql: Db, userId: string): Promise<ProfileRow | undefined> {
  const rows = await sql<ProfileRow[]>`
    select p.id, p.first_name, p.phone_e164, p.bio, p.photo_path, p.status, p.role, p.created_at,
           exists (select 1 from app.vehicles v where v.owner_id = p.id) as has_vehicle
    from app.profiles p
    where p.id = ${userId}`;
  return rows[0];
}

/**
 * Loads the caller's account. The auth.users trigger normally created the profile already; users
 * that predate it (or a trigger that lagged) get their row here, so no request ever fails on it.
 */
export async function loadAccount(
  sql: Db,
  userId: string,
  email: string | null,
  at: Date,
): Promise<Account> {
  let profile = await selectProfile(sql, userId);
  if (!profile) {
    await sql`insert into app.profiles (id) values (${userId}) on conflict (id) do nothing`;
    profile = await selectProfile(sql, userId);
    if (!profile) throw new Error('profile could not be created');
  }
  const [legal, accepted] = await Promise.all([
    currentLegal(sql, at),
    sql<{ kind: AcceptedConsent['kind']; version: string | null }[]>`
      select distinct kind, document_version as version
      from app.consents
      where user_id = ${userId}`,
  ]);
  return {
    id: profile.id,
    email,
    firstName: profile.first_name,
    phoneE164: profile.phone_e164,
    bio: profile.bio,
    photoPath: profile.photo_path,
    status: profile.status,
    role: profile.role,
    createdAt: new Date(profile.created_at),
    hasVehicle: profile.has_vehicle,
    consentRequired: requiredConsents(legal.versions, accepted),
  };
}

/** Writes the three consent rows (terms, privacy, age_18) in one statement. */
export async function recordConsents(
  sql: Db,
  userId: string,
  versions: CurrentLegal,
): Promise<void> {
  await sql`
    insert into app.consents (user_id, kind, document_version)
    values (${userId}, 'terms', ${versions.terms}),
           (${userId}, 'privacy', ${versions.privacy}),
           (${userId}, 'age_18', null)`;
}

export type ProfilePatchValues = {
  firstName?: string;
  phone?: string;
  bio?: string | null;
};

/** Partial update: omitted fields keep their value. `bio: null` clears it. */
export async function updateProfile(sql: Db, userId: string, v: ProfilePatchValues): Promise<void> {
  const bioProvided = v.bio !== undefined;
  await sql`
    update app.profiles set
      first_name = coalesce(${v.firstName ?? null}::text, first_name),
      phone_e164 = coalesce(${v.phone ?? null}::text, phone_e164),
      bio = case when ${bioProvided}::boolean then ${v.bio ?? null}::text else bio end,
      updated_at = now()
    where id = ${userId}`;
}

export async function setPhotoPath(sql: Db, userId: string, path: string): Promise<string | null> {
  const rows = await sql<{ previous: string | null }[]>`
    update app.profiles p set photo_path = ${path}, updated_at = now()
    from (select photo_path from app.profiles where id = ${userId} for update) old
    where p.id = ${userId}
    returning old.photo_path as previous`;
  return rows[0]?.previous ?? null;
}

type VehicleRow = {
  make: string;
  model: string;
  colour: string;
  plate: string;
  fuel_type: VehicleResponse['fuelType'];
  seats: number;
};

const toVehicle = (r: VehicleRow): VehicleResponse => ({
  make: r.make,
  model: r.model,
  colour: r.colour,
  plate: r.plate,
  fuelType: r.fuel_type,
  seats: r.seats,
});

export async function getVehicle(sql: Db, ownerId: string): Promise<VehicleResponse | null> {
  const rows = await sql<VehicleRow[]>`
    select make, model, colour, plate, fuel_type, seats
    from app.vehicles where owner_id = ${ownerId}`;
  return rows[0] ? toVehicle(rows[0]) : null;
}

/** One vehicle per user: create or replace. Published rides keep their own snapshot. */
export async function upsertVehicle(
  sql: Db,
  ownerId: string,
  v: VehicleResponse,
): Promise<VehicleResponse> {
  const rows = await sql<VehicleRow[]>`
    insert into app.vehicles (owner_id, make, model, colour, plate, fuel_type, seats)
    values (${ownerId}, ${v.make}, ${v.model}, ${v.colour}, ${v.plate}, ${v.fuelType}, ${v.seats})
    on conflict (owner_id) do update set
      make = excluded.make, model = excluded.model, colour = excluded.colour,
      plate = excluded.plate, fuel_type = excluded.fuel_type, seats = excluded.seats,
      updated_at = now()
    returning make, model, colour, plate, fuel_type, seats`;
  const row = rows[0];
  if (!row) throw new Error('vehicle upsert returned no row');
  return toVehicle(row);
}

export type PublicProfileRow = {
  id: string;
  first_name: string | null;
  bio: string | null;
  photo_path: string | null;
  status: Account['status'];
  created_at: Date | string;
  rating_count: number;
  rating_avg: number | null;
  late_cancellations: number;
  no_shows: number;
};

/** Everything the public profile needs in one round trip. Never selects phone or plate. */
export async function getPublicProfile(
  sql: Db,
  userId: string,
  since: Date,
): Promise<PublicProfileRow | undefined> {
  const rows = await sql<PublicProfileRow[]>`
    select p.id, p.first_name, p.bio, p.photo_path, p.status, p.created_at,
      (select count(*)::int from app.ratings r where r.ratee_id = p.id) as rating_count,
      (select avg(r.stars)::float8 from app.ratings r where r.ratee_id = p.id) as rating_avg,
      (select count(*)::int from app.reliability_events e
        where e.user_id = p.id and e.kind = 'late_cancellation' and e.occurred_at > ${since}) as late_cancellations,
      (select count(*)::int from app.reliability_events e
        where e.user_id = p.id and e.kind = 'no_show' and e.occurred_at > ${since}) as no_shows
    from app.profiles p
    where p.id = ${userId}`;
  return rows[0];
}
