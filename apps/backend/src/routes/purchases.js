const express = require('express');
const router = express.Router();
const purchaseController = require('../controllers/purchaseController');
const fileUploadService = require('../services/fileUploadService');
const { authenticate, authorize } = require('../middleware/auth');

// Alle Routes benötigen Authentifizierung
router.use(authenticate);

// Liste Einkäufe
router.get('/', 
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  purchaseController.listPurchases
);

// EÜR berechnen
router.get('/profit-loss',
  authorize('ADMIN', 'ACCOUNTANT'),
  purchaseController.calculateProfitLoss
);

// Einzelner Einkauf
router.get('/:id',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  purchaseController.getPurchase
);

// Neuer Einkauf
router.post('/',
  authorize('ADMIN', 'CASHIER'),
  fileUploadService.invoiceUpload.single('invoice'),
  purchaseController.createPurchase
);

// Als bezahlt markieren
router.post('/:id/mark-paid',
  authorize('ADMIN', 'CASHIER'),
  purchaseController.markAsPaid
);
router.get('/suppliers',
  authenticate,
  purchaseController.getSuppliers
);

module.exports = router;
 
