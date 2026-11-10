/**
 * Dezenter Hinweis „Neue Version verfügbar“ mit Knopf zum Neuladen.
 * Die neue Version wird nie von selbst aktiviert (kein Neuladen mitten im Verkauf).
 */
import React, { useEffect, useState } from 'react';
import { Snackbar, Button } from '@mui/material';
import { applyUpdate } from '../../serviceWorkerRegistration';

export const SW_UPDATE_EVENT = 'clubtouch:sw-update';

/** Von index.js aufgerufen, wenn eine neue Version wartet */
export const announceUpdate = (registration) => {
  window.__clubtouchWaitingSw = registration;
  window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT, { detail: registration }));
};

export default function UpdateNotifier() {
  const [registration, setRegistration] = useState(() => window.__clubtouchWaitingSw || null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onUpdate = (e) => { setRegistration(e.detail); setDismissed(false); };
    window.addEventListener(SW_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(SW_UPDATE_EVENT, onUpdate);
  }, []);

  return (
    <Snackbar
      open={Boolean(registration) && !dismissed}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      onClose={(e, reason) => { if (reason !== 'clickaway') setDismissed(true); }}
      message="Neue Version verfügbar"
      action={(
        <>
          <Button color="inherit" size="small" onClick={() => setDismissed(true)}>Später</Button>
          <Button color="secondary" size="small" sx={{ fontWeight: 800 }} onClick={() => applyUpdate(registration)}>Neu laden</Button>
        </>
      )}
    />
  );
}
