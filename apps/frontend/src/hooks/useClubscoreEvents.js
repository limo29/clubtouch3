import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Clubscore-Meldungen aus dem Payload (events, neueste zuerst):
 * - dedupliziert über id; beim ersten Laden gilt alles als gesehen (kein Overlay für alte Meldungen)
 * - level 'big' → Overlay-Warteschlange, mindestens MIN_GAP_MS zwischen zwei Overlays, „Ziel erreicht“ zuerst
 * - alle Meldungen des laufenden Geschäftstags → Laufband (tickerEvents)
 */
const MIN_GAP_MS = 20000;
const PRIORITY = { GOAL_REACHED: 0, NEW_LEADER_YEAR: 1, NEW_LEADER_DAY: 2, TEAM_LEAD_DAY: 3 };
const prio = (e) => PRIORITY[e.kind] ?? 9;

export function useClubscoreEvents(events, { dayStart, enabled = true } = {}) {
  const seenRef = useRef(new Set());
  const initRef = useRef(false);
  const queueRef = useRef([]);
  const lastShownRef = useRef(0);
  const [queueVersion, setQueueVersion] = useState(0);
  const [overlay, setOverlay] = useState(null);

  useEffect(() => {
    const list = Array.isArray(events) ? events : [];
    // vor dem ersten echten Laden (enabled=false) nichts tun, sonst gälte die leere Startliste als „gesehen“
    if (!enabled) return;
    if (!initRef.current) {
      list.forEach((e) => seenRef.current.add(e.id));
      initRef.current = true;
      return;
    }
    const fresh = list.filter((e) => e && e.id && !seenRef.current.has(e.id));
    if (!fresh.length) return;
    fresh.forEach((e) => seenRef.current.add(e.id));
    const big = fresh.filter((e) => e.level === 'big');
    if (!big.length) return;
    // älteste zuerst, bei gleicher Priorität chronologisch
    queueRef.current = [...queueRef.current, ...big.reverse()]
      .sort((a, b) => prio(a) - prio(b) || new Date(a.at) - new Date(b.at));
    setQueueVersion((v) => v + 1);
  }, [events, enabled]);

  // nächstes Overlay starten, sobald keins läuft und der Mindestabstand eingehalten ist
  useEffect(() => {
    if (overlay || !queueRef.current.length) return undefined;
    const wait = Math.max(0, lastShownRef.current + MIN_GAP_MS - Date.now());
    const t = setTimeout(() => {
      const next = queueRef.current.shift();
      if (next) {
        lastShownRef.current = Date.now();
        setOverlay(next);
      }
    }, wait);
    return () => clearTimeout(t);
  }, [overlay, queueVersion]);

  const dismissOverlay = useCallback(() => {
    setOverlay(null);
    setQueueVersion((v) => v + 1);
  }, []);

  const tickerEvents = useMemo(() => {
    const list = Array.isArray(events) ? events : [];
    const from = dayStart ? new Date(dayStart).getTime() : 0;
    return list.filter((e) => e && e.text && (!from || new Date(e.at).getTime() >= from));
  }, [events, dayStart]);

  return { overlay, dismissOverlay, tickerEvents };
}

export default useClubscoreEvents;
