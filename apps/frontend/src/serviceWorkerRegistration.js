// Registrierung des Service Workers (src/service-worker.js, nur im Produktions-Build).
//
// Update-Verhalten: Eine neue Version wird im Hintergrund geladen und wartet. Die App zeigt dann
// „Neue Version verfügbar – neu laden“ (components/offline/UpdateNotifier.js); erst der Knopf
// aktiviert sie und lädt neu, damit nie mitten im Verkauf neu geladen wird. Die öffentlichen
// Anzeigen (/public/…, /check-balance) laufen tagelang ohne Bedienung und übernehmen Updates selbst.
// Nach Updates wird stündlich gesucht, weil eine Seite, die nie neu navigiert, sonst nie nachfragt.

const UPDATE_CHECK_MS = 60 * 60 * 1000;

export function register(config = {}) {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
  const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
  if (publicUrl.origin !== window.location.origin) return;

  const start = () => {
    const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        const notifyWaiting = () => {
          // Nur melden, wenn bereits eine ältere Version die Seite steuert (sonst ist es die Erstinstallation)
          if (registration.waiting && navigator.serviceWorker.controller) config.onUpdate?.(registration);
        };
        notifyWaiting(); // schon beim Laden eine wartende Version vorhanden
        registration.onupdatefound = () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.onstatechange = () => {
            if (installing.state !== 'installed') return;
            if (navigator.serviceWorker.controller) notifyWaiting();
            else config.onSuccess?.(registration);
          };
        };
        setInterval(() => { if (navigator.onLine) registration.update().catch(() => {}); }, UPDATE_CHECK_MS);
      })
      .catch((error) => {
        console.error('Service Worker konnte nicht registriert werden:', error);
      });
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
}

/** Wartende Version aktivieren und die Seite neu laden, sobald sie übernimmt */
export function applyUpdate(registration) {
  const waiting = registration?.waiting;
  if (!waiting) { window.location.reload(); return; }
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export function unregister() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => registration.unregister())
      .catch((error) => console.error(error.message));
  }
}
