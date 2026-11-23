import type {
  BookingListResponse,
  BookingView,
  CreateBookingBody,
  SummaryResponse,
} from '../../_shared/contracts/bookings.ts';
import type { RideOwnerView } from '../../_shared/contracts/rides.ts';
import { asDb, type Db } from '../../_shared/db.ts';
import {
  assertCanApprove,
  assertCanPassengerCancel,
  assertCanReject,
  assertCanRequest,
  bookingCancelledEvent,
  bookingCancelledOutbox,
  bookingConfirmedEvent,
  bookingConfirmedOutbox,
  bookingRejectedEvent,
  bookingRejectedOutbox,
  bookingRequestedEvent,
  bookingRequestedOutbox,
  relockConfirmed,
  responseSeconds,
} from '../../_shared/domain/bookings.ts';
import {
  bookingAutoConfirmedOutbox,
  isAutoAcceptEligible,
} from '../../_shared/domain/autoAccept.ts';
import { quoteUpTo } from '../../_shared/domain/pricing.ts';
import { RELIABILITY_WINDOW_DAYS } from '../../_shared/domain/rules.ts';
import { roundPoint } from '../../_shared/domain/privacy.ts';
import { assertInCoverage } from '../../_shared/domain/search.ts';
import { bookingExpiresAt } from '../../_shared/domain/time.ts';
import { AppError } from '../../_shared/errors.ts';
import {
  adjustSeatsBooked,
  cancelBookingByPassenger,
  findBookingByKey,
  hasActiveOrRejected,
  hasBlockBetween,
  insertBooking,
  insertLateCancelEventForBooking,
  listCancelledBookings,
  listPastBookings,
  listUpcomingBookings,
  lockRide,
  lockRideOfBookingForDriver,
  lockRideOfBookingForPassenger,
  markSeen,
  matchOneRide,
  rejectBooking,
  selectBookingState,
  selectBookingView,
  selectConfirmed,
  selectNextRide,
  selectSummaryCounts,
  updateLock,
  type BookingState,
  type LockedRide,
} from '../repo/bookings.ts';
import { insertAnalyticsEvents, insertOutboxRows } from '../repo/outbox.ts';
import { selectPublicProfiles } from '../repo/ratingSummary.ts';
import { pickupEta, toBookingListItem, toBookingView } from '../serializers/bookings.ts';
import type { Account, Deps } from '../types.ts';
import { confirmLocked } from './bookingConfirm.ts';
import { loadOwnerView } from './ownerView.ts';
import { publicUsersById } from './profiles.ts';
import { decodeCursor, encodeCursor, notFound as rideNotFound } from './rides.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bookingNotFound = () => new AppError('NOT_FOUND', 'Booking not found.');

/** Ids that are not UUIDs are simply unknown (404), never a validation error. */
export function asBookingId(id: string): string {
  if (!UUID_RE.test(id)) throw bookingNotFound();
  return id.toLowerCase();
}

/**
 * Maps the database backstops to API errors (ADR 0021): the seats CHECK is RIDE_FULL, the
 * one-active-booking index is ALREADY_REQUESTED, the per-passenger key index is a reused key.
 * Anything else is rethrown untouched.
 */
export function mapBookingDbError(e: unknown): never {
  const err = e as { code?: string; constraint_name?: string } | null;
  if (err?.code === '23514' && err.constraint_name === 'rides_seats_booked_range') {
    throw new AppError('RIDE_FULL', 'This ride is full.');
  }
  if (err?.code === '23505' && err.constraint_name === 'bookings_one_active_uidx') {
    throw new AppError('ALREADY_REQUESTED', 'You already asked for a seat on this ride.');
  }
  if (err?.code === '23505' && err.constraint_name === 'bookings_idempotency_uniq') {
    throw reusedKey();
  }
  // Two ratings from the same rater in parallel: the unique key is the backstop (E5).
  if (err?.code === '23505' && err.constraint_name === 'ratings_booking_id_rater_id_key') {
    throw new AppError('ALREADY_RATED', 'You have already rated this ride.');
  }
  throw e;
}

const reusedKey = () =>
  new AppError('VALIDATION_FAILED', 'This Idempotency-Key was used for another request.', {
    fields: { idempotencyKey: 'reused' },
  });

export async function tx<T>(deps: Deps, fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return (await deps.sql.begin(async (txn) => {
      const db = asDb(txn);
      // ADR 0021: a slow transaction would hold the ride lock, so cap it (SET takes no bind parameters).
      await db`set local statement_timeout = '5s'`;
      return await fn(db);
    })) as T;
  } catch (e) {
    return mapBookingDbError(e);
  }
}

// ---- view ---------------------------------------------------------------------------------------------------

export async function loadBookingView(
  deps: Deps,
  db: Db,
  bookingId: string,
  viewerId: string,
): Promise<BookingView> {
  const row = await selectBookingView(db, bookingId);
  // Anyone but the passenger and the ride's driver gets exactly what a missing booking gets.
  if (!row || (viewerId !== row.passenger_id && viewerId !== row.driver_id)) {
    throw bookingNotFound();
  }
  const users = await publicUsersById(deps, db, [row.driver_id, row.passenger_id]);
  const driver = users.get(row.driver_id);
  const passenger = users.get(row.passenger_id);
  if (!driver || !passenger) throw bookingNotFound();
  return toBookingView(row, viewerId, { driver, passenger }, deps.clock);
}

// ---- POST /bookings ------------------------------------------------------------------------------------------

export async function createBooking(
  deps: Deps,
  account: Account,
  idempotencyKey: string,
  body: CreateBookingBody,
): Promise<BookingView> {
  const { clock } = deps;
  const from = roundPoint(body.from);
  const to = roundPoint(body.to);
  assertInCoverage(from, to);
  const rideId = body.rideId.toLowerCase();
  const now = clock.now();

  return await tx(deps, async (db) => {
    // The ride lock serialises every writer of this ride (ADR 0021): the replay check, the
    // guards and the insert below all see one consistent state.
    const ride = await lockRide(db, rideId);
    if (!ride) throw rideNotFound();

    const existing = await findBookingByKey(db, account.id, idempotencyKey);
    if (existing) {
      if (existing.ride_id !== rideId) throw reusedKey();
      // Same key and ride but other points is a different request, not a replay (api spec: 400).
      // Identical points map to identical route fractions (same geometry, same function).
      const again = await matchOneRide(db, { from, to, rideId, searcherId: account.id, now });
      // No row (driver suspended or deleted since): a genuine replay, answer the original booking.
      if (
        again &&
        (Math.abs(again.f_pickup - existing.pickup_fraction) > 1e-9 ||
          Math.abs(again.f_dropoff - existing.dropoff_fraction) > 1e-9)
      ) {
        throw reusedKey();
      }
      return await loadBookingView(deps, db, existing.id, account.id);
    }

    const departureAt = new Date(ride.departure_at);
    const blocked = await hasBlockBetween(db, account.id, ride.driver_id);
    const already = await hasActiveOrRejected(db, rideId, account.id);
    const match = await matchOneRide(db, { from, to, rideId, searcherId: account.id, now });

    assertCanRequest(
      {
        viewerId: account.id,
        driverId: ride.driver_id,
        driverActive: ride.driver_status === 'active',
        blocked,
        hasActiveOrRejected: already,
        ride: {
          status: ride.status,
          departureAt,
          seatsOffered: ride.seats_offered,
          seatsBooked: ride.seats_booked,
        },
        pointsMatch: match !== undefined,
      },
      clock,
    );
    if (!match) throw new AppError('NO_LONGER_MATCHES', 'This ride no longer fits your trip.');

    const expiresAt = bookingExpiresAt(now, departureAt);
    // Exactly 10 minutes before departure the cutoff has not passed yet, but nothing is left to answer.
    if (expiresAt.getTime() <= now.getTime()) {
      throw new AppError('RIDE_NOT_BOOKABLE', 'This ride is not open for requests.');
    }

    const created = await insertBooking(db, {
      rideId,
      passengerId: account.id,
      match,
      priceQuotedBani: quoteUpTo(match.segment_m, ride.rate_micro_per_km, ride.is_free),
      idempotencyKey,
      now,
      expiresAt,
    });

    // E8-3 (ADR 0037): after every guard and the insert, under the same ride lock, an eligible
    // requester of an auto-accept ride is confirmed by the routine approve uses.
    let auto = false;
    let driverFirstName: string | null = null;
    if (ride.auto_accept === true) {
      const since = new Date(now.getTime() - RELIABILITY_WINDOW_DAYS * 86_400_000);
      // The driver is read in the same query: the passenger's confirmation email names them.
      const profiles = await selectPublicProfiles(db, [account.id, ride.driver_id], since, now);
      const profile = profiles.find((p) => p.id === account.id);
      driverFirstName = profiles.find((p) => p.id === ride.driver_id)?.first_name ?? null;
      auto = isAutoAcceptEligible({
        ratingCount: profile?.rating_count ?? 0,
        ratingAvg: profile?.rating_avg ?? null,
      });
    }
    if (auto && !(await confirmLocked(db, ride, created.id, now, { auto: true }))) {
      throw new Error('auto-confirm of a fresh request matched no row');
    }

    await insertOutboxRows(db, [
      ...(auto
        ? [
            bookingAutoConfirmedOutbox(ride.driver_id, {
              bookingId: created.id,
              rideId,
              departureAt: departureAt.toISOString(),
              pickupArea: created.pickup_label,
              dropoffArea: created.dropoff_label,
            }),
            // The passenger was confirmed too: same payload as the driver's approve (item 7).
            bookingConfirmedOutbox(account.id, {
              bookingId: created.id,
              driverFirstName,
              departureAt: departureAt.toISOString(),
              pickupEtaAt: pickupEta(departureAt, ride.duration_s, match.f_pickup).toISOString(),
              pickupArea: created.pickup_label,
            }),
          ]
        : [
            bookingRequestedOutbox(ride.driver_id, {
              bookingId: created.id,
              rideId,
              passengerFirstName: account.firstName,
              departureAt: departureAt.toISOString(),
              pickupArea: created.pickup_label,
              dropoffArea: created.dropoff_label,
              expiresAt: expiresAt.toISOString(),
            }),
          ]),
    ]);
    await insertAnalyticsEvents(db, [
      bookingRequestedEvent(
        account.id,
        { bookingId: created.id, rideId, segmentM: match.segment_m },
        now,
      ),
      ...(auto
        ? [
            bookingConfirmedEvent(
              ride.driver_id,
              { bookingId: created.id, rideId, responseSeconds: 0, auto: true },
              now,
            ),
          ]
        : []),
    ]);
    return await loadBookingView(deps, db, created.id, account.id);
  });
}

// ---- GET /bookings/{id} -----------------------------------------------------------------------------------------

export async function getBooking(deps: Deps, account: Account, id: string): Promise<BookingView> {
  return await loadBookingView(deps, deps.sql, asBookingId(id), account.id);
}

// ---- GET /me/bookings ------------------------------------------------------------------------------------------------

export async function listMyBookings(
  deps: Deps,
  account: Account,
  query: { scope: 'upcoming' | 'past' | 'cancelled'; limit: number; cursor?: string | undefined },
): Promise<BookingListResponse> {
  const { sql, clock } = deps;
  const after = query.cursor ? decodeCursor(query.cursor) : null;
  const list = {
    upcoming: listUpcomingBookings,
    past: listPastBookings,
    cancelled: listCancelledBookings,
  }[query.scope];
  const rows = await list(sql, account.id, clock.now(), after, query.limit + 1);
  const page = rows.slice(0, query.limit);
  const users = await publicUsersById(
    deps,
    sql,
    page.map((r) => r.driver_id),
  );
  const last = page[page.length - 1];
  return {
    items: page.flatMap((r) => {
      const driver = users.get(r.driver_id);
      return driver ? [toBookingListItem(r, driver, clock)] : [];
    }),
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ departureAt: new Date(last.departure_at), id: last.id })
        : null,
  };
}

// ---- approve and reject (driver) ----------------------------------------------------------------------------------------

/** After lock: the booking row, or 404 when it vanished. */
async function stateOrThrow(db: Db, bookingId: string): Promise<BookingState> {
  const state = await selectBookingState(db, bookingId);
  if (!state) throw bookingNotFound();
  return state;
}

/** A guarded update matched no row: another writer won. Say why. */
async function lostRace(db: Db, bookingId: string): Promise<never> {
  const now = await selectBookingState(db, bookingId);
  if (now?.status === 'expired') throw new AppError('REQUEST_EXPIRED', 'This request has expired.');
  if (now?.status === 'requested') {
    // Still requested but past its expiry (the update checks expires_at > now).
    throw new AppError('REQUEST_EXPIRED', 'This request has expired.');
  }
  throw new AppError('INVALID_STATE', 'This request can no longer be answered.');
}

const rideGuardState = (r: LockedRide) => ({
  status: r.status,
  seatsOffered: r.seats_offered,
  seatsBooked: r.seats_booked,
});

export async function approveBooking(
  deps: Deps,
  account: Account,
  id: string,
): Promise<RideOwnerView> {
  const bookingId = asBookingId(id);
  const { clock } = deps;
  const now = clock.now();

  return await tx(deps, async (db) => {
    const ride = await lockRideOfBookingForDriver(db, bookingId, account.id);
    if (!ride) throw bookingNotFound();
    const state = await stateOrThrow(db, bookingId);
    const blocked = await hasBlockBetween(db, account.id, state.passenger_id);

    assertCanApprove(
      {
        booking: { status: state.status, expiresAt: new Date(state.expires_at) },
        ride: rideGuardState(ride),
        blocked,
      },
      clock,
    );

    // Confirm, seat +1 (23514 -> RIDE_FULL, the CHECK is the backstop) and relock everyone.
    if (!(await confirmLocked(db, ride, bookingId, now, { auto: false }))) {
      await lostRace(db, bookingId);
    }

    const departureAt = new Date(ride.departure_at);
    await insertOutboxRows(db, [
      bookingConfirmedOutbox(state.passenger_id, {
        bookingId,
        driverFirstName: account.firstName,
        departureAt: departureAt.toISOString(),
        pickupEtaAt: pickupEta(departureAt, ride.duration_s, state.pickup_fraction).toISOString(),
        pickupArea: state.pickup_label,
      }),
    ]);
    await insertAnalyticsEvents(db, [
      bookingConfirmedEvent(
        account.id,
        {
          bookingId,
          rideId: ride.id,
          responseSeconds: responseSeconds(new Date(state.requested_at), now),
          auto: false,
        },
        now,
      ),
    ]);
    return await loadOwnerView(deps, db, ride.id, account.id);
  });
}

export async function rejectBookingRequest(
  deps: Deps,
  account: Account,
  id: string,
): Promise<RideOwnerView> {
  const bookingId = asBookingId(id);
  const { clock } = deps;
  const now = clock.now();

  return await tx(deps, async (db) => {
    const ride = await lockRideOfBookingForDriver(db, bookingId, account.id);
    if (!ride) throw bookingNotFound();
    const state = await stateOrThrow(db, bookingId);

    assertCanReject(
      {
        booking: { status: state.status, expiresAt: new Date(state.expires_at) },
        ride: rideGuardState(ride),
      },
      clock,
    );

    if (!(await rejectBooking(db, bookingId, now))) await lostRace(db, bookingId);

    const departureAt = new Date(ride.departure_at);
    await insertOutboxRows(db, [
      bookingRejectedOutbox(state.passenger_id, {
        bookingId,
        driverFirstName: account.firstName,
        departureAt: departureAt.toISOString(),
      }),
    ]);
    await insertAnalyticsEvents(db, [
      bookingRejectedEvent(
        account.id,
        {
          bookingId,
          rideId: ride.id,
          responseSeconds: responseSeconds(new Date(state.requested_at), now),
        },
        now,
      ),
    ]);
    return await loadOwnerView(deps, db, ride.id, account.id);
  });
}

// ---- cancel (passenger) ---------------------------------------------------------------------------------------------------

export async function cancelBooking(
  deps: Deps,
  account: Account,
  id: string,
): Promise<BookingView> {
  const bookingId = asBookingId(id);
  const { clock } = deps;
  const now = clock.now();

  return await tx(deps, async (db) => {
    const ride = await lockRideOfBookingForPassenger(db, bookingId, account.id);
    if (!ride) throw bookingNotFound();
    const state = await stateOrThrow(db, bookingId);
    const departureAt = new Date(ride.departure_at);

    const { late } = assertCanPassengerCancel({ status: state.status, departureAt }, clock);
    const from = state.status as 'requested' | 'confirmed';

    if (!(await cancelBookingByPassenger(db, bookingId, from, late, now))) {
      throw new AppError('INVALID_STATE', 'This booking can no longer be cancelled.');
    }

    if (from === 'confirmed') {
      await adjustSeatsBooked(db, ride.id, -1, now);
      // n shrinks, so every price-per-seat grows: relock keeps the old (lower) lock. Never up.
      const confirmed = await selectConfirmed(db, ride.id);
      const relocked = relockConfirmed(
        confirmed.map((c) => ({
          id: c.id,
          segmentM: c.segment_m,
          quotedBani: c.price_quoted_bani,
          lockedBani: c.price_locked_bani,
        })),
        ride.rate_micro_per_km,
        ride.is_free,
      );
      for (const r of relocked) {
        const current = confirmed.find((c) => c.id === r.id);
        if (current && current.price_locked_bani !== r.lockedBani) {
          await updateLock(db, r.id, r.lockedBani, r.dropped, now);
        }
      }
      if (late) {
        await insertLateCancelEventForBooking(db, account.id, bookingId, ride.id, now);
      }
      // A withdrawn request is not emailed (ADR 0022); a cancelled confirmed seat is.
      await insertOutboxRows(db, [
        bookingCancelledOutbox(ride.driver_id, {
          bookingId,
          rideId: ride.id,
          passengerFirstName: account.firstName,
          departureAt: departureAt.toISOString(),
        }),
      ]);
    }

    await insertAnalyticsEvents(db, [
      bookingCancelledEvent(account.id, { bookingId, rideId: ride.id, by: 'passenger', late }, now),
    ]);
    return await loadBookingView(deps, db, bookingId, account.id);
  });
}

// ---- GET /me/summary and POST /me/summary/seen ------------------------------------------------------------------------------

export async function getSummary(deps: Deps, account: Account): Promise<SummaryResponse> {
  const now = deps.clock.now();
  const counts = await selectSummaryCounts(deps.sql, account.id, now);
  const next = await selectNextRide(deps.sql, account.id, now);
  return {
    driverPendingRequests: counts.driver_pending,
    passengerUnseenUpdates: counts.passenger_unseen,
    nextRide: next
      ? { kind: next.kind, id: next.id, departureAt: new Date(next.departure_at).toISOString() }
      : null,
  };
}

export async function markUpdatesSeen(
  deps: Deps,
  account: Account,
  bookingIds: readonly string[],
): Promise<void> {
  await markSeen(
    deps.sql,
    account.id,
    [...new Set(bookingIds.map((b) => b.toLowerCase()))],
    deps.clock.now(),
  );
}
