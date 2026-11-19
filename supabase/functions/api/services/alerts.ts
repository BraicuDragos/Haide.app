import type {
  AlertListResponse,
  CreateAlertRequest,
  RideAlert,
} from '../../_shared/contracts/liquidity.ts';
import { asDb } from '../../_shared/db.ts';
import { groupAlertHits, rideAlertMatchRow, validateAlert } from '../../_shared/domain/alerts.ts';
import { alertCreatedEvent, alertMatchedEvent } from '../../_shared/domain/events.ts';
import { ALERTS_MAX_ACTIVE, ALERT_MATCH_BATCH } from '../../_shared/domain/rules.ts';
import { AppError } from '../../_shared/errors.ts';
import {
  countActiveAlerts,
  deleteAlert as deleteAlertRow,
  findIdenticalAlert,
  insertAlert,
  listActiveAlerts,
  lockProfileForAlerts,
  markAlertNotified,
  matchRideAlerts,
} from '../repo/alerts.ts';
import { insertAnalyticsEvents, insertPushFirstOutbox } from '../repo/outbox.ts';
import { describePoint } from '../repo/rides.ts';
import type { Account, Deps } from '../types.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const alertNotFound = () => new AppError('NOT_FOUND', 'Alert not found.');

// ---- POST /alerts --------------------------------------------------------------------------------------

/** `created` is false for an identical active alert (answered with 200 and nothing written). */
export async function createAlert(
  deps: Deps,
  account: Account,
  body: CreateAlertRequest,
): Promise<{ item: RideAlert; created: boolean }> {
  const { sql, clock } = deps;
  const now = clock.now();
  const valid = validateAlert(body, now);

  return await sql.begin(async (txn) => {
    const tx = asDb(txn);
    // The count below must not race another create by the same user (E6 lock lesson: no key update).
    if (!(await lockProfileForAlerts(tx, account.id))) throw alertNotFound();

    const same = await findIdenticalAlert(tx, account.id, valid, now);
    if (same) return { item: same, created: false };

    if ((await countActiveAlerts(tx, account.id, now)) >= ALERTS_MAX_ACTIVE) {
      throw new AppError('ALERT_LIMIT', 'You have 5 alerts. Delete one to add another.');
    }
    const item = await insertAlert(tx, account.id, valid, now);
    const from = await describePoint(tx, valid.from);
    const to = await describePoint(tx, valid.to);
    await insertAnalyticsEvents(tx, [
      alertCreatedEvent(
        account.id,
        {
          alertId: item.id,
          kind: valid.schedule.kind,
          windowMin: valid.windowMin,
          fromArea: from.area_name,
          toArea: to.area_name,
        },
        now,
      ),
    ]);
    return { item, created: true };
  });
}

// ---- GET /me/alerts, DELETE /alerts/{id} -------------------------------------------------------------------

export async function listMyAlerts(deps: Deps, account: Account): Promise<AlertListResponse> {
  return { items: await listActiveAlerts(deps.sql, account.id, deps.clock.now()) };
}

export async function deleteMyAlert(deps: Deps, account: Account, id: string): Promise<void> {
  if (!UUID_RE.test(id)) throw alertNotFound();
  if (!(await deleteAlertRow(deps.sql, id.toLowerCase(), account.id))) throw alertNotFound();
}

// ---- tick step 4: match alerts (ADR 0036) -------------------------------------------------------------------

/**
 * One transaction: the matcher marks up to 50 new rides checked and returns the NEW (alert, ride)
 * pairs. Per alert the soonest ride is the subject and the rest are counted; one push-first outbox row
 * and one `alert_matched` event per hit. Returns the notifications queued.
 */
export async function matchAlerts(deps: Deps): Promise<number> {
  const { sql, clock } = deps;
  const now = clock.now();
  return (await sql.begin(async (txn) => {
    const tx = asDb(txn);
    const hits = await matchRideAlerts(tx, now, ALERT_MATCH_BATCH);
    const groups = groupAlertHits(hits);
    for (const g of groups) {
      await insertPushFirstOutbox(
        tx,
        rideAlertMatchRow(g.subject.userId, {
          alertId: g.subject.alertId,
          rideId: g.subject.rideId,
          departureAt: g.subject.departureAt.toISOString(),
          pickupArea: g.subject.pickupArea,
          dropoffArea: g.subject.dropoffArea,
          moreCount: g.moreCount,
        }),
      );
      await markAlertNotified(tx, g.subject.alertId, now);
      await insertAnalyticsEvents(
        tx,
        g.all.map((h) =>
          alertMatchedEvent(h.userId, { alertId: h.alertId, rideId: h.rideId }, now),
        ),
      );
    }
    return groups.length;
  })) as number;
}
