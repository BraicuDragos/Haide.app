import type { Db } from '../../_shared/db.ts';
import type { AnalyticsEvent } from '../../_shared/domain/events.ts';
import { outboxDedupeKey, type OutboxRow } from '../../_shared/domain/outbox.ts';
import { isPushFirstTemplate, isPushTemplate } from '../../_shared/domain/push.ts';
import type { OutboxRecord, OutboxStore } from '../../_shared/notify/dispatch.ts';
import type { PushStore } from '../../_shared/notify/dispatchPush.ts';
import { runRetention } from './privacy.ts';

/**
 * SQL for the outbox, analytics events and the tick job's housekeeping (E4, ADR 0022).
 * jsonb parameters go in as `JSON.stringify(x)::text::jsonb` (see repo/rides.ts).
 */

/**
 * Inserts outbox rows in the caller's transaction (same commit as the state change). One email row
 * per row; a lifecycle template (E4-6 set) also gets a `push` row when the recipient has a
 * subscription (ADR 0038: one row per channel). Push-first templates never come through here.
 */
export async function insertOutboxRows(sql: Db, rows: readonly OutboxRow[]): Promise<void> {
  for (const row of rows) {
    const payload = JSON.stringify(row.payload);
    const key = outboxDedupeKey(row);
    if (isPushTemplate(row.template) && !isPushFirstTemplate(row.template)) {
      // One statement, two channels: the email row, and the push row when a subscription exists.
      // `on conflict do nothing` on the partial unique index: the same event twice gives one row per channel.
      await sql`
        insert into app.outbox (user_id, channel, template, payload, dedupe_key)
        select r.u, c.ch, r.t, r.p, r.k
        from (select ${row.userId}::uuid as u, ${row.template}::text as t,
                     ${payload}::text::jsonb as p, ${key}::text as k) r
        cross join lateral (
          select 'email'::app.notify_channel as ch
          union all
          select 'push'::app.notify_channel
          where exists (select 1 from app.push_subscriptions s where s.user_id = r.u)
        ) c
        on conflict (user_id, channel, dedupe_key) where dedupe_key is not null do nothing`;
    } else {
      await sql`
        insert into app.outbox (user_id, template, payload, dedupe_key)
        values (${row.userId}, ${row.template}, ${payload}::text::jsonb, ${key}::text)
        on conflict (user_id, channel, dedupe_key) where dedupe_key is not null do nothing`;
    }
  }
}

/**
 * Push-first (the alert match, ADR 0036 and 0038): ONE row, `push` when the user has a subscription,
 * else `email`. The dispatcher inserts the email fallback if the push finally fails.
 */
export async function insertPushFirstOutbox(sql: Db, row: OutboxRow): Promise<void> {
  const payload = JSON.stringify(row.payload);
  await sql`
    insert into app.outbox (user_id, channel, template, payload, dedupe_key)
    select ${row.userId}::uuid,
           case when exists (select 1 from app.push_subscriptions s where s.user_id = ${row.userId}::uuid)
                then 'push'::app.notify_channel else 'email'::app.notify_channel end,
           ${row.template}, ${payload}::text::jsonb, ${outboxDedupeKey(row)}::text
    on conflict (user_id, channel, dedupe_key) where dedupe_key is not null do nothing`;
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

    async markSent(id, at, messageId) {
      // Guarded: a row already failed or sent by another run is left alone.
      await sql`
        update app.outbox
           set status = 'sent', sent_at = ${at}, last_error = null,
               provider_message_id = ${messageId ?? null}::text
         where id = ${id} and status = 'pending'`;
    },

    async markFailed(id, error) {
      await sql`update app.outbox set status = 'failed', last_error = ${error} where id = ${id}`;
    },

    async reschedule(id, sendAfter, error) {
      await sql`update app.outbox set send_after = ${sendAfter}, last_error = ${error} where id = ${id}`;
    },
  };
}

/** The dispatcher's push port over postgres (E8-4). */
export function createPushStore(sql: Db): PushStore {
  return {
    async claim(now, leaseUntil, limit): Promise<OutboxRecord[]> {
      const rows = await sql<ClaimedRow[]>`
        update app.outbox set attempts = attempts + 1, send_after = ${leaseUntil}
        where id in (
          select id from app.outbox
          where channel = 'push' and status = 'pending' and send_after <= ${now}
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

    async subscriptions(userIds) {
      const out = new Map<
        string,
        { id: string; endpoint: string; p256dh: string; auth: string; failures: number }[]
      >();
      if (userIds.length === 0) return out;
      const rows = await sql<
        {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          failures: number;
        }[]
      >`
        select s.id, s.user_id, s.endpoint, s.p256dh, s.auth, s.failures
        from app.push_subscriptions s
        join app.profiles p on p.id = s.user_id and p.status = 'active'
        where s.user_id = any (string_to_array(${userIds.join(',')}::text, ',')::uuid[])
        order by s.created_at, s.id`;
      for (const r of rows) {
        out.set(r.user_id, [...(out.get(r.user_id) ?? []), r]);
      }
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
    async recordSuccess(subscriptionId, at) {
      await sql`
        update app.push_subscriptions set last_success_at = ${at}, failures = 0 where id = ${subscriptionId}`;
    },
    async deleteSubscription(subscriptionId) {
      await sql`delete from app.push_subscriptions where id = ${subscriptionId}`;
    },
    async recordPermanentFailure(subscriptionId, max) {
      const rows = await sql<{ failures: number }[]>`
        update app.push_subscriptions set failures = failures + 1
        where id = ${subscriptionId} returning failures`;
      if ((rows[0]?.failures ?? 0) >= max) {
        await sql`delete from app.push_subscriptions where id = ${subscriptionId}`;
      }
    },
    async insertEmailFallback(row) {
      // Email only: going through insertOutboxRows would add a push row again.
      await sql`
        insert into app.outbox (user_id, channel, template, payload, dedupe_key)
        values (${row.userId}::uuid, 'email', ${row.template}, ${JSON.stringify(row.payload)}::text::jsonb,
                ${outboxDedupeKey(row)}::text)
        on conflict (user_id, channel, dedupe_key) where dedupe_key is not null do nothing`;
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
