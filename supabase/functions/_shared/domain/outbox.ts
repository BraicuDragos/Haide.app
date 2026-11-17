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
  /** E5: who cancelled. Absent on rows written before E5 (read as `driver`). `system` uses a neutral subject. */
  by?: 'driver' | 'system';
};

export type BookingCancelledPayload = {
  bookingId: string;
  rideId: string;
  passengerFirstName: string | null;
  departureAt: string;
};

/** E5: to each passenger of a completed ride (link `/rate/{bookingId}`). */
export type RatingPromptPayload = {
  bookingId: string;
  driverFirstName: string | null;
  departureAt: string;
};

/** E5: to the driver of a completed ride, once per ride (link `/driving/{rideId}`). */
export type RatingPromptDriverPayload = {
  rideId: string;
  passengerCount: number;
  departureAt: string;
};

/** E5: to the party who did not show. `reporterRole` is who reported it. */
export type NoShowReportedPayload = {
  bookingId: string;
  rideId: string;
  reporterFirstName: string | null;
  reporterRole: 'driver' | 'passenger';
  departureAt: string;
};

/** E5: to each active admin. The reported user is never told and the report text is not copied. */
export type ReportReceivedPayload = {
  reportId: string;
  reason: string;
};

/** E6: to the support address (routed by the dispatcher). Ids and a time only, never the email or the data. */
export type DataExportRequestedPayload = {
  requestId: string;
  userId: string;
  requestedAt: string;
};

/** E6: acknowledgement to the user who asked for a copy of their data. */
export type DataExportAckPayload = {
  requestId: string;
  dueBy: string;
};

/**
 * E7: to a user an admin suspended (statement of reasons, DSA Art. 17). `reasonCode` is a report reason
 * (the ground), `statement` is the admin's text (NFC, trimmed, 10..300 characters, no contact details).
 * Sent even though the account is now suspended (ANY_STATUS_TEMPLATES).
 */
export type AccountSuspendedPayload = {
  reasonCode: string;
  statement: string;
};

/** E7: to a user an admin reinstated. Nothing to say beyond the fact. */
export type AccountReinstatedPayload = Record<string, never>;

export type OutboxPayloadMap = {
  booking_requested: BookingRequestedPayload;
  booking_confirmed: BookingConfirmedPayload;
  booking_rejected: BookingRejectedPayload;
  booking_expired: BookingExpiredPayload;
  ride_cancelled: RideCancelledPayload;
  booking_cancelled: BookingCancelledPayload;
  rating_prompt: RatingPromptPayload;
  rating_prompt_driver: RatingPromptDriverPayload;
  no_show_reported: NoShowReportedPayload;
  report_received: ReportReceivedPayload;
  data_export_requested: DataExportRequestedPayload;
  data_export_ack: DataExportAckPayload;
  account_suspended: AccountSuspendedPayload;
  account_reinstated: AccountReinstatedPayload;
};

export type OutboxTemplate = keyof OutboxPayloadMap;

export const OUTBOX_TEMPLATES = [
  'booking_requested',
  'booking_confirmed',
  'booking_rejected',
  'booking_expired',
  'ride_cancelled',
  'booking_cancelled',
  'rating_prompt',
  'rating_prompt_driver',
  'no_show_reported',
  'report_received',
  'data_export_requested',
  'data_export_ack',
  'account_suspended',
  'account_reinstated',
] as const satisfies readonly OutboxTemplate[];

/** One row to insert into app.outbox. Distributes over the template so payload and name stay paired. */
export type OutboxRow<T extends OutboxTemplate = OutboxTemplate> = {
  [K in T]: { userId: string; template: K; payload: OutboxPayloadMap[K] };
}[T];

/**
 * Templates sent to the user whatever the account status (never to a deleted one): a suspension
 * notice and the acknowledgement of a data request must reach a suspended user (E7, E6).
 */
export const ANY_STATUS_TEMPLATES = [
  'account_suspended',
  'data_export_ack',
] as const satisfies readonly OutboxTemplate[];

export const isAnyStatusTemplate = (template: string): boolean =>
  (ANY_STATUS_TEMPLATES as readonly string[]).includes(template);

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
