import { SignJWT } from 'jose';
import type { Db } from '../_shared/db.ts';
import { fixedClock } from '../_shared/domain/clock.ts';
import { parseEnv, type Env } from '../_shared/env.ts';
import { silentLogger } from '../_shared/log.ts';
import { createFixtureProvider } from '../_shared/providers/routing/fixture.ts';
import { createApp } from './app.ts';
import { LOCAL_JWT_ISSUER, createTokenVerifier } from './middleware/auth.ts';
import type { AvatarEncoder, AvatarStorage, Deps } from './types.ts';

export const TEST_JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-chars';
export const TEST_CRON_SECRET = 'test-cron-secret-0123456789';
export const BASE = 'http://localhost/api/v1';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    APP_ENV: 'test',
    API_DB_URL: 'postgresql://haide_api:pw@127.0.0.1:54322/postgres',
    CRON_SECRET: TEST_CRON_SECRET,
    IP_HASH_SALT_SEED: 'test-salt-seed-0123456789',
    CORS_ORIGINS: 'http://localhost:5173,https://haide.ro',
    LOCAL_JWT_SECRET: TEST_JWT_SECRET,
    APP_VERSION: 'test-sha',
    ...overrides,
  });
}

export type Query = { text: string; values: unknown[] };
export type Handler = (q: Query) => unknown[] | Promise<unknown[]> | undefined;

/**
 * Fake postgres.js client: a tagged template that records every query and answers from
 * the first handler that returns rows. Default answers keep rate limiting permissive.
 */
export function fakeSql(handlers: Handler[] = []) {
  const calls: Query[] = [];
  const fn = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q: Query = { text: strings.join('?').replace(/\s+/g, ' ').trim(), values };
    calls.push(q);
    for (const h of handlers) {
      const out = await h(q);
      if (out) return out;
    }
    if (q.text.includes('app.rate_limit_hit')) return [{ allowed: true }];
    return [];
  };
  // sql.begin(cb): the same recording fake stands in for the transaction handle.
  (fn as unknown as { begin: unknown }).begin = (cb: (tx: unknown) => unknown) => cb(fn);
  return { sql: fn as unknown as Db, calls };
}

/** In-memory avatar storage: records uploads and removals. */
export function fakeStorage() {
  const uploaded: { path: string; bytes: Uint8Array }[] = [];
  const removed: string[] = [];
  const storage: AvatarStorage = {
    upload: (path, bytes) => {
      uploaded.push({ path, bytes });
      return Promise.resolve();
    },
    remove: (path) => {
      removed.push(path);
      return Promise.resolve();
    },
  };
  return { storage, uploaded, removed };
}

/** Pass-through encoder for route tests (the real one has its own test with real images). */
export const passThroughEncoder: AvatarEncoder = (input) => Promise.resolve(input);

export function makeApp(
  handlers: Handler[] = [],
  envOverrides: Record<string, string> = {},
  overrides: Partial<Deps> = {},
) {
  const { sql, calls } = fakeSql(handlers);
  const env = testEnv(envOverrides);
  const store = fakeStorage();
  const deps: Deps = {
    env,
    sql,
    clock: fixedClock('2026-11-16T05:00:00Z'),
    log: silentLogger,
    verifyToken: createTokenVerifier(env),
    storage: store.storage,
    encodeAvatar: passThroughEncoder,
    routing: createFixtureProvider(),
    ...overrides,
  };
  return { app: createApp(deps), calls, deps, uploaded: store.uploaded, removed: store.removed };
}

export async function signToken(
  sub: string,
  opts: { aud?: string; secret?: string; iss?: string; email?: string } = {},
) {
  return new SignJWT(opts.email ? { email: opts.email } : {})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(opts.iss ?? LOCAL_JWT_ISSUER)
    .setAudience(opts.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(opts.secret ?? TEST_JWT_SECRET));
}
