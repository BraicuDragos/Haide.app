import type { OutboxTemplate } from './outbox.ts';

/** Web push rules (E8-4, e8-liquidity-spec §5, ADR 0038). Pure. */

/** Templates that also get a push row (the E4-6 set plus the two E8 ones). */
export const PUSH_TEMPLATES = [
  'booking_requested',
  'booking_auto_confirmed',
  'booking_confirmed',
  'booking_rejected',
  'booking_expired',
  'ride_cancelled',
  'booking_cancelled',
  'ride_alert_match',
  'ride_updated',
] as const satisfies readonly OutboxTemplate[];

/** Push first, email only when there is no subscription or the push finally failed. */
export const PUSH_FIRST_TEMPLATES = [
  'ride_alert_match',
] as const satisfies readonly OutboxTemplate[];

export const isPushTemplate = (t: string): boolean =>
  (PUSH_TEMPLATES as readonly string[]).includes(t);
export const isPushFirstTemplate = (t: string): boolean =>
  (PUSH_FIRST_TEMPLATES as readonly string[]).includes(t);

/** Seconds a push service keeps an undelivered message. */
export function pushTtlS(template: string): number {
  if (template === 'booking_requested') return 1800;
  if (template === 'ride_alert_match') return 21600;
  return 3600;
}

const HOST_SUFFIXES = ['.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'];
const HOSTS = ['fcm.googleapis.com', 'web.push.apple.com'];

/**
 * Only known push services: https, default port, no credentials, host on the allow-list. The server
 * POSTs to this URL, so anything else (IP literals, internal hosts, look-alike domains) is refused.
 */
export function isAllowedPushEndpoint(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '') {
    return false;
  }
  const host = u.hostname.toLowerCase();
  return HOSTS.includes(host) || HOST_SUFFIXES.some((s) => host.endsWith(s));
}

const B64URL = /^[A-Za-z0-9_-]+$/;
export const P256DH_CHARS = 87; // 65 bytes
export const AUTH_CHARS = 22; // 16 bytes

/** The host of an endpoint (the push service), for logs. Never the path. */
export function endpointHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return 'unknown';
  }
}

export type SubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Field codes for PUT /me/push-subscription, or null when valid. */
export function checkSubscription(i: SubscriptionInput): Record<string, string> | null {
  const fields: Record<string, string> = {};
  if (i.endpoint.length === 0 || i.endpoint.length > 1000 || !i.endpoint.startsWith('https://')) {
    fields.endpoint = 'invalid';
  } else if (!isAllowedPushEndpoint(i.endpoint)) {
    fields.endpoint = 'unsupported_service';
  }
  const { p256dh, auth } = i.keys;
  if (
    p256dh.length !== P256DH_CHARS ||
    auth.length !== AUTH_CHARS ||
    !B64URL.test(p256dh) ||
    !B64URL.test(auth) ||
    !p256dh.startsWith('B') // 0x04: an uncompressed P-256 point
  ) {
    fields.keys = 'invalid';
  }
  return Object.keys(fields).length > 0 ? fields : null;
}
