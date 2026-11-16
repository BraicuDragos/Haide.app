import { describe, expect, it } from 'vitest';
import { RATING_TAGS } from '../contracts/ratings.ts';
import { fixedClock } from './clock.ts';
import type { DomainError } from './errors.ts';
import {
  assertCanRate,
  canRateNow,
  initialVisibleAt,
  rateUntil,
  tagsValid,
  type RateGuardInput,
} from './ratings.ts';

const NOW = new Date('2026-11-20T10:00:00Z');
const DAY = 86_400_000;
const clock = fixedClock(NOW);

const run = (over: Partial<RateGuardInput> = {}): { code: string | null; fields?: unknown } => {
  try {
    assertCanRate(
      {
        status: 'completed',
        completedAt: new Date(NOW.getTime() - DAY),
        alreadyRated: false,
        rateeRole: 'driver',
        tags: [],
        ...over,
      },
      clock,
    );
  } catch (e) {
    const err = e as DomainError;
    return { code: err.code, fields: err.fields };
  }
  return { code: null };
};

describe('rateUntil and initialVisibleAt (blind ratings, ADR 0025)', () => {
  it('the window is completion + 7 days', () => {
    expect(rateUntil(new Date('2026-11-16T09:00:00Z')).toISOString()).toBe(
      '2026-11-23T09:00:00.000Z',
    );
  });

  it('a first rating stays hidden until the window ends, a counter-rating shows both now', () => {
    const completedAt = new Date('2026-11-16T09:00:00Z');
    expect(initialVisibleAt(completedAt, false, NOW).toISOString()).toBe(
      '2026-11-23T09:00:00.000Z',
    );
    expect(initialVisibleAt(completedAt, true, NOW).toISOString()).toBe(NOW.toISOString());
  });
});

describe('assertCanRate', () => {
  it('accepts a completed booking inside the window', () => {
    expect(run().code).toBeNull();
    expect(
      run({ rateeRole: 'passenger', tags: ['respectful', 'on_time_at_pickup'] }).code,
    ).toBeNull();
  });

  it('only a completed booking can be rated: no_show, confirmed, cancelled are INVALID_STATE', () => {
    for (const status of ['no_show', 'confirmed', 'requested', 'cancelled', 'expired'] as const) {
      expect(run({ status }).code, status).toBe('INVALID_STATE');
    }
    expect(run({ completedAt: null }).code).toBe('INVALID_STATE');
  });

  it('the window closes at exactly completion + 7 days', () => {
    expect(run({ completedAt: new Date(NOW.getTime() - 7 * DAY + 1) }).code).toBeNull();
    expect(run({ completedAt: new Date(NOW.getTime() - 7 * DAY) }).code).toBe('WINDOW_CLOSED');
    expect(run({ completedAt: new Date(NOW.getTime() - 8 * DAY) }).code).toBe('WINDOW_CLOSED');
  });

  it('one rating per rater', () => {
    expect(run({ alreadyRated: true }).code).toBe('ALREADY_RATED');
  });

  it('guard order: state, then window, then duplicate, then tags', () => {
    const old = new Date(NOW.getTime() - 9 * DAY);
    expect(run({ status: 'no_show', completedAt: old, alreadyRated: true, tags: ['x'] }).code).toBe(
      'INVALID_STATE',
    );
    expect(run({ completedAt: old, alreadyRated: true, tags: ['x'] }).code).toBe('WINDOW_CLOSED');
    expect(run({ alreadyRated: true, tags: ['x'] }).code).toBe('ALREADY_RATED');
    expect(run({ tags: ['x'] })).toEqual({
      code: 'VALIDATION_FAILED',
      fields: { tags: 'invalid' },
    });
  });

  it('tags must fit the ratee role and be unique', () => {
    expect(run({ rateeRole: 'driver', tags: ['respectful'] }).code).toBe('VALIDATION_FAILED');
    expect(run({ rateeRole: 'passenger', tags: ['safe_driving'] }).code).toBe('VALIDATION_FAILED');
    expect(run({ tags: ['punctual', 'punctual'] }).code).toBe('VALIDATION_FAILED');
  });
});

describe('tagsValid', () => {
  it('accepts every documented tag for its own role only', () => {
    for (const role of ['driver', 'passenger'] as const) {
      expect(tagsValid([...RATING_TAGS[role]], role)).toBe(true);
    }
    expect(tagsValid([], 'driver')).toBe(true);
    expect(tagsValid(['clean_car'], 'passenger')).toBe(false);
    expect(tagsValid(['on_time_at_pickup'], 'driver')).toBe(false);
    expect(tagsValid(['PUNCTUAL'], 'driver')).toBe(false);
  });
});

describe('canRateNow', () => {
  const completedAt = new Date(NOW.getTime() - DAY);
  it('mirrors the guards without throwing', () => {
    expect(canRateNow({ status: 'completed', completedAt, alreadyRated: false }, clock)).toBe(true);
    expect(canRateNow({ status: 'completed', completedAt, alreadyRated: true }, clock)).toBe(false);
    expect(canRateNow({ status: 'no_show', completedAt, alreadyRated: false }, clock)).toBe(false);
    expect(canRateNow({ status: 'completed', completedAt: null, alreadyRated: false }, clock)).toBe(
      false,
    );
  });
});
