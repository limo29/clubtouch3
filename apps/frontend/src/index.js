// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import './fonts';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import ColorModeProvider from './theme';
import { OfflineProvider } from './context/OfflineContext';
import ErrorBoundary from './components/common/ErrorBoundary';
import UpdateNotifier, { announceUpdate } from './components/offline/UpdateNotifier';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ColorModeProvider>
      <OfflineProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </BrowserRouter>
        <UpdateNotifier />
      </OfflineProvider>
    </ColorModeProvider>
  </React.StrictMode>
);

// Service Worker: App-Hülle offline verfügbar (Neuladen ohne Netz). Öffentliche Anzeigen ohne
// Bedienung (TV, Guthaben-Abfrage) übernehmen neue Versionen sofort, alle anderen erst auf Knopfdruck.
const isUnattended = () => /^\/(public\/|check-balance)/.test(window.location.pathname);
serviceWorkerRegistration.register({
  onUpdate: (registration) => {
    if (isUnattended()) serviceWorkerRegistration.applyUpdate(registration);
    else announceUpdate(registration);
  },
});
