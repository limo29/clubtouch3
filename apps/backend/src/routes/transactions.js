const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');
const { authenticate, authorize } = require('../middleware/auth');
const { 
  validateSale,
  validateQuickSale,
  handleValidationErrors 
} = require('../middleware/validation');

// Alle Transaktions-Routes benötigen Authentifizierung
router.use(authenticate);

// Liste Transaktionen (alle authentifizierten Nutzer)
router.get('/', transactionController.listTransactions);

// Tagesabschluss (alle authentifizierten Nutzer)
router.get('/daily-summary', transactionController.getDailySummary);

// Einzelne Transaktion abrufen (alle authentifizierten Nutzer)
router.get('/:id', transactionController.getTransaction);

// Neuen Verkauf erstellen (nur Kassierer und Admins)
router.post('/',
  authorize('ADMIN', 'CASHIER'),
  validateSale,
  handleValidationErrors,
  transactionController.createSale
);

// Schnellverkauf (nur Kassierer und Admins)
router.post('/quick-sale',
  authorize('ADMIN', 'CASHIER'),
  validateQuickSale,
  handleValidationErrors,
  transactionController.quickSale
);

// Transaktion stornieren (nur Kassierer und Admins)
router.post('/:id/cancel',
  authorize('ADMIN', 'CASHIER'),
  transactionController.cancelTransaction
);

module.exports = router;
