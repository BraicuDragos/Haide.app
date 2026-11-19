import { describe, expect, it } from 'vitest';
import { fixedClock } from '../domain/clock.ts';
import type { OutboxRow } from '../domain/outbox.ts';
import { silentLogger } from '../log.ts';
import type { PushProvider, PushSendResult } from '../providers/push/types.ts';
import type { OutboxRecord } from './dispatch.ts';
import { dispatchPush, type LiveSubscription, type PushStore } from './dispatchPush.ts';

const NOW = '2026-11-16T05:00:00Z';
const DEP = '2026-11-20T05:40:00.000Z';

const confirmed = (id: string, userId: string, attempts = 1): OutboxRecord => ({
  id,
  userId,
  template: 'booking_confirmed',
  attempts,
  payload: {
    bookingId: 'b1',
    driverFirstName: 'Ana',
    departureAt: DEP,
    pickupEtaAt: DEP,
    pickupArea: 'Turnișor',
  },
});
const alertRow = (id: string, userId: string, attempts = 1): OutboxRecord => ({
  id,
  userId,
  template: 'ride_alert_match',
  attempts,
  payload: {
    alertId: 'a1',
    rideId: 'r1',
    departureAt: DEP,
    pickupArea: 'Turnișor',
    dropoffArea: 'Piața Mare',
    moreCount: 0,
  },
});

const sub = (id: string, failures = 0): LiveSubscription => ({
  id,
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  p256dh: 'p',
  auth: 'a',
  failures,
});

function setup(
  rows: OutboxRecord[],
  subs: Record<string, LiveSubscription[]>,
  results: Record<string, PushSendResult>,
) {
  const log = {
    sent: [] as string[],
    failed: [] as { id: string; error: string }[],
    rescheduled: [] as { id: string; at: Date; error: string }[],
    success: [] as string[],
    deleted: [] as string[],
    permanent: [] as { id: string; max: number }[],
    fallback: [] as OutboxRow[],
    sentBodies: [] as string[],
  };
  const store: PushStore = {
    claim: () => Promise.resolve(rows),
    subscriptions: () => Promise.resolve(new Map(Object.entries(subs))),
    markSent: (id) => {
      log.sent.push(id);
      return Promise.resolve();
    },
    markFailed: (id, error) => {
      log.failed.push({ id, error });
      return Promise.resolve();
    },
    reschedule: (id, at, error) => {
      log.rescheduled.push({ id, at, error });
      return Promise.resolve();
    },
    recordSuccess: (id) => {
      log.success.push(id);
      return Promise.resolve();
    },
    deleteSubscription: (id) => {
      log.deleted.push(id);
      return Promise.resolve();
    },
    recordPermanentFailure: (id, max) => {
      log.permanent.push({ id, max });
      return Promise.resolve();
    },
    insertEmailFallback: (row) => {
      log.fallback.push(row);
      return Promise.resolve();
    },
  };
  const provider: PushProvider = {
    name: 'test',
    send: (s, body) => {
      log.sentBodies.push(new TextDecoder().decode(body));
      const id = s.endpoint.split('/').pop() as string;
      return Promise.resolve(results[id] ?? { ok: true });
    },
  };
  const run = () =>
    dispatchPush({
      store,
      provider,
      clock: fixedClock(NOW),
      log: silentLogger,
      baseUrl: 'https://haide.ro',
    });
  return { run, log };
}

const gone: PushSendResult = { ok: false, gone: true, permanent: false, error: 'http_410' };
const perm: PushSendResult = { ok: false, gone: false, permanent: true, error: 'http_400' };
const transient: PushSendResult = { ok: false, gone: false, permanent: false, error: 'http_503' };

describe('dispatchPush', () => {
  it('sends the rendered payload to the subscription and marks the row sent', async () => {
    const { run, log } = setup([confirmed('o1', 'u1')], { u1: [sub('s1')] }, {});
    expect(await run()).toEqual({ sent: 1, failed: 0, retried: 0, fallbacks: 0 });
    expect(log.sent).toEqual(['o1']);
    expect(log.success).toEqual(['s1']);
    const body = JSON.parse(log.sentBodies[0] as string) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(['body', 'path', 'tag', 'title']);
    expect(JSON.stringify(body)).not.toContain('Ana');
  });

  it('a 410 deletes the subscription; the row is failed (no fallback for a lifecycle template)', async () => {
    const { run, log } = setup([confirmed('o1', 'u1')], { u1: [sub('s1')] }, { s1: gone });
    const r = await run();
    expect(log.deleted).toEqual(['s1']);
    expect(r).toMatchObject({ sent: 0, failed: 1, fallbacks: 0 });
    expect(log.failed[0]?.error).toBe('http_410');
  });

  it('two subscriptions, one delivered: the row is sent and the dead one is deleted', async () => {
    const { run, log } = setup(
      [confirmed('o1', 'u1')],
      { u1: [sub('s1'), sub('s2')] },
      { s2: gone },
    );
    expect(await run()).toMatchObject({ sent: 1, failed: 0 });
    expect(log.success).toEqual(['s1']);
    expect(log.deleted).toEqual(['s2']);
  });

  it('no subscription left: failed with no_subscription, and an email fallback only for the alert', async () => {
    const a = setup([confirmed('o1', 'u1')], {}, {});
    expect(await a.run()).toMatchObject({ failed: 1, fallbacks: 0 });
    expect(a.log.failed[0]?.error).toBe('no_subscription');

    const b = setup([alertRow('o2', 'u1')], {}, {});
    expect(await b.run()).toMatchObject({ failed: 1, fallbacks: 1 });
    expect(b.log.fallback).toHaveLength(1);
    expect(b.log.fallback[0]).toMatchObject({ userId: 'u1', template: 'ride_alert_match' });
  });

  it('a permanent failure counts toward the 5-failure delete; all permanent: failed + alert fallback', async () => {
    const { run, log } = setup([alertRow('o1', 'u1')], { u1: [sub('s1')] }, { s1: perm });
    expect(await run()).toMatchObject({ sent: 0, failed: 1, fallbacks: 1 });
    expect(log.permanent).toEqual([{ id: 's1', max: 5 }]);
    expect(log.deleted).toEqual([]);
  });

  it('a transient failure is rescheduled with the email backoff, not failed', async () => {
    const { run, log } = setup([alertRow('o1', 'u1', 2)], { u1: [sub('s1')] }, { s1: transient });
    expect(await run()).toEqual({ sent: 0, failed: 0, retried: 1, fallbacks: 0 });
    expect(log.rescheduled[0]?.at).toEqual(new Date('2026-11-16T05:02:00Z')); // after attempt 2: 2 minutes
  });

  it('the fifth transient failure is final: failed, and the alert falls back to email', async () => {
    const { run, log } = setup([alertRow('o1', 'u1', 5)], { u1: [sub('s1')] }, { s1: transient });
    expect(await run()).toMatchObject({ failed: 1, retried: 0, fallbacks: 1 });
    expect(log.rescheduled).toEqual([]);
  });

  it('an unknown template is failed without a send', async () => {
    const row: OutboxRecord = {
      id: 'o1',
      userId: 'u1',
      template: 'nope',
      payload: {},
      attempts: 1,
    };
    const { run, log } = setup([row], { u1: [sub('s1')] }, {});
    expect(await run()).toMatchObject({ failed: 1 });
    expect(log.sentBodies).toEqual([]);
  });

  it('does nothing when no row is due', async () => {
    const { run } = setup([], {}, {});
    expect(await run()).toEqual({ sent: 0, failed: 0, retried: 0, fallbacks: 0 });
  });
});
