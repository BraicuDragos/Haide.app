import { describe, expect, it } from 'vitest';
import { fixedClock } from './clock.ts';
import type { DomainError } from './errors.ts';
import { assertPayloadSafe } from './outbox.ts';
import {
  canEditRide,
  planRideEdit,
  requestExpiryCap,
  rideUpdatedRows,
  type RideEditCurrent,
} from './rides.ts';
import { bookingExpiresAt } from './time.ts';

const clock = fixedClock('2026-11-16T05:00:00Z');
const DEP = new Date('2026-11-16T07:00:00Z');

const ride = (over: Partial<RideEditCurrent> = {}): RideEditCurrent => ({
  status: 'published',
  departureAt: DEP,
  seatsOffered: 3,
  seatsBooked: 1,
  note: 'Blue backpack',
  autoAccept: false,
  ...over,
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return undefined;
};

describe('canEditRide', () => {
  it('is true for a published ride that has not departed, false otherwise', () => {
    expect(canEditRide({ status: 'published', departureAt: DEP }, clock)).toBe(true);
    expect(canEditRide({ status: 'cancelled', departureAt: DEP }, clock)).toBe(false);
    expect(canEditRide({ status: 'completed', departureAt: DEP }, clock)).toBe(false);
    expect(
      canEditRide({ status: 'published', departureAt: new Date('2026-11-16T05:00:00Z') }, clock),
    ).toBe(false);
  });
});

describe('planRideEdit', () => {
  it('an empty patch changes nothing', () => {
    const plan = planRideEdit(ride(), {}, clock);
    expect(plan).toMatchObject({
      departureAt: DEP,
      seats: 3,
      note: 'Blue backpack',
      autoAccept: false,
      timeChanged: false,
      seatsChanged: false,
      noteChanged: false,
      autoAcceptChanged: false,
    });
  });

  it('refuses a ride that is not published or has departed (RIDE_NOT_EDITABLE)', () => {
    expect(codeOf(() => planRideEdit(ride({ status: 'cancelled' }), { seats: 2 }, clock))).toBe(
      'RIDE_NOT_EDITABLE',
    );
    expect(codeOf(() => planRideEdit(ride({ status: 'completed' }), { seats: 2 }, clock))).toBe(
      'RIDE_NOT_EDITABLE',
    );
    expect(
      codeOf(() =>
        planRideEdit(ride({ departureAt: new Date('2026-11-16T04:59:00Z') }), { seats: 2 }, clock),
      ),
    ).toBe('RIDE_NOT_EDITABLE');
  });

  it('a new departure follows the publish rules: 15 minutes to 14 days ahead', () => {
    const at = (iso: string) => planRideEdit(ride(), { departureAt: new Date(iso) }, clock);
    expect(at('2026-11-16T05:15:00Z').timeChanged).toBe(true);
    expect(codeOf(() => at('2026-11-16T05:14:59Z'))).toBe('DEPARTURE_TOO_SOON');
    expect(codeOf(() => at('2026-11-16T04:00:00Z'))).toBe('DEPARTURE_TOO_SOON');
    expect(at('2026-11-30T05:00:00Z').timeChanged).toBe(true);
    expect(codeOf(() => at('2026-11-30T05:00:01Z'))).toBe('DEPARTURE_TOO_FAR');
  });

  it('an unchanged departure is not re-checked, so seats and note can be fixed minutes before leaving', () => {
    const soon = new Date('2026-11-16T05:05:00Z'); // 5 minutes ahead: too soon for a NEW time
    const plan = planRideEdit(ride({ departureAt: soon }), { departureAt: soon, seats: 2 }, clock);
    expect(plan.timeChanged).toBe(false);
    expect(plan.seatsChanged).toBe(true);
    expect(
      codeOf(() => planRideEdit(ride({ departureAt: soon }), { departureAt: DEP }, clock)),
    ).toBeUndefined();
  });

  it('seats are 1..4 and never below the seats already booked (SEATS_BELOW_BOOKED)', () => {
    expect(planRideEdit(ride({ seatsBooked: 2 }), { seats: 2 }, clock).seats).toBe(2);
    expect(codeOf(() => planRideEdit(ride({ seatsBooked: 2 }), { seats: 1 }, clock))).toBe(
      'SEATS_BELOW_BOOKED',
    );
    expect(codeOf(() => planRideEdit(ride({ seatsBooked: 0 }), { seats: 0 }, clock))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => planRideEdit(ride(), { seats: 5 }, clock))).toBe('VALIDATION_FAILED');
    expect(planRideEdit(ride(), { seats: 4 }, clock).seatsChanged).toBe(true);
  });

  it('note: trimmed, an empty string or null clears it, absent keeps it, too long is refused', () => {
    expect(planRideEdit(ride(), { note: '  Meet at the gate ' }, clock)).toMatchObject({
      note: 'Meet at the gate',
      noteChanged: true,
    });
    expect(planRideEdit(ride(), { note: null }, clock)).toMatchObject({
      note: null,
      noteChanged: true,
    });
    expect(planRideEdit(ride(), { note: '   ' }, clock).note).toBeNull();
    expect(planRideEdit(ride(), {}, clock).note).toBe('Blue backpack');
    expect(planRideEdit(ride(), { note: 'Blue backpack' }, clock).noteChanged).toBe(false);
    expect(codeOf(() => planRideEdit(ride(), { note: 'x'.repeat(201) }, clock))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('auto-accept flips on and off', () => {
    expect(planRideEdit(ride(), { autoAccept: true }, clock)).toMatchObject({
      autoAccept: true,
      autoAcceptChanged: true,
    });
    expect(planRideEdit(ride(), { autoAccept: false }, clock).autoAcceptChanged).toBe(false);
  });
});

describe('requestExpiryCap', () => {
  it('is the same margin bookingExpiresAt uses: departure minus 10 minutes', () => {
    expect(requestExpiryCap(DEP).toISOString()).toBe('2026-11-16T06:50:00.000Z');
    // a request made 30 minutes before departure is already capped by it
    expect(bookingExpiresAt(new Date('2026-11-16T06:30:00Z'), DEP).getTime()).toBe(
      requestExpiryCap(DEP).getTime(),
    );
  });
});

describe('rideUpdatedRows', () => {
  const rows = rideUpdatedRows(
    {
      id: 'r1',
      driverFirstName: 'Radu',
      previousDepartureAt: DEP,
      departureAt: new Date('2026-11-16T09:00:00Z'),
    },
    [
      { id: 'b1', passengerId: 'p1', pickupArea: 'Turnișor', dropoffArea: 'Centru' },
      { id: 'b2', passengerId: 'p2', pickupArea: 'Șelimbăr', dropoffArea: 'Centru' },
    ],
  );

  it('builds one row per booking for that passenger, with times, names and areas only', () => {
    expect(rows.map((r) => [r.userId, r.template])).toEqual([
      ['p1', 'ride_updated'],
      ['p2', 'ride_updated'],
    ]);
    expect(rows[0]?.payload).toEqual({
      bookingId: 'b1',
      rideId: 'r1',
      driverFirstName: 'Radu',
      previousDepartureAt: '2026-11-16T07:00:00.000Z',
      departureAt: '2026-11-16T09:00:00.000Z',
      pickupArea: 'Turnișor',
      dropoffArea: 'Centru',
    });
    for (const r of rows) expect(() => assertPayloadSafe(r.payload)).not.toThrow();
  });

  it('builds nothing for no bookings and refuses a payload that looks like a coordinate', () => {
    expect(
      rideUpdatedRows(
        { id: 'r', driverFirstName: null, previousDepartureAt: DEP, departureAt: DEP },
        [],
      ),
    ).toEqual([]);
    expect(() =>
      rideUpdatedRows(
        { id: 'r', driverFirstName: null, previousDepartureAt: DEP, departureAt: DEP },
        [{ id: 'b', passengerId: 'p', pickupArea: '45.74130', dropoffArea: 'x' }],
      ),
    ).toThrow();
  });
});
