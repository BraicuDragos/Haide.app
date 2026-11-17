import { describe, expect, it } from 'vitest';
import { fixedClock } from '../domain/clock.ts';
import { silentLogger } from '../log.ts';
import type { EmailMessage, EmailProvider, SendResult } from '../providers/email/types.ts';
import {
  BACKOFF_MIN,
  DISPATCH_BATCH,
  LEASE_MIN,
  MAX_ATTEMPTS,
  backoffAfter,
  dispatchOutbox,
  utcMidnight,
  type OutboxRecord,
  type OutboxStore,
} from './dispatch.ts';

const NOW = new Date('2026-11-16T10:30:00Z');
const clock = fixedClock(NOW);

const payload = {
  bookingId: 'b1',
  driverFirstName: 'Radu',
  departureAt: '2026-11-17T07:00:00.000Z',
};
const row = (id: string, over: Partial<OutboxRecord> = {}): OutboxRecord => ({
  id,
  userId: `u-${id}`,
  template: 'booking_rejected',
  payload,
  attempts: 1,
  ...over,
});

function fakeStore(rows: OutboxRecord[], opts: { sentToday?: number; missing?: string[] } = {}) {
  const calls = {
    claim: [] as { now: Date; leaseUntil: Date; limit: number }[],
    sent: [] as string[],
    failed: [] as { id: string; error: string }[],
    rescheduled: [] as { id: string; at: Date; error: string }[],
    countSince: [] as Date[],
  };
  const store: OutboxStore = {
    countSentSince(since) {
      calls.countSince.push(since);
      return Promise.resolve(opts.sentToday ?? 0);
    },
    claim(now, leaseUntil, limit) {
      calls.claim.push({ now, leaseUntil, limit });
      return Promise.resolve(rows.slice(0, limit));
    },
    recipients(ids) {
      const m = new Map<string, string>();
      for (const id of ids) if (!opts.missing?.includes(id)) m.set(id, `${id}@example.com`);
      return Promise.resolve(m);
    },
    markSent(id) {
      calls.sent.push(id);
      return Promise.resolve();
    },
    markFailed(id, error) {
      calls.failed.push({ id, error });
      return Promise.resolve();
    },
    reschedule(id, at, error) {
      calls.rescheduled.push({ id, at, error });
      return Promise.resolve();
    },
  };
  return { store, calls };
}

function fakeProvider(
  result: (m: EmailMessage) => SendResult | Promise<SendResult> = () => ({ ok: true }),
) {
  const sent: EmailMessage[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const provider: EmailProvider = {
    name: 'console',
    async send(m) {
      sent.push(m);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return await result(m);
    },
  };
  return { provider, sent, maxInFlight: () => maxInFlight };
}

const run = (
  store: OutboxStore,
  provider: EmailProvider,
  over: Partial<Parameters<typeof dispatchOutbox>[0]> = {},
) =>
  dispatchOutbox({
    store,
    provider,
    clock,
    log: silentLogger,
    dailyCap: 280,
    baseUrl: 'https://haide.ro',
    ...over,
  });

describe('backoff', () => {
  it('retries after 1, 2, 4 and 8 minutes, then gives up', () => {
    const delays = [1, 2, 3, 4].map(
      (a) => ((backoffAfter(a, NOW) as Date).getTime() - NOW.getTime()) / 60_000,
    );
    expect(delays).toEqual([1, 2, 4, 8]);
    expect(BACKOFF_MIN).toEqual([1, 2, 4, 8]);
    expect(backoffAfter(MAX_ATTEMPTS, NOW)).toBeNull();
    expect(backoffAfter(MAX_ATTEMPTS + 3, NOW)).toBeNull();
  });

  it('utcMidnight truncates to the UTC day', () => {
    expect(utcMidnight(new Date('2026-11-16T23:59:59Z')).toISOString()).toBe(
      '2026-11-16T00:00:00.000Z',
    );
  });
});

describe('dispatchOutbox', () => {
  it('claims with a 5 minute lease, sends to the recipient and marks the row sent', async () => {
    const { store, calls } = fakeStore([row('a'), row('b')]);
    const { provider, sent } = fakeProvider();
    const out = await run(store, provider);
    expect(out).toEqual({ sent: 2, failed: 0, retried: 0 });
    expect(calls.sent).toEqual(['a', 'b']);
    expect(calls.claim[0]).toMatchObject({ limit: DISPATCH_BATCH });
    expect((calls.claim[0] as { leaseUntil: Date }).leaseUntil.getTime() - NOW.getTime()).toBe(
      LEASE_MIN * 60_000,
    );
    expect((calls.countSince[0] as Date).toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(sent[0]).toMatchObject({ to: 'u-a@example.com', tag: 'booking_rejected' });
    expect((sent[0] as EmailMessage).subject).toBe('Radu can’t take you this time');
    expect((sent[0] as EmailMessage).ref).toMatch(/^[0-9a-f]{12}$/);
  });

  it('stops when the daily cap is reached and claims nothing', async () => {
    const { store, calls } = fakeStore([row('a')], { sentToday: 280 });
    const { provider, sent } = fakeProvider();
    expect(await run(store, provider)).toEqual({ sent: 0, failed: 0, retried: 0 });
    expect(calls.claim).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('claims no more than the remaining cap', async () => {
    const { store, calls } = fakeStore([row('a')], { sentToday: 278 });
    const { provider } = fakeProvider();
    await run(store, provider);
    expect((calls.claim[0] as { limit: number }).limit).toBe(2);
  });

  it('claims at most 50 per run', async () => {
    const { store, calls } = fakeStore([]);
    const { provider } = fakeProvider();
    await run(store, provider, { dailyCap: 10_000 });
    expect((calls.claim[0] as { limit: number }).limit).toBe(50);
  });

  it('sends four at a time', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`r${i}`));
    const { store } = fakeStore(rows);
    const p = fakeProvider();
    const out = await run(store, p.provider);
    expect(out.sent).toBe(10);
    expect(p.maxInFlight()).toBeLessThanOrEqual(4);
    expect(p.maxInFlight()).toBeGreaterThan(1);
  });

  it('a missing recipient fails the row without sending', async () => {
    const { store, calls } = fakeStore([row('a')], { missing: ['u-a'] });
    const { provider, sent } = fakeProvider();
    expect(await run(store, provider)).toEqual({ sent: 0, failed: 1, retried: 0 });
    expect(calls.failed).toEqual([{ id: 'a', error: 'no_recipient' }]);
    expect(sent).toHaveLength(0);
  });

  it('an unknown template fails the row', async () => {
    const { store, calls } = fakeStore([row('a', { template: 'mystery' })]);
    const { provider } = fakeProvider();
    expect((await run(store, provider)).failed).toBe(1);
    expect((calls.failed[0] as { error: string }).error).toBe('unknown_template');
  });

  it('a transient failure reschedules with the backoff for that attempt', async () => {
    const { store, calls } = fakeStore([row('a', { attempts: 3 })]);
    const { provider } = fakeProvider(() => ({ ok: false, permanent: false, error: 'brevo:503' }));
    expect(await run(store, provider)).toEqual({ sent: 0, failed: 0, retried: 1 });
    expect(calls.rescheduled).toHaveLength(1);
    expect((calls.rescheduled[0] as { at: Date }).at.getTime() - NOW.getTime()).toBe(4 * 60_000);
    expect(calls.failed).toHaveLength(0);
  });

  it('a transient failure on the fifth attempt is final', async () => {
    const { store, calls } = fakeStore([row('a', { attempts: 5 })]);
    const { provider } = fakeProvider(() => ({ ok: false, permanent: false, error: 'brevo:503' }));
    expect(await run(store, provider)).toEqual({ sent: 0, failed: 1, retried: 0 });
    expect(calls.failed[0]).toEqual({ id: 'a', error: 'brevo:503' });
  });

  it('a permanent failure fails at once, even on the first attempt', async () => {
    const { store, calls } = fakeStore([row('a', { attempts: 1 })]);
    const { provider } = fakeProvider(() => ({ ok: false, permanent: true, error: 'brevo:400' }));
    expect(await run(store, provider)).toEqual({ sent: 0, failed: 1, retried: 0 });
    expect(calls.rescheduled).toHaveLength(0);
  });

  it('a provider that throws counts as transient, and the error is scrubbed and truncated', async () => {
    const { store, calls } = fakeStore([row('a')]);
    const { provider } = fakeProvider(() => {
      throw new Error('boom');
    });
    expect((await run(store, provider)).retried).toBe(1);
    expect((calls.rescheduled[0] as { error: string }).error).toBe('Error');

    const long = fakeStore([row('b', { attempts: 5 })]);
    const p2 = fakeProvider(() => ({
      ok: false,
      permanent: true,
      error: `to radu@example.com +40721234567 ${'x'.repeat(500)}`,
    }));
    await run(long.store, p2.provider);
    const err = (long.calls.failed[0] as { error: string }).error;
    expect(err.length).toBeLessThanOrEqual(300);
    expect(err).not.toContain('radu@example.com');
    expect(err).not.toContain('721234567');
  });

  it('one failing row does not stop the others', async () => {
    const { store, calls } = fakeStore([row('a'), row('b'), row('c')]);
    const { provider } = fakeProvider((m) =>
      m.to.startsWith('u-b') ? { ok: false, permanent: true, error: 'brevo:400' } : { ok: true },
    );
    expect(await run(store, provider)).toEqual({ sent: 2, failed: 1, retried: 0 });
    expect(calls.sent.sort()).toEqual(['a', 'c']);
  });
  it('routes data_export_requested to the support address, not to the requester (E6)', async () => {
    const data = {
      requestId: 'req1',
      userId: 'u-a',
      requestedAt: '2026-11-16T07:40:00.000Z',
    };
    const { store, calls } = fakeStore([
      row('a', { template: 'data_export_requested', payload: data }),
    ]);
    const { provider, sent } = fakeProvider();
    const out = await run(store, provider, { supportTo: 'support@haide.ro' });
    expect(out).toEqual({ sent: 1, failed: 0, retried: 0 });
    expect(calls.sent).toEqual(['a']);
    expect(sent[0]).toMatchObject({ to: 'support@haide.ro', tag: 'data_export_requested' });
    expect((sent[0] as EmailMessage).subject).toBe('Data request req1');
    expect((sent[0] as EmailMessage).text).toContain("select app.export_user_data('u-a');");
  });

  it('fails a support-routed row when no support address is configured', async () => {
    const { store, calls } = fakeStore([
      row('a', { template: 'data_export_requested', payload: {} }),
    ]);
    const { provider, sent } = fakeProvider();
    expect(await run(store, provider)).toEqual({ sent: 0, failed: 1, retried: 0 });
    expect(sent).toHaveLength(0);
    expect(calls.failed).toEqual([{ id: 'a', error: 'no_recipient' }]);
  });

  it('sends the data request acknowledgement to the user (E6)', async () => {
    const { store } = fakeStore([
      row('a', {
        template: 'data_export_ack',
        payload: { requestId: 'req1', dueBy: '2026-12-16T07:40:00.000Z' },
      }),
    ]);
    const { provider, sent } = fakeProvider();
    await run(store, provider, { supportTo: 'support@haide.ro' });
    expect(sent[0]).toMatchObject({ to: 'u-a@example.com', tag: 'data_export_ack' });
  });
});
