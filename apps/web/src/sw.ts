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
