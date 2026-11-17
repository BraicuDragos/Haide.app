import type { Env } from '../../_shared/env.ts';
import type { AuthAdmin } from '../types.ts';

const AUTH_TIMEOUT_MS = 8_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Supabase Auth admin API with the secret (service role) key: removes the auth user of a deleted
 * account (E6, ADR 0029). Removing it also revokes its refresh tokens. A 404 means the user is already
 * gone, which is the goal, so it is not an error. Anything else throws and the tick retries later.
 */
export function createAuthAdmin(env: Env): AuthAdmin {
  const base = env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    async deleteUser(userId) {
      if (!UUID_RE.test(userId)) throw new Error('invalid user id');
      if (!base || !key) throw new Error('auth admin is not configured');
      const res = await fetch(`${base}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${key}`, apikey: key },
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      });
      if (!res.ok && res.status !== 404) throw new Error(`auth delete failed: ${res.status}`);
    },
  };
}
