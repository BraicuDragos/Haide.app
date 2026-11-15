/**
 * Return-to-intent (ADR 0010). The gated action the user came from is kept in sessionStorage, so it survives the
 * Google redirect and the magic-link round trip (same tab), and is consumed when onboarding finishes.
 * `returnTo` is always an in-app path: anything else is ignored (no open redirects).
 */
export type IntentKind = 'request' | 'offer' | 'other';
export interface Intent {
  kind: IntentKind;
  /** In-app path, may carry a query (for example `/ride/ab12?request=1` reopens the request sheet). */
  returnTo: string;
}

const KEY = 'haide.intent';
const DEFAULT: Intent = { kind: 'other', returnTo: '/profile' };

export function safePath(p: unknown): p is string {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.includes('\\');
}

export function saveIntent(intent: Intent): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(intent));
  } catch {
    /* storage can be blocked: the flow then falls back to the default destination */
  }
}

export function readIntent(): Intent {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const v = JSON.parse(raw) as Partial<Intent>;
    if (!safePath(v.returnTo)) return DEFAULT;
    const kind: IntentKind = v.kind === 'request' || v.kind === 'offer' ? v.kind : 'other';
    return { kind, returnTo: v.returnTo };
  } catch {
    return DEFAULT;
  }
}

export function clearIntent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
