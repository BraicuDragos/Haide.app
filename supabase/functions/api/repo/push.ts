import type { Db } from '../../_shared/db.ts';

/** SQL for push subscriptions (E8-4, ADR 0038). The endpoint is unique: a shared device moves to the caller. */

export type NewSubscription = { endpoint: string; p256dh: string; auth: string };

/**
 * Upsert by endpoint (an endpoint registered by another user moves to the caller), then keep only the
 * caller's newest `max` subscriptions.
 */
export async function upsertSubscription(
  sql: Db,
  userId: string,
  s: NewSubscription,
  now: Date,
  max: number,
): Promise<void> {
  await sql`
    insert into app.push_subscriptions (user_id, endpoint, p256dh, auth, created_at, failures)
    values (${userId}::uuid, ${s.endpoint}, ${s.p256dh}, ${s.auth}, ${now}::timestamptz, 0)
    on conflict (endpoint) do update
      set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
          created_at = excluded.created_at, failures = 0, last_success_at = null`;
  await sql`
    delete from app.push_subscriptions
    where user_id = ${userId}::uuid
      and id in (select id from app.push_subscriptions
                  where user_id = ${userId}::uuid
                  order by created_at desc, id desc
                  offset ${max}::integer)`;
}

/** Deletes the caller's subscription for `endpoint`, or all of theirs without one. Idempotent. */
export async function deleteSubscriptions(
  sql: Db,
  userId: string,
  endpoint: string | undefined,
): Promise<void> {
  if (endpoint === undefined) {
    await sql`delete from app.push_subscriptions where user_id = ${userId}::uuid`;
  } else {
    await sql`
      delete from app.push_subscriptions where user_id = ${userId}::uuid and endpoint = ${endpoint}`;
  }
}
