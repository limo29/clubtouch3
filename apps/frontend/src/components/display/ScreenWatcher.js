import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import useScreenAssignment, { SCREEN_KEY } from '../../hooks/useScreenAssignment';
import { ScreenNumberOverlay } from '../../pages/Screen';

/**
 * Läuft in Fenstern, die als „Bildschirm N“ gestartet wurden und gerade den Verkauf zeigen:
 * blendet auf Wunsch die Nummer ein und wechselt zurück zu /screen/N, sobald diesem Bildschirm
 * in der App etwas anderes zugeordnet wird. In normalen Fenstern (ohne Nummer) passiert nichts.
 */
export default function ScreenWatcher() {
  const location = useLocation();
  let no = null;
  try { no = Number(sessionStorage.getItem(SCREEN_KEY)) || null; } catch { /* egal */ }
  const active = !!no && !location.pathname.startsWith('/screen/');
  const { screens, identify } = useScreenAssignment(active);
  const [showNo, setShowNo] = useState(false);

  useEffect(() => {
    if (!active || !screens) return;
    if ((screens[no] || 'none') !== 'sales') window.location.replace(`/screen/${no}`);
  }, [active, screens, no]);

  useEffect(() => {
    if (!active || !identify) return undefined;
    setShowNo(true);
    const t = setTimeout(() => setShowNo(false), 8000);
    return () => clearTimeout(t);
  }, [active, identify]);

  return active && showNo ? <ScreenNumberOverlay no={no} content="sales" /> : null;
}
