import { describe, expect, it, vi } from 'vitest';
import { safeNotificationPath } from './notificationPath';
import {
  disablePush,
  enablePush,
  resetSessionSync,
  resyncPush,
  toSubscriptionBody,
  type PushDeps,
  type PushSubscriptionLike,
} from './pushActions';
import { isIos, pushSupport, urlBase64ToUint8Array, type PushEnv } from './pushSupport';

const env = (over: Partial<PushEnv> = {}): PushEnv => ({
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130',
  maxTouchPoints: 5,
  standalone: false,
  ...over,
});
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1';

describe('pushSupport', () => {
  it('is supported with the three APIs and a server key', () => {
    expect(pushSupport(env(), 'BKey')).toBe('supported');
  });
  it('is hidden when the server has push off (null or empty key)', () => {
    expect(pushSupport(env(), null)).toBe('unsupported');
    expect(pushSupport(env(), '')).toBe('unsupported');
  });
  it('is hidden when an API is missing', () => {
    expect(pushSupport(env({ hasPushManager: false }), 'BKey')).toBe('unsupported');
    expect(pushSupport(env({ hasNotification: false }), 'BKey')).toBe('unsupported');
    expect(pushSupport(env({ hasServiceWorker: false }), 'BKey')).toBe('unsupported');
  });
  it('asks iOS in a browser tab to add Haide to the Home Screen first', () => {
    expect(pushSupport(env({ userAgent: IPHONE, hasPushManager: false }), 'BKey')).toBe(
      'ios-install',
    );
    expect(pushSupport(env({ userAgent: IPHONE, standalone: true }), 'BKey')).toBe('supported');
  });
  it('treats iPadOS (a touch Mac) as iOS', () => {
    const ipad = env({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      maxTouchPoints: 5,
    });
    expect(isIos(ipad)).toBe(true);
    expect(isIos(env({ userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 0 }))).toBe(false);
  });
  it('decodes the base64url VAPID key', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID_w'))).toEqual([1, 2, 3, 255]);
  });
});

describe('safeNotificationPath', () => {
  it('keeps in-app paths and falls back for anything else', () => {
    expect(safeNotificationPath('/ride/abc?alert=1')).toBe('/ride/abc?alert=1');
    for (const bad of ['//evil.example', 'https://evil.example', '/a\\b', '', undefined, 7])
      expect(safeNotificationPath(bad)).toBe('/rides');
  });
});

function sub(endpoint = 'https://fcm.googleapis.com/x'): PushSubscriptionLike {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' }, expirationTime: null }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}
function deps(over: Partial<PushDeps> = {}): PushDeps {
  return {
    permission: () => 'default',
    requestPermission: vi.fn().mockResolvedValue('granted'),
    getSubscription: vi.fn().mockResolvedValue(null),
    subscribe: vi.fn().mockResolvedValue(sub()),
    put: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('push actions (usePush flow with stubs)', () => {
  it('asks permission, subscribes userVisibleOnly with the key and registers on the server', async () => {
    const d = deps();
    await expect(enablePush(d, 'AQID_w')).resolves.toBe('on');
    expect(d.requestPermission).toHaveBeenCalledOnce();
    expect(d.subscribe).toHaveBeenCalledOnce();
    expect(d.put).toHaveBeenCalledWith({
      endpoint: 'https://fcm.googleapis.com/x',
      keys: { p256dh: 'p', auth: 'a' },
      expirationTime: null,
    });
  });

  it('does nothing more when the person says no in the browser dialog', async () => {
    const d = deps({ requestPermission: vi.fn().mockResolvedValue('denied') });
    await expect(enablePush(d, 'AQID_w')).resolves.toBe('denied');
    expect(d.subscribe).not.toHaveBeenCalled();
    expect(d.put).not.toHaveBeenCalled();
  });

  it('does not ask again once blocked, and reuses an existing subscription', async () => {
    const blocked = deps({ permission: () => 'denied' });
    await expect(enablePush(blocked, 'AQID_w')).resolves.toBe('denied');
    expect(blocked.requestPermission).not.toHaveBeenCalled();

    const have = deps({
      permission: () => 'granted',
      getSubscription: vi.fn().mockResolvedValue(sub()),
    });
    await enablePush(have, 'AQID_w');
    expect(have.subscribe).not.toHaveBeenCalled();
    expect(have.put).toHaveBeenCalledOnce();
  });

  it('turns off: server delete first, then unsubscribe', async () => {
    const s = sub();
    const d = deps({ getSubscription: vi.fn().mockResolvedValue(s) });
    await disablePush(d);
    expect(d.remove).toHaveBeenCalledWith('https://fcm.googleapis.com/x');
    expect(s.unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps the browser subscription when the server delete fails', async () => {
    const s = sub();
    const d = deps({
      getSubscription: vi.fn().mockResolvedValue(s),
      remove: vi.fn().mockRejectedValue(new Error('network')),
    });
    await expect(disablePush(d)).rejects.toThrow();
    expect(s.unsubscribe).not.toHaveBeenCalled();
  });

  it('re-registers an existing subscription only when permission is granted, once per session', async () => {
    resetSessionSync();
    const d = deps({
      permission: () => 'granted',
      getSubscription: vi.fn().mockResolvedValue(sub()),
    });
    await expect(resyncPush(d)).resolves.toBe(true);
    expect(d.put).toHaveBeenCalledOnce();
    await expect(resyncPush(d)).resolves.toBe(false);
    resetSessionSync();
    const none = deps({ permission: () => 'default' });
    await expect(resyncPush(none)).resolves.toBe(false);
  });

  it('rejects a subscription without keys', () => {
    expect(() =>
      toSubscriptionBody({
        endpoint: 'x',
        toJSON: () => ({ endpoint: 'x' }),
        unsubscribe: async () => true,
      }),
    ).toThrow();
  });
});
