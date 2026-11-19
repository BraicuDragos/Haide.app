import { lazy, Suspense, useSyncExternalStore } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { pushPromptDue, subscribePushPrompt } from './trigger';

const Impl = lazy(() => import('./PushHostImpl'));

/**
 * Mounted once in the shell. It costs a few bytes: the push code (and its API calls) only load when a booking or a
 * publish just happened, or when the browser already granted notifications and the subscription needs its yearly check.
 */
export function PushHost() {
  const { status } = useAuth();
  const due = useSyncExternalStore(subscribePushPrompt, pushPromptDue, () => false);
  const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  if (status !== 'signedIn' || (!due && !granted)) return null;
  return (
    <Suspense fallback={null}>
      <Impl due={due} />
    </Suspense>
  );
}
