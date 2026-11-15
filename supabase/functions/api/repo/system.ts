import type { Db } from '../../_shared/db.ts';

export async function pingDb(sql: Db): Promise<boolean> {
  const rows = await sql<{ ok: number }[]>`select 1 as ok`;
  return rows[0]?.ok === 1;
}

/** False when the caller is over the limit (app.rate_limit_hit increments atomically). */
export async function rateLimitHit(
  sql: Db,
  key: string,
  windowS: number,
  max: number,
): Promise<boolean> {
  const rows = await sql<{ allowed: boolean }[]>`
    select app.rate_limit_hit(${key}, ${windowS}::int, ${max}::int) as allowed`;
  return rows[0]?.allowed === true;
}

export type AppErrorRecord = {
  source: 'client' | 'server';
  message: string;
  stack: string | null;
  route: string | null;
  appVersion: string | null;
  userIdHash: string | null;
};

export async function recordAppError(sql: Db, e: AppErrorRecord): Promise<void> {
  await sql`
    insert into app.app_errors (source, message, stack, route, app_version, user_id_hash)
    values (${e.source}, ${e.message}, ${e.stack}, ${e.route}, ${e.appVersion}, ${e.userIdHash})`;
}
