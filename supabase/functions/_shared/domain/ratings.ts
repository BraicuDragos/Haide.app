import { RATING_TAGS } from '../contracts/ratings.ts';
import type { BookingStatus } from '../contracts/rides.ts';
import type { Clock } from './clock.ts';
import { DomainError } from './errors.ts';
import { RATING_WINDOW_DAYS } from './rules.ts';

/**
 * Rating rules (E5, e5-trust-safety-spec §3, ADR 0025). Pure: no I/O, time from the injected Clock.
 * A rating exists only for a `completed` booking, within 7 days of the ride's completion, once per
 * rater, and only about the counterpart. Ratings are blind: stored with a `visible_at`.
 */

const DAY_MS = 86_400_000;

export type RateeRole = 'driver' | 'passenger';

/** End of the rating window: completion + 7 days. */
export const rateUntil = (completedAt: Date): Date =>
  new Date(completedAt.getTime() + RATING_WINDOW_DAYS * DAY_MS);

/**
 * When a new rating starts to count: right now when the counterpart has already rated (both become
 * visible together), otherwise at the end of the rating window.
 */
export const initialVisibleAt = (completedAt: Date, counterRated: boolean, now: Date): Date =>
  counterRated ? now : rateUntil(completedAt);

/** The viewer may still rate: completed, inside the window, not rated yet. */
export function canRateNow(
  b: { status: BookingStatus; completedAt: Date | null; alreadyRated: boolean },
  clock: Clock,
): boolean {
  return (
    b.status === 'completed' &&
    b.completedAt !== null &&
    !b.alreadyRated &&
    clock.now().getTime() < rateUntil(b.completedAt).getTime()
  );
}

/** Tags must be unique and belong to the ratee's role (RATING_TAGS). */
export function tagsValid(tags: readonly string[], rateeRole: RateeRole): boolean {
  const allowed: readonly string[] = RATING_TAGS[rateeRole];
  return new Set(tags).size === tags.length && tags.every((t) => allowed.includes(t));
}

export type RateGuardInput = {
  status: BookingStatus;
  completedAt: Date | null;
  alreadyRated: boolean;
  rateeRole: RateeRole;
  tags: readonly string[];
};

/**
 * The guards in their fixed order: not completed (INVALID_STATE), window over (WINDOW_CLOSED),
 * already rated (ALREADY_RATED), bad tags (VALIDATION_FAILED with `fields.tags`).
 */
export function assertCanRate(input: RateGuardInput, clock: Clock): void {
  if (input.status !== 'completed' || input.completedAt === null) {
    throw new DomainError('INVALID_STATE', 'Only a completed ride can be rated.');
  }
  if (clock.now().getTime() >= rateUntil(input.completedAt).getTime()) {
    throw new DomainError('WINDOW_CLOSED', 'The time to rate this ride has passed.');
  }
  if (input.alreadyRated) {
    throw new DomainError('ALREADY_RATED', 'You have already rated this ride.');
  }
  if (!tagsValid(input.tags, input.rateeRole)) {
    throw new DomainError('VALIDATION_FAILED', 'These tags do not fit.', { tags: 'invalid' });
  }
}
