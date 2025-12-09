// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import reportWebVitals from './reportWebVitals';
import ColorModeProvider from './theme';
import { OfflineProvider } from './context/OfflineContext';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ColorModeProvider>
      <OfflineProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </OfflineProvider>
    </ColorModeProvider>
  </React.StrictMode>
);

serviceWorkerRegistration.register();
reportWebVitals();
