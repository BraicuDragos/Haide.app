import { describe, expect, it } from 'vitest';
import { bookingAutoConfirmedOutbox, isAutoAcceptEligible } from './autoAccept.ts';

describe('isAutoAcceptEligible', () => {
  it('3.99 is not eligible, 4.00 is (with 3 or more visible ratings)', () => {
    expect(isAutoAcceptEligible({ ratingCount: 3, ratingAvg: 3.99 })).toBe(false);
    expect(isAutoAcceptEligible({ ratingCount: 3, ratingAvg: 4.0 })).toBe(true);
    expect(isAutoAcceptEligible({ ratingCount: 40, ratingAvg: 4.8 })).toBe(true);
  });
  it('a passenger with fewer than 3 visible ratings is New and eligible, whatever the average', () => {
    expect(isAutoAcceptEligible({ ratingCount: 0, ratingAvg: null })).toBe(true);
    expect(isAutoAcceptEligible({ ratingCount: 2, ratingAvg: 1 })).toBe(true);
  });
  it('a missing average with 3 or more ratings is not eligible', () => {
    expect(isAutoAcceptEligible({ ratingCount: 3, ratingAvg: null })).toBe(false);
  });
});

describe('bookingAutoConfirmedOutbox', () => {
  it('addresses the driver and carries ids, areas and a time only', () => {
    const row = bookingAutoConfirmedOutbox('driver-1', {
      bookingId: 'b1',
      rideId: 'r1',
      departureAt: '2026-11-20T05:30:00.000Z',
      pickupArea: 'Turnișor',
      dropoffArea: 'Piața Mare',
    });
    expect(row.userId).toBe('driver-1');
    expect(row.template).toBe('booking_auto_confirmed');
    expect(Object.keys(row.payload).sort()).toEqual(
      ['bookingId', 'departureAt', 'dropoffArea', 'pickupArea', 'rideId'].sort(),
    );
  });
  it('refuses a payload that looks like it holds a phone', () => {
    expect(() =>
      bookingAutoConfirmedOutbox('d', {
        bookingId: 'b',
        rideId: 'r',
        departureAt: 'x',
        pickupArea: '+40721234567',
        dropoffArea: 'y',
      }),
    ).toThrow();
  });
});
