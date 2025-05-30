const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { authenticate, authorize } = require('../middleware/auth');

// Alle Routes benötigen Authentifizierung
router.use(authenticate);

// Liste Rechnungen
router.get('/',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  invoiceController.listInvoices
);

// Einzelne Rechnung
router.get('/:id',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  invoiceController.getInvoice
);

// Rechnung als PDF
router.get('/:id/pdf',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  invoiceController.downloadPDF
);

// Neue Rechnung
router.post('/',
  authorize('ADMIN', 'CASHIER'),
  invoiceController.createInvoice
);

// Status aktualisieren
router.patch('/:id/status',
  authorize('ADMIN', 'CASHIER'),
  invoiceController.updateStatus
);

module.exports = router;
