const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');
const { authenticate, authorize } = require('../middleware/auth');

// Alle Export-Routes benötigen Authentifizierung
router.use(authenticate);

// Liste verfügbare Exporte (alle authentifizierten Nutzer)
router.get('/', exportController.listAvailableExports);

// CSV Exporte (Admins und Kassierer)
router.get('/transactions', 
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  exportController.exportTransactions
);

router.get('/inventory',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  exportController.exportInventory
);

router.get('/customers',
  authorize('ADMIN', 'ACCOUNTANT'),
  exportController.exportCustomers
);

// PDF Exporte (Admins und Kassierer)
router.get('/daily-summary',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  exportController.exportDailySummary
);

router.get('/monthly-summary',
  authorize('ADMIN', 'ACCOUNTANT'),
  exportController.exportMonthlySummary
);

router.get('/customer/:customerId/statement',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  exportController.exportCustomerStatement
);

module.exports = router;
