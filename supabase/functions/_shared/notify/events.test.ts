import { describe, expect, it } from 'vitest';
import { rideAlertMatchRow } from '../domain/alerts.ts';
import { bookingAutoConfirmedOutbox } from '../domain/autoAccept.ts';
import {
  bookingCancelledOutbox,
  bookingConfirmedOutbox,
  bookingExpiredOutbox,
  bookingRejectedOutbox,
  bookingRequestedOutbox,
  rideCancelledRows,
} from '../domain/bookings.ts';
import { fixedClock } from '../domain/clock.ts';
import { outboxDedupeKey, type OutboxRow } from '../domain/outbox.ts';
import {
  accountReinstatedOutbox,
  accountSuspendedOutbox,
  dataExportAckOutbox,
  dataExportRequestedOutbox,
} from '../domain/privacy.ts';
import {
  noShowReportedOutbox,
  ratingPromptDriverOutbox,
  ratingPromptOutbox,
  reportReceivedOutbox,
} from '../domain/safety.ts';
import { rideUpdatedRows } from '../domain/rides.ts';
import { silentLogger } from '../log.ts';
import type { EmailMessage, EmailProvider } from '../providers/email/types.ts';
import { dispatchOutbox, type OutboxRecord, type OutboxStore } from './dispatch.ts';

/**
 * One test per notification event (docs/architecture/notifications.md, item 7): the REAL row builder,
 * an in-memory outbox that applies the same dedupe rule as the partial unique index, the REAL dispatcher
 * and templates, and a fake provider. Proves the right recipient and the right template for each event.
 * The service-level triggers (who gets which row) are asserted in api/*.test.ts against the SQL calls.
 */

const DEP = '2026-11-17T07:00:00.000Z';
const DRIVER = 'driver-1';
const PASS = 'passenger-1';
const PASS_2 = 'passenger-2';
const ADMIN = 'admin-1';
const SUPPORT = 'support@haide.test';
const mail = (id: string) => `${id}@mail.test`;

function world() {
  type Stored = OutboxRecord & { status: 'pending' | 'sent' | 'failed'; key: string | null };
  const rows: Stored[] = [];
  const messageIds = new Map<string, string | undefined>();
  const enqueue = (list: readonly OutboxRow[]) => {
    for (const r of list) {
      const key = outboxDedupeKey(r);
      // same semantics as: on conflict (user_id, channel, dedupe_key) where dedupe_key is not null do nothing
      if (key !== null && rows.some((x) => x.userId === r.userId && x.key === key)) continue;
      rows.push({
        id: `o${rows.length + 1}`,
        userId: r.userId,
        template: r.template,
        payload: r.payload,
        attempts: 0,
        status: 'pending',
        key,
      });
    }
  };
  const store: OutboxStore = {
    countSentSince: () => Promise.resolve(0),
    claim: (_n, _l, limit) => {
      const due = rows.filter((r) => r.status === 'pending').slice(0, limit);
      for (const r of due) r.attempts++;
      return Promise.resolve(due.map((r) => ({ ...r })));
    },
    recipients: (ids) =>
      Promise.resolve(new Map(ids.filter((i) => i !== 'ghost').map((i) => [i, mail(i)]))),
    markSent: (id, _at, messageId) => {
      const r = rows.find((x) => x.id === id);
      if (r?.status === 'pending') r.status = 'sent';
      messageIds.set(id, messageId);
      return Promise.resolve();
    },
    markFailed: (id) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.status = 'failed';
      return Promise.resolve();
    },
    reschedule: () => Promise.resolve(),
  };
  const sent: EmailMessage[] = [];
  const provider: EmailProvider = {
    name: 'console',
    send: (m) => {
      sent.push(m);
      return Promise.resolve({ ok: true, messageId: `msg-${sent.length}` });
    },
  };
  const dispatch = () =>
    dispatchOutbox({
      store,
      provider,
      clock: fixedClock('2026-11-16T10:30:00Z'),
      log: silentLogger,
      dailyCap: 280,
      baseUrl: 'https://haide.test',
      supportTo: SUPPORT,
      // One at a time: with the production concurrency the send order depends on async timing,
      // and these tests assert who gets which mail in enqueue order.
      concurrency: 1,
    });
  return { rows, sent, enqueue, dispatch, messageIds };
}

/** Enqueues the rows, dispatches, and returns [recipient address, template tag] of every mail. */
async function mailsFor(list: readonly OutboxRow[]): Promise<[string, string][]> {
  const w = world();
  w.enqueue(list);
  await w.dispatch();
  return w.sent.map((m) => [m.to, m.tag]);
}

describe('who is emailed for each event', () => {
  it('booking_requested goes to the driver', async () => {
    expect(
      await mailsFor([
        bookingRequestedOutbox(DRIVER, {
          bookingId: 'b1',
          rideId: 'r1',
          passengerFirstName: 'Ioana',
          departureAt: DEP,
          pickupArea: 'Șelimbăr',
          dropoffArea: 'Centru',
          expiresAt: DEP,
        }),
      ]),
    ).toEqual([[mail(DRIVER), 'booking_requested']]);
  });

  it('booking_confirmed goes to the passenger (approve and auto-accept build the same row)', async () => {
    const payload = {
      bookingId: 'b1',
      driverFirstName: 'Radu',
      departureAt: DEP,
      pickupEtaAt: DEP,
      pickupArea: 'Șelimbăr',
    };
    expect(await mailsFor([bookingConfirmedOutbox(PASS, payload)])).toEqual([
      [mail(PASS), 'booking_confirmed'],
    ]);
  });

  it('booking_auto_confirmed goes to the driver, and the passenger gets booking_confirmed', async () => {
    const out = await mailsFor([
      bookingAutoConfirmedOutbox(DRIVER, {
        bookingId: 'b1',
        rideId: 'r1',
        departureAt: DEP,
        pickupArea: 'A',
        dropoffArea: 'B',
      }),
      bookingConfirmedOutbox(PASS, {
        bookingId: 'b1',
        driverFirstName: 'Radu',
        departureAt: DEP,
        pickupEtaAt: DEP,
        pickupArea: 'A',
      }),
    ]);
    expect(out).toEqual([
      [mail(DRIVER), 'booking_auto_confirmed'],
      [mail(PASS), 'booking_confirmed'],
    ]);
  });

  it('booking_rejected goes to the passenger', async () => {
    expect(
      await mailsFor([
        bookingRejectedOutbox(PASS, { bookingId: 'b1', driverFirstName: 'Radu', departureAt: DEP }),
      ]),
    ).toEqual([[mail(PASS), 'booking_rejected']]);
  });

  it('booking_expired goes to the passenger', async () => {
    expect(
      await mailsFor([
        bookingExpiredOutbox(PASS, { bookingId: 'b1', driverFirstName: null, departureAt: DEP }),
      ]),
    ).toEqual([[mail(PASS), 'booking_expired']]);
  });

  it('ride_cancelled goes to EACH booked passenger, not to the driver', async () => {
    const base = { rideId: 'r1', driverFirstName: 'Radu', departureAt: DEP };
    const out = await mailsFor(
      rideCancelledRows([
        {
          passengerId: PASS,
          payload: { ...base, bookingId: 'b1', pickupArea: 'A', dropoffArea: 'B' },
        },
        {
          passengerId: PASS_2,
          payload: { ...base, bookingId: 'b2', pickupArea: 'C', dropoffArea: 'D' },
        },
      ]),
    );
    expect(out).toEqual([
      [mail(PASS), 'ride_cancelled'],
      [mail(PASS_2), 'ride_cancelled'],
    ]);
    expect(out.some(([to]) => to === mail(DRIVER))).toBe(false);
  });

  it('ride_updated goes to EACH requested or confirmed passenger with their own areas, never to the driver', async () => {
    const rows = rideUpdatedRows(
      {
        id: 'r1',
        driverFirstName: 'Radu',
        previousDepartureAt: new Date(DEP),
        departureAt: new Date('2026-11-17T08:30:00.000Z'),
      },
      [
        { id: 'b1', passengerId: PASS, pickupArea: 'A', dropoffArea: 'B' },
        { id: 'b2', passengerId: PASS_2, pickupArea: 'C', dropoffArea: 'D' },
      ],
    );
    const w = world();
    w.enqueue(rows);
    w.enqueue(rows); // a retry of the same move is the same event
    await w.dispatch();
    // the dispatcher sends concurrently: compare as a set, one mail per passenger despite the retry
    expect(w.sent.map((m) => `${m.to}|${m.tag}`).sort()).toEqual([
      `${mail(PASS)}|ride_updated`,
      `${mail(PASS_2)}|ride_updated`,
    ]);
    expect(w.sent.some((m) => m.to === mail(DRIVER))).toBe(false);
    for (const m of w.sent) expect(m.subject).toBe('Radu changed the time of your ride');
  });

  it('booking_cancelled (a passenger cancels a confirmed booking) goes to the driver', async () => {
    expect(
      await mailsFor([
        bookingCancelledOutbox(DRIVER, {
          bookingId: 'b1',
          rideId: 'r1',
          passengerFirstName: 'Ioana',
          departureAt: DEP,
        }),
      ]),
    ).toEqual([[mail(DRIVER), 'booking_cancelled']]);
  });

  it('rating prompts: one to the passenger, one to the driver', async () => {
    expect(
      await mailsFor([
        ratingPromptOutbox(PASS, { bookingId: 'b1', driverFirstName: 'Radu', departureAt: DEP }),
        ratingPromptDriverOutbox(DRIVER, { rideId: 'r1', passengerCount: 1, departureAt: DEP }),
      ]),
    ).toEqual([
      [mail(PASS), 'rating_prompt'],
      [mail(DRIVER), 'rating_prompt_driver'],
    ]);
  });

  it('no_show_reported goes to the party who did not show', async () => {
    expect(
      await mailsFor([
        noShowReportedOutbox(PASS, {
          bookingId: 'b1',
          rideId: 'r1',
          reporterFirstName: 'Radu',
          reporterRole: 'driver',
          departureAt: DEP,
        }),
      ]),
    ).toEqual([[mail(PASS), 'no_show_reported']]);
  });

  it('report_received goes to each admin', async () => {
    expect(
      await mailsFor([
        reportReceivedOutbox(ADMIN, { reportId: 'rep1', reason: 'harassment' }),
        reportReceivedOutbox('admin-2', { reportId: 'rep1', reason: 'harassment' }),
      ]),
    ).toEqual([
      [mail(ADMIN), 'report_received'],
      [mail('admin-2'), 'report_received'],
    ]);
  });

  it('data requests: staff mail to the support address, the acknowledgement to the user', async () => {
    expect(
      await mailsFor([
        dataExportRequestedOutbox(PASS, { requestId: 'q1', userId: PASS, requestedAt: DEP }),
        dataExportAckOutbox(PASS, { requestId: 'q1', dueBy: DEP }),
      ]),
    ).toEqual([
      [SUPPORT, 'data_export_requested'],
      [mail(PASS), 'data_export_ack'],
    ]);
  });

  it('account_suspended and account_reinstated go to the user', async () => {
    expect(
      await mailsFor([
        accountSuspendedOutbox(PASS, { reasonCode: 'other', statement: 'A statement of reasons.' }),
        accountReinstatedOutbox(PASS),
      ]),
    ).toEqual([
      [mail(PASS), 'account_suspended'],
      [mail(PASS), 'account_reinstated'],
    ]);
  });

  it('ride_alert_match goes to the alert owner', async () => {
    expect(
      await mailsFor([
        rideAlertMatchRow(PASS, {
          alertId: 'al1',
          rideId: 'r1',
          departureAt: DEP,
          pickupArea: 'A',
          dropoffArea: 'B',
          moreCount: 0,
        }),
      ]),
    ).toEqual([[mail(PASS), 'ride_alert_match']]);
  });
});

describe('idempotency and failures', () => {
  const confirmed = bookingConfirmedOutbox(PASS, {
    bookingId: 'b1',
    driverFirstName: 'Radu',
    departureAt: DEP,
    pickupEtaAt: DEP,
    pickupArea: 'A',
  });

  it('the same event enqueued twice is one row and one mail', async () => {
    const w = world();
    w.enqueue([confirmed]);
    w.enqueue([confirmed]);
    expect(w.rows).toHaveLength(1);
    await w.dispatch();
    await w.dispatch();
    expect(w.sent).toHaveLength(1);
    expect(w.messageIds.get('o1')).toBe('msg-1');
  });

  it('two different bookings of one passenger are two rows', () => {
    const w = world();
    w.enqueue([confirmed, bookingConfirmedOutbox(PASS, { ...confirmed.payload, bookingId: 'b2' })]);
    expect(w.rows).toHaveLength(2);
  });

  it('a suspension can legitimately repeat: no dedupe key', () => {
    const w = world();
    const row = accountSuspendedOutbox(PASS, {
      reasonCode: 'other',
      statement: 'A statement of reasons.',
    });
    w.enqueue([row, row]);
    expect(w.rows).toHaveLength(2);
  });

  it('a recipient miss fails the row and sends nothing', async () => {
    const w = world();
    w.enqueue([bookingConfirmedOutbox('ghost', confirmed.payload)]);
    const out = await w.dispatch();
    expect(out).toEqual({ sent: 0, failed: 1, retried: 0 });
    expect(w.sent).toHaveLength(0);
  });
});
