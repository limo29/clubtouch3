import { useEffect, useMemo, useState } from 'react';
import { VIEWS } from '../../hooks/useHighscoreLogic';

/**
 * Aktuelle Ansicht aus der Anzeige-Einstellung: fest (amount|count|teams) oder wechselnd über rotateViews.
 * Liefert { view, rotating, cycle } – cycle ändert sich bei jedem Wechsel (Key für den Fortschrittsbalken).
 */
export function useRotatingView(display) {
  const rotating = display.view === 'rotate';
  const viewsKey = (display.rotateViews || []).filter((x) => VIEWS.includes(x)).join(',');
  const views = useMemo(() => (viewsKey ? viewsKey.split(',') : VIEWS), [viewsKey]);
  const [cycle, setCycle] = useState(0);
  const seconds = Math.max(5, Number(display.rotateSeconds) || 15);

  useEffect(() => {
    if (!rotating || views.length < 2) return undefined;
    const t = setInterval(() => setCycle((c) => c + 1), seconds * 1000);
    return () => clearInterval(t);
  }, [rotating, views.length, seconds]);

  // bei geänderter Einstellung von vorn beginnen
  useEffect(() => { setCycle(0); }, [rotating, viewsKey, seconds]);

  const view = rotating ? views[cycle % views.length] : display.view;
  return { view, rotating: rotating && views.length > 1, cycle, seconds };
}

export default useRotatingView;
