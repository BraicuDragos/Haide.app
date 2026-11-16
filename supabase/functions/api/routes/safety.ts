import { Hono } from 'hono';
import { bookingActionBodySchema } from '../../_shared/contracts/bookings.ts';
import {
  blockBodySchema,
  createReportBodySchema,
  ratingBodySchema,
} from '../../_shared/contracts/safety.ts';
import { RATE_LIMITS } from '../../_shared/domain/rules.ts';
import { requireActive } from '../middleware/gates.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { rateBooking } from '../services/ratings.ts';
import {
  blockUser,
  createReport,
  listMyBlocks,
  reportNoShow,
  unblockUser,
} from '../services/safety.ts';
import { createShareLink, revokeShareLink } from '../services/shareLinks.ts';
import type { AppBindings } from '../types.ts';
import { parse, readJson, readOptionalJson } from '../validate.ts';

/**
 * Trust and safety (E5): no-show, ratings, the share link owner endpoints, reports and blocks.
 * Handlers only parse, run the gates, call a service and shape the response. Every route needs an
 * active account (a suspended user gets ACCOUNT_SUSPENDED); resource checks answer 404, never 403.
 */
export const safetyRoutes = new Hono<AppBindings>();

// POST /bookings/{id}/no-show: either party. Driver gets the owner view, passenger the booking view.
safetyRoutes.post(
  '/bookings/:id/no-show',
  requireActive,
  rateLimit('booking-action', RATE_LIMITS.bookingAction),
  async (c) => {
    parse(bookingActionBodySchema, await readOptionalJson(c));
    return c.json(await reportNoShow(c.get('deps'), c.get('account'), c.req.param('id')));
  },
);

// POST /bookings/{id}/ratings: either party, once, on a completed booking. 201 with the rating.
safetyRoutes.post(
  '/bookings/:id/ratings',
  requireActive,
  rateLimit('booking-action', RATE_LIMITS.bookingAction),
  async (c) => {
    const body = parse(ratingBodySchema, await readJson(c));
    return c.json(await rateBooking(c.get('deps'), c.get('account'), c.req.param('id'), body), 201);
  },
);

// POST /bookings/{id}/share-link: the passenger only. Creates or rotates the link. 201.
safetyRoutes.post(
  '/bookings/:id/share-link',
  requireActive,
  rateLimit('booking-action', RATE_LIMITS.bookingAction),
  async (c) => {
    parse(bookingActionBodySchema, await readOptionalJson(c));
    return c.json(await createShareLink(c.get('deps'), c.get('account'), c.req.param('id')), 201);
  },
);

// DELETE /bookings/{id}/share-link: the passenger only. Idempotent 204.
safetyRoutes.delete(
  '/bookings/:id/share-link',
  requireActive,
  rateLimit('booking-action', RATE_LIMITS.bookingAction),
  async (c) => {
    await revokeShareLink(c.get('deps'), c.get('account'), c.req.param('id'));
    return c.body(null, 204);
  },
);

// POST /reports: report another user. 10 per day. 201 `{ id }`.
safetyRoutes.post('/reports', requireActive, rateLimit('report', RATE_LIMITS.report), async (c) => {
  const body = parse(createReportBodySchema, await readJson(c));
  return c.json(await createReport(c.get('deps'), c.get('account'), body), 201);
});

// POST /blocks: block a user and cancel what is left between the pair. Idempotent 204.
safetyRoutes.post('/blocks', requireActive, rateLimit('block', RATE_LIMITS.block), async (c) => {
  const body = parse(blockBodySchema, await readJson(c));
  await blockUser(c.get('deps'), c.get('account'), body);
  return c.body(null, 204);
});

// DELETE /blocks/{userId}: remove the caller's own block. Idempotent 204.
safetyRoutes.delete(
  '/blocks/:userId',
  requireActive,
  rateLimit('block', RATE_LIMITS.block),
  async (c) => {
    await unblockUser(c.get('deps'), c.get('account'), c.req.param('userId'));
    return c.body(null, 204);
  },
);

// GET /me/blocks: the caller's outgoing blocks, newest first.
safetyRoutes.get(
  '/me/blocks',
  requireActive,
  rateLimit('account', RATE_LIMITS.account),
  async (c) => c.json(await listMyBlocks(c.get('deps'), c.get('account'))),
);
