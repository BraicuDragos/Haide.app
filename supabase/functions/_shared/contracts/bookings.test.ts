import { describe, expect, it } from 'vitest';
import {
  BOOKING_CUTOFF_MIN,
  BOOKING_EXPIRY_MIN,
  CONTACT_WINDOW_H,
  LATE_CANCEL_MIN,
} from '../domain/rules.ts';
import {
  BOOKING_LIMITS,
  bookingActionBodySchema,
  bookingsQuerySchema,
  createBookingBodySchema,
  idempotencyKeySchema,
  summaryResponseSchema,
  summarySeenBodySchema,
} from './index.ts';
import { exactOrApproxPointSchema } from './rides.ts';

const ID = '5b0c7f0e-6a1d-4c11-8d2e-9f3a4b5c6d7e';

describe('booking contract limits agree with the domain constants', () => {
  it('BOOKING_LIMITS mirrors rules.ts', () => {
    expect(BOOKING_LIMITS).toMatchObject({
      expiryMin: BOOKING_EXPIRY_MIN,
      cutoffMin: BOOKING_CUTOFF_MIN,
      lateCancelMin: LATE_CANCEL_MIN,
      contactWindowH: CONTACT_WINDOW_H,
    });
  });
});

describe('request schemas', () => {
  const ok = { rideId: ID, from: { lat: 45.74, lng: 24.18 }, to: { lat: 45.79, lng: 24.15 } };

  it('POST /bookings body needs a uuid ride and two points', () => {
    expect(createBookingBodySchema.safeParse(ok).success).toBe(true);
    expect(createBookingBodySchema.safeParse({ ...ok, rideId: 'nope' }).success).toBe(false);
    expect(createBookingBodySchema.safeParse({ ...ok, from: { lat: 99, lng: 0 } }).success).toBe(
      false,
    );
    expect(createBookingBodySchema.safeParse({ rideId: ID }).success).toBe(false);
  });

  it('there is no price field a client could send', () => {
    expect(createBookingBodySchema.parse({ ...ok, priceBani: 1 })).not.toHaveProperty('priceBani');
  });

  it('idempotency keys are uuids', () => {
    expect(idempotencyKeySchema.safeParse(ID).success).toBe(true);
    expect(idempotencyKeySchema.safeParse('abc').success).toBe(false);
  });

  it('action bodies are empty objects', () => {
    expect(bookingActionBodySchema.safeParse({}).success).toBe(true);
    expect(bookingActionBodySchema.safeParse({ x: 1 }).success).toBe(false);
  });

  it('list query defaults to upcoming, 20 and caps the limit at 50', () => {
    expect(bookingsQuerySchema.parse({})).toEqual({ scope: 'upcoming', limit: 20 });
    expect(bookingsQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(bookingsQuerySchema.safeParse({ scope: 'all' }).success).toBe(false);
  });

  it('seen takes 1 to 50 uuids', () => {
    expect(summarySeenBodySchema.safeParse({ bookingIds: [ID] }).success).toBe(true);
    expect(summarySeenBodySchema.safeParse({ bookingIds: [] }).success).toBe(false);
    expect(summarySeenBodySchema.safeParse({ bookingIds: Array(51).fill(ID) }).success).toBe(false);
    expect(summarySeenBodySchema.safeParse({ bookingIds: ['x'] }).success).toBe(false);
  });
});

describe('response schemas', () => {
  it('summary allows no next ride', () => {
    expect(
      summaryResponseSchema.safeParse({
        driverPendingRequests: 0,
        passengerUnseenUpdates: 0,
        nextRide: null,
      }).success,
    ).toBe(true);
    expect(
      summaryResponseSchema.safeParse({
        driverPendingRequests: 2,
        passengerUnseenUpdates: 1,
        nextRide: { kind: 'booking', id: ID, departureAt: '2026-11-20T05:40:00Z' },
      }).success,
    ).toBe(true);
  });

  it('a grid point keeps its approx flag, an exact point has none', () => {
    const approx = { lat: 45.74, lng: 24.18, approx: true, radiusM: 300 };
    expect(exactOrApproxPointSchema.parse(approx)).toEqual(approx);
    expect(exactOrApproxPointSchema.parse({ lat: 45.74132, lng: 24.18611 })).toEqual({
      lat: 45.74132,
      lng: 24.18611,
    });
  });
});
