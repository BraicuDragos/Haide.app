import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../../_shared/env.ts';
import { AppError } from '../../_shared/errors.ts';
import type { AppBindings, TokenVerifier } from '../types.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Issuer of tokens from the local `supabase start` stack (API port 54321 in config.toml). */
export const LOCAL_JWT_ISSUER = 'http://127.0.0.1:54321/auth/v1';

/**
 * Expected `iss` claim. JWT_ISSUER wins. Otherwise production derives it from SUPABASE_URL
 * (the public project URL) and every other environment uses the local stack default.
 */
export function resolveJwtIssuer(env: Pick<Env, 'APP_ENV' | 'SUPABASE_URL' | 'JWT_ISSUER'>) {
  if (env.JWT_ISSUER) return env.JWT_ISSUER;
  if (env.APP_ENV === 'production' && env.SUPABASE_URL) {
    return `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;
  }
  return LOCAL_JWT_ISSUER;
}

/**
 * Production: asymmetric tokens verified against the project JWKS (cached by jose).
 * Local development: HS256 with LOCAL_JWT_SECRET when set (never in production).
 * Both paths check the audience AND the issuer.
 */
export function createTokenVerifier(env: Env): TokenVerifier {
  const jwks = env.SUPABASE_URL
    ? createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', env.SUPABASE_URL), {
        cooldownDuration: 30_000,
        timeoutDuration: 5_000,
      })
    : null;
  const localSecret =
    env.APP_ENV !== 'production' && env.LOCAL_JWT_SECRET
      ? new TextEncoder().encode(env.LOCAL_JWT_SECRET)
      : null;
  const issuer = resolveJwtIssuer(env);

  return async (token) => {
    const { alg } = decodeProtectedHeader(token);
    const options = { audience: 'authenticated', issuer, requiredClaims: ['exp', 'sub'] };
    let payload: { sub?: string; email?: unknown };
    if (alg === 'HS256') {
      if (!localSecret) throw new Error('HS256 tokens are not accepted');
      payload = (await jwtVerify(token, localSecret, options)).payload;
    } else {
      if (!jwks) throw new Error('No JWKS configured');
      payload = (await jwtVerify(token, jwks, options)).payload;
    }
    const sub = payload.sub;
    if (!sub || !UUID_RE.test(sub)) throw new Error('Token has no valid subject');
    const email = typeof payload.email === 'string' && payload.email ? payload.email : null;
    return { userId: sub.toLowerCase(), email };
  };
}

/**
 * Reads `Authorization: Bearer`. A valid token sets `auth`. A missing or invalid token leaves the
 * request anonymous: public routes keep working, gated routes answer 401 through `requireAuth`.
 */
export const authMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const header = c.req.header('authorization');
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  if (match?.[1]) {
    try {
      c.set('auth', await c.get('deps').verifyToken(match[1]));
    } catch {
      c.set('auth', null);
    }
  }
  await next();
};

/** Gate 1 (api-contract / architecture §8). The other gates live in gates.ts. */
export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!c.get('auth')) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  await next();
};
