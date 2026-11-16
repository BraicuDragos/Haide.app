import { Hono } from 'hono';
import {
  bookingActionBodySchema,
  bookingsQuerySchema,
  createBookingBodySchema,
  idempotencyKeySchema,
  summarySeenBodySchema,
} from '../../_shared/contracts/bookings.ts';
import { RATE_LIMITS } from '../../_shared/domain/rules.ts';
import { AppError } from '../../_shared/errors.ts';
import { requireActive, requireProfile } from '../middleware/gates.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import {
  approveBooking,
  cancelBooking,
  createBooking,
  getBooking,
  getSummary,
  listMyBookings,
  markUpdatesSeen,
  rejectBookingRequest,
} from '../services/bookings.ts';
import type { AppBindings } from '../types.ts';
import { parse, readJson, readOptionalJson } from '../validate.ts';

/**
 * Bookings (E4). Handlers only parse, run the gates, call a service and shape the response.
 * Gates: UNAUTHENTICATED > ACCOUNT_SUSPENDED/DELETED > CONSENT_REQUIRED > PROFILE_INCOMPLETE >
 * resource authorization (404, never 403). The server computes every price.
 */
export const bookingRoutes = new Hono<AppBindings>();

/** `Idempotency-Key` is required on POST /bookings and must be a uuid. */
function idempotencyKeyOf(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') {
    throw new AppError('VALIDATION_FAILED', 'The Idempotency-Key header is required.', {
      fields: { idempotencyKey: 'required' },
    });
  }
  const parsed = idempotencyKeySchema.safeParse(raw.trim());
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'The Idempotency-Key header must be a UUID.', {
      fields: { idempotencyKey: 'invalid' },
    });
  }
  return parsed.data.toLowerCase();
}

// POST /bookings: request a seat. Consent + complete profile. 10/hour.
bookingRoutes.post(
  '/bookings',
  requireProfile,
  rateLimit('booking-request', RATE_LIMITS.bookingRequest),
  async (c) => {
    const key = idempotencyKeyOf(c.req.header('idempotency-key'));
    const body = parse(createBookingBodySchema, await readJson(c));
    return c.json(await createBooking(c.get('deps'), c.get('account'), key, body), 201);
  },
);

// GET /me/bookings?scope=upcoming|past&limit&cursor: the passenger's own bookings
bookingRoutes.get(
  '/me/bookings',
  requireActive,
  rateLimit('bookings-read', RATE_LIMITS.publicRead),
  async (c) => {
    const query = parse(bookingsQuerySchema, c.req.query());
    return c.json(await listMyBookings(c.get('deps'), c.get('account'), query));
  },
);

// GET /bookings/{id}: the passenger or the ride's driver. Anyone else gets a 404.
bookingRoutes.get(
  '/bookings/:id',
  requireActive,
  rateLimit('bookings-read', RATE_LIMITS.publicRead),
  async (c) => c.json(await getBooking(c.get('deps'), c.get('account'), c.req.param('id'))),
);

// POST /bookings/{id}/approve: the ride's driver. 200 returns the owner ride view.
bookingRoutes.post(
  '/bookings/:id/approve',
  requireActive,
  rateLimit('booking-action', RATE_LIMITS.bookingAction),
  async (c) => {
    parse(bookingActionBodySchema, await readOptionalJson(c));
    return c.json(await approveBooking(c.get('deps'), c.get('account'), c.req.param('id')));
  },
);

// POST /bookings/{id}/reject: the ride's driver. 200 returns the owner ride view.
bookingRoutes.post(
  '/bookings/:id/reject',
  requireActive,
  rateLimit('booking-action', RATE_LIMITS.bookingAction),
  async (c) => {
    parse(bookingActionBodySchema, await readOptionalJson(c));
    return c.json(await rejectBookingRequest(c.get('deps'), c.get('account'), c.req.param('id')));
  },
);

// POST /bookings/{id}/cancel: the passenger. 200 returns the booking view.
bookingRoutes.post(
  '/bookings/:id/cancel',
  requireActive,
  rateLimit('booking-action', RATE_LIMITS.bookingAction),
  async (c) => {
    parse(bookingActionBodySchema, await readOptionalJson(c));
    return c.json(await cancelBooking(c.get('deps'), c.get('account'), c.req.param('id')));
  },
);

// GET /me/summary: badge counts, polled every 60 s while the app is visible
bookingRoutes.get(
  '/me/summary',
  requireActive,
  rateLimit('account', RATE_LIMITS.account),
  async (c) => c.json(await getSummary(c.get('deps'), c.get('account'))),
);

// POST /me/summary/seen: marks the caller's own bookings as seen. 204.
bookingRoutes.post(
  '/me/summary/seen',
  requireActive,
  rateLimit('account', RATE_LIMITS.account),
  async (c) => {
    const body = parse(summarySeenBodySchema, await readJson(c));
    await markUpdatesSeen(c.get('deps'), c.get('account'), body.bookingIds);
    return c.body(null, 204);
  },
);
