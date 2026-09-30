const prisma = require('../utils/prisma');
const highscoreService = require('../services/highscoreService');

const TYPES = ['DAILY', 'YEARLY'];
const MODES = ['AMOUNT', 'COUNT'];

function audit(userId, action, entityType, entityId, changes) {
  return prisma.auditLog
    .create({ data: { userId, action, entityType, entityId, changes } })
    .catch((err) => console.error('AuditLog fehlgeschlagen:', err));
}

class HighscoreController {
  /** Einzelnes Board (aus dem gemeinsamen Cache). */
  async getHighscore(req, res) {
    try {
      const { type = 'DAILY', mode = 'AMOUNT' } = req.query;
      if (!TYPES.includes(type)) return res.status(400).json({ error: 'Ungültiger Typ' });
      if (!MODES.includes(mode)) return res.status(400).json({ error: 'Ungültiger Modus' });
      res.json(await highscoreService.getBoard(type, mode));
    } catch (error) {
      console.error('Get highscore error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen des Highscores' });
    }
  }

  /** Komplettes Clubscore-Objekt (Boards, Teams, Ziele, Ereignisse, Statistik). */
  async getAllHighscores(req, res) {
    try {
      res.json(await highscoreService.getAllBoards());
    } catch (error) {
      console.error('Get all highscores error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Highscores' });
    }
  }

  async getCustomerPosition(req, res) {
    try {
      const { customerId } = req.params;
      const { type = 'DAILY', mode = 'AMOUNT' } = req.query;
      if (!TYPES.includes(type)) return res.status(400).json({ error: 'Ungültiger Typ' });
      if (!MODES.includes(mode)) return res.status(400).json({ error: 'Ungültiger Modus' });
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

  /** Archiv früherer Jahreswertungen (auth: voller Stand; ?top=n kürzt). */
  async getArchive(req, res) {
    try {
      const top = req.query.top ? Math.max(1, Math.min(20, Number(req.query.top) || 0)) : null;
      res.json({ archive: await highscoreService.getArchive({ top }) });
    } catch (error) {
      console.error('Get highscore archive error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen des Archivs' });
    }
  }

  /** Öffentliche Variante: nur Platz 1-3 je Jahreswertung, höchstens 10 Einträge. */
  async getPublicArchive(req, res) {
    try {
      res.json({ archive: await highscoreService.getArchive({ top: 3, limit: 10 }) });
    } catch (error) {
      console.error('Get public highscore archive error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen des Archivs' });
    }
  }

  async resetHighscore(req, res) {
    try {
      const { type } = req.body;
      if (type !== 'YEARLY') return res.status(400).json({ error: 'Nur YEARLY kann zurückgesetzt werden' });
      const result = await highscoreService.resetHighscore(type, req.user.id);
      res.json({ message: 'Jahres-Clubscore zurückgesetzt', type, ...result });
    } catch (error) {
      console.error('Reset highscore error:', error);
      res.status(500).json({ error: error.message || 'Fehler beim Zurücksetzen' });
    }
  }

  /* ---------- Ziele ---------- */

  async getGoalsProgress(req, res) {
    try {
      res.json(await highscoreService.getGoalsProgress());
    } catch (error) {
      console.error('Get goals progress error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Ziele' });
    }
  }

  async setGoals(req, res) {
    try {
      const { goals, movingTargets } = req.body;
      const { config, progress } = await highscoreService.setGoals(goals, movingTargets);
      await audit(req.user.id, 'SET', 'HighscoreGoals', 'daily', config);
      res.json(progress);
    } catch (error) {
      console.error('Set goals error:', error);
      res.status(500).json({ error: 'Fehler beim Speichern der Ziele' });
    }
  }

  async getGoalTemplates(req, res) {
    try {
      res.json(await highscoreService.getGoalTemplates());
    } catch (error) {
      console.error('Get goal templates error:', error);
      res.status(500).json({ error: 'Fehler beim Laden der Zielvorlagen' });
    }
  }

  async setGoalTemplates(req, res) {
    try {
      const result = await highscoreService.setGoalTemplates(req.body.templates);
      await audit(req.user.id, 'UPDATE_GOAL_TEMPLATES', 'HighscoreGoals', 'templates', result);
      res.json(result);
    } catch (error) {
      console.error('Set goal templates error:', error);
      res.status(500).json({ error: 'Fehler beim Speichern der Zielvorlagen' });
    }
  }

  /* ---------- Anzeige ---------- */

  async getDisplay(req, res) {
    try {
      res.json(await highscoreService.getDisplay());
    } catch (error) {
      console.error('Get display error:', error);
      res.status(500).json({ error: 'Fehler beim Laden der Anzeige-Einstellung' });
    }
  }

  async setDisplay(req, res) {
    try {
      const display = await highscoreService.setDisplay(req.body);
      await audit(req.user.id, 'UPDATE_DISPLAY', 'ClubscoreDisplay', 'display', display);
      res.json(display);
    } catch (error) {
      console.error('Set display error:', error);
      res.status(500).json({ error: 'Fehler beim Speichern der Anzeige-Einstellung' });
    }
  }

  async getSettings(req, res) {
    try {
      res.json(await highscoreService.getSettings());
    } catch (error) {
      console.error('Get settings error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Einstellungen' });
    }
  }
}

module.exports = new HighscoreController();
