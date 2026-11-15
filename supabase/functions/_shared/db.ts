import postgres from 'postgres';

/** postgres.js client type (tagged templates only, no string-built SQL). */
export type Db = postgres.Sql;

/**
 * Transaction-mode pooler (port 6543): no prepared statements, one connection per isolate.
 * Create once per isolate (conventions §5).
 */
export function createDb(url: string): Db {
  return postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
}
