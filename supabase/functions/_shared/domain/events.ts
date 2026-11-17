/**
 * Analytics events (E7-1, ADR 0032, e7-metrics-admin-spec §2). One typed registry for the 11 product
 * events: names (same order as the CHECK on app.analytics_events), the props of each, the builders
 * and `eventPropsOk`, which mirrors the database guard `app.event_props_ok` case for case.
 * Pure: no I/O. Props are flat (string, number, boolean, null), short, and never hold a coordinate,
 * phone, plate, email or free text (conventions §6).
 */

export const EVENT_NAMES = [
  'search_performed',
  'ride_published',
  'booking_requested',
  'booking_confirmed',
  'booking_rejected',
  'booking_expired',
  'booking_cancelled',
  'ride_completed',
  'no_show_reported',
  'rating_submitted',
  'report_submitted',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export const isEventName = (v: string): v is EventName =>
  (EVENT_NAMES as readonly string[]).includes(v);

type Role = 'driver' | 'passenger';

/** The props of each event: exactly the allow-list of spec §2. */
export type EventProps = {
  search_performed: {
    resultsCount: number;
    fromArea: string | null;
    toArea: string | null;
    windowMin: number;
    corridor: string;
  };
  ride_published: {
    rideId: string;
    distanceM: number;
    seats: number;
    isFree: boolean;
    originArea: string | null;
    destinationArea: string | null;
  };
  booking_requested: { bookingId: string; rideId: string; segmentM: number };
  booking_confirmed: { bookingId: string; rideId: string; responseSeconds: number };
  booking_rejected: { bookingId: string; rideId: string; responseSeconds: number };
  booking_expired: { bookingId: string; rideId: string };
  booking_cancelled: {
    bookingId: string;
    rideId: string;
    by: 'passenger' | 'driver' | 'system';
    late: boolean;
  };
  ride_completed: { rideId: string; seats: number };
  no_show_reported: { bookingId: string; rideId: string; by: Role };
  rating_submitted: { bookingId: string; stars: number; tagCount: number; raterRole: Role };
  report_submitted: { reason: string; alsoBlock: boolean };
};

/** One row for app.analytics_events. `userId` is the actor (NULL for a signed-out search). */
export type AnalyticsEvent = {
  [K in EventName]: { name: K; userId: string | null; props: EventProps[K]; at: Date };
}[EventName];

/** The allow-listed prop keys per event, derived from a sample so the test can assert them. */
export const EVENT_PROP_KEYS: { [K in EventName]: readonly (keyof EventProps[K] & string)[] } = {
  search_performed: ['resultsCount', 'fromArea', 'toArea', 'windowMin', 'corridor'],
  ride_published: ['rideId', 'distanceM', 'seats', 'isFree', 'originArea', 'destinationArea'],
  booking_requested: ['bookingId', 'rideId', 'segmentM'],
  booking_confirmed: ['bookingId', 'rideId', 'responseSeconds'],
  booking_rejected: ['bookingId', 'rideId', 'responseSeconds'],
  booking_expired: ['bookingId', 'rideId'],
  booking_cancelled: ['bookingId', 'rideId', 'by', 'late'],
  ride_completed: ['rideId', 'seats'],
  no_show_reported: ['bookingId', 'rideId', 'by'],
  rating_submitted: ['bookingId', 'stars', 'tagCount', 'raterRole'],
  report_submitted: ['reason', 'alsoBlock'],
};

// ---- the guard (mirror of app.event_props_ok) -------------------------------------------------------

export const EVENT_PROPS_MAX_KEYS = 12;
export const EVENT_PROPS_MAX_KEY_CHARS = 40;
export const EVENT_PROPS_MAX_STRING_CHARS = 80;

/** Lower-case keys that may never appear in props (same list as the SQL function). */
export const FORBIDDEN_EVENT_KEYS: readonly string[] = [
  'lat',
  'lng',
  'lon',
  'latitude',
  'longitude',
  'coordinates',
  'point',
  'geom',
  'geometry',
  'origin',
  'destination',
  'pickup',
  'dropoff',
  'phone',
  'phonee164',
  'plate',
  'email',
  'details',
  'note',
  'firstname',
  'name',
];

/**
 * True when `p` is a flat object: at most 12 keys of at most 40 characters, none of them forbidden
 * (case-insensitive), every value a string of at most 80 characters, a finite number, a boolean or
 * null. Arrays, nested objects and everything that is not a plain object fail.
 */
export function eventPropsOk(p: unknown): boolean {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return false;
  const entries = Object.entries(p);
  if (entries.length > EVENT_PROPS_MAX_KEYS) return false;
  for (const [key, value] of entries) {
    if ([...key].length > EVENT_PROPS_MAX_KEY_CHARS) return false;
    if (FORBIDDEN_EVENT_KEYS.includes(key.toLowerCase())) return false;
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value === 'string') {
      if ([...value].length > EVENT_PROPS_MAX_STRING_CHARS) return false;
      continue;
    }
    return false;
  }
  return true;
}

// ---- builders ---------------------------------------------------------------------------------------------

export const searchPerformedEvent = (
  userId: string | null,
  p: EventProps['search_performed'],
  at: Date,
): AnalyticsEvent => ({ name: 'search_performed', userId, props: p, at });

export const bookingRequestedEvent = (
  passengerId: string,
  p: EventProps['booking_requested'],
  at: Date,
): AnalyticsEvent => ({ name: 'booking_requested', userId: passengerId, props: p, at });

export const bookingConfirmedEvent = (
  driverId: string,
  p: EventProps['booking_confirmed'],
  at: Date,
): AnalyticsEvent => ({ name: 'booking_confirmed', userId: driverId, props: p, at });

export const bookingRejectedEvent = (
  driverId: string,
  p: EventProps['booking_rejected'],
  at: Date,
): AnalyticsEvent => ({ name: 'booking_rejected', userId: driverId, props: p, at });

export const bookingExpiredEvent = (
  passengerId: string,
  p: EventProps['booking_expired'],
  at: Date,
): AnalyticsEvent => ({ name: 'booking_expired', userId: passengerId, props: p, at });

export const bookingCancelledEvent = (
  actorId: string,
  p: EventProps['booking_cancelled'],
  at: Date,
): AnalyticsEvent => ({ name: 'booking_cancelled', userId: actorId, props: p, at });

export const rideCompletedEvent = (
  driverId: string,
  p: EventProps['ride_completed'],
  at: Date,
): AnalyticsEvent => ({ name: 'ride_completed', userId: driverId, props: p, at });

export const noShowReportedEvent = (
  actorId: string,
  p: EventProps['no_show_reported'],
  at: Date,
): AnalyticsEvent => ({ name: 'no_show_reported', userId: actorId, props: p, at });

export const ratingSubmittedEvent = (
  raterId: string,
  p: EventProps['rating_submitted'],
  at: Date,
): AnalyticsEvent => ({ name: 'rating_submitted', userId: raterId, props: p, at });

export const reportSubmittedEvent = (
  reporterId: string,
  p: EventProps['report_submitted'],
  at: Date,
): AnalyticsEvent => ({ name: 'report_submitted', userId: reporterId, props: p, at });
