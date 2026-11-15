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
} as const;
