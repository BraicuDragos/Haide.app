import type { BookingStatus, RideStatus } from '../contracts/rides.ts';
import type { Clock } from './clock.ts';
import { DomainError } from './errors.ts';
import {
  assertPayloadSafe,
  type BookingCancelledPayload,
  type BookingConfirmedPayload,
  type BookingExpiredPayload,
  type BookingRejectedPayload,
  type BookingRequestedPayload,
  type OutboxRow,
  type RideCancelledPayload,
} from './outbox.ts';
import { relock, seatPriceBani } from './pricing.ts';
import { canRateNow, rateUntil } from './ratings.ts';
import { CONTACT_WINDOW_H } from './rules.ts';
import { call112Window, call112WindowDto, canMarkNoShow, canShare, show112 } from './safety.ts';
import { bookingCutoffPassed, contactWindowOpen, isLateCancel } from './time.ts';

/**
 * Booking lifecycle rules (E4, e4-bookings-spec §2 to §4). Pure: no I/O, time from the injected
 * Clock, all pricing through pricing.ts. Server-side only.
 */

// ---- state machine -----------------------------------------------------------------------------------

/**
 * Allowed transitions (E4, extended in E5). `confirmed` becomes `completed` in the tick and
 * `no_show` (or `cancelled`) by a party. A `completed` booking can still become `no_show` for 24 h
 * after departure (a party reports it after the tick ran). Every other state is terminal. Every write
 * is a guarded UPDATE: `… WHERE id = $1 AND status IN (<from>)`.
 */
export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  requested: ['confirmed', 'rejected', 'expired', 'cancelled'],
  confirmed: ['cancelled', 'completed', 'no_show'],
  rejected: [],
  expired: [],
  cancelled: [],
  completed: ['no_show'],
  no_show: [],
};

export const ACTIVE_STATUSES: readonly BookingStatus[] = ['requested', 'confirmed'];

export const canTransition = (from: BookingStatus, to: BookingStatus): boolean =>
  BOOKING_TRANSITIONS[from].includes(to);

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError('INVALID_STATE', `A ${from} booking cannot become ${to}.`);
  }
}

// ---- request guards (POST /bookings) ------------------------------------------------------------------

export type RequestGuardInput = {
  viewerId: string;
  driverId: string;
  driverActive: boolean;
  /** A block exists between passenger and driver, in either direction. */
  blocked: boolean;
  /** The passenger already has a `requested`, `confirmed` or `rejected` booking on this ride. */
  hasActiveOrRejected: boolean;
  ride: { status: string; departureAt: Date; seatsOffered: number; seatsBooked: number };
  /** The re-run of app.match_rides found the ride for the typed points. */
  pointsMatch: boolean;
};

/**
 * The request checks in their fixed order (idempotency replay happens before this, in the
 * service): OWN_RIDE, BLOCKED, driver not active (NOT_FOUND), ALREADY_REQUESTED, RIDE_NOT_BOOKABLE,
 * RIDE_FULL, NO_LONGER_MATCHES. A declined passenger gets ALREADY_REQUESTED, so they cannot spam the
 * driver; after `cancelled` or `expired` they may ask again.
 */
export function assertCanRequest(input: RequestGuardInput, clock: Clock): void {
  if (input.viewerId === input.driverId) {
    throw new DomainError('OWN_RIDE', 'You cannot book your own ride.');
  }
  if (input.blocked) throw new DomainError('BLOCKED', 'You cannot book this ride.');
  if (!input.driverActive) throw new DomainError('NOT_FOUND', 'Ride not found.');
  if (input.hasActiveOrRejected) {
    throw new DomainError('ALREADY_REQUESTED', 'You already asked for a seat on this ride.');
  }
  const { ride } = input;
  if (ride.status !== 'published' || bookingCutoffPassed(ride.departureAt, clock)) {
    throw new DomainError('RIDE_NOT_BOOKABLE', 'This ride is not open for requests.');
  }
  if (ride.seatsBooked >= ride.seatsOffered) {
    throw new DomainError('RIDE_FULL', 'This ride is full.');
  }
  if (!input.pointsMatch) {
    throw new DomainError('NO_LONGER_MATCHES', 'This ride no longer fits your trip.');
  }
}

// ---- driver decisions (approve, reject) -------------------------------------------------------------------

export type DecisionInput = {
  booking: { status: BookingStatus; expiresAt: Date };
  ride: { status: string; seatsOffered: number; seatsBooked: number };
  blocked: boolean;
};

/**
 * Approve guards, in order: ride still published (INVALID_STATE), booking `requested` and not past
 * its expiry (REQUEST_EXPIRED for a lapsed or expired request, INVALID_STATE for any other state),
 * block either way (BLOCKED), a free seat (RIDE_FULL). The caller has already proved the driver
 * owns the ride (404 otherwise).
 */
export function assertCanApprove(input: DecisionInput, clock: Clock): void {
  assertDecidable(input, clock);
  if (input.blocked) throw new DomainError('BLOCKED', 'You cannot accept this request.');
  if (input.ride.seatsBooked >= input.ride.seatsOffered) {
    throw new DomainError('RIDE_FULL', 'This ride is full.');
  }
}

/** Reject guards: the same state checks as approve, no block or seat check. */
export function assertCanReject(input: Omit<DecisionInput, 'blocked'>, clock: Clock): void {
  assertDecidable({ ...input, blocked: false }, clock);
}

function assertDecidable(input: DecisionInput, clock: Clock): void {
  const { booking, ride } = input;
  if (ride.status !== 'published') {
    throw new DomainError('INVALID_STATE', 'This ride is no longer open.');
  }
  if (booking.status === 'expired') {
    throw new DomainError('REQUEST_EXPIRED', 'This request has expired.');
  }
  if (booking.status !== 'requested') {
    throw new DomainError('INVALID_STATE', `This request is already ${booking.status}.`);
  }
  if (booking.expiresAt.getTime() <= clock.now().getTime()) {
    throw new DomainError('REQUEST_EXPIRED', 'This request has expired.');
  }
}

// ---- passenger cancel ---------------------------------------------------------------------------------------

/**
 * A passenger can cancel a `requested` or `confirmed` booking until departure (INVALID_STATE
 * otherwise). Returns whether it counts as a late cancellation: confirmed, 30 minutes or less ahead.
 */
export function assertCanPassengerCancel(
  booking: { status: BookingStatus; departureAt: Date },
  clock: Clock,
): { late: boolean } {
  if (!canTransition(booking.status, 'cancelled')) {
    throw new DomainError('INVALID_STATE', `A ${booking.status} booking cannot be cancelled.`);
  }
  if (booking.departureAt.getTime() <= clock.now().getTime()) {
    throw new DomainError('INVALID_STATE', 'The ride has already left.');
  }
  return { late: booking.status === 'confirmed' && isLateCancel(booking.departureAt, clock) };
}

// ---- pricing: relock (ADR 0021, pricing.md section 4) --------------------------------------------------------

export type RelockInput = {
  id: string;
  segmentM: number;
  /** The quote at request time. The lock starts here when `lockedBani` is null. */
  quotedBani: number;
  lockedBani: number | null;
};

export type RelockResult = {
  id: string;
  lockedBani: number;
  /** The new lock is lower than the one the booking had before (the passenger gets a badge). */
  dropped: boolean;
};

/**
 * Recomputes every confirmed booking's price with n = the number of confirmed bookings:
 * `locked = min(old ?? quoted, seatPrice(segment, rate, n))`. A lock never goes up, so this is safe
 * to run after an approval and after a cancellation alike.
 */
export function relockConfirmed(
  confirmed: readonly RelockInput[],
  rateMicro: number,
  isFree: boolean,
): RelockResult[] {
  const n = confirmed.length;
  if (n === 0) return [];
  return confirmed.map((b) => {
    const before = b.lockedBani ?? b.quotedBani;
    const lockedBani = relock(before, seatPriceBani(b.segmentM, rateMicro, n, isFree));
    return { id: b.id, lockedBani, dropped: lockedBani < before };
  });
}

/** What the driver would collect from this request if accepted now: n = confirmed + 1. */
export function priceIfAcceptedBani(
  segmentM: number,
  rateMicro: number,
  confirmedCount: number,
  isFree: boolean,
): number {
  return seatPriceBani(segmentM, rateMicro, confirmedCount + 1, isFree);
}

export type BookingPriceInput = {
  quotedBani: number;
  lockedBani: number | null;
  finalBani: number | null;
};

/**
 * Price block of the booking view. `finalBani` is the stored final price (E5) or, for a confirmed
 * or completed booking, the locked price once the ride has departed.
 */
export function bookingPrice(
  b: BookingPriceInput & { status: BookingStatus; departureAt: Date },
  clock: Clock,
): {
  quotedBani: number;
  lockedBani: number | null;
  finalBani: number | null;
  droppedFromBani: number | null;
} {
  const departed = clock.now().getTime() >= b.departureAt.getTime();
  const settles = b.status === 'confirmed' || b.status === 'completed';
  const finalBani = b.finalBani ?? (departed && settles ? b.lockedBani : null);
  const dropped = b.lockedBani !== null && b.lockedBani < b.quotedBani;
  return {
    quotedBani: b.quotedBani,
    lockedBani: b.lockedBani,
    finalBani,
    droppedFromBani: dropped ? b.quotedBani : null,
  };
}

/** The price shown in lists: final ?? locked ?? quoted. */
export function displayPriceBani(p: BookingPriceInput): number {
  return p.finalBani ?? p.lockedBani ?? p.quotedBani;
}

// ---- reveal (ADR 0023) ------------------------------------------------------------------------------------------

/**
 * The single privacy rule: exact points, the exact own segment, the counterpart's phone and the plate
 * are exposed only for a confirmed or completed booking, strictly before departure + 24 h.
 */
export function revealFor(booking: { status: BookingStatus; departureAt: Date }, clock: Clock) {
  return (
    (booking.status === 'confirmed' || booking.status === 'completed') &&
    contactWindowOpen(booking.departureAt, clock)
  );
}

/** End of the reveal window: departure + 24 h. */
export function revealedUntil(departureAt: Date): Date {
  return new Date(departureAt.getTime() + CONTACT_WINDOW_H * 3_600_000);
}

// ---- booking view helpers -------------------------------------------------------------------------------------------

export type TimelineInput = {
  status: BookingStatus;
  requestedAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: 'passenger' | 'driver' | 'system' | null;
  /** The ride's status and completion time (E5). */
  rideStatus: RideStatus;
  completedAt: Date | null;
  noShowAt: Date | null;
};

/** Ordered status history reconstructed from the booking's own timestamps. */
export function buildTimeline(
  b: TimelineInput,
): { status: BookingStatus | 'ride_cancelled'; at: string }[] {
  const out: { status: BookingStatus | 'ride_cancelled'; at: string }[] = [
    { status: 'requested', at: b.requestedAt.toISOString() },
  ];
  // A decision timestamp exists for confirmed bookings (also those cancelled later) and rejected ones.
  if (b.decidedAt && b.status !== 'rejected') {
    out.push({ status: 'confirmed', at: b.decidedAt.toISOString() });
  }
  switch (b.status) {
    case 'rejected':
      if (b.decidedAt) out.push({ status: 'rejected', at: b.decidedAt.toISOString() });
      break;
    case 'expired':
      out.push({ status: 'expired', at: b.expiresAt.toISOString() });
      break;
    case 'cancelled':
      if (b.cancelledAt) {
        // The whole ride was cancelled (by the driver or by a suspension), not just this booking.
        const rideCancelled = b.rideStatus === 'cancelled' && b.cancelledBy !== 'passenger';
        out.push({
          status: rideCancelled ? 'ride_cancelled' : 'cancelled',
          at: b.cancelledAt.toISOString(),
        });
      }
      break;
    case 'completed':
      if (b.completedAt) out.push({ status: 'completed', at: b.completedAt.toISOString() });
      break;
    case 'no_show':
      // A booking the tick had already completed shows both steps. One reported first shows only the no-show.
      if (b.completedAt && b.noShowAt && b.completedAt.getTime() <= b.noShowAt.getTime()) {
        out.push({ status: 'completed', at: b.completedAt.toISOString() });
      }
      if (b.noShowAt) out.push({ status: 'no_show', at: b.noShowAt.toISOString() });
      break;
    default:
      break;
  }
  return out;
}

export type ActionsInput = {
  status: BookingStatus;
  departureAt: Date;
  viewerIsPassenger: boolean;
  rideStatus: RideStatus;
  /** The ride's completion time. */
  completedAt: Date | null;
  /** The viewer has rated this booking. */
  viewerRated: boolean;
  /** Either party has rated this booking. */
  anyRated: boolean;
};

/** What the viewer can do right now. Every flag and window comes from here: the client has no rules. */
export function bookingActions(b: ActionsInput, clock: Clock) {
  const canCancel =
    b.viewerIsPassenger &&
    canTransition(b.status, 'cancelled') &&
    b.departureAt.getTime() > clock.now().getTime();
  const noShow = canMarkNoShow(
    { status: b.status, departureAt: b.departureAt, hasRating: b.anyRated },
    clock,
  );
  const window = call112Window({ status: b.status, departureAt: b.departureAt });
  return {
    canCancel,
    lateCancelIfNow: canCancel && b.status === 'confirmed' && isLateCancel(b.departureAt, clock),
    canReportDriverNoShow: b.viewerIsPassenger && noShow,
    canMarkNoShow: !b.viewerIsPassenger && noShow,
    canRate: canRateNow(
      { status: b.status, completedAt: b.completedAt, alreadyRated: b.viewerRated },
      clock,
    ),
    canShare: canShare(
      {
        viewerIsPassenger: b.viewerIsPassenger,
        status: b.status,
        rideStatus: b.rideStatus,
        departureAt: b.departureAt,
      },
      clock,
    ),
    show112: show112(window, clock),
    call112Window: call112WindowDto(window),
  };
}

/** End of the rating window for a completed ride, else null. */
export const rateUntilOrNull = (completedAt: Date | null): Date | null =>
  completedAt ? rateUntil(completedAt) : null;

/** Request seconds between request and decision (analytics `responseSeconds`). */
export const responseSeconds = (requestedAt: Date, decidedAt: Date): number =>
  Math.max(0, Math.round((decidedAt.getTime() - requestedAt.getTime()) / 1000));

// ---- outbox builders (labels, first names, ids and times only) -------------------------------------------------------

const guard = <T extends OutboxRow>(row: T): T => {
  assertPayloadSafe(row.payload);
  return row;
};

export const bookingRequestedOutbox = (
  driverId: string,
  payload: BookingRequestedPayload,
): OutboxRow<'booking_requested'> =>
  guard({ userId: driverId, template: 'booking_requested', payload });

export const bookingConfirmedOutbox = (
  passengerId: string,
  payload: BookingConfirmedPayload,
): OutboxRow<'booking_confirmed'> =>
  guard({ userId: passengerId, template: 'booking_confirmed', payload });

export const bookingRejectedOutbox = (
  passengerId: string,
  payload: BookingRejectedPayload,
): OutboxRow<'booking_rejected'> =>
  guard({ userId: passengerId, template: 'booking_rejected', payload });

export const bookingExpiredOutbox = (
  passengerId: string,
  payload: BookingExpiredPayload,
): OutboxRow<'booking_expired'> =>
  guard({ userId: passengerId, template: 'booking_expired', payload });

export const bookingCancelledOutbox = (
  driverId: string,
  payload: BookingCancelledPayload,
): OutboxRow<'booking_cancelled'> =>
  guard({ userId: driverId, template: 'booking_cancelled', payload });

/** One `ride_cancelled` row per cancelled booking, each with that passenger's own areas. */
export function rideCancelledRows(
  items: readonly { passengerId: string; payload: RideCancelledPayload }[],
): OutboxRow<'ride_cancelled'>[] {
  return items.map((i) =>
    guard({ userId: i.passengerId, template: 'ride_cancelled', payload: i.payload }),
  );
}

// ---- analytics: the builders live in events.ts (E7), re-exported for compatibility ----------------------

export {
  bookingCancelledEvent,
  bookingConfirmedEvent,
  bookingExpiredEvent,
  bookingRejectedEvent,
  bookingRequestedEvent,
  type AnalyticsEvent,
} from './events.ts';
