import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { getMe } from '@/api/account';
import { keys } from '@/api/keys';
import type { Me } from '@/api/types';
import { t } from '@/i18n';
import { useToast } from '@/ui/Toast';
import { useAuth } from './AuthProvider';
import { clearIntent, readIntent, saveIntent, type Intent } from './intent';
import { destination, nextStep } from './onboarding';

/** The signed-in user's own account (api-contract GET /me). Disabled while signed out. */
export function useMe() {
  const { status } = useAuth();
  return useQuery({
    queryKey: keys.me,
    queryFn: ({ signal }) => getMe(signal),
    enabled: status === 'signedIn',
  });
}

/** Sends a signed-out user to sign in, remembering where they were going (ADR 0010). */
export function useStartAuth() {
  const navigate = useNavigate();
  return useCallback(
    (intent: Intent) => {
      saveIntent(intent);
      void navigate('/auth');
    },
    [navigate],
  );
}

/**
 * Gate for actions that need an account, consent and a complete profile (plus a car for `offer`).
 * Returns a function: call it on the click. `true` means go ahead. `false` means onboarding has started and the user
 * comes back to `intent.returnTo` when it finishes. E2 (publish) and E3/E4 (request seat) call this.
 */
export function useGate() {
  const { status } = useAuth();
  const me = useMe().data;
  const navigate = useNavigate();
  return useCallback(
    (intent: Intent): boolean => {
      saveIntent(intent);
      if (status !== 'signedIn' || !me) {
        void navigate('/auth');
        return false;
      }
      const step = nextStep(me, intent);
      if (!step) {
        clearIntent();
        return true;
      }
      void navigate(destination(me, intent));
      return false;
    },
    [status, me, navigate],
  );
}

/** After a step is done: refresh /me, then go to the next missing step or back to the saved intent. */
export function useAdvance() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useCallback(
    async (known?: Me) => {
      const me: Me =
        known ??
        (await qc.fetchQuery<Me>({ queryKey: keys.me, queryFn: () => getMe(), staleTime: 0 }));
      qc.setQueryData(keys.me, me);
      const intent = readIntent();
      if (!nextStep(me, intent)) clearIntent();
      void navigate(destination(me, intent), { replace: true });
    },
    [qc, navigate],
  );
}

/** Sign out: clears session and query cache, then replaces history so Back never reveals a protected screen. */
export function useSignOut() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  return useCallback(async () => {
    // Leave the protected screen first (replacing it in history), then drop the session: otherwise the screen's own
    // signed-out redirect would win the race and land on sign-in.
    void navigate('/find', { replace: true });
    clearIntent();
    await signOut();
    toast.show(t('me.signOut.toast'));
  }, [signOut, navigate, toast]);
}
