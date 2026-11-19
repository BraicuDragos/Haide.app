/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { RangeRequestsPlugin } from 'workbox-range-requests';
import { safeNotificationPath } from './features/push/notificationPath';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

/**
 * Service worker (architecture section 11):
 * - precaches the app shell (JS, CSS, fonts, icons) injected by vite-plugin-pwa;
 * - runtime-caches the lazy map chunk, glyphs, sprites and the PMTiles file (range requests);
 * - NEVER caches API responses: they are cross-origin (Supabase) and no route below matches them.
 */
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA fallback for navigations (index.html is precached).
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/tiles\//, /^\/glyphs\//],
  }),
);

// Hashed build assets that are not precached (the lazy map chunk): immutable, cache first.
registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin &&
    url.pathname.startsWith('/assets/') &&
    (request.destination === 'script' || request.destination === 'style'),
  new CacheFirst({ cacheName: 'haide-assets-v1' }),
);

// Map data: PMTiles is read with HTTP range requests. The range plugin serves ranges from a cached full file; a 206
// response itself is not cacheable, so the full file must be fetched once (TODO(E3): "download map for offline" action).
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/tiles/'),
  new CacheFirst({ cacheName: 'haide-tiles-v1', plugins: [new RangeRequestsPlugin()] }),
);
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/glyphs/') || url.pathname.startsWith('/sprites/')),
  new StaleWhileRevalidate({ cacheName: 'haide-map-static-v1' }),
);

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

/**
 * Web push (E8-4, ADR 0038). The payload is {title, body, path, tag}: area labels and times only, never a name. There
 * is no auth in the service worker and nothing is fetched here: the notification is built from the payload alone.
 * Malformed payloads are ignored. `pushsubscriptionchange` is handled by the app (it re-registers once per session).
 */
const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;

self.addEventListener('push', (event) => {
  let payload: Record<string, unknown> | null = null;
  try {
    const raw = event.data?.json() as unknown;
    payload = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  } catch {
    payload = null;
  }
  const title = str(payload?.title, 80);
  if (!payload || !title) return;
  const body = str(payload.body, 200);
  const tag = str(payload.tag, 80);
  event.waitUntil(
    self.registration.showNotification(title, {
      ...(body ? { body } : {}),
      ...(tag ? { tag } : {}),
      data: { path: safeNotificationPath(payload.path) },
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safeNotificationPath((event.notification.data as { path?: unknown } | null)?.path);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) {
        try {
          await open.focus();
          await open.navigate(target);
          return;
        } catch {
          /* navigate can be refused: fall back to a new window */
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
