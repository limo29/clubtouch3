// routes/cashMovements.js
//
// Kassenbewegungen: Einzahlungen auf Bank, Abhebungen von Bank,
// sonstige Bareinnahmen und Barausgaben.

const express = require('express');
const router = express.Router();
const cashMovementController = require('../controllers/cashMovementController');
const { authenticate, authorize } = require('../middleware/auth');
const { validateCashMovement, handleValidationErrors } = require('../middleware/validation');

router.use(authenticate);

const ALL_ROLES = ['ADMIN', 'ACCOUNTANT', 'CASHIER'];
const MANAGE_ROLES = ['ADMIN', 'ACCOUNTANT'];

// Liste der Kassenbewegungen
router.get('/', authorize(...ALL_ROLES), cashMovementController.list);

// Zuletzt verwendete Kontonamen (Autocomplete)
router.get('/bank-accounts', authorize(...ALL_ROLES), cashMovementController.bankAccounts);

// Kassenbewegung anlegen
router.post('/',
  authorize(...ALL_ROLES),
  validateCashMovement,
  handleValidationErrors,
  cashMovementController.create
);

// Kassenbewegung stornieren
router.post('/:id/cancel',
  authorize(...MANAGE_ROLES),
  cashMovementController.cancel
);

module.exports = router;
