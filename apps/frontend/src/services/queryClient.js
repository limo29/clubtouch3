/**
 * Gemeinsamer QueryClient (App.js stellt ihn bereit, OfflineContext greift direkt darauf zu).
 *
 * Für den Thekenbetrieb ohne Netz werden die Daten der Verkaufsseite (Artikel, Kategorien,
 * Kundenliste) in localStorage gespiegelt und beim Start sofort wieder eingesetzt. Ein Neuladen
 * ohne Netz arbeitet so mit dem letzten bekannten Stand; online lädt React Query wie gewohnt nach.
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
    mutations: {
      // Nicht still pausieren, wenn offline: der Fehler soll bei der Seite ankommen
      networkMode: 'always',
    },
  },
});

const PREFIX = 'rq_cache_v1:';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // älter als 30 Tage wird nicht mehr eingesetzt

// Diese Abfragen braucht /sales, um ohne Netz zu arbeiten
export const PERSISTED_QUERY_KEYS = [
  ['articles'],
  ['articles', 'categories'],
  ['customers-sales'],
];

const storageKey = (queryKey) => PREFIX + JSON.stringify(queryKey);
const isPersisted = (queryKey) => {
  const k = JSON.stringify(queryKey);
  return PERSISTED_QUERY_KEYS.some((p) => JSON.stringify(p) === k);
};

// Beim Laden des Moduls (vor dem ersten Rendern) einsetzen
for (const key of PERSISTED_QUERY_KEYS) {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) continue;
    const { data, updatedAt } = JSON.parse(raw);
    if (data === undefined || !updatedAt || Date.now() - updatedAt > MAX_AGE) continue;
    queryClient.setQueryData(key, data, { updatedAt });
  } catch { /* kaputter Eintrag: ignorieren */ }
}

// Änderungen gebündelt zurückschreiben
const pending = new Map();
let flushTimer = null;
const flush = () => {
  flushTimer = null;
  for (const [k, q] of pending) {
    try {
      localStorage.setItem(k, JSON.stringify({ data: q.state.data, updatedAt: q.state.dataUpdatedAt || Date.now() }));
    } catch { /* Speicher voll: dann eben nicht */ }
  }
  pending.clear();
};

queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated' || event.action?.type !== 'success') return;
  const q = event.query;
  if (!isPersisted(q.queryKey) || q.state.data === undefined) return;
  pending.set(storageKey(q.queryKey), q);
  if (!flushTimer) flushTimer = setTimeout(flush, 300);
});

window.addEventListener('pagehide', flush);

export default queryClient;
