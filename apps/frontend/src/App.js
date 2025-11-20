import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { de } from 'date-fns/locale';

import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import Layout from './components/layout/Layout';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Sales from './pages/Sales';
import Articles from './pages/Articles';
import Customers from './pages/Customers';
import Transactions from './pages/Transactions';
import Highscore from './pages/Highscore';
import Users from './pages/Users';
import Reports from './pages/Reports';
import PurchaseDocuments from './pages/PurchaseDocuments';
import PurchaseDocumentsCreate from './pages/PurchaseDocumentsCreate';
import ProfitLoss from './pages/ProfitLoss';
import Invoices from './pages/Invoices';
import PurchaseDocumentEdit from './pages/PurchaseDocumentEdit';
import PublicHighscore from './pages/PublicHighscore';
import PublicAds from './pages/PublicAds';
import AdminAds from './pages/AdminAds';
import CheckBalance from './pages/CheckBalance';

// React Query Client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={de}>
        <AuthProvider>
          {/* KEIN <Router> HIER! Router ist bereits in index.js */}
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="sales" element={<Sales />} />
              <Route path="articles" element={<Articles />} />
              <Route path="customers" element={<Customers />} />
              <Route path="transactions" element={<Transactions />} />
              <Route path="highscore" element={<Highscore />} />
              <Route
                path="users"
                element={
                  <ProtectedRoute roles={['ADMIN']}>
                    <Users />
                  </ProtectedRoute>
                }
              />
              <Route path="reports" element={<Reports />} />
              <Route path="PurchaseDocuments" element={<PurchaseDocuments />} />
              <Route path="PurchaseDocumentsCreate" element={<PurchaseDocumentsCreate />} />
              <Route path="profit-loss" element={<ProfitLoss />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="/PurchaseDocuments/edit/:id" element={<PurchaseDocumentEdit />} />
              <Route path="profit-loss" element={<ProfitLoss />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="/PurchaseDocuments/edit/:id" element={<PurchaseDocumentEdit />} />
              <Route path="ads" element={<AdminAds />} />
            </Route>

            {/* Public Routes */}
            <Route path="/public/highscore" element={<PublicHighscore />} />
            <Route path="/public/ads" element={<PublicAds />} />
            <Route path="/check-balance" element={<CheckBalance />} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthProvider>
      </LocalizationProvider>
    </QueryClientProvider>
  );
}

export default App;
