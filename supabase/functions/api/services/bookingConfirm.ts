import type { Db } from '../../_shared/db.ts';
import { relockConfirmed } from '../../_shared/domain/bookings.ts';
import {
  adjustSeatsBooked,
  confirmBooking,
  selectConfirmed,
  updateLock,
  type LockedRide,
} from '../repo/bookings.ts';

/**
 * The confirm routine shared by approve (E4) and auto-accept (E8-3, ADR 0037). The caller holds the
 * ride lock. Guarded requested -> confirmed, seat +1 (the CHECK `rides_seats_booked_range` is the
 * RIDE_FULL backstop, mapped by the caller's transaction wrapper), then every confirmed passenger's
 * price is relocked: a lock only ever goes down. Returns false when the guarded update matched no row
 * (another writer won the race); the caller says why.
 */
export async function confirmLocked(
  db: Db,
  ride: LockedRide,
  bookingId: string,
  now: Date,
  opts: { auto: boolean },
): Promise<boolean> {
  if (!(await confirmBooking(db, bookingId, now, opts.auto))) return false;
  await adjustSeatsBooked(db, ride.id, 1, now);

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
      // The confirmed booking is already flagged; every other passenger whose price dropped gets a badge.
      await updateLock(db, r.id, r.lockedBani, r.dropped && r.id !== bookingId, now);
    }
  }
  return true;
}
