import type { Clock } from './clock.ts';
import { DomainError } from './errors.ts';
import { inCoverage, toUtm35, type Point } from './privacy.ts';
import { MAX_RIDES_PER_DAY, MAX_ROUTE_M, MIN_ROUTE_M, ROUTE_PREVIEW_TTL_MIN } from './rules.ts';
import {
  addMinutes,
  bucharestDayBounds,
  bucharestDayKey,
  checkDeparture,
  isLateCancel,
} from './time.ts';

/** Ride publishing rules (E2). Pure: time comes from the injected Clock. */

export const NOTE_MAX_CHARS = 200;

const charCount = (s: string) => [...s].length;

/** Ride note: optional, at most 200 characters, NFC. Empty becomes null. */
export function normalizeNote(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const note = input.normalize('NFC').trim();
  if (note.length === 0) return null;
  if (charCount(note) > NOTE_MAX_CHARS) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid note.', { note: 'too_long' });
  }
  return note;
}

/** Route length must be 1 to 40 km (inclusive). */
export function checkRouteLength(distanceM: number): void {
  if (distanceM < MIN_ROUTE_M) throw new DomainError('ROUTE_TOO_SHORT', 'Route is under 1 km.');
  if (distanceM > MAX_ROUTE_M) throw new DomainError('ROUTE_TOO_LONG', 'Route is over 40 km.');
}

/** Seats offered cannot exceed the vehicle's seats. */
export function checkSeats(seats: number, vehicleSeats: number): void {
  if (seats > vehicleSeats) {
    throw new DomainError('SEATS_EXCEED_VEHICLE', 'More seats than the vehicle has.', {
      seats: 'too_many',
    });
  }
}

/** Departure 15 min to 14 days ahead. */
export function assertDeparture(departureAt: Date, clock: Clock): void {
  const violation = checkDeparture(departureAt, clock);
  if (violation) throw new DomainError(violation, 'Departure time is out of range.');
}

/** [start, end) of the Europe/Bucharest calendar day the ride departs on (daily limit window). */
export function departureDayBounds(departureAt: Date): { startUtc: Date; endUtc: Date } {
  return bucharestDayBounds(bucharestDayKey(departureAt));
}

/** `existing` = the driver's non-cancelled rides departing that Bucharest day. */
export function assertDailyLimit(existing: number): void {
  if (existing >= MAX_RIDES_PER_DAY) {
    throw new DomainError('DAILY_RIDE_LIMIT', 'You can publish up to 4 rides per day.');
  }
}

/** A preview is usable for 30 minutes after creation. */
export function previewExpiresAt(createdAt: Date): Date {
  return addMinutes(createdAt, ROUTE_PREVIEW_TTL_MIN);
}

export type RideCancelContext = { status: string; departureAt: Date };

/** Only a published ride that has not departed can be cancelled. */
export function canCancelRide(ride: RideCancelContext, clock: Clock): boolean {
  return ride.status === 'published' && ride.departureAt.getTime() > clock.now().getTime();
}

/** Cancelling within 30 min of departure counts as a late cancellation. */
export function isLateRideCancel(ride: RideCancelContext, clock: Clock): boolean {
  return canCancelRide(ride, clock) && isLateCancel(ride.departureAt, clock);
}

// ---- preview input ------------------------------------------------------------------------------

/** Origin and destination closer than this are "the same place". */
export const MIN_PLACE_SEPARATION_M = 100;

/**
 * Preview points must be inside the Sibiu coverage box (the gazetteer, tiles and rate config only
 * cover it) and at least 100 m apart. Rule order: coverage first, then SAME_PLACE.
 */
export function assertPreviewPoints(origin: Point, destination: Point): void {
  const fields: Record<string, string> = {};
  if (!inCoverage(origin)) fields.origin = 'outside_coverage';
  if (!inCoverage(destination)) fields.destination = 'outside_coverage';
  if (Object.keys(fields).length > 0) {
    throw new DomainError('VALIDATION_FAILED', 'Both points must be in the Sibiu area.', fields);
  }
  const a = toUtm35(origin);
  const b = toUtm35(destination);
  if (Math.hypot(a.x - b.x, a.y - b.y) < MIN_PLACE_SEPARATION_M) {
    throw new DomainError('SAME_PLACE', 'Origin and destination are the same place.');
  }
}

const LABEL_MAX_CHARS = 80;
const FALLBACK_LABEL = 'Sibiu';

const clip = (s: string) => [...s].slice(0, LABEL_MAX_CHARS).join('').trim();

/** Driver-supplied label: NFC, whitespace collapsed, at most 80 characters. Empty becomes null. */
export function normalizeLabel(input: string | undefined | null): string | null {
  if (input === undefined || input === null) return null;
  const label = input.normalize('NFC').replace(/\s+/g, ' ').trim();
  return label.length === 0 ? null : clip(label);
}

/** `<area>, <nearest place>` (e.g. "Șelimbăr, Shopping City Sibiu"), degrading gracefully. */
export function deriveLabel(areaName: string | null, placeName: string | null): string {
  const parts = [areaName, placeName].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length === 0 ? FALLBACK_LABEL : clip(parts.join(', '));
}
