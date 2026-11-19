import { describe, expect, it } from 'vitest';
import * as bookings from './bookings.ts';
import {
  EVENT_NAMES,
  alertCreatedEvent,
  alertMatchedEvent,
  EVENT_PROP_KEYS,
  FORBIDDEN_EVENT_KEYS,
  bookingCancelledEvent,
  bookingConfirmedEvent,
  bookingExpiredEvent,
  bookingRejectedEvent,
  bookingRequestedEvent,
  eventPropsOk,
  isEventName,
  noShowReportedEvent,
  ratingSubmittedEvent,
  reportSubmittedEvent,
  rideCompletedEvent,
  searchPerformedEvent,
  type AnalyticsEvent,
} from './events.ts';
import * as safety from './safety.ts';

const AT = new Date('2026-11-17T10:00:00Z');
const U = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';
const R = '5b0c7f0e-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const B = 'b1b1b1b1-6a1d-4c11-8d2e-9f3a4b5c6d7e';

/** One event per name, built with the real builders (ride_published is written by SQL). */
const BUILT: AnalyticsEvent[] = [
  searchPerformedEvent(
    null,
    { resultsCount: 3, fromArea: 'Turnișor', toArea: null, windowMin: 30, corridor: 'west' },
    AT,
  ),
  bookingRequestedEvent(U, { bookingId: B, rideId: R, segmentM: 4200 }, AT),
  bookingConfirmedEvent(U, { bookingId: B, rideId: R, responseSeconds: 310, auto: false }, AT),
  bookingRejectedEvent(U, { bookingId: B, rideId: R, responseSeconds: 60 }, AT),
  bookingExpiredEvent(U, { bookingId: B, rideId: R }, AT),
  bookingCancelledEvent(U, { bookingId: B, rideId: R, by: 'system', late: false }, AT),
  rideCompletedEvent(U, { rideId: R, seats: 3 }, AT),
  noShowReportedEvent(U, { bookingId: B, rideId: R, by: 'driver' }, AT),
  ratingSubmittedEvent(U, { bookingId: B, stars: 5, tagCount: 2, raterRole: 'passenger' }, AT),
  reportSubmittedEvent(U, { reason: 'harassment', alsoBlock: true }, AT),
  alertCreatedEvent(
    U,
    { alertId: R, kind: 'weekly', windowMin: 30, fromArea: 'Turnișor', toArea: null },
    AT,
  ),
  alertMatchedEvent(U, { alertId: R, rideId: R }, AT),
];

describe('EVENT_NAMES', () => {
  it('lists the 13 events in the order of the database CHECK', () => {
    expect([...EVENT_NAMES]).toEqual([
      'search_performed',
      'ride_published',
      'booking_requested',
      'booking_confirmed',
      'booking_rejected',
      'booking_expired',
      'booking_cancelled',
      'ride_completed',
      'no_show_reported',
      'rating_submitted',
      'report_submitted',
      'alert_created',
      'alert_matched',
    ]);
    expect(isEventName('ride_published')).toBe(true);
    expect(isEventName('ride_deleted')).toBe(false);
  });

  it('has an allow-list of prop keys for every event', () => {
    expect(Object.keys(EVENT_PROP_KEYS).sort()).toEqual([...EVENT_NAMES].sort());
  });
});

describe('builders', () => {
  it('every builder produces props that pass the guard and match the allow-list exactly', () => {
    for (const e of BUILT) {
      expect(eventPropsOk(e.props), e.name).toBe(true);
      expect(Object.keys(e.props).sort(), e.name).toEqual([...EVENT_PROP_KEYS[e.name]].sort());
    }
  });

  it('cover all events except ride_published (built in SQL)', () => {
    expect(BUILT.map((e) => e.name).sort()).toEqual(
      EVENT_NAMES.filter((n) => n !== 'ride_published').sort(),
    );
  });

  it('keeps the actor as userId, null for a signed-out search', () => {
    expect(BUILT[0]?.userId).toBeNull();
    expect(BUILT[1]?.userId).toBe(U);
  });

  it('the old import paths still work (compatibility re-exports)', () => {
    expect(bookings.bookingRequestedEvent).toBe(bookingRequestedEvent);
    expect(bookings.bookingCancelledEvent).toBe(bookingCancelledEvent);
    expect(safety.rideCompletedEvent).toBe(rideCompletedEvent);
    expect(safety.reportSubmittedEvent).toBe(reportSubmittedEvent);
  });

  it('the SQL-built ride_published props pass the guard', () => {
    const props = {
      rideId: R,
      distanceM: 5200,
      seats: 3,
      isFree: false,
      originArea: 'Turnișor',
      destinationArea: null,
      inSeries: true,
      autoAccept: false,
    };
    expect(eventPropsOk(props)).toBe(true);
    expect(Object.keys(props).sort()).toEqual([...EVENT_PROP_KEYS.ride_published].sort());
  });
});

describe('eventPropsOk (mirror of app.event_props_ok)', () => {
  it('accepts flat props of strings, numbers, booleans and null', () => {
    expect(eventPropsOk({})).toBe(true);
    expect(eventPropsOk({ a: 'x', b: 1, c: true, d: null, e: 1.5 })).toBe(true);
  });

  it('rejects anything that is not a plain object', () => {
    for (const bad of [null, undefined, 'x', 1, true, [], [1, 2], () => 1]) {
      expect(eventPropsOk(bad), String(bad)).toBe(false);
    }
  });

  it('rejects nested objects and arrays as values', () => {
    expect(eventPropsOk({ a: { b: 1 } })).toBe(false);
    expect(eventPropsOk({ a: [1] })).toBe(false);
    expect(eventPropsOk({ a: undefined })).toBe(false);
  });

  it('rejects every forbidden key, in any letter case', () => {
    for (const key of FORBIDDEN_EVENT_KEYS) {
      expect(eventPropsOk({ [key]: 1 }), key).toBe(false);
      expect(eventPropsOk({ [key.toUpperCase()]: 1 }), key.toUpperCase()).toBe(false);
    }
    expect(eventPropsOk({ phoneE164: '+40' })).toBe(false);
    expect(eventPropsOk({ firstName: 'Ana' })).toBe(false);
    expect(eventPropsOk({ lat: 45.7 })).toBe(false);
    expect(eventPropsOk({ details: 'x' })).toBe(false);
  });

  it('keeps names that only look like forbidden ones', () => {
    expect(eventPropsOk({ fromArea: 'x', originArea: 'x', latency: 1, bookingId: 'b' })).toBe(true);
  });

  it('limits strings to 80 characters, keys to 40 and the object to 12 keys', () => {
    expect(eventPropsOk({ a: 'x'.repeat(80) })).toBe(true);
    expect(eventPropsOk({ a: 'x'.repeat(81) })).toBe(false);
    expect(eventPropsOk({ [`k${'x'.repeat(39)}`]: 1 })).toBe(true);
    expect(eventPropsOk({ [`k${'x'.repeat(40)}`]: 1 })).toBe(false);
    const twelve = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i]));
    expect(eventPropsOk(twelve)).toBe(true);
    expect(eventPropsOk({ ...twelve, k12: 12 })).toBe(false);
  });

  it('counts characters, not UTF-16 units (an emoji is one)', () => {
    expect(eventPropsOk({ a: '😀'.repeat(80) })).toBe(true);
    expect(eventPropsOk({ a: '😀'.repeat(81) })).toBe(false);
  });

  it('rejects non-finite numbers', () => {
    expect(eventPropsOk({ a: Number.NaN })).toBe(false);
    expect(eventPropsOk({ a: Infinity })).toBe(false);
  });
});
