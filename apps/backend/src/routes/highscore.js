const express = require('express');
const router = express.Router();
const highscoreController = require('../controllers/highscoreController');
const { authenticate, authorize } = require('../middleware/auth');
const { validateGoals, validateGoalTemplates, validateDisplay } = require('../middleware/highscoreValidation');

// Aliase ohne Login (Frontend nutzt /api/public/highscore/*)
router.get('/all', highscoreController.getAllHighscores);
router.get('/goals-progress', highscoreController.getGoalsProgress);

router.use(authenticate);

// Boards / Archiv
router.get('/', highscoreController.getHighscore);
router.get('/archive', highscoreController.getArchive);

// Ziele und Vorlagen
router.post('/goals-progress', authorize('ADMIN', 'CASHIER'), validateGoals, highscoreController.setGoals);
router.get('/goal-templates', highscoreController.getGoalTemplates);
router.put('/goal-templates', authorize('ADMIN', 'CASHIER'), validateGoalTemplates, highscoreController.setGoalTemplates);

// Anzeige-Einstellung für alle Bildschirme (lesen: /api/public/highscore/display)
router.get('/display', highscoreController.getDisplay);
router.put('/display', authorize('ADMIN', 'CASHIER'), validateDisplay, highscoreController.setDisplay);

// Settings / Kunde
router.get('/settings', highscoreController.getSettings);
router.get('/customer/:customerId/position', highscoreController.getCustomerPosition);
router.get('/customer/:customerId/achievements', highscoreController.getCustomerAchievements);

// Jahres-Reset
router.post('/reset', authorize('ADMIN'), highscoreController.resetHighscore);

module.exports = router;
