import { describe, expect, it } from 'vitest';
import { tickResponseSchema } from '../_shared/contracts/system.ts';
import { fixedClock } from '../_shared/domain/clock.ts';
import { BASE, TEST_CRON_SECRET, makeApp, type Handler, type Query } from './testing.ts';

const BOOKING = 'b1b1b1b1-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const RIDE = '5b0c7f0e-6a1d-4c11-8d2e-9f3a4b5c6d7e';
const PASSENGER = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';

const tick = (app: ReturnType<typeof makeApp>['app']) =>
  app.request(`${BASE}/internal/tick`, {
    method: 'POST',
    headers: { 'x-cron-secret': TEST_CRON_SECRET },
  });

const find = (calls: Query[], fragment: string) => calls.find((c) => c.text.includes(fragment));
const all = (calls: Query[], fragment: string) => calls.filter((c) => c.text.includes(fragment));

const expiredRow = {
  booking_id: BOOKING,
  ride_id: RIDE,
  passenger_id: PASSENGER,
  departure_at: new Date('2026-11-16T07:00:00Z'),
  driver_first_name: 'Radu',
};

const outboxRow = (id: string, template = 'booking_rejected') => ({
  id,
  user_id: PASSENGER,
  template,
  payload: { bookingId: BOOKING, driverFirstName: 'Radu', departureAt: '2026-11-16T07:00:00.000Z' },
  attempts: 1,
});

const dbWith = (over: Handler[] = []): Handler[] => [
  ...over,
  (q) => (q.text.includes('select count(*)::int as n') ? [{ n: 0 }] : undefined),
];

describe('POST /internal/tick', () => {
  it('expires past-due requests, queues the passenger email and logs analytics, in one transaction', async () => {
    const { app, calls } = makeApp(
      dbWith([(q) => (q.text.includes('from app.expire_requests') ? [expiredRow] : undefined)]),
      {},
      { clock: fixedClock('2026-11-16T05:31:00Z') },
    );
    const res = await tick(app);
    expect(res.status).toBe(200);
    expect(tickResponseSchema.parse(await res.json()).expired).toBe(1);

    const fn = find(calls, 'from app.expire_requests') as Query;
    expect(fn.values[0]).toEqual(new Date('2026-11-16T05:31:00Z'));
    const outbox = find(calls, 'insert into app.outbox') as Query;
    expect(outbox.values[0]).toBe(PASSENGER);
    expect(outbox.values[1]).toBe('booking_expired');
    expect(JSON.parse(String(outbox.values[2]))).toEqual({
      bookingId: BOOKING,
      driverFirstName: 'Radu',
      departureAt: '2026-11-16T07:00:00.000Z',
    });
    expect(find(calls, 'insert into app.analytics_events')?.values[0]).toBe('booking_expired');
  });

  it('dispatches due outbox rows through the provider and reports sent and failed', async () => {
    const { app, calls } = makeApp(
      dbWith([
        (q) =>
          q.text.startsWith('update app.outbox set attempts = attempts + 1')
            ? [outboxRow('o1'), outboxRow('o2', 'mystery')]
            : undefined,
        (q) =>
          q.text.includes('from app.outbox_recipients')
            ? [{ user_id: PASSENGER, email: 'ioana@example.com' }]
            : undefined,
      ]),
      {},
      { clock: fixedClock('2026-11-16T05:31:00Z') },
    );
    const out = tickResponseSchema.parse(await (await tick(app)).json());
    expect(out).toMatchObject({ sent: 1, failed: 1 });
    const claim = find(calls, 'update app.outbox set attempts = attempts + 1') as Query;
    expect(claim.text).toContain('for update skip locked');
    expect(claim.text).toContain("status = 'pending'");
    expect(claim.values).toContain(50); // at most 50 per run
    expect(find(calls, "set status = 'sent'")?.values).toContain('o1');
    expect(find(calls, "set status = 'failed'")?.values).toEqual(['unknown_template', 'o2']);
  });

  it('stops sending when the daily cap is reached', async () => {
    const { app, calls } = makeApp(
      [(q) => (q.text.includes("status = 'sent' and sent_at >=") ? [{ n: 280 }] : undefined)],
      {},
      { clock: fixedClock('2026-11-16T05:31:00Z') },
    );
    const out = tickResponseSchema.parse(await (await tick(app)).json());
    expect(out.sent).toBe(0);
    expect(find(calls, 'update app.outbox set attempts')).toBeUndefined();
  });

  it('a failing step is recorded and the next steps still run', async () => {
    const { app, calls } = makeApp(
      dbWith([
        (q) => {
          if (q.text.includes('from app.expire_requests')) throw new Error('db down');
          return undefined;
        },
        (q) => (q.text.includes('delete from app.route_previews') ? [{ n: 3 }] : undefined),
      ]),
      {},
      { clock: fixedClock('2026-11-16T05:31:00Z') },
    );
    const res = await tick(app);
    expect(res.status).toBe(200);
    const out = tickResponseSchema.parse(await res.json());
    expect(out).toMatchObject({ expired: 0, purged: 3 });
    const err = find(calls, 'insert into app.app_errors') as Query;
    expect(err.values[0]).toBe('server');
    expect(String(err.values[1])).toContain('tick expire');
    expect(find(calls, 'update app.outbox set attempts')).toBeDefined(); // dispatch still ran
  });

  it('purges expired previews and share links every minute and housekeeping only at minute 0 UTC', async () => {
    const answer: Handler = (q) => {
      if (q.text.includes('app.run_retention')) {
        return [{ counts: { rateLimits: 2, appErrors: 2, outbox: 2 } }];
      }
      return q.text.includes('delete from') ? [{ n: 2 }] : undefined;
    };

    const quiet = makeApp(dbWith([answer]), {}, { clock: fixedClock('2026-11-16T05:31:00Z') });
    expect(tickResponseSchema.parse(await (await tick(quiet.app)).json()).purged).toBe(4);
    expect(all(quiet.calls, 'delete from').map((c) => c.text)).toEqual([
      expect.stringContaining('app.route_previews'),
      expect.stringContaining('app.share_links'),
    ]);
    expect(find(quiet.calls, 'app.run_retention')).toBeUndefined();

    const hourly = makeApp(dbWith([answer]), {}, { clock: fixedClock('2026-11-16T06:00:00Z') });
    expect(tickResponseSchema.parse(await (await tick(hourly.app)).json()).purged).toBe(10);
    // One definer call replaces the inline deletes of E4 (ADR 0030); previews and share links stay.
    expect(all(hourly.calls, 'app.run_retention')).toHaveLength(1);
    expect(all(hourly.calls, 'delete from')).toHaveLength(2);
  });

  it('runs the steps in order 1 to 8', async () => {
    const { app, calls } = makeApp(dbWith([]), {}, { clock: fixedClock('2026-11-16T06:00:00Z') });
    await tick(app);
    const order = [
      'from app.expire_requests',
      'from app.complete_rides',
      "p.status in ('suspended', 'deleted')",
      'update app.outbox set attempts',
      'delete from app.route_previews',
      'delete from app.share_links',
      'from app.coarsen_locations',
      'from app.account_deletions',
      'app.run_retention',
    ].map((f) => calls.findIndex((c) => c.text.includes(f)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('reports the coarsened rows and the completed account purges', async () => {
    const { app, calls, authDeleted, removedStrict } = makeApp(
      dbWith([
        (q) =>
          q.text.includes('from app.coarsen_locations') ? [{ rides: 3, bookings: 4 }] : undefined,
        (q) =>
          q.text.includes('next_attempt_at <=')
            ? [{ user_id: '7d6f5e4c-3b2a-4a19-8e07-1f2a3b4c5d6e' }]
            : undefined,
        (q) =>
          q.text.startsWith('select user_id, requested_at, photo_path')
            ? [
                {
                  user_id: '7d6f5e4c-3b2a-4a19-8e07-1f2a3b4c5d6e',
                  requested_at: new Date('2026-11-16T05:00:00Z'),
                  photo_path: 'avatars/6f1d8a5e-0000-4000-8000-000000000001.jpg',
                  storage_done_at: null,
                  auth_done_at: null,
                  attempts: 0,
                },
              ]
            : undefined,
        (q) =>
          q.text.includes('set completed_at =')
            ? [{ user_id: '7d6f5e4c-3b2a-4a19-8e07-1f2a3b4c5d6e' }]
            : undefined,
      ]),
      {},
      { clock: fixedClock('2026-11-16T05:31:00Z') },
    );
    const out = tickResponseSchema.parse(await (await tick(app)).json());
    expect(out).toMatchObject({ coarsened: 7, accountsPurged: 1 });
    expect(find(calls, 'from app.coarsen_locations')?.values).toEqual([
      new Date('2026-11-16T05:31:00Z'),
      500,
    ]);
    expect(removedStrict).toEqual(['avatars/6f1d8a5e-0000-4000-8000-000000000001.jpg']);
    expect(authDeleted).toEqual(['7d6f5e4c-3b2a-4a19-8e07-1f2a3b4c5d6e']);
  });

  it('a failing coarsening or purge does not stop the other steps or the housekeeping', async () => {
    const { app, calls } = makeApp(
      dbWith([
        (q) => {
          if (q.text.includes('from app.coarsen_locations')) throw new Error('db down');
          if (q.text.includes('next_attempt_at <=')) throw new Error('db down');
          return undefined;
        },
      ]),
      {},
      { clock: fixedClock('2026-11-16T06:00:00Z') },
    );
    expect((await tick(app)).status).toBe(200);
    const errors = all(calls, 'insert into app.app_errors').map((c) => String(c.values[1]));
    expect(errors.some((m) => m.includes('tick coarsen'))).toBe(true);
    expect(errors.some((m) => m.includes('tick account_purge'))).toBe(true);
    expect(find(calls, 'app.run_retention')).toBeDefined();
  });

  it('raises one app_errors alarm per deletion open for more than 7 days, hourly', async () => {
    const { app, calls } = makeApp(
      dbWith([
        (q) =>
          q.text.includes('requested_at <')
            ? [{ user_id: '7d6f5e4c-3b2a-4a19-8e07-1f2a3b4c5d6e' }]
            : undefined,
      ]),
      {},
      { clock: fixedClock('2026-11-16T06:00:00Z') },
    );
    await tick(app);
    const overdue = find(calls, 'requested_at <') as Query;
    expect(overdue.values[0]).toEqual(new Date('2026-11-09T06:00:00Z'));
    const alarms = all(calls, 'insert into app.app_errors').filter(
      (c) => c.values[1] === 'account_purge_overdue',
    );
    expect(alarms).toHaveLength(1);
    expect(String(alarms[0]?.values[5])).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(alarms[0]?.values)).not.toContain('7d6f5e4c');

    // not on a quiet minute
    const quiet = makeApp(dbWith([]), {}, { clock: fixedClock('2026-11-16T06:01:00Z') });
    await tick(quiet.app);
    expect(find(quiet.calls, 'requested_at <')).toBeUndefined();
  });
});
