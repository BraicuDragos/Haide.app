import type { PublicUser } from '../../_shared/contracts/account.ts';
import type { Db } from '../../_shared/db.ts';
import { RELIABILITY_WINDOW_DAYS } from '../../_shared/domain/rules.ts';
import { getPublicProfiles } from '../repo/search.ts';
import { toPublicUser } from '../serializers/users.ts';
import type { Deps } from '../types.ts';

const DAY_MS = 86_400_000;

/**
 * Public profiles (never phone, plate or surname) of several users in one round trip, keyed by id.
 * An id without a profile row is simply absent from the map.
 */
export async function publicUsersById(
  deps: Deps,
  db: Db,
  ids: readonly string[],
): Promise<Map<string, PublicUser>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, PublicUser>();
  if (unique.length === 0) return out;
  const since = new Date(deps.clock.now().getTime() - RELIABILITY_WINDOW_DAYS * DAY_MS);
  for (const p of await getPublicProfiles(db, unique, since)) {
    out.set(p.id, toPublicUser(p, deps.env));
  }
  return out;
}
