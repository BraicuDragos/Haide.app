import { deletePushSubscription } from '@/api/liquidity';
import { resetSessionSync } from './pushActions';

/**
 * Sign-out (E8-4): drop this device's push subscription on the server first (the token is still valid), then in the
 * browser, so the next person on a shared phone is not sent the previous account's updates. Never blocks sign-out for
 * long and never throws.
 */
export async function forgetThisDevice(timeoutMs = 3000): Promise<void> {
  resetSessionSync();
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!('serviceWorker' in navigator)) return;
  const work = (async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await deletePushSubscription(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  })().catch(() => undefined);
  await Promise.race([work, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}
