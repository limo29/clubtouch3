const express = require('express');
const router = express.Router();
const highscoreController = require('../controllers/highscoreController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// Highscores
router.get('/', highscoreController.getHighscore);
router.get('/all', highscoreController.getAllHighscores);

// Goals
router.get('/goals-progress', highscoreController.getGoalsProgress);
router.post('/goals-progress', authorize('ADMIN', 'CASHIER'), highscoreController.setGoals);

// Settings / Customer
router.get('/settings', highscoreController.getSettings);
router.get('/customer/:customerId/position', highscoreController.getCustomerPosition);
router.get('/customer/:customerId/achievements', highscoreController.getCustomerAchievements);

// Reset yearly
router.post('/reset', authorize('ADMIN'), highscoreController.resetHighscore);

module.exports = router;
