import type { LatLng } from '../contracts/geo.ts';
import type { AlertSchedule } from '../contracts/liquidity.ts';
import { DomainError } from './errors.ts';
import { assertPayloadSafe, type OutboxRow, type RideAlertMatchPayload } from './outbox.ts';
import { inCoverage, roundPoint, toUtm35 } from './privacy.ts';
import {
  ALERT_DATE_AHEAD_DAYS,
  ALERT_TTL_DAYS,
  MIN_SEARCH_SEPARATION_M,
  SEARCH_WINDOWS_MIN,
} from './rules.ts';
import { TIME_RE, addLocalDays, dayToMs, normalizeWeekdays } from './series.ts';
import { bucharestDayKey, bucharestLocalToUtc } from './time.ts';

/** Ride alert rules (E8-2, e8-liquidity-spec §3, ADR 0036). Pure. */

export const ALERT_LABEL_MAX_CHARS = 80;
const DAY_MS = 86_400_000;

export type AlertInput = {
  from: LatLng;
  to: LatLng;
  fromLabel: string;
  toLabel: string;
  schedule: { kind: 'date'; date: string } | { kind: 'weekly'; weekdays: readonly number[] };
  time: string;
  windowMin: number;
};

export type ValidAlert = {
  from: LatLng;
  to: LatLng;
  fromLabel: string;
  toLabel: string;
  schedule: AlertSchedule;
  time: string;
  windowMin: 15 | 30 | 60;
  expiresAt: Date;
};

/** NFC, whitespace collapsed, trimmed. Returns the label or the failure code. */
function label(raw: string): { ok: string } | { err: 'required' | 'too_long' } {
  const v = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (v.length === 0) return { err: 'required' };
  if ([...v].length > ALERT_LABEL_MAX_CHARS) return { err: 'too_long' };
  return { ok: v };
}

/**
 * End of an alert: a weekly alert lives 14 days; a date alert until its wanted local time plus the
 * window, when that is sooner than 14 days.
 */
export function alertExpiresAt(
  createdAt: Date,
  schedule: AlertSchedule,
  time: string,
  windowMin: number,
): Date {
  const ttl = new Date(createdAt.getTime() + ALERT_TTL_DAYS * DAY_MS);
  if (schedule.kind === 'weekly') return ttl;
  const end = new Date(bucharestLocalToUtc(schedule.date, time).getTime() + windowMin * 60_000);
  return end.getTime() < ttl.getTime() ? end : ttl;
}

/** Validates a create-alert request. Throws VALIDATION_FAILED with the documented `fields` codes. */
export function validateAlert(input: AlertInput, now: Date): ValidAlert {
  const fields: Record<string, string> = {};
  const from = roundPoint(input.from);
  const to = roundPoint(input.to);
  const fromOk = inCoverage(from);
  const toOk = inCoverage(to);
  if (!fromOk) fields.from = 'outside_coverage';
  if (!toOk) fields.to = 'outside_coverage';
  if (fromOk && toOk) {
    const a = toUtm35(from);
    const b = toUtm35(to);
    if (Math.hypot(a.x - b.x, a.y - b.y) < MIN_SEARCH_SEPARATION_M) fields.to = 'too_close';
  }

  const fl = label(input.fromLabel);
  const tl = label(input.toLabel);
  if ('err' in fl) fields.fromLabel = fl.err;
  if ('err' in tl) fields.toLabel = tl.err;

  if (!TIME_RE.test(input.time)) fields.time = 'invalid';
  const windowMin = SEARCH_WINDOWS_MIN.find((w) => w === input.windowMin);
  if (windowMin === undefined) fields.windowMin = 'invalid';

  const today = bucharestDayKey(now);
  let schedule: AlertSchedule | null = null;
  if (input.schedule.kind === 'date') {
    const d = input.schedule.date;
    if (dayToMs(d) === null) fields.schedule = 'invalid';
    else if (d < today) fields.schedule = 'past';
    else if (d > addLocalDays(today, ALERT_DATE_AHEAD_DAYS)) fields.schedule = 'too_far';
    else schedule = { kind: 'date', date: d };
  } else {
    const weekdays = normalizeWeekdays(input.schedule.weekdays);
    if (!weekdays) fields.schedule = 'invalid';
    else schedule = { kind: 'weekly', weekdays };
  }

  let expiresAt = now;
  if (schedule && TIME_RE.test(input.time) && windowMin !== undefined) {
    expiresAt = alertExpiresAt(now, schedule, input.time, windowMin);
    // A date alert whose window is already over could never match.
    if (expiresAt.getTime() <= now.getTime()) fields.schedule = 'past';
  }

  if (Object.keys(fields).length > 0 || !schedule || windowMin === undefined) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid alert.', fields);
  }
  return {
    from,
    to,
    fromLabel: (fl as { ok: string }).ok,
    toLabel: (tl as { ok: string }).ok,
    schedule,
    time: input.time,
    windowMin,
    expiresAt,
  };
}

export type AlertHit = {
  alertId: string;
  userId: string;
  rideId: string;
  departureAt: Date;
  pickupArea: string;
  dropoffArea: string;
};

/** One notification per alert per run: the soonest ride is the subject, the rest are counted. */
export function groupAlertHits(
  hits: readonly AlertHit[],
): { subject: AlertHit; moreCount: number; all: AlertHit[] }[] {
  const byAlert = new Map<string, AlertHit[]>();
  for (const h of hits) byAlert.set(h.alertId, [...(byAlert.get(h.alertId) ?? []), h]);
  return [...byAlert.values()].map((all) => {
    const sorted = [...all].sort(
      (a, b) =>
        a.departureAt.getTime() - b.departureAt.getTime() || a.rideId.localeCompare(b.rideId),
    );
    return { subject: sorted[0] as AlertHit, moreCount: sorted.length - 1, all: sorted };
  });
}

export function rideAlertMatchRow(
  userId: string,
  payload: RideAlertMatchPayload,
): OutboxRow<'ride_alert_match'> {
  assertPayloadSafe(payload);
  return { userId, template: 'ride_alert_match', payload };
}
