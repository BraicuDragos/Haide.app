import type { Db } from '../../_shared/db.ts';

/**
 * The one query behind every public rating summary (E5, e5-trust-safety-spec §3). Profiles, search
 * cards, request cards, booking views and the owner view all come through here, so they cannot
 * disagree. Blind ratings (ADR 0025): only ratings with `visible_at <= now` count, in the count and
 * in the average. `rides_completed` is completed bookings as a passenger plus completed rides as a
 * driver. Never selects phone or plate.
 */

export type PublicProfileRow = {
  id: string;
  first_name: string | null;
  bio: string | null;
  photo_path: string | null;
  status: 'active' | 'suspended' | 'deleted';
  created_at: Date | string;
  rating_count: number;
  rating_avg: number | null;
  rides_completed: number;
  late_cancellations: number;
  no_shows: number;
};

/**
 * Public profiles in one round trip, keyed by nothing: the caller maps them. `since` is the start of
 * the reliability window (90 days), `now` is the clock the visibility of ratings is judged by.
 * `ids` must not be empty.
 */
export async function selectPublicProfiles(
  sql: Db,
  ids: readonly string[],
  since: Date,
  now: Date,
): Promise<PublicProfileRow[]> {
  return await sql<PublicProfileRow[]>`
    select p.id, p.first_name, p.bio, p.photo_path, p.status, p.created_at,
      (select count(*)::int from app.reliability_events e
        where e.user_id = p.id and e.kind = 'late_cancellation' and e.occurred_at > ${since}) as late_cancellations,
      (select count(*)::int from app.reliability_events e
        where e.user_id = p.id and e.kind = 'no_show' and e.occurred_at > ${since}) as no_shows,
      (select count(*)::int from app.ratings r where r.ratee_id = p.id and r.visible_at <= ${now}) as rating_count,
      (select avg(r.stars)::float8 from app.ratings r where r.ratee_id = p.id and r.visible_at <= ${now}) as rating_avg,
      ((select count(*)::int from app.bookings b where b.passenger_id = p.id and b.status = 'completed')
       + (select count(*)::int from app.rides x where x.driver_id = p.id and x.status = 'completed')) as rides_completed
    from app.profiles p
    where p.id in ${sql([...ids])}`;
}
