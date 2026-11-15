import { GoTrueClient } from '@supabase/auth-js';

/**
 * Supabase Auth only (no PostgREST/Realtime/Storage: the API is our Edge Function), via the small auth-js package
 * that supabase-js itself wraps. PKCE flow, session in localStorage under a fixed key.
 * Without a publishable key the app still runs signed out (public endpoints) and sign-in reports an error.
 */
const url = (import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321').replace(/\/+$/, '');
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

export const authConfigured = key.length > 0;

export const authClient = new GoTrueClient({
  url: `${url}/auth/v1`,
  headers: { apikey: key || 'not-configured' },
  storageKey: 'haide.auth',
  flowType: 'pkce',
  persistSession: true,
  autoRefreshToken: true,
  // The callback screen exchanges the code explicitly so it can show its own error states.
  detectSessionInUrl: false,
});

export const CALLBACK_PATH = '/auth/callback';
export const callbackUrl = () => `${window.location.origin}${CALLBACK_PATH}`;
