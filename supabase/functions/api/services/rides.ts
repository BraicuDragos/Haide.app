import type {
  CreateRideRequest,
  EditRideBody,
  PreviewBody,
  PreviewResponse,
  RideListResponse,
  RideOwnerView,
  RidePublicView,
  RidesQuery,
} from '../../_shared/contracts/rides.ts';
import { priceTable, ratePerKmMicro, tripCostBani } from '../../_shared/domain/pricing.ts';
import { roundPoint } from '../../_shared/domain/privacy.ts';
import {
  assertDailyLimit,
  assertDeparture,
  assertPreviewPoints,
  canCancelRide,
  checkRouteLength,
  checkSeats,
  departureDayBounds,
  deriveLabel,
  FIXED_RIDE_FIELDS,
  isLateRideCancel,
  normalizeLabel,
  normalizeNote,
  planRideEdit,
  previewExpiresAt,
  requestExpiryCap,
  rideUpdatedRows,
} from '../../_shared/domain/rides.ts';
import { RELIABILITY_WINDOW_DAYS } from '../../_shared/domain/rules.ts';
import { asDb } from '../../_shared/db.ts';
import { AppError } from '../../_shared/errors.ts';
import { getPublicProfile, getVehicle } from '../repo/accounts.ts';
import { selectViewerBooking, touchBookingsOfMovedRide } from '../repo/bookings.ts';
import { insertOutboxRows } from '../repo/outbox.ts';
import {
  countDriverRidesBetween,
  countOtherDriverRidesBetween,
  describePoint,
  energyPriceFor,
  insertPreview,
  insertRideFromPreview,
  insertRidePublishedEvent,
  listCancelledRides,
  listPastRides,
  listUpcomingRides,
  lockDriverPublishing,
  lockLiveDriver,
  selectOwnerRide,
  selectPublicRide,
  setAutoAccept,
  updateRideEditable,
} from '../repo/rides.ts';
import { publicRideVisible, toListItem, toPublicView } from '../serializers/rides.ts';
import { toPublicUser } from '../serializers/users.ts';
import { cancelRideTx } from './cancellations.ts';
import { loadOwnerView } from './ownerView.ts';
import type { Account, Deps } from '../types.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

export const notFound = () => new AppError('NOT_FOUND', 'Ride not found.');

/** Resource ids that are not UUIDs are simply unknown (404), never a validation error. */
export function asRideId(id: string): string {
  if (!UUID_RE.test(id)) throw notFound();
  return id.toLowerCase();
}

// ---- POST /rides/preview ----------------------------------------------------------------------

export async function previewRide(
  deps: Deps,
  account: Account,
  body: PreviewBody,
): Promise<PreviewResponse> {
  const { sql, clock, routing } = deps;
  const origin = roundPoint(body.origin);
  const destination = roundPoint(body.destination);
  assertPreviewPoints(origin, destination);

  const vehicle = await getVehicle(sql, account.id);
  if (!vehicle) throw new AppError('VEHICLE_REQUIRED', 'Add your vehicle to continue.');
  const now = clock.now();
  const price = await energyPriceFor(sql, vehicle.fuelType, now);
  if (!price) throw new Error('energy_prices has no row for the fuel type');
  const rateMicroPerKm = ratePerKmMicro(price.consumption_centi, price.price_milli);

  // The only call to the router: once per preview (ORS free tier, architecture §16).
  const route = await routing.route(origin, destination);
  checkRouteLength(route.distanceM);

  let originLabel = normalizeLabel(body.originLabel);
  if (!originLabel) {
    const p = await describePoint(sql, origin);
    originLabel = deriveLabel(p.area_name, p.place_name);
  }
  let destinationLabel = normalizeLabel(body.destinationLabel);
  if (!destinationLabel) {
    const p = await describePoint(sql, destination);
    destinationLabel = deriveLabel(p.area_name, p.place_name);
  }

  const expiresAt = previewExpiresAt(now);
  const saved = await insertPreview(sql, {
    driverId: account.id,
    origin,
    destination,
    originLabel,
    destinationLabel,
    routeGeoJson: JSON.stringify({ type: 'LineString', coordinates: route.coordinates }),
    distanceM: route.distanceM,
    durationS: route.durationS,
    provider: routing.name,
    createdAt: now,
    expiresAt,
  });

  return {
    previewId: saved.id,
    expiresAt: expiresAt.toISOString(),
    distanceM: route.distanceM,
    durationS: route.durationS,
    route: JSON.parse(saved.routeGeoJson) as PreviewResponse['route'],
    originLabel,
    destinationLabel,
    priceTable: priceTable(route.distanceM, rateMicroPerKm, vehicle.seats),
    tripCostBani: tripCostBani(route.distanceM, rateMicroPerKm),
    rateMicroPerKm,
    fuelType: vehicle.fuelType,
  };
}

// ---- POST /rides ----------------------------------------------------------------------------------

export async function publishRide(
  deps: Deps,
  account: Account,
  body: CreateRideRequest,
): Promise<RideOwnerView> {
  const { sql, clock } = deps;
  const departureAt = new Date(body.departureAt);
  assertDeparture(departureAt, clock);
  const note = normalizeNote(body.note);

  const vehicle = await getVehicle(sql, account.id);
  if (!vehicle) throw new AppError('VEHICLE_REQUIRED', 'Add your vehicle to continue.');
  checkSeats(body.seats, vehicle.seats);

  const now = clock.now();
  const { startUtc, endUtc } = departureDayBounds(departureAt);

  return await sql.begin(async (txn) => {
    const tx = asDb(txn);
    // One publish at a time per driver: the count below is then race-free (4 per Bucharest day).
    await lockDriverPublishing(tx, account.id);
    if (!(await lockLiveDriver(tx, account.id))) {
      throw new AppError('ACCOUNT_DELETED', 'Account deleted.');
    }
    assertDailyLimit(await countDriverRidesBetween(tx, account.id, startUtc, endUtc));

    const price = await energyPriceFor(tx, vehicle.fuelType, now);
    if (!price) throw new Error('energy_prices has no row for the fuel type');

    const rideId = await insertRideFromPreview(tx, {
      previewId: body.previewId,
      driverId: account.id,
      now,
      departureAt,
      seats: body.seats,
      note,
      isFree: body.isFree,
      autoAccept: body.autoAccept,
      energyPriceId: price.id,
      rateMicroPerKm: ratePerKmMicro(price.consumption_centi, price.price_milli),
      vehicleSnapshot: {
        make: vehicle.make,
        model: vehicle.model,
        colour: vehicle.colour,
        plate: vehicle.plate,
        fuelType: vehicle.fuelType,
      },
    });
    if (!rideId) throw new AppError('PREVIEW_EXPIRED', 'Price the route again to publish.');

    await insertRidePublishedEvent(tx, account.id, rideId, now);
    return await loadOwnerView(deps, tx, rideId, account.id);
  });
}

// ---- GET /me/rides ----------------------------------------------------------------------------------

type Cursor = { departureAt: Date; id: string };

/** Opaque keyset cursor: base64url of `<departureAt ISO>|<ride id>`. */
export function encodeCursor(c: Cursor): string {
  return btoa(`${c.departureAt.toISOString()}|${c.id}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeCursor(raw: string): Cursor {
  const invalid = () =>
    new AppError('VALIDATION_FAILED', 'Invalid cursor.', { fields: { cursor: 'invalid' } });
  let decoded: string;
  try {
    decoded = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    throw invalid();
  }
  const [at, id] = decoded.split('|');
  const departureAt = new Date(at ?? '');
  if (!at || !id || Number.isNaN(departureAt.getTime()) || !UUID_RE.test(id)) throw invalid();
  return { departureAt, id: id.toLowerCase() };
}

const RIDE_LISTS = {
  upcoming: listUpcomingRides,
  past: listPastRides,
  cancelled: listCancelledRides,
} as const;

export type ListQuery = {
  scope: NonNullable<RidesQuery['scope']>;
  limit: number;
  cursor?: string | undefined;
};

export async function listMyRides(
  deps: Deps,
  account: Account,
  query: ListQuery,
): Promise<RideListResponse> {
  const { sql, clock } = deps;
  const after = query.cursor ? decodeCursor(query.cursor) : null;
  const list = RIDE_LISTS[query.scope];
  const rows = await list(sql, account.id, clock.now(), after, query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toListItem),
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ departureAt: new Date(last.departure_at), id: last.id })
        : null,
  };
}

// ---- GET /me/rides/{id} ---------------------------------------------------------------------------------

export async function getMyRide(deps: Deps, account: Account, id: string): Promise<RideOwnerView> {
  // Someone else's ride looks exactly like a missing one (loadOwnerView answers 404).
  return await loadOwnerView(deps, deps.sql, asRideId(id), account.id);
}

// ---- POST /rides/{id}/cancel --------------------------------------------------------------------------------

export async function cancelRide(deps: Deps, account: Account, id: string): Promise<RideOwnerView> {
  const { sql, clock } = deps;
  const rideId = asRideId(id);
  const now = clock.now();
  return await sql.begin(async (txn) => {
    const tx = asDb(txn);
    const ride = await selectOwnerRide(tx, rideId, account.id, true);
    if (!ride) throw notFound();
    const ctx = { status: ride.status, departureAt: new Date(ride.departure_at) };
    if (!canCancelRide(ctx, clock)) {
      throw new AppError(
        'INVALID_STATE',
        'Only a published ride that has not departed can be cancelled.',
      );
    }
    const late = isLateRideCancel(ctx, clock);
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
      late,
    );
    return await loadOwnerView(deps, tx, rideId, account.id);
  });
}

// ---- PATCH /me/rides/{id} (E8-3, ADR 0037) -----------------------------------------------------------------

/**
 * Switches auto-accept on or off for one ride. Locks the ride (the same lock POST /bookings takes, so
 * a switch racing a request is serialised). Driver only (else 404); the ride must be published and
 * not departed. Switching on never confirms requests that are already pending.
 */
export async function setRideAutoAccept(
  deps: Deps,
  account: Account,
  id: string,
  autoAccept: boolean,
): Promise<RideOwnerView> {
  const { sql, clock } = deps;
  const rideId = asRideId(id);
  const now = clock.now();
  return await sql.begin(async (txn) => {
    const tx = asDb(txn);
    const ride = await selectOwnerRide(tx, rideId, account.id, true);
    if (!ride) throw notFound();
    if (!canCancelRide({ status: ride.status, departureAt: new Date(ride.departure_at) }, clock)) {
      throw new AppError(
        'INVALID_STATE',
        'Only a published ride that has not departed can change.',
      );
    }
    await setAutoAccept(tx, rideId, autoAccept, now);
    return await loadOwnerView(deps, tx, rideId, account.id);
  });
}

// ---- PATCH /rides/{id} (ADR 0041) ----------------------------------------------------------------------------

/**
 * Fields that are fixed once a ride is published. Sending one is ROUTE_NOT_EDITABLE (not a generic
 * validation error) so the client can tell the driver to cancel and publish again.
 */
export function assertNoFixedFields(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return;
  const fields: Record<string, string> = {};
  for (const key of FIXED_RIDE_FIELDS) {
    if (Object.hasOwn(raw, key)) fields[key] = 'not_editable';
  }
  if (Object.keys(fields).length > 0) {
    throw new AppError(
      'ROUTE_NOT_EDITABLE',
      'The route, price and vehicle cannot be changed. Cancel the ride and publish a new one.',
      { fields },
    );
  }
}

/**
 * Edits the time, seats, note or auto-accept of a published ride. One transaction under the ride row
 * lock (the lock POST /bookings, approve and cancel take): validate, update the ride and, when the
 * DEPARTURE moved, clamp the open requests, flag every requested or confirmed booking for its
 * passenger and enqueue one `ride_updated` outbox row each. Seats, note and auto-accept notify nobody.
 * A body that changes nothing is a no-op (200, nothing written). Driver only (else 404).
 */
export async function editRide(
  deps: Deps,
  account: Account,
  id: string,
  body: EditRideBody,
): Promise<RideOwnerView> {
  const { sql, clock } = deps;
  const rideId = asRideId(id);
  const now = clock.now();
  return await sql.begin(async (txn) => {
    const tx = asDb(txn);
    const ride = await selectOwnerRide(tx, rideId, account.id, true);
    if (!ride) throw notFound();
    const previousDepartureAt = new Date(ride.departure_at);
    const plan = planRideEdit(
      {
        status: ride.status,
        departureAt: previousDepartureAt,
        seatsOffered: ride.seats_offered,
        seatsBooked: ride.seats_booked,
        note: ride.note,
        autoAccept: ride.auto_accept === true,
      },
      {
        departureAt: body.departureAt === undefined ? undefined : new Date(body.departureAt),
        seats: body.seats,
        note: body.note,
        autoAccept: body.autoAccept,
      },
      clock,
    );
    const changed =
      plan.timeChanged || plan.seatsChanged || plan.noteChanged || plan.autoAcceptChanged;
    if (!changed) return await loadOwnerView(deps, tx, rideId, account.id);

    // More seats than the car has is refused; fewer is always fine (the car may have changed since).
    if (plan.seats > ride.seats_offered) {
      const vehicle = await getVehicle(tx, account.id);
      if (!vehicle) throw new AppError('VEHICLE_REQUIRED', 'Add your vehicle to continue.');
      checkSeats(plan.seats, vehicle.seats);
    }

    if (plan.timeChanged) {
      // The publish lock and count, minus this ride: the 4 rides a day still hold on the new day.
      await lockDriverPublishing(tx, account.id);
      if (!(await lockLiveDriver(tx, account.id))) {
        throw new AppError('ACCOUNT_DELETED', 'Account deleted.');
      }
      const { startUtc, endUtc } = departureDayBounds(plan.departureAt);
      assertDailyLimit(
        await countOtherDriverRidesBetween(tx, account.id, rideId, startUtc, endUtc),
      );
    }

    if (!(await updateRideEditable(tx, rideId, plan, now))) {
      throw new AppError(
        'RIDE_NOT_EDITABLE',
        'Only a published ride that has not departed can be edited.',
      );
    }

    if (plan.timeChanged) {
      const moved = await touchBookingsOfMovedRide(
        tx,
        rideId,
        requestExpiryCap(plan.departureAt),
        now,
      );
      if (moved.length > 0) {
        await insertOutboxRows(
          tx,
          rideUpdatedRows(
            {
              id: rideId,
              driverFirstName: account.firstName,
              previousDepartureAt,
              departureAt: plan.departureAt,
            },
            moved.map((b) => ({
              id: b.id,
              passengerId: b.passenger_id,
              pickupArea: b.pickup_label,
              dropoffArea: b.dropoff_label,
            })),
          ),
        );
      }
    }
    return await loadOwnerView(deps, tx, rideId, account.id);
  });
}

// ---- GET /rides/{id} (public) ---------------------------------------------------------------------------------

export async function getPublicRide(
  deps: Deps,
  viewerId: string | null,
  id: string,
): Promise<RidePublicView> {
  const { sql, clock, env } = deps;
  const rideId = asRideId(id);
  const row = await selectPublicRide(sql, rideId, viewerId);
  if (!row) throw notFound();
  const viewerBooking = viewerId
    ? ((await selectViewerBooking(sql, rideId, viewerId)) ?? null)
    : null;
  if (!publicRideVisible(row, viewerId, viewerBooking !== null)) throw notFound();
  // A completed ride is over: only its driver and its passengers can still open it (E5).
  if (row.status === 'completed' && viewerId !== row.driver_id && viewerBooking === null) {
    throw notFound();
  }
  const since = new Date(clock.now().getTime() - RELIABILITY_WINDOW_DAYS * DAY_MS);
  const profile = await getPublicProfile(sql, row.driver_id, since, clock.now());
  if (!profile || profile.status === 'suspended') throw notFound();
  return toPublicView(row, toPublicUser(profile, env), viewerId, viewerBooking);
}
