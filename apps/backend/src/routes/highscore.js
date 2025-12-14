const express = require('express');
const router = express.Router();
const highscoreController = require('../controllers/highscoreController');
const { authenticate, authorize } = require('../middleware/auth');

// Public routes (Display)
router.get('/all', highscoreController.getAllHighscores);
router.get('/goals-progress', highscoreController.getGoalsProgress);

router.use(authenticate);

// Highscores (Personal)
router.get('/', highscoreController.getHighscore);

// Goals (Admin)
router.post('/goals-progress', authorize('ADMIN', 'CASHIER'), highscoreController.setGoals);

// Settings / Customer
router.get('/settings', highscoreController.getSettings);
router.get('/customer/:customerId/position', highscoreController.getCustomerPosition);
router.get('/customer/:customerId/achievements', highscoreController.getCustomerAchievements);

// Reset yearly
router.post('/reset', authorize('ADMIN'), highscoreController.resetHighscore);

module.exports = router;
