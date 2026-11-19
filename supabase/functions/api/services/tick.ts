import type { TickResponse } from '../../_shared/contracts/system.ts';
import { bookingExpiredEvent, bookingExpiredOutbox } from '../../_shared/domain/bookings.ts';
import { COARSEN_BATCH, PURGE_OVERDUE_DAYS } from '../../_shared/domain/rules.ts';
import { sha256Hex } from '../../_shared/hash.ts';
import { dispatchOutbox } from '../../_shared/notify/dispatch.ts';
import { scrubText } from '../../_shared/scrub.ts';
import { asDb } from '../../_shared/db.ts';
import { expireRequests } from '../repo/bookings.ts';
import {
  createOutboxStore,
  insertAnalyticsEvents,
  insertOutboxRows,
  purgeHousekeeping,
  purgeRoutePreviews,
} from '../repo/outbox.ts';
import { coarsenLocations, selectOverdueDeletions } from '../repo/privacy.ts';
import { purgeShareLinks } from '../repo/shareLinks.ts';
import { recordAppError } from '../repo/system.ts';
import { runAccountPurges } from './accountPurge.ts';
import { matchAlerts } from './alerts.ts';
import { runPushDispatch } from './push.ts';
import { completeFinishedRides, runSafetySweep } from './safety.ts';
import type { Deps } from '../types.ts';

/**
 * POST /internal/tick, run by pg_cron through pg_net every minute (e4-bookings-spec §7, ADR 0022, and
 * e6-privacy-spec §7: steps 6 to 8 are retention and account purges).
 * Each step has its own try/catch: a failure is logged and recorded, and the next step still runs.
 * The clock is injected, so tests drive time.
 */
export async function runTick(deps: Deps): Promise<TickResponse> {
  const { sql, clock, log, env } = deps;
  const result: TickResponse = {
    expired: 0,
    completed: 0,
    swept: 0,
    sent: 0,
    failed: 0,
    purged: 0,
    coarsened: 0,
    accountsPurged: 0,
    alertsMatched: 0,
    pushSent: 0,
    pushFailed: 0,
  };
  const now = clock.now();

  const failStep = async (step: string, e: unknown) => {
    const name = e instanceof Error ? e.name : 'unknown';
    log('error', 'tick_step_failed', { step, name });
    try {
      await recordAppError(sql, {
        source: 'server',
        message: scrubText(`tick ${step}: ${e instanceof Error ? e.message : String(e)}`, 500),
        stack: null,
        route: '/internal/tick',
        appVersion: env.APP_VERSION,
        userIdHash: null,
      });
    } catch {
      // never let error reporting fail the tick
    }
  };

  // 1. Expire unanswered requests and queue the passenger emails, in one transaction.
  try {
    result.expired = (await sql.begin(async (txn) => {
      const tx = asDb(txn);
      const rows = await expireRequests(tx, now);
      if (rows.length === 0) return 0;
      await insertOutboxRows(
        tx,
        rows.map((r) =>
          bookingExpiredOutbox(r.passenger_id, {
            bookingId: r.booking_id,
            driverFirstName: r.driver_first_name,
            departureAt: new Date(r.departure_at).toISOString(),
          }),
        ),
      );
      await insertAnalyticsEvents(
        tx,
        rows.map((r) =>
          bookingExpiredEvent(r.passenger_id, { bookingId: r.booking_id, rideId: r.ride_id }, now),
        ),
      );
      return rows.length;
    })) as number;
  } catch (e) {
    await failStep('expire', e);
  }

  // 2. Complete rides that departed 2 h ago or more and queue the rating prompts (ADR 0024).
  try {
    result.completed = await completeFinishedRides(deps);
  } catch (e) {
    await failStep('complete', e);
  }

  // 3. Safety sweep: cancel what a suspension or a block left behind (ADR 0027, 0028).
  try {
    result.swept = await runSafetySweep(deps);
  } catch (e) {
    await failStep('sweep', e);
  }

  // 4. Match new rides against ride alerts and queue one push-first notification per alert (ADR 0036).
  try {
    result.alertsMatched = await matchAlerts(deps);
  } catch (e) {
    await failStep('match_alerts', e);
  }

  // 5. Dispatch the email outbox (at most 50 rows, 4 at a time, daily cap).
  try {
    const sent = await dispatchOutbox({
      store: createOutboxStore(sql),
      provider: deps.email,
      clock,
      log,
      dailyCap: env.EMAIL_DAILY_CAP,
      baseUrl: env.APP_BASE_URL,
      supportTo: env.EMAIL_SUPPORT_TO,
    });
    result.sent = sent.sent;
    result.failed = sent.failed;
  } catch (e) {
    await failStep('dispatch', e);
  }

  // 6. Dispatch the push rows (batch 50, no daily cap). Skipped when push is disabled (ADR 0038).
  try {
    const pushed = await runPushDispatch(deps);
    result.pushSent = pushed.sent;
    result.pushFailed = pushed.failed;
  } catch (e) {
    await failStep('dispatch_push', e);
  }

  // 7. Route previews and share links past their expiry.
  try {
    result.purged += await purgeRoutePreviews(sql, now);
  } catch (e) {
    await failStep('purge_previews', e);
  }
  try {
    result.purged += await purgeShareLinks(sql, now);
  } catch (e) {
    await failStep('purge_share_links', e);
  }

  // 8. Coarsen exact locations of rides and bookings that departed more than 90 days ago (ADR 0030).
  try {
    const c = await coarsenLocations(sql, now, COARSEN_BATCH);
    result.coarsened = c.rides + c.bookings;
  } catch (e) {
    await failStep('coarsen', e);
  }

  // 9. Finish account deletions: remove the avatar object and the auth user (ADR 0029).
  try {
    result.accountsPurged = await runAccountPurges(deps);
  } catch (e) {
    await failStep('account_purge', e);
  }

  // 10. Hourly housekeeping (minute 0 UTC): the retention purge (E8: also expired alerts and old series), then the overdue-deletion alarm.
  if (now.getUTCMinutes() === 0) {
    try {
      result.purged += await purgeHousekeeping(sql);
    } catch (e) {
      await failStep('housekeeping', e);
    }
    try {
      await alarmOverdueDeletions(deps, now);
    } catch (e) {
      await failStep('purge_overdue_alarm', e);
    }
  }

  return result;
}

const OVERDUE_ALARM_MAX = 20;

/**
 * A deletion still open after 7 days puts the 30-day erasure promise at risk: one app_errors row per
 * such deletion, per hour, with a hash of the id (never the id itself in the message).
 */
async function alarmOverdueDeletions(deps: Deps, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - PURGE_OVERDUE_DAYS * 86_400_000);
  const open = await selectOverdueDeletions(deps.sql, cutoff, OVERDUE_ALARM_MAX);
  for (const row of open) {
    await recordAppError(deps.sql, {
      source: 'server',
      message: 'account_purge_overdue',
      stack: null,
      route: '/internal/tick',
      appVersion: deps.env.APP_VERSION,
      userIdHash: (await sha256Hex(row.user_id)).slice(0, 16),
    });
  }
}
