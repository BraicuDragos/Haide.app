import type { Env } from '../../_shared/env.ts';
import { AppError } from '../../_shared/errors.ts';
import type { AvatarStorage } from '../types.ts';

const STORAGE_TIMEOUT_MS = 8_000;

/** Object paths are `avatars/<uuid>.jpg` (bucket `avatars`, random name). Nothing else is accepted. */
const AVATAR_PATH_RE = /^avatars\/[0-9a-f-]{36}\.jpg$/;

/** Public URL of a stored avatar (the bucket is public-read). */
export function avatarUrl(env: Env, path: string | null): string | null {
  if (!path) return null;
  const base =
    env.AVATAR_PUBLIC_BASE_URL ??
    (env.SUPABASE_URL
      ? `${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public`
      : 'http://127.0.0.1:54321/storage/v1/object/public');
  return `${base.replace(/\/+$/, '')}/${path}`;
}

/**
 * Supabase Storage REST API with the secret (service role) key. Writes happen only here: there
 * are no storage policies for anon/authenticated (data-model 5.1).
 */
export function createAvatarStorage(env: Env): AvatarStorage {
  const base = env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = (extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${key}`,
    apikey: key ?? '',
    ...extra,
  });

  return {
    async upload(path, jpeg) {
      if (!AVATAR_PATH_RE.test(path)) throw new Error('invalid avatar path');
      if (!base || !key) throw new AppError('UPSTREAM_ERROR', 'Storage is not configured.');
      const res = await fetch(`${base}/storage/v1/object/${path}`, {
        method: 'POST',
        headers: headers({ 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000' }),
        body: jpeg as BodyInit,
        signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
      });
      if (!res.ok) throw new AppError('UPSTREAM_ERROR', 'Could not store the photo.');
    },
    async remove(path) {
      if (!base || !key || !AVATAR_PATH_RE.test(path)) return;
      try {
        await fetch(`${base}/storage/v1/object/${path}`, {
          method: 'DELETE',
          headers: headers(),
          signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
        });
      } catch {
        // an orphaned object is harmless (random name, public avatar): never fail the request
      }
    },
  };
}
