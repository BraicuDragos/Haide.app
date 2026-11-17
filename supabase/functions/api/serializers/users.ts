import type { PublicUser } from '../../_shared/contracts/account.ts';
import { memberSince, ratingSummary } from '../../_shared/domain/account.ts';
import type { Env } from '../../_shared/env.ts';
import type { PublicProfileRow } from '../repo/accounts.ts';
import { avatarUrl } from '../services/storage.ts';

/**
 * Public profile shape (never phone, plate or surname). A deleted user is "Deleted user":
 * no name, photo or bio. Suspended users are filtered out by the caller (404).
 */
export function toPublicUser(row: PublicProfileRow, env: Env): PublicUser {
  const deleted = row.status === 'deleted';
  return {
    id: row.id,
    firstName: deleted ? null : row.first_name,
    photoUrl: deleted ? null : avatarUrl(env, row.photo_path),
    memberSince: memberSince(new Date(row.created_at)),
    // Ratings stay in the database for the counterpart, but a tombstone shows no summary (E6).
    rating: deleted ? null : ratingSummary(row.rating_count, row.rating_avg),
    // Completed bookings as a passenger plus completed rides as a driver (E5).
    ridesCompleted: Number(row.rides_completed ?? 0),
    lateCancellations90d: row.late_cancellations,
    noShows90d: row.no_shows,
    bio: deleted ? null : row.bio,
  };
}
