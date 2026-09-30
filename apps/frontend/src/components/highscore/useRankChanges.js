import { useEffect, useRef, useState } from 'react';

/**
 * Rangänderungen clientseitig: je Wertung Map customerId → { dir, n, isNew, rankAt, scoreAt }.
 * Vergleich mit dem vorherigen Stand; erster Stand und neuer Zeitraum (startDate) setzen nur die Basis.
 * Anzeige ~2 min (RANK_MARK_MS), Aufleuchten ~2,5 s (FLASH_MS), beides über die Zeitstempel.
 */
export const RANK_MARK_MS = 120000;
export const FLASH_MS = 2500;

const KEYS = [['daily', 'amount'], ['daily', 'count'], ['yearly', 'amount'], ['yearly', 'count']];

export function useRankChanges(data) {
  const prevRef = useRef({});   // key → { startDate, byId: Map(customerId → {rank, score}) }
  const marksRef = useRef({});  // key → Map(customerId → mark)
  const [marks, setMarks] = useState({});

  useEffect(() => {
    const now = Date.now();
    const next = {};
    KEYS.forEach(([p, m]) => {
      const key = `${p}.${m}`;
      const b = data?.[p]?.[m];
      const entries = b?.entries || [];
      const prev = prevRef.current[key];
      const oldMarks = marksRef.current[key] || new Map();
      const map = new Map();
      const samePeriod = prev && prev.startDate === (b?.startDate || null);
      entries.forEach((e) => {
        const id = e.customerId;
        const old = oldMarks.get(id);
        let mark = old && now - Math.max(old.rankAt || 0, old.scoreAt || 0) < RANK_MARK_MS ? { ...old } : null;
        if (samePeriod) {
          const before = prev.byId.get(id);
          if (!before) {
            mark = { ...(mark || {}), isNew: true, dir: 0, n: 0, rankAt: now, scoreAt: now };
          } else {
            if (before.rank !== e.rank) {
              const diff = before.rank - e.rank;
              mark = { ...(mark || {}), isNew: false, dir: Math.sign(diff), n: Math.abs(diff), rankAt: now };
            }
            if (Number(before.score) !== Number(e.score)) {
              mark = { ...(mark || {}), scoreAt: now };
            }
          }
        }
        if (mark) map.set(id, mark);
      });
      next[key] = map;
      prevRef.current[key] = {
        startDate: b?.startDate || null,
        byId: new Map(entries.map((e) => [e.customerId, { rank: e.rank, score: e.score }])),
      };
    });
    marksRef.current = next;
    setMarks(next);
  }, [data]);

  return marks;
}

/** Markierung für eine Zeile auflösen (abgelaufene ignorieren) */
export const markFor = (marks, key, customerId, now = Date.now()) => {
  const m = marks?.[key]?.get?.(customerId);
  if (!m) return null;
  const showRank = m.rankAt && now - m.rankAt < RANK_MARK_MS && (m.isNew || m.n > 0);
  const flash = m.scoreAt && now - m.scoreAt < FLASH_MS ? m.scoreAt : null;
  if (!showRank && !flash) return null;
  return { isNew: showRank && m.isNew, dir: showRank ? m.dir : 0, n: showRank ? m.n : 0, flash };
};

/** Re-Render im Takt, damit abgelaufene Markierungen verschwinden */
export function useNow(intervalMs = 15000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
