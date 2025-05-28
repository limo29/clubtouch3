import React, { createContext, useState, useContext, useEffect } from 'react';
import api, { setTokens, clearTokens, getToken } from '../services/api';
import { API_ENDPOINTS } from '../config/api';

const AuthContext = createContext(null);

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

  // Check if user is logged in on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = getToken();
      if (token) {
        try {
          const response = await api.get(API_ENDPOINTS.ME);
          setUser(response.data.user);
        } catch (err) {
          console.error('Auth check failed:', err);
          clearTokens();
        }
      }
      setLoading(false);
    };
    
    checkAuth();
  }, []);

  const login = async (email, password) => {
    try {
      setError(null);
      const response = await api.post(API_ENDPOINTS.LOGIN, { email, password });
      const { user, accessToken, refreshToken } = response.data;
      
      setTokens(accessToken, refreshToken);
      setUser(user);
      
      return { success: true };
    } catch (err) {
      const errorMessage = err.response?.data?.error || 'Login fehlgeschlagen';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  const logout = async () => {
    try {
      await api.post(API_ENDPOINTS.LOGOUT);
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      clearTokens();
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
