import type { Db } from '../../_shared/db.ts';
import type { AnalyticsEvent } from '../../_shared/domain/events.ts';
import type { OutboxRow } from '../../_shared/domain/outbox.ts';
import type { OutboxRecord, OutboxStore } from '../../_shared/notify/dispatch.ts';
import { runRetention } from './privacy.ts';

/**
 * SQL for the outbox, analytics events and the tick job's housekeeping (E4, ADR 0022).
 * jsonb parameters go in as `JSON.stringify(x)::text::jsonb` (see repo/rides.ts).
 */

/** Inserts outbox rows in the caller's transaction (same commit as the state change). */
export async function insertOutboxRows(sql: Db, rows: readonly OutboxRow[]): Promise<void> {
  for (const row of rows) {
    await sql`
      insert into app.outbox (user_id, template, payload)
      values (${row.userId}, ${row.template}, ${JSON.stringify(row.payload)}::text::jsonb)`;
  }
}

/** Analytics rows: ids, counts and booleans only (conventions §6). */
export async function insertAnalyticsEvents(
  sql: Db,
  events: readonly AnalyticsEvent[],
): Promise<void> {
  for (const e of events) {
    await sql`
      insert into app.analytics_events (name, user_id, props, occurred_at)
      values (${e.name}, ${e.userId}::uuid, ${JSON.stringify(e.props)}::text::jsonb, ${e.at}::timestamptz)`;
  }
}

type ClaimedRow = {
  id: string;
  user_id: string;
  template: string;
  payload: unknown;
  attempts: number;
};

/** The dispatcher's storage port over postgres. */
export function createOutboxStore(sql: Db): OutboxStore {
  return {
    async countSentSince(since) {
      const rows = await sql<{ n: number }[]>`
        select count(*)::int as n from app.outbox
        where channel = 'email' and status = 'sent' and sent_at >= ${since}`;
      return rows[0]?.n ?? 0;
    },

    async claim(now, leaseUntil, limit): Promise<OutboxRecord[]> {
      const rows = await sql<ClaimedRow[]>`
        update app.outbox set attempts = attempts + 1, send_after = ${leaseUntil}
        where id in (
          select id from app.outbox
          where channel = 'email' and status = 'pending' and send_after <= ${now}
          order by send_after
          limit ${limit}
          for update skip locked)
        returning id, user_id, template, payload, attempts`;
      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        template: r.template,
        payload: r.payload,
        attempts: r.attempts,
      }));
    },

    async recipients(userIds, includeSuspended) {
      const out = new Map<string, string>();
      if (userIds.length === 0) return out;
      // ANY_STATUS_TEMPLATES (E7) ask for suspended users too: the 2-argument overload.
      const rows = includeSuspended
        ? await sql<{ user_id: string; email: string }[]>`
            select user_id, email from app.outbox_recipients(string_to_array(${userIds.join(',')}::text, ',')::uuid[], true)`
        : await sql<{ user_id: string; email: string }[]>`
            select user_id, email from app.outbox_recipients(string_to_array(${userIds.join(',')}::text, ',')::uuid[])`;
      for (const r of rows) out.set(r.user_id, r.email);
      return out;
    },

    async markSent(id, at) {
      await sql`update app.outbox set status = 'sent', sent_at = ${at}, last_error = null where id = ${id}`;
    },

    async markFailed(id, error) {
      await sql`update app.outbox set status = 'failed', last_error = ${error} where id = ${id}`;
    },

    async reschedule(id, sendAfter, error) {
      await sql`update app.outbox set send_after = ${sendAfter}, last_error = ${error} where id = ${id}`;
    },
  };
}

// ---- tick housekeeping ----------------------------------------------------------------------------------

/** Route previews past their expiry (E2 carry-forward). Returns the number deleted. */
export async function purgeRoutePreviews(sql: Db, now: Date): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    with d as (delete from app.route_previews where expires_at < ${now} returning 1)
    select count(*)::int as n from d`;
  return rows[0]?.n ?? 0;
}

/**
 * Hourly housekeeping (E6, ADR 0030): one call to app.run_retention(), the only path that deletes
 * rate limits, errors, finished outbox rows, analytics, reports, admin actions, consents and the
 * proof tables. It uses the database clock and takes no argument. Returns the rows deleted.
 */
export async function purgeHousekeeping(sql: Db): Promise<number> {
  const counts = await runRetention(sql);
  return Object.values(counts).reduce((a, b) => a + b, 0);
}
