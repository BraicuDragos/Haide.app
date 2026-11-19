import { AUTO_ACCEPT_MIN_RATING, MIN_RATINGS_TO_SHOW } from './rules.ts';
import { assertPayloadSafe, type BookingAutoConfirmedPayload, type OutboxRow } from './outbox.ts';

/**
 * Auto-accept eligibility (E8-3, ADR 0037). Visible ratings only (blind ratings, ADR 0025): a
 * passenger with fewer than 3 visible ratings is "New" and eligible; otherwise the visible average
 * must be at least 4.0.
 */
export function isAutoAcceptEligible(p: {
  ratingCount: number;
  ratingAvg: number | null;
}): boolean {
  if (p.ratingCount < MIN_RATINGS_TO_SHOW) return true;
  return p.ratingAvg !== null && p.ratingAvg >= AUTO_ACCEPT_MIN_RATING;
}

/** To the driver, instead of `booking_requested`, when a seat was confirmed automatically. */
export function bookingAutoConfirmedOutbox(
  driverId: string,
  payload: BookingAutoConfirmedPayload,
): OutboxRow<'booking_auto_confirmed'> {
  assertPayloadSafe(payload);
  return { userId: driverId, template: 'booking_auto_confirmed', payload };
}
