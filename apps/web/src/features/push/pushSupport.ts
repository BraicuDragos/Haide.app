/**
 * What this browser can do about web push (E8-4). Pure functions over a small environment object so every branch is
 * unit-tested with stubs. The service is only "supported" when the browser has all three APIs AND the server has VAPID
 * keys configured (`vapidPublicKey !== null`); otherwise the push UI stays hidden.
 */
export interface PushEnv {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  userAgent: string;
  maxTouchPoints: number;
  /** Installed to the Home Screen (display-mode: standalone, or iOS navigator.standalone). */
  standalone: boolean;
}

export type PushSupport =
  /** Everything needed is there. */
  | 'supported'
  /** iOS Safari in a tab: push only works once Haide is added to the Home Screen. */
  | 'ios-install'
  /** No push in this browser, or the server has push switched off. */
  | 'unsupported';

export function readPushEnv(): PushEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  let standalone = false;
  try {
    standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (nav as unknown as { standalone?: boolean } | undefined)?.standalone === true;
  } catch {
    standalone = false;
  }
  return {
    hasServiceWorker: nav !== undefined && 'serviceWorker' in nav,
    hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
    hasNotification: typeof window !== 'undefined' && 'Notification' in window,
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    standalone,
  };
}

/** iPhone, iPad, and iPadOS (which reports as a Mac with a touch screen). */
export function isIos(env: PushEnv): boolean {
  return (
    /iPad|iPhone|iPod/.test(env.userAgent) ||
    (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1)
  );
}

export function pushSupport(env: PushEnv, vapidPublicKey: string | null | undefined): PushSupport {
  if (!vapidPublicKey) return 'unsupported';
  if (isIos(env) && !env.standalone) return 'ios-install';
  return env.hasServiceWorker && env.hasPushManager && env.hasNotification
    ? 'supported'
    : 'unsupported';
}

/** The VAPID public key arrives as base64url; `subscribe()` wants the raw bytes. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
