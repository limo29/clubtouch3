const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');

// No Auth required for these routes

// Highscore
router.get('/highscore', publicController.getHighscore);
router.get('/highscore/all', publicController.getAllHighscores);
router.get('/highscore/goals-progress', publicController.getGoalsProgress);
router.get('/highscore/archive', publicController.getArchive);
router.get('/highscore/display', publicController.getHighscoreDisplay);

// Ads
router.get('/ads', publicController.getAds);
// Speisekarte für Slides (Menü-Element): nur aktive Artikel, nur Name/Preis/Kategorie
router.get('/articles', publicController.getMenuArticles);

// Guthaben-Abfrage mit gemeinsamem PIN (POST, damit der PIN nicht in URL und Logs landet)
router.post('/customer/balance', publicController.checkBalance);

module.exports = router;
