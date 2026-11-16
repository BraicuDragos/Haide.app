import type {
  CreateRideRequest,
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
  isLateRideCancel,
  normalizeLabel,
  normalizeNote,
  previewExpiresAt,
  rideCancelledOutbox,
} from '../../_shared/domain/rides.ts';
import { RELIABILITY_WINDOW_DAYS } from '../../_shared/domain/rules.ts';
import { asDb } from '../../_shared/db.ts';
import { AppError } from '../../_shared/errors.ts';
import { getPublicProfile, getVehicle } from '../repo/accounts.ts';
import {
  activePassengerIds,
  countDriverRidesBetween,
  describePoint,
  energyPriceFor,
  insertLateCancelEvent,
  insertOutboxRows,
  insertPreview,
  insertRideFromPreview,
  insertRidePublishedEvent,
  listPastRides,
  listUpcomingRides,
  lockDriverPublishing,
  markRideCancelled,
  rideAreaLabels,
  selectOwnerRide,
  selectPublicRide,
} from '../repo/rides.ts';
import { publicRideVisible, toListItem, toOwnerView, toPublicView } from '../serializers/rides.ts';
import { toPublicUser } from '../serializers/users.ts';
import type { Account, Deps } from '../types.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

const notFound = () => new AppError('NOT_FOUND', 'Ride not found.');

/** Resource ids that are not UUIDs are simply unknown (404), never a validation error. */
function asRideId(id: string): string {
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
    const row = await selectOwnerRide(tx, rideId, account.id);
    if (!row) throw new Error('ride vanished inside its transaction');
    return toOwnerView(row, clock);
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
  const list = query.scope === 'upcoming' ? listUpcomingRides : listPastRides;
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
  const row = await selectOwnerRide(deps.sql, asRideId(id), account.id);
  if (!row) throw notFound(); // someone else's ride looks exactly like a missing one
  return toOwnerView(row, deps.clock);
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
    await markRideCancelled(tx, rideId, now, late);
    if (late) await insertLateCancelEvent(tx, account.id, rideId, now);

    // E4 cancels the bookings here. The outbox rows (labels and times only) are written already.
    const passengerIds = await activePassengerIds(tx, rideId);
    if (passengerIds.length > 0) {
      const areas = await rideAreaLabels(tx, rideId);
      await insertOutboxRows(
        tx,
        rideCancelledOutbox(passengerIds, {
          rideId,
          departureAt: ctx.departureAt.toISOString(),
          originLabel: areas.origin ?? 'Sibiu',
          destinationLabel: areas.destination ?? 'Sibiu',
          driverFirstName: account.firstName,
        }),
      );
    }
    const fresh = await selectOwnerRide(tx, rideId, account.id);
    if (!fresh) throw new Error('ride vanished inside its transaction');
    return toOwnerView(fresh, clock);
  });
}

// ---- GET /rides/{id} (public) ---------------------------------------------------------------------------------

export async function getPublicRide(
  deps: Deps,
  viewerId: string | null,
  id: string,
): Promise<RidePublicView> {
  const { sql, clock, env } = deps;
  const row = await selectPublicRide(sql, asRideId(id));
  if (!row || !publicRideVisible(row, viewerId)) throw notFound();
  const since = new Date(clock.now().getTime() - RELIABILITY_WINDOW_DAYS * DAY_MS);
  const profile = await getPublicProfile(sql, row.driver_id, since);
  if (!profile || profile.status === 'suspended') throw notFound();
  return toPublicView(row, toPublicUser(profile, env), viewerId);
}
