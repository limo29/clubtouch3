const highscoreService = require('../services/highscoreService');

class HighscoreController {
  async getHighscore(req, res) {
    try {
      const { type = 'DAILY', mode = 'AMOUNT' } = req.query;
      if (!['DAILY', 'YEARLY'].includes(type)) return res.status(400).json({ error: 'Ungültiger Typ' });
      if (!['AMOUNT', 'COUNT'].includes(mode)) return res.status(400).json({ error: 'Ungültiger Modus' });

      const highscore = await highscoreService.calculateHighscore(type, mode);
      res.json(highscore);
    } catch (error) {
      console.error('Get highscore error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen des Highscores' });
    }
  }

  async getAllHighscores(req, res) {
    try {
      const [dailyAmount, dailyCount, yearlyAmount, yearlyCount] = await Promise.all([
        highscoreService.calculateHighscore('DAILY', 'AMOUNT'),
        highscoreService.calculateHighscore('DAILY', 'COUNT'),
        highscoreService.calculateHighscore('YEARLY', 'AMOUNT'),
        highscoreService.calculateHighscore('YEARLY', 'COUNT')
      ]);
      res.json({ daily: { amount: dailyAmount, count: dailyCount }, yearly: { amount: yearlyAmount, count: yearlyCount } });
    } catch (error) {
      console.error('Get all highscores error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Highscores' });
    }
  }

  async getCustomerPosition(req, res) {
    try {
      const { customerId } = req.params;
      const { type = 'DAILY', mode = 'AMOUNT' } = req.query;
      const position = await highscoreService.getCustomerPosition(customerId, type, mode);
      if (!position) return res.status(404).json({ error: 'Kunde hat noch keine Punkte' });
      res.json(position);
    } catch (error) {
      console.error('Get customer position error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Kundenposition' });
    }
  }

  async getCustomerAchievements(req, res) {
    try {
      const { customerId } = req.params;
      const achievements = await highscoreService.getCustomerAchievements(customerId);
      res.json({ customerId, achievements, count: achievements.length });
    } catch (error) {
      console.error('Get customer achievements error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Achievements' });
    }
  }

  async resetHighscore(req, res) {
    try {
      const { type } = req.body;
      if (type !== 'YEARLY') return res.status(400).json({ error: 'Nur YEARLY kann zurückgesetzt werden' });
      await highscoreService.resetHighscore(type, req.user.id);
      res.json({ message: 'Highscore zurückgesetzt', type });
    } catch (error) {
      console.error('Reset highscore error:', error);
      res.status(500).json({ error: error.message || 'Fehler beim Zurücksetzen' });
    }
  }

  // Goals
  async getGoalsProgress(req, res) {
    try {
      const progress = await highscoreService.getGoalsProgress();
      res.json(progress);
    } catch (error) {
      console.error('Get goals progress error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Ziele' });
    }
  }

  async setGoals(req, res) {
    try {
      const { goals } = req.body;
      const saved = await highscoreService.setGoals(goals || [], req.user?.id || 'system');
      const progress = await highscoreService.getGoalsProgress();
      res.json({ ...saved, progress });
    } catch (error) {
      console.error('Set goals error:', error);
      res.status(500).json({ error: 'Fehler beim Speichern der Ziele' });
    }
  }

  async getSettings(req, res) {
    try {
      const settings = await highscoreService.getSettings();
      res.json(settings);
    } catch (error) {
      console.error('Get settings error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Einstellungen' });
    }
  }
}

module.exports = new HighscoreController();
