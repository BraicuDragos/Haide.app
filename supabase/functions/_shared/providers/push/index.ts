import type { Env } from '../../env.ts';
import type { Logger } from '../../log.ts';
import { createConsolePushProvider } from './console.ts';
import type { PushProvider } from './types.ts';
import { createWebPushProvider } from './webpush.ts';

export type { PushOptions, PushProvider, PushSendResult, PushSubscriptionRef } from './types.ts';

/** Push is enabled when the three VAPID values are set (env.ts requires all or none). */
export const pushEnabled = (env: Pick<Env, 'VAPID_PUBLIC_KEY'>): boolean =>
  env.VAPID_PUBLIC_KEY !== undefined;

/** PUSH_PROVIDER=webpush (default when the keys are set) or console (logs the host only). */
export function createPushProvider(
  env: Pick<Env, 'PUSH_PROVIDER' | 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>,
  log: Logger,
): PushProvider {
  if (
    env.PUSH_PROVIDER === 'webpush' &&
    env.VAPID_PUBLIC_KEY &&
    env.VAPID_PRIVATE_KEY &&
    env.VAPID_SUBJECT
  ) {
    return createWebPushProvider({
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT,
    });
  }
  return createConsolePushProvider(log);
}
