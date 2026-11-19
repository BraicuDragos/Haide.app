import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { keys } from '@/api/keys';
import { deletePushSubscription, getPushConfig, putPushSubscription } from '@/api/liquidity';
import { useAuth } from '@/auth/AuthProvider';
import {
  disablePush,
  enablePush,
  type EnableResult,
  type PushDeps,
  type PushSubscriptionLike,
} from './pushActions';
import { pushSupport, readPushEnv, type PushSupport } from './pushSupport';

/** The real browser and API behind PushDeps. */
export function browserPushDeps(): PushDeps {
  const registration = () => navigator.serviceWorker.ready;
  return {
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    getSubscription: async () =>
      (await (await registration()).pushManager.getSubscription()) as PushSubscriptionLike | null,
    subscribe: async (key) =>
      (await (
        await registration()
      ).pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      })) as PushSubscriptionLike,
    put: putPushSubscription,
    remove: deletePushSubscription,
  };
}

export interface UsePush {
  support: PushSupport;
  /** The server-side switch is still being read. */
  loading: boolean;
  permission: NotificationPermission | 'unsupported';
  /** `null` until the browser has been asked. */
  subscribed: boolean | null;
  busy: boolean;
  error: boolean;
  enable: () => Promise<EnableResult | 'error'>;
  disable: () => Promise<boolean>;
}

/**
 * Push state for one screen. Reads `GET /push/config` (public, cached for an hour; `null` key = push is off and the UI
 * stays hidden), the browser permission and the live subscription. `deps` is injectable for tests.
 */
export function usePush(deps?: PushDeps): UsePush {
  const { status } = useAuth();
  const real = useMemo(() => deps ?? browserPushDeps(), [deps]);
  const config = useQuery({
    queryKey: keys.pushConfig,
    queryFn: ({ signal }) => getPushConfig(signal),
    staleTime: 3_600_000,
    enabled: status === 'signedIn',
  });
  const vapid = config.data?.vapidPublicKey ?? null;
  const support = useMemo(() => pushSupport(readPushEnv(), vapid), [vapid]);

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (support !== 'supported') return;
    let live = true;
    real
      .getSubscription()
      .then((s) => live && setSubscribed(s !== null))
      .catch(() => live && setSubscribed(false));
    return () => {
      live = false;
    };
  }, [support, real]);

  const enable = useCallback(async (): Promise<EnableResult | 'error'> => {
    if (!vapid) return 'error';
    setBusy(true);
    setError(false);
    try {
      const r = await enablePush(real, vapid);
      setPermission(real.permission());
      setSubscribed(r === 'on');
      return r;
    } catch {
      setError(true);
      return 'error';
    } finally {
      setBusy(false);
    }
  }, [real, vapid]);

  const disable = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(false);
    try {
      await disablePush(real);
      setSubscribed(false);
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }, [real]);

  return {
    support,
    loading: status === 'signedIn' && config.isPending,
    permission,
    subscribed,
    busy,
    error,
    enable,
    disable,
  };
}
