import { createDb } from '../_shared/db.ts';
import { parseEnv } from '../_shared/env.ts';
import { jsonLogger } from '../_shared/log.ts';
import { systemClock } from '../_shared/providers/clock.ts';
import { createApp } from './app.ts';
import { createTokenVerifier } from './middleware/auth.ts';

// Validate the environment at boot: a misconfigured isolate fails fast with a readable message.
const env = parseEnv(Deno.env.toObject());

const app = createApp({
  env,
  sql: createDb(env.API_DB_URL),
  clock: systemClock,
  log: jsonLogger,
  verifyToken: createTokenVerifier(env),
});

Deno.serve(app.fetch);
