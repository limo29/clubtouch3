const prisma = require('../utils/prisma');
const { CUSTOMER_BASIC_SELECT } = require('../utils/customerSelect');
const PDFDocument = require('pdfkit');
const { Prisma } = require('@prisma/client');
const QRCode = require('qrcode');
const { parseLocalDate, endOfLocalDay } = require('../utils/businessDay');
const { nextNumber, maxFromNumbers, withNumberRetry } = require('../utils/numberSequence');
const cashCountService = require('./cashCountService');
const closedPeriod = require('../utils/closedPeriod');
const { fmtDate, fmtEUR } = closedPeriod;

/*
 * Abgeschlossene Geschäftsjahre (utils/closedPeriod): maßgeblich sind das Zahldatum (EÜR, Kasse, Bank)
 * alt/neu und das Rechnungsdatum (createdAt: Forderungen, Bestand) bei Bearbeiten, Storno und Löschen.
 * Eine Vorjahresrechnung im neuen Jahr als bezahlt zu markieren betrifft das abgeschlossene Jahr nicht.
 */
const STATUS_LABEL = { DRAFT: 'Entwurf', SENT: 'Versendet', PAID: 'Bezahlt', CANCELLED: 'Storniert' };
const PAY_LABEL = { CASH: 'bar', TRANSFER: 'Überweisung' };
const invLabel = (inv) => `Kundenrechnung ${inv.invoiceNumber} (${inv.customerName})`;
const paidDateOf = (inv) => (inv && inv.status === 'PAID' ? inv.paidAt : null);
// Einnahme dieser Rechnung im Jahr fy (EÜR): Betrag, wenn bezahlt und Zahldatum im Jahr
const incomeIn = (inv, fy) => (paidDateOf(inv) && closedPeriod.inYear(inv.paidAt, fy) ? Number(inv.totalAmount || 0) : 0);

const fs = require('fs');
const path = require('path');

// .env Konfig (Fallback)
// Absender = der Clubraum, Kontoinhaber = der Trägerverein. BIC und E-Mail sind optional
// (leer = wird nicht gedruckt); alles ist unter Kundenrechnungen → Einstellungen änderbar.
const DEFAULT_CONFIG = {
  INVOICE_SENDER_NAME: process.env.INVOICE_SENDER_NAME || 'Clubraum',
  INVOICE_PAYEE_NAME: process.env.INVOICE_PAYEE_NAME || 'KJG ST. MARTIN AMBERG',
  INVOICE_IBAN: process.env.INVOICE_IBAN || 'DE95752500000200230936',
  INVOICE_BIC: process.env.INVOICE_BIC || '',
  INVOICE_REF_PREFIX: process.env.INVOICE_REF_PREFIX || 'RE',
  INVOICE_ADDRESS_STREET: 'Unteres Apothekergässchen 1a',
  INVOICE_ADDRESS_CITY: '92224 Amberg',
  INVOICE_EMAIL: ''
};

// Logo wie in den Berichten; fehlt die Datei, wird ohne Logo gedruckt
let LOGO_BUFFER = null;
try { LOGO_BUFFER = fs.readFileSync(path.join(__dirname, '..', 'assets', 'logo.png')); } catch (_) { LOGO_BUFFER = null; }
const fmtIban = (iban) => String(iban || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();

const STATUSES = ['DRAFT', 'SENT', 'PAID', 'CANCELLED'];

const d = (v) => new Prisma.Decimal(v ?? 0);

// Fachlicher Fehler: Controller antwortet mit statusCode und dieser Meldung
function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.userFacing = true;
  return err;
}
const badRequest = (message) => httpError(400, message);
const CONFLICT_MSG = 'Die Rechnung wurde gerade anderweitig geändert. Bitte neu laden und erneut versuchen.';

/** Zahl aus Eingabe (Number oder String, Komma erlaubt); ungültig -> NaN */
function parseNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || !v.trim()) return NaN;
  return Number(v.trim().replace(',', '.'));
}

const optText = (v, field, max) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string') throw badRequest(`${field} muss Text sein`);
  const t = v.trim();
  if (t.length > max) throw badRequest(`${field} darf höchstens ${max} Zeichen lang sein`);
  return t || null;
};

/*
 * Bestand und Rechnungsstatus: Die Artikelpositionen sind genau dann vom Bestand abgebucht,
 * wenn der Status nicht CANCELLED ist. Anlegen bucht ab, Storno (PATCH CANCELLED oder DELETE)
 * bucht genau einmal zurück, endgültiges Löschen eines Entwurfs bucht zurück, endgültiges
 * Löschen einer stornierten Rechnung bucht nichts mehr. Eine stornierte Rechnung kann nicht
 * wieder geöffnet werden. Jeder Statuswechsel ist ein bedingtes Update auf den alten Status
 * (updateMany where status = alt); parallele Anfragen buchen so nie doppelt.
 */
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

/**
 * Positionen prüfen und normalisieren (Menge > 0, Preis >= 0, Artikel vorhanden, Bezeichnung).
 * Liefert [{ articleId, description, quantity, pricePerUnit, totalPrice }] als Decimal.
 */
async function normalizeItems(tx, items) {
  if (!Array.isArray(items) || items.length === 0) throw badRequest('Mindestens eine Position benötigt');
  if (items.length > 500) throw badRequest('Zu viele Positionen (höchstens 500)');
  const articleIds = [...new Set(items.map((it) => it && it.articleId).filter(Boolean).map(String))];
  const articles = articleIds.length
    ? await tx.article.findMany({ where: { id: { in: articleIds } }, select: { id: true, name: true } })
    : [];
  const byId = new Map(articles.map((a) => [a.id, a]));
  return items.map((it, idx) => {
    const pos = idx + 1;
    if (!it || typeof it !== 'object') throw badRequest(`Position ${pos} ist ungültig`);
    const articleId = it.articleId ? String(it.articleId) : null;
    if (articleId && !byId.has(articleId)) throw badRequest(`Position ${pos}: Artikel nicht gefunden`);
    const q = parseNum(it.quantity);
    if (!Number.isFinite(q) || q <= 0) throw badRequest(`Position ${pos}: Menge muss größer als 0 sein`);
    const p = parseNum(it.pricePerUnit);
    if (!Number.isFinite(p) || p < 0) throw badRequest(`Position ${pos}: Preis darf nicht negativ sein`);
    if (q > 99999999 || p > 99999999) throw badRequest(`Position ${pos}: Betrag zu groß`);
    let description = typeof it.description === 'string' ? it.description.trim() : '';
    if (!description && articleId) description = byId.get(articleId).name;
    if (!description) throw badRequest(`Position ${pos}: Bezeichnung fehlt`);
    if (description.length > 500) throw badRequest(`Position ${pos}: Bezeichnung zu lang (höchstens 500 Zeichen)`);
    const quantity = d(q).toDecimalPlaces(2);
    const pricePerUnit = d(p).toDecimalPlaces(2);
    return { articleId, description, quantity, pricePerUnit, totalPrice: quantity.mul(pricePerUnit).toDecimalPlaces(2) };
  });
}

/**
 * Kopf-Felder aus dem Request (Whitelist). Nie übernommen: status, paidAt, paymentMethod,
 * invoiceNumber, userId, totalAmount, taxRate (Steuersatz ist fest 0, Betrag wird berechnet).
 * create = true: Empfänger und Fälligkeit sind Pflicht.
 */
async function normalizeHeader(tx, data, { create }) {
  const out = {};
  if (data.customerId !== undefined) {
    if (data.customerId === null || data.customerId === '') out.customerId = null;
    else {
      const customer = await tx.customer.findUnique({ where: { id: String(data.customerId) }, select: { id: true, name: true } });
      if (!customer) throw badRequest('Kunde nicht gefunden');
      out.customerId = customer.id;
      out._customerName = customer.name;
    }
  }
  const name = optText(data.customerName, 'Empfänger', 200);
  if (name) out.customerName = name;
  else if (name === null || create) {
    // Ohne Namen: Name des gewählten Kunden übernehmen
    if (out._customerName) out.customerName = out._customerName;
    else throw badRequest('Empfänger fehlt: bitte einen Kunden wählen oder einen Namen eintragen');
  }
  delete out._customerName;

  const address = optText(data.customerAddress, 'Anschrift', 1000);
  if (address !== undefined) out.customerAddress = address;
  const description = optText(data.description, 'Beschreibung', 2000);
  if (description !== undefined) out.description = description;

  if (data.dueDate !== undefined || create) {
    const due = parseLocalDate(data.dueDate);
    if (!due) throw badRequest('Fälligkeitsdatum fehlt oder ist ungültig');
    out.dueDate = due;
  }
  return out;
}

class InvoiceService {
  /**
   * Nächste Rechnungsnummer JJJJ-NNNN innerhalb der Transaktion. Der Zähler
   * `invoice.lastNumber.<Jahr>` merkt sich die höchste je vergebene Nummer, damit eine
   * Nummer nach endgültigem Löschen nicht noch einmal vergeben wird.
   */
  async generateInvoiceNumber(tx) {
    const year = new Date().getFullYear();
    const prefix = `${year}-`;
    const existing = await tx.invoice.findMany({ where: { invoiceNumber: { startsWith: prefix } }, select: { invoiceNumber: true } });
    const n = await nextNumber(tx, `invoice.lastNumber.${year}`, maxFromNumbers(existing.map((r) => r.invoiceNumber), prefix), `Höchste vergebene Kundenrechnungsnummer ${year}`);
    return `${prefix}${String(n).padStart(4, '0')}`;
  }

  async getSettings() {
    const keys = Object.keys(DEFAULT_CONFIG);
    const stored = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
    const settings = { ...DEFAULT_CONFIG };
    for (const s of stored) {
      if (s.value) settings[s.key] = s.value;
    }
    return settings;
  }

  async updateSettings(data) {
    const validKeys = Object.keys(DEFAULT_CONFIG);
    for (const [key, value] of Object.entries(data)) {
      if (validKeys.includes(key)) {
        await prisma.systemSetting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) }
        });
      }
    }
  }

  async createInvoice(data, userId) {
    const body = data && typeof data === 'object' ? data : {};
    return withNumberRetry(() => prisma.$transaction(async (tx) => {
      const hdr = await normalizeHeader(tx, body, { create: true });
      const norm = await normalizeItems(tx, body.items);
      const totalAmount = norm.reduce((s, it) => s.add(it.totalPrice), d(0));
      const invoiceNumber = await this.generateInvoiceNumber(tx);

      const inv = await tx.invoice.create({ data: { ...hdr, invoiceNumber, taxRate: d(0), totalAmount, status: 'DRAFT', userId, items: { create: norm } }, include: { items: true } });
      await applyStockForItems(tx, inv.invoiceNumber, inv.items);
      return inv;
    }));
  }

  async listInvoices(filters = {}) {
    const { status, startDate, endDate, search } = filters; const where = {};
    if (status && STATUSES.includes(status)) where.status = status;
    const from = startDate ? parseLocalDate(startDate) : null;
    const to = endDate ? endOfLocalDay(endDate) : null;
    if (from || to) { where.createdAt = {}; if (from) where.createdAt.gte = from; if (to) where.createdAt.lte = to; }
    const q = typeof search === 'string' ? search.trim() : '';
    if (q) {
      where.OR = [
        { invoiceNumber: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } }
      ];
    }
    return prisma.invoice.findMany({ where, include: { customer: { select: CUSTOMER_BASIC_SELECT }, _count: { select: { items: true } } }, orderBy: { createdAt: 'desc' } });
  }

  async getInvoice(id) { return prisma.invoice.findUnique({ where: { id }, include: { items: { include: { article: true } }, customer: { select: CUSTOMER_BASIC_SELECT }, user: { select: { name: true } }, transactions: true } }); }

  /**
   * Statuswechsel. Bei PAID ist die Zahlungsart Pflicht (CASH = Bargeld in die Kasse,
   * TRANSFER = Bankeingang); paidAt optional (Vorgabe jetzt, nicht in der Zukunft, bar nicht
   * vor der letzten Kassenzählung). Jeder andere Status löscht paidAt und paymentMethod wieder.
   * Altbestand ohne Zahlungsart (null) gilt in Kassen-Soll und Bank-Abstimmung weiterhin als Bank.
   * CANCELLED bucht den Bestand zurück; eine stornierte Rechnung bleibt storniert.
   * Wer eine bezahlte Rechnung zurücksetzt (Fehlbuchung), hinterlässt Zahldatum und -art im Audit.
   */
  async updateInvoiceStatus(id, status, userId, { paymentMethod, paidAt, confirmClosed = false } = {}) {
    if (!STATUSES.includes(status)) throw badRequest('Ungültiger Status');
    const data = { status };
    if (status === 'PAID') {
      if (!['CASH', 'TRANSFER'].includes(paymentMethod)) {
        throw badRequest('Zahlungsart fehlt: bar (CASH) oder Überweisung (TRANSFER)');
      }
      const when = paidAt ? new Date(paidAt) : new Date();
      if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 60 * 1000) {
        throw badRequest('Zahldatum ist ungültig oder liegt in der Zukunft');
      }
      data.paidAt = when;
      data.paymentMethod = paymentMethod;
    } else {
      data.paidAt = null;
      data.paymentMethod = null;
    }

    return prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({ where: { id }, include: { items: true } });
      if (!existing) throw httpError(404, 'Rechnung nicht gefunden');
      if (existing.status === 'CANCELLED') {
        throw badRequest(status === 'CANCELLED'
          ? 'Rechnung ist bereits storniert'
          : 'Eine stornierte Rechnung kann nicht wieder geöffnet werden. Bitte eine neue Rechnung anlegen.');
      }
      const after = { ...existing, ...data };
      const closedYears = await closedPeriod.guard([
        paidDateOf(existing), paidDateOf(after),
        ...(status === 'CANCELLED' ? [existing.createdAt] : [])
      ], confirmClosed, tx);
      if (status === 'PAID' && data.paymentMethod === 'CASH') {
        const unchanged = existing.status === 'PAID' && existing.paymentMethod === 'CASH'
          && existing.paidAt && new Date(existing.paidAt).getTime() === data.paidAt.getTime();
        if (!unchanged) await cashCountService.assertCashPaymentAfterLastCount(data.paidAt, tx);
      }

      // Bedingt auf den gelesenen Status: Ein paralleler Wechsel findet die Zeile nicht mehr
      const claimed = await tx.invoice.updateMany({ where: { id, status: existing.status }, data });
      if (claimed.count === 0) throw httpError(409, CONFLICT_MSG);
      if (status === 'CANCELLED') {
        // Positionen erst nach dem Sperren lesen (ein paralleles Bearbeiten des Entwurfs ist dann durch)
        const items = await tx.invoiceItem.findMany({ where: { invoiceId: id } });
        await reverseStockForItems(tx, { ...existing, items }, `Storno Rechnung ${existing.invoiceNumber}`);
      }

      const changes = { from: existing.status, to: status };
      if (status === 'PAID') { changes.paymentMethod = data.paymentMethod; changes.paidAt = data.paidAt; }
      if (existing.status === 'PAID') {
        changes.previousPaidAt = existing.paidAt;
        changes.previousPaymentMethod = existing.paymentMethod;
      }
      if (status === 'CANCELLED') changes.stockReturned = existing.items.filter((it) => it.articleId).length;
      await tx.auditLog.create({
        data: { userId, action: `UPDATE_INVOICE_STATUS_${status}`, entityType: 'Invoice', entityId: id, changes }
      });
      if (closedYears.length) {
        const wasPaid = paidDateOf(existing);
        const isPaid = paidDateOf(after);
        let what;
        if (status === 'CANCELLED') what = `storniert${wasPaid ? ` (war bezahlt am ${fmtDate(wasPaid)})` : ''}`;
        else if (!wasPaid && isPaid) what = `als bezahlt markiert (${fmtDate(isPaid)}, ${PAY_LABEL[data.paymentMethod] || data.paymentMethod})`;
        else if (wasPaid && isPaid) what = `Zahlung geändert (von ${fmtDate(wasPaid)} auf ${fmtDate(isPaid)}, ${PAY_LABEL[data.paymentMethod] || data.paymentMethod})`;
        else if (wasPaid) what = `Zahlung zurückgenommen (war bezahlt am ${fmtDate(wasPaid)}), Status ${STATUS_LABEL[status]}`;
        else what = `Status von ${STATUS_LABEL[existing.status]} auf ${STATUS_LABEL[status]} geändert`;
        await closedPeriod.logChange(tx, closedYears, {
          userId, entityType: 'Invoice', entityId: id,
          operation: status === 'CANCELLED' ? 'Rechnung storniert' : 'Rechnungsstatus geändert',
          description: `${invLabel(existing)} ${what}, ${fmtEUR(existing.totalAmount)}`,
          amountBefore: (fy) => incomeIn(existing, fy),
          amountAfter: (fy) => incomeIn(after, fy),
        });
      }
      return tx.invoice.findUnique({ where: { id } });
    });
  }

  buildSepaEpcQr({ amount, remittance, settings }) {
    const amt = Number(amount || 0).toFixed(2);
    // EPC-QR Version 002: BIC darf leer sein. Zeilen müssen mit \n getrennt sein.
    const iban = String(settings.INVOICE_IBAN || '').replace(/\s+/g, '');
    return ['BCD', '002', '1', 'SCT', settings.INVOICE_BIC || '', String(settings.INVOICE_PAYEE_NAME || '').slice(0, 70), iban, `EUR${amt}`, '', '', (remittance || '').slice(0, 140)].join('\n');
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
  async drawFooterWithQr(doc, totalAmount, invoiceNumber, settings) {
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const marginB = doc.page.margins.bottom || 50;

    const footerY = pageH - marginB - 30;     // sicher innerhalb der Seite
    doc.fontSize(8);
    const bank = [`Kontoinhaber: ${settings.INVOICE_PAYEE_NAME}`, `IBAN: ${fmtIban(settings.INVOICE_IBAN)}`];
    if (settings.INVOICE_BIC) bank.push(`BIC: ${settings.INVOICE_BIC}`);
    doc.text(bank.join(' | '), 50, footerY, { align: 'center', width: pageW - 100 });

    // QR rechts unten
    const remRef = `${settings.INVOICE_REF_PREFIX}-${invoiceNumber}`;
    const epc = this.buildSepaEpcQr({ amount: totalAmount, remittance: remRef, settings });
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

        const settings = await this.getSettings();

        // Header
        let senderX = 50;
        if (LOGO_BUFFER) {
          try { doc.image(LOGO_BUFFER, 50, 45, { height: 64 }); senderX = 130; } catch (_) { /* ohne Logo */ }
        }
        doc.fontSize(12).text(settings.INVOICE_SENDER_NAME, senderX, 50);
        doc.fontSize(10);
        [settings.INVOICE_ADDRESS_STREET, settings.INVOICE_ADDRESS_CITY, settings.INVOICE_EMAIL]
          .filter(Boolean)
          .forEach((ln, i) => doc.text(ln, senderX, 68 + i * 15));

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
        if (invoice.dueDate) doc.text(`Fällig am: ${new Date(invoice.dueDate).toLocaleDateString('de-DE')}`, 350, 280);

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

        // Der Verein weist keine Umsatzsteuer aus: nur der Gesamtbetrag
        doc.fontSize(12);
        y += 25;
        doc.text('Gesamtbetrag:', 350, y);
        doc.text(`€ ${Number(invoice.totalAmount).toFixed(2)}`, 450, y);

        // Footer + QR **unten auf der aktuellen Seite**
        await this.drawFooterWithQr(doc, invoice.totalAmount, invoice.invoiceNumber, settings);

        doc.end();
      } catch (e) { reject(e); }
    });
  }
  /** Rechnung bearbeiten (nur DRAFT): Kopf-Whitelist, Positionen ersetzen, Bestand umbuchen */
  async updateInvoice(id, data, userId, { confirmClosed = false } = {}) {
    const body = data && typeof data === 'object' ? data : {};
    return prisma.$transaction(async (tx) => {
      const hdr = await normalizeHeader(tx, body, { create: false });
      const norm = await normalizeItems(tx, body.items);
      const totalAmount = norm.reduce((s, it) => s.add(it.totalPrice), d(0));

      // Erst die Zeile beanspruchen (nur solange Entwurf), dann die Positionen frisch lesen
      const claimed = await tx.invoice.updateMany({ where: { id, status: 'DRAFT' }, data: { ...hdr, totalAmount } });
      if (claimed.count === 0) {
        const exists = await tx.invoice.findUnique({ where: { id }, select: { status: true } });
        if (!exists) throw httpError(404, 'Rechnung nicht gefunden');
        throw badRequest('Nur Entwürfe können bearbeitet werden');
      }
      const existing = await tx.invoice.findUnique({ where: { id }, include: { items: true } });
      // Entwurf aus einem abgeschlossenen Jahr (offene Forderung zum Stichtag, Bestand)
      const closedYears = await closedPeriod.guard([existing.createdAt], confirmClosed, tx);
      if (closedYears.length) {
        // Entwurf: keine Einnahme, nur offene Forderung; deshalb ohne Betragsauswirkung auf die EÜR
        await closedPeriod.logChange(tx, closedYears, {
          userId, entityType: 'Invoice', entityId: id,
          operation: 'Rechnung bearbeitet',
          description: `${invLabel(existing)} (Entwurf vom ${fmtDate(existing.createdAt)}) bearbeitet, Betrag jetzt ${fmtEUR(totalAmount)}`,
          effect: null,
        });
      }

      await reverseStockForItems(tx, existing, `Update von Rechnung ${existing.invoiceNumber}`);
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      const updated = await tx.invoice.update({ where: { id }, data: { items: { create: norm } }, include: { items: true } });
      await applyStockForItems(tx, updated.invoiceNumber, updated.items);

      await tx.auditLog.create({ data: { userId, action: 'UPDATE_INVOICE_CONTENT', entityType: 'Invoice', entityId: id, changes: { updatedHeader: Object.keys(hdr), items: norm.length, totalAmount } } });
      return updated;
    });
  }

  /**
   * DELETE: ohne hard = Storno (wie PATCH CANCELLED, Bestand genau einmal zurück).
   * hard = endgültig löschen, nur DRAFT (Bestand zurück) oder CANCELLED (Bestand ist schon zurück).
   * Die Nummer bleibt verbraucht (Zähler im SystemSetting).
   */
  async deleteInvoice(id, userId, { hard = false, confirmClosed = false } = {}) {
    if (!hard) {
      const cancelled = await this.updateInvoiceStatus(id, 'CANCELLED', userId, { confirmClosed });
      return { message: 'Rechnung storniert', invoice: cancelled };
    }
    return prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id }, include: { _count: { select: { transactions: true } } } });
      if (!inv) throw httpError(404, 'Rechnung nicht gefunden');
      if (!['DRAFT', 'CANCELLED'].includes(inv.status)) {
        throw badRequest('Endgültig löschen geht nur bei Entwürfen und stornierten Rechnungen. Versendete oder bezahlte Rechnungen bitte stornieren.');
      }
      if (inv._count.transactions > 0) throw badRequest('Die Rechnung ist mit Buchungen verknüpft und kann nicht gelöscht werden');
      const closedYears = await closedPeriod.guard([inv.createdAt], confirmClosed, tx);
      if (closedYears.length) {
        await closedPeriod.logChange(tx, closedYears, {
          userId, entityType: 'Invoice', entityId: id,
          operation: 'Rechnung gelöscht',
          description: `${invLabel(inv)} (${STATUS_LABEL[inv.status]}, vom ${fmtDate(inv.createdAt)}) endgültig gelöscht, ${fmtEUR(inv.totalAmount)}`,
          effect: null,
        });
      }

      // Zeile sperren und Status prüfen: Ein paralleler Wechsel/Löschvorgang findet sie danach nicht mehr
      const claimed = await tx.invoice.updateMany({ where: { id, status: inv.status }, data: { updatedAt: new Date() } });
      if (claimed.count === 0) throw httpError(409, CONFLICT_MSG);

      if (inv.status === 'DRAFT') {
        const items = await tx.invoiceItem.findMany({ where: { invoiceId: id } });
        await reverseStockForItems(tx, { ...inv, items }, `Löschung Rechnung ${inv.invoiceNumber}`);
      }
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.delete({ where: { id } });
      await tx.auditLog.create({ data: { userId, action: 'DELETE_INVOICE_HARD', entityType: 'Invoice', entityId: id, changes: { invoiceNumber: inv.invoiceNumber, status: inv.status, totalAmount: inv.totalAmount, stockReturned: inv.status === 'DRAFT' } } });
      return { message: 'Rechnung endgültig gelöscht' };
    });
  }
}

module.exports = new InvoiceService();