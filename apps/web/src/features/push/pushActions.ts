import type { PushSubscriptionJson } from '@/api/liquidity';
import { urlBase64ToUint8Array } from './pushSupport';

/** The slice of the browser and the API the push flow touches, injectable so the flow is tested with stubs. */
export interface PushSubscriptionLike {
  endpoint: string;
  toJSON(): unknown;
  unsubscribe(): Promise<boolean>;
}
export interface PushDeps {
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(applicationServerKey: Uint8Array<ArrayBuffer>): Promise<PushSubscriptionLike>;
  put(body: PushSubscriptionJson): Promise<void>;
  remove(endpoint?: string): Promise<void>;
}

export type EnableResult = 'on' | 'denied';

/** One re-registration per signed-in session; turning on in this session already counts as one. */
const session = { synced: false };
export const resetSessionSync = (): void => {
  session.synced = false;
};

/** Subscription JSON as the server wants it; anything missing a key means the browser gave us something unusable. */
export function toSubscriptionBody(sub: PushSubscriptionLike): PushSubscriptionJson {
  const j = sub.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    expirationTime?: number | null;
  };
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth)
    throw new Error('push subscription incomplete');
  return {
    endpoint: j.endpoint,
    keys: { p256dh: j.keys.p256dh, auth: j.keys.auth },
    expirationTime: j.expirationTime ?? null,
  };
}

/**
 * Turn on: ask for permission (only now, after the pre-prompt), subscribe with userVisibleOnly, tell the server.
 * 'denied' means the person said no in the browser dialog (or it was already blocked): nothing was subscribed.
 */
export async function enablePush(deps: PushDeps, vapidPublicKey: string): Promise<EnableResult> {
  let permission = deps.permission();
  if (permission === 'default') permission = await deps.requestPermission();
  if (permission !== 'granted') return 'denied';
  const existing = await deps.getSubscription();
  const sub = existing ?? (await deps.subscribe(urlBase64ToUint8Array(vapidPublicKey)));
  await deps.put(toSubscriptionBody(sub));
  session.synced = true;
  return 'on';
}

/** Turn off: unsubscribe in the browser, delete on the server. The server call goes first so a failure is visible. */
export async function disablePush(deps: PushDeps): Promise<void> {
  const sub = await deps.getSubscription();
  await deps.remove(sub?.endpoint);
  if (sub) await sub.unsubscribe();
}

/** `pushsubscriptionchange` is handled by the app: once per session, re-register an existing subscription. */
export async function resyncPush(deps: PushDeps): Promise<boolean> {
  if (session.synced || deps.permission() !== 'granted') return false;
  const sub = await deps.getSubscription();
  if (!sub) return false;
  await deps.put(toSubscriptionBody(sub));
  session.synced = true;
  return true;
}
