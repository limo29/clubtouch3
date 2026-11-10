/* eslint-disable no-restricted-globals */

// Service Worker von Clubtouch: macht die App-Oberfläche offline verfügbar, damit die Kasse ein
// Neuladen ohne Netz übersteht. Daten (API) werden hier nie zwischengespeichert, die Kasse hält sie
// selbst (services/queryClient.js, context/OfflineContext.js).

import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

clientsClaim();

// Build-Dateien (JS, CSS, Medien aus dem Bundle) und index.html vorhalten; die Liste setzt der Build ein
precacheAndRoute(self.__WB_MANIFEST);

// Pfade, die immer ans Netz gehen (Daten, Echtzeit, hochgeladene Dateien)
const NEVER_CACHE = /^\/(api|socket\.io|uploads)(\/|$)/;

// Navigationen (Neuladen, Lesezeichen, /sales …) bekommen die App-Hülle index.html
const fileExtensionRegexp = new RegExp('/[^/?]+\\.[^/]+$');
registerRoute(
  ({ request, url }) => {
    if (request.mode !== 'navigate') return false;
    if (url.pathname.startsWith('/_')) return false;
    if (NEVER_CACHE.test(url.pathname)) return false;
    if (url.pathname.match(fileExtensionRegexp)) return false;
    return true;
  },
  createHandlerBoundToURL(process.env.PUBLIC_URL + '/index.html')
);

// Artikelbilder: sofort aus dem Cache, im Hintergrund auffrischen (begrenzt)
registerRoute(
  ({ url, request }) => url.origin === self.location.origin
    && request.method === 'GET'
    && url.pathname.startsWith('/uploads/articles/'),
  new StaleWhileRevalidate({
    cacheName: 'article-images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 60 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  })
);

// Statische Dateien aus public/ (Logo, Geldscheine, Manifest, Icons), die nicht im Bundle stecken
registerRoute(
  ({ url, request }) => url.origin === self.location.origin
    && request.method === 'GET'
    && !NEVER_CACHE.test(url.pathname)
    && /\.(png|jpe?g|webp|svg|ico|json|woff2?)$/i.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: 'static-files',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 100, purgeOnQuotaError: true }),
    ],
  })
);

// Neue Version wartet, bis die Seite sie freigibt (Hinweis „Neue Version verfügbar“ bzw. TV-Anzeigen automatisch)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
