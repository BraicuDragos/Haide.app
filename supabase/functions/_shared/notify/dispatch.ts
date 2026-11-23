import type { Clock } from '../domain/clock.ts';
import {
  isAnyStatusTemplate,
  isOutboxTemplate,
  type OutboxPayloadMap,
  type OutboxTemplate,
} from '../domain/outbox.ts';
import { sha256Hex } from '../hash.ts';
import type { Logger } from '../log.ts';
import type { EmailProvider, SendResult } from '../providers/email/types.ts';
import { scrubText } from '../scrub.ts';
import { renderEmail, type TemplateInput } from './templates.ts';

/**
 * Outbox dispatcher (ADR 0022, e4-bookings-spec §6.2). Pure orchestration: the database and the
 * email provider are ports, the clock is injected, so tests drive time and failures.
 *
 * Per run: stop when the UTC day's cap is reached, claim at most `batch` rows with a lease
 * (`send_after` pushed 5 minutes ahead, so an overlapping run cannot take the same row), look up
 * recipients, send `concurrency` at a time, then mark each row sent, rescheduled or failed.
 */

export const DISPATCH_BATCH = 50;
export const DISPATCH_CONCURRENCY = 4;
export const LEASE_MIN = 5;
export const MAX_ATTEMPTS = 5;
/** Retry delay in minutes after attempt 1, 2, 3, 4. Attempt 5 that fails is final. */
export const BACKOFF_MIN = [1, 2, 4, 8] as const;
export const LAST_ERROR_MAX = 300;

const MIN_MS = 60_000;

export type OutboxRecord = {
  id: string;
  userId: string;
  template: string;
  payload: unknown;
  /** Already incremented by the claim. */
  attempts: number;
};

/** Storage port, implemented over postgres in api/repo/outbox.ts. */
export interface OutboxStore {
  /** Emails sent since `since` (UTC midnight): the daily cap counter. */
  countSentSince(since: Date): Promise<number>;
  /** Claims up to `limit` due pending rows: attempts + 1, send_after = leaseUntil, FOR UPDATE SKIP LOCKED. */
  claim(now: Date, leaseUntil: Date, limit: number): Promise<OutboxRecord[]>;
  /**
   * user id to email address. Active users only, or active and suspended ones when
   * `includeSuspended` is true (ANY_STATUS_TEMPLATES only). Deleted users never. Missing ids have no recipient.
   */
  recipients(userIds: readonly string[], includeSuspended?: boolean): Promise<Map<string, string>>;
  /** Guarded by `status = 'pending'`. `messageId` is the provider's id, for tracing in its logs. */
  markSent(id: string, at: Date, messageId?: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  reschedule(id: string, sendAfter: Date, error: string): Promise<void>;
}

export type DispatchDeps = {
  store: OutboxStore;
  provider: EmailProvider;
  clock: Clock;
  log: Logger;
  /** EMAIL_DAILY_CAP (default 280, the Brevo free tier is 300). */
  dailyCap: number;
  baseUrl: string;
  /** EMAIL_SUPPORT_TO: the recipient of staff-facing templates (E6 data requests). */
  supportTo?: string;
  batch?: number;
  concurrency?: number;
};

export type DispatchResult = {
  sent: number;
  /** Rows that reached the final `failed` state in this run. */
  failed: number;
  /** Rows put back with a backoff. */
  retried: number;
};

export function utcMidnight(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

export function backoffAfter(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const minutes = BACKOFF_MIN[Math.max(0, attempts - 1)] ?? BACKOFF_MIN[BACKOFF_MIN.length - 1];
  return new Date(now.getTime() + (minutes ?? 8) * MIN_MS);
}

const clean = (e: string): string => scrubText(e, LAST_ERROR_MAX);
const describe = (e: unknown): string =>
  e instanceof Error ? clean(`${e.name}: ${e.message}`) : 'unknown';

export async function dispatchOutbox(deps: DispatchDeps): Promise<DispatchResult> {
  const { store, provider, clock, log } = deps;
  const result: DispatchResult = { sent: 0, failed: 0, retried: 0 };
  const now = clock.now();

  const sentToday = await store.countSentSince(utcMidnight(now));
  const remaining = deps.dailyCap - sentToday;
  if (remaining <= 0) {
    log('warn', 'outbox_daily_cap_reached', { sentToday, cap: deps.dailyCap });
    return result;
  }

  const limit = Math.min(deps.batch ?? DISPATCH_BATCH, remaining);
  const leaseUntil = new Date(now.getTime() + LEASE_MIN * MIN_MS);
  const rows = await store.claim(now, leaseUntil, limit);
  if (rows.length === 0) return result;

  // Two lookups: most mail goes to active users only; a suspension notice and the data request
  // acknowledgement also reach a suspended one (E7). The second call is skipped when unused.
  const anyStatusIds = [
    ...new Set(rows.filter((r) => isAnyStatusTemplate(r.template)).map((r) => r.userId)),
  ];
  const activeIds = [
    ...new Set(rows.filter((r) => !isAnyStatusTemplate(r.template)).map((r) => r.userId)),
  ];
  const activeEmails = activeIds.length > 0 ? await store.recipients(activeIds) : new Map();
  const anyEmails =
    anyStatusIds.length > 0 ? await store.recipients(anyStatusIds, true) : new Map();

  const handle = async (row: OutboxRecord): Promise<void> => {
    if (!isOutboxTemplate(row.template)) {
      await store.markFailed(row.id, 'unknown_template');
      result.failed++;
      return;
    }
    // Staff-facing templates go to the support mailbox, not to the user the row is about (E6, ADR 0031).
    const to =
      row.template === 'data_export_requested'
        ? deps.supportTo
        : (isAnyStatusTemplate(row.template) ? anyEmails : activeEmails).get(row.userId);
    if (!to) {
      // The reason says WHY there is no address: staff mail without EMAIL_SUPPORT_TO, or a user who is
      // inactive (suspended or deleted), has no profile or no auth email.
      const reason =
        row.template === 'data_export_requested'
          ? 'no_recipient:support_address_unset'
          : 'no_recipient:inactive_or_no_email';
      await store.markFailed(row.id, reason);
      result.failed++;
      log('warn', 'outbox_failed', {
        template: row.template,
        attempts: row.attempts,
        error: reason,
      });
      return;
    }

    const ref = (await sha256Hex(row.userId)).slice(0, 12);
    const outcome = await attempt(row, row.template, to, ref);

    if (outcome.ok) {
      await store.markSent(row.id, clock.now(), outcome.messageId);
      result.sent++;
      // Never the address: the template, the hashed user ref and the provider's message id.
      log('info', 'outbox_sent', {
        template: row.template,
        ref,
        messageId: outcome.messageId ?? null,
      });
      return;
    }
    const error = clean(outcome.error);
    const retryAt = outcome.permanent ? null : backoffAfter(row.attempts, clock.now());
    if (retryAt) {
      await store.reschedule(row.id, retryAt, error);
      result.retried++;
    } else {
      await store.markFailed(row.id, error);
      result.failed++;
      log('warn', 'outbox_failed', { template: row.template, attempts: row.attempts, error });
    }
  };

  /** Renders and sends one row. Never throws: every failure becomes a classified SendResult. */
  const attempt = async (
    row: OutboxRecord,
    template: OutboxTemplate,
    to: string,
    ref: string,
  ): Promise<SendResult> => {
    let rendered: ReturnType<typeof renderEmail>;
    try {
      rendered = renderEmail(toInput(template, row.payload), {
        baseUrl: deps.baseUrl,
        now: clock.now(),
        // The real support mailbox (EMAIL_SUPPORT_TO), not the placeholder, once it is configured.
        ...(deps.supportTo ? { supportEmail: deps.supportTo } : {}),
      });
    } catch (e) {
      // Rendering is deterministic: retrying cannot help. Keep a scrubbed message, not just the name.
      return { ok: false, permanent: true, error: `render_failed:${describe(e)}` } as SendResult;
    }
    try {
      return await provider.send({
        to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        tag: template,
        ref,
      });
    } catch (e) {
      // A provider that throws is treated as a transient failure.
      return { ok: false, permanent: false, error: `provider_threw:${describe(e)}` } as SendResult;
    }
  };

  const size = deps.concurrency ?? DISPATCH_CONCURRENCY;
  for (let i = 0; i < rows.length; i += size) {
    await Promise.all(rows.slice(i, i + size).map(handle));
  }
  return result;
}

/** The payload comes from jsonb: the templates read it defensively, so a cast is enough here. */
function toInput(template: OutboxTemplate, payload: unknown): TemplateInput {
  return { template, payload: payload as OutboxPayloadMap[typeof template] } as TemplateInput;
}
