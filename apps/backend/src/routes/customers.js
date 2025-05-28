const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { authenticate, authorize } = require('../middleware/auth');
const { 
  validateCustomer,
  validateCustomerUpdate,
  validateTopUp,
  handleValidationErrors 
} = require('../middleware/validation');

// Alle Kunden-Routes benötigen Authentifizierung
router.use(authenticate);

// Liste aller Kunden (alle authentifizierten Nutzer)
router.get('/', customerController.listCustomers);

// Kunden mit niedrigem Guthaben (alle authentifizierten Nutzer)
router.get('/low-balance', customerController.getCustomersWithLowBalance);

// Einzelnen Kunden abrufen (alle authentifizierten Nutzer)
router.get('/:id', customerController.getCustomer);

// Kunden-Statistiken (alle authentifizierten Nutzer)
router.get('/:id/stats', customerController.getCustomerStats);

// Kontoauszug (alle authentifizierten Nutzer)
router.get('/:id/statement', customerController.getAccountStatement);

// Neuen Kunden erstellen (nur Admins und Kassierer)
router.post('/', 
  authorize('ADMIN', 'CASHIER'),
  validateCustomer,
  handleValidationErrors,
  customerController.createCustomer
);

// Kunden aktualisieren (nur Admins und Kassierer)
router.put('/:id',
  authorize('ADMIN', 'CASHIER'),
  validateCustomerUpdate,
  handleValidationErrors,
  customerController.updateCustomer
);

// Guthaben aufladen (nur Admins und Kassierer)
router.post('/:id/topup',
  authorize('ADMIN', 'CASHIER'),
  validateTopUp,
  handleValidationErrors,
  customerController.topUpAccount
);

module.exports = router;
