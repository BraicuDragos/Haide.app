import type { Clock } from './clock.ts';
import { DomainError } from './errors.ts';
import { inCoverage, toUtm35, type Point } from './privacy.ts';
import { assertPayloadSafe, type OutboxRow } from './outbox.ts';
import {
  BOOKING_CUTOFF_MIN,
  MAX_RIDES_PER_DAY,
  MAX_ROUTE_M,
  MAX_SEATS,
  MIN_ROUTE_M,
  ROUTE_PREVIEW_TTL_MIN,
} from './rules.ts';
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

// ---- editing a published ride (ADR 0041) --------------------------------------------------------

/** What a driver may change on a published ride. The route, price and vehicle are never editable. */
export const EDITABLE_RIDE_FIELDS = ['departureAt', 'seats', 'note', 'autoAccept'] as const;

/** Fields a client may try to send that are fixed once published (answered ROUTE_NOT_EDITABLE). */
export const FIXED_RIDE_FIELDS = [
  'origin',
  'destination',
  'originLabel',
  'destinationLabel',
  'route',
  'previewId',
  'isFree',
  'price',
  'priceTable',
  'vehicle',
  'car',
  'distanceM',
  'durationS',
] as const;

export type RideEditCurrent = {
  status: string;
  departureAt: Date;
  seatsOffered: number;
  seatsBooked: number;
  note: string | null;
  autoAccept: boolean;
};

/** The parsed request: an absent key means "unchanged", `note: null` clears the note. */
export type RideEditPatch = {
  departureAt?: Date | undefined;
  seats?: number | undefined;
  note?: string | null | undefined;
  autoAccept?: boolean | undefined;
};

export type RideEditPlan = {
  departureAt: Date;
  seats: number;
  note: string | null;
  autoAccept: boolean;
  timeChanged: boolean;
  seatsChanged: boolean;
  noteChanged: boolean;
  autoAcceptChanged: boolean;
};

/** A published ride that has not departed can be edited (the same window as cancelling it). */
export function canEditRide(ride: RideCancelContext, clock: Clock): boolean {
  return canCancelRide(ride, clock);
}

/**
 * Validates an edit and returns the new values plus what changed. Pure.
 * - the ride must be published and not departed (RIDE_NOT_EDITABLE);
 * - a changed departure must satisfy the publish lead rule (15 min to 14 days ahead); an unchanged
 *   one is not re-checked, so seats or note can still be fixed minutes before departure;
 * - seats are 1..4 and never below the seats already confirmed (SEATS_BELOW_BOOKED).
 * The vehicle seat limit and the daily limit need the database and are checked by the service.
 */
export function planRideEdit(
  current: RideEditCurrent,
  patch: RideEditPatch,
  clock: Clock,
): RideEditPlan {
  if (!canEditRide({ status: current.status, departureAt: current.departureAt }, clock)) {
    throw new DomainError(
      'RIDE_NOT_EDITABLE',
      'Only a published ride that has not departed can be edited.',
    );
  }
  const departureAt = patch.departureAt ?? current.departureAt;
  const timeChanged = departureAt.getTime() !== current.departureAt.getTime();
  if (timeChanged) assertDeparture(departureAt, clock);

  const seats = patch.seats ?? current.seatsOffered;
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid seats.', { seats: 'out_of_range' });
  }
  if (seats < current.seatsBooked) {
    throw new DomainError(
      'SEATS_BELOW_BOOKED',
      'Seats cannot be fewer than the seats already booked.',
      { seats: 'below_booked' },
    );
  }

  const note = patch.note === undefined ? current.note : normalizeNote(patch.note);
  const autoAccept = patch.autoAccept ?? current.autoAccept;
  return {
    departureAt,
    seats,
    note,
    autoAccept,
    timeChanged,
    seatsChanged: seats !== current.seatsOffered,
    noteChanged: note !== current.note,
    autoAcceptChanged: autoAccept !== current.autoAccept,
  };
}

/**
 * Latest moment a pending request may stay open once the ride leaves at `departureAt`: the cutoff
 * margin before departure, the same one `bookingExpiresAt` applies when a request is created.
 */
export function requestExpiryCap(departureAt: Date): Date {
  return new Date(departureAt.getTime() - BOOKING_CUTOFF_MIN * 60_000);
}

/** One `ride_updated` row per passenger with a requested or confirmed booking (their own areas). */
export function rideUpdatedRows(
  ride: {
    id: string;
    driverFirstName: string | null;
    previousDepartureAt: Date;
    departureAt: Date;
  },
  bookings: readonly {
    id: string;
    passengerId: string;
    pickupArea: string;
    dropoffArea: string;
  }[],
): OutboxRow<'ride_updated'>[] {
  return bookings.map((b) => {
    const payload = {
      bookingId: b.id,
      rideId: ride.id,
      driverFirstName: ride.driverFirstName,
      previousDepartureAt: ride.previousDepartureAt.toISOString(),
      departureAt: ride.departureAt.toISOString(),
      pickupArea: b.pickupArea,
      dropoffArea: b.dropoffArea,
    };
    assertPayloadSafe(payload);
    return { userId: b.passengerId, template: 'ride_updated', payload };
  });
}
