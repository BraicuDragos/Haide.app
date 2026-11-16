import type { ExactOrApproxPoint } from '@/api/types';
import { dayLabel } from './dates';
import { formatTime } from './format';

/** A point is exact iff the server did not mark it approximate (ADR 0023): `!('approx' in point)`. */
export const isExactPoint = (p: ExactOrApproxPoint): boolean => !('approx' in p);

/** `tel:` link for an E.164 number. Digits and a leading plus only: nothing else can reach the href. */
export function telHref(e164: string): string {
  return `tel:+${e164.replace(/\D/g, '')}`;
}

/** WhatsApp click-to-chat link: `https://wa.me/<digits>` (no plus, no spaces). */
export function whatsappHref(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}`;
}

/** "Today 07:25", "Mon 17 Nov 07:25" for an instant in Europe/Bucharest. */
export const whenLabel = (iso: string): string => `${dayLabel(iso)} ${formatTime(iso)}`;

/**
 * The time an unanswered request lapses, shown on the request sheet before the server has answered.
 * Mirrors the documented rule (BOOKING_LIMITS: 30 minutes, or 10 minutes before departure, whichever is first).
 * The booking view carries the real `expiresAt` afterwards.
 */
export function expectedExpiry(departureAt: string, now: number = Date.now()): string {
  const dep = new Date(departureAt).getTime();
  return new Date(Math.min(now + 30 * 60_000, dep - 10 * 60_000)).toISOString();
}
