const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, authorize } = require('../middleware/auth');
const { 
  validateRegister,
  validateUserUpdate,
  handleValidationErrors 
} = require('../middleware/validation');

// Alle User-Routes benötigen Authentifizierung
router.use(authenticate);

// Liste aller User (nur für Admins)
router.get('/', authorize('ADMIN'), userController.listUsers);

// Einzelnen User abrufen (Admins oder eigenes Profil)
router.get('/:id', async (req, res, next) => {
  // Erlaube Zugriff auf eigenes Profil oder für Admins
  if (req.params.id !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  next();
}, userController.getUser);

// Neuen User erstellen (nur Admins)
router.post('/', 
  authorize('ADMIN'),
  validateRegister,
  handleValidationErrors,
  userController.createUser
);

// User aktualisieren (Admins oder eigenes Profil)
router.put('/:id',
  async (req, res, next) => {
    // Erlaube nur eigenes Profil oder für Admins
    if (req.params.id !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    next();
  },
  validateUserUpdate,
  handleValidationErrors,
  userController.updateUser
);

// User aktivieren/deaktivieren (nur Admins)
router.patch('/:id/toggle-status',
  authorize('ADMIN'),
  userController.toggleUserStatus
);

// User "löschen" (deaktivieren) (nur Admins)
router.delete('/:id',
  authorize('ADMIN'),
  userController.deleteUser
);

module.exports = router;
