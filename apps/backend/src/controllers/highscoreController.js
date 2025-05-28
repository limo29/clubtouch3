const highscoreService = require('../services/highscoreService');
const prisma = require('../utils/prisma');

class HighscoreController {
  // Hole aktuellen Highscore
  async getHighscore(req, res) {
    try {
      const { type = 'DAILY', mode = 'AMOUNT' } = req.query;
      
      if (!['DAILY', 'YEARLY'].includes(type)) {
        return res.status(400).json({ error: 'Ungültiger Typ. Erlaubt: DAILY, YEARLY' });
      }
      
      if (!['AMOUNT', 'COUNT'].includes(mode)) {
        return res.status(400).json({ error: 'Ungültiger Modus. Erlaubt: AMOUNT, COUNT' });
      }
      
      const highscore = await highscoreService.calculateHighscore(type, mode);
      
      res.json(highscore);
    } catch (error) {
      console.error('Get highscore error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen des Highscores' });
    }
  }
  
  // Hole alle Highscores auf einmal
  async getAllHighscores(req, res) {
    try {
      const [dailyAmount, dailyCount, yearlyAmount, yearlyCount] = await Promise.all([
        highscoreService.calculateHighscore('DAILY', 'AMOUNT'),
        highscoreService.calculateHighscore('DAILY', 'COUNT'),
        highscoreService.calculateHighscore('YEARLY', 'AMOUNT'),
        highscoreService.calculateHighscore('YEARLY', 'COUNT')
      ]);
      
      res.json({
        daily: {
          amount: dailyAmount,
          count: dailyCount
        },
        yearly: {
          amount: yearlyAmount,
          count: yearlyCount
        }
      });
    } catch (error) {
      console.error('Get all highscores error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Highscores' });
    }
  }
  
  // Hole Position eines bestimmten Kunden
  async getCustomerPosition(req, res) {
    try {
      const { customerId } = req.params;
      const { type = 'DAILY', mode = 'AMOUNT' } = req.query;
      
      const position = await highscoreService.getCustomerPosition(customerId, type, mode);
      
      if (!position) {
        return res.status(404).json({ 
          error: 'Kunde hat noch keine Punkte in diesem Zeitraum' 
        });
      }
      
      res.json(position);
    } catch (error) {
      console.error('Get customer position error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Kundenposition' });
    }
  }
  
  // Hole Achievements eines Kunden
  async getCustomerAchievements(req, res) {
    try {
      const { customerId } = req.params;
      
      const achievements = await highscoreService.getCustomerAchievements(customerId);
      
      res.json({
        customerId,
        achievements,
        count: achievements.length
      });
    } catch (error) {
      console.error('Get customer achievements error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Achievements' });
    }
  }
  
  // Reset Highscore (nur Admins)
  async resetHighscore(req, res) {
    try {
      const { type } = req.body;
      
      if (!['YEARLY'].includes(type)) {
        return res.status(400).json({ 
          error: 'Nur der Jahres-Highscore kann manuell zurückgesetzt werden' 
        });
      }
      
      await highscoreService.resetHighscore(type, req.user.id);
      
      res.json({
        message: 'Highscore erfolgreich zurückgesetzt',
        type
      });
    } catch (error) {
      console.error('Reset highscore error:', error);
      res.status(500).json({ error: error.message || 'Fehler beim Zurücksetzen des Highscores' });
    }
  }
  
  // Hole Highscore-Einstellungen
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
