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

function fakeStore(
  rows: OutboxRecord[],
  opts: { sentToday?: number; missing?: string[]; suspended?: string[] } = {},
) {
  const calls = {
    claim: [] as { now: Date; leaseUntil: Date; limit: number }[],
    sent: [] as string[],
    messageIds: [] as (string | undefined)[],
    failed: [] as { id: string; error: string }[],
    rescheduled: [] as { id: string; at: Date; error: string }[],
    countSince: [] as Date[],
    recipients: [] as { ids: string[]; includeSuspended: boolean | undefined }[],
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
    recipients(ids, includeSuspended) {
      calls.recipients.push({ ids: [...ids], includeSuspended });
      const m = new Map<string, string>();
      for (const id of ids) {
        if (opts.suspended?.includes(id) && !includeSuspended) continue;
        if (!opts.missing?.includes(id)) m.set(id, `${id}@example.com`);
      }
      return Promise.resolve(m);
    },
    markSent(id, _at, messageId) {
      calls.sent.push(id);
      calls.messageIds.push(messageId);
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
    // Sequential by default: send order is otherwise timing dependent. A test that checks concurrency overrides it.
    concurrency: 1,
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
    const out = await run(store, p.provider, { concurrency: 4 });
    expect(out.sent).toBe(10);
    expect(p.maxInFlight()).toBeLessThanOrEqual(4);
    expect(p.maxInFlight()).toBeGreaterThan(1);
  });

  it('shows the configured support mailbox in the footer, never the placeholder', async () => {
    const { store } = fakeStore([row('a')]);
    const { provider, sent } = fakeProvider();
    await run(store, provider, { supportTo: 'help@example.org' });
    expect(sent[0]?.html).toContain('help@example.org');
    expect(sent[0]?.text).toContain('help@example.org');
    expect(sent[0]?.html).not.toContain('haide.example');
    expect(sent[0]?.html).toContain('Dragoș Braicu');
  });

  it('a missing recipient fails the row without sending', async () => {
    const { store, calls } = fakeStore([row('a')], { missing: ['u-a'] });
    const { provider, sent } = fakeProvider();
    expect(await run(store, provider)).toEqual({ sent: 0, failed: 1, retried: 0 });
    expect(calls.failed).toEqual([{ id: 'a', error: 'no_recipient:inactive_or_no_email' }]);
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
    expect((calls.rescheduled[0] as { error: string }).error).toBe('provider_threw:Error: boom');

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
    expect(calls.failed).toEqual([{ id: 'a', error: 'no_recipient:support_address_unset' }]);
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

describe('E7: recipients of templates that must reach a suspended user', () => {
  const suspendedRow = (id: string) =>
    row(id, {
      template: 'account_suspended',
      payload: { reasonCode: 'other', statement: 'A statement of reasons.' },
    });

  it('looks up ANY_STATUS_TEMPLATES with includeSuspended and the rest without it', async () => {
    const { store, calls } = fakeStore(
      [
        row('a'),
        suspendedRow('b'),
        row('c', {
          template: 'data_export_ack',
          payload: { requestId: 'r', dueBy: '2026-12-16T00:00:00.000Z' },
        }),
      ],
      { suspended: ['u-b', 'u-c'] },
    );
    const { provider, sent } = fakeProvider();
    const result = await run(store, provider);
    expect(calls.recipients).toEqual([
      { ids: ['u-a'], includeSuspended: undefined },
      { ids: ['u-b', 'u-c'], includeSuspended: true },
    ]);
    expect(result.sent).toBe(3);
    expect(sent.map((m) => m.to).sort()).toEqual([
      'u-a@example.com',
      'u-b@example.com',
      'u-c@example.com',
    ]);
  });

  it('a normal template to a suspended user has no recipient and fails', async () => {
    const { store, calls } = fakeStore([row('a')], { suspended: ['u-a'] });
    const { provider, sent } = fakeProvider();
    const result = await run(store, provider);
    expect(sent).toHaveLength(0);
    expect(result.failed).toBe(1);
    expect(calls.failed[0]?.error).toBe('no_recipient:inactive_or_no_email');
  });

  it('skips the second lookup when no row needs it', async () => {
    const { store, calls } = fakeStore([row('a'), row('b')]);
    await run(store, fakeProvider().provider);
    expect(calls.recipients).toHaveLength(1);
    expect(calls.recipients[0]?.includeSuspended).toBeUndefined();
  });
});

describe('item 7: traceability and failure logging', () => {
  type Line = { level: string; event: string; fields: Record<string, unknown> };
  const capture = () => {
    const lines: Line[] = [];
    const log = (level: string, event: string, fields: Record<string, unknown> = {}) => {
      lines.push({ level, event, fields });
    };
    return { lines, log: log as Parameters<typeof dispatchOutbox>[0]['log'] };
  };

  it('stores the provider message id and logs outbox_sent without the address', async () => {
    const { store, calls } = fakeStore([row('a')]);
    const { provider } = fakeProvider(() => ({ ok: true, messageId: '<202611@smtp-relay.brevo>' }));
    const { lines, log } = capture();
    await run(store, provider, { log });
    expect(calls.messageIds).toEqual(['<202611@smtp-relay.brevo>']);
    const sentLine = lines.find((l) => l.event === 'outbox_sent');
    expect(sentLine?.fields).toMatchObject({
      template: 'booking_rejected',
      messageId: '<202611@smtp-relay.brevo>',
    });
    expect(String(sentLine?.fields.ref)).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(lines)).not.toContain('@example.com');
  });

  it('a provider without a message id still marks the row sent', async () => {
    const { store, calls } = fakeStore([row('a')]);
    await run(store, fakeProvider().provider);
    expect(calls.sent).toEqual(['a']);
    expect(calls.messageIds).toEqual([undefined]);
  });

  it('a permanent 4xx fails the row with the reason, no message id, and logs the error', async () => {
    const { store, calls } = fakeStore([row('a')]);
    const { provider } = fakeProvider(() => ({
      ok: false,
      permanent: true,
      error: 'brevo:400 sender not valid',
    }));
    const { lines, log } = capture();
    expect(await run(store, provider, { log })).toEqual({ sent: 0, failed: 1, retried: 0 });
    expect(calls.failed).toEqual([{ id: 'a', error: 'brevo:400 sender not valid' }]);
    expect(calls.messageIds).toEqual([]);
    expect(lines.find((l) => l.event === 'outbox_failed')?.fields).toEqual({
      template: 'booking_rejected',
      attempts: 1,
      error: 'brevo:400 sender not valid',
    });
  });

  it('a transient failure is retried, not failed, and not logged as outbox_failed', async () => {
    const { store, calls } = fakeStore([row('a', { attempts: 1 })]);
    const { provider } = fakeProvider(() => ({ ok: false, permanent: false, error: 'brevo:503' }));
    const { lines, log } = capture();
    expect(await run(store, provider, { log })).toEqual({ sent: 0, failed: 0, retried: 1 });
    expect(calls.rescheduled[0]?.error).toBe('brevo:503');
    expect(lines.some((l) => l.event === 'outbox_failed')).toBe(false);
  });

  it('a recipient miss is logged with the reason and never sends', async () => {
    const { store } = fakeStore([row('a')], { missing: ['u-a'] });
    const { provider, sent } = fakeProvider();
    const { lines, log } = capture();
    await run(store, provider, { log });
    expect(sent).toHaveLength(0);
    expect(lines.find((l) => l.event === 'outbox_failed')?.fields.error).toBe(
      'no_recipient:inactive_or_no_email',
    );
  });

  it('dispatching twice sends once: the second run claims nothing', async () => {
    const pending = new Map<string, OutboxRecord>([['a', row('a')]]);
    const store: OutboxStore = {
      countSentSince: () => Promise.resolve(0),
      claim: (_n, _l, limit) => Promise.resolve([...pending.values()].slice(0, limit)),
      recipients: (ids) => Promise.resolve(new Map(ids.map((i) => [i, `${i}@example.com`]))),
      markSent: (id) => {
        pending.delete(id);
        return Promise.resolve();
      },
      markFailed: (id) => {
        pending.delete(id);
        return Promise.resolve();
      },
      reschedule: () => Promise.resolve(),
    };
    const { provider, sent } = fakeProvider();
    await run(store, provider);
    await run(store, provider);
    expect(sent).toHaveLength(1);
  });
});
