const invoiceService = require('../services/invoiceService');
const prisma = require('../utils/prisma');

class InvoiceController {
  // Liste Rechnungen
  async listInvoices(req, res) {
    try {
      const filters = {
        status: req.query.status,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        search: req.query.search
      };
      
      const invoices = await invoiceService.listInvoices(filters);
      
      res.json({
        invoices,
        count: invoices.length
      });
    } catch (error) {
      console.error('List invoices error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Rechnungen' });
    }
  }

  // Einzelne Rechnung
  async getInvoice(req, res) {
    try {
      const { id } = req.params;
      const invoice = await invoiceService.getInvoice(id);
      
      if (!invoice) {
        return res.status(404).json({ error: 'Rechnung nicht gefunden' });
      }
      
      res.json({ invoice });
    } catch (error) {
      console.error('Get invoice error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Rechnung' });
    }
  }

  // Erstelle Rechnung
  async createInvoice(req, res) {
    try {
      const invoice = await invoiceService.createInvoice(req.body, req.user.id);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'CREATE_INVOICE',
          entityType: 'Invoice',
          entityId: invoice.id,
          changes: {
            invoiceNumber: invoice.invoiceNumber,
            amount: invoice.totalAmount
          }
        }
      });
      
      res.status(201).json({
        message: 'Rechnung erfolgreich erstellt',
        invoice
      });
    } catch (error) {
      console.error('Create invoice error:', error);
      res.status(500).json({ error: 'Fehler beim Erstellen der Rechnung' });
    }
  }

  // Aktualisiere Status
  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      const invoice = await invoiceService.updateInvoiceStatus(id, status, req.user.id);
      
      res.json({
        message: 'Rechnungsstatus aktualisiert',
        invoice
      });
    } catch (error) {
      console.error('Update invoice status error:', error);
      res.status(500).json({ error: 'Fehler beim Aktualisieren des Status' });
    }
  }

  // Download Rechnung als PDF
  async downloadPDF(req, res) {
    try {
      const { id } = req.params;
      const result = await invoiceService.generateInvoicePDF(id);
      
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (error) {
      console.error('Download invoice PDF error:', error);
      res.status(500).json({ error: 'Fehler beim Erstellen der PDF' });
    }
  }
}

module.exports = new InvoiceController();
