import { describe, expect, it } from 'vitest';
import { OUTBOX_TEMPLATES, outboxDedupeKey } from './outbox.ts';

describe('outboxDedupeKey', () => {
  const key = (template: string, payload: unknown) => outboxDedupeKey({ template, payload });

  it('derives template + natural id for every event that has one', () => {
    expect(key('booking_requested', { bookingId: 'b1' })).toBe('booking_requested:b1');
    expect(key('booking_confirmed', { bookingId: 'b1' })).toBe('booking_confirmed:b1');
    expect(key('booking_auto_confirmed', { bookingId: 'b1', rideId: 'r1' })).toBe(
      'booking_auto_confirmed:b1',
    );
    expect(key('ride_cancelled', { bookingId: 'b2', rideId: 'r1' })).toBe('ride_cancelled:b2');
    expect(key('rating_prompt_driver', { rideId: 'r1' })).toBe('rating_prompt_driver:r1');
    expect(key('no_show_reported', { bookingId: 'b1', reporterRole: 'driver' })).toBe(
      'no_show_reported:b1:driver',
    );
    expect(key('report_received', { reportId: 'rep1' })).toBe('report_received:rep1');
    expect(key('data_export_ack', { requestId: 'q1' })).toBe('data_export_ack:q1');
    expect(key('ride_alert_match', { alertId: 'a1', rideId: 'r1' })).toBe('ride_alert_match:a1:r1');
  });

  it('is null (never deduplicate) for suspensions, reinstatements and unknown templates', () => {
    expect(key('account_suspended', { reasonCode: 'other', statement: 'x' })).toBeNull();
    expect(key('account_reinstated', {})).toBeNull();
    expect(key('mystery', { bookingId: 'b1' })).toBeNull();
  });

  it('is null when the natural id is missing or not a string, so a bad payload is never merged', () => {
    expect(key('booking_confirmed', {})).toBeNull();
    expect(key('booking_confirmed', { bookingId: 7 })).toBeNull();
    expect(key('booking_confirmed', null)).toBeNull();
    expect(key('ride_alert_match', { alertId: 'a1' })).toBeNull();
  });

  it('every template has a decision: a prefixed key, or null for suspend and reinstate', () => {
    for (const t of OUTBOX_TEMPLATES) {
      const k = key(t, {
        bookingId: 'b',
        rideId: 'r',
        alertId: 'a',
        reportId: 'p',
        requestId: 'q',
        reporterRole: 'driver',
      });
      if (t === 'account_suspended' || t === 'account_reinstated') expect(k).toBeNull();
      else expect(k?.startsWith(`${t}:`)).toBe(true);
    }
  });
});
