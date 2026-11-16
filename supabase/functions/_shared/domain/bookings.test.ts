import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bookingStatusSchema, type BookingStatus } from '../contracts/rides.ts';
import { fixedClock } from './clock.ts';
import {
  ACTIVE_STATUSES,
  BOOKING_TRANSITIONS,
  assertCanApprove,
  assertCanPassengerCancel,
  assertCanReject,
  assertCanRequest,
  assertTransition,
  bookingActions,
  bookingCancelledOutbox,
  bookingConfirmedOutbox,
  bookingExpiredOutbox,
  bookingPrice,
  bookingRejectedOutbox,
  bookingRequestedOutbox,
  buildTimeline,
  canTransition,
  displayPriceBani,
  priceIfAcceptedBani,
  relockConfirmed,
  responseSeconds,
  revealFor,
  revealedUntil,
  rideCancelledRows,
  type ActionsInput,
  type DecisionInput,
  type RequestGuardInput,
  type TimelineInput,
} from './bookings.ts';
import type { DomainError } from './errors.ts';
import { assertPayloadSafe } from './outbox.ts';
import { quoteUpTo, ratePerKmMicro, segmentCostMicro } from './pricing.ts';

const NOW = '2026-11-16T05:00:00Z';
const clock = fixedClock(NOW);
const at = (iso: string) => new Date(iso);
const minutesFromNow = (m: number) => new Date(at(NOW).getTime() + m * 60_000);

const codeOf = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return null;
};

const PETROL = ratePerKmMicro(700, 9810); // 686_700, pricing.md section 3
const TRIP_A_M = 11_514;
const SHOPPING_CITY_TO_PIATA_MARE_M = 5_390;

const ALL_STATUSES = bookingStatusSchema.options;

describe('BOOKING_TRANSITIONS', () => {
  it('covers every status exactly once', () => {
    expect(Object.keys(BOOKING_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it('is exhaustive: only the documented transitions are allowed', () => {
    const allowed = new Set([
      'requested>confirmed',
      'requested>rejected',
      'requested>expired',
      'requested>cancelled',
      'confirmed>cancelled',
      'confirmed>completed',
      'confirmed>no_show',
      'completed>no_show',
    ]);
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(canTransition(from, to), `${from} > ${to}`).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it('terminal states have no way out', () => {
    for (const s of ['rejected', 'expired', 'cancelled', 'no_show'] as const) {
      expect(BOOKING_TRANSITIONS[s]).toEqual([]);
    }
  });

  it('assertTransition throws INVALID_STATE for a forbidden move', () => {
    expect(() => assertTransition('requested', 'confirmed')).not.toThrow();
    expect(codeOf(() => assertTransition('confirmed', 'rejected'))).toBe('INVALID_STATE');
    expect(codeOf(() => assertTransition('cancelled', 'confirmed'))).toBe('INVALID_STATE');
  });

  it('active statuses are requested and confirmed', () => {
    expect(ACTIVE_STATUSES).toEqual(['requested', 'confirmed']);
  });
});

describe('assertCanRequest (guard order)', () => {
  const ok = (over: Partial<RequestGuardInput> = {}): RequestGuardInput => ({
    viewerId: 'p',
    driverId: 'd',
    driverActive: true,
    blocked: false,
    hasActiveOrRejected: false,
    ride: {
      status: 'published',
      departureAt: minutesFromNow(60),
      seatsOffered: 3,
      seatsBooked: 0,
    },
    pointsMatch: true,
    ...over,
  });
  const code = (over: Partial<RequestGuardInput>) =>
    codeOf(() => assertCanRequest(ok(over), clock));

  it('accepts a normal request', () => {
    expect(code({})).toBeNull();
  });

  it('answers each rule with its own code', () => {
    expect(code({ viewerId: 'd' })).toBe('OWN_RIDE');
    expect(code({ blocked: true })).toBe('BLOCKED');
    expect(code({ driverActive: false })).toBe('NOT_FOUND');
    expect(code({ hasActiveOrRejected: true })).toBe('ALREADY_REQUESTED');
    expect(code({ ride: { ...ok().ride, status: 'cancelled' } })).toBe('RIDE_NOT_BOOKABLE');
    expect(code({ ride: { ...ok().ride, departureAt: minutesFromNow(9) } })).toBe(
      'RIDE_NOT_BOOKABLE',
    );
    expect(code({ ride: { ...ok().ride, seatsBooked: 3 } })).toBe('RIDE_FULL');
    expect(code({ pointsMatch: false })).toBe('NO_LONGER_MATCHES');
  });

  it('checks the departure cutoff at exactly 10 minutes: still bookable', () => {
    expect(code({ ride: { ...ok().ride, departureAt: minutesFromNow(10) } })).toBeNull();
  });

  it('applies the checks in the documented order when several fail at once', () => {
    const everything: Partial<RequestGuardInput> = {
      viewerId: 'd',
      blocked: true,
      driverActive: false,
      hasActiveOrRejected: true,
      ride: {
        status: 'cancelled',
        departureAt: minutesFromNow(1),
        seatsOffered: 1,
        seatsBooked: 1,
      },
      pointsMatch: false,
    };
    expect(code(everything)).toBe('OWN_RIDE');
    expect(code({ ...everything, viewerId: 'p' })).toBe('BLOCKED');
    expect(code({ ...everything, viewerId: 'p', blocked: false })).toBe('NOT_FOUND');
    expect(code({ ...everything, viewerId: 'p', blocked: false, driverActive: true })).toBe(
      'ALREADY_REQUESTED',
    );
    expect(
      code({
        ...everything,
        viewerId: 'p',
        blocked: false,
        driverActive: true,
        hasActiveOrRejected: false,
      }),
    ).toBe('RIDE_NOT_BOOKABLE');
    expect(
      code({
        viewerId: 'p',
        ride: {
          status: 'published',
          departureAt: minutesFromNow(60),
          seatsOffered: 1,
          seatsBooked: 1,
        },
        pointsMatch: false,
      }),
    ).toBe('RIDE_FULL');
  });
});

describe('assertCanApprove and assertCanReject', () => {
  const input = (over: Partial<DecisionInput> = {}): DecisionInput => ({
    booking: { status: 'requested', expiresAt: minutesFromNow(20) },
    ride: { status: 'published', seatsOffered: 2, seatsBooked: 1 },
    blocked: false,
    ...over,
  });
  const approve = (over: Partial<DecisionInput>) =>
    codeOf(() => assertCanApprove(input(over), clock));
  const reject = (over: Partial<DecisionInput>) =>
    codeOf(() => assertCanReject({ booking: input(over).booking, ride: input(over).ride }, clock));

  it('accepts a live request on a ride with a free seat', () => {
    expect(approve({})).toBeNull();
    expect(reject({})).toBeNull();
  });

  it('maps every failure to its code', () => {
    expect(approve({ ride: { status: 'cancelled', seatsOffered: 2, seatsBooked: 0 } })).toBe(
      'INVALID_STATE',
    );
    expect(approve({ booking: { status: 'confirmed', expiresAt: minutesFromNow(20) } })).toBe(
      'INVALID_STATE',
    );
    expect(approve({ booking: { status: 'cancelled', expiresAt: minutesFromNow(20) } })).toBe(
      'INVALID_STATE',
    );
    expect(approve({ booking: { status: 'expired', expiresAt: minutesFromNow(-1) } })).toBe(
      'REQUEST_EXPIRED',
    );
    expect(approve({ booking: { status: 'requested', expiresAt: minutesFromNow(-1) } })).toBe(
      'REQUEST_EXPIRED',
    );
    expect(approve({ blocked: true })).toBe('BLOCKED');
    expect(approve({ ride: { status: 'published', seatsOffered: 2, seatsBooked: 2 } })).toBe(
      'RIDE_FULL',
    );
  });

  it('a request expiring exactly now is already expired (the ">" in the SQL guard)', () => {
    expect(approve({ booking: { status: 'requested', expiresAt: minutesFromNow(0) } })).toBe(
      'REQUEST_EXPIRED',
    );
    expect(reject({ booking: { status: 'requested', expiresAt: minutesFromNow(0) } })).toBe(
      'REQUEST_EXPIRED',
    );
  });

  it('reject ignores blocks and seats but not state', () => {
    expect(reject({ ride: { status: 'published', seatsOffered: 1, seatsBooked: 1 } })).toBeNull();
    expect(reject({ booking: { status: 'rejected', expiresAt: minutesFromNow(5) } })).toBe(
      'INVALID_STATE',
    );
  });
});

describe('assertCanPassengerCancel', () => {
  const run = (status: BookingStatus, departureInMin: number) =>
    assertCanPassengerCancel({ status, departureAt: minutesFromNow(departureInMin) }, clock);

  it('lets a requested or confirmed booking be cancelled before departure', () => {
    expect(run('requested', 60)).toEqual({ late: false });
    expect(run('confirmed', 60)).toEqual({ late: false });
  });

  it('a confirmed booking is late at 30 minutes or less, a requested one never', () => {
    expect(run('confirmed', 31)).toEqual({ late: false });
    expect(run('confirmed', 30)).toEqual({ late: true });
    expect(run('confirmed', 1)).toEqual({ late: true });
    expect(run('requested', 5)).toEqual({ late: false });
  });

  it('refuses terminal states and departed rides with INVALID_STATE', () => {
    for (const s of ['rejected', 'expired', 'cancelled', 'completed', 'no_show'] as const) {
      expect(codeOf(() => run(s, 60))).toBe('INVALID_STATE');
    }
    expect(codeOf(() => run('confirmed', 0))).toBe('INVALID_STATE');
    expect(codeOf(() => run('requested', -5))).toBe('INVALID_STATE');
  });
});

describe('relockConfirmed (Trip A, pricing.md section 5)', () => {
  const p1Quote = quoteUpTo(TRIP_A_M, PETROL, false);
  const p2Quote = quoteUpTo(SHOPPING_CITY_TO_PIATA_MARE_M, PETROL, false);

  it('quotes match the pricing doc', () => {
    expect(p1Quote).toBe(390);
    expect(p2Quote).toBe(180);
  });

  it('a lone passenger keeps the quote', () => {
    expect(
      relockConfirmed(
        [{ id: 'p1', segmentM: TRIP_A_M, quotedBani: p1Quote, lockedBani: null }],
        PETROL,
        false,
      ),
    ).toEqual([{ id: 'p1', lockedBani: 390, dropped: false }]);
  });

  it('mixed segments: P1 full route 2.60, P2 from Shopping City 1.20 RON', () => {
    const out = relockConfirmed(
      [
        { id: 'p1', segmentM: TRIP_A_M, quotedBani: p1Quote, lockedBani: 390 },
        {
          id: 'p2',
          segmentM: SHOPPING_CITY_TO_PIATA_MARE_M,
          quotedBani: p2Quote,
          lockedBani: p2Quote,
        },
      ],
      PETROL,
      false,
    );
    expect(out).toEqual([
      { id: 'p1', lockedBani: 260, dropped: true },
      { id: 'p2', lockedBani: 120, dropped: true },
    ]);
    // The driver collects 3.80 RON, at most 2/3 of the 7.91 RON trip cost.
    const sum = out.reduce((s, r) => s + r.lockedBani, 0);
    expect(sum).toBe(380);
    expect(sum * 10_000 * 3).toBeLessThanOrEqual(2 * segmentCostMicro(TRIP_A_M, PETROL));
  });

  it('after a cancellation the remaining lock never goes back up', () => {
    const out = relockConfirmed(
      [{ id: 'p1', segmentM: TRIP_A_M, quotedBani: p1Quote, lockedBani: 260 }],
      PETROL,
      false,
    );
    expect(out).toEqual([{ id: 'p1', lockedBani: 260, dropped: false }]);
  });

  it('a newly approved booking enters at its quote (lockedBani null)', () => {
    const [r] = relockConfirmed(
      [
        { id: 'a', segmentM: TRIP_A_M, quotedBani: 390, lockedBani: null },
        { id: 'b', segmentM: TRIP_A_M, quotedBani: 390, lockedBani: 390 },
      ],
      PETROL,
      false,
    );
    expect(r).toEqual({ id: 'a', lockedBani: 260, dropped: true });
  });

  it('a free ride locks 0 and an empty list is a no-op', () => {
    expect(
      relockConfirmed([{ id: 'f', segmentM: 4000, quotedBani: 0, lockedBani: 0 }], PETROL, true),
    ).toEqual([{ id: 'f', lockedBani: 0, dropped: false }]);
    expect(relockConfirmed([], PETROL, false)).toEqual([]);
  });

  it('priceIfAcceptedBani uses n = confirmed + 1', () => {
    expect(priceIfAcceptedBani(TRIP_A_M, PETROL, 0, false)).toBe(390);
    expect(priceIfAcceptedBani(TRIP_A_M, PETROL, 1, false)).toBe(260);
    expect(priceIfAcceptedBani(TRIP_A_M, PETROL, 2, false)).toBe(190);
    expect(priceIfAcceptedBani(TRIP_A_M, PETROL, 2, true)).toBe(0);
  });
});

describe('relock properties over random approve and cancel sequences (seeded)', () => {
  type Sim = {
    id: number;
    segmentM: number;
    quoted: number;
    locked: number | null;
    status: string;
  };
  const ops = fc.array(
    fc.record({ kind: fc.constantFrom('approve', 'cancel'), pick: fc.nat(1000) }),
    { minLength: 1, maxLength: 24 },
  );

  it('a lock never increases, sum <= n/(n+1) x trip cost, each lock <= half its segment cost', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 200_000, max: 1_200_000 }),
        fc.integer({ min: 2_000, max: 40_000 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 6, maxLength: 6 }),
        ops,
        (rate, routeM, fractions, sequence) => {
          const sims: Sim[] = fractions.map((f, i) => {
            const segmentM = Math.max(1_000, Math.min(routeM, Math.round(routeM * f)));
            return {
              id: i,
              segmentM,
              quoted: quoteUpTo(segmentM, rate, false),
              locked: null,
              status: 'requested',
            };
          });
          const confirmed = () => sims.filter((s) => s.status === 'confirmed');

          const relockAll = () => {
            const before = new Map(sims.map((s) => [s.id, s.locked ?? s.quoted]));
            const out = relockConfirmed(
              confirmed().map((s) => ({
                id: String(s.id),
                segmentM: s.segmentM,
                quotedBani: s.quoted,
                lockedBani: s.locked,
              })),
              rate,
              false,
            );
            for (const r of out) {
              const sim = sims[Number(r.id)];
              if (!sim) throw new Error('unknown sim');
              // Invariant 1: a lock never increases.
              if (r.lockedBani > (before.get(sim.id) ?? Infinity)) return false;
              sim.locked = r.lockedBani;
            }
            return true;
          };

          for (const op of sequence) {
            if (op.kind === 'approve') {
              const open = sims.filter((s) => s.status === 'requested');
              const target = open[op.pick % Math.max(1, open.length)];
              if (!target || confirmed().length >= 4) continue;
              target.status = 'confirmed';
              target.locked = target.quoted;
            } else {
              const live = confirmed();
              const target = live[op.pick % Math.max(1, live.length)];
              if (!target) continue;
              target.status = 'cancelled';
            }
            if (!relockAll()) return false;

            const n = confirmed().length;
            if (n > 0) {
              const sum = confirmed().reduce((s, b) => s + (b.locked ?? 0), 0);
              // Invariant 2: the driver never collects more than n/(n+1) of the trip cost.
              if (sum * 10_000 * (n + 1) > n * segmentCostMicro(routeM, rate)) return false;
            }
            for (const b of confirmed()) {
              // Invariant 3: a lock is at most half the cost of that passenger's own segment,
              // and never above the quote.
              if ((b.locked ?? 0) * 10_000 * 2 > segmentCostMicro(b.segmentM, rate)) return false;
              if ((b.locked ?? 0) > b.quoted) return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 500, seed: 20261119 },
    );
  });
});

describe('bookingPrice and displayPriceBani', () => {
  const dep = at('2026-11-16T09:00:00Z');
  const base = { status: 'confirmed' as const, departureAt: dep, quotedBani: 390, finalBani: null };

  it('reports the dropped-from quote only when the lock is lower', () => {
    expect(bookingPrice({ ...base, lockedBani: 260 }, clock).droppedFromBani).toBe(390);
    expect(bookingPrice({ ...base, lockedBani: 390 }, clock).droppedFromBani).toBeNull();
    expect(bookingPrice({ ...base, status: 'requested', lockedBani: null }, clock)).toEqual({
      quotedBani: 390,
      lockedBani: null,
      finalBani: null,
      droppedFromBani: null,
    });
  });

  it('final is the lock once the ride has departed (confirmed or completed only)', () => {
    const before = fixedClock('2026-11-16T08:59:59Z');
    const after = fixedClock('2026-11-16T09:00:00Z');
    expect(bookingPrice({ ...base, lockedBani: 260 }, before).finalBani).toBeNull();
    expect(bookingPrice({ ...base, lockedBani: 260 }, after).finalBani).toBe(260);
    expect(
      bookingPrice({ ...base, status: 'cancelled', lockedBani: 260 }, after).finalBani,
    ).toBeNull();
    // a stored final price wins
    expect(bookingPrice({ ...base, lockedBani: 260, finalBani: 250 }, before).finalBani).toBe(250);
  });

  it('the list price is final ?? locked ?? quoted', () => {
    expect(displayPriceBani({ quotedBani: 390, lockedBani: null, finalBani: null })).toBe(390);
    expect(displayPriceBani({ quotedBani: 390, lockedBani: 260, finalBani: null })).toBe(260);
    expect(displayPriceBani({ quotedBani: 390, lockedBani: 260, finalBani: 250 })).toBe(250);
  });
});

describe('revealFor (ADR 0023)', () => {
  const dep = at('2026-11-16T09:00:00Z');
  const clockAt = (iso: string) => fixedClock(iso);

  it('reveals a confirmed booking until departure + 24 h, exclusive', () => {
    expect(
      revealFor({ status: 'confirmed', departureAt: dep }, clockAt('2026-11-16T05:00:00Z')),
    ).toBe(true);
    expect(
      revealFor({ status: 'confirmed', departureAt: dep }, clockAt('2026-11-17T08:59:59.999Z')),
    ).toBe(true);
    expect(
      revealFor({ status: 'confirmed', departureAt: dep }, clockAt('2026-11-17T09:00:00Z')),
    ).toBe(false);
    expect(
      revealFor({ status: 'confirmed', departureAt: dep }, clockAt('2026-11-17T09:00:00.001Z')),
    ).toBe(false);
  });

  it('completed follows the same window', () => {
    expect(
      revealFor({ status: 'completed', departureAt: dep }, clockAt('2026-11-16T12:00:00Z')),
    ).toBe(true);
    expect(
      revealFor({ status: 'completed', departureAt: dep }, clockAt('2026-11-17T09:00:00Z')),
    ).toBe(false);
  });

  it('every other status stays hidden, whatever the time', () => {
    for (const s of ['requested', 'rejected', 'expired', 'cancelled', 'no_show'] as const) {
      expect(revealFor({ status: s, departureAt: dep }, clock), s).toBe(false);
    }
  });

  it('the window ends 24 h after departure', () => {
    expect(revealedUntil(dep).toISOString()).toBe('2026-11-17T09:00:00.000Z');
  });
});

describe('buildTimeline', () => {
  const requestedAt = at('2026-11-16T05:00:00Z');
  const expiresAt = at('2026-11-16T05:30:00Z');
  const base = {
    requestedAt,
    expiresAt,
    decidedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    rideStatus: 'published' as const,
    completedAt: null,
    noShowAt: null,
  };

  it('requested only', () => {
    expect(buildTimeline({ ...base, status: 'requested' }).map((t) => t.status)).toEqual([
      'requested',
    ]);
  });

  it('confirmed', () => {
    const decidedAt = at('2026-11-16T05:05:00Z');
    expect(buildTimeline({ ...base, status: 'confirmed', decidedAt })).toEqual([
      { status: 'requested', at: requestedAt.toISOString() },
      { status: 'confirmed', at: decidedAt.toISOString() },
    ]);
  });

  it('rejected, expired', () => {
    const decidedAt = at('2026-11-16T05:05:00Z');
    expect(buildTimeline({ ...base, status: 'rejected', decidedAt }).map((t) => t.status)).toEqual([
      'requested',
      'rejected',
    ]);
    expect(buildTimeline({ ...base, status: 'expired' })).toEqual([
      { status: 'requested', at: requestedAt.toISOString() },
      { status: 'expired', at: expiresAt.toISOString() },
    ]);
  });

  it('cancelled after confirmation keeps the confirmed step; a driver cancel reads ride_cancelled', () => {
    const decidedAt = at('2026-11-16T05:05:00Z');
    const cancelledAt = at('2026-11-16T06:00:00Z');
    expect(
      buildTimeline({
        ...base,
        status: 'cancelled',
        decidedAt,
        cancelledAt,
        cancelledBy: 'passenger',
      }).map((t) => t.status),
    ).toEqual(['requested', 'confirmed', 'cancelled']);
    expect(
      buildTimeline({
        ...base,
        status: 'cancelled',
        cancelledAt,
        cancelledBy: 'driver',
        rideStatus: 'cancelled',
      }).map((t) => t.status),
    ).toEqual(['requested', 'ride_cancelled']);
  });
});

describe('bookingActions', () => {
  const dep = (m: number) => minutesFromNow(m);
  const act = (o: {
    status: BookingStatus;
    departureAt: Date;
    viewerIsPassenger: boolean;
  }): ActionsInput => ({
    rideStatus: 'published',
    completedAt: null,
    viewerRated: false,
    anyRated: false,
    ...o,
  });
  it('passenger can cancel a live booking; the late flag follows the 30 minute rule', () => {
    expect(
      bookingActions(
        act({ status: 'confirmed', departureAt: dep(120), viewerIsPassenger: true }),
        clock,
      ),
    ).toMatchObject({
      canCancel: true,
      lateCancelIfNow: false,
    });
    expect(
      bookingActions(
        act({ status: 'confirmed', departureAt: dep(20), viewerIsPassenger: true }),
        clock,
      ),
    ).toMatchObject({
      canCancel: true,
      lateCancelIfNow: true,
    });
    expect(
      bookingActions(
        act({ status: 'requested', departureAt: dep(20), viewerIsPassenger: true }),
        clock,
      ),
    ).toMatchObject({
      canCancel: true,
      lateCancelIfNow: false,
    });
  });

  it('the driver, departed rides and terminal states cannot cancel; before departure the E5 flags are off', () => {
    const a = bookingActions(
      act({ status: 'confirmed', departureAt: dep(120), viewerIsPassenger: false }),
      clock,
    );
    expect(a.canCancel).toBe(false);
    expect(
      bookingActions(
        act({ status: 'confirmed', departureAt: dep(-1), viewerIsPassenger: true }),
        clock,
      ).canCancel,
    ).toBe(false);
    expect(
      bookingActions(
        act({ status: 'cancelled', departureAt: dep(120), viewerIsPassenger: true }),
        clock,
      ).canCancel,
    ).toBe(false);
    expect(a).toMatchObject({
      canReportDriverNoShow: false,
      canRate: false,
      canShare: false,
      show112: false,
      canMarkNoShow: false,
    });
  });
});

describe('outbox builders', () => {
  const dep = '2026-11-16T07:00:00.000Z';

  it('route each template to the right recipient with area names and first names only', () => {
    const rows = [
      bookingRequestedOutbox('driver', {
        bookingId: 'b1',
        rideId: 'r1',
        passengerFirstName: 'Ioana',
        departureAt: dep,
        pickupArea: 'Șelimbăr',
        dropoffArea: 'Centru',
        expiresAt: '2026-11-16T05:30:00.000Z',
      }),
      bookingConfirmedOutbox('pass', {
        bookingId: 'b1',
        driverFirstName: 'Radu',
        departureAt: dep,
        pickupEtaAt: '2026-11-16T07:05:00.000Z',
        pickupArea: 'Șelimbăr',
      }),
      bookingRejectedOutbox('pass', { bookingId: 'b1', driverFirstName: 'Radu', departureAt: dep }),
      bookingExpiredOutbox('pass', { bookingId: 'b1', driverFirstName: null, departureAt: dep }),
      bookingCancelledOutbox('driver', {
        bookingId: 'b1',
        rideId: 'r1',
        passengerFirstName: 'Ioana',
        departureAt: dep,
      }),
    ];
    expect(rows.map((r) => [r.template, r.userId])).toEqual([
      ['booking_requested', 'driver'],
      ['booking_confirmed', 'pass'],
      ['booking_rejected', 'pass'],
      ['booking_expired', 'pass'],
      ['booking_cancelled', 'driver'],
    ]);
  });

  it('rideCancelledRows writes one row per booking with that booking own areas', () => {
    const rows = rideCancelledRows([
      {
        passengerId: 'p1',
        payload: {
          bookingId: 'b1',
          rideId: 'r1',
          driverFirstName: 'Radu',
          departureAt: dep,
          pickupArea: 'Șelimbăr',
          dropoffArea: 'Centru',
        },
      },
      {
        passengerId: 'p1',
        payload: {
          bookingId: 'b2',
          rideId: 'r1',
          driverFirstName: 'Radu',
          departureAt: dep,
          pickupArea: 'Turnișor',
          dropoffArea: 'Centru',
        },
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.payload.bookingId)).toEqual(['b1', 'b2']);
    expect(rows.every((r) => r.template === 'ride_cancelled')).toBe(true);
    expect(rideCancelledRows([])).toEqual([]);
  });

  it('refuses a payload that carries a coordinate, phone, plate or email', () => {
    const bad = (extra: Record<string, string>) => () =>
      bookingRejectedOutbox('p', {
        bookingId: 'b',
        driverFirstName: 'Radu',
        departureAt: dep,
        ...extra,
      } as never);
    expect(bad({ x: 'meet at 45.74132, 24.18611' })).toThrow();
    expect(bad({ x: 'call +40721234567' })).toThrow();
    expect(bad({ x: 'plate SB12ABC' })).toThrow();
    expect(bad({ x: 'radu@example.com' })).toThrow();
    expect(bad({})).not.toThrow();
  });

  it('assertPayloadSafe lets UUIDs, ISO times and Romanian names through', () => {
    expect(() =>
      assertPayloadSafe({
        id: '00000000-0000-4000-8000-000000000401',
        at: '2026-11-16T07:00:00.123Z',
        name: 'Ștefan Țurcanu',
        area: 'Cisnădie',
      }),
    ).not.toThrow();
  });

  it('responseSeconds is the whole seconds between request and decision', () => {
    expect(responseSeconds(at('2026-11-16T05:00:00Z'), at('2026-11-16T05:02:30.400Z'))).toBe(150);
    expect(responseSeconds(at('2026-11-16T05:00:10Z'), at('2026-11-16T05:00:00Z'))).toBe(0);
  });
});

describe('bookingActions (E5)', () => {
  const dep = (m: number) => minutesFromNow(m);
  const completedAt = minutesFromNow(-60);
  const act = (o: Partial<ActionsInput>): ActionsInput => ({
    status: 'confirmed',
    departureAt: dep(120),
    viewerIsPassenger: true,
    rideStatus: 'published',
    completedAt: null,
    viewerRated: false,
    anyRated: false,
    ...o,
  });

  it('no-show flags go to the right role, from departure on, and never after a rating', () => {
    const departed = { departureAt: dep(-10) };
    expect(bookingActions(act({ ...departed }), clock)).toMatchObject({
      canReportDriverNoShow: true,
      canMarkNoShow: false,
    });
    expect(bookingActions(act({ ...departed, viewerIsPassenger: false }), clock)).toMatchObject({
      canReportDriverNoShow: false,
      canMarkNoShow: true,
    });
    // not before departure
    expect(bookingActions(act({ departureAt: dep(1) }), clock).canReportDriverNoShow).toBe(false);
    // not once either side has rated
    expect(bookingActions(act({ ...departed, anyRated: true }), clock).canReportDriverNoShow).toBe(
      false,
    );
    // not 24 h after departure
    expect(bookingActions(act({ departureAt: dep(-24 * 60) }), clock).canReportDriverNoShow).toBe(
      false,
    );
  });

  it('canRate only for a completed, unrated booking inside the 7 day window', () => {
    const done = { status: 'completed' as const, completedAt, departureAt: dep(-180) };
    expect(bookingActions(act(done), clock).canRate).toBe(true);
    expect(bookingActions(act({ ...done, viewerRated: true }), clock).canRate).toBe(false);
    expect(bookingActions(act({ ...done, status: 'no_show' }), clock).canRate).toBe(false);
    expect(
      bookingActions(act({ ...done, completedAt: minutesFromNow(-7 * 24 * 60) }), clock).canRate,
    ).toBe(false);
    expect(
      bookingActions(act({ ...done, completedAt: minutesFromNow(-7 * 24 * 60 + 1) }), clock)
        .canRate,
    ).toBe(true);
  });

  it('Call 112 shows from 15 min before departure until 2 h after, for accepted bookings only', () => {
    const show = (m: number, status: BookingStatus = 'confirmed') =>
      bookingActions(act({ status, departureAt: dep(m) }), clock).show112;
    expect(show(16)).toBe(false);
    expect(show(15)).toBe(true);
    expect(show(-119)).toBe(true);
    expect(show(-120)).toBe(false);
    expect(show(0, 'requested')).toBe(false);
    expect(show(0, 'cancelled')).toBe(false);
    expect(bookingActions(act({ status: 'requested' }), clock).call112Window).toBeNull();
    expect(bookingActions(act({ departureAt: dep(60) }), clock).call112Window).toEqual({
      from: dep(45).toISOString(),
      until: dep(180).toISOString(),
    });
  });

  it('canShare: passenger only, accepted, ride not cancelled, until departure + 24 h', () => {
    const can = (o: Partial<ActionsInput>) => bookingActions(act(o), clock).canShare;
    expect(can({})).toBe(true);
    expect(can({ viewerIsPassenger: false })).toBe(false);
    expect(can({ status: 'requested' })).toBe(false);
    expect(can({ rideStatus: 'cancelled' })).toBe(false);
    expect(can({ departureAt: dep(-24 * 60 + 1), status: 'completed' })).toBe(true);
    expect(can({ departureAt: dep(-24 * 60), status: 'completed' })).toBe(false);
  });
});

describe('buildTimeline (E5)', () => {
  const requestedAt = at('2026-11-16T05:00:00Z');
  const base = {
    requestedAt,
    expiresAt: at('2026-11-16T05:30:00Z'),
    decidedAt: at('2026-11-16T05:05:00Z'),
    cancelledAt: null,
    cancelledBy: null,
    rideStatus: 'completed' as const,
    completedAt: at('2026-11-16T09:30:00Z'),
    noShowAt: null,
  };
  const steps = (o: Partial<TimelineInput>) =>
    buildTimeline({ ...base, status: 'completed', ...o }).map((t) => t.status);

  it('completed shows the completion step', () => {
    expect(steps({})).toEqual(['requested', 'confirmed', 'completed']);
  });

  it('a no-show reported after completion shows both steps, one reported first shows only the no-show', () => {
    expect(steps({ status: 'no_show', noShowAt: at('2026-11-16T10:00:00Z') })).toEqual([
      'requested',
      'confirmed',
      'completed',
      'no_show',
    ]);
    expect(steps({ status: 'no_show', noShowAt: at('2026-11-16T08:00:00Z') })).toEqual([
      'requested',
      'confirmed',
      'no_show',
    ]);
  });

  it('a ride cancelled by the system reads ride_cancelled, a passenger cancel stays cancelled', () => {
    const cancelledAt = at('2026-11-16T06:00:00Z');
    expect(
      steps({ status: 'cancelled', rideStatus: 'cancelled', cancelledAt, cancelledBy: 'system' }),
    ).toEqual(['requested', 'confirmed', 'ride_cancelled']);
    // passenger cancelled first, the driver cancelled the ride later
    expect(
      steps({
        status: 'cancelled',
        rideStatus: 'cancelled',
        cancelledAt,
        cancelledBy: 'passenger',
      }),
    ).toEqual(['requested', 'confirmed', 'cancelled']);
    // a block cascade on a ride that stays published
    expect(
      steps({ status: 'cancelled', rideStatus: 'published', cancelledAt, cancelledBy: 'system' }),
    ).toEqual(['requested', 'confirmed', 'cancelled']);
  });
});
