import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../../_shared/env.ts';
import { AppError } from '../../_shared/errors.ts';
import type { AppBindings, TokenVerifier } from '../types.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Production: asymmetric tokens verified against the project JWKS (cached by jose).
 * Local development: HS256 with LOCAL_JWT_SECRET when set (never in production).
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

  return async (token) => {
    const { alg } = decodeProtectedHeader(token);
    const options = { audience: 'authenticated' };
    let sub: string | undefined;
    if (alg === 'HS256') {
      if (!localSecret) throw new Error('HS256 tokens are not accepted');
      sub = (await jwtVerify(token, localSecret, options)).payload.sub;
    } else {
      if (!jwks) throw new Error('No JWKS configured');
      sub = (await jwtVerify(token, jwks, options)).payload.sub;
    }
    if (!sub || !UUID_RE.test(sub)) throw new Error('Token has no valid subject');
    return { userId: sub };
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

/** Gate 1 of 6 (api-contract / architecture §8). More gates arrive with E1. */
export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!c.get('auth')) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  await next();
};
