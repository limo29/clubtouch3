const express = require('express');
const router = express.Router();
const highscoreController = require('../controllers/highscoreController');
const { authenticate, authorize } = require('../middleware/auth');

// Alle Highscore-Routes benötigen Authentifizierung
router.use(authenticate);

// Hole Highscore (alle authentifizierten Nutzer)
router.get('/', highscoreController.getHighscore);

// Hole alle Highscores auf einmal (alle authentifizierten Nutzer)
router.get('/all', highscoreController.getAllHighscores);

// Hole Einstellungen (alle authentifizierten Nutzer)
router.get('/settings', highscoreController.getSettings);

// Hole Kundenposition (alle authentifizierten Nutzer)
router.get('/customer/:customerId/position', highscoreController.getCustomerPosition);

// Hole Kunden-Achievements (alle authentifizierten Nutzer)
router.get('/customer/:customerId/achievements', highscoreController.getCustomerAchievements);

// Reset Highscore (nur Admins)
router.post('/reset', 
  authorize('ADMIN'),
  highscoreController.resetHighscore
);

module.exports = router;
