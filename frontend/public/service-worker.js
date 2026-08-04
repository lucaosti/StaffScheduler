/**
 * Service worker (F05).
 *
 * Tiny installable-PWA shim. We do not pre-cache or background-sync anything;
 * the only goal is to satisfy browsers that gate "Install app" on the page
 * having a registered service worker that responds to fetch.
 *
 * Strategy: network-first with a cache fallback for the SPA shell.
 *
 * Also handles Web Push (#310): a service worker is the ONLY place a `push`
 * event can be received — the page itself may not even be open when the
 * message arrives, which is the whole reason push exists. `notificationclick`
 * focuses an already-open tab rather than always opening a new one, so
 * clicking a notification doesn't pile up duplicate tabs for someone who
 * already has the app open.
 */

const CACHE_NAME = 'staff-scheduler-v1';
const SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL).catch(() => undefined))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  // Never intercept API calls.
  if (new URL(request.url).pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('/index.html')))
  );
});

self.addEventListener('push', (event) => {
  // The payload is whatever PushService.sendPush() serialized server-side
  // (see backend/src/services/PushService.ts): { title, body?, link? }.
  // A push with no payload at all (rare, some services allow it) still shows
  // a generic notification — a push event with no visible notification is a
  // silent one, which most browsers penalize by revoking permission.
  let data = { title: 'Staff Scheduler' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Non-JSON payload: fall back to the generic title above.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      // No icon/badge: this project ships no app icon assets today (favicon.ico
      // is referenced by manifest.json but does not exist either — a
      // pre-existing gap, not one to paper over with another broken path).
      // Browsers fall back to a sane default without one.
      data: { link: data.link || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data && event.notification.data.link ? event.notification.data.link : '/';

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clientsList.find((c) => 'focus' in c);
      if (existing) {
        existing.postMessage({ type: 'notification-click', link });
        return existing.focus();
      }
      return self.clients.openWindow(link);
    })()
  );
});
