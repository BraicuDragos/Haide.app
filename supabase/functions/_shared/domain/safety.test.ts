import { describe, expect, it } from 'vitest';
import { fixedClock } from './clock.ts';
import type { DomainError } from './errors.ts';
import {
  assertCanMarkNoShow,
  call112Window,
  call112WindowDto,
  canMarkNoShow,
  canShare,
  noShowReportedOutbox,
  noShowWindowOpen,
  ratingPromptDriverOutbox,
  ratingPromptOutbox,
  reportReceivedOutbox,
  shareExpiresAt,
  sharePhase,
  show112,
} from './safety.ts';

const NOW = new Date('2026-11-20T10:00:00Z');
const MIN = 60_000;
const HOUR = 3_600_000;
const clock = fixedClock(NOW);
/** A departure `ms` from now (negative: in the past). */
const depIn = (ms: number) => new Date(NOW.getTime() + ms);
const code = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return null;
};

describe('no-show window: [departure, departure + 24 h)', () => {
  it('is closed 1 ms before departure, open at departure, closed at exactly +24 h', () => {
    expect(noShowWindowOpen(depIn(1), clock)).toBe(false);
    expect(noShowWindowOpen(depIn(0), clock)).toBe(true);
    expect(noShowWindowOpen(depIn(-24 * HOUR + 1), clock)).toBe(true);
    expect(noShowWindowOpen(depIn(-24 * HOUR), clock)).toBe(false);
  });
});

describe('assertCanMarkNoShow', () => {
  const ok = { status: 'confirmed' as const, departureAt: depIn(-HOUR), hasRating: false };

  it('accepts confirmed and completed bookings inside the window', () => {
    expect(code(() => assertCanMarkNoShow(ok, clock))).toBeNull();
    expect(code(() => assertCanMarkNoShow({ ...ok, status: 'completed' }, clock))).toBeNull();
    expect(canMarkNoShow(ok, clock)).toBe(true);
  });

  it('guard order: state, window, rating', () => {
    const late = depIn(-25 * HOUR);
    const run = (i: Parameters<typeof assertCanMarkNoShow>[0]) =>
      code(() => assertCanMarkNoShow(i, clock));
    expect(run({ status: 'requested', departureAt: late, hasRating: true })).toBe('INVALID_STATE');
    expect(run({ status: 'confirmed', departureAt: late, hasRating: true })).toBe('WINDOW_CLOSED');
    expect(run({ ...ok, hasRating: true })).toBe('INVALID_STATE');
    expect(run({ ...ok, departureAt: depIn(MIN) })).toBe('WINDOW_CLOSED');
  });

  it('refuses every other status', () => {
    for (const status of ['requested', 'rejected', 'expired', 'cancelled', 'no_show'] as const) {
      expect(canMarkNoShow({ ...ok, status }, clock), status).toBe(false);
    }
  });
});

describe('share link', () => {
  it('expires at departure + 24 h', () => {
    expect(shareExpiresAt(new Date('2026-11-20T10:00:00Z')).toISOString()).toBe(
      '2026-11-21T10:00:00.000Z',
    );
  });

  it('is offered to the passenger of an accepted booking on a live ride only', () => {
    const base = {
      viewerIsPassenger: true,
      status: 'confirmed' as const,
      rideStatus: 'published' as const,
      departureAt: depIn(2 * HOUR),
    };
    expect(canShare(base, clock)).toBe(true);
    expect(canShare({ ...base, viewerIsPassenger: false }, clock)).toBe(false);
    expect(canShare({ ...base, status: 'requested' }, clock)).toBe(false);
    expect(canShare({ ...base, status: 'no_show' }, clock)).toBe(false);
    expect(canShare({ ...base, rideStatus: 'cancelled' }, clock)).toBe(false);
    expect(canShare({ ...base, departureAt: depIn(-24 * HOUR + 1) }, clock)).toBe(true);
    expect(canShare({ ...base, departureAt: depIn(-24 * HOUR) }, clock)).toBe(false);
  });

  it('phase: before, underway for 2 h, then done; a completed booking is done at once', () => {
    const phase = (ms: number, status: 'confirmed' | 'completed' = 'confirmed') =>
      sharePhase({ departureAt: depIn(ms), status }, clock);
    expect(phase(1)).toBe('before');
    expect(phase(0)).toBe('underway');
    expect(phase(-2 * HOUR + 1)).toBe('underway');
    expect(phase(-2 * HOUR)).toBe('done');
    expect(phase(-HOUR, 'completed')).toBe('done');
  });
});

describe('Call 112 window: [departure - 15 min, departure + 2 h)', () => {
  const win = (ms: number, status: 'confirmed' | 'requested' = 'confirmed') =>
    call112Window({ status, departureAt: depIn(ms) });

  it('has the right bounds and is null for non-accepted bookings', () => {
    const w = win(HOUR);
    expect(w?.from.getTime()).toBe(depIn(HOUR - 15 * MIN).getTime());
    expect(w?.until.getTime()).toBe(depIn(HOUR + 2 * HOUR).getTime());
    expect(win(HOUR, 'requested')).toBeNull();
    expect(call112WindowDto(null)).toBeNull();
    expect(call112WindowDto(w)).toEqual({
      from: depIn(HOUR - 15 * MIN).toISOString(),
      until: depIn(3 * HOUR).toISOString(),
    });
  });

  it('boundaries: 15 min before is in (inclusive), 2 h after is out (exclusive)', () => {
    expect(show112(win(15 * MIN + 1), clock)).toBe(false);
    expect(show112(win(15 * MIN), clock)).toBe(true);
    expect(show112(win(-2 * HOUR + 1), clock)).toBe(true);
    expect(show112(win(-2 * HOUR), clock)).toBe(false);
    expect(show112(null, clock)).toBe(false);
  });
});

describe('outbox builders', () => {
  const dep = '2026-11-20T10:00:00.000Z';

  it('build rows with ids, first names, roles and a reason only', () => {
    expect(
      ratingPromptOutbox('p1', { bookingId: 'b1', driverFirstName: 'Radu', departureAt: dep })
        .template,
    ).toBe('rating_prompt');
    expect(
      ratingPromptDriverOutbox('d1', { rideId: 'r1', passengerCount: 2, departureAt: dep })
        .template,
    ).toBe('rating_prompt_driver');
    expect(
      noShowReportedOutbox('p1', {
        bookingId: 'b1',
        rideId: 'r1',
        reporterFirstName: 'Radu',
        reporterRole: 'driver',
        departureAt: dep,
      }).template,
    ).toBe('no_show_reported');
    expect(reportReceivedOutbox('a1', { reportId: 'rep1', reason: 'harassment' }).template).toBe(
      'report_received',
    );
  });

  it('a phone number or an email in a payload is rejected', () => {
    expect(() =>
      noShowReportedOutbox('p1', {
        bookingId: 'b1',
        rideId: 'r1',
        reporterFirstName: '+40721234567',
        reporterRole: 'driver',
        departureAt: dep,
      }),
    ).toThrow();
    expect(() =>
      reportReceivedOutbox('a1', { reportId: 'rep1', reason: 'me@example.com' }),
    ).toThrow();
  });
});
