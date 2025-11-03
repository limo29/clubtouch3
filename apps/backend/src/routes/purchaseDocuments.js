const express = require('express');
const router = express.Router();
const purchaseDocumentController = require('../controllers/purchaseDocumentController');
const fileUploadService = require('../services/fileUploadService');
const { authenticate, authorize } = require('../middleware/auth');

// Alle Routen benötigen Authentifizierung
router.use(authenticate);

// Liste Belege (GET /api/purchase-documents)
router.get('/', 
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  purchaseDocumentController.listDocuments
);

// NEU: Holt Lieferantenliste
router.get('/suppliers',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  purchaseDocumentController.getSuppliers
);
// NEU: Holt ungebundene Lieferscheine
router.get('/unassigned',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  purchaseDocumentController.getUnassigned
);
// Erstelle neuen Beleg (POST /api/purchase-documents)
router.post('/',
  authorize('ADMIN', 'CASHIER'),
  fileUploadService.nachweisUpload.single('nachweis'),
  purchaseDocumentController.createDocument
);

// Verknüpfe Lieferscheine (POST /api/purchase-documents/link)
router.post('/link',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  purchaseDocumentController.linkDocuments
);
// NEU: Entknüpfe Lieferscheine
router.post('/unlink',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  purchaseDocumentController.unlinkDocuments
);
router.post('/:id/mark-paid',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  purchaseDocumentController.markAsPaid
);
router.post('/:id/mark-unpaid',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  purchaseDocumentController.markAsUnpaid
);

// Einzelner Beleg (GET /api/purchase-documents/:id)
// Diese Route MUSS nach /suppliers stehen
router.get('/:id',
  authorize('ADMIN', 'CASHIER', 'ACCOUNTANT'),
  purchaseDocumentController.getDocumentById
);
// NEU: Beleg (Kopfdaten) aktualisieren
router.patch('/:id',
  authorize('ADMIN', 'CASHIER'),
  fileUploadService.nachweisUpload.single('nachweis'),
  purchaseDocumentController.updateDocument
);
router.delete('/:id',
  authorize('ADMIN', 'CASHIER'), // Oder nur ADMIN?
  purchaseDocumentController.deleteDocument
);
module.exports = router;
