const accountingService = require('../services/accountingService');
const receiptService = require('../services/receiptService');
const { parseLocalDate, endOfLocalDay } = require('../utils/businessDay');
const exportService = require('../services/exportService'); // für PDF
const prisma = require('../utils/prisma');
const closedPeriod = require('../utils/closedPeriod');

const bankBalanceHandlers = {
  async listBankBalances(req, res) {
    try { res.json(await accountingService.listBankBalances()); }
    catch (e) { console.error('List bank balances error:', e); res.status(500).json({ error: 'Kontostände konnten nicht geladen werden' }); }
  },
  async addBankBalance(req, res) {
    try {
      const { date, isOpening, accounts, note } = req.body || {};
      const row = await accountingService.addBankBalance({ date, isOpening: isOpening === true || isOpening === 'true', accounts, note, userId: req.user.id, confirmClosed: closedPeriod.isConfirmed(req) });
      res.status(201).json({ bankBalance: row });
    } catch (e) {
      if (closedPeriod.sendClosedPeriod(res, e)) return;
      res.status(400).json({ error: e.message });
    }
  },
  async deleteBankBalance(req, res) {
    try { await accountingService.deleteBankBalance(req.params.id, req.user.id, { confirmClosed: closedPeriod.isConfirmed(req) }); res.json({ ok: true }); }
    catch (e) {
      if (closedPeriod.sendClosedPeriod(res, e)) return;
      res.status(e.code === 'P2025' ? 404 : 400).json({ error: e.code === 'P2025' ? 'Kontostand nicht gefunden' : e.message });
    }
  },
};

// Zeitraum aus der URL: beide Daten lesbar, plausibles Jahr, Start nicht nach Ende
const validRange = (startDate, endDate) => {
  const s = parseLocalDate(startDate);
  const e = parseLocalDate(endDate);
  const ok = (d) => d && !Number.isNaN(d.getTime()) && d.getFullYear() >= 1990 && d.getFullYear() <= 2200;
  return ok(s) && ok(e) && s <= e;
};

class AccountingController {
  async profitLoss(req, res) {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) return res.status(400).json({ error: 'startDate und endDate erforderlich' });
      if (!validRange(startDate, endDate)) return res.status(400).json({ error: 'Ungültiger Zeitraum' });
      const data = await accountingService.getProfitLoss(startDate, endDate);
      res.json(data);
    } catch (e) {
      console.error('profitLoss error', e);
      res.status(500).json({ error: 'Fehler bei EÜR' });
    }
  }

  // GET /bank-reconciliation?startDate&endDate
  async bankReconciliation(req, res) {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) return res.status(400).json({ error: 'startDate und endDate erforderlich' });
      if (!validRange(startDate, endDate)) return res.status(400).json({ error: 'Ungültiger Zeitraum' });
      const data = await accountingService.getBankReconciliation(startDate, endDate);
      res.json({ bankReconciliation: data });
    } catch (e) {
      console.error('bankReconciliation error', e);
      res.status(500).json({ error: 'Fehler bei der Bank-Abstimmung' });
    }
  }

  // GET /fiscal-years/:id/bank-reconciliation
  async fiscalYearBankReconciliation(req, res) {
    try {
      const { id } = req.params;
      const fy = await prisma.fiscalYear.findUnique({ where: { id }, include: { report: { select: { bankAccountsJson: true, detailsJson: true } } } });
      if (!fy) return res.status(404).json({ error: 'Geschäftsjahr nicht gefunden.' });
      // Geschlossen: eingefrorener Snapshot (falls vorhanden), sonst live
      const frozen = fy.closed && fy.report && fy.report.detailsJson && fy.report.detailsJson.bankReconciliation;
      const data = frozen
        ? fy.report.detailsJson.bankReconciliation
        : await accountingService.getBankReconciliation(fy.startDate, fy.endDate);
      res.json({
        fiscalYear: { id: fy.id, name: fy.name, startDate: fy.startDate, endDate: fy.endDate, closed: fy.closed },
        frozen: !!frozen,
        bankReconciliation: data
      });
    } catch (e) {
      console.error('fiscalYearBankReconciliation error', e);
      res.status(500).json({ error: 'Fehler bei der Bank-Abstimmung' });
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
      const known = /erforderlich|Ungültiges Datum|liegt vor|überschneidet/.test(e.message || '');
      res.status(known ? 400 : 500).json({ error: known ? e.message : 'Fehler beim Anlegen des Geschäftsjahres' });
    }
  }

  async closeFiscalYear(req, res) {
    try {
      const { id } = req.params;
      // cashOnHand wird nicht mehr manuell übernommen: Der Kassenbestand kommt aus der
      // letzten Kassenzählung im Geschäftsjahr (optional explizit per cashCountId).
      const { bankAccounts, physicalInventory, cashCountId } = req.body;
      const payload = await accountingService.closeFiscalYear(id, {
        bankAccounts,
        physicalInventory,
        cashCountId
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
      const result = await exportService.exportYearEndReportPDF(id, { createdBy: req.user.name });
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

  // GET /fiscal-years/:id/receipts
  async fiscalYearReceipts(req, res) {
    try {
      const { id } = req.params;
      const fy = await prisma.fiscalYear.findUnique({ where: { id } });
      if (!fy) return res.status(404).json({ error: 'Geschäftsjahr nicht gefunden.' });
      const start = parseLocalDate(fy.startDate);
      const end   = endOfLocalDay(fy.endDate);
      const result = await receiptService.listReceipts(start, end);
      res.json({
        fiscalYear: { id: fy.id, name: fy.name, startDate: fy.startDate, endDate: fy.endDate, closed: fy.closed },
        ...result
      });
    } catch (e) {
      console.error('fiscalYearReceipts error', e);
      res.status(500).json({ error: 'Fehler beim Laden der Belege.' });
    }
  }

  // GET /fiscal-years/:id/receipts.zip
  async fiscalYearReceiptsZip(req, res) {
    try {
      const { id } = req.params;
      const fy = await prisma.fiscalYear.findUnique({ where: { id } });
      if (!fy) return res.status(404).json({ error: 'Geschäftsjahr nicht gefunden.' });
      const start = parseLocalDate(fy.startDate);
      const end   = endOfLocalDay(fy.endDate);
      const { stream, filename } = await receiptService.buildReceiptZip(start, end, {
        name: fy.name,
        createdBy: req.user ? req.user.name : ''
      });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      stream.on('error', (err) => {
        console.error('ZIP-Stream-Fehler (FiscalYear)', err);
        if (!res.headersSent) res.status(500).json({ error: 'ZIP-Fehler' });
        else res.end();
      });
      stream.pipe(res);
    } catch (e) {
      console.error('fiscalYearReceiptsZip error', e);
      res.status(500).json({ error: 'Fehler beim Erstellen des ZIP.' });
    }
  }

}

module.exports = Object.assign(new AccountingController(), bankBalanceHandlers);
