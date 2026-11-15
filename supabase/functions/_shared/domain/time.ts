import type { Clock } from './clock.ts';
import { DomainError } from './errors.ts';
import {
  BOOKING_CUTOFF_MIN,
  BOOKING_EXPIRY_MIN,
  CONTACT_WINDOW_H,
  LATE_CANCEL_MIN,
  MAX_LEAD_DAYS,
  MIN_LEAD_MIN,
} from './rules.ts';

/** Display and business calendar timezone (G4). All storage is UTC. */
export const BUCHAREST_TZ = 'Europe/Bucharest';

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUCHAREST_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Wall-clock parts of an instant in Europe/Bucharest. */
export function bucharestParts(at: Date): LocalParts {
  const out: Record<string, number> = {};
  for (const p of partsFmt.formatToParts(at)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** UTC offset of Europe/Bucharest at an instant, in minutes (120 winter, 180 summer). */
export function bucharestOffsetMin(at: Date): number {
  const p = bucharestParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / MIN_MS);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Calendar day key `YYYY-MM-DD` in Europe/Bucharest (daily ride limit, display). */
export function bucharestDayKey(at: Date): string {
  const p = bucharestParts(at);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Convert a Bucharest wall-clock date + time to a UTC instant.
 * Times inside the spring-forward gap resolve to the instant just after the gap.
 */
export function bucharestLocalToUtc(dayKey: string, time: string): Date {
  const d = DAY_RE.exec(dayKey);
  const t = TIME_RE.exec(time);
  if (!d || !t) throw new DomainError('VALIDATION_FAILED', 'Invalid date or time');
  const [y, m, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const naive = Date.UTC(y, m - 1, day, Number(t[1]), Number(t[2]));
  const check = new Date(naive);
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== day) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid calendar date');
  }
  let guess = naive - bucharestOffsetMin(new Date(naive)) * MIN_MS;
  guess = naive - bucharestOffsetMin(new Date(guess)) * MIN_MS;
  return new Date(guess);
}

/** [start, end) of a Bucharest calendar day as UTC instants (23 or 25 h on DST days). */
export function bucharestDayBounds(dayKey: string): { startUtc: Date; endUtc: Date } {
  const startUtc = bucharestLocalToUtc(dayKey, '00:00');
  const next = new Date(startUtc.getTime() + 36 * HOUR_MS);
  const endUtc = bucharestLocalToUtc(bucharestDayKey(next), '00:00');
  return { startUtc, endUtc };
}

/** `HH:MM` 24 h wall-clock time in Europe/Bucharest. */
export function bucharestTime(at: Date): string {
  const p = bucharestParts(at);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MIN_MS);
}

/** Departure must be 15 min to 14 days ahead. Returns the violated rule or null. */
export function checkDeparture(
  departureAt: Date,
  clock: Clock,
): 'DEPARTURE_TOO_SOON' | 'DEPARTURE_TOO_FAR' | null {
  const now = clock.now().getTime();
  const dep = departureAt.getTime();
  if (dep < now + MIN_LEAD_MIN * MIN_MS) return 'DEPARTURE_TOO_SOON';
  if (dep > now + MAX_LEAD_DAYS * DAY_MS) return 'DEPARTURE_TOO_FAR';
  return null;
}

/** Cancelling within 30 min of departure counts as a late cancellation. */
export function isLateCancel(departureAt: Date, clock: Clock): boolean {
  return departureAt.getTime() - clock.now().getTime() <= LATE_CANCEL_MIN * MIN_MS;
}

/** Phone, plate and exact points are visible until departure + 24 h. */
export function contactWindowOpen(departureAt: Date, clock: Clock): boolean {
  return clock.now().getTime() < departureAt.getTime() + CONTACT_WINDOW_H * HOUR_MS;
}

/** Requests are bookable until 10 min before departure. */
export function bookingCutoffPassed(departureAt: Date, clock: Clock): boolean {
  return clock.now().getTime() > departureAt.getTime() - BOOKING_CUTOFF_MIN * MIN_MS;
}

/** `least(requested_at + 30 min, departure_at - 10 min)`. */
export function bookingExpiresAt(requestedAt: Date, departureAt: Date): Date {
  const byTtl = requestedAt.getTime() + BOOKING_EXPIRY_MIN * MIN_MS;
  const byDeparture = departureAt.getTime() - BOOKING_CUTOFF_MIN * MIN_MS;
  return new Date(Math.min(byTtl, byDeparture));
}
