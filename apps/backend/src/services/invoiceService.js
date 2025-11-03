const prisma = require('../utils/prisma');
const PDFDocument = require('pdfkit');
const { Prisma } = require('@prisma/client'); // Wichtig für Decimal-Typen

class InvoiceService {
  constructor() {
    // ... (falls du hier Logik hattest)
  }

  // Generiere nächste Rechnungsnummer
  async generateInvoiceNumber() {
    const currentYear = new Date().getFullYear();
    
    const lastInvoice = await prisma.invoice.findFirst({
      where: {
        invoiceNumber: {
          startsWith: `${currentYear}-`
        }
      },
      orderBy: {
        invoiceNumber: 'desc'
      }
    });

    let nextNumber = 1;
    if (lastInvoice) {
      const parts = lastInvoice.invoiceNumber.split('-');
      if (parts.length === 2) {
        nextNumber = parseInt(parts[1]) + 1;
      }
    }

    return `${currentYear}-${nextNumber.toString().padStart(4, '0')}`;
  }


  // --- STARK VERBESSERT: Verwendet jetzt Transaktion & bucht Lagerbestand ---
async createInvoice(data, userId) {
    const { items = [], ...invoiceData } = data;

    if (!(invoiceData.customerId || (invoiceData.customerName && invoiceData.customerName.trim()))) {
      throw new Error('Kunde fehlt');
    }
    if (!items.length) throw new Error('Mindestens eine Position benötigt');

    return prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.generateInvoiceNumber();

      const normalizedItems = items.map((it) => {
        const qty = dNum(it.quantity);
        const unitPrice = dNum(it.pricePerUnit); // Frontend-Feldname beibehalten
        return {
          articleId: it.articleId || null,
          description: String(it.description || '').trim(),
          quantity: qty,
          pricePerUnit: unitPrice,
          totalPrice: qty.mul(unitPrice),
          unit: it.unit || null
        };
      });

      const netAmount = normalizedItems.reduce((s, it) => s.add(it.totalPrice), dNum(0));
      const taxRate = dNum(data.taxRate ?? 0); // Standard 0%
      const totalAmount = netAmount; // keine Steuer

      const invoice = await tx.invoice.create({
        data: {
          ...invoiceData,
          invoiceNumber,
          taxRate,                 // 0
          totalAmount,             // = netAmount
          status: 'DRAFT',
          userId,
          items: { create: normalizedItems }
        },
        include: { items: true }
      });

      // Lagerbestand (nur wenn gewünscht & Artikel gesetzt)
      for (const it of invoice.items) {
        if (it.articleId) {
          await tx.article.update({
            where: { id: it.articleId },
            data: { stock: { decrement: it.quantity } }
          });
          await tx.stockMovement.create({
            data: {
              articleId: it.articleId,
              type: 'SALE',
              quantity: it.quantity.negated(),
              reason: `Ausgangsrechnung ${invoice.invoiceNumber}`
            }
          });
        }
      }

      return invoice;
    });
  }


  // Liste Rechnungen
  async listInvoices(filters = {}) {
    const { status, startDate, endDate, search } = filters;
    const where = {};
    
    if (status) {
      where.status = status;
    }
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { customerName: { contains: search } },
        { description: { contains: search } }
      ];
    }
    
    return await prisma.invoice.findMany({
      where,
      include: {
        customer: true,
        _count: {
          select: {
            items: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }


  // Hole einzelne Rechnung
  async getInvoice(id) {
    return await prisma.invoice.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            article: true
          }
        },
        customer: true,
        user: {
          select: {
            name: true
          }
        },
        transactions: true
      }
    });
  }

  // Aktualisiere Rechnungsstatus
  async updateInvoiceStatus(id, status, userId) {
    const updateData = { status };
    
    if (status === 'PAID') {
      updateData.paidAt = new Date();
    }
    
    const invoice = await prisma.invoice.update({
      where: { id },
      data: updateData
    });
    
    // Audit-Log
    await prisma.auditLog.create({
      data: {
        userId,
        action: `UPDATE_INVOICE_STATUS_${status}`,
        entityType: 'Invoice',
        entityId: id
      }
    });
    
    return invoice;
  }

  // Generiere Rechnung als PDF (Dein Code)
  async generateInvoicePDF(invoiceId) {
    const invoice = await this.getInvoice(invoiceId);
    
    if (!invoice) {
      throw new Error('Rechnung nicht gefunden');
    }
    
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          resolve({
            data: pdfBuffer,
            filename: `Rechnung_${invoice.invoiceNumber}.pdf`,
            mimeType: 'application/pdf'
          });
        });
        
        // Header mit Logo-Platzhalter
        doc.rect(50, 50, 100, 50).stroke();
        doc.text('LOGO', 85, 70);
        
        // Absender
        doc.fontSize(10);
        doc.text('Clubtouch3 e.V.', 200, 50);
        doc.text('Musterstraße 123', 200, 65);
        doc.text('12345 Musterstadt', 200, 80);
        doc.text('info@clubtouch3.de', 200, 95);
        
        // Empfänger
        doc.fontSize(10);
        doc.text(invoice.customerName, 50, 150);
        if (invoice.customerAddress) {
          const addressLines = invoice.customerAddress.split('\n');
          addressLines.forEach((line, index) => {
            doc.text(line, 50, 165 + (index * 15));
          });
        }
        
        // Rechnungsdaten
        doc.fontSize(20);
        doc.text('Rechnung', 50, 250);
        
        doc.fontSize(10);
        doc.text(`Rechnungsnummer: ${invoice.invoiceNumber}`, 350, 250);
        doc.text(`Rechnungsdatum: ${new Date(invoice.createdAt).toLocaleDateString('de-DE')}`, 350, 265);
        doc.text(`Fällig am: ${new Date(invoice.dueDate).toLocaleDateString('de-DE')}`, 350, 280);
        
        // Beschreibung
        if (invoice.description) {
          doc.fontSize(10);
          doc.text(invoice.description, 50, 320, { width: 500 });
        }
        
        // Tabelle Header
        const tableTop = 380;
        doc.fontSize(10);
        doc.text('Pos.', 50, tableTop);
        doc.text('Bezeichnung', 80, tableTop);
        doc.text('Menge', 300, tableTop);
        doc.text('Einzelpreis', 360, tableTop);
        doc.text('Gesamtpreis', 450, tableTop);
        
        // Linie unter Header
        doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
        
        // Positionen
        let yPosition = tableTop + 30;
        invoice.items.forEach((item, index) => {
          doc.text(index + 1, 50, yPosition);
          doc.text(item.description, 80, yPosition, { width: 200 });
          // .toString() hinzugefügt, da item.quantity jetzt ein Decimal ist
          doc.text(item.quantity.toString(), 300, yPosition); 
          // .toFixed(2) hinzugefügt, da item.pricePerUnit jetzt ein Decimal ist
          doc.text(`€ ${item.pricePerUnit.toFixed(2)}`, 360, yPosition);
          // .toFixed(2) hinzugefügt, da item.totalPrice jetzt ein Decimal ist
          doc.text(`€ ${item.totalPrice.toFixed(2)}`, 450, yPosition);
          yPosition += 20;
        });
        
        // Linie über Summen
        doc.moveTo(350, yPosition + 10).lineTo(550, yPosition + 10).stroke();
        
        // Summen
        const netAmount = invoice.items.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0);
        const taxRate = parseFloat(invoice.taxRate);
        const taxAmount = netAmount * taxRate / 100;
        
        yPosition += 25;
        doc.text('Nettobetrag:', 350, yPosition);
        doc.text(`€ ${netAmount.toFixed(2)}`, 450, yPosition);
        
        yPosition += 20;
        doc.text(`MwSt. ${taxRate}%:`, 350, yPosition);
        doc.text(`€ ${taxAmount.toFixed(2)}`, 450, yPosition);
        
        doc.fontSize(12);
        yPosition += 25;
        doc.text('Gesamtbetrag:', 350, yPosition);
        // .toFixed(2) hinzugefügt, da invoice.totalAmount jetzt ein Decimal ist
        doc.text(`€ ${invoice.totalAmount.toFixed(2)}`, 450, yPosition);
        
        // Footer
        doc.fontSize(8);
        doc.text('Bankverbindung: Clubtouch3 e.V. | IBAN: DE12 3456 7890 1234 5678 90 | BIC: DEUTDEXX', 50, 750, { align: 'center' });
        
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = new InvoiceService();
