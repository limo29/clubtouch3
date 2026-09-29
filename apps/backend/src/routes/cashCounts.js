const express = require('express');
const router = express.Router();
const cashCountController = require('../controllers/cashCountController');
const { authenticate, authorize } = require('../middleware/auth');
const { validateCashCount, handleValidationErrors } = require('../middleware/validation');

router.use(authenticate);

const READ_ROLES = ['ADMIN', 'ACCOUNTANT', 'CASHIER'];

// Liste der Zählungen
router.get('/', authorize(...READ_ROLES), cashCountController.list);

// Soll-Vorschau (was eine Zählung jetzt erwarten würde)
router.get('/preview', authorize(...READ_ROLES), cashCountController.preview);

// Letzte Zählung
router.get('/latest', authorize(...READ_ROLES), cashCountController.latest);

// Zählung anlegen
router.post('/',
  authorize('ADMIN', 'ACCOUNTANT', 'CASHIER'),
  validateCashCount,
  handleValidationErrors,
  cashCountController.create
);

// Zählbeleg als PDF
router.get('/:id/pdf', authorize(...READ_ROLES), cashCountController.pdf);

// Einzelne Zählung
router.get('/:id', authorize(...READ_ROLES), cashCountController.getById);

module.exports = router;
