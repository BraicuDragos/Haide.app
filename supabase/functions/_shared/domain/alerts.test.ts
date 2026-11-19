import { describe, expect, it } from 'vitest';
import {
  alertExpiresAt,
  groupAlertHits,
  rideAlertMatchRow,
  validateAlert,
  type AlertInput,
} from './alerts.ts';
import type { DomainError } from './errors.ts';

const NOW = new Date('2026-11-19T10:00:00Z'); // Thu 19 Nov 2026, 12:00 local
const base: AlertInput = {
  from: { lat: 45.7413, lng: 24.1861 },
  to: { lat: 45.785, lng: 24.09 },
  fromLabel: '  Shopping City ',
  toLabel: 'Zona Industrială Vest',
  schedule: { kind: 'weekly', weekdays: [3, 1] },
  time: '07:30',
  windowMin: 30,
};
const fieldsOf = (input: AlertInput): Record<string, string> | undefined => {
  try {
    validateAlert(input, NOW);
  } catch (e) {
    return (e as DomainError).fields;
  }
  return undefined;
};

describe('validateAlert', () => {
  it('normalises labels, weekdays and points', () => {
    const v = validateAlert({ ...base, from: { lat: 45.741304, lng: 24.186104 } }, NOW);
    expect(v.fromLabel).toBe('Shopping City');
    expect(v.schedule).toEqual({ kind: 'weekly', weekdays: [1, 3] });
    expect(v.from).toEqual({ lat: 45.7413, lng: 24.1861 });
    expect(v.expiresAt.toISOString()).toBe('2026-12-03T10:00:00.000Z');
  });
  it('flags points outside the coverage box or too close', () => {
    expect(fieldsOf({ ...base, from: { lat: 44, lng: 24.1 } })).toEqual({
      from: 'outside_coverage',
    });
    expect(fieldsOf({ ...base, to: { lat: 46.5, lng: 24.1 } })).toEqual({ to: 'outside_coverage' });
    expect(fieldsOf({ ...base, to: { lat: 45.7418, lng: 24.1865 } })).toEqual({ to: 'too_close' });
  });
  it('flags labels, time and window', () => {
    expect(fieldsOf({ ...base, fromLabel: '   ' })).toEqual({ fromLabel: 'required' });
    expect(fieldsOf({ ...base, toLabel: 'x'.repeat(81) })).toEqual({ toLabel: 'too_long' });
    expect(fieldsOf({ ...base, time: '24:00' })).toEqual({ time: 'invalid' });
    expect(fieldsOf({ ...base, windowMin: 45 })).toEqual({ windowMin: 'invalid' });
  });
  it('flags the schedule: invalid, past, too far', () => {
    expect(fieldsOf({ ...base, schedule: { kind: 'weekly', weekdays: [] } })).toEqual({
      schedule: 'invalid',
    });
    expect(fieldsOf({ ...base, schedule: { kind: 'date', date: '2026-13-01' } })).toEqual({
      schedule: 'invalid',
    });
    expect(fieldsOf({ ...base, schedule: { kind: 'date', date: '2026-11-18' } })).toEqual({
      schedule: 'past',
    });
    expect(fieldsOf({ ...base, schedule: { kind: 'date', date: '2026-12-04' } })).toEqual({
      schedule: 'too_far',
    });
    // today, but the window is already over (08:00 plus or minus 30 min, now 12:00)
    expect(
      fieldsOf({ ...base, time: '08:00', schedule: { kind: 'date', date: '2026-11-19' } }),
    ).toEqual({ schedule: 'past' });
  });
  it('accepts today + 14 days', () => {
    expect(fieldsOf({ ...base, schedule: { kind: 'date', date: '2026-12-03' } })).toBeUndefined();
  });
});

describe('alertExpiresAt', () => {
  it('weekly lives 14 days; a date alert ends at its window end when that is sooner', () => {
    expect(alertExpiresAt(NOW, { kind: 'weekly', weekdays: [1] }, '07:30', 30).toISOString()).toBe(
      '2026-12-03T10:00:00.000Z',
    );
    // 20 Nov 07:30 local (05:30Z) + 30 min
    expect(
      alertExpiresAt(NOW, { kind: 'date', date: '2026-11-20' }, '07:30', 30).toISOString(),
    ).toBe('2026-11-20T06:00:00.000Z');
  });
  it('a date alert never outlives 14 days', () => {
    expect(
      alertExpiresAt(NOW, { kind: 'date', date: '2026-12-03' }, '23:00', 60).toISOString(),
    ).toBe('2026-12-03T10:00:00.000Z');
  });
});

describe('groupAlertHits and rideAlertMatchRow', () => {
  const hit = (alertId: string, rideId: string, at: string) => ({
    alertId,
    userId: 'u1',
    rideId,
    departureAt: new Date(at),
    pickupArea: 'Turnișor',
    dropoffArea: 'Piața Mare',
  });
  it('one group per alert: the soonest ride is the subject, the rest are counted', () => {
    const g = groupAlertHits([
      hit('a1', 'r3', '2026-11-27T05:30:00Z'),
      hit('a1', 'r1', '2026-11-23T05:30:00Z'),
      hit('a2', 'r9', '2026-11-24T05:30:00Z'),
      hit('a1', 'r2', '2026-11-25T05:30:00Z'),
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]?.subject.rideId).toBe('r1');
    expect(g[0]?.moreCount).toBe(2);
    expect(g[0]?.all.map((h) => h.rideId)).toEqual(['r1', 'r2', 'r3']);
    expect(g[1]?.moreCount).toBe(0);
  });
  it('the match row holds ids, areas and a time only', () => {
    const row = rideAlertMatchRow('u1', {
      alertId: 'a1',
      rideId: 'r1',
      departureAt: '2026-11-23T05:30:00.000Z',
      pickupArea: 'Turnișor',
      dropoffArea: 'Piața Mare',
      moreCount: 0,
    });
    expect(row.template).toBe('ride_alert_match');
    expect(JSON.stringify(row.payload)).not.toMatch(/lat|lng|phone/i);
  });
});
