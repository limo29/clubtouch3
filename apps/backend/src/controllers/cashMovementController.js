// controllers/cashMovementController.js
//
// REST-Controller für Kassenbewegungen (Ein-/Auszahlungen, sonstige Barein-/ausgaben).
// Geschäftslogik und AuditLog-Schreiben liegen im Service.

const cashMovementService = require('../services/cashMovementService');
const { parseLocalDate, endOfLocalDay } = require('../utils/businessDay');

class CashMovementController {
  // GET /api/cash-movements?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=50
  async list(req, res) {
    try {
      const { from, to, limit } = req.query;
      const fromDate = from ? parseLocalDate(from) : null;
      const toDate = to ? endOfLocalDay(to) : null;
      const cashMovements = await cashMovementService.list({
        from: fromDate,
        to: toDate,
        limit: limit ? Number(limit) : 50
      });
      res.json({ cashMovements });
    } catch (error) {
      console.error('List cash movements error:', error);
      res.status(500).json({ error: 'Fehler beim Laden der Kassenbewegungen' });
    }
  }

  // GET /api/cash-movements/bank-accounts
  async bankAccounts(req, res) {
    try {
      const bankAccounts = await cashMovementService.recentBankAccounts();
      res.json({ bankAccounts });
    } catch (error) {
      console.error('Bank accounts error:', error);
      res.status(500).json({ error: 'Fehler beim Laden der Kontonamen' });
    }
  }

  // POST /api/cash-movements
  async create(req, res) {
    try {
      const { type, amount, occurredAt, note, bankAccount } = req.body;
      const cashMovement = await cashMovementService.create({
        type, amount, occurredAt, note, bankAccount,
        userId: req.user.id
      });
      res.status(201).json({ cashMovement });
    } catch (error) {
      console.error('Create cash movement error:', error);
      const known = /Ungültig|Pflicht|Betrag|Datum|Benutzer fehlt/.test(error.message || '');
      res.status(known ? 400 : 500).json({
        error: known ? error.message : 'Fehler beim Anlegen der Kassenbewegung',
        ...(known ? {} : { details: error.message })
      });
    }
  }

  // POST /api/cash-movements/:id/cancel
  async cancel(req, res) {
    try {
      const cashMovement = await cashMovementService.cancel(req.params.id, req.user.id);
      res.json({ cashMovement });
    } catch (error) {
      console.error('Cancel cash movement error:', error);
      if (/nicht gefunden/.test(error.message || '')) {
        return res.status(404).json({ error: error.message });
      }
      if (/bereits storniert/.test(error.message || '')) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: 'Fehler beim Stornieren der Kassenbewegung' });
    }
  }
}

module.exports = new CashMovementController();
