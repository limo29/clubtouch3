const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');

// No Auth required for these routes

// Highscore
router.get('/highscore', publicController.getHighscore);
router.get('/highscore/all', publicController.getAllHighscores);
router.get('/highscore/goals-progress', publicController.getGoalsProgress);

// Ads
router.get('/ads', publicController.getAds);

// Customer Balance
router.get('/customer/balance', publicController.checkBalance);

module.exports = router;
