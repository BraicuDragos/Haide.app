import { z } from 'zod';
import { publicUserSchema } from './account.ts';
import { geoLineStringSchema } from './rides.ts';
import { RATING_LIMITS, type ratingTagSchema } from './ratings.ts';

export * from './ratings.ts';

/**
 * Trust and safety contracts (E5): ratings, no-show, share link, reports, blocks.
 * POST /bookings/{id}/no-show, POST /bookings/{id}/ratings, POST|DELETE /bookings/{id}/share-link,
 * GET /share/{token} (public), POST /reports, POST /blocks, DELETE /blocks/{userId}, GET /me/blocks.
 * Shared with the web app (import through @contracts). STABLE: additive changes only.
 *
 * Error codes (api-contract §1.1), no new ones:
 * - no-show: 404 (not a party), 409 INVALID_STATE (wrong state, or either party already rated),
 *   409 WINDOW_CLOSED (before departure or from departure + 24 h).
 * - ratings: 400 VALIDATION_FAILED (`fields.tags`, `fields.stars`), 404, 409 INVALID_STATE (not
 *   completed), WINDOW_CLOSED (7 days after completion), ALREADY_RATED.
 * - share-link: 404 (only the passenger may create one), 409 INVALID_STATE, WINDOW_CLOSED.
 * - GET /share/{token}: 404 for anything that is not a live link (malformed, unknown, expired, revoked,
 *   booking cancelled, a party suspended).
 * - reports: 400 (`fields.reportedUserId` = `self`, `fields.details` = `required`), 404.
 * - blocks: 400 (`fields.userId` = `self`), 404.
 */

// ---- POST /bookings/{id}/ratings ---------------------------------------------------------------

/**
 * `tags` are checked server-side against the ratee's role (RATING_TAGS): unknown, duplicate or
 * wrong-role tags answer 400 with `fields.tags`. The shape is deliberately loose so every tag
 * problem lands on that one field.
 */
export const ratingBodySchema = z.object({
  stars: z.number().int().min(RATING_LIMITS.minStars).max(RATING_LIMITS.maxStars),
  tags: z.array(z.string().max(40)).max(RATING_LIMITS.maxTags).default([]),
});
/** What the client sends. */
export type RatingBody = { stars: number; tags?: z.infer<typeof ratingTagSchema>[] };

// ---- POST|DELETE /bookings/{id}/share-link ------------------------------------------------------

export const shareLinkResponseSchema = z.object({
  /** `${APP_BASE_URL}/s/<token>`. The token is shown once: only its hash is stored. */
  url: z.string(),
  expiresAt: z.string(),
});
export type ShareLinkResponse = z.infer<typeof shareLinkResponseSchema>;

// ---- GET /share/{token} (public) ----------------------------------------------------------------

export const sharePhaseSchema = z.enum(['before', 'underway', 'done']);
export type SharePhase = z.infer<typeof sharePhaseSchema>;

/**
 * What a person holding the link sees. Never a phone number, the passenger's name, the driver's
 * origin or destination, or any other booking. `route` is the passenger's OWN segment only.
 */
export const sharedTripSchema = z.object({
  departureAt: z.string(),
  pickupEtaAt: z.string(),
  phase: sharePhaseSchema,
  expiresAt: z.string(),
  driver: z.object({ firstName: z.string().nullable(), photoUrl: z.string().nullable() }),
  car: z.object({
    make: z.string(),
    model: z.string(),
    colour: z.string(),
    plate: z.string(),
  }),
  pickup: z.object({ label: z.string() }),
  dropoff: z.object({ label: z.string() }),
  route: geoLineStringSchema.nullable(),
});
export type SharedTrip = z.infer<typeof sharedTripSchema>;

// ---- POST /reports -------------------------------------------------------------------------------

export const REPORT_REASONS = [
  'no_show',
  'unsafe_driving',
  'harassment',
  'extra_money',
  'fake_profile',
  'other',
] as const;
export const reportReasonSchema = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof reportReasonSchema>;

export const REPORT_DETAILS_MAX = 500;

export const createReportBodySchema = z.object({
  reportedUserId: z.uuid(),
  reason: reportReasonSchema,
  /** NFC, trimmed, 1..500 characters. Required for `other`. */
  details: z.string().max(2000).optional(),
  rideId: z.uuid().optional(),
  bookingId: z.uuid().optional(),
  /** Block the reported user in the same call. */
  alsoBlock: z.boolean().default(false),
});
/** What the client sends (`alsoBlock` optional). */
export type CreateReportBody = z.input<typeof createReportBodySchema>;

export const reportResponseSchema = z.object({ id: z.uuid() });
export type ReportResponse = z.infer<typeof reportResponseSchema>;

// ---- blocks ---------------------------------------------------------------------------------------

export const blockBodySchema = z.object({ userId: z.uuid() });
export type BlockBody = z.infer<typeof blockBodySchema>;

/** GET /me/blocks: outgoing blocks only (nobody learns who blocked them), newest first, at most 200. */
export const blocksResponseSchema = z.object({
  items: z.array(z.object({ user: publicUserSchema, blockedAt: z.string() })),
});
export type BlocksResponse = z.infer<typeof blocksResponseSchema>;
