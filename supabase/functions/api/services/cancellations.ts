import type { Db } from '../../_shared/db.ts';
import {
  bookingCancelledEvent,
  bookingCancelledOutbox,
  bookingRejectedOutbox,
  relockConfirmed,
  rideCancelledRows,
} from '../../_shared/domain/bookings.ts';
import {
  adjustSeatsBooked,
  cancelBookingBySystem,
  cancelRideBookings,
  lockRideOfBooking,
  selectBookingState,
  selectConfirmed,
  updateLock,
  type LockedRide,
} from '../repo/bookings.ts';
import { insertAnalyticsEvents, insertOutboxRows } from '../repo/outbox.ts';
import { insertLateCancelEvent, markRideCancelled } from '../repo/rides.ts';
import { selectFirstName } from '../repo/safety.ts';

/**
 * Cancellations that do not come from the passenger's own request (E5, spec §4, ADR 0027, 0028).
 * Both functions run inside the caller's transaction, which already holds (or takes) the ride lock.
 * A system cancellation is never a late cancellation and never writes a reliability event.
 */

export type RideToCancel = {
  id: string;
  driverId: string;
  driverFirstName: string | null;
  departureAt: Date;
};

/**
 * Cancels a published ride and every requested or confirmed booking on it, tells each passenger
 * (their own areas) and returns the number of bookings cancelled. `by = 'driver'` is the E2 endpoint
 * (`late` marks a cancel within 30 minutes of departure, with its reliability event). `by = 'system'`
 * is the sweep for a suspended driver: never late, and the email uses the neutral wording.
 * The caller holds the ride lock and has checked that the ride may be cancelled.
 */
export async function cancelRideTx(
  tx: Db,
  ride: RideToCancel,
  now: Date,
  by: 'driver' | 'system',
  late: boolean,
): Promise<number> {
  const isLate = by === 'driver' && late;
  await markRideCancelled(tx, ride.id, now, isLate, by);
  if (isLate) await insertLateCancelEvent(tx, ride.driverId, ride.id, now);

  // Every requested or confirmed booking is cancelled, each passenger is told (an outbox row per
  // booking with their own areas) and the seat counter returns to 0.
  const cancelled = await cancelRideBookings(tx, ride.id, now, by);
  if (cancelled.length > 0) {
    await insertOutboxRows(
      tx,
      rideCancelledRows(
        cancelled.map((b) => ({
          passengerId: b.passenger_id,
          payload: {
            bookingId: b.id,
            rideId: ride.id,
            driverFirstName: ride.driverFirstName,
            departureAt: ride.departureAt.toISOString(),
            pickupArea: b.pickup_label,
            dropoffArea: b.dropoff_label,
            ...(by === 'system' ? { by } : {}),
          },
        })),
      ),
    );
    await insertAnalyticsEvents(
      tx,
      cancelled.map((b) =>
        bookingCancelledEvent(
          ride.driverId,
          { bookingId: b.id, rideId: ride.id, by, late: isLate },
          now,
        ),
      ),
    );
  }
  return cancelled.length;
}

export type SystemCancelReason =
  'blocked_by_passenger' | 'blocked_by_driver' | 'suspended_passenger' | 'account_deleted'; // E6: the passenger deleted the account (the driver is told, nothing about why)

/** n shrinks, so every price per seat grows: relock keeps the old (lower) lock. Never up. */
async function relockAfterCancel(db: Db, ride: LockedRide, now: Date): Promise<void> {
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
}

/**
 * Cancels one requested or confirmed booking for a system reason (a block between the pair, a
 * suspended passenger or a deleted account). Locks the ride first, re-reads the booking and does nothing (returns false)
 * when it is no longer active or the ride has already departed. A confirmed booking gives its seat
 * back. Who is told:
 * - `blocked_by_driver`: the passenger gets `booking_rejected` (and sees the update).
 * - `blocked_by_passenger`, `suspended_passenger`, `account_deleted`: the driver gets `booking_cancelled`
 *   (confirmed only).
 */
export async function systemCancelBookingTx(
  tx: Db,
  bookingId: string,
  now: Date,
  reason: SystemCancelReason,
): Promise<boolean> {
  const ride = await lockRideOfBooking(tx, bookingId);
  if (!ride) return false;
  const state = await selectBookingState(tx, bookingId);
  if (!state || (state.status !== 'requested' && state.status !== 'confirmed')) return false;
  const departureAt = new Date(ride.departure_at);
  if (departureAt.getTime() <= now.getTime()) return false;

  const from = state.status;
  const notifyPassenger = reason === 'blocked_by_driver';
  if (!(await cancelBookingBySystem(tx, bookingId, from, notifyPassenger, now))) return false;

  if (from === 'confirmed') {
    await adjustSeatsBooked(tx, ride.id, -1, now);
    await relockAfterCancel(tx, ride, now);
  }

  if (notifyPassenger) {
    await insertOutboxRows(tx, [
      bookingRejectedOutbox(state.passenger_id, {
        bookingId,
        driverFirstName: await selectFirstName(tx, ride.driver_id),
        departureAt: departureAt.toISOString(),
      }),
    ]);
  } else if (from === 'confirmed') {
    await insertOutboxRows(tx, [
      bookingCancelledOutbox(ride.driver_id, {
        bookingId,
        rideId: ride.id,
        passengerFirstName: state.passenger_first_name,
        departureAt: departureAt.toISOString(),
      }),
    ]);
  }
  await insertAnalyticsEvents(tx, [
    bookingCancelledEvent(
      notifyPassenger ? ride.driver_id : state.passenger_id,
      { bookingId, rideId: ride.id, by: 'system', late: false },
      now,
    ),
  ]);
  return true;
}
