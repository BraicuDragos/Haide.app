import { Hono } from 'hono';
import {
  cancelSeriesBodySchema,
  createAlertBodySchema,
  createSeriesBodySchema,
  deletePushSubscriptionBodySchema,
  monthStatsQuerySchema,
  patchRideBodySchema,
  putPushSubscriptionBodySchema,
} from '../../_shared/contracts/liquidity.ts';
import { RATE_LIMITS } from '../../_shared/domain/rules.ts';
import { requireActive, requireConsent, requireVehicle } from '../middleware/gates.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { createAlert, deleteMyAlert, listMyAlerts } from '../services/alerts.ts';
import { deletePushSubscription, pushConfig, putPushSubscription } from '../services/push.ts';
import { setRideAutoAccept } from '../services/rides.ts';
import { cancelSeries, createSeries } from '../services/series.ts';
import { monthStats } from '../services/stats.ts';
import type { AppBindings } from '../types.ts';
import { parse, readJson, readOptionalJson } from '../validate.ts';

/**
 * Liquidity boosters (E8, e8-liquidity-spec §7). Handlers only parse, run the gates, call a service and
 * shape the response. Every route needs an active account; writes also need consent (CONSENT_REQUIRED);
 * series also need a complete profile and a vehicle. Ids that are not UUIDs are 404.
 */
export const liquidityRoutes = new Hono<AppBindings>();

// POST /ride-series: every instance up front, one transaction. Counts as one `ridePublish` hit.
liquidityRoutes.post(
  '/ride-series',
  requireVehicle,
  rateLimit('ride-publish', RATE_LIMITS.ridePublish),
  async (c) => {
    const body = parse(createSeriesBodySchema, await readJson(c));
    return c.json(await createSeries(c.get('deps'), c.get('account'), body), 201);
  },
);

// POST /ride-series/{id}/cancel: all future instances.
liquidityRoutes.post(
  '/ride-series/:id/cancel',
  requireConsent,
  rateLimit('booking-action', RATE_LIMITS.bookingAction),
  async (c) => {
    parse(cancelSeriesBodySchema, await readOptionalJson(c));
    return c.json(await cancelSeries(c.get('deps'), c.get('account'), c.req.param('id')));
  },
);

// PATCH /me/rides/{id}: the auto-accept switch.
liquidityRoutes.patch(
  '/me/rides/:id',
  requireConsent,
  rateLimit('account', RATE_LIMITS.account),
  async (c) => {
    const body = parse(patchRideBodySchema, await readJson(c));
    return c.json(
      await setRideAutoAccept(c.get('deps'), c.get('account'), c.req.param('id'), body.autoAccept),
    );
  },
);

// POST /alerts: 201, or 200 for an identical active alert. 20/hour.
liquidityRoutes.post(
  '/alerts',
  requireConsent,
  rateLimit('alerts', RATE_LIMITS.alerts),
  async (c) => {
    const body = parse(createAlertBodySchema, await readJson(c));
    const { item, created } = await createAlert(c.get('deps'), c.get('account'), body);
    return c.json({ item }, created ? 201 : 200);
  },
);

liquidityRoutes.get(
  '/me/alerts',
  requireActive,
  rateLimit('account', RATE_LIMITS.account),
  async (c) => c.json(await listMyAlerts(c.get('deps'), c.get('account'))),
);

liquidityRoutes.delete(
  '/alerts/:id',
  requireConsent,
  rateLimit('account', RATE_LIMITS.account),
  async (c) => {
    await deleteMyAlert(c.get('deps'), c.get('account'), c.req.param('id'));
    return c.body(null, 204);
  },
);

// GET /push/config: public. null = push disabled, the web app hides its UI.
liquidityRoutes.get('/push/config', rateLimit('public-read', RATE_LIMITS.publicRead), (c) => {
  c.header('Cache-Control', 'public, max-age=3600');
  return c.json(pushConfig(c.get('deps')));
});

liquidityRoutes.put(
  '/me/push-subscription',
  requireConsent,
  rateLimit('push-subscription', RATE_LIMITS.pushSubscription),
  async (c) => {
    const body = parse(putPushSubscriptionBodySchema, await readJson(c));
    await putPushSubscription(c.get('deps'), c.get('account'), body);
    return c.body(null, 204);
  },
);

liquidityRoutes.delete(
  '/me/push-subscription',
  requireConsent,
  rateLimit('push-subscription', RATE_LIMITS.pushSubscription),
  async (c) => {
    const body = parse(deletePushSubscriptionBodySchema, await readOptionalJson(c));
    await deletePushSubscription(c.get('deps'), c.get('account'), body);
    return c.body(null, 204);
  },
);

// GET /me/stats/month?month=YYYY-MM
liquidityRoutes.get(
  '/me/stats/month',
  requireActive,
  rateLimit('account', RATE_LIMITS.account),
  async (c) => {
    const query = parse(monthStatsQuerySchema, c.req.query());
    return c.json(await monthStats(c.get('deps'), c.get('account'), query.month));
  },
);
