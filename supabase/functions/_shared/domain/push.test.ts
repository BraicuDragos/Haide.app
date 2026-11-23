import { describe, expect, it } from 'vitest';
import {
  PUSH_FIRST_TEMPLATES,
  PUSH_TEMPLATES,
  checkSubscription,
  endpointHost,
  isAllowedPushEndpoint,
  isPushFirstTemplate,
  isPushTemplate,
  pushTtlS,
} from './push.ts';

describe('isAllowedPushEndpoint', () => {
  it('accepts the known push services', () => {
    for (const u of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QAbc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://api.push.apple.com/3/device/abc',
    ]) {
      expect(isAllowedPushEndpoint(u), u).toBe(true);
    }
  });
  it('refuses http, IP literals, ports, credentials and look-alike hosts', () => {
    for (const u of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest',
      'https://[::1]/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://evil.example/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://notfcm.googleapis.com/x',
      'https://evilpush.services.mozilla.com/x',
      'https://fcm.googleapis.com./x',
      'ftp://fcm.googleapis.com/x',
      'not a url',
      '',
    ]) {
      expect(isAllowedPushEndpoint(u), u).toBe(false);
    }
  });
});

describe('templates and TTL', () => {
  it('the push set is the E4-6 lifecycle set plus the two E8 templates; only the alert is push-first', () => {
    expect([...PUSH_TEMPLATES].sort()).toEqual(
      [
        'booking_auto_confirmed',
        'booking_cancelled',
        'booking_confirmed',
        'booking_expired',
        'booking_rejected',
        'booking_requested',
        'ride_alert_match',
        'ride_cancelled',
        'ride_updated',
      ].sort(),
    );
    expect([...PUSH_FIRST_TEMPLATES]).toEqual(['ride_alert_match']);
    expect(isPushTemplate('rating_prompt')).toBe(false);
    expect(isPushTemplate('account_suspended')).toBe(false);
    expect(isPushFirstTemplate('booking_requested')).toBe(false);
  });
  it('TTL: requests 30 minutes, alerts 6 hours, the rest 1 hour', () => {
    expect(pushTtlS('booking_requested')).toBe(1800);
    expect(pushTtlS('ride_alert_match')).toBe(21600);
    expect(pushTtlS('booking_confirmed')).toBe(3600);
    expect(pushTtlS('ride_updated')).toBe(3600);
  });
});

describe('checkSubscription', () => {
  const p256dh = `B${'a'.repeat(86)}`;
  const auth = 'b'.repeat(22);
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
  it('accepts a well-formed subscription', () => {
    expect(checkSubscription({ endpoint, keys: { p256dh, auth } })).toBeNull();
  });
  it('flags endpoint and keys with the documented codes', () => {
    expect(checkSubscription({ endpoint: 'http://x', keys: { p256dh, auth } })).toEqual({
      endpoint: 'invalid',
    });
    expect(
      checkSubscription({ endpoint: 'https://evil.example/x', keys: { p256dh, auth } }),
    ).toEqual({ endpoint: 'unsupported_service' });
    expect(checkSubscription({ endpoint, keys: { p256dh: 'short', auth } })).toEqual({
      keys: 'invalid',
    });
    expect(checkSubscription({ endpoint, keys: { p256dh, auth: 'a+b'.padEnd(22, 'c') } })).toEqual({
      keys: 'invalid',
    });
    expect(checkSubscription({ endpoint, keys: { p256dh: `A${'a'.repeat(86)}`, auth } })).toEqual({
      keys: 'invalid',
    });
  });
  it('endpointHost never returns the path', () => {
    expect(endpointHost(endpoint)).toBe('fcm.googleapis.com');
    expect(endpointHost('nope')).toBe('unknown');
  });
});
