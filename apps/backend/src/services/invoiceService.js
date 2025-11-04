const prisma = require('../utils/prisma');
const PDFDocument = require('pdfkit');
const { Prisma } = require('@prisma/client');
const QRCode = require('qrcode');

// .env Konfig
const PAYEE_NAME = process.env.INVOICE_PAYEE_NAME || 'Clubtouch3 e.V.';
const IBAN = process.env.INVOICE_IBAN || 'DE12345678901234567890';
const BIC = process.env.INVOICE_BIC || 'DEUTDEFFXXX';
const REM_REF_PREFIX = process.env.INVOICE_REF_PREFIX || 'RE';

const d = (v) => new Prisma.Decimal(v ?? 0);

// Hilfen für Bestandsbuchungen
async function reverseStockForItems(tx, invoice, reason = '') {
  for (const it of invoice.items) {
    if (!it.articleId) continue;
    await tx.article.update({ where: { id: it.articleId }, data: { stock: { increment: it.quantity } } });
    await tx.stockMovement.create({ data: { articleId: it.articleId, type: 'CORRECTION', quantity: it.quantity, reason: reason || `Rechnung ${invoice.invoiceNumber} Änderung/Storno` } });
  }
}
async function applyStockForItems(tx, invoiceNumber, items) {
  for (const it of items) {
    if (!it.articleId) continue;
    await tx.article.update({ where: { id: it.articleId }, data: { stock: { decrement: it.quantity } } });
    await tx.stockMovement.create({ data: { articleId: it.articleId, type: 'SALE', quantity: d(it.quantity).negated(), reason: `Ausgangsrechnung ${invoiceNumber}` } });
  }
}

class InvoiceService {
  async generateInvoiceNumber() {
    const currentYear = new Date().getFullYear();
    const last = await prisma.invoice.findFirst({ where: { invoiceNumber: { startsWith: `${currentYear}-` } }, orderBy: { invoiceNumber: 'desc' } });
    let n = 1; if (last) { const p = last.invoiceNumber.split('-'); if (p.length === 2) n = parseInt(p[1], 10) + 1; }
    return `${currentYear}-${String(n).padStart(4, '0')}`;
  }

  async createInvoice(data, userId) {
    const { items = [], ...hdr } = data;
    if (!(hdr.customerId || (hdr.customerName && hdr.customerName.trim()))) throw new Error('Kunde fehlt');
    if (!items.length) throw new Error('Mindestens eine Position benötigt');

    return prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.generateInvoiceNumber();
      const norm = items.map((it) => { const q = d(it.quantity); const pu = d(it.pricePerUnit); return { articleId: it.articleId || null, description: String(it.description || '').trim(), quantity: q, pricePerUnit: pu, totalPrice: q.mul(pu) }; });
      const totalAmount = norm.reduce((s, it) => s.add(it.totalPrice), d(0));

      const inv = await tx.invoice.create({ data: { ...hdr, invoiceNumber, taxRate: d(0), totalAmount, status: 'DRAFT', userId, items: { create: norm } }, include: { items: true } });
      await applyStockForItems(tx, inv.invoiceNumber, inv.items);
      return inv;
    });
  }

  async listInvoices(filters = {}) {
    const { status, startDate, endDate, search } = filters; const where = {};
    if (status) where.status = status;
    if (startDate || endDate) { where.createdAt = {}; if (startDate) where.createdAt.gte = new Date(startDate); if (endDate) where.createdAt.lte = new Date(endDate); }
    if (search) where.OR = [{ invoiceNumber: { contains: search } }, { customerName: { contains: search } }, { description: { contains: search } }];
    return prisma.invoice.findMany({ where, include: { customer: true, _count: { select: { items: true } } }, orderBy: { createdAt: 'desc' } });
  }

  async getInvoice(id) { return prisma.invoice.findUnique({ where: { id }, include: { items: { include: { article: true } }, customer: true, user: { select: { name: true } }, transactions: true } }); }

  async updateInvoiceStatus(id, status, userId) {
    const data = { status }; if (status === 'PAID') data.paidAt = new Date();
    const inv = await prisma.invoice.update({ where: { id }, data });
    await prisma.auditLog.create({ data: { userId, action: `UPDATE_INVOICE_STATUS_${status}`, entityType: 'Invoice', entityId: id } });
    return inv;
  }

  buildSepaEpcQr({ amount, remittance }) {
    const amt = Number(amount || 0).toFixed(2);
    return ['BCD', '001', '1', 'SCT', BIC, PAYEE_NAME, IBAN, `EUR${amt}`, '', '', (remittance || '').slice(0, 140)].join('');
  }
  drawTableHeader(doc, y) {
    doc.fontSize(10);
    doc.text('Pos.', 50, y);
    doc.text('Bezeichnung', 80, y);
    doc.text('Menge', 300, y);
    doc.text('Einzelpreis', 360, y);
    doc.text('Gesamtpreis', 450, y);
    doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke();
  }

  // Hilfsfunktion: Footer + SEPA QR zeichnen
  async drawFooterWithQr(doc, totalAmount, invoiceNumber) {
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const marginB = doc.page.margins.bottom || 50;

    const footerY = pageH - marginB - 30;     // sicher innerhalb der Seite
    doc.fontSize(8);
    doc.text(`Bank: ${PAYEE_NAME} | IBAN: ${IBAN} | BIC: ${BIC}`,
      50, footerY, { align: 'center', width: pageW - 100 });

    // QR rechts unten
    const remRef = `${REM_REF_PREFIX}-${invoiceNumber}`;
    const epc = this.buildSepaEpcQr({ amount: totalAmount, remittance: remRef });
    const qrPng = await QRCode.toBuffer(epc, { type: 'png', errorCorrectionLevel: 'M', margin: 1, scale: 4 });
    const qrWidth = 72; // 1 inch
    const qrX = pageW - (doc.page.margins.right || 50) - qrWidth;
    const qrY = footerY - qrWidth - 6;
    doc.image(qrPng, qrX, qrY, { width: qrWidth });
    doc.fontSize(7).text('SEPA QR', qrX, footerY + 12, { width: qrWidth, align: 'center' });
  }
  // PDF (mit korrekt gesteuertem Seitenumbruch)
  async generateInvoicePDF(invoiceId) {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) throw new Error('Rechnung nicht gefunden');

    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve({
          data: Buffer.concat(chunks),
          filename: `Rechnung_${invoice.invoiceNumber}_${invoice.customerName.replace(/[^a-zA-Z0-9_-]/g, '')}.pdf`,
          mimeType: 'application/pdf'
        }));

        // Header
        doc.rect(50, 50, 100, 50).stroke();
        doc.text('LOGO', 85, 70);

        doc.fontSize(10);
        doc.text(PAYEE_NAME, 200, 50);
        doc.text('Musterstraße 123', 200, 65);
        doc.text('12345 Musterstadt', 200, 80);
        doc.text('info@clubtouch3.de', 200, 95);

        // Empfänger
        doc.fontSize(10);
        doc.text(invoice.customerName, 50, 150);
        if (invoice.customerAddress) {
          String(invoice.customerAddress).split('\n').forEach((ln, i) => doc.text(ln, 50, 165 + i * 15));
        }

        // Titel + Meta
        doc.fontSize(20).text('Rechnung', 50, 250);
        doc.fontSize(10);
        doc.text(`Rechnungsnummer: ${invoice.invoiceNumber}`, 350, 250);
        doc.text(`Rechnungsdatum: ${new Date(invoice.createdAt).toLocaleDateString('de-DE')}`, 350, 265);
        doc.text(`Fällig am: ${new Date(invoice.dueDate).toLocaleDateString('de-DE')}`, 350, 280);

        if (invoice.description) doc.text(invoice.description, 50, 320, { width: 500 });

        // Tabelle
        let y = 380;
        this.drawTableHeader(doc, y);
        y += 30;

        const pageBottom = () => doc.page.height - (doc.page.margins.bottom || 50);

        invoice.items.forEach((item, idx) => {
          // Seitenumbruch bei Bedarf
          if (y > pageBottom() - 120) {
            doc.addPage();
            y = 50; // obere Marge
            this.drawTableHeader(doc, y);
            y += 30;
          }
          doc.text(idx + 1, 50, y);
          doc.text(item.description, 80, y, { width: 200 });
          doc.text(String(item.quantity), 300, y);
          doc.text(`€ ${Number(item.pricePerUnit).toFixed(2)}`, 360, y);
          doc.text(`€ ${Number(item.totalPrice).toFixed(2)}`, 450, y);
          y += 20;
        });

        // Summen
        if (y > pageBottom() - 80) { doc.addPage(); y = 80; }
        doc.moveTo(350, y + 10).lineTo(550, y + 10).stroke();

        const net = invoice.items.reduce((s, i) => s + Number(i.totalPrice), 0);
        const taxRate = 0, tax = 0;

        y += 25;
        doc.text('Nettobetrag:', 350, y);
        doc.text(`€ ${net.toFixed(2)}`, 450, y);

        y += 20;
        doc.text(`MwSt. ${taxRate}%:`, 350, y);
        doc.text(`€ ${tax.toFixed(2)}`, 450, y);

        doc.fontSize(12);
        y += 25;
        doc.text('Gesamtbetrag:', 350, y);
        doc.text(`€ ${Number(invoice.totalAmount).toFixed(2)}`, 450, y);

        // Footer + QR **unten auf der aktuellen Seite**
        await this.drawFooterWithQr(doc, invoice.totalAmount, invoice.invoiceNumber);

        doc.end();
      } catch (e) { reject(e); }
    });
  }
  // **NEU**: Rechnung bearbeiten (nur DRAFT)
  async updateInvoice(id, data, userId) {
    const { items = [], ...hdr } = data;
    return prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({ where: { id }, include: { items: true } });
      if (!existing) throw new Error('Rechnung nicht gefunden');
      if (existing.status !== 'DRAFT') throw new Error('Nur Entwürfe können bearbeitet werden');
      if (!items.length) throw new Error('Mindestens eine Position benötigt');

      await reverseStockForItems(tx, existing, `Update von Rechnung ${existing.invoiceNumber}`);
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });

      const norm = items.map((it) => { const q = d(it.quantity); const pu = d(it.pricePerUnit); return { articleId: it.articleId || null, description: String(it.description || '').trim(), quantity: q, pricePerUnit: pu, totalPrice: q.mul(pu) }; });
      const totalAmount = norm.reduce((s, it) => s.add(it.totalPrice), d(0));

      const updated = await tx.invoice.update({ where: { id }, data: { ...hdr, totalAmount, items: { create: norm } }, include: { items: true } });
      await applyStockForItems(tx, updated.invoiceNumber, updated.items);

      await tx.auditLog.create({ data: { userId, action: 'UPDATE_INVOICE_CONTENT', entityType: 'Invoice', entityId: id, changes: { updatedHeader: Object.keys(hdr), items: norm.length } } });
      return updated;
    });
  }

  // **NEU**: Löschen/Stornieren
  async deleteInvoice(id, userId, { hard = false } = {}) {
    return prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id }, include: { items: true } });
      if (!inv) throw new Error('Rechnung nicht gefunden');
      if (inv.status === 'PAID' && hard) throw new Error('Bezahlt: endgültiges Löschen nicht erlaubt');

      await reverseStockForItems(tx, inv, `Storno Rechnung ${inv.invoiceNumber}`);

      if (hard) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
        await tx.invoice.delete({ where: { id } });
        await tx.auditLog.create({ data: { userId, action: 'DELETE_INVOICE_HARD', entityType: 'Invoice', entityId: id } });
        return { message: 'Rechnung endgültig gelöscht' };
      }

      const cancelled = await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.auditLog.create({ data: { userId, action: 'CANCEL_INVOICE', entityType: 'Invoice', entityId: id } });
      return { message: 'Rechnung storniert', invoice: cancelled };
    });
  }
}

module.exports = new InvoiceService();