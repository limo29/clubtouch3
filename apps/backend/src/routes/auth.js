const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { 
  validateLogin, 
  handleValidationErrors 
} = require('../middleware/validation');

// Public routes
router.post('/login', validateLogin, handleValidationErrors, authController.login);
router.post('/refresh', authController.refreshToken);

// Protected routes
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);

module.exports = router;
