import { z } from 'zod';

/** Stable error codes (api-contract §1.1). The web app maps them to i18n keys `errors.<CODE>`. */
export const ERROR_STATUS = {
  // 400
  VALIDATION_FAILED: 400,
  SAME_PLACE: 400,
  DEPARTURE_TOO_SOON: 400,
  DEPARTURE_TOO_FAR: 400,
  ROUTE_TOO_SHORT: 400,
  ROUTE_TOO_LONG: 400,
  SEATS_EXCEED_VEHICLE: 400,
  PREVIEW_EXPIRED: 400,
  PHOTO_INVALID: 400,
  PHOTO_TOO_LARGE: 400,
  CONFIRMATION_REQUIRED: 400,
  // ADR 0041: an edit that tries to change the route, the price or the vehicle
  ROUTE_NOT_EDITABLE: 400,
  // 401
  UNAUTHENTICATED: 401,
  // 403
  ACCOUNT_SUSPENDED: 403,
  ACCOUNT_DELETED: 403,
  CONSENT_REQUIRED: 403,
  PROFILE_INCOMPLETE: 403,
  VEHICLE_REQUIRED: 403,
  FORBIDDEN: 403,
  // 404
  NOT_FOUND: 404,
  // 409
  DAILY_RIDE_LIMIT: 409,
  RIDE_FULL: 409,
  RIDE_NOT_BOOKABLE: 409,
  OWN_RIDE: 409,
  BLOCKED: 409,
  ALREADY_REQUESTED: 409,
  NO_LONGER_MATCHES: 409,
  INVALID_STATE: 409,
  REQUEST_EXPIRED: 409,
  WINDOW_CLOSED: 409,
  ALREADY_RATED: 409,
  ALERT_LIMIT: 409,
  LARGE_CHANGE: 409,
  // ADR 0041: ride edit
  RIDE_NOT_EDITABLE: 409,
  SEATS_BELOW_BOOKED: 409,
  // 422
  ROUTE_NOT_FOUND: 422,
  // 429
  RATE_LIMITED: 429,
  // 5xx
  ROUTING_UNAVAILABLE: 503,
  // E6: a transaction lost a lock race twice (DELETE /me); the client may retry
  TEMPORARILY_UNAVAILABLE: 503,
  UPSTREAM_ERROR: 502,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const ERROR_CODES = Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]];

export const errorCodeSchema = z.enum(ERROR_CODES);

/** Error envelope (api-contract §1.1). */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
    requestId: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
