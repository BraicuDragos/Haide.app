import type { Db } from '../../_shared/db.ts';
import { AppError } from '../../_shared/errors.ts';
import { lockRide } from '../repo/bookings.ts';
import {
  lockProfile,
  scrubAccount,
  selectActivePassengerBookings,
  selectFutureDriverRides,
} from '../repo/privacy.ts';
import type { Account, Deps } from '../types.ts';
import { tx } from './bookings.ts';
import { cancelRideTx, systemCancelBookingTx } from './cancellations.ts';
import { purgeAccount } from './accountPurge.ts';

/**
 * DELETE /me (E6-1, e6-privacy-spec §2, ADR 0029).
 *
 * One transaction: lock the profile, cancel every future ride (by the system) and every active
 * booking of the user on a ride that has not departed, then app.scrub_account. Everything is committed
 * or nothing is. The avatar object and the auth user are removed after the commit (and retried by the
 * tick). A second call, from a double tap or another device, waits on the profile lock, finds the
 * profile already `deleted` and does nothing, so the answer is 204 both times.
 */

const isDeadlock = (e: unknown): boolean => (e as { code?: string } | null)?.code === '40P01';

/** The deletion transaction. Reads every name it needs before app.scrub_account blanks them. */
async function deletionTx(db: Db, userId: string, now: Date): Promise<void> {
  const profile = await lockProfile(db, userId);
  if (!profile || profile.status === 'deleted') return;

  // 1. Future rides of the driver: every passenger is told, by the system (neutral wording).
  for (const { id } of await selectFutureDriverRides(db, userId, now)) {
    const ride = await lockRide(db, id);
    if (
      !ride ||
      ride.status !== 'published' ||
      new Date(ride.departure_at).getTime() <= now.getTime()
    ) {
      continue;
    }
    await cancelRideTx(
      db,
      {
        id,
        driverId: userId,
        driverFirstName: profile.first_name,
        departureAt: new Date(ride.departure_at),
      },
      now,
      'system',
      false,
    );
  }

  // 2. The user's own seats on rides that have not departed (the driver hears about confirmed ones).
  for (const { id } of await selectActivePassengerBookings(db, userId, now)) {
    await systemCancelBookingTx(db, id, now, 'account_deleted');
  }

  // 3. Tombstone, vehicle, coarsening, blocks, share links, pending mail, analytics user ids.
  await scrubAccount(db, userId, now);
}

export async function deleteAccount(deps: Deps, account: Account): Promise<void> {
  const now = deps.clock.now();
  let lastError: unknown;
  // A deadlock (SQLSTATE 40P01) means we lost a lock race: retry once, then ask the client to retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await tx(deps, (db) => deletionTx(db, account.id, now));
      lastError = undefined;
      break;
    } catch (e) {
      if (!isDeadlock(e)) throw e;
      lastError = e;
    }
  }
  if (lastError) {
    throw new AppError('TEMPORARILY_UNAVAILABLE', 'Could not delete the account. Try again.');
  }

  // Committed. Outside systems next; a failure here never fails the response (the tick retries).
  try {
    await purgeAccount(deps, account.id);
  } catch (e) {
    deps.log('warn', 'account_purge_failed', { name: e instanceof Error ? e.name : 'unknown' });
  }
}
