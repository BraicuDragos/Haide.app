import type {
  MatchBody,
  MatchResponse,
  SearchItem,
  SearchRequest,
  SearchResponse,
} from '../../_shared/contracts/search.ts';
import { classifyCorridor } from '../../_shared/domain/corridors.ts';
import { roundPoint } from '../../_shared/domain/privacy.ts';
import {
  NEAREST_OUTSIDE_MAX,
  RELIABILITY_WINDOW_DAYS,
  SEARCH_MAX_RESULTS,
} from '../../_shared/domain/rules.ts';
import {
  assertInCoverage,
  assertSearchPoints,
  notBookableReason,
  searchTimes,
} from '../../_shared/domain/search.ts';
import { hasActiveOrRejected } from '../repo/bookings.ts';
import { describePoint, selectPublicRide } from '../repo/rides.ts';
import {
  getPublicProfiles,
  insertSearchPerformedEvent,
  matchRides,
  type MatchRow,
} from '../repo/search.ts';
import { publicRideVisible } from '../serializers/rides.ts';
import { toMatchResponse, toSearchItem } from '../serializers/search.ts';
import { toPublicUser } from '../serializers/users.ts';
import type { Deps } from '../types.ts';
import { asRideId, notFound } from './rides.ts';

const DAY_MS = 86_400_000;

/**
 * Turns match rows into result cards: one profile query for all drivers, then the serializer
 * (grid points, rounded walks and ETAs, price from the ride's rate snapshot). A row whose driver
 * profile is gone is skipped.
 */
async function toItems(deps: Deps, rows: readonly MatchRow[]): Promise<SearchItem[]> {
  if (rows.length === 0) return [];
  const { sql, clock, env } = deps;
  const since = new Date(clock.now().getTime() - RELIABILITY_WINDOW_DAYS * DAY_MS);
  const ids = [...new Set(rows.map((r) => r.driver_id))];
  const profiles = new Map((await getPublicProfiles(sql, ids, since)).map((p) => [p.id, p]));
  const items: SearchItem[] = [];
  for (const row of rows) {
    const profile = profiles.get(row.driver_id);
    if (!profile || profile.status !== 'active') continue;
    items.push(toSearchItem(row, toPublicUser(profile, env)));
  }
  return items;
}

// ---- POST /search -----------------------------------------------------------------------------------

export async function searchRides(
  deps: Deps,
  viewerId: string | null,
  body: SearchRequest,
): Promise<SearchResponse> {
  const { sql, clock, log } = deps;
  const from = roundPoint(body.from);
  const to = roundPoint(body.to);
  assertSearchPoints(from, to);
  const times = searchTimes(body.date, body.time, body.windowMin, clock);
  const now = clock.now();
  const base = { from, to, desiredAt: times.desiredAt, searcherId: viewerId, now };

  // Blocked pairs come back flagged: they are hidden and counted ("N hidden").
  const inWindow = await matchRides(sql, {
    ...base,
    fromAt: times.fromAt,
    toAt: times.toAt,
    includeBlocked: true,
    limit: SEARCH_MAX_RESULTS,
  });
  const hiddenBlockedCount = inWindow.filter((r) => r.blocked).length;
  const shown = inWindow.filter((r) => !r.blocked);

  // Empty state: the nearest rides the same day, outside the requested window (E3-5).
  let nearestRows: MatchRow[] = [];
  if (shown.length === 0) {
    const sameDay = await matchRides(sql, {
      ...base,
      fromAt: times.dayStartAt,
      toAt: times.dayEndAt,
      excludeFrom: times.fromAt,
      excludeTo: times.toAt,
      includeBlocked: false,
      limit: SEARCH_MAX_RESULTS,
    });
    const gap = (r: MatchRow) =>
      Math.abs(new Date(r.departure_at).getTime() - times.desiredAt.getTime());
    nearestRows = [...sameDay]
      .sort(
        (a, b) =>
          gap(a) - gap(b) ||
          a.walk_pickup_m + a.walk_dropoff_m - b.walk_pickup_m - b.walk_dropoff_m,
      )
      .slice(0, NEAREST_OUTSIDE_MAX);
  }

  const items = await toItems(deps, shown);
  const nearestOutsideWindow = await toItems(deps, nearestRows);

  // Analytics never fails a search. Area labels and counts only, never coordinates.
  try {
    const [fromInfo, toInfo] = await Promise.all([
      describePoint(sql, from),
      describePoint(sql, to),
    ]);
    await insertSearchPerformedEvent(
      sql,
      viewerId,
      {
        resultsCount: items.length,
        fromArea: fromInfo.area_name,
        toArea: toInfo.area_name,
        windowMin: body.windowMin,
        corridor: classifyCorridor(fromInfo.area_name, toInfo.area_name),
      },
      now,
    );
  } catch (e) {
    log('warn', 'search_event_failed', { name: e instanceof Error ? e.name : 'unknown' });
  }

  return { items, nearestOutsideWindow, hiddenBlockedCount };
}

// ---- POST /rides/{id}/match -----------------------------------------------------------------------------

/**
 * Passenger-specific view of one ride (detail page, request sheet). The ride must be visible to the
 * viewer (404 otherwise, blocked either way included). It then re-runs app.match_rides for that
 * single ride with the typed points and names the reason when the seat cannot be requested.
 */
export async function matchRide(
  deps: Deps,
  viewerId: string | null,
  id: string,
  body: MatchBody,
): Promise<MatchResponse> {
  const { sql, clock } = deps;
  const rideId = asRideId(id);
  const ride = await selectPublicRide(sql, rideId, viewerId);
  if (!ride || !publicRideVisible(ride, viewerId)) throw notFound();

  const from = roundPoint(body.from);
  const to = roundPoint(body.to);
  assertInCoverage(from, to);
  const departureAt = new Date(ride.departure_at);
  const now = clock.now();
  const rows = await matchRides(sql, {
    from,
    to,
    fromAt: departureAt,
    toAt: departureAt,
    desiredAt: departureAt,
    searcherId: viewerId,
    now,
    rideId,
    includeBlocked: true,
    limit: 1,
  });
  const row = rows[0] ?? null;
  if (row?.blocked) throw notFound();

  // An active or rejected booking of the viewer blocks a new request (a declined passenger cannot re-ask).
  const alreadyRequested = viewerId !== null && (await hasActiveOrRejected(sql, rideId, viewerId));
  const reason = notBookableReason(
    {
      driverId: ride.driver_id,
      status: ride.status,
      departureAt,
      seatsOffered: ride.seats_offered,
      seatsBooked: ride.seats_booked,
    },
    viewerId,
    clock,
    row !== null,
    alreadyRequested,
  );
  return toMatchResponse(row, Math.max(0, ride.seats_offered - ride.seats_booked), reason);
}
