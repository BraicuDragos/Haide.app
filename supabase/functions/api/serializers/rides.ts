import type { PublicUser } from '../../_shared/contracts/account.ts';
import {
  geoLineStringSchema,
  type BookingStatus,
  type GeoLineString,
  type RideListItem,
  type RideOwnerView,
  type RidePassengerItem,
  type RideRequestItem,
  type RidePublicView,
} from '../../_shared/contracts/rides.ts';
import type { Clock } from '../../_shared/domain/clock.ts';
import { priceTable, tripCostBani } from '../../_shared/domain/pricing.ts';
import { roundCoord } from '../../_shared/domain/privacy.ts';
import { canCancelRide, isLateRideCancel } from '../../_shared/domain/rides.ts';
import type { OwnerRideRow, PublicRideRow, RideListRow } from '../repo/rides.ts';

/**
 * Role-based output shaping for rides (data-model 5.2). Two audiences in E2:
 * - owner view: exact points, full route, plate. Only ever built for the driver of the ride.
 * - public view: 300 m grid points, area names, trimmed route. Built from a query that never
 *   selects the plate or the exact geometry, and re-checked here by picking fields explicitly.
 */

const iso = (d: Date | string): string => new Date(d).toISOString();

/** Parses ST_AsGeoJSON output. Invalid or missing geometry becomes null. */
export function parseLineString(text: string | null): GeoLineString | null {
  if (!text) return null;
  try {
    const parsed = geoLineStringSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const SIBIU = 'Sibiu';

export type OwnerExtras = {
  requests: RideRequestItem[];
  passengers: RidePassengerItem[];
};

export function toOwnerView(
  row: OwnerRideRow,
  clock: Clock,
  extras: OwnerExtras = { requests: [], passengers: [] },
): RideOwnerView {
  const departureAt = new Date(row.departure_at);
  const ctx = { status: row.status, departureAt };
  const origin = { lat: roundCoord(row.origin_lat), lng: roundCoord(row.origin_lng) };
  const destination = {
    lat: roundCoord(row.destination_lat),
    lng: roundCoord(row.destination_lng),
  };
  // Coarsened rides (older than 90 days) no longer hold a route: fall back to a straight line.
  const route = parseLineString(row.route_geojson) ?? {
    type: 'LineString' as const,
    coordinates: [
      [origin.lng, origin.lat] as [number, number],
      [destination.lng, destination.lat] as [number, number],
    ],
  };
  const car = row.vehicle_snapshot;
  return {
    id: row.id,
    status: row.status,
    departureAt: departureAt.toISOString(),
    origin: { point: origin, label: row.origin_label },
    destination: { point: destination, label: row.destination_label },
    route,
    distanceM: row.distance_m,
    durationS: row.duration_s,
    seatsOffered: row.seats_offered,
    seatsBooked: row.seats_booked,
    note: row.note,
    isFree: row.is_free,
    priceTable: priceTable(row.distance_m, row.rate_micro_per_km, row.seats_offered, row.is_free),
    tripCostBani: tripCostBani(row.distance_m, row.rate_micro_per_km),
    fuelType: car.fuelType,
    car: { make: car.make, model: car.model, colour: car.colour, plate: car.plate },
    requests: extras.requests,
    passengers: extras.passengers,
    canCancel: canCancelRide(ctx, clock),
    lateCancelIfNow: isLateRideCancel(ctx, clock),
    lateCancel: row.late_cancel,
    cancelledAt: row.cancelled_at ? iso(row.cancelled_at) : null,
    createdAt: iso(row.created_at),
  };
}

export function toListItem(row: RideListRow): RideListItem {
  return {
    id: row.id,
    departureAt: iso(row.departure_at),
    originLabel: row.origin_label,
    destinationLabel: row.destination_label,
    status: row.status,
    seatsOffered: row.seats_offered,
    seatsBooked: row.seats_booked,
    pendingRequests: Number(row.pending_requests ?? 0),
  };
}

/** Whether this viewer may see the ride at all (404 otherwise, never 403). */
export function publicRideVisible(
  row: PublicRideRow,
  viewerId: string | null,
  /** The viewer has a booking on this ride: a cancelled ride stays visible to its passengers. */
  isPassenger = false,
): boolean {
  if (row.driver_status === 'suspended') return false;
  // Blocked either way looks exactly like a missing ride: nobody learns who blocked whom.
  if (row.blocked) return false;
  const isDriver = viewerId !== null && viewerId === row.driver_id;
  if ((row.status === 'cancelled' || row.status === 'expired') && !isDriver && !isPassenger) {
    return false;
  }
  return true;
}

export function toPublicView(
  row: PublicRideRow,
  driver: PublicUser,
  viewerId: string | null,
  viewerBooking: { id: string; status: BookingStatus } | null = null,
): RidePublicView {
  const approx = (lat: number, lng: number) => ({
    lat: roundCoord(lat),
    lng: roundCoord(lng),
    approx: true as const,
    radiusM: 300 as const,
  });
  return {
    id: row.id,
    status: row.status,
    departureAt: iso(row.departure_at),
    durationS: row.duration_s,
    distanceM: row.distance_m,
    origin: { point: approx(row.origin_lat, row.origin_lng), label: row.origin_area ?? SIBIU },
    destination: {
      point: approx(row.destination_lat, row.destination_lng),
      label: row.destination_area ?? SIBIU,
    },
    routePublic: parseLineString(row.route_public),
    seatsOffered: row.seats_offered,
    seatsLeft: Math.max(0, row.seats_offered - row.seats_booked),
    note: row.note,
    isFree: row.is_free,
    priceTable: priceTable(row.distance_m, row.rate_micro_per_km, row.seats_offered, row.is_free),
    // Picked field by field: the plate can never slip through.
    car: { make: row.car.make, model: row.car.model, colour: row.car.colour },
    driver,
    viewer: {
      isDriver: viewerId !== null && viewerId === row.driver_id,
      bookingId: viewerBooking?.id ?? null,
      bookingStatus: viewerBooking?.status ?? null,
      blocked: false,
    },
  };
}
