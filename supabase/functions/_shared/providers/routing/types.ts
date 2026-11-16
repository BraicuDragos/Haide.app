import type { LatLng } from '../../contracts/geo.ts';

/** A driving route between two points. Coordinates are [lng, lat] (GeoJSON order). */
export type RouteResult = {
  distanceM: number;
  durationS: number;
  coordinates: [number, number][];
};

/**
 * Car routing, server-side only (ADR 0014). Implementations throw AppError:
 * ROUTE_NOT_FOUND (no road route between the points) or ROUTING_UNAVAILABLE (timeout, outage,
 * quota, bad configuration). They never log or echo coordinates.
 */
export interface RoutingProvider {
  readonly name: 'ors' | 'fixture';
  route(origin: LatLng, destination: LatLng): Promise<RouteResult>;
}
