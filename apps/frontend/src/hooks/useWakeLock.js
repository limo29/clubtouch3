import { useEffect } from 'react';

/**
 * Hält den Bildschirm wach, solange die Seite sichtbar ist (öffentliche Anzeigen über der Theke).
 * Nicht jeder Browser kann das; dann passiert einfach nichts und der Energiesparmodus des Geräts gilt.
 */
export default function useWakeLock() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.wakeLock) return undefined;
    let lock = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) l.release().catch(() => {});
        else lock = l;
      } catch { /* abgelehnt (z. B. Akku-Sparmodus) */ }
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      if (lock) lock.release().catch(() => {});
    };
  }, []);
}
