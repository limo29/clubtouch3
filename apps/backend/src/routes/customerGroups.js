// routes/customerGroups.js
const express = require('express');
const router = express.Router();

const customerGroupController = require('../controllers/customerGroupController');
const fileUploadService = require('../services/fileUploadService');
const { authenticate, authorize } = require('../middleware/auth');
const {
  validateCustomerGroup,
  validateCustomerGroupUpdate,
  handleValidationErrors,
} = require('../middleware/validation');

// Alle Routen erfordern Authentifizierung
router.use(authenticate);

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// GET /api/customer-groups  – alle Rollen
router.get('/', h(customerGroupController.listGroups));

// POST /api/customer-groups  – ADMIN, CASHIER
router.post(
  '/',
  authorize('ADMIN', 'CASHIER'),
  validateCustomerGroup,
  handleValidationErrors,
  h(customerGroupController.createGroup)
);

// PUT /api/customer-groups/:id  – ADMIN, CASHIER
router.put(
  '/:id',
  authorize('ADMIN', 'CASHIER'),
  validateCustomerGroupUpdate,
  handleValidationErrors,
  h(customerGroupController.updateGroup)
);

// DELETE /api/customer-groups/:id  – nur ADMIN
router.delete('/:id', authorize('ADMIN'), h(customerGroupController.deleteGroup));

// POST /api/customer-groups/:id/image  – ADMIN, CASHIER
router.post(
  '/:id/image',
  authorize('ADMIN', 'CASHIER'),
  (req, res, next) => {
    // Multer-Fehler → 400
    fileUploadService.groupImageUpload.single('image')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Fehler beim Datei-Upload' });
      }
      next();
    });
  },
  h(customerGroupController.uploadGroupImage)
);

// DELETE /api/customer-groups/:id/image  – ADMIN, CASHIER
router.delete('/:id/image', authorize('ADMIN', 'CASHIER'), h(customerGroupController.deleteGroupImage));

module.exports = router;
