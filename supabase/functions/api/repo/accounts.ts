import { asDb, type Db } from '../../_shared/db.ts';
import type { VehicleResponse } from '../../_shared/contracts/account.ts';
import {
  needsReaccept,
  requiredConsents,
  type AcceptedConsent,
  type CurrentLegal,
} from '../../_shared/domain/account.ts';
import type { Account } from '../types.ts';
import { selectPublicProfiles, type PublicProfileRow } from './ratingSummary.ts';

type LegalRow = {
  kind: 'terms' | 'privacy';
  version: string;
  url: string;
  published_at?: Date | string;
};

/** Current version per kind: the latest `published_at <= now()` (data-model 4.1). */
export async function currentLegal(
  sql: Db,
  at: Date,
): Promise<{
  versions: CurrentLegal;
  urls: { terms: string; privacy: string };
  /** When each current version was published (E6). */
  publishedAt: { terms: Date | string | undefined; privacy: Date | string | undefined };
}> {
  const rows = await sql<LegalRow[]>`
    select distinct on (kind) kind, version, url, published_at
    from app.legal_documents
    where published_at <= ${at}
    order by kind, published_at desc`;
  const terms = rows.find((r) => r.kind === 'terms');
  const privacy = rows.find((r) => r.kind === 'privacy');
  if (!terms || !privacy) throw new Error('legal_documents is missing a current version');
  return {
    versions: { terms: terms.version, privacy: privacy.version },
    urls: { terms: terms.url, privacy: privacy.url },
    publishedAt: { terms: terms.published_at, privacy: privacy.published_at },
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
    consentReaccept: needsReaccept(legal.versions, accepted),
  };
}

/**
 * Writes the consent rows in one statement: terms, privacy and (first acceptance only) age_18. Someone
 * who accepts updated terms already has an age_18 row, so `withAge18` is false (E6).
 */
export async function recordConsents(
  sql: Db,
  userId: string,
  versions: CurrentLegal,
  withAge18 = true,
): Promise<void> {
  if (!withAge18) {
    await sql`
      insert into app.consents (user_id, kind, document_version)
      values (${userId}, 'terms', ${versions.terms}),
             (${userId}, 'privacy', ${versions.privacy})`;
    return;
  }
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

/**
 * Partial update: omitted fields keep their value. `bio: null` clears it. Never writes onto a
 * deleted account's tombstone (a request that passed the gate just before DELETE /me committed):
 * returns false then.
 */
export async function updateProfile(
  sql: Db,
  userId: string,
  v: ProfilePatchValues,
): Promise<boolean> {
  const bioProvided = v.bio !== undefined;
  const rows = await sql`
    update app.profiles set
      first_name = coalesce(${v.firstName ?? null}::text, first_name),
      phone_e164 = coalesce(${v.phone ?? null}::text, phone_e164),
      bio = case when ${bioProvided}::boolean then ${v.bio ?? null}::text else bio end,
      updated_at = now()
    where id = ${userId} and status <> 'deleted'
    returning id`;
  return rows.length > 0;
}

/**
 * Stores the new photo path and returns the previous one (`{ previous: null }` when there was
 * none). Returns null, writing nothing, when the account is deleted.
 */
export async function setPhotoPath(
  sql: Db,
  userId: string,
  path: string,
): Promise<{ previous: string | null } | null> {
  const rows = await sql<{ previous: string | null }[]>`
    update app.profiles p set photo_path = ${path}, updated_at = now()
    from (select photo_path from app.profiles where id = ${userId} for update) old
    where p.id = ${userId} and p.status <> 'deleted'
    returning old.photo_path as previous`;
  return rows[0] ? { previous: rows[0].previous ?? null } : null;
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

/**
 * One vehicle per user: create or replace. Published rides keep their own snapshot. Returns null,
 * writing nothing, when the account is deleted.
 */
export async function upsertVehicle(
  sql: Db,
  ownerId: string,
  v: VehicleResponse,
): Promise<VehicleResponse | null> {
  // Share-lock the profile first (the lockLiveDriver pattern): DELETE /me's scrub takes
  // `for no key update`, so a vehicle row cannot appear after the scrub.
  return await sql.begin(async (txn) => {
    const tx = asDb(txn);
    const live = await tx`
      select 1 from app.profiles where id = ${ownerId} and status <> 'deleted' for share`;
    if (live.length === 0) return null;
    const rows = await tx<VehicleRow[]>`
      insert into app.vehicles (owner_id, make, model, colour, plate, fuel_type, seats)
      values (${ownerId}, ${v.make}, ${v.model}, ${v.colour}, ${v.plate}, ${v.fuelType}, ${v.seats})
      on conflict (owner_id) do update set
        make = excluded.make, model = excluded.model, colour = excluded.colour,
        plate = excluded.plate, fuel_type = excluded.fuel_type, seats = excluded.seats,
        updated_at = now()
      returning make, model, colour, plate, fuel_type, seats`;
    return rows[0] ? toVehicle(rows[0]) : null;
  });
}

export type { PublicProfileRow } from './ratingSummary.ts';

/**
 * One public profile (never phone or plate). `since` starts the 90-day reliability window; `now`
 * judges which ratings are visible (blind ratings, ADR 0025). The query lives in ratingSummary.ts.
 */
export async function getPublicProfile(
  sql: Db,
  userId: string,
  since: Date,
  now: Date,
): Promise<PublicProfileRow | undefined> {
  return (await selectPublicProfiles(sql, [userId], since, now))[0];
}
