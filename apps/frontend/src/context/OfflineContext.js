/**
 * Offline-Betrieb der Theke.
 *
 * Verkäufe und Aufladungen, die nicht sofort beim Server ankommen, landen in einer Warteschlange
 * in localStorage (übersteht Neuladen und Abmelden) und werden der Reihe nach nachgereicht.
 * Jeder Eintrag trägt eine `clientId` (Server bucht dieselbe ID nur einmal) und `clientCreatedAt`
 * (Buchungszeit = Zeitpunkt an der Theke, nicht der Synchronisierung).
 *
 * - Netzfehler, 5xx, 408, 429: Eintrag bleibt, neuer Versuch mit Backoff (5 s, 15 s, 60 s, dann alle 60 s)
 *   und sofort bei `online`/Tab-Fokus. Ein echter 500 wird nach 5 Versuchen als fehlgeschlagen abgelegt,
 *   damit ein dauerhaft kaputter Eintrag nicht alle folgenden blockiert.
 * - Sonstige 4xx (fachlicher Fehler): Eintrag wandert in die Liste „fehlgeschlagen“ (ebenfalls persistent)
 *   und blockiert nichts mehr. 401 behandelt der Token-Refresh in services/api.js; der Eintrag bleibt.
 * - Nie zwei Sync-Läufe gleichzeitig, auch nicht über mehrere Tabs (navigator.locks, sonst Lease in localStorage).
 * - Offline gebuchte Kontoverkäufe/Aufladungen schreiben das Guthaben in der Kundenliste der
 *   Verkaufsseite (['customers-sales']) lokal fort, auch nach jedem Neuladen der Liste vom Server.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { onlineManager } from '@tanstack/react-query';
import axios from 'axios';
import api, { getToken, onConnectivity, isNetworkError } from '../services/api';
import { API_ENDPOINTS, API_BASE_URL } from '../config/api';
import { queryClient } from '../services/queryClient';
import { invalidate } from '../utils/invalidate';

const OfflineContext = createContext();

export const useOffline = () => useContext(OfflineContext);

const QUEUE_KEY = 'offline_queue';
const FAILED_KEY = 'offline_failed';
const LOCK_KEY = 'offline_sync_lock';
const CUSTOMERS_KEY = ['customers-sales'];
const BACKOFF_MS = [5000, 15000, 60000];
const MAX_SERVER_ERROR_ATTEMPTS = 5;

/** Eindeutige ID für eine Buchung (Server erkennt Wiederholungen daran) */
export const newClientId = () => {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
};

/** Ergänzt eine Buchung um clientId/clientCreatedAt (vorhandene Werte bleiben) */
export const withClientId = (data) => ({
  ...data,
  clientId: data.clientId || newClientId(),
  clientCreatedAt: data.clientCreatedAt || new Date().toISOString(),
});

const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const readList = (key) => {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(raw)) return [];
    const list = raw.map(normalizeEntry).filter(Boolean);
    // Einträge älterer Versionen einmalig umgeschrieben zurückspeichern (sonst bekämen sie bei jedem Lesen eine neue clientId)
    if (raw.some((e) => !(e && e.kind && e.payload && e.clientId))) writeList(key, list);
    return list;
  } catch {
    return [];
  }
};
const writeList = (key, list) => {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { console.error('Offline-Speicher voll?', e); }
};

/** Buchungsdaten (wie Sales.js sie liefert) → Eintrag der Warteschlange */
function buildEntry(data) {
  const { isTopUp, offlineId, createdAt, ...rest } = data;
  const kind = isTopUp ? 'TOPUP' : 'SALE';
  const { clientId, clientCreatedAt, ...payload } = withClientId({
    ...rest,
    clientCreatedAt: rest.clientCreatedAt || createdAt,
  });
  return { clientId, clientCreatedAt, kind, payload, summary: buildSummary(kind, payload), attempts: 0, lastError: null, nextAttemptAt: 0 };
}

// Einträge aus älteren Versionen (flach, mit offlineId/createdAt) umwandeln
function normalizeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.kind && e.payload && e.clientId) return e;
  return buildEntry(e);
}

function buildSummary(kind, payload) {
  const customers = queryClient.getQueryData(CUSTOMERS_KEY)?.customers || [];
  const c = payload.customerId ? customers.find((x) => x.id === payload.customerId) : null;
  const customerName = c ? (c.nickname || c.name) : (payload.customerId ? `Kunde #${payload.customerId}` : null);
  if (kind === 'TOPUP') {
    return { label: 'Aufladung', customerName, amount: toNum(payload.amount), method: payload.method, items: [] };
  }
  const articles = queryClient.getQueryData(['articles']) || [];
  const items = (payload.items || []).map((i) => {
    const a = articles.find((x) => x.id === i.articleId);
    return { name: a?.name || `Artikel #${i.articleId}`, quantity: toNum(i.quantity), price: a ? toNum(a.price) : null };
  });
  const moneyless = payload.type === 'OWNER_USE' || payload.type === 'EXPIRED';
  const known = items.every((i) => i.price !== null);
  const amount = moneyless ? 0 : (known ? Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100 : null);
  const label = payload.type === 'OWNER_USE' ? 'Auf den Wirt'
    : payload.paymentMethod === 'ACCOUNT' ? 'Kundenkonto'
    : payload.paymentMethod === 'CARD' ? 'Karte' : 'Bar';
  return { label, customerName, amount, items };
}

/** Wirkung eines Eintrags auf das Kundenguthaben (nur Konto-Verkauf und Aufladung) */
const balanceDelta = (entry) => {
  const amount = entry.summary?.amount;
  if (!entry.payload?.customerId || amount == null) return 0;
  if (entry.kind === 'TOPUP') return toNum(amount);
  if (entry.payload.paymentMethod === 'ACCOUNT' && (!entry.payload.type || entry.payload.type === 'SALE')) return -toNum(amount);
  return 0;
};

/** Guthaben in der Kundenliste der Verkaufsseite um die Wirkung der Einträge verschieben */
const applyBalanceDeltas = (entries, sign = 1) => {
  const deltas = new Map();
  for (const e of entries) {
    const d = balanceDelta(e);
    if (d) deltas.set(e.payload.customerId, (deltas.get(e.payload.customerId) || 0) + d * sign);
  }
  if (!deltas.size) return;
  queryClient.setQueryData(CUSTOMERS_KEY, (old) => {
    if (!old?.customers) return old;
    return {
      ...old,
      customers: old.customers.map((c) => (deltas.has(c.id)
        ? { ...c, balance: Math.round((toNum(c.balance) + deltas.get(c.id)) * 100) / 100, lastActivity: sign > 0 ? new Date().toISOString() : c.lastActivity }
        : c)),
    };
  });
};

const endpointFor = (entry) => (entry.kind === 'TOPUP'
  ? `/customers/${entry.payload.customerId}/topup`
  : API_ENDPOINTS.TRANSACTIONS);
const bodyFor = (entry) => ({ ...entry.payload, clientId: entry.clientId, clientCreatedAt: entry.clientCreatedAt });

/** vorübergehend = später nochmal versuchen; sonst fachlicher Fehler */
const isTransient = (err) => {
  if (isNetworkError(err)) return true;
  const s = err?.response?.status;
  return !s || s >= 500 || s === 408 || s === 429;
};

const errorMessage = (err) => {
  const d = err?.response?.data;
  const detail = Array.isArray(d?.errors) && d.errors[0]?.msg ? String(d.errors[0].msg) : null;
  if (d?.error) return detail && detail !== d.error ? `${d.error}: ${detail}` : String(d.error);
  if (detail) return detail;
  if (err?.response?.status) return `Fehler ${err.response.status}`;
  return 'Keine Verbindung zum Server';
};

// Sperre über alle Tabs: navigator.locks, sonst eine Lease in localStorage
const TAB_ID = newClientId();
async function withSyncLock(fn) {
  if (navigator.locks?.request) {
    return navigator.locks.request('clubtouch-offline-sync', { ifAvailable: true }, async (lock) => {
      if (!lock) return false;
      await fn();
      return true;
    });
  }
  const now = Date.now();
  try {
    const cur = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
    if (cur && cur.owner !== TAB_ID && cur.until > now) return false;
    localStorage.setItem(LOCK_KEY, JSON.stringify({ owner: TAB_ID, until: now + 60000 }));
  } catch { /* ohne localStorage keine Sperre */ }
  try {
    await fn();
    return true;
  } finally {
    try { localStorage.removeItem(LOCK_KEY); } catch { /* egal */ }
  }
}

export const OfflineProvider = ({ children }) => {
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [serverReachable, setServerReachable] = useState(true);
  const [queue, setQueue] = useState(() => readList(QUEUE_KEY));
  const [failed, setFailed] = useState(() => readList(FAILED_KEY));
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const isOnline = browserOnline && serverReachable;

  const runningRef = useRef(false);
  const timerRef = useRef(null);
  const syncRef = useRef(() => {});

  const saveQueue = useCallback((list) => { writeList(QUEUE_KEY, list); setQueue(list); }, []);
  const saveFailed = useCallback((list) => { writeList(FAILED_KEY, list); setFailed(list); }, []);

  // Netzstatus des Browsers
  useEffect(() => {
    const handleOnline = () => { setBrowserOnline(true); setServerReachable(true); syncRef.current(true); };
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Erreichbarkeit des Servers aus allen API-Antworten
  useEffect(() => onConnectivity((ok) => setServerReachable(ok)), []);

  // Server nicht erreichbar, Browser meint online: alle 15 s leise nachfragen
  useEffect(() => {
    if (!browserOnline || serverReachable) return undefined;
    const probe = async () => {
      try {
        await axios.get(`${API_BASE_URL}/public/highscore/display`, { timeout: 5000 });
        setServerReachable(true);
      } catch (err) {
        if (err.response && ![502, 503, 504].includes(err.response.status)) setServerReachable(true);
      }
    };
    const t = setInterval(probe, 15000);
    return () => clearInterval(t);
  }, [browserOnline, serverReachable]);

  // React Query: Abfragen pausieren statt scheitern, solange offline (zwischengespeicherte Daten bleiben)
  // (eigene Quelle statt der window-Events von React Query, damit „Server nicht erreichbar“ mitzählt)
  useEffect(() => { onlineManager.setEventListener(() => () => {}); }, []);
  useEffect(() => { onlineManager.setOnline(isOnline); }, [isOnline]);

  // Andere Tabs ändern Warteschlange/Fehlerliste
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === QUEUE_KEY) setQueue(readList(QUEUE_KEY));
      if (e.key === FAILED_KEY) setFailed(readList(FAILED_KEY));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Kundenliste frisch vom Server: noch wartende Buchungen wieder einrechnen
  useEffect(() => queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action?.type !== 'success' || event.action.manual) return;
    if (event.query.queryKey?.[0] !== CUSTOMERS_KEY[0] || event.query.queryKey.length !== 1) return;
    const pending = readList(QUEUE_KEY);
    if (pending.length) setTimeout(() => applyBalanceDeltas(pending), 0);
  }), []);

  const schedule = useCallback((at) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => syncRef.current(false), Math.max(500, at - Date.now()));
  }, []);

  const updateEntry = (clientId, patch) => {
    const list = readList(QUEUE_KEY).map((e) => (e.clientId === clientId ? { ...e, ...patch } : e));
    saveQueue(list);
  };
  const removeEntry = (clientId) => saveQueue(readList(QUEUE_KEY).filter((e) => e.clientId !== clientId));
  const moveToFailed = (entry, message) => {
    removeEntry(entry.clientId);
    saveFailed([...readList(FAILED_KEY).filter((e) => e.clientId !== entry.clientId), { ...entry, lastError: message, failedAt: new Date().toISOString() }]);
  };

  // Ein Sync-Lauf: Einträge der Reihe nach, bis die Liste leer ist oder ein vorübergehender Fehler kommt
  const drain = async (force) => {
    let synced = 0;
    let rejected = 0;
    for (;;) {
      const list = readList(QUEUE_KEY);
      if (!list.length || !getToken()) break;
      const entry = list[0];
      if (!force && entry.nextAttemptAt > Date.now()) { schedule(entry.nextAttemptAt); break; }
      try {
        await api.post(endpointFor(entry), bodyFor(entry)); // 200 mit duplicate: true zählt ebenfalls als erledigt
        removeEntry(entry.clientId);
        synced += 1;
      } catch (err) {
        const status = err?.response?.status;
        if (status === 401) break; // Anmeldung abgelaufen: Eintrag bleibt, nach dem Login geht es weiter
        if (isTransient(err)) {
          const attempts = (entry.attempts || 0) + 1;
          if (status && !isNetworkError(err) && status >= 500 && status !== 503 && attempts >= MAX_SERVER_ERROR_ATTEMPTS) {
            moveToFailed({ ...entry, attempts }, `${errorMessage(err)} (nach ${attempts} Versuchen)`);
            rejected += 1;
            continue;
          }
          const nextAttemptAt = Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
          updateEntry(entry.clientId, { attempts, nextAttemptAt, lastError: errorMessage(err) });
          schedule(nextAttemptAt);
          break;
        }
        moveToFailed(entry, errorMessage(err));
        rejected += 1;
      }
    }
    if (synced || rejected) {
      setLastSyncAt(new Date().toISOString());
      invalidate(queryClient, 'customers', 'stock', 'sales', 'finance');
    }
  };

  const runSync = async (force = false) => {
    if (runningRef.current || !navigator.onLine || !getToken()) return;
    if (!readList(QUEUE_KEY).length) return;
    runningRef.current = true;
    setIsSyncing(true);
    try {
      const got = await withSyncLock(() => drain(force));
      if (!got) schedule(Date.now() + 5000); // anderer Tab synchronisiert gerade
    } catch (e) {
      console.error('Synchronisierung fehlgeschlagen', e);
    } finally {
      runningRef.current = false;
      setIsSyncing(false);
    }
  };
  syncRef.current = runSync;

  // Auslöser: Start, neue Einträge, Tab-Fokus, Herzschlag alle 30 s
  useEffect(() => {
    syncRef.current(false);
    const onVisible = () => { if (document.visibilityState === 'visible') syncRef.current(true); };
    const onFocus = () => syncRef.current(true);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    const beat = setInterval(() => syncRef.current(false), 30000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      clearInterval(beat);
      clearTimeout(timerRef.current);
    };
  }, []);

  /** Buchung in die Warteschlange legen (Kompatibel: flache Daten wie bisher, `isTopUp` für Aufladungen) */
  const addTransaction = useCallback((data) => {
    const entry = buildEntry(data);
    saveQueue([...readList(QUEUE_KEY), entry]);
    applyBalanceDeltas([entry]);
    setTimeout(() => syncRef.current(false), 0);
    return entry;
  }, [saveQueue]);

  /**
   * Buchen mit Rückfallebene: online direkt (mit clientId), offline oder bei Netzfehler/5xx in die
   * Warteschlange (mit derselben clientId, der Server bucht sie also höchstens einmal).
   * Ergebnis: Axios-Antwort mit `queued: false`, oder `{ queued: true, entry, data: null }`.
   * Fachliche Fehler (4xx) werden geworfen.
   */
  const submitBooking = useCallback(async (data) => {
    const prepared = withClientId(data);
    if (!isOnline) return { queued: true, entry: addTransaction(prepared), data: null };
    const { isTopUp, ...body } = prepared;
    const url = isTopUp ? `/customers/${body.customerId}/topup` : API_ENDPOINTS.TRANSACTIONS;
    try {
      const res = await api.post(url, body);
      return Object.assign(res, { queued: false });
    } catch (err) {
      if (err?.response?.status !== 401 && isTransient(err)) {
        return { queued: true, entry: addTransaction(prepared), data: null, error: err };
      }
      throw err;
    }
  }, [isOnline, addTransaction]);

  /** Fehlgeschlagenen Eintrag erneut in die Warteschlange stellen */
  const retryFailed = useCallback((clientId) => {
    const entry = readList(FAILED_KEY).find((e) => e.clientId === clientId);
    if (!entry) return;
    saveFailed(readList(FAILED_KEY).filter((e) => e.clientId !== clientId));
    const again = { ...entry, attempts: 0, nextAttemptAt: 0, lastError: null, failedAt: undefined };
    saveQueue([...readList(QUEUE_KEY), again]);
    applyBalanceDeltas([again]);
    setTimeout(() => syncRef.current(true), 0);
  }, [saveFailed, saveQueue]);

  /** Fehlgeschlagenen Eintrag endgültig verwerfen (er wurde nie gebucht) */
  const discardFailed = useCallback((clientId) => {
    saveFailed(readList(FAILED_KEY).filter((e) => e.clientId !== clientId));
  }, [saveFailed]);

  const syncQueue = useCallback(() => syncRef.current(true), []);

  const value = useMemo(() => ({
    isOnline,
    browserOnline,
    queue,
    failed,
    isSyncing,
    lastSyncAt,
    addTransaction,
    submitBooking,
    syncQueue,
    retryFailed,
    discardFailed,
  }), [isOnline, browserOnline, queue, failed, isSyncing, lastSyncAt, addTransaction, submitBooking, syncQueue, retryFailed, discardFailed]);

  return (
    <OfflineContext.Provider value={value}>
      {children}
    </OfflineContext.Provider>
  );
};
