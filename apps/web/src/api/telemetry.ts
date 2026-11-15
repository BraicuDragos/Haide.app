import { apiBaseUrl } from './client';

/**
 * Best-effort client error report to POST /telemetry/error. Never throws, never blocks the UI.
 * Sends a route TEMPLATE (not the raw URL) and no user data. The server scrubs and truncates too.
 */
export function reportError(error: unknown, route: string): void {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    const payload = {
      message: e.message.slice(0, 500),
      stack: (e.stack ?? '').slice(0, 2000),
      route,
      appVersion: import.meta.env.VITE_APP_VERSION ?? 'dev',
    };
    void fetch(`${apiBaseUrl()}/telemetry/error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* swallow: telemetry must never cause an error */
  }
}
