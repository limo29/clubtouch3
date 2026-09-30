const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';
const WS_URL = process.env.REACT_APP_WS_URL || '/';

export const API_ENDPOINTS = {
  // Auth
  LOGIN: '/auth/login',
  LOGOUT: '/auth/logout',
  REFRESH: '/auth/refresh',
  ME: '/auth/me',
  CHANGE_PASSWORD: '/auth/change-password',

  // Users
  USERS: '/users',

  // Articles
  ARTICLES: '/articles',
  ARTICLES_LOW_STOCK: '/articles/low-stock',

  // Customers
  CUSTOMERS: '/customers',
  CUSTOMERS_LOW_BALANCE: '/customers/low-balance',

  // Transactions
  TRANSACTIONS: '/transactions',
  QUICK_SALE: '/transactions/quick-sale',
  DAILY_SUMMARY: '/transactions/daily-summary',

  // Highscore
  HIGHSCORE: '/highscore',
  HIGHSCORE_ALL: '/highscore/all',
  HIGHSCORE_GOALS_PROGRESS: '/highscore/goals-progress',
  HIGHSCORE_SETTINGS: '/highscore/settings',
  HIGHSCORE_RESET: '/highscore/reset',
  HIGHSCORE_ARCHIVE: '/highscore/archive',
  PUBLIC_HIGHSCORE_ARCHIVE: '/public/highscore/archive',

  // Exports
  EXPORTS: '/exports',

  // Cash Movements
  CASH_MOVEMENTS: '/cash-movements',
  CASH_MOVEMENTS_BANK_ACCOUNTS: '/cash-movements/bank-accounts',

  // Customer Groups
  CUSTOMER_GROUPS: '/customer-groups',
};

export { API_BASE_URL, WS_URL };
