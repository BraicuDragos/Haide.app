import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/auth-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { setTokenProvider } from '@/api/client';
import { clearPending } from '@/features/bookings/pendingRequest';
import { clearAllShares } from '@/features/safety/shareStore';
import { authClient, authConfigured, callbackUrl } from './client';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthApi {
  status: AuthStatus;
  session: Session | null;
  signInWithGoogle: () => Promise<void>;
  sendMagicLink: (email: string) => Promise<void>;
  exchangeCode: (code: string) => Promise<void>;
  /** Clears the session and the whole query cache. Callers then replace history (see useSignOut). */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

function needConfigured() {
  if (!authConfigured)
    throw new Error('Sign-in is not configured (VITE_SUPABASE_PUBLISHABLE_KEY).');
}

// React StrictMode runs effects twice and a PKCE code is single-use: share one exchange per code.
const exchanges = new Map<string, Promise<void>>();

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<{ status: AuthStatus; session: Session | null }>({
    status: 'loading',
    session: null,
  });

  useEffect(() => {
    setTokenProvider(async () => {
      const { data } = await authClient.getSession();
      return data.session?.access_token ?? null;
    });
    const apply = (session: Session | null) =>
      setState({ status: session ? 'signedIn' : 'signedOut', session });

    // Do not await Supabase calls inside this callback (auth-js holds a lock while it runs).
    const { data } = authClient.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // also fires for a sign-out in another tab. A queued seat request belongs to the person who made it.
        qc.clear();
        clearPending();
        clearAllShares();
      }
      apply(session);
    });
    void authClient.getSession().then(({ data: d }) => apply(d.session));

    // Back/forward cache can restore a protected screen after sign-out: re-check on restore.
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      void authClient.getSession().then(({ data: d }) => {
        if (!d.session) qc.clear();
        apply(d.session);
      });
    };
    window.addEventListener('pageshow', onShow);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener('pageshow', onShow);
    };
  }, [qc]);

  const signInWithGoogle = useCallback(async () => {
    needConfigured();
    const { error } = await authClient.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl() },
    });
    if (error) throw error;
  }, []);

  const sendMagicLink = useCallback(async (email: string) => {
    needConfigured();
    const { error } = await authClient.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl(), shouldCreateUser: true },
    });
    if (error) throw error;
  }, []);

  const exchangeCode = useCallback((code: string) => {
    let p = exchanges.get(code);
    if (!p) {
      p = authClient.exchangeCodeForSession(code).then(({ error }) => {
        if (error) throw error;
      });
      exchanges.set(code, p);
    }
    return p;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authClient.signOut();
    } catch {
      /* the local session is dropped even when the network call fails */
    }
    qc.clear();
    clearPending();
    clearAllShares();
    setState({ status: 'signedOut', session: null });
  }, [qc]);

  const value = useMemo<AuthApi>(
    () => ({ ...state, signInWithGoogle, sendMagicLink, exchangeCode, signOut }),
    [state, signInWithGoogle, sendMagicLink, exchangeCode, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
