/** Business constants (named, never inline). Units are in the name. */

// Time rules
export const MIN_LEAD_MIN = 15; // departure at least 15 min ahead
export const MAX_LEAD_DAYS = 14;
export const BOOKING_EXPIRY_MIN = 30;
export const BOOKING_CUTOFF_MIN = 10; // no requests when departing in < 10 min
export const LATE_CANCEL_MIN = 30;
export const CONTACT_WINDOW_H = 24; // phone/plate/exact points until departure + 24 h
export const RATING_WINDOW_DAYS = 7;
export const COMPLETE_AFTER_H = 2;
export const RELIABILITY_WINDOW_DAYS = 90;
export const COARSEN_AFTER_DAYS = 90;
export const ROUTE_PREVIEW_TTL_MIN = 30;

// Ride limits
export const MAX_RIDES_PER_DAY = 4;
export const MIN_ROUTE_M = 1000;
export const MAX_ROUTE_M = 40000;
export const MIN_SEATS = 1;
export const MAX_SEATS = 4;
export const MIN_SEGMENT_M = 1000;
export const MAX_WALK_M = 800;
export const WALK_ROUND_M = 50;
export const MIN_RATINGS_TO_SHOW = 3;

// Search (E3)
export const MIN_SEARCH_SEPARATION_M = 1000; // from and to at least 1 km apart
export const SEARCH_MAX_RESULTS = 50;
export const NEAREST_OUTSIDE_MAX = 3; // "nearest rides" in the empty state
export const ETA_ROUND_MIN = 5; // pickup ETA shown in 5 minute steps
export const SEARCH_WINDOWS_MIN = [15, 30, 60] as const;
export const SEARCH_DATE_PAST_DAYS = 1; // yesterday still allowed (midnight clock skew)
export const SEARCH_DATE_AHEAD_DAYS = 30;

// Pricing granularity (data-model: price_bani % 10 = 0)
export const PRICE_STEP_BANI = 10;

// Privacy grids (UTM 35N, EPSG:32635)
export const PUBLIC_GRID_M = 300;
export const COARSEN_GRID_M = 1000;
export const COORD_DECIMALS = 5;

/** Coverage bbox (Sibiu and surroundings). Same box as the gazetteer build. */
export const COVERAGE_BBOX = { south: 45.68, west: 23.98, north: 45.86, east: 24.32 } as const;

/** Rate limits (architecture §15): max hits per fixed window. */
export const RATE_LIMITS = {
  places: { max: 60, windowS: 60 },
  telemetry: { max: 20, windowS: 60 },
  search: { max: 30, windowS: 60 },
  publicRead: { max: 60, windowS: 60 },
  account: { max: 30, windowS: 60 },
  photo: { max: 10, windowS: 60 },
  // Rides (E2): previews call the router (2,000/day free). Publishes are also capped by the daily limit.
  ridePreview: { max: 20, windowS: 3600 },
  ridePublish: { max: 20, windowS: 3600 },
  // Bookings (E4). `GET /me/summary` reuses `account`.
  bookingRequest: { max: 10, windowS: 3600 },
  bookingAction: { max: 30, windowS: 60 },
} as const;

// Accounts (E1)
export const BIO_MAX_CHARS = 200;
export const FIRST_NAME_MAX_CHARS = 30;
export const VEHICLE_TEXT_MAX_CHARS = 30;
export const PHOTO_MAX_BYTES = 1_572_864; // 1.5 MiB upload cap
export const PHOTO_MAX_PIXELS = 8_000_000; // decode guard against decompression bombs
export const AVATAR_SIZE_PX = 512;
export const AVATAR_JPEG_QUALITY = 85;

/** Request body caps (bytes). Photo uploads get their own, larger cap (multipart overhead). */
export const BODY_LIMIT_DEFAULT_BYTES = 64 * 1024;
export const BODY_LIMIT_PHOTO_BYTES = PHOTO_MAX_BYTES + 64 * 1024;
