const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { 
  validateLogin, 
  validateChangePassword,
  handleValidationErrors 
} = require('../middleware/validation');

// Public routes
router.post('/login', validateLogin, handleValidationErrors, authController.login);
router.post('/refresh', authController.refreshToken);

// Protected routes
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);
router.post('/change-password', authenticate, validateChangePassword, handleValidationErrors, authController.changePassword);

module.exports = router;
