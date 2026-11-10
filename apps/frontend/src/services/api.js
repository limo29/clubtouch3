import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { askClosedPeriod } from './closedPeriodPrompt';

// Bestätigung für Änderungen in abgeschlossenen Geschäftsjahren (Backend: utils/closedPeriod.js)
export const CLOSED_PERIOD_HEADER = 'X-Confirm-Closed-Period';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Token management
// Tokens werden bei jedem Zugriff frisch aus localStorage gelesen: ein zweiter Tab kann sie
// inzwischen erneuert haben, ein im Modul gemerkter Wert wäre dann veraltet.
const readStorage = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};

export const getToken = () => readStorage('token');
export const getRefreshToken = () => readStorage('refreshToken');

export const setTokens = (accessToken, refreshTokenValue) => {
  localStorage.setItem('token', accessToken);
  localStorage.setItem('refreshToken', refreshTokenValue);
};

export const clearTokens = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
};

/**
 * Erreichbarkeit des Servers: jede Antwort meldet „erreichbar“, jede Anfrage ohne Antwort
 * (bzw. 502/503/504 vom Proxy) „nicht erreichbar“. OfflineContext hört darauf, damit ein WLAN
 * ohne Verbindung zum Server genauso als offline gilt wie ein abgeschaltetes Netz.
 */
const connectivityListeners = new Set();
export const onConnectivity = (cb) => {
  connectivityListeners.add(cb);
  return () => connectivityListeners.delete(cb);
};
const reportConnectivity = (reachable) => connectivityListeners.forEach((cb) => { try { cb(reachable); } catch { /* egal */ } });

/** Antwort fehlt oder Proxy meldet, dass das Backend nicht erreichbar ist */
export const isNetworkError = (error) => {
  if (!error || axios.isCancel(error) || error.code === 'ERR_CANCELED') return false;
  if (!error.response) return true;
  return [502, 503, 504].includes(error.response.status);
};

const isAuthCall = (url = '') => /\/auth\/(login|refresh)$/.test(url);

// Request interceptor
api.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token && !config._noAuth) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Single-Flight: alle gleichzeitig mit 401 abgelehnten Anfragen warten auf dieselbe Erneuerung
let refreshPromise = null;

const forceLogout = () => {
  clearTokens();
  try { localStorage.removeItem('auth_user'); } catch { /* egal */ }
  // Öffentliche Bildschirme (Clubscore-TV, Werbung, Guthaben-Abfrage) brauchen keine Anmeldung:
  // ein abgelaufener Rest-Login auf dem Gerät darf sie nicht auf die Login-Seite werfen.
  const p = window.location.pathname;
  if (p.startsWith('/login') || p.startsWith('/public/') || p.startsWith('/check-balance')) return;
  window.location.href = '/login';
};

/**
 * Erneuert die Tokens. Ergebnis: neuer Access-Token (String).
 * Wirft `{ logout: true }`, wenn der Server den Refresh-Token wirklich ablehnt, sonst den
 * Netzfehler (dann bleibt man angemeldet, die Anfrage scheitert nur).
 */
const refreshTokens = () => {
  if (refreshPromise) return refreshPromise;
  const usedRefresh = getRefreshToken();
  refreshPromise = (async () => {
    if (!usedRefresh) throw Object.assign(new Error('Kein Refresh-Token'), { logout: true });
    try {
      const response = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken: usedRefresh });
      const { accessToken, refreshToken: newRefreshToken } = response.data;
      setTokens(accessToken, newRefreshToken);
      return accessToken;
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        // Ein anderer Tab hat inzwischen erneuert: dessen Tokens nehmen statt abzumelden
        const current = getRefreshToken();
        if (current && current !== usedRefresh) return getToken();
        throw Object.assign(err, { logout: true });
      }
      throw err; // Netzfehler/5xx: angemeldet bleiben
    }
  })().finally(() => { setTimeout(() => { refreshPromise = null; }, 0); });
  return refreshPromise;
};

// Response interceptor
api.interceptors.response.use(
  (response) => { reportConnectivity(true); return response; },
  async (error) => {
    if (isNetworkError(error)) reportConnectivity(false);
    else if (error.response) reportConnectivity(true);

    const originalRequest = error.config;

    // Abgeschlossenes Geschäftsjahr: global nachfragen (ClosedPeriodDialog) und bei „Trotzdem ändern“
    // dieselbe Anfrage mit Bestätigungs-Header wiederholen. Bei Abbruch geht der 409 normal an die Seite.
    // FormData bleibt im Config erhalten und wird beim Wiederholen erneut gesendet.
    if (originalRequest && error.response?.status === 409 && error.response.data?.code === 'CLOSED_PERIOD'
      && !originalRequest._closedPeriodConfirmed) {
      const confirmed = await askClosedPeriod(error.response.data);
      if (!confirmed) return Promise.reject(error);
      originalRequest._closedPeriodConfirmed = true;
      originalRequest.headers[CLOSED_PERIOD_HEADER] = '1';
      return api(originalRequest);
    }

    if (!originalRequest || error.response?.status !== 401 || originalRequest._retry || isAuthCall(originalRequest.url)) {
      return Promise.reject(error);
    }
    originalRequest._retry = true;

    // Mit welchem Token lief die Anfrage? Steht inzwischen ein anderer in localStorage
    // (paralleler Refresh, zweiter Tab), einfach damit wiederholen.
    const sentToken = String(originalRequest.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    const current = getToken();
    if (current && sentToken && current !== sentToken) {
      originalRequest.headers.Authorization = `Bearer ${current}`;
      return api(originalRequest);
    }
    if (!getRefreshToken()) return Promise.reject(error);

    try {
      const accessToken = await refreshTokens();
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      if (refreshError?.logout) {
        forceLogout();
        return Promise.reject(error);
      }
      return Promise.reject(refreshError);
    }
  }
);

export default api;
