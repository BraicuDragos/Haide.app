import { Hono } from 'hono';
import {
  cancelRideBodySchema,
  createRideBodySchema,
  previewBodySchema,
  ridesQuerySchema,
} from '../../_shared/contracts/rides.ts';
import { RATE_LIMITS } from '../../_shared/domain/rules.ts';
import { requireActive, requireVehicle } from '../middleware/gates.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import {
  cancelRide,
  getMyRide,
  getPublicRide,
  listMyRides,
  previewRide,
  publishRide,
} from '../services/rides.ts';
import type { AppBindings } from '../types.ts';
import { parse, readJson, readOptionalJson } from '../validate.ts';

/**
 * Rides (E2). Handlers only parse, run the gates, call a service and shape the response.
 * Gates: UNAUTHENTICATED > ACCOUNT_SUSPENDED/DELETED > CONSENT_REQUIRED > PROFILE_INCOMPLETE >
 * VEHICLE_REQUIRED (publishing) > resource authorization (404, never 403).
 */
export const rideRoutes = new Hono<AppBindings>();

// POST /rides/preview: route, distance and the price table. Consent + profile + vehicle. 20/hour.
rideRoutes.post(
  '/rides/preview',
  requireVehicle,
  rateLimit('ride-preview', RATE_LIMITS.ridePreview),
  async (c) => {
    const body = parse(previewBodySchema, await readJson(c));
    return c.json(await previewRide(c.get('deps'), c.get('account'), body));
  },
);

// POST /rides: publish from a preview. No price field exists: the server prices it.
rideRoutes.post(
  '/rides',
  requireVehicle,
  rateLimit('ride-publish', RATE_LIMITS.ridePublish),
  async (c) => {
    const body = parse(createRideBodySchema, await readJson(c));
    return c.json(await publishRide(c.get('deps'), c.get('account'), body), 201);
  },
);

// GET /me/rides?scope=upcoming|past&limit&cursor: the driver's own rides
rideRoutes.get(
  '/me/rides',
  requireActive,
  rateLimit('rides-read', RATE_LIMITS.publicRead),
  async (c) => {
    const query = parse(ridesQuerySchema, c.req.query());
    return c.json(await listMyRides(c.get('deps'), c.get('account'), query));
  },
);

// GET /me/rides/{id}: owner view. Someone else's ride is a 404.
rideRoutes.get(
  '/me/rides/:id',
  requireActive,
  rateLimit('rides-read', RATE_LIMITS.publicRead),
  async (c) => c.json(await getMyRide(c.get('deps'), c.get('account'), c.req.param('id'))),
);

// POST /rides/{id}/cancel: driver only. Body `{}` (or empty).
rideRoutes.post(
  '/rides/:id/cancel',
  requireActive,
  rateLimit('account', RATE_LIMITS.account),
  async (c) => {
    parse(cancelRideBodySchema, await readOptionalJson(c));
    return c.json(await cancelRide(c.get('deps'), c.get('account'), c.req.param('id')));
  },
);

// GET /rides/{id}: public. Approximate points, area labels, trimmed route, no plate.
rideRoutes.get('/rides/:id', rateLimit('rides-public', RATE_LIMITS.publicRead), async (c) => {
  const viewerId = c.get('auth')?.userId ?? null;
  return c.json(await getPublicRide(c.get('deps'), viewerId, c.req.param('id')));
});
