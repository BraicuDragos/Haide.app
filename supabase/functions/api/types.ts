import type { Clock } from '../_shared/domain/clock.ts';
import type { Db } from '../_shared/db.ts';
import type { Env } from '../_shared/env.ts';
import type { Logger } from '../_shared/log.ts';

export type AuthInfo = { userId: string } | null;

/** Verifies a Supabase access token. Throws when invalid. */
export type TokenVerifier = (token: string) => Promise<{ userId: string }>;

/** Everything the app needs from the outside world, injected so tests need no network. */
export type Deps = {
  env: Env;
  sql: Db;
  clock: Clock;
  log: Logger;
  verifyToken: TokenVerifier;
};

export type AppBindings = {
  Variables: {
    deps: Deps;
    reqId: string;
    auth: AuthInfo;
  };
};
