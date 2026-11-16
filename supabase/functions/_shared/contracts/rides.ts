import { z } from 'zod';
import { publicUserSchema, fuelTypeSchema } from './account.ts';
import { latLngSchema } from './geo.ts';

/**
 * Ride contracts (E2): POST /rides/preview, POST /rides, GET /me/rides, GET /me/rides/{id},
 * POST /rides/{id}/cancel, GET /rides/{id} (public). Shared with the web app (import through
 * @contracts). STABLE: additive changes only. Money is integer bani, distances metres, times ISO UTC.
 */

/** Business limits the UI needs for its own affordances. The server enforces them (domain/rules.ts). */
export const RIDE_LIMITS = {
  minLeadMin: 15,
  maxLeadDays: 14,
  minRouteM: 1000,
  maxRouteM: 40000,
  maxSeats: 4,
  maxRidesPerDay: 4,
  noteMax: 200,
  labelMax: 80,
  previewTtlMin: 30,
} as const;

// ---- Shared building blocks ----------------------------------------------------------------

export const rideStatusSchema = z.enum(['published', 'cancelled', 'completed', 'expired']);
export type RideStatus = z.infer<typeof rideStatusSchema>;

export const bookingStatusSchema = z.enum([
  'requested',
  'confirmed',
  'rejected',
  'expired',
  'cancelled',
  'completed',
  'no_show',
]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

/** 300 m grid centre. Never an exact point. */
export const approxPointSchema = latLngSchema.extend({
  approx: z.literal(true),
  radiusM: z.literal(300),
});
export type ApproxPoint = z.infer<typeof approxPointSchema>;

/** GeoJSON LineString, coordinates are [lng, lat]. */
export const geoLineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});
export type GeoLineString = z.infer<typeof geoLineStringSchema>;

/** Price per seat when `passengers` people (excluding the driver) are confirmed on the whole route. */
export const priceRowSchema = z.object({
  passengers: z.number().int().min(1).max(4),
  priceBani: z.number().int().min(0),
});
export type PriceRow = z.infer<typeof priceRowSchema>;

export const carPublicSchema = z.object({
  make: z.string(),
  model: z.string(),
  colour: z.string(),
});
export type CarPublic = z.infer<typeof carPublicSchema>;

/** Owner view only: includes the plate. */
export const carOwnerSchema = carPublicSchema.extend({ plate: z.string() });
export type CarOwner = z.infer<typeof carOwnerSchema>;

// ---- POST /rides/preview ----------------------------------------------------------------------
// Requires consent + complete profile + vehicle. Rate limit 20/hour.
// Labels are optional: the server derives "<area>, <nearest place>" when they are missing.

export const previewBodySchema = z.object({
  origin: latLngSchema,
  destination: latLngSchema,
  originLabel: z.string().trim().max(RIDE_LIMITS.labelMax).optional(),
  destinationLabel: z.string().trim().max(RIDE_LIMITS.labelMax).optional(),
});
export type PreviewBody = z.infer<typeof previewBodySchema>;

export const previewResponseSchema = z.object({
  previewId: z.uuid(),
  expiresAt: z.string(),
  distanceM: z.number().int(),
  durationS: z.number().int(),
  /** Full simplified route (owner view). */
  route: geoLineStringSchema,
  originLabel: z.string(),
  destinationLabel: z.string(),
  /** One row per seat the vehicle offers (1..vehicle.seats). */
  priceTable: z.array(priceRowSchema),
  /** Fuel cost of the whole trip, rounded down, for "you recover about X of Y RON". */
  tripCostBani: z.number().int(),
  rateMicroPerKm: z.number().int(),
  fuelType: fuelTypeSchema,
});
export type PreviewResponse = z.infer<typeof previewResponseSchema>;

// ---- POST /rides ----------------------------------------------------------------------------------
// No price field exists: the server computes everything from the stored route and rate snapshot.

export const createRideBodySchema = z.object({
  previewId: z.uuid(),
  /** ISO 8601 UTC with Z, 15 min to 14 days ahead. */
  departureAt: z.iso.datetime(),
  seats: z.number().int().min(1).max(RIDE_LIMITS.maxSeats),
  note: z.string().trim().max(RIDE_LIMITS.noteMax).nullish(),
  isFree: z.boolean().default(false),
});
/** What the client sends (isFree optional). */
export type CreateRideBody = z.input<typeof createRideBodySchema>;
/** What the server sees after parsing (isFree defaulted). */
export type CreateRideRequest = z.output<typeof createRideBodySchema>;

// ---- Owner view: POST /rides (201), GET /me/rides/{id}, POST /rides/{id}/cancel (200) -----------
// E4: `requests` (open requests, never any point) and `passengers` (confirmed bookings) are filled.

const ownerPlaceSchema = z.object({ point: latLngSchema, label: z.string() });

/**
 * A booking point: exact (5 decimals) only inside the reveal window of a confirmed booking
 * (ADR 0023), else the 300 m grid centre with `approx: true`. The approx branch comes first so a
 * grid point is never parsed (and stripped) as an exact one.
 */
export const exactOrApproxPointSchema = z.union([approxPointSchema, latLngSchema]);
export type ExactOrApproxPoint = z.infer<typeof exactOrApproxPointSchema>;

const bookingPlaceSchema = z.object({ point: exactOrApproxPointSchema, label: z.string() });

export const rideRequestItemSchema = z.object({
  bookingId: z.uuid(),
  passenger: publicUserSchema,
  pickupLabel: z.string(),
  dropoffLabel: z.string(),
  segmentM: z.number().int(),
  priceIfAcceptedBani: z.number().int(),
  requestedAt: z.string(),
  expiresAt: z.string(),
});
export type RideRequestItem = z.infer<typeof rideRequestItemSchema>;

export const ridePassengerItemSchema = z.object({
  bookingId: z.uuid(),
  status: bookingStatusSchema,
  passenger: publicUserSchema,
  /** `label` is an area name. `point` is exact inside the reveal window, else approximate. */
  pickup: bookingPlaceSchema,
  dropoff: bookingPlaceSchema,
  /** Present only inside the contact window (confirmed or completed, before departure + 24 h). */
  phoneE164: z.string().nullable(),
  priceLockedBani: z.number().int().nullable(),
  finalPriceBani: z.number().int().nullable(),
  canMarkNoShow: z.boolean(),
  canRate: z.boolean(),
});
export type RidePassengerItem = z.infer<typeof ridePassengerItemSchema>;

export const rideOwnerViewSchema = z.object({
  id: z.uuid(),
  status: rideStatusSchema,
  departureAt: z.string(),
  origin: ownerPlaceSchema,
  destination: ownerPlaceSchema,
  route: geoLineStringSchema,
  distanceM: z.number().int(),
  durationS: z.number().int(),
  seatsOffered: z.number().int(),
  seatsBooked: z.number().int(),
  note: z.string().nullable(),
  isFree: z.boolean(),
  /** One row per offered seat. All zero for a free ride. */
  priceTable: z.array(priceRowSchema),
  tripCostBani: z.number().int(),
  fuelType: fuelTypeSchema,
  car: carOwnerSchema,
  requests: z.array(rideRequestItemSchema),
  passengers: z.array(ridePassengerItemSchema),
  /** True while published and before departure. */
  canCancel: z.boolean(),
  /** Cancelling right now would count as a late cancellation (30 min or less before departure). */
  lateCancelIfNow: z.boolean(),
  /** Set once cancelled: true when it was a late cancellation. */
  lateCancel: z.boolean(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
});
export type RideOwnerView = z.infer<typeof rideOwnerViewSchema>;

// ---- GET /me/rides?scope=upcoming|past&limit&cursor ------------------------------------------------

export const ridesQuerySchema = z.object({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});
export type RidesQuery = z.input<typeof ridesQuerySchema>;

export const rideListItemSchema = z.object({
  id: z.uuid(),
  departureAt: z.string(),
  originLabel: z.string(),
  destinationLabel: z.string(),
  status: rideStatusSchema,
  seatsOffered: z.number().int(),
  seatsBooked: z.number().int(),
  /** Open requests (`requested`, not past their expiry). */
  pendingRequests: z.number().int(),
});
export type RideListItem = z.infer<typeof rideListItemSchema>;

export const rideListResponseSchema = z.object({
  items: z.array(rideListItemSchema),
  /** Opaque. Pass back as `cursor` for the next page. */
  nextCursor: z.string().nullable(),
});
export type RideListResponse = z.infer<typeof rideListResponseSchema>;

// ---- POST /rides/{id}/cancel ---------------------------------------------------------------------------

/** Body is `{}` (an empty body is accepted too). Response: the owner view. */
export const cancelRideBodySchema = z.object({}).strict();

// ---- GET /rides/{id} (public) -------------------------------------------------------------------------
// Approximate points (300 m grid), area labels, trimmed route. Never the plate or exact points.

const publicPlaceSchema = z.object({ point: approxPointSchema, label: z.string() });

export const ridePublicViewSchema = z.object({
  id: z.uuid(),
  status: rideStatusSchema,
  departureAt: z.string(),
  durationS: z.number().int(),
  distanceM: z.number().int(),
  origin: publicPlaceSchema,
  destination: publicPlaceSchema,
  /** Trimmed by min(500 m, 10 %) at both ends and simplified at 25 m. */
  routePublic: geoLineStringSchema.nullable(),
  seatsOffered: z.number().int(),
  seatsLeft: z.number().int(),
  note: z.string().nullable(),
  isFree: z.boolean(),
  /** Full route, one row per offered seat. All zero for a free ride. */
  priceTable: z.array(priceRowSchema),
  car: carPublicSchema,
  driver: publicUserSchema,
  viewer: z.object({
    isDriver: z.boolean(),
    bookingId: z.uuid().nullable(),
    bookingStatus: bookingStatusSchema.nullable(),
    blocked: z.boolean(),
  }),
});
export type RidePublicView = z.infer<typeof ridePublicViewSchema>;
