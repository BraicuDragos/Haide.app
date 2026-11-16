import { z } from 'zod';
import { publicUserSchema } from './account.ts';
import { latLngSchema } from './geo.ts';
import { approxPointSchema } from './rides.ts';

/**
 * Search and matching contracts (E3): POST /search and POST /rides/{id}/match. Both are public
 * (they work signed out; a bearer token, when sent, hides own and blocked rides). Shared with the
 * web app (import through @contracts). STABLE: additive changes only.
 *
 * Privacy (ADR 0005): every point is a 300 m grid centre (`approx: true`), walk distances are
 * rounded to 50 m, pickup ETAs to 5 minutes. No exact coordinate, plate or phone ever appears.
 * Money is integer bani, distances metres, times ISO 8601 UTC. The client never sends a price.
 *
 * Error codes (api-contract §1.1):
 * - POST /search: VALIDATION_FAILED (fields: from|to = outside_coverage, date/time/windowMin),
 *   SAME_PLACE (from and to closer than 1 km, fields.to = too_close), RATE_LIMITED (30/min).
 * - POST /rides/{id}/match: VALIDATION_FAILED, NOT_FOUND (unknown, malformed id, cancelled or
 *   expired ride for a non-driver, suspended or blocked driver: blocked either way looks the same
 *   as missing, so nobody learns who blocked whom), RATE_LIMITED (60/min). A ride that cannot be
 *   booked is a 200 with `bookable: false` and a reason, never an error.
 */

export const SEARCH_LIMITS = {
  /** Allowed `windowMin` values (± minutes around the desired time). */
  windowsMin: [15, 30, 60],
  defaultWindowMin: 30,
  /** `from` and `to` must be at least this far apart. */
  minSeparationM: 1000,
  /** Walking limit between a typed point and the driver's route (straight line). */
  maxWalkM: 800,
  /** Shortest ride segment that is offered. */
  minSegmentM: 1000,
  /** Results are capped at this many. */
  maxResults: 50,
  /** `nearestOutsideWindow` holds at most this many items. */
  nearestMax: 3,
  /** Walk distances are rounded to this step. */
  walkRoundM: 50,
  /** Pickup ETAs are rounded to this step. */
  etaRoundMin: 5,
} as const;

export const searchWindowSchema = z.union([z.literal(15), z.literal(30), z.literal(60)]);
export type SearchWindow = z.infer<typeof searchWindowSchema>;

// ---- POST /search -----------------------------------------------------------------------------------
// Coordinates travel in the POST body, never in URLs (keeps them out of access logs).

export const searchBodySchema = z.object({
  from: latLngSchema,
  to: latLngSchema,
  /** Calendar day in Europe/Bucharest, `YYYY-MM-DD`. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Desired departure, 24 h wall-clock time in Europe/Bucharest, `HH:MM`. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  windowMin: searchWindowSchema.default(SEARCH_LIMITS.defaultWindowMin),
});
/** What the client sends (`windowMin` optional, defaults to 30). */
export type SearchBody = z.input<typeof searchBodySchema>;
/** What the server sees after parsing. */
export type SearchRequest = z.output<typeof searchBodySchema>;

/** Where the passenger gets in or out: approximate point, area label, walk in metres (50 m steps). */
export const searchPlaceSchema = z.object({
  point: approxPointSchema,
  /** Gazetteer area name of the approximate point (`Sibiu` when unknown). */
  label: z.string(),
  walkM: z.number().int().min(0),
});
export type SearchPlace = z.infer<typeof searchPlaceSchema>;

/** The driver as shown on a result card: a slice of PublicUser. */
export const searchDriverSchema = publicUserSchema.pick({
  id: true,
  firstName: true,
  photoUrl: true,
  rating: true,
});
export type SearchDriver = z.infer<typeof searchDriverSchema>;

/** One result card (also the shape of `nearestOutsideWindow` items). */
export const searchItemSchema = z.object({
  rideId: z.uuid(),
  departureAt: z.string(),
  /** When the driver passes the pickup point, rounded to 5 minutes. */
  pickupEtaAt: z.string(),
  pickup: searchPlaceSchema,
  dropoff: searchPlaceSchema,
  /** Driving distance of this passenger's part of the route, metres. */
  segmentM: z.number().int(),
  /** "Up to X RON": the price when the passenger rides alone with the driver. 0 when `isFree`. */
  priceUpToBani: z.number().int().min(0),
  isFree: z.boolean(),
  seatsLeft: z.number().int().min(1),
  driver: searchDriverSchema,
});
export type SearchItem = z.infer<typeof searchItemSchema>;

export const searchResponseSchema = z.object({
  /** Sorted by pickup.walkM + dropoff.walkM, then |departureAt - desired time|. At most 50. */
  items: z.array(searchItemSchema),
  /**
   * Same item shape, at most 3, same Bucharest day, outside the requested window, nearest in time
   * first. Always present; empty unless `items` is empty.
   */
  nearestOutsideWindow: z.array(searchItemSchema),
  /** Rides in the window that were left out because of a block (either direction). */
  hiddenBlockedCount: z.number().int().min(0),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

// ---- POST /rides/{id}/match -------------------------------------------------------------------------

export const matchBodySchema = z.object({ from: latLngSchema, to: latLngSchema });
export type MatchBody = z.infer<typeof matchBodySchema>;

/**
 * Why the "Request seat" button is disabled. BLOCKED is kept for POST /bookings (E4): /match answers
 * 404 for a blocked pair instead. ALREADY_REQUESTED arrives with E4 (bookings).
 */
export const notBookableReasonSchema = z.enum([
  'RIDE_FULL',
  'RIDE_NOT_BOOKABLE',
  'OWN_RIDE',
  'BLOCKED',
  'ALREADY_REQUESTED',
  'NO_LONGER_MATCHES',
]);
export type NotBookableReason = z.infer<typeof notBookableReasonSchema>;

/**
 * Passenger-specific view of one ride. When the typed points do not fit the ride (reason
 * NO_LONGER_MATCHES), pickup, dropoff, segmentM, priceUpToBani and pickupEtaAt are all null.
 * Reason priority: OWN_RIDE, RIDE_NOT_BOOKABLE (cancelled, completed, expired, departs in under
 * 10 minutes), RIDE_FULL, NO_LONGER_MATCHES.
 */
export const matchResponseSchema = z.object({
  pickup: searchPlaceSchema.nullable(),
  dropoff: searchPlaceSchema.nullable(),
  segmentM: z.number().int().nullable(),
  priceUpToBani: z.number().int().min(0).nullable(),
  pickupEtaAt: z.string().nullable(),
  seatsLeft: z.number().int().min(0),
  bookable: z.boolean(),
  notBookableReason: notBookableReasonSchema.nullable(),
});
export type MatchResponse = z.infer<typeof matchResponseSchema>;
