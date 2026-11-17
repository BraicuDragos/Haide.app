import type { Db } from '../../_shared/db.ts';
import type { LatLng } from '../../_shared/contracts/geo.ts';
import type { EventProps } from '../../_shared/domain/events.ts';
import { MAX_WALK_M, MIN_SEGMENT_M } from '../../_shared/domain/rules.ts';
import { selectPublicProfiles, type PublicProfileRow } from './ratingSummary.ts';

/**
 * SQL for search and matching (E3). Everything geometric happens in app.match_rides (ADR 0015):
 * this layer only passes parameters and reads rows. Parameters carry explicit casts (null and
 * typed values in a function call are otherwise untyped for postgres.js).
 */

/** One row of app.match_rides. Only grid centres and area names leave the database. */
export type MatchRow = {
  ride_id: string;
  driver_id: string;
  ride_status: string;
  departure_at: Date | string;
  duration_s: number;
  distance_m: number;
  seats_offered: number;
  seats_booked: number;
  is_free: boolean;
  rate_micro_per_km: number;
  segment_m: number;
  /** Exact metres: rounded to 50 m before they leave the API. */
  walk_pickup_m: number;
  walk_dropoff_m: number;
  pickup_eta_at: Date | string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  pickup_area: string | null;
  dropoff_area: string | null;
  blocked: boolean;
};

export type MatchArgs = {
  from: LatLng;
  to: LatLng;
  fromAt: Date;
  toAt: Date;
  desiredAt: Date;
  searcherId: string | null;
  now: Date;
  /** Single-ride re-check: ignores window, status, seats and ownership, returns the ride's state. */
  rideId?: string | null;
  /** Return blocked pairs flagged `blocked` instead of dropping them. */
  includeBlocked?: boolean;
  /** Drop rides departing inside [excludeFrom, excludeTo] (the "nearest outside the window" query). */
  excludeFrom?: Date | null;
  excludeTo?: Date | null;
  limit: number;
};

export async function matchRides(sql: Db, a: MatchArgs): Promise<MatchRow[]> {
  return await sql<MatchRow[]>`
    select m.ride_id, m.driver_id, m.ride_status, m.departure_at, m.duration_s, m.distance_m,
           m.seats_offered, m.seats_booked, m.is_free, m.rate_micro_per_km, m.segment_m,
           m.walk_pickup_m, m.walk_dropoff_m, m.pickup_eta_at, m.pickup_lat, m.pickup_lng,
           m.dropoff_lat, m.dropoff_lng, m.pickup_area, m.dropoff_area, m.blocked
    from app.match_rides(
      ST_SetSRID(ST_MakePoint(${a.from.lng}::float8, ${a.from.lat}::float8), 4326),
      ST_SetSRID(ST_MakePoint(${a.to.lng}::float8, ${a.to.lat}::float8), 4326),
      ${a.fromAt}::timestamptz, ${a.toAt}::timestamptz, ${a.desiredAt}::timestamptz,
      ${a.searcherId}::uuid, ${a.now}::timestamptz, ${a.rideId ?? null}::uuid,
      ${a.includeBlocked ?? false}::boolean,
      ${a.excludeFrom ?? null}::timestamptz, ${a.excludeTo ?? null}::timestamptz,
      ${MAX_WALK_M}::integer, ${MIN_SEGMENT_M}::integer, ${a.limit}::integer
    ) m`;
}

/**
 * Public profiles of several drivers in one round trip (never phone or plate). `ids` must not be
 * empty. The query is shared with every other profile read (ratingSummary.ts).
 */
export async function getPublicProfiles(
  sql: Db,
  ids: readonly string[],
  since: Date,
  now: Date,
): Promise<PublicProfileRow[]> {
  return await selectPublicProfiles(sql, ids, since, now);
}

export type SearchEventProps = EventProps['search_performed'];

/** Analytics `search_performed`: a count, area labels and the corridor. Never coordinates. */
export async function insertSearchPerformedEvent(
  sql: Db,
  userId: string | null,
  props: SearchEventProps,
  at: Date,
): Promise<void> {
  await sql`
    insert into app.analytics_events (name, user_id, props, occurred_at)
    values ('search_performed', ${userId}::uuid, ${JSON.stringify(props)}::text::jsonb, ${at}::timestamptz)`;
}
