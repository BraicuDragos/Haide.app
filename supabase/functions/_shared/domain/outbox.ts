/**
 * Outbox payloads (E4-6, e4-bookings-spec §6.1). Pure types and one safety check. The payload holds
 * ids, ISO times, first names and AREA NAMES only: never coordinates, phones, plates or emails
 * (conventions §6, ADR 0022, ADR 0023).
 */

export type BookingRequestedPayload = {
  bookingId: string;
  rideId: string;
  passengerFirstName: string | null;
  departureAt: string;
  pickupArea: string;
  dropoffArea: string;
  expiresAt: string;
};

export type BookingConfirmedPayload = {
  bookingId: string;
  driverFirstName: string | null;
  departureAt: string;
  pickupEtaAt: string;
  pickupArea: string;
};

export type BookingRejectedPayload = {
  bookingId: string;
  driverFirstName: string | null;
  departureAt: string;
};

export type BookingExpiredPayload = {
  bookingId: string;
  driverFirstName: string | null;
  departureAt: string;
};

export type RideCancelledPayload = {
  bookingId: string;
  rideId: string;
  driverFirstName: string | null;
  departureAt: string;
  pickupArea: string;
  dropoffArea: string;
};

export type BookingCancelledPayload = {
  bookingId: string;
  rideId: string;
  passengerFirstName: string | null;
  departureAt: string;
};

export type OutboxPayloadMap = {
  booking_requested: BookingRequestedPayload;
  booking_confirmed: BookingConfirmedPayload;
  booking_rejected: BookingRejectedPayload;
  booking_expired: BookingExpiredPayload;
  ride_cancelled: RideCancelledPayload;
  booking_cancelled: BookingCancelledPayload;
};

export type OutboxTemplate = keyof OutboxPayloadMap;

export const OUTBOX_TEMPLATES = [
  'booking_requested',
  'booking_confirmed',
  'booking_rejected',
  'booking_expired',
  'ride_cancelled',
  'booking_cancelled',
] as const satisfies readonly OutboxTemplate[];

/** One row to insert into app.outbox. Distributes over the template so payload and name stay paired. */
export type OutboxRow<T extends OutboxTemplate = OutboxTemplate> = {
  [K in T]: { userId: string; template: K; payload: OutboxPayloadMap[K] };
}[T];

export const isOutboxTemplate = (v: string): v is OutboxTemplate =>
  (OUTBOX_TEMPLATES as readonly string[]).includes(v);

// ---- payload safety ---------------------------------------------------------------------------------

const COORDINATE_RE = /-?\d{1,3}\.\d{4,}/; // 4 or more decimals: an exact coordinate
const PHONE_RE = /\+\d{6,}|\b0[67]\d{8}\b/; // E.164 or a Romanian mobile
const PLATE_RE = /\b[A-Z]{1,2}\s?\d{2,3}\s?[A-Z]{3}\b/; // SB12ABC, B123ABC
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * Throws when a serialised payload contains something that looks like a coordinate, phone, plate or
 * email address. Used by the builders as a last guard and by the tests. ISO timestamps are fine
 * (they have 3 decimals at most and no letters directly after the dot).
 */
export function assertPayloadSafe(payload: unknown): void {
  const text = JSON.stringify(payload);
  if (
    COORDINATE_RE.test(text) ||
    PHONE_RE.test(text) ||
    PLATE_RE.test(text) ||
    EMAIL_RE.test(text)
  ) {
    throw new Error('outbox payload holds a coordinate, phone, plate or email');
  }
}
