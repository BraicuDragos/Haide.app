import type { RatingGiven } from '../../_shared/contracts/safety.ts';
import { assertCanRate, initialVisibleAt } from '../../_shared/domain/ratings.ts';
import { ratingSubmittedEvent } from '../../_shared/domain/safety.ts';
import { AppError } from '../../_shared/errors.ts';
import { lockRideOfBookingForParty } from '../repo/bookings.ts';
import { insertAnalyticsEvents } from '../repo/outbox.ts';
import { insertRating, pullVisibleAt, selectRatingContext } from '../repo/ratings.ts';
import type { Account, Deps } from '../types.ts';
import { asBookingId, tx } from './bookings.ts';

/**
 * POST /bookings/{id}/ratings (E5, spec §3, ADR 0025). Either party rates the other once, on a
 * completed booking, within 7 days of completion. The rating is stored blind: it counts from
 * `visible_at`, which is the end of the window, or right now when the counterpart has already
 * rated (then both become visible together). The answer never says whether the counterpart rated.
 * Suspended or deleted ratees can still be rated.
 */
export async function rateBooking(
  deps: Deps,
  account: Account,
  id: string,
  body: { stars: number; tags?: readonly string[] },
): Promise<RatingGiven> {
  const bookingId = asBookingId(id);
  const { clock } = deps;
  const now = clock.now();
  const tags = body.tags ?? [];

  return await tx(deps, async (db) => {
    // Ride first, then the booking row: the same order as the no-show, so the two serialise (S3).
    const ride = await lockRideOfBookingForParty(db, bookingId, account.id);
    if (!ride) throw new AppError('NOT_FOUND', 'Booking not found.');
    const ctx = await selectRatingContext(db, bookingId);
    if (!ctx) throw new AppError('NOT_FOUND', 'Booking not found.');

    const viewerIsPassenger = account.id === ctx.passenger_id;
    const rateeId = viewerIsPassenger ? ctx.driver_id : ctx.passenger_id;
    const completedAt = ctx.completed_at ? new Date(ctx.completed_at) : null;
    const counterRated = viewerIsPassenger ? ctx.rated_by_driver : ctx.rated_by_passenger;

    assertCanRate(
      {
        status: ctx.status,
        completedAt,
        alreadyRated: viewerIsPassenger ? ctx.rated_by_passenger : ctx.rated_by_driver,
        // The ratee's role decides which tags fit: a passenger rates the driver and vice versa.
        rateeRole: viewerIsPassenger ? 'driver' : 'passenger',
        tags,
      },
      clock,
    );
    if (completedAt === null)
      throw new AppError('INVALID_STATE', 'Only a completed ride can be rated.');

    const row = await insertRating(db, {
      bookingId,
      raterId: account.id,
      rateeId,
      stars: body.stars,
      tags,
      visibleAt: initialVisibleAt(completedAt, counterRated, now),
      now,
    });
    // The counter-rating was waiting for the window to end: both count from now on.
    if (counterRated) await pullVisibleAt(db, bookingId, rateeId, now);

    await insertAnalyticsEvents(db, [
      ratingSubmittedEvent(
        account.id,
        {
          bookingId,
          stars: body.stars,
          tagCount: tags.length,
          raterRole: viewerIsPassenger ? 'passenger' : 'driver',
        },
        now,
      ),
    ]);
    return {
      stars: row.stars,
      tags: row.tags as RatingGiven['tags'],
      createdAt: new Date(row.created_at).toISOString(),
    };
  });
}
