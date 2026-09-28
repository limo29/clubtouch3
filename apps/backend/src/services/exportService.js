// services/exportService.js
const { parse } = require('json2csv');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const prisma = require('../utils/prisma');
const accountingService = require('./accountingService');
const customerService = require('./customerService');
const cashCountService = require('./cashCountService');
const { parseLocalDate, endOfLocalDay } = require('../utils/businessDay');

// Logo einmal beim Laden lesen; fehlt die Datei, wird ohne Logo gerendert.
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo.png');
let LOGO_BUFFER = null;
try { LOGO_BUFFER = fs.readFileSync(LOGO_PATH); } catch (_) { LOGO_BUFFER = null; }

class ExportService {
  constructor() {
    this.currencyFmt = new Intl.NumberFormat('de-DE', {
      style: 'currency', currency: 'EUR',
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    this.dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    this.dateTimeFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* ========= THEME & UTIL ========= */
  getTheme() {
    return {
      brandName: 'Clubraum',
      // top/bottom lassen Platz für Kopf (Titel, Untertitel, Logo) und Fußzeile
      page: { margin: 50, top: 92, bottom: 62, size: 'A4' },
      font: { regular: 'Helvetica', bold: 'Helvetica-Bold' },
      logo: { height: 28 },
      color: {
        text: '#0f172a', subtext: '#475569',
        primary: '#2563eb', border: '#e2e8f0',
        tableHeaderBg: '#f1f5f9', tableHeaderText: '#334155',
        zebra: '#f8fafc', panelBg: '#f8fafc',
        success: '#16a34a', danger: '#dc2626', warning: '#d97706'
      }
    };
  }
  _fmtEUR = (n) => this.currencyFmt.format(Number(n || 0));
  _fmtDate = (d) => {
    if (!d) return '—';
    const x = d instanceof Date ? d : parseLocalDate(d);
    return x && !Number.isNaN(x.getTime()) ? this.dateFmt.format(x) : '—';
  };
  _fmtDateTime = (d) => {
    if (!d) return '—';
    const x = new Date(d);
    return Number.isNaN(x.getTime()) ? '—' : this.dateTimeFmt.format(x);
  };
  /** Zahl mit Komma für CSV (Excel-DE) */
  _csvNum = (n, digits = 2) => (n === null || n === undefined || n === '') ? '' : Number(n).toFixed(digits).replace('.', ',');
  _csvDateTime = (d) => d ? this.dateTimeFmt.format(new Date(d)) : '';
  _paymentLabel(pm) {
    return ({ CASH: 'Bar', ACCOUNT: 'Kundenkonto', INVOICE: 'Rechnung', TRANSFER: 'Überweisung' })[pm] || (pm || '—');
  }
  _invoiceStatusLabel(st) {
    return ({ DRAFT: 'Entwurf', SENT: 'Versendet', PAID: 'Bezahlt', CANCELLED: 'Storniert' })[st] || (st || '—');
  }
  _fmtQty(n, unit, pUnit, pQty) {
    const val = Number(n || 0);
    const absVal = Math.abs(val);
    const sign = val < 0 ? '-' : '';

    // Bedingung: Keine Umrechnung definiert oder Total < 1 Einheit oder pQty nicht valide
    if (!pUnit || !pQty || pQty <= 1 || absVal < 1) {
      if (!unit) return val.toFixed(0);
      return `${val.toFixed(0)} ${unit}`;
    }

    const crates = Math.floor(absVal / pQty);
    const remainder = Number((absVal % pQty).toFixed(2));

    if (crates === 0) {
      return `${val.toFixed(0)} ${unit}`;
    }

    const parts = [];
    if (crates > 0) parts.push(`${crates} ${pUnit}`);
    if (remainder > 0) parts.push(`${remainder} ${unit}`);

    const human = parts.join(', ');
    return `${sign}${human} (${val.toFixed(0)})`;
  }

  /* ========= PDF-GRUNDGERÜST =========
   * Kein Instanzzustand: Alles, was eine Seite zum Dekorieren braucht, hängt am
   * Dokument selbst (doc._ct). headerInfo:
   *   { reportName, title, subtitle, watermark, createdBy }
   * Jede per addPage() neu angelegte Seite (auch automatische Umbrüche) bekommt
   * über das 'pageAdded'-Event den Kopf; die erste Seite dekoriert der Aufrufer
   * explizit (Deckblätter bleiben so frei). _finishDoc schreibt die Fußzeilen
   * "Clubraum · Bericht | erstellt am … von … | Seite x von y" auf alle Seiten.
   */
  _createDocWithBuffer(headerInfo = {}) {
    const theme = this.getTheme();
    const doc = new PDFDocument({
      margins: { top: theme.page.top, bottom: theme.page.bottom, left: theme.page.margin, right: theme.page.margin },
      size: theme.page.size,
      bufferPages: true,
      info: {
        Title: headerInfo.title || headerInfo.reportName || theme.brandName,
        Author: headerInfo.createdBy || theme.brandName,
        Creator: 'ClubTouch3'
      }
    });
    doc._ct = { headerInfo: { ...headerInfo }, createdAt: new Date(), theme };
    doc.on('pageAdded', () => this._decoratePage(doc, theme, doc._ct.headerInfo));
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const done = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
    return { doc, done, theme };
  }

  _drawLogo(doc, theme, { x, y, height }) {
    if (!LOGO_BUFFER) return 0;
    try {
      doc.image(LOGO_BUFFER, x, y, { height });
      return height; // Logo ist annähernd quadratisch
    } catch (_) { return 0; }
  }

  _decoratePage(doc, theme, headerInfo = {}) {
    if (headerInfo) doc._ct.headerInfo = { ...doc._ct.headerInfo, ...headerInfo };
    const info = doc._ct.headerInfo || {};
    const { margin } = theme.page;
    const pageWidth = doc.page.width;
    const usable = pageWidth - margin * 2;

    // Font-Zustand sichern: Der Kopf darf einen laufenden Textfluss nicht verändern
    const prev = { font: doc._font && doc._font.name, size: doc._fontSize, fill: doc._fillColor, x: doc.x };
    const prevBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const logoH = theme.logo.height;
    const logoW = this._drawLogo(doc, theme, { x: pageWidth - margin - logoH, y: 20, height: logoH });
    const textW = usable - (logoW ? logoW + 12 : 0);

    doc.fillColor(theme.color.primary).font(theme.font.bold).fontSize(16)
      .text(info.title || '', margin, 22, { width: textW, align: 'left', lineBreak: false });

    if (info.subtitle) {
      doc.fillColor(theme.color.subtext).font(theme.font.regular).fontSize(9)
        .text(info.subtitle, margin, 44, { width: textW, align: 'left', height: 24, ellipsis: true });
    }

    if (info.watermark) {
      doc.fillColor(theme.color.danger).font(theme.font.bold).fontSize(11)
        .text(String(info.watermark), margin, 60, { width: textW, align: 'right', lineBreak: false });
    }

    doc.save().lineWidth(1).strokeColor(theme.color.border)
      .moveTo(margin, theme.page.top - 16).lineTo(pageWidth - margin, theme.page.top - 16).stroke().restore();

    doc.page.margins.bottom = prevBottom;
    doc.y = theme.page.top;
    doc.x = margin;
    if (prev.font) doc.font(prev.font); else doc.font(theme.font.regular);
    doc.fontSize(prev.size || 10);
    if (prev.fill) doc.fillColor(prev.fill[0], prev.fill[1]); else doc.fillColor(theme.color.text);
  }

  /** Neue Seite; optional mit geändertem Kopf (z.B. nach einem Deckblatt). */
  _addPageDecorated(doc, theme, headerInfo) {
    if (headerInfo) doc._ct.headerInfo = { ...doc._ct.headerInfo, ...headerInfo };
    doc.addPage(); // 'pageAdded' dekoriert
  }

  /** Fußzeilen auf alle Seiten schreiben und Dokument beenden. */
  _finishDoc(doc, theme, headerInfo) {
    const info = { ...(doc._ct.headerInfo || {}), ...(headerInfo || {}) };
    const { margin } = theme.page;
    const range = doc.bufferedPageRange();
    const total = range.count;
    const createdLabel = `erstellt am ${this._fmtDateTime(doc._ct.createdAt)}${info.createdBy ? ` von ${info.createdBy}` : ''}`;
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const prevBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - theme.page.bottom + 22;
      const w = doc.page.width - margin * 2;
      doc.save().lineWidth(0.5).strokeColor(theme.color.border)
        .moveTo(margin, y - 8).lineTo(doc.page.width - margin, y - 8).stroke().restore();
      doc.font(theme.font.regular).fontSize(8).fillColor(theme.color.subtext);
      // Spalten 25 % / 50 % / 25 %, jeweils einzeilig
      doc.text(`${theme.brandName} · ${info.reportName || info.title || ''}`, margin, y, { width: w * 0.25, align: 'left', lineBreak: false, height: 10, ellipsis: true });
      doc.text(createdLabel, margin + w * 0.25, y, { width: w * 0.5, align: 'center', lineBreak: false, height: 10, ellipsis: true });
      doc.text(`Seite ${i - range.start + 1} von ${total}`, margin + w * 0.75, y, { width: w * 0.25, align: 'right', lineBreak: false });
      doc.page.margins.bottom = prevBottom;
    }
    doc.end();
  }

  _bottom(doc, theme) { return doc.page.height - theme.page.bottom; }

  _ensureRoom(doc, theme, need) {
    if (doc.y + need > this._bottom(doc, theme)) {
      doc.addPage();
      return true;
    }
    return false;
  }

  _section(doc, theme, text, headerInfo) {
    if (headerInfo) doc._ct.headerInfo = { ...doc._ct.headerInfo, ...headerInfo };
    doc.x = theme.page.margin;
    // Überschrift nie allein am Seitenende
    this._ensureRoom(doc, theme, 100);
    doc.moveDown(0.6);
    doc.font(theme.font.bold).fontSize(14).fillColor(theme.color.text)
      .text(text, theme.page.margin, doc.y, { width: doc.page.width - theme.page.margin * 2 });

    const x = theme.page.margin, y = doc.y + 2;
    const w = doc.page.width - theme.page.margin * 2;
    doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.5).strokeColor(theme.color.border).stroke();
    doc.moveDown(0.5);
    doc.font(theme.font.regular).fillColor(theme.color.text);
  }

  /** Kleiner Hinweistext unter einer Tabelle/Sektion. */
  _note(doc, theme, text) {
    this._ensureRoom(doc, theme, 30);
    doc.font(theme.font.regular).fontSize(9).fillColor(theme.color.subtext)
      .text(text, theme.page.margin, doc.y, { width: doc.page.width - theme.page.margin * 2 });
    doc.fillColor(theme.color.text).fontSize(10);
    doc.moveDown(0.8);
  }

  /**
   * Label/Wert-Liste mit rechtsbündigen Beträgen.
   * rows: [{ label, value, bold, color, rule, spacer }]
   */
  _kvList(doc, theme, rows, { headerInfo, labelWidth } = {}) {
    if (headerInfo) doc._ct.headerInfo = { ...doc._ct.headerInfo, ...headerInfo };
    const left = theme.page.margin;
    const usable = doc.page.width - left * 2;
    const valueW = 120;
    const labelW = labelWidth || usable - valueW;
    const lineH = 16;
    (rows || []).forEach(r => {
      if (r.spacer) { doc.y += 6; return; }
      this._ensureRoom(doc, theme, lineH + 4);
      const y = doc.y;
      if (r.rule) {
        doc.moveTo(left, y - 3).lineTo(left + usable, y - 3).lineWidth(0.6).strokeColor(theme.color.border).stroke();
      }
      doc.font(r.bold ? theme.font.bold : theme.font.regular).fontSize(10).fillColor(theme.color.text)
        .text(String(r.label ?? ''), left, y, { width: labelW, lineBreak: false, ellipsis: true });
      doc.font(r.bold ? theme.font.bold : theme.font.regular).fontSize(10).fillColor(r.color || theme.color.text)
        .text(String(r.value ?? ''), left + labelW, y, { width: valueW, align: 'right', lineBreak: false });
      doc.y = y + lineH;
    });
    doc.font(theme.font.regular).fillColor(theme.color.text);
    doc.x = left;
    doc.moveDown(0.6);
  }

  /** Unterschriftenzeilen nebeneinander (max. 3 pro Reihe), jeweils mit Ort/Datum-Zeile. */
  _signatureBlock(doc, theme, labels, headerInfo) {
    if (headerInfo) doc._ct.headerInfo = { ...doc._ct.headerInfo, ...headerInfo };
    const left = theme.page.margin;
    const usable = doc.page.width - left * 2;
    const perRow = Math.min(3, Math.max(1, labels.length));
    const gap = 24;
    const colW = (usable - gap * (perRow - 1)) / perRow;
    const rows = [];
    for (let i = 0; i < labels.length; i += perRow) rows.push(labels.slice(i, i + perRow));

    this._ensureRoom(doc, theme, 40 + rows.length * 90);
    doc.moveDown(1.5);
    doc.font(theme.font.bold).fontSize(11).fillColor(theme.color.text).text('Unterschriften', left, doc.y);
    doc.moveDown(0.5);

    rows.forEach(row => {
      const topY = doc.y + 40;
      row.forEach((label, idx) => {
        const x = left + idx * (colW + gap);
        doc.moveTo(x, topY).lineTo(x + colW, topY).lineWidth(0.7).strokeColor(theme.color.text).stroke();
        doc.font(theme.font.regular).fontSize(9).fillColor(theme.color.subtext)
          .text(label, x, topY + 4, { width: colW, lineBreak: false });
        doc.text('Ort, Datum', x, topY + 30, { width: colW, lineBreak: false });
        doc.moveTo(x, topY + 28).lineTo(x + colW, topY + 28).lineWidth(0.4).strokeColor(theme.color.border).stroke();
      });
      doc.y = topY + 50;
    });
    doc.x = left;
    doc.fillColor(theme.color.text).font(theme.font.regular).fontSize(10);
  }

  _table(doc, theme, { columns, rows, sumRow = null, emptyHint = 'Keine Daten vorhanden', headerInfo }) {
    if (headerInfo) doc._ct.headerInfo = { ...doc._ct.headerInfo, ...headerInfo };
    const left = theme.page.margin;
    const right = doc.page.width - theme.page.margin;
    const usableWidth = right - left;

    const srcW = columns.map(c => c.width);
    const totalW = srcW.reduce((a, b) => a + b, 0) || 1;
    const scale = usableWidth / totalW;
    const widths = srcW.map(w => Math.floor(w * scale));
    const rowPad = 6;
    const headerH = 18;

    const renderHeader = () => {
      let x = left; const y = doc.y;
      doc.save().rect(left, y - rowPad, usableWidth, headerH + rowPad * 2).fill(theme.color.tableHeaderBg).restore();
      columns.forEach((col, idx) => {
        doc.fillColor(theme.color.tableHeaderText).font(theme.font.bold).fontSize(10)
          .text(col.header, x + 2, y, { width: widths[idx] - 4, align: col.align || 'left' });
        x += widths[idx];
      });
      doc.moveTo(left, y + headerH + rowPad).lineTo(right, y + headerH + rowPad)
        .lineWidth(0.5).strokeColor(theme.color.border).stroke();
      doc.y = y + headerH + rowPad + 2;
      doc.fillColor(theme.color.text).font(theme.font.regular);
    };

    const ensureRoom = (need) => {
      const bottom = this._bottom(doc, theme);
      if (doc.y + need > bottom) {
        if (doc.y < theme.page.top + 50) {
          console.log(`[PDF WARN] Row too tall (${need}) for page. Printing anyway.`);
          return;
        }
        doc.addPage();
        renderHeader();
      }
    };

    // Leere Tabellen: nur Hinweis, keine Kopfzeile
    if (!rows || rows.length === 0) {
      this._ensureRoom(doc, theme, 24);
      doc.fontSize(10).fillColor(theme.color.subtext).text(emptyHint, left, doc.y + 2);
      doc.fillColor(theme.color.text);
      doc.moveDown(1); doc.x = theme.page.margin; return;
    }

    this._ensureRoom(doc, theme, headerH + rowPad * 2 + 40);
    renderHeader();

    rows.forEach((row, i) => {
      doc.font(theme.font.regular).fontSize(10);
      const heights = columns.map((col, idx) => {
        const txt = col.render ? col.render(row) : (row[col.key] ?? '');
        return Math.max(doc.heightOfString(String(txt ?? ''), { width: widths[idx] - 4 }), 10);
      });
      const rowH = Math.max(...heights) + rowPad * 2;

      ensureRoom(rowH + 30);

      if (i % 2 === 0) doc.save().rect(left, doc.y - 2, usableWidth, rowH + 4).fill(theme.color.zebra).restore();

      let x = left; const baseY = doc.y + rowPad;
      columns.forEach((col, idx) => {
        const txt = col.render ? col.render(row) : (row[col.key] ?? '');
        const color = typeof col.color === 'function' ? col.color(row) : theme.color.text;
        doc.fillColor(color).font(theme.font.regular).fontSize(10)
          .text(String(txt ?? ''), x + 2, baseY, { width: widths[idx] - 4, align: col.align || 'left' });
        x += widths[idx];
      });

      doc.moveTo(left, baseY + (rowH - rowPad)).lineTo(right, baseY + (rowH - rowPad))
        .lineWidth(0.3).strokeColor('#eef2f7').stroke();

      doc.y = baseY + (rowH - rowPad) + 2;
    });

    if (sumRow) {
      ensureRoom(28);
      doc.moveDown(0.2);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.6).strokeColor(theme.color.border).stroke();
      doc.moveDown(0.2);
      let x = left; const baseY = doc.y + rowPad + 2;
      sumRow.forEach((val, idx) => {
        const align = columns[idx]?.align || 'left';
        doc.font(theme.font.bold).fillColor(theme.color.text).fontSize(10)
          .text(String(val ?? ''), x + 2, baseY, { width: widths[idx] - 4, align });
        x += widths[idx];
      });
      doc.font(theme.font.regular);
      doc.y = baseY + 16;
    }

    doc.moveDown(1);
    doc.x = theme.page.margin;
    doc.fillColor(theme.color.text);
  }

  /* ========= CSV ========= */
  async exportTransactionsCSV(filters = {}) {
    const { startDate, endDate, customerId, paymentMethod } = filters;
    const where = { cancelled: false };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = parseLocalDate(startDate);
      if (endDate) where.createdAt.lte = endOfLocalDay(endDate); // Endtag inklusive
    }
    if (customerId) where.customerId = customerId;
    if (paymentMethod) where.paymentMethod = paymentMethod;

    const transactions = await prisma.transaction.findMany({
      where,
      include: { customer: true, user: { select: { name: true } }, items: { include: { article: true } } },
      orderBy: { createdAt: 'asc' }
    });

    const rows = [];
    transactions.forEach(t => t.items.forEach(item => rows.push({
      Transaktions_ID: t.id,
      Datum: t.createdAt.toLocaleString('de-DE'),
      Kunde: t.customer?.name || 'Bar-Zahlung',
      Artikel: item.article.name,
      Kategorie: item.article.category,
      Menge: item.quantity,
      Einheit: item.article.unit,
      Einzelpreis: item.pricePerUnit,
      Gesamtpreis: item.totalPrice,
      Zahlungsart: t.paymentMethod === 'CASH' ? 'Bar' : 'Kundenkonto',
      Kassierer: t.user.name
    })));

    const fields = ['Transaktions_ID', 'Datum', 'Kunde', 'Artikel', 'Kategorie', 'Menge', 'Einheit', 'Einzelpreis', 'Gesamtpreis', 'Zahlungsart', 'Kassierer'];
    const csv = parse(rows, { fields, delimiter: ';' });
    return { data: csv, filename: `transaktionen_${new Date().toISOString().split('T')[0]}.csv`, mimeType: 'text/csv' };
  }

  async exportInventoryCSV() {
    const articles = await prisma.article.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
    const data = articles.map(a => ({
      ID: a.id, Name: a.name, Kategorie: a.category, Preis: a.price, Bestand: a.stock,
      Mindestbestand: a.minStock, Einheit: a.unit, Aktiv: a.active ? 'Ja' : 'Nein',
      'Zählt für Highscore': a.countsForHighscore ? 'Ja' : 'Nein'
    }));
    const fields = ['ID', 'Name', 'Kategorie', 'Preis', 'Bestand', 'Mindestbestand', 'Einheit', 'Aktiv', 'Zählt für Highscore'];
    const csv = parse(data, { fields, delimiter: ';' });
    return { data: csv, filename: `bestand_${new Date().toISOString().split('T')[0]}.csv`, mimeType: 'text/csv' };
  }

  async exportCustomersCSV() {
    const customers = await prisma.customer.findMany({
      include: { _count: { select: { transactions: true } } }, orderBy: { name: 'asc' }
    });

    const data = customers.map(c => ({
      ID: c.id, Name: c.name, Spitzname: c.nickname || '', Guthaben: c.balance,
      'Anzahl Transaktionen': c._count.transactions, 'Erstellt am': c.createdAt.toLocaleString('de-DE')
    }));
    const fields = ['ID', 'Name', 'Spitzname', 'Guthaben', 'Anzahl Transaktionen', 'Erstellt am'];
    const csv = parse(data, { fields, delimiter: ';' });
    return { data: csv, filename: `kunden_${new Date().toISOString().split('T')[0]}.csv`, mimeType: 'text/csv' };
  }

  /* ========= PDF: Tages-/Monats-/EÜR ========= */
  async exportDailySummaryPDF(date = new Date(), startHour = 6) {
    const summary = await this.getDailySummaryData(date, startHour);
    return new Promise((resolve, reject) => {
      try {
        const { doc, done, theme } = this._createDocWithBuffer();
        const headerInfo = { title: `Tagesabschluss – ${theme.brandName}`, subtitle: `Geschäftstag: ${parseLocalDate(summary.date).toLocaleDateString('de-DE')} (${String(startHour).padStart(2, '0')}:00 bis ${String(startHour).padStart(2, '0')}:00 Uhr des Folgetags)` };
        this._decoratePage(doc, theme, headerInfo);

        this._section(doc, theme, 'Zusammenfassung');
        doc.fontSize(11)
          .text(`Gesamtumsatz: ${this._fmtEUR(summary.summary.totalRevenue)}`)
          .text(`Anzahl Transaktionen: ${summary.summary.totalTransactions}`)
          .text(`Bar-Umsatz: ${this._fmtEUR(summary.summary.cashRevenue)} (${summary.summary.cashTransactions} Transaktionen)`)
          .text(`Kundenkonto-Umsatz: ${this._fmtEUR(summary.summary.accountRevenue)} (${summary.summary.accountTransactions} Transaktionen)`)
          .text(`Stornierte Transaktionen: ${summary.summary.cancelledTransactions}`);

        this._section(doc, theme, 'Top 10 Artikel');
        this._table(doc, theme, {
          columns: [
            { header: '#', width: 40, align: 'right', render: r => String(r.__idx + 1) },
            { header: 'Artikel', width: 300, render: r => r.name },
            { header: 'Menge', width: 80, align: 'right', render: r => String(r.quantity_sold) },
            { header: 'Umsatz', width: 120, align: 'right', render: r => this._fmtEUR(r.revenue), color: () => theme.color.success }
          ],
          rows: (summary.topArticles || []).map((r, i) => ({ ...r, __idx: i })),
          emptyHint: 'Keine Verkäufe erfasst.',
          headerInfo
        });

        this._section(doc, theme, 'Umsatzverteilung nach Stunden');
        this._table(doc, theme, {
          columns: [
            { header: 'Stunde', width: 120, render: r => `${r.hour}:00 – ${r.hour}:59` },
            { header: 'Transaktionen', width: 140, align: 'right', render: r => String(r.transactions) },
            { header: 'Umsatz', width: 200, align: 'right', render: r => this._fmtEUR(r.revenue), color: () => theme.color.success }
          ],
          rows: summary.hourlyDistribution || [],
          emptyHint: 'Keine Daten vorhanden.',
          headerInfo
        });

        // Fußzeilen jetzt schreiben, dann enden
        doc.end();
        done.then(pdf => resolve({ data: pdf, filename: `tagesabschluss_${summary.date}.pdf`, mimeType: 'application/pdf' }));
      } catch (e) { reject(e); }
    });
  }

  async exportMonthlySummaryPDF(year, month) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    // Nur echte Verkäufe: REFUND (negativ), EXPIRED/OWNER_USE (0 €) gehören nicht in den Umsatz
    const [transactions, topCustomers, categoryStats] = await Promise.all([
      prisma.transaction.aggregate({
        where: { type: 'SALE', createdAt: { gte: startDate, lte: endDate }, cancelled: false },
        _sum: { totalAmount: true }, _count: true
      }),
      prisma.$queryRaw`
        SELECT c.name, COUNT(DISTINCT t.id) as transactions, SUM(t."totalAmount") as total_spent
        FROM "Customer" c
        JOIN "Transaction" t ON t."customerId" = c.id
        WHERE t."createdAt" >= ${startDate} AND t."createdAt" <= ${endDate}
          AND t.cancelled = false AND t.type = 'SALE'
        GROUP BY c.id, c.name
        ORDER BY total_spent DESC
        LIMIT 10
      `,
      prisma.$queryRaw`
        SELECT a.category, SUM(ti.quantity) as items_sold, SUM(ti."totalPrice") as revenue
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."createdAt" >= ${startDate} AND t."createdAt" <= ${endDate}
          AND t.cancelled = false AND t.type = 'SALE'
        GROUP BY a.category
        ORDER BY revenue DESC
      `
    ]);

    return new Promise((resolve, reject) => {
      try {
        const { doc, done, theme } = this._createDocWithBuffer();
        const headerInfo = { title: `Monatsbericht – ${theme.brandName}`, subtitle: `${this.getMonthName(month)} ${year}` };
        this._decoratePage(doc, theme, headerInfo);

        this._section(doc, theme, 'Zusammenfassung');
        const total = transactions._sum.totalAmount || 0;
        const count = transactions._count || 0;
        doc.fontSize(11)
          .text(`Gesamtumsatz: ${this._fmtEUR(total)}`)
          .text(`Anzahl Transaktionen: ${count}`)
          .text(`Durchschnitt pro Transaktion: ${this._fmtEUR(count ? total / count : 0)}`);

        this._section(doc, theme, 'Top 10 Kunden');
        this._table(doc, theme, {
          columns: [
            { header: '#', width: 40, align: 'right', render: r => String(r.__idx + 1) },
            { header: 'Name', width: 260, render: r => r.name },
            { header: 'Käufe', width: 120, align: 'right', render: r => String(r.transactions) },
            { header: 'Umsatz', width: 150, align: 'right', render: r => this._fmtEUR(r.total_spent), color: () => theme.color.success }
          ],
          rows: (topCustomers || []).map((r, i) => ({ ...r, __idx: i })),
          emptyHint: 'Keine Kundendaten vorhanden.',
          headerInfo
        });

        this._section(doc, theme, 'Umsatz nach Kategorien');
        this._table(doc, theme, {
          columns: [
            { header: 'Kategorie', width: 320, render: r => r.category },
            { header: 'Artikel', width: 120, align: 'right', render: r => String(r.items_sold) },
            { header: 'Umsatz', width: 160, align: 'right', render: r => this._fmtEUR(r.revenue), color: () => theme.color.success }
          ],
          rows: categoryStats || [],
          emptyHint: 'Keine Kategorien vorhanden.',
          headerInfo
        });

        doc.end();
        done.then(pdf => resolve({
          data: pdf, filename: `monatsbericht_${year}_${String(month).padStart(2, '0')}.pdf`, mimeType: 'application/pdf'
        }));
      } catch (e) { reject(e); }
    });
  }

  /**
   * Kontoauszug eines Kunden (Aufladungen, Einkäufe, Stornos) mit laufendem Saldo.
   * Datenbasis ist customerService.getAccountStatement, damit UI und PDF dieselben Zahlen zeigen.
   */
  async exportCustomerStatementPDF(customerId, start, end) {
    const statement = await customerService.getAccountStatement(customerId, start, end);
    const { customer, movements = [], summary = {} } = statement;

    const typeLabel = (m) => {
      if (m.type === 'TOPUP') return 'Aufladung';
      if (m.type === 'CANCELLED') return 'Storno';
      return 'Einkauf';
    };
    const displayName = customer.nickname ? `${customer.name} (${customer.nickname})` : customer.name;
    const slug = String(customer.name || 'kunde').toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-+|-+$/g, '');

    return new Promise((resolve, reject) => {
      try {
        const { doc, done, theme } = this._createDocWithBuffer();
        const headerInfo = {
          title: `Kontoauszug – ${theme.brandName}`,
          subtitle: `${displayName} · ${this._fmtDate(start)} – ${this._fmtDate(end)}`
        };
        this._decoratePage(doc, theme, headerInfo);

        this._section(doc, theme, 'Zusammenfassung');
        doc.fontSize(11)
          .text(`Aktueller Kontostand: ${this._fmtEUR(customer.currentBalance)}`)
          .text(`Aufladungen im Zeitraum: ${this._fmtEUR(summary.totalTopUps)}`)
          .text(`Einkäufe im Zeitraum: ${this._fmtEUR(summary.totalSpent)} (${summary.transactionCount || 0} Buchungen)`);

        this._section(doc, theme, 'Kontobewegungen');
        this._table(doc, theme, {
          columns: [
            { header: 'Datum', width: 130, render: r => new Date(r.date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) },
            { header: 'Vorgang', width: 90, render: r => typeLabel(r) },
            { header: 'Beschreibung', width: 200, render: r => r.description || '' },
            {
              header: 'Betrag', width: 90, align: 'right',
              render: r => this._fmtEUR(r.amount),
              color: r => (Number(r.amount) < 0 ? theme.color.danger : (Number(r.amount) > 0 ? theme.color.success : theme.color.subtext))
            },
            {
              header: 'Saldo', width: 90, align: 'right',
              render: r => this._fmtEUR(r.balance),
              color: r => (Number(r.balance) < 0 ? theme.color.danger : theme.color.text)
            }
          ],
          rows: movements,
          sumRow: ['', '', 'Summe Zeitraum', this._fmtEUR(Number(summary.totalTopUps || 0) - Number(summary.totalSpent || 0)), this._fmtEUR(customer.currentBalance)],
          emptyHint: 'Keine Kontobewegungen im gewählten Zeitraum.',
          headerInfo
        });

        doc.end();
        const fmtFile = (d) => {
          const x = new Date(d); const p = (n) => String(n).padStart(2, '0');
          return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
        };
        done.then(pdf => resolve({
          data: pdf,
          filename: `kontoauszug_${slug}_${fmtFile(start)}_${fmtFile(end)}.pdf`,
          mimeType: 'application/pdf'
        }));
      } catch (e) { reject(e); }
    });
  }

  async exportEURPDF(startDate, endDate) {
    const eur = await accountingService.getProfitLoss(startDate, endDate);
    const start = parseLocalDate(startDate);
    const end = endOfLocalDay(endDate);

    const [soldArticles, paidInvoices, expenseDocs] = await Promise.all([
      prisma.$queryRaw`
        SELECT a.name as article, a.category as category, SUM(ti.quantity) as quantity, SUM(ti."totalPrice") as amount
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."createdAt" >= ${start} AND t."createdAt" <= ${end}
          AND t.cancelled = false AND t.type = 'SALE'
        GROUP BY a.id, a.name, a.category
        ORDER BY amount DESC
      `,
      prisma.invoice.findMany({
        where: { status: 'PAID', paidAt: { gte: start, lte: end } },
        orderBy: { paidAt: 'asc' },
        select: { invoiceNumber: true, customerName: true, description: true, paidAt: true, totalAmount: true }
      }),
      prisma.purchaseDocument.findMany({
        where: { type: 'RECHNUNG', paid: true, documentDate: { gte: start, lte: end } },
        orderBy: { documentDate: 'asc' },
        select: { documentNumber: true, supplier: true, documentDate: true, totalAmount: true }
      })
    ]);

    return new Promise((resolve, reject) => {
      try {
        const { doc, done, theme } = this._createDocWithBuffer();
        const headerInfo = { title: `Einnahmen-Überschuss-Rechnung – ${theme.brandName}`, subtitle: `Zeitraum: ${startDate} – ${endDate}` };
        this._decoratePage(doc, theme, headerInfo);

        this._section(doc, theme, 'Zusammenfassung');
        doc.fontSize(11)
          .text(`Einnahmen gesamt: ${this._fmtEUR(eur.summary.totalIncome)}`, { fill: theme.color.success })
          .text(`Ausgaben gesamt: ${this._fmtEUR(eur.summary.totalExpenses)}`)
          .text(`Gewinn/Verlust: ${this._fmtEUR(eur.summary.profit)}`);

        this._section(doc, theme, 'Einnahmen nach Kategorie');
        this._table(doc, theme, {
          columns: [
            { header: 'Kategorie', width: 360, render: r => r.category },
            { header: 'Betrag', width: 160, align: 'right', render: r => this._fmtEUR(r.amount), color: () => theme.color.success }
          ],
          rows: eur.details.incomeByCategory || [],
          emptyHint: 'Keine Kategorien vorhanden.',
          headerInfo
        });

        this._section(doc, theme, 'Ausgaben nach Lieferant');
        this._table(doc, theme, {
          columns: [
            { header: 'Lieferant', width: 320, render: r => r.supplier },
            { header: 'Belege', width: 80, align: 'right', render: r => String(r.count) },
            { header: 'Betrag', width: 120, align: 'right', render: r => this._fmtEUR(r.amount), color: () => theme.color.danger }
          ],
          rows: eur.details.expensesBySupplier || [],
          emptyHint: 'Keine Ausgaben erfasst.',
          headerInfo
        });

        this._section(doc, theme, 'Verkaufte Artikel');
        const soldSumAmount = (soldArticles || []).reduce((a, r) => a + Number(r.amount || 0), 0);
        const soldSumQty = (soldArticles || []).reduce((a, r) => a + Number(r.quantity || 0), 0);
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 260, render: r => r.article },
            { header: 'Kategorie', width: 160, render: r => r.category || '-' },
            { header: 'Menge', width: 80, align: 'right', render: r => Number(r.quantity || 0).toFixed(0) },
            { header: 'Betrag', width: 120, align: 'right', render: r => this._fmtEUR(r.amount), color: () => theme.color.success }
          ],
          rows: soldArticles || [],
          sumRow: ['Summe', '', Number(soldSumQty).toFixed(0), this._fmtEUR(soldSumAmount)],
          emptyHint: 'Keine Verkäufe im Zeitraum.',
          headerInfo
        });

        this._section(doc, theme, 'Bezahlte Ausgangsrechnungen');
        const paidInvSum = (paidInvoices || []).reduce((a, r) => a + Number(r.totalAmount || 0), 0);
        this._table(doc, theme, {
          columns: [
            { header: 'Empfänger', width: 220, render: r => r.customerName || '-' },
            { header: 'Beschreibung', width: 220, render: r => r.description || '-' },
            { header: 'Bezahlt am', width: 100, render: r => this._fmtDate(r.paidAt) },
            { header: 'Betrag', width: 80, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.success }
          ],
          rows: paidInvoices || [],
          sumRow: ['Summe', '', '', this._fmtEUR(paidInvSum)],
          emptyHint: 'Keine bezahlten Ausgangsrechnungen.',
          headerInfo
        });

        this._section(doc, theme, 'Ausgabenbelege (bezahlt)');
        const expenseSum = (expenseDocs || []).reduce((a, r) => a + Number(r.totalAmount || 0), 0);
        this._table(doc, theme, {
          columns: [
            { header: 'Datum', width: 100, render: r => this._fmtDate(r.documentDate) },
            { header: 'Lieferant', width: 220, render: r => r.supplier || '-' },
            { header: 'Belegnr.', width: 140, render: r => r.documentNumber || '-' },
            { header: 'Betrag', width: 100, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.danger }
          ],
          rows: expenseDocs || [],
          sumRow: ['Summe', '', '', this._fmtEUR(expenseSum)],
          emptyHint: 'Keine Ausgabenbelege.',
          headerInfo
        });

        doc.end();
        done.then(pdf => resolve({ data: pdf, filename: `eur_${startDate}_${endDate}.pdf`, mimeType: 'application/pdf' }));
      } catch (e) { reject(e); }
    });
  }

  /* ========= PDF: Jahresabschluss (ausschließlich aus dem Snapshot) ========= */
  /**
   * Geschlossenes Geschäftsjahr: alle Zahlen kommen aus YearEndReport.detailsJson.
   * Offenes Geschäftsjahr: Live-Entwurf in derselben Form, mit "ENTWURF" im Kopf.
   */
  async exportYearEndReportPDF(fiscalYearId, { createdBy } = {}) {
    const { fiscalYear, snapshot: s } = await accountingService.getYearEndSnapshot(fiscalYearId);
    const draft = !!s.draft;

    const sum = (arr, sel) => (arr || []).reduce((acc, r) => acc + Number(sel(r) || 0), 0);
    const periodLabel = `${this._fmtDate(fiscalYear.startDate)} – ${this._fmtDate(fiscalYear.endDate)}`;
    const dataStateLabel = draft
      ? `Datenstand: Live-Vorschau vom ${this._fmtDateTime(s.generatedAt || new Date())} (Geschäftsjahr noch nicht abgeschlossen)`
      : `Datenstand: Abschluss vom ${this._fmtDateTime(s.closedAt)}`;

    const income = s.summary || {};
    const byType = s.incomeByType || {};
    const banks = Array.isArray(s.bankAccounts) ? s.bankAccounts : [];
    const banksTotal = sum(banks, b => b.balance);
    const cash = s.cashCount || null;
    const cashTotal = cash ? Number(cash.countedTotal || 0) : 0;
    const guestBalance = Number(s.liquidity?.guestBalanceEnd || 0);
    const unpaidInvSum = sum(s.unpaidInvoices, r => r.totalAmount);
    const unpaidPurchSum = sum(s.unpaidPurchaseDocs, r => r.totalAmount);
    const diffRows = (s.inventory && Array.isArray(s.inventory.diff)) ? s.inventory.diff : [];
    const expenseCount = (s.expenseDocs || []).length;

    return new Promise((resolve, reject) => {
      try {
        const headerInfo = {
          reportName: 'Jahresabschluss',
          title: `Jahresabschluss – ${this.getTheme().brandName}`,
          subtitle: `Geschäftsjahr ${fiscalYear.name} (${periodLabel}) · ${dataStateLabel}`,
          watermark: draft ? 'ENTWURF' : null,
          createdBy
        };
        const { doc, done, theme } = this._createDocWithBuffer(headerInfo);
        const pageW = doc.page.width - theme.page.margin * 2;

        // ---------- DECKBLATT ----------
        this._drawLogo(doc, theme, { x: doc.page.width - theme.page.margin - 70, y: 60, height: 70 });
        doc.fillColor(theme.color.primary).font(theme.font.bold).fontSize(26)
          .text(`Jahresabschluss – ${theme.brandName}`, theme.page.margin, 150, { width: pageW, align: 'left' });
        doc.moveDown(0.4);
        doc.font(theme.font.regular).fontSize(12).fillColor(theme.color.subtext)
          .text(`Geschäftsjahr: ${fiscalYear.name} (${periodLabel})`, { width: pageW })
          .text(draft ? 'Status: ENTWURF – Geschäftsjahr noch nicht abgeschlossen' : `Status: Abgeschlossen am ${this._fmtDateTime(s.closedAt)}`, { width: pageW })
          .text(dataStateLabel, { width: pageW });
        if (draft) {
          doc.moveDown(0.3);
          doc.font(theme.font.bold).fontSize(28).fillColor(theme.color.danger).opacity(0.25)
            .text('ENTWURF', theme.page.margin, doc.y, { width: pageW, align: 'right' }).opacity(1);
        }

        const panelX = theme.page.margin;
        const panelY = Math.max(280, doc.y + 24);
        const panelH = 190;
        doc.save();
        doc.roundedRect(panelX, panelY, pageW, panelH, 8).fill(theme.color.panelBg);
        doc.restore();
        doc.save().lineWidth(1).strokeColor(theme.color.border).roundedRect(panelX, panelY, pageW, panelH, 8).stroke().restore();
        doc.font(theme.font.bold).fontSize(14).fillColor(theme.color.text)
          .text('Zusammenfassung zum Stichtag', panelX + 16, panelY + 12);

        const colW = pageW / 2 - 24;
        const KPI = (label, value, x, y, color) => {
          doc.font(theme.font.regular).fontSize(10).fillColor(theme.color.subtext).text(label, x, y, { width: colW, lineBreak: false });
          doc.font(theme.font.bold).fontSize(12).fillColor(color || theme.color.text).text(value, x, y + 13, { width: colW, lineBreak: false });
        };
        const col1x = panelX + 16, col2x = panelX + pageW / 2 + 8, lineH = 40, kpiY = panelY + 42;
        KPI('Betriebseinnahmen', this._fmtEUR(income.totalIncome), col1x, kpiY, theme.color.success);
        KPI('Betriebsausgaben', this._fmtEUR(income.totalExpenses), col1x, kpiY + lineH, theme.color.danger);
        KPI(Number(income.profit) < 0 ? 'Fehlbetrag' : 'Überschuss', this._fmtEUR(income.profit), col1x, kpiY + lineH * 2,
          Number(income.profit) < 0 ? theme.color.danger : theme.color.success);
        KPI(cash && !cash.manual ? `Kassenbestand (gezählt ${this._fmtDate(cash.countedAt)})` : 'Kassenbestand', this._fmtEUR(cashTotal), col2x, kpiY);
        KPI('Bankkonten gesamt', this._fmtEUR(banksTotal), col2x, kpiY + lineH);
        KPI('Gästeguthaben (Verbindlichkeit)', this._fmtEUR(guestBalance), col2x, kpiY + lineH * 2, theme.color.danger);

        if (s.legacy) {
          doc.font(theme.font.regular).fontSize(9).fillColor(theme.color.subtext)
            .text('Hinweis: Dieser Abschluss wurde vor Einführung des vollständigen Abschluss-Snapshots erstellt. '
              + 'Detail-Listen (Belege, Artikel, Gästeguthaben) liegen dafür nicht vor.',
              panelX, panelY + panelH + 16, { width: pageW });
        }

        // ---------- SEITE 2: EÜR ----------
        this._addPageDecorated(doc, theme, headerInfo);
        this._section(doc, theme, 'Einnahmen-Überschuss-Rechnung', headerInfo);
        const eurRows = [];
        if (s.incomeByType) {
          eurRows.push({ label: 'Barverkäufe', value: this._fmtEUR(byType.cash) });
          eurRows.push({ label: 'Verkäufe über Kundenkonto', value: this._fmtEUR(byType.account) });
          eurRows.push({ label: 'Bezahlte Ausgangsrechnungen', value: this._fmtEUR(byType.invoices) });
        }
        eurRows.push({ label: 'Summe Betriebseinnahmen', value: this._fmtEUR(income.totalIncome), bold: true, color: theme.color.success });
        eurRows.push({ spacer: true });
        eurRows.push({ label: `Bezahlte Eingangsrechnungen${expenseCount ? ` (${expenseCount} Belege)` : ''}`, value: this._fmtEUR(income.totalExpenses) });
        eurRows.push({ label: 'Summe Betriebsausgaben', value: this._fmtEUR(income.totalExpenses), bold: true, color: theme.color.danger });
        eurRows.push({ spacer: true });
        eurRows.push({
          label: Number(income.profit) < 0 ? 'Fehlbetrag' : 'Überschuss', value: this._fmtEUR(income.profit),
          bold: true, color: Number(income.profit) < 0 ? theme.color.danger : theme.color.success, rule: true
        });
        this._kvList(doc, theme, eurRows, { headerInfo });

        if (s.nonRevenue || (s.liquidity && s.liquidity.topUps)) {
          this._section(doc, theme, 'Nachrichtlich (kein Ertrag, keine Ausgabe)', headerInfo);
          const nr = s.nonRevenue || {};
          const tu = (s.liquidity && s.liquidity.topUps) || null;
          const infoRows = [];
          if (nr.ownerUse) infoRows.push({ label: `Eigenverbrauch / Sachentnahme (${Number(nr.ownerUse.quantity || 0)} Stück, Warenwert)`, value: this._fmtEUR(nr.ownerUse.value) });
          if (nr.expired) infoRows.push({ label: `Abgelaufen / Schwund (${Number(nr.expired.quantity || 0)} Stück, Warenwert)`, value: this._fmtEUR(nr.expired.value) });
          if (tu) {
            infoRows.push({ label: 'Aufladungen Kundenkonten bar', value: this._fmtEUR(tu.cash) });
            infoRows.push({ label: 'Aufladungen Kundenkonten per Überweisung', value: this._fmtEUR(tu.transfer) });
            infoRows.push({ label: 'Aufladungen gesamt (Zufluss, aber Verbindlichkeit gegenüber Gästen)', value: this._fmtEUR(tu.total), bold: true });
          }
          this._kvList(doc, theme, infoRows, { headerInfo });
        }

        // ---------- KASSE & BANK ----------
        this._section(doc, theme, 'Kasse und Bank', headerInfo);
        const cashRows = [];
        if (cash && !cash.manual) {
          cashRows.push({ label: `Kassenzählung vom ${this._fmtDateTime(cash.countedAt)}${cash.countedBy ? ` (gezählt von ${cash.countedBy})` : ''}`, value: '' });
          cashRows.push({ label: 'Soll laut System', value: this._fmtEUR(cash.expectedTotal) });
          cashRows.push({ label: 'Ist gezählt', value: this._fmtEUR(cash.countedTotal), bold: true });
          const d = Number(cash.difference || 0);
          cashRows.push({ label: 'Differenz (Ist - Soll)', value: `${d > 0 ? '+' : ''}${this._fmtEUR(d)}`, bold: true, color: Math.abs(d) < 0.005 ? theme.color.success : (d < 0 ? theme.color.danger : theme.color.warning) });
          if (cash.note) cashRows.push({ label: `Notiz: ${cash.note}`, value: '' });
        } else {
          cashRows.push({ label: 'Barkasse (manuell erfasst)', value: this._fmtEUR(cashTotal), bold: true });
        }
        cashRows.push({ spacer: true });
        if (banks.length === 0) cashRows.push({ label: 'Bankkonten: keine erfasst', value: this._fmtEUR(0) });
        banks.forEach(b => cashRows.push({ label: `Bankkonto ${b.name || ''}${b.iban ? ` (${b.iban})` : ''}`, value: this._fmtEUR(b.balance) }));
        cashRows.push({ label: 'Liquide Mittel gesamt (Kasse + Bank)', value: this._fmtEUR(cashTotal + banksTotal), bold: true, rule: true });
        this._kvList(doc, theme, cashRows, { headerInfo });

        // ---------- VERBINDLICHKEITEN & FORDERUNGEN ----------
        this._section(doc, theme, 'Gästeguthaben (Verbindlichkeit gegenüber Mitgliedern)', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Name', width: 300, render: r => r.nickname ? `${r.name} (${r.nickname})` : r.name },
            { header: 'Saldo', width: 120, align: 'right', render: r => this._fmtEUR(r.balance), color: r => Number(r.balance) < 0 ? theme.color.danger : theme.color.text }
          ],
          rows: s.customerBalances || [],
          sumRow: ['Summe Gästeguthaben', this._fmtEUR(guestBalance)],
          emptyHint: s.legacy ? 'Keine Einzelliste im Abschluss vorhanden (Altbestand).' : 'Keine Kundenkonten mit Saldo.',
          headerInfo
        });

        this._section(doc, theme, 'Offene Eingangsrechnungen (Verbindlichkeiten)', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Belegdatum', width: 80, render: r => this._fmtDate(r.documentDate) },
            { header: 'Lieferant', width: 180, render: r => r.supplier || '-' },
            { header: 'Belegnr.', width: 120, render: r => r.documentNumber || '-' },
            { header: 'Fällig', width: 80, render: r => this._fmtDate(r.dueDate) },
            { header: 'Betrag', width: 90, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.danger }
          ],
          rows: s.unpaidPurchaseDocs || [],
          sumRow: ['Summe', '', '', '', this._fmtEUR(unpaidPurchSum)],
          emptyHint: 'Keine offenen Eingangsrechnungen.',
          headerInfo
        });

        this._section(doc, theme, 'Offene Ausgangsrechnungen (Forderungen)', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Rechnung', width: 100, render: r => r.invoiceNumber || '-' },
            { header: 'Empfänger', width: 160, render: r => r.customerName || '-' },
            { header: 'Erstellt', width: 80, render: r => this._fmtDate(r.createdAt) },
            { header: 'Fällig', width: 80, render: r => this._fmtDate(r.dueDate) },
            { header: 'Status', width: 70, render: r => this._invoiceStatusLabel(r.status) },
            { header: 'Betrag', width: 90, align: 'right', render: r => this._fmtEUR(r.totalAmount) }
          ],
          rows: s.unpaidInvoices || [],
          sumRow: ['Summe', '', '', '', '', this._fmtEUR(unpaidInvSum)],
          emptyHint: 'Keine offenen Ausgangsrechnungen.',
          headerInfo
        });

        // ---------- WARENBESTAND ----------
        this._section(doc, theme, 'Warenbestand zum Stichtag (System / gezählt / Differenz)', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 150, render: r => r.name },
            { header: 'System', width: 110, align: 'right', render: r => this._fmtQty(r.systemStock, r.unit, r.purchaseUnit, r.unitsPerPurchase) },
            { header: 'Gezählt', width: 110, align: 'right', render: r => this._fmtQty(r.physicalStock, r.unit, r.purchaseUnit, r.unitsPerPurchase) },
            { header: 'Differenz', width: 110, align: 'right', render: r => this._fmtQty(r.diff, r.unit, r.purchaseUnit, r.unitsPerPurchase), color: r => r.diff < 0 ? theme.color.danger : (r.diff > 0 ? theme.color.success : theme.color.text) },
            { header: 'Wert gezählt', width: 80, align: 'right', render: r => this._fmtEUR(r.physicalValue) },
            { header: 'Diff. Wert', width: 80, align: 'right', render: r => this._fmtEUR(r.diffValue), color: r => r.diffValue < 0 ? theme.color.danger : (r.diffValue > 0 ? theme.color.success : theme.color.text) }
          ],
          rows: diffRows,
          sumRow: ['Summe', '', '', '', this._fmtEUR(sum(diffRows, r => r.physicalValue)), this._fmtEUR(sum(diffRows, r => r.diffValue))],
          emptyHint: 'Keine Bestandsdaten.',
          headerInfo
        });
        if (draft) {
          doc.font(theme.font.regular).fontSize(9).fillColor(theme.color.subtext)
            .text('Im Entwurf entspricht der gezählte Bestand dem Systembestand; die Inventur wird erst beim Abschluss erfasst.', theme.page.margin, doc.y, { width: pageW });
          doc.moveDown(1);
        }

        // ---------- SCHWUND & EIGENVERBRAUCH ----------
        this._section(doc, theme, 'Abgelaufen / Schwund', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 300, render: r => r.article },
            { header: 'Menge', width: 100, align: 'right', render: r => this._fmtQty(r.quantity, r.unit) },
            { header: 'Warenwert', width: 100, align: 'right', render: r => this._fmtEUR(r.value) }
          ],
          rows: s.expiredArticles || [],
          sumRow: ['Summe', String(sum(s.expiredArticles, r => r.quantity)), this._fmtEUR(sum(s.expiredArticles, r => r.value))],
          emptyHint: 'Keine abgelaufenen Artikel.',
          headerInfo
        });

        this._section(doc, theme, 'Eigenverbrauch (Sachentnahme, "Auf den Wirt")', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 300, render: r => r.article },
            { header: 'Menge', width: 100, align: 'right', render: r => this._fmtQty(r.quantity, r.unit) },
            { header: 'Warenwert', width: 100, align: 'right', render: r => this._fmtEUR(r.value) }
          ],
          rows: s.ownerUseArticles || [],
          sumRow: ['Summe', String(sum(s.ownerUseArticles, r => r.quantity)), this._fmtEUR(sum(s.ownerUseArticles, r => r.value))],
          emptyHint: 'Kein Eigenverbrauch.',
          headerInfo
        });

        // ---------- DETAILLISTEN ----------
        this._section(doc, theme, 'Einnahmen nach Artikel', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 240, render: r => r.article },
            { header: 'Kategorie', width: 160, render: r => r.category || '-' },
            { header: 'Menge', width: 80, align: 'right', render: r => Number(r.quantity || 0).toFixed(0) },
            { header: 'Betrag', width: 100, align: 'right', render: r => this._fmtEUR(r.amount), color: () => theme.color.success }
          ],
          rows: s.soldArticles || [],
          sumRow: ['Summe', '', Number(sum(s.soldArticles, r => r.quantity)).toFixed(0), this._fmtEUR(sum(s.soldArticles, r => r.amount))],
          emptyHint: 'Keine Verkäufe.',
          headerInfo
        });

        this._section(doc, theme, 'Bezahlte Ausgangsrechnungen', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Rechnung', width: 100, render: r => r.invoiceNumber || '-' },
            { header: 'Empfänger', width: 170, render: r => r.customerName || '-' },
            { header: 'Beschreibung', width: 150, render: r => r.description || '-' },
            { header: 'Bezahlt am', width: 80, render: r => this._fmtDate(r.paidAt) },
            { header: 'Betrag', width: 90, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.success }
          ],
          rows: s.paidInvoices || [],
          sumRow: ['Summe', '', '', '', this._fmtEUR(sum(s.paidInvoices, r => r.totalAmount))],
          emptyHint: 'Keine bezahlten Ausgangsrechnungen.',
          headerInfo
        });

        this._section(doc, theme, 'Ausgabenbelege (bezahlte Eingangsrechnungen)', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Datum', width: 75, render: r => this._fmtDate(r.documentDate) },
            { header: 'Lieferant', width: 160, render: r => r.supplier || '-' },
            { header: 'Belegnr.', width: 110, render: r => r.documentNumber || '-' },
            { header: 'Zahlung', width: 75, render: r => this._paymentLabel(r.paymentMethod) },
            { header: 'Nachweis', width: 60, align: 'center', render: r => r.nachweisUrl ? 'Ja' : 'Nein' },
            { header: 'Betrag', width: 80, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.danger }
          ],
          rows: s.expenseDocs || [],
          sumRow: ['Summe', '', '', '', '', this._fmtEUR(sum(s.expenseDocs, r => r.totalAmount))],
          emptyHint: 'Keine Ausgabenbelege.',
          headerInfo
        });

        // ---------- UNTERSCHRIFTEN ----------
        this._signatureBlock(doc, theme, ['Kassenwart/in', 'Kassenprüfer/in 1', 'Kassenprüfer/in 2'], headerInfo);

        this._finishDoc(doc, theme, headerInfo);
        done.then(pdf => resolve({
          data: pdf,
          filename: `jahresabschluss_${String(fiscalYear.name).replace(/\s+/g, '_')}${draft ? '_ENTWURF' : ''}.pdf`,
          mimeType: 'application/pdf'
        }));
      } catch (e) { reject(e); }
    });
  }

  /* ========= HELPERS ========= */
  async getDailySummaryData(date, startHour) {
    const transactionService = require('./transactionService');
    return await transactionService.getDailySummary(date, startHour);
  }

  getMonthName(month) {
    const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    return months[month - 1];
  }
}

module.exports = new ExportService();
