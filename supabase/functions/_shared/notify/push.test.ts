import { describe, expect, it } from 'vitest';
import { PUSH_TEMPLATES } from '../domain/push.ts';
import { PUSH_MAX_BYTES, assertPushSafe, pushTime, renderPush } from './push.ts';
import type { TemplateInput } from './templates.ts';

const NOW = new Date('2026-11-16T05:00:00Z');
const ctx = { baseUrl: 'https://haide.ro', now: NOW };
const DEP = '2026-11-20T05:40:00.000Z'; // Fri 20 Nov, 07:40 local

const INPUTS: TemplateInput[] = [
  {
    template: 'booking_requested',
    payload: {
      bookingId: 'b1',
      rideId: 'r1',
      passengerFirstName: 'Ana',
      departureAt: DEP,
      pickupArea: 'Turnișor',
      dropoffArea: 'Piața Mare',
      expiresAt: DEP,
    },
  },
  {
    template: 'booking_auto_confirmed',
    payload: {
      bookingId: 'b1',
      rideId: 'r1',
      departureAt: DEP,
      pickupArea: 'Turnișor',
      dropoffArea: 'Piața Mare',
    },
  },
  {
    template: 'booking_confirmed',
    payload: {
      bookingId: 'b1',
      driverFirstName: 'Ana',
      departureAt: DEP,
      pickupEtaAt: DEP,
      pickupArea: 'Turnișor',
    },
  },
  {
    template: 'booking_rejected',
    payload: { bookingId: 'b1', driverFirstName: 'Ana', departureAt: DEP },
  },
  {
    template: 'booking_expired',
    payload: { bookingId: 'b1', driverFirstName: 'Ana', departureAt: DEP },
  },
  {
    template: 'ride_cancelled',
    payload: {
      bookingId: 'b1',
      rideId: 'r1',
      driverFirstName: 'Ana',
      departureAt: DEP,
      pickupArea: 'Turnișor',
      dropoffArea: 'Piața Mare',
    },
  },
  {
    template: 'booking_cancelled',
    payload: { bookingId: 'b1', rideId: 'r1', passengerFirstName: 'Ana', departureAt: DEP },
  },
  {
    template: 'ride_alert_match',
    payload: {
      alertId: 'a1',
      rideId: 'r1',
      departureAt: DEP,
      pickupArea: 'Turnișor',
      dropoffArea: 'Piața Mare',
      moreCount: 2,
    },
  },
  {
    template: 'ride_updated',
    payload: {
      bookingId: 'b1',
      rideId: 'r1',
      driverFirstName: 'Ana',
      previousDepartureAt: '2026-11-20T04:00:00.000Z',
      departureAt: DEP,
      pickupArea: 'Turnișor',
      dropoffArea: 'Piața Mare',
    },
  },
];

describe('renderPush', () => {
  it('has an input for every push template', () => {
    expect(INPUTS.map((i) => i.template).sort()).toEqual([...PUSH_TEMPLATES].sort());
  });

  it('never outputs a first name, whatever the payload carries', () => {
    for (const input of INPUTS) {
      const out = renderPush(input, ctx);
      expect(JSON.stringify(out), input.template).not.toContain('Ana');
    }
  });

  it('every message is safe, short, and carries a path and a tag', () => {
    for (const input of INPUTS) {
      const out = renderPush(input, ctx);
      expect(() => assertPushSafe(out), input.template).not.toThrow();
      expect(out.title.length).toBeGreaterThan(0);
      expect([...out.title].length).toBeLessThanOrEqual(60);
      expect([...out.body].length).toBeLessThanOrEqual(160);
      expect(out.path.startsWith('/'), input.template).toBe(true);
      expect(out.tag.startsWith(`${input.template}:`), input.template).toBe(true);
    }
  });

  it('uses the same in-app path as the email and local times like Fri 07:40', () => {
    const request = renderPush(INPUTS[0] as TemplateInput, ctx);
    expect(request.path).toBe('/driving/r1');
    expect(request.body).toContain('Fri 07:40');
    expect(pushTime(new Date(DEP))).toBe('Fri 07:40');
  });

  it('the alert match names the areas, counts the extra rides and deep-links to the ride', () => {
    const out = renderPush(INPUTS[7] as TemplateInput, ctx);
    expect(out.body).toContain('Turnișor to Piața Mare');
    expect(out.body).toContain('2 more');
    expect(out.path).toBe('/ride/r1?alert=a1');
    expect(out.tag).toBe('ride_alert_match:a1');
  });

  it('ride_updated: new and old local time, the passenger’s areas, the booking path, no driver name', () => {
    const out = renderPush(INPUTS[8] as TemplateInput, ctx);
    expect(out.title).toBe('Ride time changed');
    expect(out.body).toBe('Now leaving Fri 07:40 (was Fri 06:00), Turnișor to Piața Mare.');
    expect(out.path).toBe('/booking/b1');
    expect(out.tag).toBe('ride_updated:b1');
  });

  it('refuses templates that have no push form', () => {
    expect(() => renderPush({ template: 'account_reinstated', payload: {} }, ctx)).toThrow();
  });
});

describe('assertPushSafe', () => {
  it('rejects a payload with a phone, a coordinate, an email, or over the size cap', () => {
    const msg = { title: 't', body: 'b', path: '/x', tag: 't:1' };
    expect(() => assertPushSafe(msg)).not.toThrow();
    expect(() => assertPushSafe({ ...msg, body: 'call +40721234567' })).toThrow();
    expect(() => assertPushSafe({ ...msg, body: 'at 45.74131, 24.18610' })).toThrow();
    expect(() => assertPushSafe({ ...msg, body: 'a@b.ro' })).toThrow();
    expect(() => assertPushSafe({ ...msg, body: 'x'.repeat(PUSH_MAX_BYTES + 1) })).toThrow();
  });
});
