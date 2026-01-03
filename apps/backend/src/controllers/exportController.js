const exportService = require('../services/exportService');
const prisma = require('../utils/prisma');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');

class ExportController {
  // --- NEU: BELEG-NACHWEIS EXPORT (PDF) ---
  async exportProofs(req, res) {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Start- und Enddatum erforderlich' });
      }

      // 1. Rechnungen (Invoices) laden, die einen Nachweis haben
      const invoices = await prisma.purchaseDocument.findMany({
        where: {
          type: 'RECHNUNG',
          documentDate: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
          nachweisUrl: { not: null },
        },
        include: {
          lieferscheine: true, // Auch Lieferscheine laden
        },
        orderBy: { documentDate: 'asc' },
      });

      if (invoices.length === 0) {
        return res.status(404).json({ error: 'Keine Belege mit Nachweis im Zeitraum gefunden.' });
      }

      // 2. PDF erstellen
      const finalPdf = await PDFDocument.create();
      const font = await finalPdf.embedFont(StandardFonts.HelveticaBold);

      for (const inv of invoices) {
        // --- RECHNUNG ---
        const invFile = path.resolve(process.cwd(), inv.nachweisUrl.replace(/^\//, ''));

        if (fs.existsSync(invFile)) {
          const ext = path.extname(invFile).toLowerCase();

          // Trennseite / Header für Rechnung
          const page = finalPdf.addPage([595, 842]); // A4
          const { width, height } = page.getSize();

          page.drawText(`RECHNUNG: ${inv.documentNumber}`, { x: 50, y: height - 50, size: 20, font });
          page.drawText(`Datum: ${format(new Date(inv.documentDate), 'dd.MM.yyyy')}`, { x: 50, y: height - 80, size: 14 });
          page.drawText(`Lieferant: ${inv.supplier}`, { x: 50, y: height - 100, size: 14 });
          page.drawText(`Betrag: ${inv.totalAmount ? Number(inv.totalAmount).toFixed(2) : '0.00'} €`, { x: 50, y: height - 120, size: 14 });

          // Rechnung einfügen
          if (ext === '.pdf') {
            const content = fs.readFileSync(invFile);
            try {
              const srcDoc = await PDFDocument.load(content);
              const indices = srcDoc.getPageIndices();
              const copiedPages = await finalPdf.copyPages(srcDoc, indices);
              copiedPages.forEach((cp) => finalPdf.addPage(cp));
            } catch (e) {
              console.error('Fehler beim Laden von PDF:', invFile, e);
              page.drawText('(Fehler beim Laden des PDF-Nachweises)', { x: 50, y: height - 200, size: 12, color: rgb(1, 0, 0) });
            }
          } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
            const content = fs.readFileSync(invFile);
            let image;
            if (ext === '.png') image = await finalPdf.embedPng(content);
            else image = await finalPdf.embedJpg(content);

            const imgDims = image.scale(1);
            const maxWidth = width - 100;
            const maxHeight = height - 250;

            let scale = 1;
            if (imgDims.width > maxWidth) scale = maxWidth / imgDims.width;
            if (imgDims.height * scale > maxHeight) scale = maxHeight / imgDims.height;

            page.drawImage(image, {
              x: 50,
              y: height - 150 - (imgDims.height * scale),
              width: imgDims.width * scale,
              height: imgDims.height * scale,
            });
          }
        }

        // --- ZUGEHÖRIGE LIEFERSCHEINE ---
        for (const ls of inv.lieferscheine) {
          if (ls.nachweisUrl) {
            const lsFile = path.resolve(process.cwd(), ls.nachweisUrl.replace(/^\//, ''));
            if (fs.existsSync(lsFile)) {
              const ext = path.extname(lsFile).toLowerCase();

              // Trennseite für LS
              const lsPage = finalPdf.addPage([595, 842]);
              const { height: h2 } = lsPage.getSize();
              lsPage.drawText(`LIEFERSCHEIN: ${ls.documentNumber}`, { x: 50, y: h2 - 50, size: 16, font });
              lsPage.drawText(`Gehört zu Rechnung: ${inv.documentNumber}`, { x: 50, y: h2 - 75, size: 12 });

              if (ext === '.pdf') {
                const content = fs.readFileSync(lsFile);
                try {
                  const srcDoc = await PDFDocument.load(content);
                  const copiedPages = await finalPdf.copyPages(srcDoc, srcDoc.getPageIndices());
                  copiedPages.forEach((cp) => finalPdf.addPage(cp));
                } catch (e) {
                  // ignore
                }
              } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
                const content = fs.readFileSync(lsFile);
                let image;
                if (ext === '.png') image = await finalPdf.embedPng(content);
                else image = await finalPdf.embedJpg(content);

                const imgDims = image.scale(1);
                const maxWidth = lsPage.getSize().width - 100;
                const maxHeight = h2 - 200;
                let scale = 1;
                if (imgDims.width > maxWidth) scale = maxWidth / imgDims.width;
                if (imgDims.height * scale > maxHeight) scale = maxHeight / imgDims.height;

                lsPage.drawImage(image, {
                  x: 50,
                  y: h2 - 120 - (imgDims.height * scale),
                  width: imgDims.width * scale,
                  height: imgDims.height * scale,
                });
              }
            }
          }
        }
      }

      const pdfBytes = await finalPdf.save();

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Belege_${startDate}_bis_${endDate}.pdf"`);
      res.send(Buffer.from(pdfBytes));

    } catch (error) {
      console.error('Fehler beim Beleg-Export:', error);
      res.status(500).json({ error: 'Beleg-Export fehlgeschlagen' });
    }
  }

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
      try {
        require('fs').writeFileSync('error_debug.txt', error.stack || String(error));
      } catch (fsErr) { console.error('Log write failed', fsErr); }
      res.status(500).json({ error: 'Fehler beim Export der Transaktionen', details: error.message });
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
      const startHour = req.query.startHour ? parseInt(req.query.startHour) : 6;
      const result = await exportService.exportDailySummaryPDF(date, startHour);

      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'EXPORT_DAILY_SUMMARY',
          entityType: 'Export',
          entityId: 'daily-summary',
          changes: { date: date.toISOString(), startHour }
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

  // Vorschau Tagesabschluss (JSON)
  async getDailySummaryPreview(req, res) {
    try {
      const date = req.query.date ? new Date(req.query.date) : new Date();
      const startHour = req.query.startHour ? parseInt(req.query.startHour) : 6;

      const transactionService = require('../services/transactionService');
      const data = await transactionService.getDailySummary(date, startHour);

      res.json(data);
    } catch (error) {
      console.error('Preview daily summary error:', error);
      res.status(500).json({ error: 'Fehler beim Laden der Vorschau' });
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
  async exportEUR(req, res) {
    try {
      try { require('fs').appendFileSync('C:/Users/elias/.gemini/antigravity/brain/af9754be-7cfa-46f3-9ee9-9accd4ec3d7a/backend_error.log', '\n[DEBUG] exportEUR hit\n'); } catch (e) { }
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) return res.status(400).json({ error: 'startDate und endDate erforderlich' });
      const result = await exportService.exportEURPDF(startDate, endDate);
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (e) {
      console.error('Export EUR error', e);
      try {
        const fs = require('fs');
        const path = 'C:/Users/elias/.gemini/antigravity/brain/af9754be-7cfa-46f3-9ee9-9accd4ec3d7a/backend_error.log';
        fs.appendFileSync(path, `\n[${new Date().toISOString()}] Export EUR Error:\n${e.stack || e}\n`);
      } catch (logErr) { console.error(logErr); }
      res.status(500).json({ error: 'Fehler beim EÜR-Export', details: e.message });
    }
  }

}

module.exports = new ExportController();
