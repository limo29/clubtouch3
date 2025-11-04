const accountingService = require('../services/accountingService');
const exportService = require('../services/exportService'); // für PDF

class AccountingController {
  async profitLoss(req, res) {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) return res.status(400).json({ error: 'startDate und endDate erforderlich' });
      const data = await accountingService.getProfitLoss(startDate, endDate);
      res.json(data);
    } catch (e) {
      console.error('profitLoss error', e);
      res.status(500).json({ error: 'Fehler bei EÜR' });
    }
  }

  async listFiscalYears(req, res) {
    try {
      const list = await accountingService.listFiscalYears();
      res.json({ fiscalYears: list });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Fehler bei Geschäftsjahren' });
    }
  }

  async createFiscalYear(req, res) {
    try {
      const { name, startDate, endDate } = req.body;
      const fy = await accountingService.createFiscalYear({ name, startDate, endDate });
      res.status(201).json({ fiscalYear: fy });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Fehler beim Anlegen des Geschäftsjahres' });
    }
  }

  async closeFiscalYear(req, res) {
    try {
      const { id } = req.params;
      const { cashOnHand, bankAccounts, physicalInventory } = req.body;
      const payload = await accountingService.closeFiscalYear(id, {
        cashOnHand,
        bankAccounts,
        physicalInventory
      });
      res.json(payload);
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: e.message || 'Fehler beim Abschluss' });
    }
  }

  // PDF: Abschlussbericht für Geschäftsjahr
  async yearEndReportPDF(req, res) {
    try {
      const { id } = req.params;
      const result = await exportService.exportYearEndReportPDF(id);
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Fehler beim PDF-Export' });
    }
  }
    async fiscalYearPreview(req, res) {
    try {
      const { id } = req.params;
      const preview = await accountingService.getFiscalYearPreview(id);
      res.json({ preview });
    } catch (e) {
      console.error('fiscalYearPreview error', e);
      res.status(400).json({ error: e.message || 'Fehler bei der Vorschau' });
    }
  }

}

module.exports = new AccountingController();
