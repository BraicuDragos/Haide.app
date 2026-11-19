import type { RideOwnerView } from '../../_shared/contracts/rides.ts';
import type { Db } from '../../_shared/db.ts';
import { AppError } from '../../_shared/errors.ts';
import { selectOpenRequests, selectRidePassengers } from '../repo/bookings.ts';
import { selectOwnerRide } from '../repo/rides.ts';
import { selectSeriesView } from '../repo/series.ts';
import { toPassengerItem, toRequestItem } from '../serializers/bookings.ts';
import { toOwnerView } from '../serializers/rides.ts';
import type { Deps } from '../types.ts';
import { publicUsersById } from './profiles.ts';

/**
 * The driver's full ride view: the ride, its open requests (never a point) and its confirmed
 * passengers (exact points and phone only through revealFor). Used by every endpoint that returns a
 * RideOwnerView, so they all agree. `db` is the transaction handle when called inside one.
 */
export async function loadOwnerView(
  deps: Deps,
  db: Db,
  rideId: string,
  driverId: string,
): Promise<RideOwnerView> {
  const row = await selectOwnerRide(db, rideId, driverId);
  if (!row) throw new AppError('NOT_FOUND', 'Ride not found.');
  const now = deps.clock.now();
  const requests = await selectOpenRequests(db, rideId, now);
  const passengers = await selectRidePassengers(db, rideId);
  const users = await publicUsersById(deps, db, [
    ...requests.map((r) => r.passenger_id),
    ...passengers.map((p) => p.passenger_id),
  ]);
  const series = row.series_id ? await selectSeriesView(db, row.series_id, now) : null;
  const departureAt = new Date(row.departure_at);
  const completedAt = row.completed_at ? new Date(row.completed_at) : null;
  const ride = {
    rateMicroPerKm: row.rate_micro_per_km,
    isFree: row.is_free,
    confirmedCount: row.seats_booked,
  };
  return toOwnerView(row, deps.clock, {
    series,
    requests: requests.flatMap((r) => {
      const u = users.get(r.passenger_id);
      return u ? [toRequestItem(r, u, ride)] : [];
    }),
    passengers: passengers.flatMap((p) => {
      const u = users.get(p.passenger_id);
      return u ? [toPassengerItem(p, u, { departureAt, completedAt }, deps.clock)] : [];
    }),
  });
}
