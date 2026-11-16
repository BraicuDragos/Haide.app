import type { LatLng } from '../../contracts/geo.ts';
import { FIXTURE_ROUTES } from './fixtures.ts';
import { haversineM } from './geo.ts';
import type { RouteResult, RoutingProvider } from './types.ts';

/** Both endpoints must be within this distance of a stored route's endpoints (area centroids etc.). */
export const FIXTURE_MATCH_RADIUS_M = 600;
/** Unknown pairs: straight line, road distance = straight distance x 1.3, 8 m/s average. */
export const FIXTURE_DETOUR_FACTOR = 1.3;
const FIXTURE_SPEED_MPS = 8;

const at = (c: [number, number]): LatLng => ({ lng: c[0], lat: c[1] });

/**
 * Deterministic routing without network (ROUTING_PROVIDER=fixture, the default locally and in CI).
 * Known coordinate pairs return the stored route (either direction); anything else a straight
 * line scaled by 1.3.
 */
export function createFixtureProvider(): RoutingProvider {
  return {
    name: 'fixture',
    route(origin, destination) {
      for (const fx of FIXTURE_ROUTES) {
        const first = at(fx.coordinates[0] ?? [0, 0]);
        const last = at(fx.coordinates[fx.coordinates.length - 1] ?? [0, 0]);
        const forward =
          haversineM(origin, first) <= FIXTURE_MATCH_RADIUS_M &&
          haversineM(destination, last) <= FIXTURE_MATCH_RADIUS_M;
        const backward =
          haversineM(origin, last) <= FIXTURE_MATCH_RADIUS_M &&
          haversineM(destination, first) <= FIXTURE_MATCH_RADIUS_M;
        if (forward || backward) {
          const coordinates = fx.coordinates.map((c): [number, number] => [c[0], c[1]]);
          const result: RouteResult = {
            distanceM: fx.distanceM,
            durationS: fx.durationS,
            coordinates: forward ? coordinates : coordinates.reverse(),
          };
          return Promise.resolve(result);
        }
      }
      const distanceM = Math.round(haversineM(origin, destination) * FIXTURE_DETOUR_FACTOR);
      return Promise.resolve({
        distanceM,
        durationS: Math.max(1, Math.round(distanceM / FIXTURE_SPEED_MPS)),
        coordinates: [
          [origin.lng, origin.lat],
          [destination.lng, destination.lat],
        ],
      });
    },
  };
}
