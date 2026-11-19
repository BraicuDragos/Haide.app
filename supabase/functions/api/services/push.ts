import type {
  DeletePushSubscriptionBody,
  PushConfigResponse,
  PutPushSubscriptionBody,
} from '../../_shared/contracts/liquidity.ts';
import { checkSubscription } from '../../_shared/domain/push.ts';
import { PUSH_SUBS_MAX_PER_USER } from '../../_shared/domain/rules.ts';
import { asDb } from '../../_shared/db.ts';
import { AppError } from '../../_shared/errors.ts';
import { dispatchPush } from '../../_shared/notify/dispatchPush.ts';
import { pushEnabled } from '../../_shared/providers/push/index.ts';
import { createPushStore } from '../repo/outbox.ts';
import { deleteSubscriptions, upsertSubscription } from '../repo/push.ts';
import type { Account, Deps } from '../types.ts';

/** GET /push/config: `null` means push is disabled (no VAPID keys), the web app hides its UI. */
export function pushConfig(deps: Deps): PushConfigResponse {
  return { vapidPublicKey: pushEnabled(deps.env) ? (deps.env.VAPID_PUBLIC_KEY ?? null) : null };
}

/** PUT /me/push-subscription: validate (host allow-list, key lengths), upsert, keep the newest 5. */
export async function putPushSubscription(
  deps: Deps,
  account: Account,
  body: PutPushSubscriptionBody,
): Promise<void> {
  if (!pushEnabled(deps.env)) {
    throw new AppError('TEMPORARILY_UNAVAILABLE', 'Push notifications are not available.');
  }
  const fields = checkSubscription({ endpoint: body.endpoint, keys: body.keys });
  if (fields) throw new AppError('VALIDATION_FAILED', 'Invalid push subscription.', { fields });
  await deps.sql.begin(async (txn) => {
    await upsertSubscription(
      asDb(txn),
      account.id,
      { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth },
      deps.clock.now(),
      PUSH_SUBS_MAX_PER_USER,
    );
  });
}

/** DELETE /me/push-subscription: idempotent; no endpoint removes all of the caller's. */
export async function deletePushSubscription(
  deps: Deps,
  account: Account,
  body: DeletePushSubscriptionBody,
): Promise<void> {
  await deleteSubscriptions(deps.sql, account.id, body.endpoint);
}

/** Tick step 6: skipped (returns zeros) when push is disabled. */
export async function runPushDispatch(deps: Deps): Promise<{ sent: number; failed: number }> {
  if (!pushEnabled(deps.env)) return { sent: 0, failed: 0 };
  const r = await dispatchPush({
    store: createPushStore(deps.sql),
    provider: deps.push,
    clock: deps.clock,
    log: deps.log,
    baseUrl: deps.env.APP_BASE_URL,
  });
  return { sent: r.sent, failed: r.failed };
}
