import { z } from 'zod';
import { publicUserSchema } from './account.ts';
import { latLngSchema } from './geo.ts';
import {
  bookingStatusSchema,
  carPublicSchema,
  exactOrApproxPointSchema,
  geoLineStringSchema,
  rideStatusSchema,
} from './rides.ts';

/**
 * Booking contracts (E4): POST /bookings, GET /me/bookings, GET /bookings/{id},
 * POST /bookings/{id}/approve|reject|cancel, GET /me/summary, POST /me/summary/seen.
 * Shared with the web app (import through @contracts). STABLE: additive changes only.
 *
 * Money is integer bani, distances metres, times ISO 8601 UTC. The client never sends a price.
 *
 * Privacy (ADR 0005, ADR 0023): exact points, the passenger's exact route segment, the counterpart's
 * phone and the plate appear ONLY while `status` is `confirmed` or `completed` and
 * `now < departureAt + 24 h`. Otherwise points are 300 m grid centres (`approx: true`), `route` is
 * the trimmed public route (or null once coarsened), `contact` and `car.plate` are null. Labels
 * (`pickup.label`, `dropoff.label`, `pickupLabel`, `dropoffLabel`) are area names and always safe.
 *
 * Error codes (api-contract §1.1):
 * - POST /bookings: VALIDATION_FAILED (header `Idempotency-Key` missing, not a uuid, or reused for
 *   another ride: `fields.idempotencyKey` = `required` | `invalid` | `reused`; points outside
 *   coverage), NOT_FOUND (unknown ride, blocked or suspended driver), 409 OWN_RIDE, BLOCKED,
 *   ALREADY_REQUESTED (an active or rejected booking exists), RIDE_NOT_BOOKABLE, RIDE_FULL,
 *   NO_LONGER_MATCHES, 429 RATE_LIMITED (10/hour). Gates: consent + complete profile.
 * - GET /bookings/{id}: NOT_FOUND for anyone except the passenger and the ride's driver.
 * - approve: 409 REQUEST_EXPIRED, RIDE_FULL, BLOCKED, INVALID_STATE. reject: REQUEST_EXPIRED,
 *   INVALID_STATE. cancel: INVALID_STATE (terminal state, or already departed).
 */

export const BOOKING_LIMITS = {
  /** A request expires after this many minutes (or 10 minutes before departure, whichever is first). */
  expiryMin: 30,
  /** No requests when the ride departs in under this many minutes. */
  cutoffMin: 10,
  /** Cancelling a confirmed booking within this many minutes of departure is a late cancellation. */
  lateCancelMin: 30,
  /** Phone, plate and exact points stay visible until departure plus this many hours. */
  contactWindowH: 24,
  /** `POST /me/summary/seen` accepts at most this many ids. */
  seenMax: 50,
} as const;

// ---- Building blocks ---------------------------------------------------------------------------------

export const bookingViewerRoleSchema = z.enum(['passenger', 'driver']);
export type BookingViewerRole = z.infer<typeof bookingViewerRoleSchema>;

export const cancelledBySchema = z.enum(['passenger', 'driver', 'system']);
export type CancelledBy = z.infer<typeof cancelledBySchema>;

/** `ride_cancelled` replaces `cancelled` when the driver cancelled the whole ride. */
export const timelineStatusSchema = z.union([bookingStatusSchema, z.literal('ride_cancelled')]);
export type TimelineStatus = z.infer<typeof timelineStatusSchema>;

const bookingPlaceSchema = z.object({
  /** Exact (5 dp) only when revealed, else a 300 m grid centre. */
  point: exactOrApproxPointSchema,
  /** Area name. Never a street address. */
  label: z.string(),
  /** Straight-line walk between the typed point and the route, rounded to 50 m. */
  walkM: z.number().int().min(0),
});

export const bookingPriceSchema = z.object({
  /** "Up to" price shown at request time (passenger alone with the driver). */
  quotedBani: z.number().int().min(0),
  /** Set on approval. Only ever goes down. */
  lockedBani: z.number().int().min(0).nullable(),
  /** The final price: equals `lockedBani` once the ride has departed (E5 persists it). */
  finalBani: z.number().int().min(0).nullable(),
  /** The quote, when the locked price is lower than it. */
  droppedFromBani: z.number().int().min(0).nullable(),
});
export type BookingPrice = z.infer<typeof bookingPriceSchema>;

export const bookingCarSchema = carPublicSchema.extend({
  /** Null outside the reveal window and for the driver's own view of a hidden booking. */
  plate: z.string().nullable(),
});
export type BookingCar = z.infer<typeof bookingCarSchema>;

export const bookingContactSchema = z.object({
  /** The counterpart's phone: the driver's for a passenger viewer, the passenger's for the driver. */
  phoneE164: z.string(),
  revealedUntil: z.string(),
});
export type BookingContact = z.infer<typeof bookingContactSchema>;

export const bookingTimelineItemSchema = z.object({
  status: timelineStatusSchema,
  at: z.string(),
});
export type BookingTimelineItem = z.infer<typeof bookingTimelineItemSchema>;

export const bookingActionsSchema = z.object({
  canCancel: z.boolean(),
  /** Cancelling right now would be a late cancellation (confirmed, 30 min or less to departure). */
  lateCancelIfNow: z.boolean(),
  /** E5 fills the next five. Always false in E4. */
  canReportDriverNoShow: z.boolean(),
  canRate: z.boolean(),
  canShare: z.boolean(),
  show112: z.boolean(),
});
export type BookingActions = z.infer<typeof bookingActionsSchema>;

// ---- POST /bookings -------------------------------------------------------------------------------------
// Header `Idempotency-Key: <uuid>` (required). A replay with the same key and ride returns 201 with
// the current view; the same key with another ride is 400 (fields.idempotencyKey = reused).

export const idempotencyKeySchema = z.uuid();

export const createBookingBodySchema = z.object({
  rideId: z.uuid(),
  /** The passenger's typed origin and destination (same points as POST /rides/{id}/match). */
  from: latLngSchema,
  to: latLngSchema,
});
export type CreateBookingBody = z.infer<typeof createBookingBodySchema>;

// ---- BookingView: POST /bookings (201), GET /bookings/{id}, POST /bookings/{id}/cancel ---------------------

export const bookingViewSchema = z.object({
  id: z.uuid(),
  status: bookingStatusSchema,
  rideId: z.uuid(),
  rideStatus: rideStatusSchema,
  viewerRole: bookingViewerRoleSchema,
  departureAt: z.string(),
  /** When the driver passes the pickup, rounded to 5 minutes. */
  pickupEtaAt: z.string(),
  requestedAt: z.string(),
  /** When an unanswered request lapses. */
  expiresAt: z.string(),
  decidedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledBy: cancelledBySchema.nullable(),
  pickup: bookingPlaceSchema,
  dropoff: bookingPlaceSchema,
  segmentM: z.number().int(),
  /**
   * Revealed: the exact route between the passenger's own pickup and dropoff (never the driver's
   * full route). Not revealed: the trimmed public route. Null when the ride was coarsened.
   */
  route: geoLineStringSchema.nullable(),
  price: bookingPriceSchema,
  driver: publicUserSchema,
  passenger: publicUserSchema,
  car: bookingCarSchema,
  contact: bookingContactSchema.nullable(),
  timeline: z.array(bookingTimelineItemSchema),
  /** Passenger viewer only (false for the driver): an update the passenger has not opened yet. */
  unseen: z.boolean(),
  actions: bookingActionsSchema,
});
export type BookingView = z.infer<typeof bookingViewSchema>;

// ---- GET /me/bookings?scope=upcoming|past&limit&cursor ---------------------------------------------------
// Upcoming: requested or confirmed, departing after now, ascending. Past: everything else, descending.

export const bookingsQuerySchema = z.object({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});
export type BookingsQuery = z.input<typeof bookingsQuerySchema>;

export const bookingListItemSchema = z.object({
  id: z.uuid(),
  rideId: z.uuid(),
  status: bookingStatusSchema,
  rideStatus: rideStatusSchema,
  departureAt: z.string(),
  pickupEtaAt: z.string(),
  pickupLabel: z.string(),
  dropoffLabel: z.string(),
  driver: publicUserSchema,
  /** final ?? locked ?? quoted. */
  priceBani: z.number().int().min(0),
  unseen: z.boolean(),
});
export type BookingListItem = z.infer<typeof bookingListItemSchema>;

export const bookingListResponseSchema = z.object({
  items: z.array(bookingListItemSchema),
  /** Opaque. Pass back as `cursor` for the next page. */
  nextCursor: z.string().nullable(),
});
export type BookingListResponse = z.infer<typeof bookingListResponseSchema>;

// ---- POST /bookings/{id}/approve | reject | cancel --------------------------------------------------------
// Body `{}` (an empty body is accepted too). approve and reject return the RideOwnerView, cancel the BookingView.

export const bookingActionBodySchema = z.object({}).strict();

// ---- GET /me/summary and POST /me/summary/seen --------------------------------------------------------------

export const summaryResponseSchema = z.object({
  /** Open requests on the caller's own rides (not past their expiry). */
  driverPendingRequests: z.number().int().min(0),
  /** Bookings with a change the passenger has not opened yet. */
  passengerUnseenUpdates: z.number().int().min(0),
  /** The soonest upcoming confirmed booking or published ride. */
  nextRide: z
    .object({
      kind: z.enum(['booking', 'ride']),
      id: z.uuid(),
      departureAt: z.string(),
    })
    .nullable(),
});
export type SummaryResponse = z.infer<typeof summaryResponseSchema>;

/** Marks the caller's own bookings as seen. Ids that are not theirs are ignored. Response `204`. */
export const summarySeenBodySchema = z.object({
  bookingIds: z.array(z.uuid()).min(1).max(BOOKING_LIMITS.seenMax),
});
export type SummarySeenBody = z.infer<typeof summarySeenBodySchema>;
