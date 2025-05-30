const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');
const fileUploadService = require('../services/fileUploadService');
const { authenticate, authorize } = require('../middleware/auth');
const { 
  validateArticle,
  validateArticleUpdate,
  validateDelivery,
  validateInventory,
  handleValidationErrors 
} = require('../middleware/validation');

// Alle Artikel-Routes benötigen Authentifizierung
router.use(authenticate);

// Liste aller Artikel (alle authentifizierten Nutzer)
router.get('/', articleController.listArticles);

// Bestands-Warnungen (alle authentifizierten Nutzer)
router.get('/low-stock', articleController.checkLowStock);

// Einzelnen Artikel abrufen (alle authentifizierten Nutzer)
router.get('/:id', articleController.getArticle);

// Artikel-Statistiken (alle authentifizierten Nutzer)
router.get('/:id/stats', articleController.getArticleStats);

// Neuen Artikel erstellen (nur Admins und Kassierer)
router.post('/', 
  authorize('ADMIN', 'CASHIER'),
  fileUploadService.articleImageUpload.single('image'),
  validateArticle,
  handleValidationErrors,
  articleController.createArticle
);


// Artikel aktualisieren (nur Admins und Kassierer)
router.put('/:id',
  authorize('ADMIN', 'CASHIER'),
  fileUploadService.articleImageUpload.single('image'),
  validateArticleUpdate,
  handleValidationErrors,
  articleController.updateArticle
);


// Artikel aktivieren/deaktivieren (nur Admins)
router.patch('/:id/toggle-status',
  authorize('ADMIN'),
  articleController.toggleArticleStatus
);

// Wareneingang (nur Admins und Kassierer)
router.post('/:id/delivery',
  authorize('ADMIN', 'CASHIER'),
  validateDelivery,
  handleValidationErrors,
  articleController.processDelivery
);

// Inventur (nur Admins und Kassierer)
router.post('/:id/inventory',
  authorize('ADMIN', 'CASHIER'),
  validateInventory,
  handleValidationErrors,
  articleController.processInventory
);

module.exports = router;
