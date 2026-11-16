import postgres from 'postgres';

/** postgres.js client type (tagged templates only, no string-built SQL). */
export type Db = postgres.Sql;

/** Inside `sql.begin(async (tx) => ...)`: the transaction handle is used exactly like the client. */
export const asDb = (tx: postgres.TransactionSql): Db => tx as unknown as Db;

/**
 * Transaction-mode pooler (port 6543): no prepared statements, one connection per isolate.
 * Create once per isolate (conventions §5).
 */
export function createDb(url: string): Db {
  return postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
}
