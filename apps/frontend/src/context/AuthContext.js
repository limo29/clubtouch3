import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import api, { setTokens, clearTokens, getToken } from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import { can as roleCan } from '../config/permissions';

const AuthContext = createContext(null);

// Zuletzt bekannter Benutzer (Name, Rolle), damit ein Neuladen ohne Netz angemeldet bleibt
const USER_KEY = 'auth_user';
const loadCachedUser = () => {
  try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; } catch { return null; }
};
const cacheUser = (user) => {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify({ id: user.id, email: user.email, username: user.username, name: user.name, role: user.role }));
    else localStorage.removeItem(USER_KEY);
  } catch { /* egal */ }
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // true, solange der Benutzer nur aus dem lokalen Speicher stammt (Server noch nicht bestätigt)
  const [fromCache, setFromCache] = useState(false);

  const checkAuth = useCallback(async () => {
    if (!getToken()) { setLoading(false); return; }
    try {
      const response = await api.get(API_ENDPOINTS.ME);
      setUser(response.data.user);
      cacheUser(response.data.user);
      setFromCache(false);
    } catch (err) {
      if (err.response?.status === 401) {
        // Server lehnt ab (auch der Refresh ist gescheitert): wirklich abmelden
        clearTokens();
        cacheUser(null);
        setUser(null);
      } else {
        // Kein Netz oder Serverfehler: mit dem gemerkten Benutzer weiterarbeiten, nichts löschen
        const cached = loadCachedUser();
        if (cached) { setUser(cached); setFromCache(true); }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Check if user is logged in on mount
  useEffect(() => { checkAuth(); }, [checkAuth]);

  // Offline gestartet: sobald das Netz zurück ist, beim Server bestätigen (Rolle könnte sich geändert haben)
  useEffect(() => {
    if (!fromCache) return undefined;
    const onOnline = () => checkAuth();
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => { if (navigator.onLine) checkAuth(); }, 60000);
    return () => { window.removeEventListener('online', onOnline); clearInterval(timer); };
  }, [fromCache, checkAuth]);

  // Anderer Tab hat sich abgemeldet: hier auch
  useEffect(() => {
    const onStorage = (e) => { if (e.key === 'token' && !e.newValue) setUser(null); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const login = async (identifier, password) => {
    try {
      setError(null);
      const response = await api.post(API_ENDPOINTS.LOGIN, { identifier, password });
      const { user, accessToken, refreshToken } = response.data;

      setTokens(accessToken, refreshToken);
      setUser(user);
      cacheUser(user);
      setFromCache(false);

      return { success: true };
    } catch (err) {
      const errorMessage = err.response?.data?.error
        || (!err.response ? 'Keine Verbindung zum Server – Anmelden geht nur online' : 'Login fehlgeschlagen');
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  // Die Warteschlange der Offline-Buchungen bleibt beim Abmelden erhalten (OfflineContext)
  const logout = async () => {
    try {
      await api.post(API_ENDPOINTS.LOGOUT);
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      clearTokens();
      cacheUser(null);
      setUser(null);
    }
  };

  const value = {
    user,
    login,
    logout,
    loading,
    error,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'ADMIN',
    isCashier: user?.role === 'CASHIER',
    isAccountant: user?.role === 'ACCOUNTANT',
    // Rechte aus config/permissions.js, z.B. can('sell')
    can: (permission) => roleCan(user?.role, permission),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
