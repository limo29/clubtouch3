import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Browser-Vollbild (Fullscreen API auf document.documentElement, damit MUI-Dialoge und Menüs
 * weiter im body sichtbar sind) plus Auto-Hide der Bedienelemente:
 * nach hideMs ohne Maus, Tipp oder Taste ausblenden; hold=true hält sie sichtbar (z. B. offenes Menü).
 * alwaysAutoHide: auch außerhalb des Vollbilds ausblenden (öffentliche Anzeige).
 */
export function useFullscreen({ hideMs = 3000, hold = false, alwaysAutoHide = false } = {}) {
  const supported = typeof document !== 'undefined'
    && typeof document.documentElement.requestFullscreen === 'function';
  const [isFull, setIsFull] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  const [controlsVisible, setControlsVisible] = useState(true);
  const timer = useRef(null);
  const holdRef = useRef(hold);
  holdRef.current = hold;

  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const autoHide = isFull || alwaysAutoHide;

  useEffect(() => {
    if (!autoHide) { setControlsVisible(true); return undefined; }
    const arm = () => {
      setControlsVisible(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (!holdRef.current) setControlsVisible(false); }, hideMs);
    };
    arm();
    window.addEventListener('mousemove', arm);
    window.addEventListener('touchstart', arm, { passive: true });
    window.addEventListener('keydown', arm);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('mousemove', arm);
      window.removeEventListener('touchstart', arm);
      window.removeEventListener('keydown', arm);
    };
  }, [autoHide, hideMs]);

  // hold endet → Timer neu starten, damit die Leiste nicht sofort verschwindet
  useEffect(() => {
    if (hold) { setControlsVisible(true); clearTimeout(timer.current); return; }
    if (!autoHide) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setControlsVisible(false), hideMs);
  }, [hold, autoHide, hideMs]);

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* vom Browser abgelehnt */ }
  }, []);

  return { supported, isFull, toggle, controlsVisible };
}

export default useFullscreen;
