export const API_BASE_URL = process.env.REACT_APP_API_URL;
const WS_URL = process.env.REACT_APP_WS_URL || 'http://localhost:3001';

export const API_ENDPOINTS = {
  // Auth
  LOGIN: '/auth/login',
  LOGOUT: '/auth/logout',
  REFRESH: '/auth/refresh',
  ME: '/auth/me',

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

  // Exports
  EXPORTS: '/exports'
};

export { API_BASE_URL, WS_URL };
