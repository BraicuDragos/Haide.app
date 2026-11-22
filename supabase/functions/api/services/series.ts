import type {
  CancelSeriesResponse,
  CreateSeriesRequest,
  CreateSeriesResponse,
  SkipCode,
} from '../../_shared/contracts/liquidity.ts';
import { asDb } from '../../_shared/db.ts';
import { ratePerKmMicro } from '../../_shared/domain/pricing.ts';
import {
  assertDailyLimit,
  canCancelRide,
  checkSeats,
  isLateRideCancel,
  normalizeNote,
} from '../../_shared/domain/rides.ts';
import { MAX_RIDES_PER_DAY } from '../../_shared/domain/rules.ts';
import { planInstance, planSeries } from '../../_shared/domain/series.ts';
import { bucharestDayBounds } from '../../_shared/domain/time.ts';
import { AppError } from '../../_shared/errors.ts';
import { getVehicle } from '../repo/accounts.ts';
import {
  countDriverRidesBetween,
  energyPriceFor,
  insertRideFromPreview,
  insertRidePublishedEvent,
  lockDriverPublishing,
  lockLiveDriver,
  selectOwnerRide,
} from '../repo/rides.ts';
import {
  insertSeries,
  listUpcomingInstanceIds,
  lockOwnSeries,
  markSeriesCancelled,
  selectSeriesView,
} from '../repo/series.ts';
import type { Account, Deps } from '../types.ts';
import { cancelRideTx } from './cancellations.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const seriesNotFound = () => new AppError('NOT_FOUND', 'Ride series not found.');

/** Ids that are not UUIDs are simply unknown (404). */
export function asSeriesId(id: string): string {
  if (!UUID_RE.test(id)) throw seriesNotFound();
  return id.toLowerCase();
}

// ---- POST /ride-series (ADR 0039) ------------------------------------------------------------------

/**
 * Creates every instance up front in one transaction under the per-driver publish lock. Each date is
 * checked against the 4-per-day limit and skipped (and reported) instead of failing the request.
 * Instances inserted earlier in the transaction count toward their day.
 */
export async function createSeries(
  deps: Deps,
  account: Account,
  body: CreateSeriesRequest,
): Promise<CreateSeriesResponse> {
  const { sql, clock } = deps;
  const now = clock.now();
  const plan = planSeries(
    {
      weekdays: body.weekdays,
      departureTime: body.departureTime,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
    },
    now,
  );
  const note = normalizeNote(body.note);

  const vehicle = await getVehicle(sql, account.id);
  if (!vehicle) throw new AppError('VEHICLE_REQUIRED', 'Add your vehicle to continue.');
  checkSeats(body.seats, vehicle.seats);

  return await sql.begin(async (txn) => {
    const tx = asDb(txn);
    // One publish at a time per driver: the per-day counts below are then race-free.
    await lockDriverPublishing(tx, account.id);
    if (!(await lockLiveDriver(tx, account.id))) {
      throw new AppError('ACCOUNT_DELETED', 'Account deleted.');
    }

    const price = await energyPriceFor(tx, vehicle.fuelType, now);
    if (!price) throw new Error('energy_prices has no row for the fuel type');
    const rateMicroPerKm = ratePerKmMicro(price.consumption_centi, price.price_milli);

    const seriesId = await insertSeries(tx, {
      driverId: account.id,
      weekdays: plan.weekdays,
      departureTime: plan.departureTime,
      startsOn: plan.startsOn,
      endsOn: plan.endsOn,
      now,
    });

    const created: { rideId: string; departureAt: string }[] = [];
    const skipped: { date: string; code: SkipCode }[] = [];
    for (const day of plan.dates) {
      const inst = planInstance(day, plan.departureTime, now);
      if (!inst.ok) {
        skipped.push({ date: day, code: inst.code });
        continue;
      }
      const { startUtc, endUtc } = bucharestDayBounds(day);
      if ((await countDriverRidesBetween(tx, account.id, startUtc, endUtc)) >= MAX_RIDES_PER_DAY) {
        skipped.push({ date: day, code: 'DAILY_RIDE_LIMIT' });
        continue;
      }
      const rideId = await insertRideFromPreview(tx, {
        previewId: body.previewId,
        driverId: account.id,
        now,
        departureAt: inst.departureAt,
        seats: body.seats,
        note,
        isFree: body.isFree,
        autoAccept: body.autoAccept,
        seriesId,
        energyPriceId: price.id,
        rateMicroPerKm,
        vehicleSnapshot: {
          make: vehicle.make,
          model: vehicle.model,
          colour: vehicle.colour,
          plate: vehicle.plate,
          fuelType: vehicle.fuelType,
        },
      });
      // Unknown, expired or someone else's preview: nothing is kept (the throw rolls the series back).
      if (!rideId) throw new AppError('PREVIEW_EXPIRED', 'Price the route again to publish.');
      await insertRidePublishedEvent(tx, account.id, rideId, now);
      created.push({ rideId, departureAt: inst.departureAt.toISOString() });
    }

    if (created.length === 0) {
      // Roll back: a series without a single ride is not created.
      if (skipped.every((s) => s.code === 'INVALID_TIME')) {
        throw new AppError('VALIDATION_FAILED', 'That time does not exist on those days.', {
          fields: { departureTime: 'invalid' },
        });
      }
      assertDailyLimit(MAX_RIDES_PER_DAY);
    }

    const series = await selectSeriesView(tx, seriesId, now);
    if (!series) throw new Error('series vanished inside its own transaction');
    return { series, created, skipped };
  });
}

// ---- POST /ride-series/{id}/cancel ---------------------------------------------------------------------

/**
 * Cancels every published instance that has not departed, in departure order, each exactly as a
 * single cancel (cascade, emails, a reliability event when late), then closes the series.
 */
export async function cancelSeries(
  deps: Deps,
  account: Account,
  id: string,
): Promise<CancelSeriesResponse> {
  const { sql, clock } = deps;
  const seriesId = asSeriesId(id);
  const now = clock.now();
  return await sql.begin(async (txn) => {
    const tx = asDb(txn);
    const own = await lockOwnSeries(tx, seriesId, account.id);
    if (!own) throw seriesNotFound();
    if (own.status !== 'active') {
      throw new AppError('INVALID_STATE', 'This series is already cancelled.');
    }

    const cancelledRideIds: string[] = [];
    for (const rideId of await listUpcomingInstanceIds(tx, seriesId, now)) {
      const ride = await selectOwnerRide(tx, rideId, account.id, true);
      if (!ride) continue;
      const ctx = { status: ride.status, departureAt: new Date(ride.departure_at) };
      if (!canCancelRide(ctx, clock)) continue;
      await cancelRideTx(
        tx,
        {
          id: rideId,
          driverId: account.id,
          driverFirstName: account.firstName,
          departureAt: ctx.departureAt,
        },
        now,
        'driver',
        isLateRideCancel(ctx, clock),
      );
      cancelledRideIds.push(rideId);
    }
    await markSeriesCancelled(tx, seriesId, now);

    const series = await selectSeriesView(tx, seriesId, now);
    if (!series) throw seriesNotFound();
    return { series, cancelledRideIds };
  });
}
