const cashCountService = require('../services/cashCountService');

class CashCountController {
  // GET /api/cash-counts
  async list(req, res) {
    try {
      const cashCounts = await cashCountService.listCounts({ limit: req.query.limit });
      res.json({ cashCounts });
    } catch (error) {
      console.error('List cash counts error:', error);
      res.status(500).json({ error: 'Fehler beim Laden der Kassenzählungen' });
    }
  }

  // GET /api/cash-counts/preview
  async preview(req, res) {
    try {
      const preview = await cashCountService.getPreview();
      res.json(preview);
    } catch (error) {
      console.error('Cash count preview error:', error);
      res.status(500).json({ error: 'Fehler beim Berechnen des Kassen-Solls' });
    }
  }

  // GET /api/cash-counts/latest
  async latest(req, res) {
    try {
      const cashCount = await cashCountService.getLatest();
      res.json({ cashCount: cashCount || null });
    } catch (error) {
      console.error('Latest cash count error:', error);
      res.status(500).json({ error: 'Fehler beim Laden der letzten Kassenzählung' });
    }
  }

  // GET /api/cash-counts/:id
  async getById(req, res) {
    try {
      const cashCount = await cashCountService.getById(req.params.id);
      if (!cashCount) return res.status(404).json({ error: 'Kassenzählung nicht gefunden' });
      res.json({ cashCount });
    } catch (error) {
      console.error('Get cash count error:', error);
      res.status(500).json({ error: 'Fehler beim Laden der Kassenzählung' });
    }
  }

  // POST /api/cash-counts
  async create(req, res) {
    try {
      const { denominations, note } = req.body;
      const cashCount = await cashCountService.createCount({
        denominations, note, userId: req.user.id
      });
      res.status(201).json({ cashCount });
    } catch (error) {
      console.error('Create cash count error:', error);
      const known = /Stückelung|Anzahl für|Benutzer fehlt/.test(error.message || '');
      res.status(known ? 400 : 500).json({
        error: known ? error.message : 'Fehler beim Speichern der Kassenzählung',
        ...(known ? {} : { details: error.message })
      });
    }
  }

  // GET /api/cash-counts/:id/pdf
  async pdf(req, res) {
    try {
      const exportService = require('../services/exportService');
      const result = await exportService.exportCashCountPDF(req.params.id, { createdBy: req.user.name });
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (error) {
      console.error('Cash count PDF error:', error);
      const notFound = /nicht gefunden/.test(error.message || '');
      res.status(notFound ? 404 : 500).json({ error: notFound ? error.message : 'Fehler beim PDF-Export der Kassenzählung' });
    }
  }
}

module.exports = new CashCountController();
