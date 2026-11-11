import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import PublicHighscore from './PublicHighscore';
import PublicAds from './PublicAds';
import useScreenAssignment, { SCREEN_CONTENT_LABELS, SCREEN_KEY } from '../hooks/useScreenAssignment';

/** Große Nummer über dem Bild, damit man sieht, welcher Monitor welche Nummer hat. */
export function ScreenNumberOverlay({ no, content }) {
  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: 2000, bgcolor: 'rgba(0,0,0,0.88)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2vh', pointerEvents: 'none' }}>
      <Typography sx={{ fontFamily: '"Bebas Neue", Impact, sans-serif', fontSize: '46vh', lineHeight: 0.85, color: '#00e676' }}>{no}</Typography>
      <Typography sx={{ fontSize: '4.5vh', fontWeight: 700 }}>Bildschirm {no} · {SCREEN_CONTENT_LABELS[content] || 'nichts zugeordnet'}</Typography>
    </Box>
  );
}

/**
 * /screen/<Nummer>: feste Adresse je Monitor. Was hier läuft (Clubscore, Werbung oder Verkauf), wird in der App
 * unter Werbung → „Bildschirme“ eingestellt und wechselt live. So bleibt der Start am PC immer gleich,
 * auch wenn Monitore oder Kabel getauscht werden.
 */
export default function Screen() {
  const { no } = useParams();
  const n = Number(no);
  const { screens, identify } = useScreenAssignment(true);
  const [showNo, setShowNo] = useState(false);
  const content = screens ? (screens[n] || 'none') : null;

  useEffect(() => {
    if (!identify) return undefined;
    setShowNo(true);
    const t = setTimeout(() => setShowNo(false), 8000);
    return () => clearTimeout(t);
  }, [identify]);

  // Verkauf braucht die Anmeldung und das normale Menü: dorthin wechseln und merken, welcher Bildschirm das ist.
  // App.js (ScreenWatcher) holt das Fenster zurück, sobald diesem Bildschirm etwas anderes zugeordnet wird.
  useEffect(() => {
    if (content !== 'sales') return;
    try { sessionStorage.setItem(SCREEN_KEY, String(n)); } catch { /* egal */ }
    window.location.replace('/sales');
  }, [content, n]);

  const overlay = showNo ? <ScreenNumberOverlay no={n} content={content} /> : null;

  if (content === 'highscore') return <>{overlay}<PublicHighscore /></>;
  if (content === 'ads') return <>{overlay}<PublicAds /></>;
  return (
    <Box sx={{ position: 'fixed', inset: 0, bgcolor: '#000', color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', p: 4 }}>
      {overlay}
      <Typography sx={{ fontSize: '3vh' }}>
        {content === null ? 'Bildschirm wird eingerichtet …'
          : content === 'sales' ? 'Verkauf wird geöffnet …'
            : `Bildschirm ${Number.isFinite(n) ? n : '?'} – noch nichts zugeordnet (in der Kasse: Clubscore oder Werbung → Bildschirme)`}
      </Typography>
    </Box>
  );
}
