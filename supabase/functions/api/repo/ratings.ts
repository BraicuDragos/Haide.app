import type { Db } from '../../_shared/db.ts';
import type { BookingStatus } from '../../_shared/contracts/rides.ts';

/**
 * SQL for ratings (E5, e5-trust-safety-spec §3, ADR 0025). Ratings are blind: a row is stored with a
 * `visible_at` and only counts once that time has passed. Stars and tags are immutable.
 */

type Ts = Date | string;

export type RatingContext = {
  id: string;
  status: BookingStatus;
  passenger_id: string;
  driver_id: string;
  ride_id: string;
  /** The ride's completion time. */
  completed_at: Ts | null;
  rated_by_passenger: boolean;
  rated_by_driver: boolean;
};

/**
 * The booking with its ride, locked (`for update of b`) so a no-show written in parallel and a
 * counter-rating written in parallel serialise with us. Call AFTER the ride lock.
 */
export async function selectRatingContext(
  sql: Db,
  bookingId: string,
): Promise<RatingContext | undefined> {
  const rows = await sql<RatingContext[]>`
    select b.id, b.status, b.passenger_id, r.driver_id, r.id as ride_id, r.completed_at,
           exists (select 1 from app.ratings x where x.booking_id = b.id and x.rater_id = b.passenger_id) as rated_by_passenger,
           exists (select 1 from app.ratings x where x.booking_id = b.id and x.rater_id = r.driver_id) as rated_by_driver
    from app.bookings b
    join app.rides r on r.id = b.ride_id
    where b.id = ${bookingId}
    for update of b`;
  return rows[0];
}

export type NewRating = {
  bookingId: string;
  raterId: string;
  rateeId: string;
  stars: number;
  tags: readonly string[];
  visibleAt: Date;
  now: Date;
};

export type RatingRow = { stars: number; tags: string[]; created_at: Ts };

/** A second rating by the same rater violates ratings_booking_id_rater_id_key (23505). */
export async function insertRating(sql: Db, v: NewRating): Promise<RatingRow> {
  const rows = await sql<RatingRow[]>`
    insert into app.ratings (booking_id, rater_id, ratee_id, stars, tags, visible_at, created_at)
    values (${v.bookingId}, ${v.raterId}, ${v.rateeId}, ${v.stars}::smallint,
            array(select jsonb_array_elements_text(${JSON.stringify(v.tags)}::text::jsonb)),
            ${v.visibleAt}::timestamptz, ${v.now}::timestamptz)
    returning stars, tags, created_at`;
  const row = rows[0];
  if (!row) throw new Error('rating insert returned no row');
  return row;
}

/** Both ratings become visible together: the earlier `visible_at` wins. */
export async function pullVisibleAt(
  sql: Db,
  bookingId: string,
  raterId: string,
  now: Date,
): Promise<void> {
  await sql`
    update app.ratings set visible_at = least(visible_at, ${now}::timestamptz)
    where booking_id = ${bookingId} and rater_id = ${raterId}`;
}
