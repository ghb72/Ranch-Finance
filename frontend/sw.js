/**
 * sw.js - Custom service worker source (vite-plugin-pwa injectManifest mode).
 *
 * Provides the same offline precaching as the previous generated worker, plus
 * background synchronization handlers:
 *   - `periodicsync` (tag 'daily-sync')  → opportunistic ~3x/day refresh
 *   - `sync` (tag 'sync-transactions')   → one-off flush after reconnect
 *
 * Both run `runBackgroundSyncFromIDB()`, which reads the mirrored credentials
 * from IndexedDB (a service worker cannot read localStorage) and delegates to
 * the shared sync core.
 */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';
import { getSyncCredentials } from './db.js';
import { runSync } from './syncCore.js';

self.skipWaiting();
clientsClaim();

// Precache the build manifest injected by vite-plugin-pwa.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA navigation fallback to the precached index.html.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// Long-lived cache for Google Fonts (mirrors the previous runtimeCaching).
registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);
registerRoute(
  /^https:\/\/fonts\.gstatic\.com\/.*/i,
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

/**
 * Run a bidirectional sync using credentials mirrored into IndexedDB.
 * Tolerates Render free-tier cold starts with a single retry.
 */
async function runBackgroundSyncFromIDB() {
  const { token, clientId } = await getSyncCredentials();
  if (!token) {
    // Not authenticated on this device yet; nothing to do.
    return;
  }

  try {
    return await runSync({ token, clientId });
  } catch (err) {
    if (err?.unauthorized) {
      // Token no longer valid; the window context will re-prompt on next open.
      return;
    }
    // Likely a backend cold start or transient network error. Retry once.
    try {
      return await runSync({ token, clientId });
    } catch (retryErr) {
      console.error('Background sync failed:', retryErr);
    }
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'daily-sync') {
    event.waitUntil(runBackgroundSyncFromIDB());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-transactions') {
    event.waitUntil(runBackgroundSyncFromIDB());
  }
});
