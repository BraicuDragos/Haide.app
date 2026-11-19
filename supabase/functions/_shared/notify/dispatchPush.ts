import type { Clock } from '../domain/clock.ts';
import {
  isOutboxTemplate,
  type OutboxPayloadMap,
  type OutboxRow,
  type OutboxTemplate,
} from '../domain/outbox.ts';
import { isPushFirstTemplate, pushTtlS } from '../domain/push.ts';
import { PUSH_BATCH, PUSH_MAX_FAILURES } from '../domain/rules.ts';
import type { Logger } from '../log.ts';
import type { PushProvider, PushSendResult } from '../providers/push/types.ts';
import { scrubText } from '../scrub.ts';
import {
  BACKOFF_MIN,
  LAST_ERROR_MAX,
  LEASE_MIN,
  backoffAfter,
  type OutboxRecord,
} from './dispatch.ts';
import { renderPush } from './push.ts';
import type { TemplateInput } from './templates.ts';

/**
 * Push dispatcher (E8-4, ADR 0038, e8-liquidity-spec §5). Same shape as the email dispatcher:
 * ports for the database and the provider, an injected clock, a lease, backoff. Differences: no
 * daily cap, one row can fan out to several subscriptions (one per device), and a push-first
 * template (the alert match) gets an email fallback row when the push finally fails.
 */

export const PUSH_CONCURRENCY = 4;
export { BACKOFF_MIN };

export type LiveSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failures: number;
};

export interface PushStore {
  /** Claims up to `limit` due pending `push` rows: attempts + 1, send_after = leaseUntil, SKIP LOCKED. */
  claim(now: Date, leaseUntil: Date, limit: number): Promise<OutboxRecord[]>;
  /** Live subscriptions of ACTIVE users only (suspended and deleted ones get nothing). */
  subscriptions(userIds: readonly string[]): Promise<Map<string, LiveSubscription[]>>;
  markSent(id: string, at: Date): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  reschedule(id: string, sendAfter: Date, error: string): Promise<void>;
  /** Delivered: last_success_at = at, failures = 0. */
  recordSuccess(subscriptionId: string, at: Date): Promise<void>;
  /** The push service said 404 or 410. */
  deleteSubscription(subscriptionId: string): Promise<void>;
  /** failures + 1; the store deletes the subscription once it reaches `max`. */
  recordPermanentFailure(subscriptionId: string, max: number): Promise<void>;
  /** The email fallback row of a push-first template, same payload. */
  insertEmailFallback(row: OutboxRow): Promise<void>;
}

export type PushDispatchDeps = {
  store: PushStore;
  provider: PushProvider;
  clock: Clock;
  log: Logger;
  baseUrl: string;
  batch?: number;
  concurrency?: number;
};

export type PushDispatchResult = {
  sent: number;
  /** Rows that ended in `failed` in this run. */
  failed: number;
  retried: number;
  /** Email fallback rows inserted. */
  fallbacks: number;
};

const clean = (e: string): string => scrubText(e, LAST_ERROR_MAX);

export async function dispatchPush(deps: PushDispatchDeps): Promise<PushDispatchResult> {
  const { store, provider, clock, log } = deps;
  const result: PushDispatchResult = { sent: 0, failed: 0, retried: 0, fallbacks: 0 };
  const now = clock.now();
  const leaseUntil = new Date(now.getTime() + LEASE_MIN * 60_000);
  const rows = await store.claim(now, leaseUntil, deps.batch ?? PUSH_BATCH);
  if (rows.length === 0) return result;

  const subs = await store.subscriptions([...new Set(rows.map((r) => r.userId))]);

  const fail = async (row: OutboxRecord, error: string) => {
    await store.markFailed(row.id, clean(error));
    result.failed++;
    if (isOutboxTemplate(row.template) && isPushFirstTemplate(row.template)) {
      await store.insertEmailFallback({
        userId: row.userId,
        template: row.template,
        payload: row.payload as OutboxPayloadMap[OutboxTemplate],
      } as OutboxRow);
      result.fallbacks++;
    }
  };

  const handle = async (row: OutboxRecord): Promise<void> => {
    if (!isOutboxTemplate(row.template)) {
      await store.markFailed(row.id, 'unknown_template');
      result.failed++;
      return;
    }
    const mine = subs.get(row.userId) ?? [];
    if (mine.length === 0) {
      await fail(row, 'no_subscription');
      return;
    }

    let body: Uint8Array;
    try {
      const input = { template: row.template, payload: row.payload } as TemplateInput;
      body = new TextEncoder().encode(
        JSON.stringify(renderPush(input, { baseUrl: deps.baseUrl, now: clock.now() })),
      );
    } catch {
      await fail(row, 'render_failed');
      return;
    }

    const opts = { ttlS: pushTtlS(row.template), urgency: 'normal' as const };
    let delivered = 0;
    let transient = 0;
    let lastError = 'unknown';
    for (const sub of mine) {
      let out: PushSendResult;
      try {
        out = await provider.send(sub, body, opts);
      } catch (e) {
        out = {
          ok: false,
          gone: false,
          permanent: false,
          error: e instanceof Error ? e.name : 'error',
        };
      }
      if (out.ok) {
        delivered++;
        await store.recordSuccess(sub.id, clock.now());
      } else if (out.gone) {
        lastError = out.error;
        await store.deleteSubscription(sub.id);
      } else if (out.permanent) {
        lastError = out.error;
        await store.recordPermanentFailure(sub.id, PUSH_MAX_FAILURES);
      } else {
        lastError = out.error;
        transient++;
      }
    }

    if (delivered > 0) {
      await store.markSent(row.id, clock.now());
      result.sent++;
      return;
    }
    if (transient > 0) {
      const retryAt = backoffAfter(row.attempts, clock.now());
      if (retryAt) {
        await store.reschedule(row.id, retryAt, clean(lastError));
        result.retried++;
        return;
      }
    }
    log('warn', 'push_failed', { template: row.template, attempts: row.attempts });
    await fail(row, lastError);
  };

  const size = deps.concurrency ?? PUSH_CONCURRENCY;
  for (let i = 0; i < rows.length; i += size) {
    await Promise.all(rows.slice(i, i + size).map(handle));
  }
  return result;
}
