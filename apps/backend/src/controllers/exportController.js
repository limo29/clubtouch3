const exportService = require('../services/exportService');
const prisma = require('../utils/prisma');

class ExportController {
  // Export Transaktionen als CSV
  async exportTransactions(req, res) {
    try {
      const filters = {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        customerId: req.query.customerId,
        paymentMethod: req.query.paymentMethod
      };
      
      const result = await exportService.exportTransactionsCSV(filters);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'EXPORT_TRANSACTIONS',
          entityType: 'Export',
          entityId: 'transactions',
          changes: filters
        }
      });
      
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (error) {
      console.error('Export transactions error:', error);
      res.status(500).json({ error: 'Fehler beim Export der Transaktionen' });
    }
  }
  
  // Export Bestand als CSV
  async exportInventory(req, res) {
    try {
      const result = await exportService.exportInventoryCSV();
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'EXPORT_INVENTORY',
          entityType: 'Export',
          entityId: 'inventory'
        }
      });
      
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (error) {
      console.error('Export inventory error:', error);
      res.status(500).json({ error: 'Fehler beim Export des Bestands' });
    }
  }
  
  // Export Kunden als CSV
  async exportCustomers(req, res) {
    try {
      const result = await exportService.exportCustomersCSV();
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'EXPORT_CUSTOMERS',
          entityType: 'Export',
          entityId: 'customers'
        }
      });
      
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (error) {
      console.error('Export customers error:', error);
      res.status(500).json({ error: 'Fehler beim Export der Kunden' });
    }
  }
  
  // Export Tagesabschluss als PDF
  async exportDailySummary(req, res) {
    try {
      const date = req.query.date ? new Date(req.query.date) : new Date();
      const result = await exportService.exportDailySummaryPDF(date);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'EXPORT_DAILY_SUMMARY',
          entityType: 'Export',
          entityId: 'daily-summary',
          changes: { date: date.toISOString() }
        }
      });
      
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (error) {
      console.error('Export daily summary error:', error);
      res.status(500).json({ error: 'Fehler beim Export des Tagesabschlusses' });
    }
  }
  
  // Export Monatsbericht als PDF
  async exportMonthlySummary(req, res) {
    try {
      const { year, month } = req.query;
      
      if (!year || !month) {
        return res.status(400).json({ error: 'Jahr und Monat erforderlich' });
      }
      
      const result = await exportService.exportMonthlySummaryPDF(
        parseInt(year), 
        parseInt(month)
      );
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'EXPORT_MONTHLY_SUMMARY',
          entityType: 'Export',
          entityId: 'monthly-summary',
          changes: { year, month }
        }
      });
      
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (error) {
      console.error('Export monthly summary error:', error);
      res.status(500).json({ error: 'Fehler beim Export des Monatsberichts' });
    }
  }
  
  // Export Kontoauszug als PDF
  async exportCustomerStatement(req, res) {
    try {
      const { customerId } = req.params;
      const { startDate, endDate } = req.query;
      
      // Default: Letzter Monat
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const result = await exportService.exportCustomerStatementPDF(customerId, start, end);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'EXPORT_CUSTOMER_STATEMENT',
          entityType: 'Export',
          entityId: customerId,
          changes: { 
            startDate: start.toISOString(), 
            endDate: end.toISOString() 
          }
        }
      });
      
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (error) {
      console.error('Export customer statement error:', error);
      res.status(500).json({ error: 'Fehler beim Export des Kontoauszugs' });
    }
  }
  
  // Liste verfügbare Exporte
  async listAvailableExports(req, res) {
    try {
      const exports = [
        {
          id: 'transactions',
          name: 'Transaktionen',
          description: 'Alle Verkaufstransaktionen als CSV',
          format: 'CSV',
          parameters: ['startDate', 'endDate', 'customerId', 'paymentMethod']
        },
        {
          id: 'inventory',
          name: 'Bestand',
          description: 'Aktueller Artikelbestand als CSV',
          format: 'CSV',
          parameters: []
        },
        {
          id: 'customers',
          name: 'Kundenliste',
          description: 'Alle Kunden mit Guthaben als CSV',
          format: 'CSV',
          parameters: []
        },
        {
          id: 'daily-summary',
          name: 'Tagesabschluss',
          description: 'Detaillierter Tagesbericht als PDF',
          format: 'PDF',
          parameters: ['date']
        },
        {
          id: 'monthly-summary',
          name: 'Monatsbericht',
          description: 'Zusammenfassung eines Monats als PDF',
          format: 'PDF',
          parameters: ['year', 'month']
        },
        {
          id: 'customer-statement',
          name: 'Kontoauszug',
          description: 'Kontobewegungen eines Kunden als PDF',
          format: 'PDF',
          parameters: ['customerId', 'startDate', 'endDate']
        }
      ];
      
      res.json({ exports });
    } catch (error) {
      console.error('List exports error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Export-Liste' });
    }
  }
}

module.exports = new ExportController();
