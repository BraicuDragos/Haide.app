import type { BookingView } from '../../_shared/contracts/bookings.ts';
import type { RideOwnerView } from '../../_shared/contracts/rides.ts';
import type {
  BlockBody,
  BlocksResponse,
  CreateReportBody,
  ReportResponse,
} from '../../_shared/contracts/safety.ts';
import { REPORT_DETAILS_MAX } from '../../_shared/contracts/safety.ts';
import { asDb, type Db } from '../../_shared/db.ts';
import type { OutboxRow } from '../../_shared/domain/outbox.ts';
import {
  assertCanMarkNoShow,
  noShowReportedEvent,
  noShowReportedOutbox,
  rideCompletedEvent,
  ratingPromptDriverOutbox,
  ratingPromptOutbox,
  reportReceivedOutbox,
  reportSubmittedEvent,
} from '../../_shared/domain/safety.ts';
import { COMPLETE_AFTER_H, COMPLETE_BATCH, SWEEP_BATCH } from '../../_shared/domain/rules.ts';
import { AppError } from '../../_shared/errors.ts';
import { lockRide, lockRideOfBookingForParty } from '../repo/bookings.ts';
import { insertAnalyticsEvents, insertOutboxRows } from '../repo/outbox.ts';
import {
  deleteBlock,
  insertBlock,
  insertNoShowEvent,
  insertReport,
  isRideParty,
  listBlocks,
  markNoShow,
  profileExists,
  selectActiveAdminIds,
  selectBookingParties,
  selectFirstName,
  selectNoShowContext,
  selectPairBookings,
} from '../repo/safety.ts';
import {
  completeRides,
  selectBlockedPairBookings,
  selectSuspendedDriverRides,
  selectSuspendedPassengerBookings,
} from '../repo/sweep.ts';
import type { Account, Deps } from '../types.ts';
import { asBookingId, loadBookingView, tx } from './bookings.ts';
import { cancelRideTx, systemCancelBookingTx } from './cancellations.ts';
import { loadOwnerView } from './ownerView.ts';
import { publicUsersById } from './profiles.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCKS_MAX = 200;
const HOUR_MS = 3_600_000;

const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found.`);

// ---- POST /bookings/{id}/no-show ---------------------------------------------------------------------------------

/**
 * A party reports that the other one did not show. The driver gets the owner ride view back, the
 * passenger the booking view. Order of locks: ride, then booking (so a rating in parallel waits and
 * then sees `no_show`), then a guarded update. One reliability event goes to the absent party.
 */
export async function reportNoShow(
  deps: Deps,
  account: Account,
  id: string,
): Promise<RideOwnerView | BookingView> {
  const bookingId = asBookingId(id);
  const { clock } = deps;
  const now = clock.now();

  return await tx(deps, async (db) => {
    const ride = await lockRideOfBookingForParty(db, bookingId, account.id);
    if (!ride) throw notFound('Booking');
    const ctx = await selectNoShowContext(db, bookingId);
    if (!ctx) throw notFound('Booking');
    const by = account.id === ctx.driver_id ? 'driver' : 'passenger';

    assertCanMarkNoShow(
      { status: ctx.status, departureAt: new Date(ctx.departure_at), hasRating: ctx.rated },
      clock,
    );
    if (!(await markNoShow(db, bookingId, by, now))) {
      throw new AppError('INVALID_STATE', 'This booking can no longer be marked as a no-show.');
    }

    const absentId = by === 'driver' ? ctx.passenger_id : ctx.driver_id;
    await insertNoShowEvent(db, absentId, bookingId, ctx.ride_id, now);
    await insertOutboxRows(db, [
      noShowReportedOutbox(absentId, {
        bookingId,
        rideId: ctx.ride_id,
        reporterFirstName: account.firstName,
        reporterRole: by,
        departureAt: new Date(ctx.departure_at).toISOString(),
      }),
    ]);
    await insertAnalyticsEvents(db, [
      noShowReportedEvent(account.id, { bookingId, rideId: ctx.ride_id, by }, now),
    ]);
    return by === 'driver'
      ? await loadOwnerView(deps, db, ctx.ride_id, account.id)
      : await loadBookingView(deps, db, bookingId, account.id);
  });
}

// ---- POST /reports ----------------------------------------------------------------------------------------------------

/** NFC, trimmed, 1..500 characters (counted in code points); required for `other`. */
function normalizeDetails(raw: string | undefined, reason: string): string | null {
  const text = (raw ?? '').normalize('NFC').trim();
  if (text === '') {
    if (reason === 'other') {
      throw new AppError('VALIDATION_FAILED', 'Add a few words about what happened.', {
        fields: { details: 'required' },
      });
    }
    return null;
  }
  if ([...text].length > REPORT_DETAILS_MAX) {
    throw new AppError('VALIDATION_FAILED', 'The details are too long.', {
      fields: { details: 'too_long' },
    });
  }
  return text;
}

export async function createReport(
  deps: Deps,
  account: Account,
  body: CreateReportBody,
): Promise<ReportResponse> {
  const reportedId = body.reportedUserId.toLowerCase();
  if (reportedId === account.id) {
    throw new AppError('VALIDATION_FAILED', 'You cannot report yourself.', {
      fields: { reportedUserId: 'self' },
    });
  }
  const details = normalizeDetails(body.details, body.reason);
  const alsoBlock = body.alsoBlock === true;
  const now = deps.clock.now();

  const reportId = await tx(deps, async (db) => {
    // Any status is accepted for the reported user, so a suspension is not leaked.
    if (!(await profileExists(db, reportedId))) throw notFound('User');

    let rideId: string | null = null;
    let bookingId: string | null = null;
    if (body.bookingId) {
      const parties = await selectBookingParties(db, body.bookingId.toLowerCase());
      const ok =
        parties !== undefined &&
        new Set([parties.passenger_id, parties.driver_id]).size === 2 &&
        [parties.passenger_id, parties.driver_id].includes(account.id) &&
        [parties.passenger_id, parties.driver_id].includes(reportedId);
      if (!parties || !ok) throw notFound('Booking');
      bookingId = body.bookingId.toLowerCase();
      rideId = parties.ride_id; // derived from the booking, whatever the client sent
    } else if (body.rideId) {
      const id = body.rideId.toLowerCase();
      if (!(await isRideParty(db, id, account.id)) || !(await isRideParty(db, id, reportedId))) {
        throw notFound('Ride');
      }
      rideId = id;
    }

    const id = await insertReport(db, {
      reporterId: account.id,
      reportedId,
      rideId,
      bookingId,
      reason: body.reason,
      details,
      now,
    });
    const admins = await selectActiveAdminIds(db);
    await insertOutboxRows(
      db,
      admins.map((adminId) => reportReceivedOutbox(adminId, { reportId: id, reason: body.reason })),
    );
    await insertAnalyticsEvents(db, [
      reportSubmittedEvent(account.id, { reason: body.reason, alsoBlock }, now),
    ]);
    if (alsoBlock) await insertBlock(db, account.id, reportedId, now);
    return id;
  });

  // The block is committed: now cancel what is left between the pair (the sweep finishes a failure).
  if (alsoBlock) await cancelBlockedPair(deps, account.id, reportedId);
  return { id: reportId };
}

// ---- blocks --------------------------------------------------------------------------------------------------------------

/**
 * After a block is committed: cancels every active booking between the pair on rides that have not
 * departed, one transaction per booking in ride order (ADR 0028). Never throws: the tick safety sweep
 * repeats the work, so a failure here must not fail the request.
 */
export async function cancelBlockedPair(
  deps: Deps,
  blockerId: string,
  blockedId: string,
): Promise<void> {
  try {
    const now = deps.clock.now();
    const bookings = await selectPairBookings(deps.sql, blockerId, blockedId, now);
    for (const b of bookings) {
      const reason = b.passenger_id === blockerId ? 'blocked_by_passenger' : 'blocked_by_driver';
      await tx(deps, (db) => systemCancelBookingTx(db, b.id, now, reason));
    }
  } catch (e) {
    deps.log('warn', 'block_cascade_failed', { name: e instanceof Error ? e.name : 'unknown' });
  }
}

export async function blockUser(deps: Deps, account: Account, body: BlockBody): Promise<void> {
  const blockedId = body.userId.toLowerCase();
  if (blockedId === account.id) {
    throw new AppError('VALIDATION_FAILED', 'You cannot block yourself.', {
      fields: { userId: 'self' },
    });
  }
  const now = deps.clock.now();
  // Transaction 1: commit the block. From here on, new requests and approvals see it and fail.
  await tx(deps, async (db) => {
    if (!(await profileExists(db, blockedId))) throw notFound('User');
    await insertBlock(db, account.id, blockedId, now);
  });
  await cancelBlockedPair(deps, account.id, blockedId);
}

export async function unblockUser(deps: Deps, account: Account, userId: string): Promise<void> {
  if (!UUID_RE.test(userId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid user id.', { fields: { userId: 'invalid' } });
  }
  // Unblocking restores nothing: cancelled bookings stay cancelled.
  await deleteBlock(deps.sql, account.id, userId.toLowerCase());
}

export async function listMyBlocks(deps: Deps, account: Account): Promise<BlocksResponse> {
  const rows = await listBlocks(deps.sql, account.id, BLOCKS_MAX);
  const users = await publicUsersById(
    deps,
    deps.sql,
    rows.map((r) => r.blocked_id),
  );
  return {
    items: rows.flatMap((r) => {
      const user = users.get(r.blocked_id);
      return user ? [{ user, blockedAt: new Date(r.created_at).toISOString() }] : [];
    }),
  };
}

// ---- tick step: complete rides ------------------------------------------------------------------------------------------

/**
 * Tick step 2 (ADR 0024): finishes rides that departed 2 h ago or more, in one transaction. Each
 * passenger of a completed booking gets a rating prompt, the driver one prompt per ride. Returns the
 * number of rides moved to `completed` or `expired`.
 */
export async function completeFinishedRides(deps: Deps): Promise<number> {
  const now = deps.clock.now();
  const cutoff = new Date(now.getTime() - COMPLETE_AFTER_H * HOUR_MS);
  return (await deps.sql.begin(async (txn) => {
    const db = asDb(txn);
    const rides = await completeRides(db, now, cutoff, COMPLETE_BATCH);
    for (const r of rides) {
      const departureAt = new Date(r.departure_at).toISOString();
      const outbox: OutboxRow[] = r.booking_ids.map((bookingId, i) =>
        ratingPromptOutbox(r.passenger_ids[i] ?? '', {
          bookingId,
          driverFirstName: r.driver_first_name,
          departureAt,
        }),
      );
      if (r.outcome === 'completed') {
        outbox.push(
          ratingPromptDriverOutbox(r.driver_id, {
            rideId: r.ride_id,
            passengerCount: r.booking_ids.length,
            departureAt,
          }),
        );
        await insertAnalyticsEvents(db, [
          rideCompletedEvent(r.driver_id, { rideId: r.ride_id, seats: r.booking_ids.length }, now),
        ]);
      }
      await insertOutboxRows(db, outbox);
    }
    return rides.length;
  })) as number;
}

// ---- tick step: safety sweep ---------------------------------------------------------------------------------------------

/**
 * Tick step 3 (ADR 0027, 0028): cancels what a suspension or a block left behind. Each query is
 * limited to SWEEP_BATCH, each item runs in its own transaction and is re-checked under the ride lock.
 * An item that fails does not stop the others; the first error is rethrown at the end so the tick
 * records it. Returns the number of bookings cancelled.
 */
export async function runSafetySweep(deps: Deps): Promise<number> {
  const now = deps.clock.now();
  let swept = 0;
  let firstError: unknown = null;
  const guarded = async (fn: () => Promise<number>) => {
    try {
      swept += await fn();
    } catch (e) {
      firstError ??= e;
    }
  };

  // 1. Future rides of a suspended driver.
  for (const { id } of await selectSuspendedDriverRides(deps.sql, now, SWEEP_BATCH)) {
    await guarded(() =>
      tx(deps, async (db: Db) => {
        const ride = await lockRide(db, id);
        if (
          !ride ||
          ride.status !== 'published' ||
          (ride.driver_status !== 'suspended' && ride.driver_status !== 'deleted') ||
          new Date(ride.departure_at).getTime() <= now.getTime()
        ) {
          return 0;
        }
        return await cancelRideTx(
          db,
          {
            id,
            driverId: ride.driver_id,
            driverFirstName: await selectFirstName(db, ride.driver_id),
            departureAt: new Date(ride.departure_at),
          },
          now,
          'system',
          false,
        );
      }),
    );
  }

  // 2. Active bookings of a suspended passenger.
  for (const { id } of await selectSuspendedPassengerBookings(deps.sql, now, SWEEP_BATCH)) {
    await guarded(async () =>
      (await tx(deps, (db) => systemCancelBookingTx(db, id, now, 'suspended_passenger'))) ? 1 : 0,
    );
  }

  // 3. Active bookings between a blocked pair.
  for (const { id, reason } of await selectBlockedPairBookings(deps.sql, now, SWEEP_BATCH)) {
    await guarded(async () =>
      (await tx(deps, (db) => systemCancelBookingTx(db, id, now, reason))) ? 1 : 0,
    );
  }

  if (firstError) throw firstError;
  return swept;
}
