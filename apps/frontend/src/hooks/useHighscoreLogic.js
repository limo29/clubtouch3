import { useState, useCallback, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import api from '../services/api';
import { WS_URL } from '../config/api';

/**
 * Clubscore-Daten für interne und öffentliche Anzeige.
 * Ein Objekt aus GET /public/highscore/all bzw. Socket 'highscore:update' (ersetzt komplett),
 * dazu die Anzeige-Einstellung (GET /public/highscore/display, Socket 'highscore:display').
 * Polling (60 s) nur, solange der Socket getrennt ist; beim Sichtbarwerden des Tabs sofort neu laden.
 */

export const HS_ALL_URL = '/public/highscore/all';
export const HS_DISPLAY_URL = '/public/highscore/display';
export const HS_DISPLAY_PUT_URL = '/highscore/display';
const POLL_MS = 60000;

export const VIEWS = ['amount', 'count', 'teams'];
export const DEFAULT_DISPLAY = {
  view: 'rotate',
  rotateViews: ['amount', 'count', 'teams'],
  rotateSeconds: 15,
  board: 'both',
  ticker: true,
};

const emptyBoard = (type, mode) => ({ type, mode, startDate: null, entries: [] });

export const EMPTY_DATA = {
  daily: { amount: emptyBoard('DAILY', 'AMOUNT'), count: emptyBoard('DAILY', 'COUNT') },
  yearly: { amount: emptyBoard('YEARLY', 'AMOUNT'), count: emptyBoard('YEARLY', 'COUNT') },
  teams: {
    daily: { amount: emptyBoard('DAILY', 'AMOUNT'), count: emptyBoard('DAILY', 'COUNT') },
    yearly: { amount: emptyBoard('YEARLY', 'AMOUNT'), count: emptyBoard('YEARLY', 'COUNT') },
  },
  goals: { movingTargets: false, goals: [], monthReached: 0 },
  events: [],
  stats: { day: { amount: 0, count: 0, customers: 0 }, recordDay: null },
  period: null,
  serverTime: null,
};

const board = (b, type, mode) => ({ ...emptyBoard(type, mode), ...(b || {}), entries: Array.isArray(b?.entries) ? b.entries : [] });

/** Payload tolerant auf die Vertragsform bringen (fehlende Teile = leer). */
export const normalizeClubscore = (raw) => {
  const d = raw || {};
  const pair = (src, type) => ({ amount: board(src?.amount, type, 'AMOUNT'), count: board(src?.count, type, 'COUNT') });
  const g = d.goals && !Array.isArray(d.goals) ? d.goals : {};
  return {
    daily: pair(d.daily, 'DAILY'),
    yearly: pair(d.yearly, 'YEARLY'),
    teams: { daily: pair(d.teams?.daily, 'DAILY'), yearly: pair(d.teams?.yearly, 'YEARLY') },
    goals: {
      movingTargets: !!g.movingTargets,
      goals: Array.isArray(g.goals) ? g.goals : [],
      monthReached: Number(g.monthReached) || 0,
    },
    events: Array.isArray(d.events) ? d.events : [],
    stats: {
      day: { amount: 0, count: 0, customers: 0, ...(d.stats?.day || {}) },
      recordDay: d.stats?.recordDay || null,
    },
    period: d.period || null,
    serverTime: d.serverTime || null,
    reset: !!d.reset,
  };
};

/** Anzeige-Einstellung validieren (unbekannte Werte → Default). */
export const normalizeDisplay = (raw) => {
  const d = raw || {};
  const rotateViews = Array.isArray(d.rotateViews) ? d.rotateViews.filter((v) => VIEWS.includes(v)) : [];
  const secs = Number(d.rotateSeconds);
  return {
    view: ['amount', 'count', 'teams', 'rotate'].includes(d.view) ? d.view : DEFAULT_DISPLAY.view,
    rotateViews: rotateViews.length ? rotateViews : DEFAULT_DISPLAY.rotateViews,
    rotateSeconds: Number.isFinite(secs) ? Math.min(120, Math.max(5, Math.round(secs))) : DEFAULT_DISPLAY.rotateSeconds,
    board: ['both', 'day', 'year'].includes(d.board) ? d.board : DEFAULT_DISPLAY.board,
    ticker: d.ticker === undefined ? DEFAULT_DISPLAY.ticker : !!d.ticker,
  };
};

export const useHighscoreLogic = () => {
  const [data, setData] = useState(EMPTY_DATA);
  const [display, setDisplay] = useState(DEFAULT_DISPLAY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [socketUp, setSocketUp] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [offlineSince, setOfflineSince] = useState(null);
  const socketUpRef = useRef(false);

  const apply = useCallback((raw) => {
    setData(normalizeClubscore(raw));
    setLastUpdated(new Date());
  }, []);

  const fetchAll = useCallback(async () => {
    const [allRes, dispRes] = await Promise.allSettled([api.get(HS_ALL_URL), api.get(HS_DISPLAY_URL)]);
    if (allRes.status === 'fulfilled') {
      apply(allRes.value.data);
      setError(null);
      setOfflineSince(null);
    } else {
      setError(allRes.reason || new Error('Laden fehlgeschlagen'));
      setOfflineSince((prev) => prev || new Date());
    }
    if (dispRes.status === 'fulfilled') setDisplay(normalizeDisplay(dispRes.value.data));
    setLoading(false);
  }, [apply]);

  useEffect(() => {
    fetchAll();
    const token = localStorage.getItem('token');
    const socket = io(WS_URL, token ? { auth: { token } } : {});

    socket.on('connect', () => {
      const wasDown = !socketUpRef.current;
      socketUpRef.current = true;
      setSocketUp(true);
      setOfflineSince(null);
      if (wasDown) fetchAll(); // Verpasstes nachholen
    });
    socket.on('disconnect', () => {
      socketUpRef.current = false;
      setSocketUp(false);
      setOfflineSince((prev) => prev || new Date());
    });
    socket.on('highscore:update', (payload) => {
      if (!payload) return;
      apply(payload);
      setError(null);
    });
    socket.on('highscore:display', (payload) => {
      if (payload) setDisplay(normalizeDisplay(payload));
    });

    const poll = setInterval(() => { if (!socketUpRef.current) fetchAll(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchAll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      socket.disconnect();
    };
  }, [fetchAll, apply]);

  /** Teilaktualisierung nach eigener Aktion (z. B. gespeicherte Ziele), bis das Socket-Update kommt. */
  const patchData = useCallback((patch) => setData((prev) => ({ ...prev, ...patch })), []);

  // live: Socket verbunden. offline: kein Socket und letzter Abruf fehlgeschlagen.
  const status = socketUp ? 'live' : error ? 'offline' : 'polling';

  return {
    data,
    display,
    setDisplay,
    loading,
    error,
    live: socketUp,
    status,
    offlineSince,
    lastUpdated,
    refresh: fetchAll,
    patchData,
  };
};

export default useHighscoreLogic;
