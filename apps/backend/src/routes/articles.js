// apps/backend/src/routes/articles.js
const express = require('express');
const router = express.Router();

const articleController = require('../controllers/articleController');
const fileUploadService = require('../services/fileUploadService');
const { authenticate, authorize } = require('../middleware/auth');
const {
  validateArticle,
  validateArticleUpdate,
  handleValidationErrors,
} = require('../middleware/validation');

// --- (optional) kurze Diagnose, kann nach dem Test wieder raus ---
// console.log('[articles routes] ready', {
//   authenticate: typeof authenticate,
//   authorize: typeof authorize,
//   multerSingle: typeof (fileUploadService?.articleImageUpload?.single),
//   controller: {
//     listArticles: typeof articleController?.listArticles,
//     createArticle: typeof articleController?.createArticle,
//     updateArticle: typeof articleController?.updateArticle,
//     toggleArticleStatus: typeof articleController?.toggleArticleStatus,
//     checkLowStock: typeof articleController?.checkLowStock,
//     getArticle: typeof articleController?.getArticle,
//     getArticleStats: typeof articleController?.getArticleStats,
//   }
// });

// Helper für async-Controller
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Alle Artikel-Routes benötigen Authentifizierung
router.use(authenticate);

// Liste aller Artikel
router.get('/', h(articleController.listArticles));

// Bestandswarnungen
router.get('/low-stock', h(articleController.checkLowStock));

// Einzelner Artikel
router.get('/:id', h(articleController.getArticle));

// Statistiken
router.get('/:id/stats', h(articleController.getArticleStats));

// Neuen Artikel erstellen (Admins + Kassierer)
router.post(
  '/',
  authorize('ADMIN', 'CASHIER'),
  fileUploadService.articleImageUpload.single('image'),
  validateArticle,
  handleValidationErrors,
  h(articleController.createArticle)
);

// Artikel aktualisieren (Admins + Kassierer)
router.put(
  '/:id',
  authorize('ADMIN', 'CASHIER'),
  fileUploadService.articleImageUpload.single('image'),
  validateArticleUpdate,
  handleValidationErrors,
  h(articleController.updateArticle)
);

// Artikel aktivieren/deaktivieren (nur Admins)
router.patch(
  '/:id/toggle-status',
  authorize('ADMIN', 'CASHIER'),
  h(articleController.toggleArticleStatus)
);

module.exports = router;
