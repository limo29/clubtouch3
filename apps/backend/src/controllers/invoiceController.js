const invoiceService = require('../services/invoiceService');
const prisma = require('../utils/prisma');
const closedPeriod = require('../utils/closedPeriod');

// Fachliche Fehler (statusCode 400/404/409) mit Meldung, sonst generische 500
function sendError(res, error, fallback, label) {
  if (closedPeriod.sendClosedPeriod(res, error)) return; // abgeschlossenes Geschäftsjahr: 409 mit code/fiscalYear
  if (error && error.statusCode && error.statusCode < 500) return res.status(error.statusCode).json({ error: error.message });
  if (error && error.code === 'P2025') return res.status(404).json({ error: 'Rechnung nicht gefunden' });
  console.error(label, error);
  return res.status(500).json({ error: fallback });
}

class InvoiceController {
  async listInvoices(req, res) {
    try {
      const filters = { status: req.query.status, startDate: req.query.startDate, endDate: req.query.endDate, search: req.query.search };
      const invoices = await invoiceService.listInvoices(filters);
      res.json({ invoices, count: invoices.length });
    } catch (error) { console.error('List invoices error:', error); res.status(500).json({ error: 'Fehler beim Abrufen der Rechnungen' }); }
  }

  async getInvoice(req, res) {
    try {
      const { id } = req.params;
      const invoice = await invoiceService.getInvoice(id);
      if (!invoice) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
      res.json({ invoice });
    } catch (error) { console.error('Get invoice error:', error); res.status(500).json({ error: 'Fehler beim Abrufen der Rechnung' }); }
  }

  async createInvoice(req, res) {
    try {
      const invoice = await invoiceService.createInvoice(req.body, req.user.id);
      await prisma.auditLog.create({ data: { userId: req.user.id, action: 'CREATE_INVOICE', entityType: 'Invoice', entityId: invoice.id, changes: { invoiceNumber: invoice.invoiceNumber, amount: invoice.totalAmount } } });
      res.status(201).json({ message: 'Rechnung erfolgreich erstellt', invoice });
    } catch (error) { sendError(res, error, 'Fehler beim Erstellen der Rechnung', 'Create invoice error:'); }
  }

  async updateStatus(req, res) {
    try {
      const { id } = req.params; const { status, paymentMethod, paidAt } = req.body;
      const invoice = await invoiceService.updateInvoiceStatus(id, status, req.user.id, { paymentMethod, paidAt, confirmClosed: closedPeriod.isConfirmed(req) });
      res.json({ message: 'Rechnungsstatus aktualisiert', invoice });
    } catch (error) { sendError(res, error, 'Fehler beim Aktualisieren des Status', 'Update invoice status error:'); }
  }

  async downloadPDF(req, res) {
    try {
      const { id } = req.params; const result = await invoiceService.generateInvoicePDF(id);
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (error) {
      if (/nicht gefunden/.test(error.message || '')) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
      console.error('Download invoice PDF error:', error); res.status(500).json({ error: 'Fehler beim Erstellen der PDF' });
    }
  }

  // PUT /:id (nur Entwürfe; Audit UPDATE_INVOICE_CONTENT schreibt der Service)
  async updateInvoice(req, res) {
    try {
      const { id } = req.params;
      const updated = await invoiceService.updateInvoice(id, req.body, req.user.id, { confirmClosed: closedPeriod.isConfirmed(req) });
      res.json({ message: 'Rechnung aktualisiert', invoice: updated });
    } catch (err) { sendError(res, err, 'Fehler beim Aktualisieren der Rechnung', 'Update invoice error:'); }
  }

  // DELETE /:id (Storno) bzw. DELETE /:id?hard=true (endgültig, nur Entwurf/storniert)
  async deleteInvoice(req, res) {
    try {
      const { id } = req.params; const hard = String(req.query.hard || '').toLowerCase() === 'true';
      const result = await invoiceService.deleteInvoice(id, req.user.id, { hard, confirmClosed: closedPeriod.isConfirmed(req) });
      res.json(result);
    } catch (err) { sendError(res, err, 'Fehler beim Löschen/Stornieren der Rechnung', 'Delete invoice error:'); }
  }

  async getSettings(req, res) {
    try {
      const settings = await invoiceService.getSettings();
      res.json(settings);
    } catch (e) { console.error('Get settings error:', e); res.status(500).json({ error: 'Fehler beim Laden der Einstellungen' }); }
  }

  async updateSettings(req, res) {
    try {
      if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Nur Admins dürfen Einstellungen ändern' });
      await invoiceService.updateSettings(req.body);
      res.json({ message: 'Einstellungen gespeichert' });
    } catch (e) { console.error('Update settings error:', e); res.status(500).json({ error: 'Fehler beim Speichern der Einstellungen' }); }
  }
}

module.exports = new InvoiceController();