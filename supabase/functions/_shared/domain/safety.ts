import type { Call112Window } from '../contracts/ratings.ts';
import type { BookingStatus, RideStatus } from '../contracts/rides.ts';
import type { AnalyticsEvent } from './bookings.ts';
import type { Clock } from './clock.ts';
import { DomainError } from './errors.ts';
import {
  assertPayloadSafe,
  type NoShowReportedPayload,
  type OutboxRow,
  type RatingPromptDriverPayload,
  type RatingPromptPayload,
  type ReportReceivedPayload,
} from './outbox.ts';
import {
  CALL_112_AFTER_H,
  CALL_112_BEFORE_MIN,
  CONTACT_WINDOW_H,
  NO_SHOW_WINDOW_H,
} from './rules.ts';

/**
 * Safety rules (E5, e5-trust-safety-spec §2 and §5). Pure: no I/O, time from the injected Clock.
 */

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;

const accepted = (s: BookingStatus): boolean => s === 'confirmed' || s === 'completed';

// ---- no-show ----------------------------------------------------------------------------------------

/** A no-show can be reported from departure (inclusive) until departure + 24 h (exclusive). */
export function noShowWindowOpen(departureAt: Date, clock: Clock): boolean {
  const now = clock.now().getTime();
  const dep = departureAt.getTime();
  return now >= dep && now < dep + NO_SHOW_WINDOW_H * HOUR_MS;
}

export type NoShowInput = { status: BookingStatus; departureAt: Date; hasRating: boolean };

/**
 * No-show guards, in order (the caller has already proved they are a party, 404 otherwise):
 * status confirmed or completed (INVALID_STATE), the window (WINDOW_CLOSED), no rating on the
 * booking by either side (INVALID_STATE).
 */
export function assertCanMarkNoShow(input: NoShowInput, clock: Clock): void {
  if (!accepted(input.status)) {
    throw new DomainError('INVALID_STATE', `A ${input.status} booking cannot be a no-show.`);
  }
  if (!noShowWindowOpen(input.departureAt, clock)) {
    throw new DomainError('WINDOW_CLOSED', 'The time to report a no-show has passed.');
  }
  if (input.hasRating) {
    throw new DomainError('INVALID_STATE', 'A rated ride cannot become a no-show.');
  }
}

export function canMarkNoShow(input: NoShowInput, clock: Clock): boolean {
  return accepted(input.status) && noShowWindowOpen(input.departureAt, clock) && !input.hasRating;
}

// ---- share link -----------------------------------------------------------------------------------------

/** A share link stops working at departure + 24 h. */
export const shareExpiresAt = (departureAt: Date): Date =>
  new Date(departureAt.getTime() + CONTACT_WINDOW_H * HOUR_MS);

/** The passenger of a confirmed or completed booking on a ride that is not cancelled, before expiry. */
export function canShare(
  b: {
    viewerIsPassenger: boolean;
    status: BookingStatus;
    rideStatus: RideStatus;
    departureAt: Date;
  },
  clock: Clock,
): boolean {
  return (
    b.viewerIsPassenger &&
    accepted(b.status) &&
    b.rideStatus !== 'cancelled' &&
    clock.now().getTime() < shareExpiresAt(b.departureAt).getTime()
  );
}

export type SharePhase = 'before' | 'underway' | 'done';

/** `before` until departure, `underway` for 2 h unless the booking is completed, then `done`. */
export function sharePhase(
  b: { departureAt: Date; status: BookingStatus },
  clock: Clock,
): SharePhase {
  const now = clock.now().getTime();
  const dep = b.departureAt.getTime();
  if (now < dep) return 'before';
  if (now < dep + CALL_112_AFTER_H * HOUR_MS && b.status !== 'completed') return 'underway';
  return 'done';
}

// ---- Call 112 ------------------------------------------------------------------------------------------------

/** [departure - 15 min, departure + 2 h) for a confirmed or completed party, else null. */
export function call112Window(b: {
  status: BookingStatus;
  departureAt: Date;
}): { from: Date; until: Date } | null {
  if (!accepted(b.status)) return null;
  const dep = b.departureAt.getTime();
  return {
    from: new Date(dep - CALL_112_BEFORE_MIN * MIN_MS),
    until: new Date(dep + CALL_112_AFTER_H * HOUR_MS),
  };
}

export function show112(w: { from: Date; until: Date } | null, clock: Clock): boolean {
  if (!w) return false;
  const now = clock.now().getTime();
  return w.from.getTime() <= now && now < w.until.getTime();
}

export const call112WindowDto = (w: { from: Date; until: Date } | null): Call112Window | null =>
  w ? { from: w.from.toISOString(), until: w.until.toISOString() } : null;

// ---- outbox builders (ids, first names, roles, times and a reason enum only) ------------------------------------

const guard = <T extends OutboxRow>(row: T): T => {
  assertPayloadSafe(row.payload);
  return row;
};

export const ratingPromptOutbox = (
  passengerId: string,
  payload: RatingPromptPayload,
): OutboxRow<'rating_prompt'> => guard({ userId: passengerId, template: 'rating_prompt', payload });

export const ratingPromptDriverOutbox = (
  driverId: string,
  payload: RatingPromptDriverPayload,
): OutboxRow<'rating_prompt_driver'> =>
  guard({ userId: driverId, template: 'rating_prompt_driver', payload });

/** To the party who did not show. */
export const noShowReportedOutbox = (
  absentId: string,
  payload: NoShowReportedPayload,
): OutboxRow<'no_show_reported'> =>
  guard({ userId: absentId, template: 'no_show_reported', payload });

/** To each active admin. The reported user is never told. */
export const reportReceivedOutbox = (
  adminId: string,
  payload: ReportReceivedPayload,
): OutboxRow<'report_received'> => guard({ userId: adminId, template: 'report_received', payload });

// ---- analytics (no coordinates, phones or plates: conventions §6) -----------------------------------------------

export const rideCompletedEvent = (
  driverId: string,
  p: { rideId: string; seats: number },
  at: Date,
): AnalyticsEvent => ({ name: 'ride_completed', userId: driverId, props: p, at });

export const noShowReportedEvent = (
  actorId: string,
  p: { bookingId: string; rideId: string; by: 'driver' | 'passenger' },
  at: Date,
): AnalyticsEvent => ({ name: 'no_show_reported', userId: actorId, props: p, at });

export const ratingSubmittedEvent = (
  raterId: string,
  p: { bookingId: string; stars: number; tagCount: number; raterRole: 'driver' | 'passenger' },
  at: Date,
): AnalyticsEvent => ({ name: 'rating_submitted', userId: raterId, props: p, at });

export const reportSubmittedEvent = (
  reporterId: string,
  p: { reason: string; alsoBlock: boolean },
  at: Date,
): AnalyticsEvent => ({ name: 'report_submitted', userId: reporterId, props: p, at });
