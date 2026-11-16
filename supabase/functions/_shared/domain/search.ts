import type { NotBookableReason } from '../contracts/search.ts';
import type { Clock } from './clock.ts';
import { DomainError } from './errors.ts';
import { inCoverage, toUtm35, type Point } from './privacy.ts';
import {
  ETA_ROUND_MIN,
  MIN_SEARCH_SEPARATION_M,
  SEARCH_DATE_AHEAD_DAYS,
  SEARCH_DATE_PAST_DAYS,
} from './rules.ts';
import {
  bookingCutoffPassed,
  bucharestDayBounds,
  bucharestDayKey,
  bucharestLocalToUtc,
} from './time.ts';

/** Search and match rules (E3). Pure: time comes from the injected Clock, no I/O. */

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

/** Both typed points must be inside the Sibiu coverage box (the match endpoint checks only this). */
export function assertInCoverage(from: Point, to: Point): void {
  const fields: Record<string, string> = {};
  if (!inCoverage(from)) fields.from = 'outside_coverage';
  if (!inCoverage(to)) fields.to = 'outside_coverage';
  if (Object.keys(fields).length > 0) {
    throw new DomainError('VALIDATION_FAILED', 'Both points must be in the Sibiu area.', fields);
  }
}

/**
 * Search points must be inside the Sibiu coverage box and at least 1 km apart (a shorter trip has
 * no segment of 1 km). Rule order: coverage first (fields name the offending points), then distance.
 */
export function assertSearchPoints(from: Point, to: Point): void {
  assertInCoverage(from, to);
  const a = toUtm35(from);
  const b = toUtm35(to);
  if (Math.hypot(a.x - b.x, a.y - b.y) < MIN_SEARCH_SEPARATION_M) {
    throw new DomainError('SAME_PLACE', 'From and to must be at least 1 km apart.', {
      to: 'too_close',
    });
  }
}

export type SearchTimes = {
  /** The desired departure. */
  desiredAt: Date;
  /** Window [fromAt, toAt], inclusive. */
  fromAt: Date;
  toAt: Date;
  /** Bucharest calendar day of the desired time, as [dayStartAt, dayEndAt] (end inclusive). */
  dayStartAt: Date;
  dayEndAt: Date;
};

/**
 * `date` + `time` are Europe/Bucharest wall-clock. The date must lie between yesterday and 30 days
 * ahead (Bucharest days), which also keeps absurd years out of the date arithmetic.
 */
export function searchTimes(
  date: string,
  time: string,
  windowMin: number,
  clock: Clock,
): SearchTimes {
  const now = clock.now().getTime();
  const earliest = bucharestDayKey(new Date(now - SEARCH_DATE_PAST_DAYS * DAY_MS));
  const latest = bucharestDayKey(new Date(now + SEARCH_DATE_AHEAD_DAYS * DAY_MS));
  if (date < earliest || date > latest) {
    throw new DomainError('VALIDATION_FAILED', 'Date is out of range.', { date: 'out_of_range' });
  }
  const desiredAt = bucharestLocalToUtc(date, time); // throws VALIDATION_FAILED on 2026-02-30
  const { startUtc, endUtc } = bucharestDayBounds(date);
  return {
    desiredAt,
    fromAt: new Date(desiredAt.getTime() - windowMin * MIN_MS),
    toAt: new Date(desiredAt.getTime() + windowMin * MIN_MS),
    dayStartAt: startUtc,
    dayEndAt: new Date(endUtc.getTime() - 1),
  };
}

/** Pickup ETA is shown rounded to the nearest 5 minutes (ADR 0005). */
export function roundEta(at: Date): Date {
  const step = ETA_ROUND_MIN * MIN_MS;
  return new Date(Math.round(at.getTime() / step) * step);
}

export type MatchRideState = {
  driverId: string;
  status: string;
  departureAt: Date;
  seatsOffered: number;
  seatsBooked: number;
};

/**
 * Why a passenger cannot request this ride, or null when they can. Priority: own ride, ride not
 * bookable (not published, or departing within 10 minutes), full, then the points no longer fit.
 * Blocked pairs never get here (the API answers 404), and ALREADY_REQUESTED arrives with E4.
 */
export function notBookableReason(
  ride: MatchRideState,
  viewerId: string | null,
  clock: Clock,
  pointsMatch: boolean,
): NotBookableReason | null {
  if (viewerId !== null && ride.driverId === viewerId) return 'OWN_RIDE';
  if (ride.status !== 'published' || bookingCutoffPassed(ride.departureAt, clock)) {
    return 'RIDE_NOT_BOOKABLE';
  }
  if (ride.seatsBooked >= ride.seatsOffered) return 'RIDE_FULL';
  if (!pointsMatch) return 'NO_LONGER_MATCHES';
  return null;
}
